import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  assertDemoModeAllowed,
  demoWebOrigin,
  isDemoMode,
} from './common/demo-mode';
import { JsonLogger } from './common/json-logger';
import { MetricsService } from './metrics/metrics.service';
import { startWorkerMetricsServer } from './metrics/worker-metrics-server';

async function bootstrapApi(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(JsonLogger));
  app.useBodyParser('json', {
    limit: process.env.WEBHOOK_BODY_LIMIT ?? '100kb',
  });
  if (isDemoMode()) {
    app.enableCors({
      origin: demoWebOrigin(),
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'content-type',
        'x-signature',
        'x-timestamp',
        'x-correlation-id',
        'x-admin-key',
      ],
      exposedHeaders: ['x-correlation-id'],
    });
  }
  const docsConfig = new DocumentBuilder()
    .setTitle('Async webhook ingestion')
    .setDescription(
      'Signed webhook intake with asynchronous processing. ' +
        'POST /webhooks/orders is HMAC-authenticated: the x-signature header must ' +
        'carry a hex HMAC-SHA256 of "timestamp.rawBody" using the shared secret, ' +
        'with the unix timestamp in x-timestamp. "Try it out" therefore returns ' +
        '401 unless the signature is computed by a real client; see the signed ' +
        'curl example in the README or bench/latency-smoke.mjs. ' +
        'DLQ endpoints require the x-admin-key header.',
    )
    .setVersion('0.1.0')
    .addApiKey(
      { type: 'apiKey', name: 'x-admin-key', in: 'header' },
      'admin-key',
    )
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, docsConfig),
  );
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
}

async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(JsonLogger));
  app.enableShutdownHooks();
  const metricsPort = Number(process.env.WORKER_METRICS_PORT ?? 9091);
  const metricsServer = await startWorkerMetricsServer(
    app.get(MetricsService),
    metricsPort,
  );
  Logger.log(
    `Worker role started; consuming the work and dead-letter queues, metrics on port ${metricsPort}`,
    'Bootstrap',
  );
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {}, 1 << 30);
    const stop = () => {
      clearInterval(keepAlive);
      resolve();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
  metricsServer.close();
  await app.close();
}

async function bootstrap(): Promise<void> {
  assertDemoModeAllowed();
  const role = process.env.APP_ROLE ?? 'api';
  if (role === 'worker') {
    await bootstrapWorker();
    return;
  }
  if (role !== 'api') {
    throw new Error(`Unknown APP_ROLE "${role}" (expected "api" or "worker")`);
  }
  await bootstrapApi();
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    error instanceof Error ? error : new Error(String(error)),
  );
  process.exit(1);
});
