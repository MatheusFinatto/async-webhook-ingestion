import { newCorrelationId, newEventId } from './correlation';

export type ScenarioId =
  | 'happy'
  | 'invalid_signature'
  | 'stale_timestamp'
  | 'duplicate'
  | 'transient'
  | 'permanent'
  | 'malformed';

export interface TriggerSpec {
  correlationId: string;
  eventId: string | null;
  eventType: string;
  body: Record<string, unknown>;
  secretOverride?: string;
  timestampOverride?: number;
  label: string;
}

export interface ScenarioDef {
  id: ScenarioId;
  label: string;
  description: string;
  expected: string;
  build: () => TriggerSpec[];
}

const EVENT_TYPE = 'order.created';

function orderBody(
  eventId: string,
  extraPayload: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    event_id: eventId,
    event_type: EVENT_TYPE,
    payload: { amount: 4200, currency: 'BRL', ...extraPayload },
  };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'happy',
    label: 'Happy path',
    description: 'Valid signature → 202 → processed',
    expected: '202',
    build: () => {
      const eventId = newEventId();
      return [
        {
          correlationId: newCorrelationId(),
          eventId,
          eventType: EVENT_TYPE,
          body: orderBody(eventId),
          label: 'Happy path',
        },
      ];
    },
  },
  {
    id: 'invalid_signature',
    label: 'Invalid signature',
    description: 'Wrong secret → 401, nothing published',
    expected: '401',
    build: () => {
      const eventId = newEventId();
      return [
        {
          correlationId: newCorrelationId(),
          eventId,
          eventType: EVENT_TYPE,
          body: orderBody(eventId),
          secretOverride: 'wrong-secret',
          label: 'Invalid signature',
        },
      ];
    },
  },
  {
    id: 'stale_timestamp',
    label: 'Stale timestamp',
    description: 'Timestamp outside the window → 401',
    expected: '401',
    build: () => {
      const eventId = newEventId();
      return [
        {
          correlationId: newCorrelationId(),
          eventId,
          eventType: EVENT_TYPE,
          body: orderBody(eventId),
          timestampOverride: Math.floor(Date.now() / 1000) - 600,
          label: 'Stale timestamp',
        },
      ];
    },
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    description: 'Same event_id twice, distinct correlation_id → processed + duplicate',
    expected: '202 / 202',
    build: () => {
      const eventId = newEventId();
      const body = orderBody(eventId);
      return [
        {
          correlationId: newCorrelationId(),
          eventId,
          eventType: EVENT_TYPE,
          body,
          label: 'Duplicate (first)',
        },
        {
          correlationId: newCorrelationId(),
          eventId,
          eventType: EVENT_TYPE,
          body,
          label: 'Duplicate (second)',
        },
      ];
    },
  },
  {
    id: 'transient',
    label: 'Transient failure',
    description: 'Fails attempts 1–2, succeeds on 3 → retry ladder 5s→30s',
    expected: '202',
    build: () => {
      const eventId = newEventId();
      return [
        {
          correlationId: newCorrelationId(),
          eventId,
          eventType: EVENT_TYPE,
          body: orderBody(eventId, { __scenario: 'transient' }),
          label: 'Transient failure',
        },
      ];
    },
  },
  {
    id: 'permanent',
    label: 'Permanent failure',
    description: 'Permanent error → straight to the DLQ',
    expected: '202',
    build: () => {
      const eventId = newEventId();
      return [
        {
          correlationId: newCorrelationId(),
          eventId,
          eventType: EVENT_TYPE,
          body: orderBody(eventId, { __scenario: 'permanent' }),
          label: 'Permanent failure',
        },
      ];
    },
  },
  {
    id: 'malformed',
    label: 'Malformed',
    description: 'Missing event_id, validly signed → 400 at the validation pipe',
    expected: '400',
    build: () => {
      return [
        {
          correlationId: newCorrelationId(),
          eventId: null,
          eventType: EVENT_TYPE,
          body: {
            event_type: EVENT_TYPE,
            payload: { amount: 4200, currency: 'BRL' },
          },
          label: 'Malformed',
        },
      ];
    },
  },
];
