process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
process.env.APP_ROLE = 'worker';

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
import { JsonLogger } from '../src/common/json-logger';
import { Event } from '../src/events/entities/event.entity';
import { EventStatus } from '../src/events/event-status.enum';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../src/messaging/messaging.constants';

jest.setTimeout(180_000);

async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 20_000,
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Consumer (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let app: INestApplicationContext;
  let amqp: AmqpConnection;
  let events: Repository<Event>;

  function publish(eventId: string, correlationId: string): Promise<boolean> {
    return amqp.publish(
      WEBHOOK_EXCHANGE,
      ORDER_RECEIVED_ROUTING_KEY,
      {
        event_id: eventId,
        event_type: 'order.created',
        payload: { amount: 1 },
        correlation_id: correlationId,
      },
      { persistent: true, messageId: eventId, correlationId },
    );
  }

  function findProcessed(eventId: string): () => Promise<Event | null> {
    return async () => {
      const row = await events.findOneBy({ eventId });
      return row?.status === EventStatus.Processed ? row : null;
    };
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
    }).compile();
    app = await moduleRef.init();
    app.useLogger(app.get(JsonLogger));

    const dataSource = app.get(DataSource);
    await dataSource.runMigrations();
    events = dataSource.getRepository(Event);
    amqp = app.get(AmqpConnection);
  });

  afterAll(async () => {
    await app?.close();
    await rabbit?.stop();
    await postgres?.stop();
  });

  it('consumes a published event and marks it processed', async () => {
    await publish('evt-consume-1', 'corr-consume-1');

    const row = await waitFor(findProcessed('evt-consume-1'));
    expect(row.correlationId).toBe('corr-consume-1');
    expect(row.status).toBe(EventStatus.Processed);
  });

  it('carries the correlation id into worker logs and the row', async () => {
    const lines: Record<string, unknown>[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        try {
          lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        } catch {
          return true;
        }
        return true;
      });

    let row: Event;
    try {
      await publish('evt-ca06-worker', 'corr-ca06-worker');
      row = await waitFor(findProcessed('evt-ca06-worker'));
    } finally {
      spy.mockRestore();
    }

    expect(row.correlationId).toBe('corr-ca06-worker');
    const workerLog = lines.find(
      (line) =>
        line.correlation_id === 'corr-ca06-worker' &&
        line.event_id === 'evt-ca06-worker',
    );
    expect(workerLog).toBeDefined();
  });

  it('deduplicates a repeated delivery, processing once', async () => {
    await publish('evt-consume-2', 'corr-consume-2a');
    await waitFor(findProcessed('evt-consume-2'));

    await publish('evt-consume-2', 'corr-consume-2b');
    await waitFor(async () => {
      const row = await events.findOneBy({ eventId: 'evt-consume-2' });
      return row && row.duplicateCount >= 1 ? row : null;
    });

    const rows = await events.findBy({ eventId: 'evt-consume-2' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(EventStatus.Processed);
    expect(rows[0].correlationId).toBe('corr-consume-2a');
    expect(rows[0].duplicateCount).toBeGreaterThanOrEqual(1);
  });

  it('processes exactly once under a concurrent race', async () => {
    const fanout = 8;
    await Promise.all(
      Array.from({ length: fanout }, (_unused, index) =>
        publish('evt-consume-3', `corr-consume-3-${index}`),
      ),
    );

    await waitFor(findProcessed('evt-consume-3'));
    await waitFor(async () => {
      const row = await events.findOneBy({ eventId: 'evt-consume-3' });
      return row && row.duplicateCount >= fanout - 1 ? row : null;
    });

    const rows = await events.findBy({ eventId: 'evt-consume-3' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(EventStatus.Processed);
    expect(rows[0].duplicateCount).toBe(fanout - 1);
  });
});
