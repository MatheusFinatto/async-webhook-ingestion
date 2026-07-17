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

export type StoryTone = 'info' | 'ok' | 'retry' | 'fail';

export interface StoryStep {
  tone: StoryTone;
  text: string;
}

export interface ScenarioDef {
  id: ScenarioId;
  label: string;
  description: string;
  story: StoryStep[];
  expected: string;
  sequential?: boolean;
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
    story: [
      { tone: 'info', text: 'Partner marketplace fires order.created for a fresh sale' },
      { tone: 'ok', text: 'HMAC-SHA256 signature matches' },
      { tone: 'info', text: '202 accepted, queued in RabbitMQ' },
      { tone: 'info', text: 'Worker checks: event_id never seen before' },
      { tone: 'ok', text: 'Order inserted into PostgreSQL' },
    ],
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
    story: [
      { tone: 'info', text: 'Attacker (or partner with a rotated key) posts an order' },
      { tone: 'fail', text: 'Guard computes a different HMAC-SHA256' },
      { tone: 'fail', text: '401 rejected at the front door' },
      { tone: 'info', text: 'Nothing reaches the queue or the database' },
    ],
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
    story: [
      { tone: 'info', text: 'A real webhook is captured and resent 10 minutes later' },
      { tone: 'info', text: 'Classic replay attack: valid signature, old request' },
      { tone: 'fail', text: 'Guard only accepts timestamps from the last 5 minutes' },
      { tone: 'fail', text: '401 rejected' },
    ],
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
    description:
      'Same event_id twice: second fires after the first lands → processed + discarded',
    story: [
      { tone: 'info', text: 'Our 202 got lost in the network, marketplace retries' },
      { tone: 'info', text: 'Same order arrives twice, both get 202' },
      { tone: 'info', text: 'Worker finds the event_id already in PostgreSQL' },
      { tone: 'ok', text: 'Second delivery discarded: idempotency, no double order' },
    ],
    expected: '202 / 202',
    sequential: true,
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
    story: [
      { tone: 'fail', text: 'Processing fails: the database blinked for a moment' },
      { tone: 'retry', text: 'Retry in 5s, fails again' },
      { tone: 'retry', text: 'Retry in 30s' },
      { tone: 'ok', text: 'Third attempt succeeds, order lands as if nothing happened' },
    ],
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
    story: [
      { tone: 'fail', text: 'An error that no amount of retrying can fix' },
      { tone: 'info', text: 'Retrying forever would just burn the queue' },
      { tone: 'fail', text: 'Parked straight into the dead-letter queue' },
      { tone: 'info', text: 'A human inspects and replays it from the DLQ panel' },
    ],
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
    story: [
      { tone: 'info', text: 'Trusted partner ships a buggy integration' },
      { tone: 'ok', text: 'Signature is valid, the guard lets it through' },
      { tone: 'fail', text: 'But the body is missing event_id' },
      { tone: 'fail', text: '400 at the validation pipe, nothing published' },
    ],
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
