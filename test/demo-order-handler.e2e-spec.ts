process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
process.env.APP_ROLE = 'worker';
process.env.DEMO_MODE = 'true';
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
import { DemoOrderHandler } from '../src/consumer/demo-order-handler';
import { OrderHandler } from '../src/consumer/order-handler';
import { DlqMessage } from '../src/events/entities/dlq-message.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventStatus } from '../src/events/event-status.enum';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../src/messaging/messaging.constants';

jest.setTimeout(180_000);

async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 60_000,
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

describe('DemoOrderHandler (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let app: INestApplicationContext;
  let amqp: AmqpConnection;
  let events: Repository<Event>;
  let dlq: Repository<DlqMessage>;

  function publish(scenario: string, id: string): Promise<boolean> {
    return amqp.publish(
      WEBHOOK_EXCHANGE,
      ORDER_RECEIVED_ROUTING_KEY,
      {
        event_id: id,
        event_type: 'order.created',
        payload: { amount: 1, __scenario: scenario },
        correlation_id: `corr-${id}`,
      },
      { persistent: true, messageId: id, correlationId: `corr-${id}` },
    );
  }

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.POSTGRES_HOST = postgres.getHost();
    process.env.POSTGRES_PORT = String(postgres.getPort());
    process.env.POSTGRES_USER = postgres.getUsername();
    process.env.POSTGRES_PASSWORD = postgres.getPassword();
    process.env.POSTGRES_DB = postgres.getDatabase();

    rabbit = await new GenericContainer('rabbitmq:3.13-alpine')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
      .start();
    process.env.RABBITMQ_URL = `amqp://guest:guest@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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

  it('binds the DemoOrderHandler under DEMO_MODE', () => {
    expect(app.get(OrderHandler)).toBeInstanceOf(DemoOrderHandler);
  });

  it('climbs the retry ladder and succeeds on the third attempt', async () => {
    await publish('transient', 'evt-transient-1');

    const row = await waitFor(async () => {
      const found = await events.findOneBy({ eventId: 'evt-transient-1' });
      return found?.status === EventStatus.Processed ? found : null;
    });
    expect(row.attempts).toBe(3);
  });

  it('dead-letters the permanent scenario straight away', async () => {
    await publish('permanent', 'evt-permanent-1');

    const dead = await waitFor(async () =>
      dlq.findOneBy({ eventId: 'evt-permanent-1' }),
    );
    expect(dead.correlationId).toBe('corr-evt-permanent-1');

    const row = await events.findOneByOrFail({ eventId: 'evt-permanent-1' });
    expect(row.status).toBe(EventStatus.Dead);
    expect(row.attempts).toBe(1);
  });
});
