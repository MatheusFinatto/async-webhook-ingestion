import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from 'amqplib';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DlqMessage } from '../events/entities/dlq-message.entity';
import { Event } from '../events/entities/event.entity';
import { EventStatus } from '../events/event-status.enum';
import { runWithCorrelationId } from '../common/correlation-context';
import {
  DEAD_LETTER_EXCHANGE,
  DEAD_LETTER_QUEUE,
  DEAD_LETTER_ROUTING_KEY,
} from '../messaging/messaging.constants';

interface DeadLetter {
  event_id?: unknown;
  correlation_id?: unknown;
  reason?: unknown;
  attempts?: unknown;
  payload?: unknown;
}

@Injectable()
export class DlqConsumer {
  private readonly logger = new Logger(DlqConsumer.name);

  constructor(
    @InjectRepository(DlqMessage)
    private readonly dlqMessages: Repository<DlqMessage>,
    @InjectRepository(Event)
    private readonly events: Repository<Event>,
  ) {}

  @RabbitSubscribe({
    exchange: DEAD_LETTER_EXCHANGE,
    routingKey: DEAD_LETTER_ROUTING_KEY,
    queue: DEAD_LETTER_QUEUE,
    queueOptions: { durable: true },
    allowNonJsonMessages: true,
  })
  async handle(
    _content: unknown,
    amqpMessage: ConsumeMessage,
  ): Promise<Nack | void> {
    const raw = amqpMessage.content.toString('utf8');
    const dead = this.parse(raw);

    const eventId =
      typeof dead.event_id === 'string' && dead.event_id ? dead.event_id : null;
    const correlationId =
      (typeof dead.correlation_id === 'string' && dead.correlation_id
        ? dead.correlation_id
        : null) ??
      (typeof amqpMessage.properties.correlationId === 'string'
        ? amqpMessage.properties.correlationId
        : null) ??
      'unknown';

    return runWithCorrelationId(correlationId, async () => {
      try {
        await this.dlqMessages.insert({
          messageId:
            typeof amqpMessage.properties.messageId === 'string'
              ? amqpMessage.properties.messageId
              : eventId,
          correlationId,
          eventId,
          reason: typeof dead.reason === 'string' ? dead.reason : 'unknown',
          attempts: typeof dead.attempts === 'number' ? dead.attempts : 0,
          payload: typeof dead.payload === 'string' ? dead.payload : raw,
        });
        if (eventId) {
          await this.events.update({ eventId }, { status: EventStatus.Dead });
        }
        this.logger.warn({
          message: 'persisted dead letter',
          event_id: eventId,
          correlation_id: correlationId,
        });
      } catch (error) {
        this.logger.error('failed to persist dead letter', error as Error);
        return new Nack(true);
      }
    });
  }

  private parse(raw: string): DeadLetter {
    try {
      return JSON.parse(raw) as DeadLetter;
    } catch {
      return { payload: raw };
    }
  }
}
