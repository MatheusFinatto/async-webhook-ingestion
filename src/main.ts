import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrapApi(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.useBodyParser('json', {
    limit: process.env.WEBHOOK_BODY_LIMIT ?? '100kb',
  });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
}

async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log(
    'Worker role started (idle until the consumer phase)',
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
  await app.close();
}

async function bootstrap(): Promise<void> {
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

void bootstrap();
