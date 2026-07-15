import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DataSource, EntityManager } from 'typeorm';
import { withTimeout } from '../common/with-timeout';
import { DlqMessage } from '../events/entities/dlq-message.entity';
import { Event } from '../events/entities/event.entity';
import { EventStatus } from '../events/event-status.enum';
import {
  ATTEMPT_HEADER,
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../messaging/messaging.constants';

export interface ReplayReceipt {
  event_id: string;
  correlation_id: string;
  status: 'replayed';
}

// States a replay may start from. Received is included so a replay whose
// publish was lost (state reset committed, but no message made it to the
// broker) can simply be retried instead of wedging. Replaying an event that
// is genuinely in flight is harmless: the extra message settles as a
// duplicate once the first one commits.
const REPLAYABLE_STATES: ReadonlySet<EventStatus> = new Set([
  EventStatus.Dead,
  EventStatus.Failed,
  EventStatus.Received,
]);

interface PreparedReplay {
  eventId: string;
  correlationId: string;
  body: Record<string, unknown>;
}

@Injectable()
export class DlqReplayService {
  private readonly logger = new Logger(DlqReplayService.name);
  private readonly confirmTimeoutMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly amqp: AmqpConnection,
    config: ConfigService,
  ) {
    this.confirmTimeoutMs = Number(
      config.get<string>('PUBLISH_CONFIRM_TIMEOUT_MS') ?? 5000,
    );
  }

  async replay(id: string): Promise<ReplayReceipt> {
    // Reset state first, publish second. In the opposite order the worker
    // could consume the redrive while the event row still says dead, and the
    // processor would drop it as a duplicate of a settled event.
    const prepared = await this.dataSource.transaction((manager) =>
      this.prepare(manager, id),
    );
    try {
      await withTimeout(
        this.amqp.publish(
          WEBHOOK_EXCHANGE,
          ORDER_RECEIVED_ROUTING_KEY,
          prepared.body,
          {
            persistent: true,
            messageId: prepared.eventId,
            correlationId: prepared.correlationId,
            contentType: 'application/json',
            headers: {
              // Marks the redrive as a continuation of the existing events
              // row; without it the processor counts it as a duplicate.
              [ATTEMPT_HEADER]: 0,
              'x-correlation-id': prepared.correlationId,
            },
          },
        ),
        this.confirmTimeoutMs,
        'publisher confirm timed out',
      );
    } catch (error) {
      this.logger.error(
        {
          message: 'replay publish failed',
          dlq_message_id: id,
          event_id: prepared.eventId,
        },
        error instanceof Error ? error : new Error(String(error)),
      );
      // The event row was already reset to received, which stays replayable,
      // so the operator can call replay again.
      throw new ServiceUnavailableException('replay could not be published');
    }
    this.logger.log({
      message: 'dead letter replayed',
      dlq_message_id: id,
      event_id: prepared.eventId,
      correlation_id: prepared.correlationId,
    });
    return {
      event_id: prepared.eventId,
      correlation_id: prepared.correlationId,
      status: 'replayed',
    };
  }

  private async prepare(
    manager: EntityManager,
    id: string,
  ): Promise<PreparedReplay> {
    const dead = await manager.findOne(DlqMessage, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!dead) {
      throw new NotFoundException('dead letter not found');
    }
    if (!dead.eventId) {
      // No event_id means the original payload never parsed; a redrive would
      // deterministically produce the same dead letter again.
      throw new ConflictException(
        'dead letter has no event id and cannot be replayed',
      );
    }
    const body = this.parseStoredMessage(dead);

    const event = await manager.findOne(Event, {
      where: { eventId: dead.eventId },
      lock: { mode: 'pessimistic_write' },
    });
    if (event && !REPLAYABLE_STATES.has(event.status)) {
      throw new ConflictException(
        `event is ${event.status} and cannot be replayed`,
      );
    }
    if (event) {
      // Full retry budget on redrive: the operator replays because the
      // downstream is believed fixed, so the attempt ladder starts over.
      await manager.update(
        Event,
        { eventId: dead.eventId },
        { status: EventStatus.Received, attempts: 0, failureReason: null },
      );
    }
    await manager.update(DlqMessage, { id }, { replayedAt: new Date() });
    return { eventId: dead.eventId, correlationId: dead.correlationId, body };
  }

  private parseStoredMessage(dead: DlqMessage): Record<string, unknown> {
    // A dead letter that carries an event_id always stored the original
    // message verbatim, so this only fails on a hand-crafted or corrupted
    // row. Refuse rather than fabricate a payload the producer never sent.
    if (dead.payload) {
      try {
        const parsed: unknown = JSON.parse(dead.payload);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // handled below
      }
    }
    throw new ConflictException(
      'stored payload is not the original message and cannot be replayed',
    );
  }
}
