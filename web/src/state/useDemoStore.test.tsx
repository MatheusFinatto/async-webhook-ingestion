import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetrySocketHandlers } from '../lib/socket';
import type { TelemetryEnvelope } from '../lib/telemetry';

let captured: TelemetrySocketHandlers | null = null;
let createCount = 0;
const disconnect = vi.fn();

vi.mock('../lib/socket', () => ({
  createTelemetrySocket: (handlers: TelemetrySocketHandlers) => {
    captured = handlers;
    createCount += 1;
    return {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect,
    };
  },
}));

vi.mock('../lib/api', () => ({
  trigger: vi.fn(async () => ({
    correlationId: 'from-spec',
    eventId: 'e1',
    eventType: 'order.created',
    status: 202,
    ok: true,
    bodyText: '{}',
    body: { correlation_id: 'from-spec', status: 'accepted' },
    latencyMs: 12,
    signed: {
      timestamp: '1700000000',
      rawBody: '{}',
      canonical: '1700000000.{}',
      signature: 'abc',
    },
    apiStage: 'published',
    respondedCorrelationId: 'from-spec',
  })),
}));

import { useDemoStore } from './useDemoStore';

function env(correlationId: string): TelemetryEnvelope {
  return {
    version: 1,
    stage: 'processed',
    correlation_id: correlationId,
    event_id: 'e1',
    event_type: 'order.created',
    status: 'ok',
    attempts: 1,
    ts: '2026-07-10T12:00:00.000Z',
  };
}

describe('useDemoStore sequential scenarios', () => {
  beforeEach(() => {
    captured = null;
    createCount = 0;
    disconnect.mockClear();
  });

  it('holds the second duplicate request until the first ball settles', async () => {
    const { result } = renderHook(() => useDemoStore());

    let finished = false;
    let run: Promise<void>;
    act(() => {
      run = result.current.runScenario('duplicate').then(() => {
        finished = true;
      });
    });

    await waitFor(() => expect(result.current.state.order.length).toBe(1));
    expect(finished).toBe(false);

    const first = result.current.state.order[0];
    act(() => {
      result.current.notifySettled(first);
    });

    await waitFor(() => expect(result.current.state.order.length).toBe(2));
    await act(async () => {
      await run;
    });
    expect(result.current.state.order.length).toBe(2);
  });

  it('releases a pending settle wait on reset', async () => {
    const { result } = renderHook(() => useDemoStore());

    let run: Promise<void>;
    act(() => {
      run = result.current.runScenario('duplicate');
    });
    await waitFor(() => expect(result.current.state.order.length).toBe(1));

    act(() => {
      result.current.reset();
    });
    await act(async () => {
      await run;
    });
    expect(result.current.state.order.length).toBe(0);
  });
});

describe('useDemoStore reset', () => {
  beforeEach(() => {
    captured = null;
    createCount = 0;
    disconnect.mockClear();
  });

  it('clears tokens and counters without recreating the socket', async () => {
    const { result } = renderHook(() => useDemoStore());

    await act(async () => {
      await result.current.runScenario('happy');
    });
    await waitFor(() => expect(result.current.state.order.length).toBe(1));

    const correlationId = result.current.state.order[0];
    act(() => {
      captured?.onEnvelope(env(correlationId));
    });
    expect(result.current.state.counters.processed).toBe(1);

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.order).toHaveLength(0);
    expect(result.current.state.counters.processed).toBe(0);
    expect(createCount).toBe(1);
    expect(disconnect).not.toHaveBeenCalled();
  });
});
