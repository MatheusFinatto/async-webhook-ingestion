process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
process.env.APP_ROLE = 'worker';
process.env.MAX_PROCESSING_ATTEMPTS = '3';
process.env.ADMIN_API_KEY = 'test-admin-key';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HandledEvent, OrderHandler } from '../src/consumer/order-handler';
import { PermanentProcessingError } from '../src/consumer/processing-errors';
import { DlqModule } from '../src/dlq/dlq.module';
import { DlqMessage } from '../src/events/entities/dlq-message.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventStatus } from '../src/events/event-status.enum';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../src/messaging/messaging.constants';

jest.setTimeout(180_000);

// Fails while the event id is marked broken; "fixing the downstream" is
// removing the id from the set before replaying.
class ScriptedHandler extends OrderHandler {
  readonly broken = new Set<string>();

  async handle(event: HandledEvent): Promise<void> {
    if (this.broken.has(event.eventId)) {
      throw new PermanentProcessingError('downstream rejected');
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

describe('DLQ replay (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let app: INestApplication<App>;
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

  function replay(id: string): request.Test {
    return request(app.getHttpServer())
      .post(`/dlq/${id}/replay`)
      .set('x-admin-key', 'test-admin-key');
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

    // Worker role brings the consumers; DlqModule is added on top so the
    // replay endpoint and the consumer it feeds share one process here.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DlqModule],
    })
      .overrideProvider(OrderHandler)
      .useValue(handler)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await app.init();

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

  it('replays a dead event and it processes once the downstream is fixed', async () => {
    handler.broken.add('evt-replay-1');
    await publish(
      {
        event_id: 'evt-replay-1',
        event_type: 'order.created',
        payload: { amount: 1 },
        correlation_id: 'corr-replay-1',
      },
      'corr-replay-1',
    );

    const dead = await waitFor(async () =>
      dlq.findOneBy({ eventId: 'evt-replay-1' }),
    );
    const deadRow = await events.findOneByOrFail({ eventId: 'evt-replay-1' });
    expect(deadRow.status).toBe(EventStatus.Dead);

    handler.broken.delete('evt-replay-1');
    const response = await replay(dead.id).expect(202);
    expect(response.body).toEqual({
      event_id: 'evt-replay-1',
      correlation_id: 'corr-replay-1',
      status: 'replayed',
    });

    const processed = await waitFor(async () => {
      const row = await events.findOneBy({ eventId: 'evt-replay-1' });
      return row?.status === EventStatus.Processed ? row : null;
    });
    expect(processed.attempts).toBe(1);

    const stamped = await dlq.findOneByOrFail({ id: dead.id });
    expect(stamped.replayedAt).not.toBeNull();
  });

  it('dead-letters a replayed event again when the downstream still fails', async () => {
    handler.broken.add('evt-replay-2');
    await publish(
      {
        event_id: 'evt-replay-2',
        event_type: 'order.created',
        payload: { amount: 2 },
        correlation_id: 'corr-replay-2',
      },
      'corr-replay-2',
    );
    const dead = await waitFor(async () =>
      dlq.findOneBy({ eventId: 'evt-replay-2' }),
    );

    await replay(dead.id).expect(202);

    const row = await waitFor(async () => {
      const found = await events.findOneBy({ eventId: 'evt-replay-2' });
      return found?.status === EventStatus.Dead && found.attempts === 1
        ? found
        : null;
    });
    expect(row.status).toBe(EventStatus.Dead);

    // The re-insert into dlq_messages is ignored by the unique message_id,
    // so the original row remains the single audit record and stays
    // replayable for another round.
    const rows = await dlq.findBy({ eventId: 'evt-replay-2' });
    expect(rows).toHaveLength(1);
  });

  it('refuses to replay a dead letter without an event id', async () => {
    await publish(
      { event_type: 'order.created', payload: { amount: 1 } },
      'corr-replay-noid',
    );
    const dead = await waitFor(async () =>
      dlq.findOneBy({ correlationId: 'corr-replay-noid' }),
    );

    await replay(dead.id).expect(409);
    const untouched = await dlq.findOneByOrFail({ id: dead.id });
    expect(untouched.replayedAt).toBeNull();
  });

  it('refuses to replay an event that is already processed', async () => {
    await publish(
      {
        event_id: 'evt-replay-3',
        event_type: 'order.created',
        payload: { amount: 3 },
        correlation_id: 'corr-replay-3',
      },
      'corr-replay-3',
    );
    await waitFor(async () => {
      const row = await events.findOneBy({ eventId: 'evt-replay-3' });
      return row?.status === EventStatus.Processed ? row : null;
    });

    // A dead letter pointing at a processed event only occurs if state
    // drifted; the endpoint must still refuse to double-process.
    const stale = await dlq.save(
      dlq.create({
        messageId: 'evt-replay-3',
        correlationId: 'corr-replay-3',
        eventId: 'evt-replay-3',
        reason: 'stale record',
        attempts: 1,
        payload: JSON.stringify({
          event_id: 'evt-replay-3',
          event_type: 'order.created',
          payload: { amount: 3 },
          correlation_id: 'corr-replay-3',
        }),
      }),
    );

    await replay(stale.id).expect(409);
  });

  it('rejects unknown ids, malformed ids and missing admin keys', async () => {
    await replay('00000000-0000-4000-8000-000000000000').expect(404);
    await replay('not-a-uuid').expect(400);
    await request(app.getHttpServer())
      .post('/dlq/00000000-0000-4000-8000-000000000000/replay')
      .expect(401);
  });

  it('keeps the replayed_at audit stamp visible in the listing', async () => {
    const stamped = await dlq.findBy({ replayedAt: Not(IsNull()) });
    expect(stamped.length).toBeGreaterThan(0);

    const response = await request(app.getHttpServer())
      .get('/dlq')
      .set('x-admin-key', 'test-admin-key')
      .expect(200);
    const body = response.body as {
      data: Array<{ replayedAt: string | null }>;
    };
    expect(body.data.some((row) => row.replayedAt !== null)).toBe(true);
  });
});
