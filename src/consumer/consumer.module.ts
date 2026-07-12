import { Module } from '@nestjs/common';
import { isDemoMode } from '../common/demo-mode';
import { MessagingModule } from '../messaging/messaging.module';
import { TelemetryEmitterModule } from '../telemetry/telemetry-emitter.module';
import { DemoOrderHandler } from './demo-order-handler';
import { DlqConsumer } from './dlq-consumer';
import { IdempotentEventProcessor } from './idempotent-event-processor';
import { NoopOrderHandler, OrderHandler } from './order-handler';
import { OrderConsumer } from './order-consumer';

@Module({
  imports: [MessagingModule, TelemetryEmitterModule],
  providers: [
    OrderConsumer,
    DlqConsumer,
    IdempotentEventProcessor,
    {
      provide: OrderHandler,
      useClass: isDemoMode() ? DemoOrderHandler : NoopOrderHandler,
    },
  ],
})
export class ConsumerModule {}
