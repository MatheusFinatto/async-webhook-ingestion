import type { TriggerResult } from '../lib/api';
import { colorFor } from '../lib/correlation';
import type { ScenarioId } from '../lib/scenarios';
import {
  isTerminal,
  STAGE_RANK,
  type Stage,
  type TelemetryEnvelope,
} from '../lib/telemetry';

export interface StageEvent {
  stage: Stage;
  ts: string;
  status?: string;
  attempts?: number;
}

export interface Token {
  correlationId: string;
  eventId: string | null;
  eventType: string;
  scenario: ScenarioId;
  label: string;
  color: string;
  stages: StageEvent[];
  currentStage: Stage;
  terminal: boolean;
  attempts: number;
  httpStatus?: number;
  httpBody?: unknown;
  latencyMs?: number;
  canonical?: string;
  signature?: string;
  rawBody?: string;
  signedTimestamp?: string;
  retryDeadline?: number;
  retryTier?: string;
}

export interface Counters {
  processed: number;
  duplicate: number;
  retry: number;
  dead: number;
}

export interface DemoState {
  tokens: Record<string, Token>;
  order: string[];
  counters: Counters;
  latencies: number[];
}

export const initialState: DemoState = {
  tokens: {},
  order: [],
  counters: { processed: 0, duplicate: 0, retry: 0, dead: 0 },
  latencies: [],
};

export interface TriggerStarted {
  type: 'trigger_started';
  correlationId: string;
  eventId: string | null;
  eventType: string;
  scenario: ScenarioId;
  label: string;
  ts: string;
}

export type Action =
  | TriggerStarted
  | { type: 'http_result'; scenario: ScenarioId; result: TriggerResult }
  | { type: 'envelope'; envelope: TelemetryEnvelope; now: number }
  | { type: 'reset' };

const RETRY_TTL: Record<string, number> = {
  '5s': 5000,
  '30s': 30000,
  '2min': 120000,
};

function retryTier(attempts: number): string {
  if (attempts <= 1) {
    return '5s';
  }
  if (attempts === 2) {
    return '30s';
  }
  return '2min';
}

function insertStage(stages: StageEvent[], event: StageEvent): StageEvent[] {
  const withoutSame = stages.filter(
    (existing) =>
      !(existing.stage === event.stage && existing.attempts === event.attempts),
  );
  const next = [...withoutSame, event];
  next.sort((a, b) => {
    const rankDelta = STAGE_RANK[a.stage] - STAGE_RANK[b.stage];
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return a.ts.localeCompare(b.ts);
  });
  return next;
}

function highestStage(stages: StageEvent[]): Stage {
  return stages.reduce((top, event) =>
    STAGE_RANK[event.stage] >= STAGE_RANK[top.stage] ? event : top,
  ).stage;
}

function withStage(token: Token, event: StageEvent): Token {
  const stages = insertStage(token.stages, event);
  const currentStage = highestStage(stages);
  return {
    ...token,
    stages,
    currentStage,
    terminal: isTerminal(currentStage),
    attempts: Math.max(token.attempts, event.attempts ?? token.attempts),
  };
}

export function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case 'trigger_started': {
      const token: Token = {
        correlationId: action.correlationId,
        eventId: action.eventId,
        eventType: action.eventType,
        scenario: action.scenario,
        label: action.label,
        color: colorFor(action.correlationId),
        stages: [{ stage: 'received', ts: action.ts }],
        currentStage: 'received',
        terminal: false,
        attempts: 0,
      };
      return {
        ...state,
        tokens: { ...state.tokens, [token.correlationId]: token },
        order: [...state.order, token.correlationId],
      };
    }
    case 'http_result': {
      const existing = state.tokens[action.result.correlationId];
      if (!existing) {
        return state;
      }
      const ts = new Date().toISOString();
      let token = existing;
      if (action.result.apiStage === 'published') {
        token = withStage(token, { stage: 'signature_verified', ts });
        token = withStage(token, { stage: 'published', ts });
      } else {
        token = withStage(token, {
          stage: action.result.apiStage,
          ts,
          status: String(action.result.status),
        });
      }
      token = {
        ...token,
        httpStatus: action.result.status,
        httpBody: action.result.body,
        latencyMs: action.result.latencyMs,
        canonical: action.result.signed.canonical,
        signature: action.result.signed.signature,
        rawBody: action.result.signed.rawBody,
        signedTimestamp: action.result.signed.timestamp,
      };
      const latencies =
        action.result.status === 202
          ? [...state.latencies, action.result.latencyMs]
          : state.latencies;
      return {
        ...state,
        tokens: { ...state.tokens, [token.correlationId]: token },
        latencies,
      };
    }
    case 'envelope': {
      const { envelope } = action;
      const existing = state.tokens[envelope.correlation_id];
      const counters = { ...state.counters };
      if (envelope.stage === 'processed') {
        counters.processed += 1;
      } else if (envelope.stage === 'duplicate') {
        counters.duplicate += 1;
      } else if (envelope.stage === 'retry') {
        counters.retry += 1;
      } else if (envelope.stage === 'dead') {
        counters.dead += 1;
      }
      if (!existing) {
        return { ...state, counters };
      }
      let token = withStage(existing, {
        stage: envelope.stage,
        ts: envelope.ts,
        status: envelope.status,
        attempts: envelope.attempts,
      });
      if (envelope.stage === 'retry') {
        const tier = retryTier(envelope.attempts);
        token = {
          ...token,
          retryTier: tier,
          retryDeadline: action.now + RETRY_TTL[tier],
        };
      } else {
        token = { ...token, retryDeadline: undefined, retryTier: undefined };
      }
      return {
        ...state,
        counters,
        tokens: { ...state.tokens, [token.correlationId]: token },
      };
    }
    case 'reset':
      return initialState;
    default:
      return state;
  }
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}
