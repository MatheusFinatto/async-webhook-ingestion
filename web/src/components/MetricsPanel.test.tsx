import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TelemetryEnvelope, WorkerStage } from '../lib/telemetry';
import { initialState, reducer, type Action } from '../state/reducer';
import { MetricsPanel } from './MetricsPanel';

function env(stage: WorkerStage): TelemetryEnvelope {
  return {
    version: 1,
    stage,
    correlation_id: 'c1',
    event_id: 'e1',
    event_type: 'order.created',
    status: 'ok',
    attempts: 0,
    ts: '2026-07-10T12:00:00.000Z',
  };
}

describe('MetricsPanel', () => {
  it('renders counters driven by a sequence of telemetry envelopes', () => {
    const actions: Action[] = [
      { type: 'envelope', envelope: env('processed'), now: 0 },
      { type: 'envelope', envelope: env('processed'), now: 0 },
      { type: 'envelope', envelope: env('duplicate'), now: 0 },
      { type: 'envelope', envelope: env('dead'), now: 0 },
    ];
    const state = actions.reduce(reducer, initialState);

    render(
      <MetricsPanel counters={state.counters} latencies={[10, 20, 30]} />,
    );

    expect(screen.getByText('processed').previousSibling).toHaveTextContent(
      '2',
    );
    expect(screen.getByText('dead').previousSibling).toHaveTextContent('1');
    expect(screen.getByText('client-side')).toBeInTheDocument();
    expect(screen.getByText(/p50/)).toBeInTheDocument();
    expect(screen.getByText(/n 3/)).toBeInTheDocument();
  });
});
