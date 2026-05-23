import { Injectable } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
  WORK_QUEUE,
} from '../messaging/messaging.constants';
import { IdempotentEventProcessor } from './idempotent-event-processor';

interface OrderMessage {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
}

@Injectable()
export class OrderConsumer {
  constructor(private readonly processor: IdempotentEventProcessor) {}

  @RabbitSubscribe({
    exchange: WEBHOOK_EXCHANGE,
    routingKey: ORDER_RECEIVED_ROUTING_KEY,
    queue: WORK_QUEUE,
    queueOptions: { durable: true },
  })
  async handle(message: OrderMessage): Promise<Nack | void> {
    try {
      await this.processor.process({
        eventId: message.event_id,
        eventType: message.event_type,
        correlationId: message.correlation_id,
        payload: message.payload,
      });
    } catch {
      return new Nack(false);
    }
  }
}
