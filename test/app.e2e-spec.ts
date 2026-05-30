process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';

import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, QueryFailedError } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DlqMessage } from '../src/events/entities/dlq-message.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventStatus } from '../src/events/event-status.enum';
import {
  DEAD_LETTER_EXCHANGE,
  DEAD_LETTER_QUEUE,
  ORDER_RECEIVED_ROUTING_KEY,
  RETRY_EXCHANGE,
  RETRY_TIERS,
  WEBHOOK_EXCHANGE,
  WORK_QUEUE,
} from '../src/messaging/messaging.constants';

jest.setTimeout(180_000);

const HMAC_SECRET = 'e2e-secret';
const ADMIN_KEY = 'e2e-admin-key';

function sign(timestamp: string, rawBody: string): string {
  return createHmac('sha256', HMAC_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

describe('App (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let app: INestApplication<App> & NestExpressApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.POSTGRES_HOST = container.getHost();
    process.env.POSTGRES_PORT = String(container.getPort());
    process.env.POSTGRES_USER = container.getUsername();
    process.env.POSTGRES_PASSWORD = container.getPassword();
    process.env.POSTGRES_DB = container.getDatabase();

    rabbit = await new GenericContainer('rabbitmq:3.13-management-alpine')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
      .start();
    process.env.RABBITMQ_URL = `amqp://guest:guest@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
    process.env.WEBHOOK_HMAC_SECRET = HMAC_SECRET;
    process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = '300';
    process.env.ADMIN_API_KEY = ADMIN_KEY;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<
      INestApplication<App> & NestExpressApplication
    >({ rawBody: true });
    app.useBodyParser('json', { limit: '1kb' });
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
    await rabbit?.stop();
    await container?.stop();
  });

  it('GET /health returns ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('applies migrations: events and dlq_messages tables exist', async () => {
    const tables: { tablename: string }[] = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const names = tables.map((t) => t.tablename);
    expect(names).toEqual(
      expect.arrayContaining(['events', 'dlq_messages', 'migrations']),
    );
  });

  it('deduplicates events by event_id (unique constraint)', async () => {
    const repo = dataSource.getRepository(Event);
    const base = {
      eventId: 'evt-dup',
      eventType: 'order.created',
      correlationId: 'corr-1',
      payload: { first: true },
      status: EventStatus.Received,
    };
    await repo.insert(base);

    await expect(
      repo.insert({
        ...base,
        correlationId: 'corr-2',
        payload: { second: true },
      }),
    ).rejects.toBeInstanceOf(QueryFailedError);

    const rows = await repo.find({ where: { eventId: 'evt-dup' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].correlationId).toBe('corr-1');
  });

  it('stores a dead message keyed by correlation_id even without an event_id', async () => {
    const repo = dataSource.getRepository(DlqMessage);
    await repo.insert({
      messageId: null,
      correlationId: 'corr-dead',
      eventId: null,
      reason: 'unparseable payload',
      attempts: 3,
      payload: '{ not valid json',
    });

    const row = await repo.findOneByOrFail({ correlationId: 'corr-dead' });
    expect(row.eventId).toBeNull();
    expect(row.reason).toBe('unparseable payload');
  });

  it('rejects GET /dlq without an admin key (401)', () => {
    return request(app.getHttpServer()).get('/dlq').expect(401);
  });

  it('rejects GET /dlq with a wrong admin key (403)', () => {
    return request(app.getHttpServer())
      .get('/dlq')
      .set('x-admin-key', 'wrong-key')
      .expect(403);
  });

  it('lists dead messages with a valid admin key', async () => {
    const response = await request(app.getHttpServer())
      .get('/dlq')
      .set('x-admin-key', ADMIN_KEY)
      .expect(200);

    expect(response.body).toMatchObject({
      page: 1,
      limit: 20,
      total: expect.any(Number),
    });
    expect(
      response.body.data.some(
        (m: { correlationId: string }) => m.correlationId === 'corr-dead',
      ),
    ).toBe(true);
  });

  it('accepts a signed webhook with 202 and echoes the correlation id', async () => {
    const body = JSON.stringify({
      event_id: 'evt-e2e-1',
      event_type: 'order.created',
      payload: { amount: 100 },
    });
    const ts = String(Math.floor(Date.now() / 1000));

    const response = await request(app.getHttpServer())
      .post('/webhooks/orders')
      .set('content-type', 'application/json')
      .set('x-timestamp', ts)
      .set('x-signature', sign(ts, body))
      .set('x-correlation-id', 'corr-e2e-1')
      .send(body)
      .expect(202);

    expect(response.body).toEqual({
      correlation_id: 'corr-e2e-1',
      status: 'accepted',
    });
  });

  it('rejects an invalid signature with 401', async () => {
    const body = JSON.stringify({
      event_id: 'evt-e2e-2',
      event_type: 'order.created',
      payload: { amount: 1 },
    });
    const ts = String(Math.floor(Date.now() / 1000));

    await request(app.getHttpServer())
      .post('/webhooks/orders')
      .set('content-type', 'application/json')
      .set('x-timestamp', ts)
      .set('x-signature', 'not-the-right-signature')
      .send(body)
      .expect(401);
  });

  it('rejects a malformed payload with 400', async () => {
    const body = JSON.stringify({ event_id: 'evt-e2e-3' });
    const ts = String(Math.floor(Date.now() / 1000));

    await request(app.getHttpServer())
      .post('/webhooks/orders')
      .set('content-type', 'application/json')
      .set('x-timestamp', ts)
      .set('x-signature', sign(ts, body))
      .send(body)
      .expect(400);
  });

  it('rejects a body over the configured limit with 413', async () => {
    const body = JSON.stringify({
      event_id: 'evt-e2e-4',
      event_type: 'order.created',
      payload: { blob: 'x'.repeat(2048) },
    });
    const ts = String(Math.floor(Date.now() / 1000));

    await request(app.getHttpServer())
      .post('/webhooks/orders')
      .set('content-type', 'application/json')
      .set('x-timestamp', ts)
      .set('x-signature', sign(ts, body))
      .send(body)
      .expect(413);
  });

  it('declares the durable topology and routes events to the work queue', async () => {
    const channel = app.get(AmqpConnection).channel;

    await expect(
      channel.checkExchange(WEBHOOK_EXCHANGE),
    ).resolves.toBeDefined();
    await expect(channel.checkExchange(RETRY_EXCHANGE)).resolves.toBeDefined();
    await expect(
      channel.checkExchange(DEAD_LETTER_EXCHANGE),
    ).resolves.toBeDefined();

    for (const tier of RETRY_TIERS) {
      await expect(channel.checkQueue(tier.queue)).resolves.toBeDefined();
    }
    await expect(channel.checkQueue(DEAD_LETTER_QUEUE)).resolves.toBeDefined();

    const work = await channel.checkQueue(WORK_QUEUE);
    expect(work.messageCount).toBeGreaterThan(0);

    const message = await channel.get(WORK_QUEUE, { noAck: true });
    expect(message).not.toBe(false);
    if (message) {
      expect(message.properties.deliveryMode).toBe(2);
      expect(message.properties.correlationId).toBe('corr-e2e-1');
    }
  });

  it('returns 503 when a mandatory publish is unroutable', async () => {
    const channel = app.get(AmqpConnection).channel;
    await channel.unbindQueue(
      WORK_QUEUE,
      WEBHOOK_EXCHANGE,
      ORDER_RECEIVED_ROUTING_KEY,
    );
    try {
      const body = JSON.stringify({
        event_id: 'evt-e2e-5',
        event_type: 'order.created',
        payload: { amount: 1 },
      });
      const ts = String(Math.floor(Date.now() / 1000));

      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .set('content-type', 'application/json')
        .set('x-timestamp', ts)
        .set('x-signature', sign(ts, body))
        .send(body)
        .expect(503);
    } finally {
      await channel.bindQueue(
        WORK_QUEUE,
        WEBHOOK_EXCHANGE,
        ORDER_RECEIVED_ROUTING_KEY,
      );
    }
  });
});
