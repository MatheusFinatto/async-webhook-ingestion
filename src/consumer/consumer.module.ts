import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { EventsModule } from '../events/events.module';
import { IdempotentEventProcessor } from './idempotent-event-processor';
import { OrderConsumer } from './order-consumer';

@Module({
  imports: [MessagingModule, EventsModule],
  providers: [OrderConsumer, IdempotentEventProcessor],
})
export class ConsumerModule {}
