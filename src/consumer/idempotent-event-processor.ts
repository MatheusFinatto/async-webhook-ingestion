import { Injectable } from '@nestjs/common';
import { DataSource, QueryDeepPartialEntity } from 'typeorm';
import { Event } from '../events/entities/event.entity';
import { EventStatus } from '../events/event-status.enum';

export interface IncomingEvent {
  eventId: string;
  eventType: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

export type ProcessOutcome = 'processed' | 'duplicate';

@Injectable()
export class IdempotentEventProcessor {
  constructor(private readonly dataSource: DataSource) {}

  async process(event: IncomingEvent): Promise<ProcessOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const claim = await manager
        .createQueryBuilder()
        .insert()
        .into(Event)
        .values({
          eventId: event.eventId,
          eventType: event.eventType,
          correlationId: event.correlationId,
          payload: event.payload,
          status: EventStatus.Received,
        } as QueryDeepPartialEntity<Event>)
        .orIgnore()
        .execute();

      const claimed = Array.isArray(claim.raw) && claim.raw.length > 0;
      if (!claimed) {
        await manager.increment(
          Event,
          { eventId: event.eventId },
          'duplicateCount',
          1,
        );
        return 'duplicate';
      }

      await manager.update(
        Event,
        { eventId: event.eventId },
        { status: EventStatus.Processing },
      );
      await manager.update(
        Event,
        { eventId: event.eventId },
        { status: EventStatus.Processed },
      );
      return 'processed';
    });
  }
}
