import { Module } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { isDemoMode } from '../common/demo-mode';
import { MessagingModule } from '../messaging/messaging.module';
import {
  AmqpTelemetryEmitter,
  NoopTelemetryEmitter,
  TelemetryEmitter,
} from './telemetry-emitter';

@Module({
  imports: [MessagingModule],
  providers: [
    {
      provide: TelemetryEmitter,
      useFactory: (amqp: AmqpConnection): TelemetryEmitter =>
        isDemoMode()
          ? new AmqpTelemetryEmitter(amqp)
          : new NoopTelemetryEmitter(),
      inject: [AmqpConnection],
    },
  ],
  exports: [TelemetryEmitter],
})
export class TelemetryEmitterModule {}
