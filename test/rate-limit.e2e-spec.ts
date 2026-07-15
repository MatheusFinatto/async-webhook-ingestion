process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
process.env.WEBHOOK_HMAC_SECRET = 'e2e-secret';
process.env.ADMIN_API_KEY = 'e2e-admin-key';
process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = '300';
process.env.RATE_LIMIT_TTL_SECONDS = '60';
process.env.RATE_LIMIT_MAX = '3';

import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

jest.setTimeout(180_000);

const HMAC_SECRET = 'e2e-secret';

function sign(timestamp: string, rawBody: string): string {
  return createHmac('sha256', HMAC_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

describe('Rate limiting (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let app: INestApplication<App>;

  function post(body: Record<string, unknown>, signed: boolean): request.Test {
    const raw = JSON.stringify(body);
    const req = request(app.getHttpServer())
      .post('/webhooks/orders')
      .set('content-type', 'application/json');
    if (signed) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      req.set('x-timestamp', timestamp);
      req.set('x-signature', sign(timestamp, raw));
    }
    return req.send(raw);
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
    app = moduleRef.createNestApplication<
      INestApplication<App> & NestExpressApplication
    >({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await rabbit?.stop();
    await postgres?.stop();
  });

  it('throttles the ingestion endpoint before the signature check', async () => {
    const body = {
      event_id: 'evt-throttle-1',
      event_type: 'order.created',
      payload: { amount: 1 },
    };

    // An unsigned request inside the window is rejected by the HMAC guard,
    // proving the throttler let it through. It still consumes a slot: the
    // limit counts requests, not accepted events.
    await post(body, false).expect(401);
    await post(body, true).expect(202);
    await post(body, true).expect(202);

    const throttled = await post(body, true).expect(429);
    expect(throttled.headers['retry-after']).toBeDefined();

    // Past the limit even a garbage request gets 429, not 401: the counter
    // runs first, so a flood never reaches the HMAC computation.
    await post(body, false).expect(429);
  });

  it('leaves the health endpoint unthrottled', async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await request(app.getHttpServer()).get('/health');
      expect(response.status).not.toBe(429);
    }
  });
});
