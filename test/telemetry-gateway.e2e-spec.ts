process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
process.env.APP_ROLE = 'api';
process.env.DEMO_MODE = 'true';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.WEBHOOK_HMAC_SECRET = 'telemetry-e2e-secret';
process.env.ADMIN_API_KEY = 'telemetry-e2e-admin-key';

import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Socket, io } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { JsonLogger } from '../src/common/json-logger';
import {
  TELEMETRY_EXCHANGE,
  telemetryRoutingKey,
} from '../src/messaging/messaging.constants';
import {
  TELEMETRY_FEED_EVENT,
  TELEMETRY_SCOPED_EVENT,
  TELEMETRY_SUBSCRIBE_EVENT,
} from '../src/telemetry/telemetry.gateway';
import { TelemetryEnvelope } from '../src/telemetry/telemetry-emitter';

jest.setTimeout(180_000);

function envelope(correlationId: string): TelemetryEnvelope {
  return {
    version: 1,
    stage: 'processed',
    correlation_id: correlationId,
    event_id: `evt-${correlationId}`,
    event_type: 'order.created',
    status: 'processed',
    attempts: 1,
    ts: new Date().toISOString(),
  };
}

function nextEvent(
  client: Socket,
  event: string,
  timeoutMs = 15_000,
): Promise<TelemetryEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeoutMs,
    );
    client.once(event, (payload: TelemetryEnvelope) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function connected(client: Socket, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for connection')),
      timeoutMs,
    );
    client.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('Telemetry gateway (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let app: INestApplication;
  let amqp: AmqpConnection;
  let url: string;
  let client: Socket;

  function publish(message: TelemetryEnvelope): Promise<boolean> {
    return amqp.publish(
      TELEMETRY_EXCHANGE,
      telemetryRoutingKey(message.stage),
      message,
    );
  }

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    rabbit = await new GenericContainer('rabbitmq:3.13-alpine')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
      .start();

    process.env.POSTGRES_HOST = postgres.getHost();
    process.env.POSTGRES_PORT = String(postgres.getPort());
    process.env.POSTGRES_USER = postgres.getUsername();
    process.env.POSTGRES_PASSWORD = postgres.getPassword();
    process.env.POSTGRES_DB = postgres.getDatabase();
    process.env.RABBITMQ_URL = `amqp://guest:guest@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
      bufferLogs: true,
    });
    app.useLogger(app.get(JsonLogger));
    await app.init();
    await app.listen(0);

    url = await app.getUrl();
    amqp = app.get(AmqpConnection);
  });

  afterAll(async () => {
    client?.close();
    await app?.close();
    await rabbit?.stop();
    await postgres?.stop();
  });

  beforeEach(async () => {
    client = io(url, { transports: ['websocket'] });
    await connected(client);
  });

  afterEach(() => {
    client.close();
  });

  it('broadcasts telemetry envelopes published to the exchange', async () => {
    const received = nextEvent(client, TELEMETRY_FEED_EVENT);

    await publish(envelope('cid-feed'));

    await expect(received).resolves.toMatchObject({
      version: 1,
      stage: 'processed',
      correlation_id: 'cid-feed',
      event_id: 'evt-cid-feed',
    });
  });

  it('mirrors envelopes to subscribers of a correlation id room', async () => {
    await new Promise<void>((resolve) => {
      client.emit(TELEMETRY_SUBSCRIBE_EVENT, 'cid-room', () => resolve());
    });

    const scoped = nextEvent(client, TELEMETRY_SCOPED_EVENT);

    await publish(envelope('cid-room'));

    await expect(scoped).resolves.toMatchObject({
      correlation_id: 'cid-room',
    });
  });

  it('keeps delivering after the client reconnects', async () => {
    client.disconnect();
    client.connect();
    await connected(client);

    const received = nextEvent(client, TELEMETRY_FEED_EVENT);

    await publish(envelope('cid-reconnect'));

    await expect(received).resolves.toMatchObject({
      correlation_id: 'cid-reconnect',
    });
  });
});
