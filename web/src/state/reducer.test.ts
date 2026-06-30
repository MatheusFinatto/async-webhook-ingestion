import { describe, expect, it } from 'vitest';
import type { TelemetryEnvelope, WorkerStage } from '../lib/telemetry';
import {
  initialState,
  percentile,
  reducer,
  type Action,
  type DemoState,
} from './reducer';

function env(
  stage: WorkerStage,
  over: Partial<TelemetryEnvelope> = {},
): TelemetryEnvelope {
  return {
    version: 1,
    stage,
    correlation_id: 'c1',
    event_id: 'e1',
    event_type: 'order.created',
    status: 'ok',
    attempts: 0,
    ts: '2026-07-10T12:00:00.000Z',
    ...over,
  };
}

function run(actions: Action[], from: DemoState = initialState): DemoState {
  return actions.reduce(reducer, from);
}

const started: Action = {
  type: 'trigger_started',
  correlationId: 'c1',
  eventId: 'e1',
  eventType: 'order.created',
  scenario: 'happy',
  label: 'Happy path',
  ts: '2026-07-10T12:00:00.000Z',
};

describe('reducer counters', () => {
  it('increments each counter as worker stages arrive', () => {
    const state = run([
      { type: 'envelope', envelope: env('processed'), now: 0 },
      { type: 'envelope', envelope: env('duplicate'), now: 0 },
      { type: 'envelope', envelope: env('retry', { attempts: 1 }), now: 0 },
      { type: 'envelope', envelope: env('dead'), now: 0 },
    ]);
    expect(state.counters).toEqual({
      processed: 1,
      duplicate: 1,
      retry: 1,
      dead: 1,
    });
  });
});

describe('reducer stage ordering', () => {
  it('keeps the highest-rank stage even when envelopes arrive out of order', () => {
    const state = run([
      started,
      { type: 'envelope', envelope: env('consuming'), now: 0 },
      { type: 'envelope', envelope: env('published' as WorkerStage), now: 0 },
    ]);
    expect(state.tokens.c1.currentStage).toBe('consuming');
  });

  it('does not fabricate a stage that never arrived', () => {
    const state = run([started]);
    expect(state.tokens.c1.currentStage).toBe('received');
    expect(state.tokens.c1.terminal).toBe(false);
  });

  it('marks a token terminal on processed', () => {
    const state = run([
      started,
      { type: 'envelope', envelope: env('processed'), now: 0 },
    ]);
    expect(state.tokens.c1.currentStage).toBe('processed');
    expect(state.tokens.c1.terminal).toBe(true);
  });
});

describe('reducer retry', () => {
  it('sets a display-only countdown deadline from the tier', () => {
    const state = run([
      started,
      { type: 'envelope', envelope: env('retry', { attempts: 1 }), now: 1000 },
    ]);
    expect(state.tokens.c1.retryTier).toBe('5s');
    expect(state.tokens.c1.retryDeadline).toBe(6000);
  });
});

describe('reducer reset', () => {
  it('clears tokens, counters and latencies', () => {
    const dirty = run([
      started,
      { type: 'envelope', envelope: env('processed'), now: 0 },
    ]);
    expect(reducer(dirty, { type: 'reset' })).toEqual(initialState);
  });
});

describe('percentile', () => {
  it('returns null for an empty set', () => {
    expect(percentile([], 95)).toBeNull();
  });

  it('computes p50 and p95', () => {
    const values = [10, 20, 30, 40, 50];
    expect(percentile(values, 50)).toBe(30);
    expect(percentile(values, 95)).toBe(50);
  });
});
