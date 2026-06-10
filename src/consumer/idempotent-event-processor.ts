import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryDeepPartialEntity } from 'typeorm';
import { Event } from '../events/entities/event.entity';
import { EventStatus } from '../events/event-status.enum';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import { HandledEvent, OrderHandler } from './order-handler';
import { PermanentProcessingError } from './processing-errors';

export type ProcessDecision =
  | { kind: 'processed'; attempts: number }
  | { kind: 'duplicate'; attempts: number }
  | { kind: 'retry'; attempts: number }
  | { kind: 'dead'; attempts: number; reason: string };

export interface ProcessContext {
  isContinuation: boolean;
}

function isTerminal(status: EventStatus): boolean {
  return (
    status === EventStatus.Processed ||
    status === EventStatus.Failed ||
    status === EventStatus.Dead
  );
}

@Injectable()
export class IdempotentEventProcessor {
  private readonly maxAttempts: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly handler: OrderHandler,
    private readonly telemetry: TelemetryEmitter,
    config: ConfigService,
  ) {
    this.maxAttempts = Number(
      config.get<string>('MAX_PROCESSING_ATTEMPTS') ?? 3,
    );
  }

  async process(
    event: HandledEvent,
    context: ProcessContext,
  ): Promise<ProcessDecision> {
    const decision = await this.claimAndHandle(event, context);
    this.emit(event, decision);
    return decision;
  }

  private emit(event: HandledEvent, decision: ProcessDecision): void {
    if (decision.kind === 'dead') {
      return;
    }
    const status =
      decision.kind === 'processed'
        ? EventStatus.Processed
        : decision.kind === 'duplicate'
          ? EventStatus.Processed
          : EventStatus.Processing;
    this.telemetry.emit({
      stage: decision.kind,
      correlationId: event.correlationId,
      eventId: event.eventId,
      eventType: event.eventType,
      status,
      attempts: decision.attempts,
    });
  }

  private async claimAndHandle(
    event: HandledEvent,
    context: ProcessContext,
  ): Promise<ProcessDecision> {
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

      const row = await manager
        .createQueryBuilder(Event, 'e')
        .setLock('pessimistic_write')
        .where('e.eventId = :eventId', { eventId: event.eventId })
        .getOne();
      if (!row) {
        throw new Error(`event row missing after claim: ${event.eventId}`);
      }

      if (isTerminal(row.status)) {
        await manager.increment(
          Event,
          { eventId: event.eventId },
          'duplicateCount',
          1,
        );
        return { kind: 'duplicate', attempts: row.attempts };
      }

      if (!claimed && !context.isContinuation) {
        await manager.increment(
          Event,
          { eventId: event.eventId },
          'duplicateCount',
          1,
        );
        return { kind: 'duplicate', attempts: row.attempts };
      }

      const attempts = row.attempts + 1;
      await manager.update(
        Event,
        { eventId: event.eventId },
        { status: EventStatus.Processing, attempts },
      );

      try {
        await this.handler.handle(event, attempts);
      } catch (error) {
        const permanent = error instanceof PermanentProcessingError;
        const reason = error instanceof Error ? error.message : String(error);
        if (permanent || attempts >= this.maxAttempts) {
          await manager.update(
            Event,
            { eventId: event.eventId },
            { status: EventStatus.Failed, failureReason: reason },
          );
          return { kind: 'dead', attempts, reason };
        }
        await manager.update(
          Event,
          { eventId: event.eventId },
          { failureReason: reason },
        );
        return { kind: 'retry', attempts };
      }

      await manager.update(
        Event,
        { eventId: event.eventId },
        { status: EventStatus.Processed, failureReason: null },
      );
      return { kind: 'processed', attempts };
    });
  }
}
