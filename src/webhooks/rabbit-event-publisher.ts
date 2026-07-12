import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { EventPublisher } from './event-publisher';
import { OrderWebhookDto } from './dto/order-webhook.dto';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../messaging/messaging.constants';

// Correlates a basic.return with the publish that caused it. The correlation
// id cannot play this role: it is caller-supplied and two in-flight publishes
// may share it, which would attribute a return to the wrong one.
export const PUBLISH_TOKEN_HEADER = 'x-publish-token';

@Injectable()
export class RabbitEventPublisher
  extends EventPublisher
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(RabbitEventPublisher.name);
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
        const token = message.properties.headers?.[PUBLISH_TOKEN_HEADER];
        if (typeof token === 'string') {
          this.pendingReturns.get(token)?.();
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
    const publishToken = randomUUID();
    let returned = false;
    this.pendingReturns.set(publishToken, () => {
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
          headers: {
            'x-correlation-id': correlationId,
            [PUBLISH_TOKEN_HEADER]: publishToken,
          },
        },
      );
      await this.withTimeout(confirm);
    } finally {
      this.pendingReturns.delete(publishToken);
    }
    if (returned) {
      throw new Error('message returned as unroutable');
    }
    this.logger.log({
      message: 'published, awaiting consumption',
      event_id: event.event_id,
      correlation_id: correlationId,
    });
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
