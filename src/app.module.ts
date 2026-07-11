import { Module, ModuleMetadata, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDemoMode } from './common/demo-mode';
import { ObservabilityModule } from './common/observability.module';
import { validateEnv } from './config/env.validation';
import { buildDataSourceOptions } from './config/typeorm.config';
import { ConsumerModule } from './consumer/consumer.module';
import { DlqModule } from './dlq/dlq.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { TelemetryGatewayModule } from './telemetry/telemetry-gateway.module';
import { WebhooksModule } from './webhooks/webhooks.module';

function resolveRoleModules(): NonNullable<ModuleMetadata['imports']> {
  if (process.env.APP_ROLE === 'worker') {
    return [ConsumerModule];
  }
  const apiModules: NonNullable<ModuleMetadata['imports']> = [
    EventsModule,
    HealthModule,
    WebhooksModule,
    DlqModule,
  ];
  return isDemoMode() ? [...apiModules, TelemetryGatewayModule] : apiModules;
}

const roleModules = resolveRoleModules();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ObservabilityModule,
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDataSourceOptions(),
        migrationsRun: process.env.APP_ROLE !== 'worker',
      }),
    }),
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
