import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { EventPublisher } from './event-publisher';
import { OrderWebhookDto } from './dto/order-webhook.dto';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../messaging/messaging.constants';

@Injectable()
export class RabbitEventPublisher
  extends EventPublisher
  implements OnApplicationBootstrap
{
  private readonly confirmTimeoutMs: number;
  private readonly pendingReturns = new Map<string, () => void>();

  constructor(
    private readonly amqp: AmqpConnection,
    config: ConfigService,
  ) {
    super();
    this.confirmTimeoutMs = Number(
      config.get<string>('PUBLISH_CONFIRM_TIMEOUT_MS') ?? 5000,
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.amqp.managedChannel.addSetup((channel: ConfirmChannel) => {
      channel.on('return', (message: ConsumeMessage) => {
        const correlationId = message.properties.correlationId;
        if (typeof correlationId === 'string') {
          this.pendingReturns.get(correlationId)?.();
        }
      });
    });
  }

  async publish(event: OrderWebhookDto, correlationId: string): Promise<void> {
    const message = {
      event_id: event.event_id,
      event_type: event.event_type,
      payload: event.payload,
      correlation_id: correlationId,
    };
    let returned = false;
    this.pendingReturns.set(correlationId, () => {
      returned = true;
    });
    try {
      const confirm = this.amqp.publish(
        WEBHOOK_EXCHANGE,
        ORDER_RECEIVED_ROUTING_KEY,
        message,
        {
          persistent: true,
          mandatory: true,
          messageId: event.event_id,
          correlationId,
          contentType: 'application/json',
          headers: { 'x-correlation-id': correlationId },
        },
      );
      await this.withTimeout(confirm);
    } finally {
      this.pendingReturns.delete(correlationId);
    }
    if (returned) {
      throw new Error('message returned as unroutable');
    }
  }

  private withTimeout(confirm: Promise<boolean>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('publisher confirm timed out'));
      }, this.confirmTimeoutMs);
      confirm.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}
