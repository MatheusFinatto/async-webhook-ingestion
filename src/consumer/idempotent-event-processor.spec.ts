import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Event } from '../events/entities/event.entity';
import { EventStatus } from '../events/event-status.enum';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import { HandledEvent, OrderHandler } from './order-handler';
import { IdempotentEventProcessor } from './idempotent-event-processor';
import {
  PermanentProcessingError,
  TransientProcessingError,
} from './processing-errors';

const event: HandledEvent = {
  eventId: 'evt-1',
  eventType: 'order.created',
  correlationId: 'corr-1',
  payload: { amount: 1 },
};

function makeProcessor(opts: {
  claimed: boolean;
  row: Partial<Event> | null;
  maxAttempts?: number;
  handle?: jest.Mock;
}): {
  processor: IdempotentEventProcessor;
  handle: jest.Mock;
  increment: jest.Mock;
  update: jest.Mock;
} {
  const handle = opts.handle ?? jest.fn().mockResolvedValue(undefined);
  const increment = jest.fn().mockResolvedValue(undefined);
  const update = jest.fn().mockResolvedValue(undefined);

  const insertBuilder = {
    insert: () => insertBuilder,
    into: () => insertBuilder,
    values: () => insertBuilder,
    orIgnore: () => insertBuilder,
    execute: () =>
      Promise.resolve({ raw: opts.claimed ? [{ id: 'new' }] : [] }),
  };
  const selectBuilder = {
    setLock: () => selectBuilder,
    where: () => selectBuilder,
    getOne: () => Promise.resolve(opts.row),
  };
  const manager = {
    createQueryBuilder: (entity?: unknown) =>
      entity ? selectBuilder : insertBuilder,
    increment,
    update,
  };
  const dataSource = {
    transaction: (run: (m: unknown) => Promise<unknown>) => run(manager),
  } as unknown as DataSource;
  const handler = { handle } as unknown as OrderHandler;
  const telemetry = { emit: jest.fn() } as unknown as TelemetryEmitter;
  const config = {
    get: () => String(opts.maxAttempts ?? 4),
  } as unknown as ConfigService;

  return {
    processor: new IdempotentEventProcessor(
      dataSource,
      handler,
      telemetry,
      config,
    ),
    handle,
    increment,
    update,
  };
}

describe('IdempotentEventProcessor', () => {
  it('processes a freshly claimed event and advances it to processed', async () => {
    const { processor, handle } = makeProcessor({
      claimed: true,
      row: { status: EventStatus.Received, attempts: 0 },
    });

    const decision = await processor.process(event, { isContinuation: false });

    expect(decision).toEqual({ kind: 'processed', attempts: 1 });
    expect(handle).toHaveBeenCalledWith(event, 1);
  });

  it('retries a transient failure while attempts remain', async () => {
    const { processor, update } = makeProcessor({
      claimed: true,
      row: { status: EventStatus.Received, attempts: 0 },
      maxAttempts: 4,
      handle: jest
        .fn()
        .mockRejectedValue(new TransientProcessingError('flaky')),
    });

    const decision = await processor.process(event, { isContinuation: false });

    expect(decision).toEqual({ kind: 'retry', attempts: 1 });
    // Records the reason without settling the row as failed.
    expect(update).toHaveBeenLastCalledWith(
      Event,
      { eventId: 'evt-1' },
      { failureReason: 'flaky' },
    );
  });

  it('dead-letters a transient failure once attempts reach the ceiling', async () => {
    const { processor } = makeProcessor({
      claimed: false,
      row: { status: EventStatus.Processing, attempts: 3 },
      maxAttempts: 4,
      handle: jest
        .fn()
        .mockRejectedValue(new TransientProcessingError('flaky')),
    });

    const decision = await processor.process(event, { isContinuation: true });

    expect(decision).toEqual({ kind: 'dead', attempts: 4, reason: 'flaky' });
  });

  it('dead-letters a permanent failure immediately, ignoring the ceiling', async () => {
    const { processor } = makeProcessor({
      claimed: true,
      row: { status: EventStatus.Received, attempts: 0 },
      maxAttempts: 4,
      handle: jest
        .fn()
        .mockRejectedValue(new PermanentProcessingError('poison')),
    });

    const decision = await processor.process(event, { isContinuation: false });

    expect(decision).toEqual({ kind: 'dead', attempts: 1, reason: 'poison' });
  });

  it('treats a redelivery of a processed event as a duplicate', async () => {
    const { processor, handle, increment } = makeProcessor({
      claimed: false,
      row: { status: EventStatus.Processed, attempts: 2 },
    });

    const decision = await processor.process(event, { isContinuation: false });

    expect(decision).toEqual({ kind: 'duplicate', attempts: 2 });
    expect(handle).not.toHaveBeenCalled();
    expect(increment).toHaveBeenCalledWith(
      Event,
      { eventId: 'evt-1' },
      'duplicateCount',
      1,
    );
  });

  it('treats a redelivery of a dead event as a duplicate', async () => {
    const { processor, handle } = makeProcessor({
      claimed: false,
      row: { status: EventStatus.Dead, attempts: 4 },
    });

    const decision = await processor.process(event, { isContinuation: false });

    expect(decision).toEqual({ kind: 'duplicate', attempts: 4 });
    expect(handle).not.toHaveBeenCalled();
  });

  it('re-emits a dead decision for an event stuck in failed', async () => {
    const { processor, handle } = makeProcessor({
      claimed: false,
      row: {
        status: EventStatus.Failed,
        attempts: 3,
        failureReason: 'dlx publish lost',
      },
    });

    const decision = await processor.process(event, { isContinuation: false });

    expect(decision).toEqual({
      kind: 'dead',
      attempts: 3,
      reason: 'dlx publish lost',
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('records a lost race (no claim, not a continuation) as a duplicate', async () => {
    const { processor, handle, increment } = makeProcessor({
      claimed: false,
      row: { status: EventStatus.Received, attempts: 0 },
    });

    const decision = await processor.process(event, { isContinuation: false });

    expect(decision).toEqual({ kind: 'duplicate', attempts: 0 });
    expect(handle).not.toHaveBeenCalled();
    expect(increment).toHaveBeenCalled();
  });

  it('processes a continuation redelivery even without winning the claim', async () => {
    const { processor, handle } = makeProcessor({
      claimed: false,
      row: { status: EventStatus.Processing, attempts: 1 },
    });

    const decision = await processor.process(event, { isContinuation: true });

    expect(decision).toEqual({ kind: 'processed', attempts: 2 });
    expect(handle).toHaveBeenCalledWith(event, 2);
  });
});
