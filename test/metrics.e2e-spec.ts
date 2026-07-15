process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
process.env.APP_ROLE = 'worker';
process.env.MAX_PROCESSING_ATTEMPTS = '3';

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
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../src/messaging/messaging.constants';

jest.setTimeout(180_000);

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

describe('Prometheus metrics (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let app: INestApplication<App>;
  let amqp: AmqpConnection;

  async function scrape(): Promise<string> {
    const response = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);
    return response.text;
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
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await app.init();

    const dataSource = app.get(DataSource);
    await dataSource.runMigrations();
    amqp = app.get(AmqpConnection);
  });

  afterAll(async () => {
    await app?.close();
    await rabbit?.stop();
    await postgres?.stop();
  });

  it('counts worker processing decisions by outcome', async () => {
    await amqp.publish(
      WEBHOOK_EXCHANGE,
      ORDER_RECEIVED_ROUTING_KEY,
      {
        event_id: 'evt-metrics-1',
        event_type: 'order.created',
        payload: { amount: 1 },
        correlation_id: 'corr-metrics-1',
      },
      { persistent: true, correlationId: 'corr-metrics-1' },
    );

    const output = await waitFor(async () => {
      const text = await scrape();
      return text.includes('events_processed_total{outcome="processed"} 1')
        ? text
        : null;
    });
    expect(output).toContain('event_processing_duration_seconds_bucket');
  });

  it('counts unparseable messages and persisted dead letters', async () => {
    await amqp.publish(
      WEBHOOK_EXCHANGE,
      ORDER_RECEIVED_ROUTING_KEY,
      { event_type: 'order.created', payload: {} },
      { persistent: true, correlationId: 'corr-metrics-2' },
    );

    await waitFor(async () => {
      const text = await scrape();
      return text.includes('events_processed_total{outcome="unparseable"} 1') &&
        text.includes('dead_letters_persisted_total 1')
        ? text
        : null;
    });
  });

  it('labels http series with the route template', async () => {
    const output = await scrape();
    expect(output).toMatch(
      /http_requests_total\{method="GET",route="\/metrics",status="200"\} \d+/,
    );
  });
});
