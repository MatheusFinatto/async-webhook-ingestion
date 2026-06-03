import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObservabilityModule } from './common/observability.module';
import { buildDataSourceOptions } from './config/typeorm.config';
import { ConsumerModule } from './consumer/consumer.module';
import { DlqModule } from './dlq/dlq.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { WebhooksModule } from './webhooks/webhooks.module';

const roleModules = process.env.APP_ROLE === 'worker' ? [ConsumerModule] : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityModule,
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDataSourceOptions(),
        migrationsRun: process.env.APP_ROLE !== 'worker',
      }),
    }),
    EventsModule,
    HealthModule,
    WebhooksModule,
    DlqModule,
    ...roleModules,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
