process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
process.env.APP_ROLE = 'worker';
process.env.MAX_PROCESSING_ATTEMPTS = '3';

import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HandledEvent, OrderHandler } from '../src/consumer/order-handler';
import {
  PermanentProcessingError,
  TransientProcessingError,
} from '../src/consumer/processing-errors';
import { DlqMessage } from '../src/events/entities/dlq-message.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventStatus } from '../src/events/event-status.enum';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../src/messaging/messaging.constants';

jest.setTimeout(180_000);

class ScriptedHandler extends OrderHandler {
  readonly transientFails = new Map<string, number>();
  readonly permanent = new Set<string>();

  async handle(event: HandledEvent): Promise<void> {
    if (this.permanent.has(event.eventId)) {
      throw new PermanentProcessingError('poison');
    }
    const left = this.transientFails.get(event.eventId) ?? 0;
    if (left > 0) {
      this.transientFails.set(event.eventId, left - 1);
      throw new TransientProcessingError('flaky');
    }
  }
}

async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('Retry + DLQ (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let app: INestApplicationContext;
  let amqp: AmqpConnection;
  let events: Repository<Event>;
  let dlq: Repository<DlqMessage>;
  const handler = new ScriptedHandler();

  function publish(body: unknown, correlationId: string): Promise<boolean> {
    return amqp.publish(WEBHOOK_EXCHANGE, ORDER_RECEIVED_ROUTING_KEY, body, {
      persistent: true,
      correlationId,
    });
  }

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.POSTGRES_HOST = postgres.getHost();
    process.env.POSTGRES_PORT = String(postgres.getPort());
    process.env.POSTGRES_USER = postgres.getUsername();
    process.env.POSTGRES_PASSWORD = postgres.getPassword();
    process.env.POSTGRES_DB = postgres.getDatabase();

    rabbit = await new GenericContainer('rabbitmq:3.13-management-alpine')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
      .start();
    process.env.RABBITMQ_URL = `amqp://guest:guest@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OrderHandler)
      .useValue(handler)
      .compile();
    app = await moduleRef.init();

    const dataSource = app.get(DataSource);
    await dataSource.runMigrations();
    events = dataSource.getRepository(Event);
    dlq = dataSource.getRepository(DlqMessage);
    amqp = app.get(AmqpConnection);
  });

  afterAll(async () => {
    await app?.close();
    await rabbit?.stop();
    await postgres?.stop();
  });

  it('retries a transient failure and succeeds on a later attempt', async () => {
    handler.transientFails.set('evt-retry-1', 1);
    await publish(
      {
        event_id: 'evt-retry-1',
        event_type: 'order.created',
        payload: { amount: 1 },
        correlation_id: 'corr-retry-1',
      },
      'corr-retry-1',
    );

    const row = await waitFor(async () => {
      const found = await events.findOneBy({ eventId: 'evt-retry-1' });
      return found?.status === EventStatus.Processed ? found : null;
    });
    expect(row.attempts).toBeGreaterThanOrEqual(2);
  });

  it('sends a permanently failing message to the DLQ', async () => {
    handler.permanent.add('evt-poison-1');
    await publish(
      {
        event_id: 'evt-poison-1',
        event_type: 'order.created',
        payload: { amount: 1 },
        correlation_id: 'corr-poison-1',
      },
      'corr-poison-1',
    );

    const dead = await waitFor(async () =>
      dlq.findOneBy({ eventId: 'evt-poison-1' }),
    );
    expect(dead.reason).toBe('poison');

    const row = await events.findOneByOrFail({ eventId: 'evt-poison-1' });
    expect(row.status).toBe(EventStatus.Dead);
  });

  it('dead-letters a transient failure once attempts are exhausted', async () => {
    handler.transientFails.set('evt-exhaust-1', 99);
    await publish(
      {
        event_id: 'evt-exhaust-1',
        event_type: 'order.created',
        payload: { amount: 1 },
        correlation_id: 'corr-exhaust-1',
      },
      'corr-exhaust-1',
    );

    // 3 attempts with 5s + 30s retry tiers in between: give it plenty.
    const dead = await waitFor(
      async () => dlq.findOneBy({ eventId: 'evt-exhaust-1' }),
      120_000,
    );
    expect(dead.reason).toBe('flaky');
    expect(dead.attempts).toBe(3);

    const row = await events.findOneByOrFail({ eventId: 'evt-exhaust-1' });
    expect(row.status).toBe(EventStatus.Dead);
    expect(row.attempts).toBe(3);
  });

  it('dead-letters a payload with no event_id, keyed by correlation_id', async () => {
    await publish(
      { event_type: 'order.created', payload: { amount: 1 } },
      'corr-noid-1',
    );

    const dead = await waitFor(async () =>
      dlq.findOneBy({ correlationId: 'corr-noid-1' }),
    );
    expect(dead.eventId).toBeNull();
  });

  it('recovers an event stuck in failed by re-emitting its dead letter', async () => {
    // "failed" without a dlq_messages row models a crash between the state
    // commit and the DLX publish; a redelivery must finish the job.
    await events.insert({
      eventId: 'evt-stuck-1',
      eventType: 'order.created',
      correlationId: 'corr-stuck-1',
      payload: { amount: 1 },
      status: EventStatus.Failed,
      attempts: 3,
      failureReason: 'dlx publish lost',
    });

    await publish(
      {
        event_id: 'evt-stuck-1',
        event_type: 'order.created',
        payload: { amount: 1 },
        correlation_id: 'corr-stuck-1',
      },
      'corr-stuck-1',
    );

    const dead = await waitFor(async () =>
      dlq.findOneBy({ eventId: 'evt-stuck-1' }),
    );
    expect(dead.reason).toBe('dlx publish lost');

    const row = await events.findOneByOrFail({ eventId: 'evt-stuck-1' });
    expect(row.status).toBe(EventStatus.Dead);
    expect(row.attempts).toBe(3);
  });
});
