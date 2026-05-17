import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { EventPublisher } from './event-publisher';
import { RabbitEventPublisher } from './rabbit-event-publisher';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [MessagingModule],
  controllers: [WebhooksController],
  providers: [
    WebhookSignatureGuard,
    { provide: EventPublisher, useClass: RabbitEventPublisher },
  ],
})
export class WebhooksModule {}
