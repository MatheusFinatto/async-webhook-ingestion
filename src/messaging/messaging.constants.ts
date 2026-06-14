export const WEBHOOK_EXCHANGE = 'webhooks';
export const RETRY_EXCHANGE = 'webhooks.retry';
export const DEAD_LETTER_EXCHANGE = 'webhooks.dlx';
export const TELEMETRY_EXCHANGE = 'webhook.telemetry';

export const TELEMETRY_ENVELOPE_VERSION = 1;
export const TELEMETRY_BINDING_KEY = 'telemetry.*';

export function telemetryRoutingKey(stage: string): string {
  return `telemetry.${stage}`;
}

export const ORDER_RECEIVED_ROUTING_KEY = 'orders.received';
export const DEAD_LETTER_ROUTING_KEY = 'orders.dead';

export const WORK_QUEUE = 'webhooks.orders';
export const DEAD_LETTER_QUEUE = 'webhooks.dead';

export const ATTEMPT_HEADER = 'x-attempt';

export interface RetryTier {
  queue: string;
  routingKey: string;
  ttlMs: number;
}

export const RETRY_TIERS: RetryTier[] = [
  { queue: 'webhooks.retry.5s', routingKey: 'orders.retry.5s', ttlMs: 5_000 },
  {
    queue: 'webhooks.retry.30s',
    routingKey: 'orders.retry.30s',
    ttlMs: 30_000,
  },
  {
    queue: 'webhooks.retry.2m',
    routingKey: 'orders.retry.2m',
    ttlMs: 120_000,
  },
];

export function retryTierForAttempt(attempts: number): RetryTier {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_TIERS.length - 1);
  return RETRY_TIERS[index];
}
