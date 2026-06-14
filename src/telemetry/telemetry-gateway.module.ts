import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { TelemetryGateway } from './telemetry.gateway';

@Module({
  imports: [MessagingModule],
  providers: [TelemetryGateway],
})
export class TelemetryGatewayModule {}
