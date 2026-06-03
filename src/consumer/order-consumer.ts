import { Injectable, Logger } from '@nestjs/common';
import {
  AmqpConnection,
  Nack,
  RabbitSubscribe,
} from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { runWithCorrelationId } from '../common/correlation-context';
import {
  ATTEMPT_HEADER,
  DEAD_LETTER_EXCHANGE,
  DEAD_LETTER_ROUTING_KEY,
  ORDER_RECEIVED_ROUTING_KEY,
  RETRY_EXCHANGE,
  WEBHOOK_EXCHANGE,
  WORK_QUEUE,
  retryTierForAttempt,
} from '../messaging/messaging.constants';
import { IdempotentEventProcessor } from './idempotent-event-processor';

interface OrderMessage {
  event_id?: unknown;
  event_type?: unknown;
  payload?: unknown;
  correlation_id?: unknown;
}

interface DeadLetter {
  eventId: string | null;
  correlationId: string;
  reason: string;
  attempts: number;
  payload: string;
}

@Injectable()
export class OrderConsumer {
  private readonly logger = new Logger(OrderConsumer.name);

  constructor(
    private readonly processor: IdempotentEventProcessor,
    private readonly amqp: AmqpConnection,
  ) {}

  @RabbitSubscribe({
    exchange: WEBHOOK_EXCHANGE,
    routingKey: ORDER_RECEIVED_ROUTING_KEY,
    queue: WORK_QUEUE,
    queueOptions: { durable: true },
    allowNonJsonMessages: true,
  })
  async handle(
    _content: unknown,
    amqpMessage: ConsumeMessage,
  ): Promise<Nack | void> {
    const raw = amqpMessage.content.toString('utf8');
    const correlationId = this.correlationOf(amqpMessage, raw);
    return runWithCorrelationId(correlationId, () =>
      this.consume(correlationId, raw, amqpMessage),
    );
  }

  private async consume(
    correlationId: string,
    raw: string,
    amqpMessage: ConsumeMessage,
  ): Promise<Nack | void> {
    const parsed = this.parse(raw);
    if (
      !parsed ||
      typeof parsed.event_id !== 'string' ||
      parsed.event_id.length === 0
    ) {
      this.logger.warn({
        message: 'dead-lettering unparseable message',
        correlation_id: correlationId,
      });
      await this.toDeadLetter({
        eventId: null,
        correlationId,
        reason: 'unparseable payload or missing event_id',
        attempts: 0,
        payload: raw,
      });
      return;
    }

    const event = {
      eventId: parsed.event_id,
      eventType:
        typeof parsed.event_type === 'string' ? parsed.event_type : 'unknown',
      correlationId,
      payload:
        parsed.payload && typeof parsed.payload === 'object'
          ? (parsed.payload as Record<string, unknown>)
          : {},
    };
    const isContinuation =
      amqpMessage.properties.headers?.[ATTEMPT_HEADER] !== undefined ||
      amqpMessage.fields.redelivered === true;

    this.logger.log({
      message: 'consuming event',
      event_id: event.eventId,
      correlation_id: correlationId,
      is_continuation: isContinuation,
    });

    let decision;
    try {
      decision = await this.processor.process(event, { isContinuation });
    } catch (error) {
      this.logger.error(
        `processing failed for event ${event.eventId}`,
        error as Error,
      );
      return new Nack(true);
    }

    this.logger.log({
      message: 'processing decision',
      event_id: event.eventId,
      correlation_id: correlationId,
      decision: decision.kind,
    });

    switch (decision.kind) {
      case 'processed':
      case 'duplicate':
        return;
      case 'retry': {
        const tier = retryTierForAttempt(decision.attempts);
        await this.amqp.publish(
          RETRY_EXCHANGE,
          tier.routingKey,
          {
            event_id: event.eventId,
            event_type: event.eventType,
            payload: event.payload,
            correlation_id: correlationId,
          },
          {
            persistent: true,
            messageId: event.eventId,
            correlationId,
            headers: {
              [ATTEMPT_HEADER]: decision.attempts,
              'x-correlation-id': correlationId,
            },
          },
        );
        return;
      }
      case 'dead':
        await this.toDeadLetter({
          eventId: event.eventId,
          correlationId,
          reason: decision.reason,
          attempts: decision.attempts,
          payload: raw,
        });
        return;
    }
  }

  private parse(raw: string): OrderMessage | null {
    try {
      return JSON.parse(raw) as OrderMessage;
    } catch {
      return null;
    }
  }

  private correlationOf(message: ConsumeMessage, raw: string): string {
    const fromProps = message.properties.correlationId;
    if (typeof fromProps === 'string' && fromProps) {
      return fromProps;
    }
    const header = message.properties.headers?.['x-correlation-id'];
    if (typeof header === 'string' && header) {
      return header;
    }
    const body = this.parse(raw);
    if (
      body &&
      typeof body.correlation_id === 'string' &&
      body.correlation_id
    ) {
      return body.correlation_id;
    }
    return randomUUID();
  }

  private async toDeadLetter(dead: DeadLetter): Promise<void> {
    await this.amqp.publish(
      DEAD_LETTER_EXCHANGE,
      DEAD_LETTER_ROUTING_KEY,
      {
        event_id: dead.eventId,
        correlation_id: dead.correlationId,
        reason: dead.reason,
        attempts: dead.attempts,
        payload: dead.payload,
      },
      {
        persistent: true,
        messageId: dead.eventId ?? undefined,
        correlationId: dead.correlationId,
        headers: { 'x-correlation-id': dead.correlationId },
      },
    );
  }
}
