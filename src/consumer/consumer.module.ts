import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { EventsModule } from '../events/events.module';
import { DlqConsumer } from './dlq-consumer';
import { IdempotentEventProcessor } from './idempotent-event-processor';
import { NoopOrderHandler, OrderHandler } from './order-handler';
import { OrderConsumer } from './order-consumer';

@Module({
  imports: [MessagingModule, EventsModule],
  providers: [
    OrderConsumer,
    DlqConsumer,
    IdempotentEventProcessor,
    { provide: OrderHandler, useClass: NoopOrderHandler },
  ],
})
export class ConsumerModule {}
