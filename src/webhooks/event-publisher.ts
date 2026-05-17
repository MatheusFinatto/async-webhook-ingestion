import { OrderWebhookDto } from './dto/order-webhook.dto';

export abstract class EventPublisher {
  abstract publish(
    event: OrderWebhookDto,
    correlationId: string,
  ): Promise<void>;
}
