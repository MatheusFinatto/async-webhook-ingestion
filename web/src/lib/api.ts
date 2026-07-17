import { config } from './config';
import { signRequest, type SignedRequest } from './hmac';
import type { TriggerSpec } from './scenarios';
import type { ApiStage } from './telemetry';

export interface TriggerResult {
  correlationId: string;
  eventId: string | null;
  eventType: string;
  status: number;
  ok: boolean;
  bodyText: string;
  body: unknown;
  latencyMs: number;
  signed: SignedRequest;
  apiStage: ApiStage;
  respondedCorrelationId: string | null;
}

export function apiStageForStatus(status: number): ApiStage {
  if (status === 202) {
    return 'published';
  }
  if (status === 400) {
    return 'malformed';
  }
  if (status === 503) {
    return 'unavailable';
  }
  return 'rejected';
}

export async function trigger(spec: TriggerSpec): Promise<TriggerResult> {
  const rawBody = JSON.stringify(spec.body);
  const timestamp =
    spec.timestampOverride ?? Math.floor(Date.now() / 1000);
  const secret = spec.secretOverride ?? config.hmacSecret;
  const signed = await signRequest(secret, rawBody, timestamp);

  const started = performance.now();
  const response = await fetch(`${config.apiUrl}/webhooks/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': signed.signature,
      'x-timestamp': signed.timestamp,
      'x-correlation-id': spec.correlationId,
    },
    body: rawBody,
  });
  const latencyMs = performance.now() - started;

  const bodyText = await response.text();
  let body: unknown = bodyText;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText;
  }

  const respondedCorrelationId =
    response.headers.get('x-correlation-id') ??
    (isRecord(body) && typeof body.correlation_id === 'string'
      ? body.correlation_id
      : null);

  return {
    correlationId: spec.correlationId,
    eventId: spec.eventId,
    eventType: spec.eventType,
    status: response.status,
    ok: response.ok,
    bodyText,
    body,
    latencyMs,
    signed,
    apiStage: apiStageForStatus(response.status),
    respondedCorrelationId,
  };
}

export async function injectPoison(spec: TriggerSpec): Promise<TriggerResult> {
  const started = performance.now();
  const response = await fetch(`${config.apiUrl}/demo/poison`, {
    method: 'POST',
    headers: { 'x-correlation-id': spec.correlationId },
  });
  const latencyMs = performance.now() - started;

  const bodyText = await response.text();
  let body: unknown = bodyText;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText;
  }

  return {
    correlationId: spec.correlationId,
    eventId: null,
    eventType: spec.eventType,
    status: response.status,
    ok: response.ok,
    bodyText,
    body,
    latencyMs,
    signed: { timestamp: '', rawBody: '', canonical: '', signature: '' },
    apiStage: response.ok ? 'injected' : 'unavailable',
    respondedCorrelationId:
      isRecord(body) && typeof body.correlation_id === 'string'
        ? body.correlation_id
        : null,
  };
}

export interface DlqEntry {
  id: string;
  messageId: string | null;
  correlationId: string;
  eventId: string | null;
  reason: string;
  attempts: number;
  payload: string | null;
  createdAt: string;
  replayedAt: string | null;
}

export interface DlqPage {
  data: DlqEntry[];
  page: number;
  limit: number;
  total: number;
}

export async function fetchDlq(): Promise<DlqPage> {
  const response = await fetch(`${config.apiUrl}/dlq`, {
    headers: { 'x-admin-key': config.adminKey },
  });
  if (!response.ok) {
    throw new Error(`GET /dlq failed with ${response.status}`);
  }
  return (await response.json()) as DlqPage;
}

export interface ReplayReceipt {
  event_id: string;
  correlation_id: string;
  status: string;
}

export async function discardDlq(id: string): Promise<void> {
  const response = await fetch(`${config.apiUrl}/dlq/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': config.adminKey },
  });
  if (!response.ok) {
    throw new Error(`DELETE /dlq/${id} failed with ${response.status}`);
  }
}

export async function replayDlq(id: string): Promise<ReplayReceipt> {
  const response = await fetch(`${config.apiUrl}/dlq/${id}/replay`, {
    method: 'POST',
    headers: { 'x-admin-key': config.adminKey },
  });
  if (!response.ok) {
    throw new Error(`replay failed with ${response.status}`);
  }
  return (await response.json()) as ReplayReceipt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
