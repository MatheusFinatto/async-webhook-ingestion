import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { WebhookSignatureGuard } from './webhook-signature.guard';

const SECRET = 'test-secret';
const TOLERANCE = '300';

function config(): ConfigService {
  return {
    get: (key: string) =>
      ({
        WEBHOOK_HMAC_SECRET: SECRET,
        WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: TOLERANCE,
      })[key],
  } as unknown as ConfigService;
}

function sign(timestamp: string, rawBody: string): string {
  return createHmac('sha256', SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

function contextFor(
  headers: Record<string, string>,
  rawBody: string,
): ExecutionContext {
  const request = { headers, rawBody: Buffer.from(rawBody, 'utf8') };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('WebhookSignatureGuard', () => {
  const guard = new WebhookSignatureGuard(config());
  const body = JSON.stringify({ event_id: 'evt-1' });

  it('accepts a valid signature within the replay window', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const ctx = contextFor(
      { 'x-timestamp': ts, 'x-signature': sign(ts, body) },
      body,
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects when the signature header is missing', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const ctx = contextFor({ 'x-timestamp': ts }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when the timestamp header is missing', () => {
    const ctx = contextFor({ 'x-signature': 'deadbeef' }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects an invalid signature', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const ctx = contextFor(
      { 'x-timestamp': ts, 'x-signature': sign(ts, 'tampered') },
      body,
    );
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a timestamp outside the replay window', () => {
    const stale = String(Math.floor(Date.now() / 1000) - 10_000);
    const ctx = contextFor(
      { 'x-timestamp': stale, 'x-signature': sign(stale, body) },
      body,
    );
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a signature of unexpected length without a RangeError', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const ctx = contextFor({ 'x-timestamp': ts, 'x-signature': 'abc' }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('refuses to construct without a secret instead of running fail-open', () => {
    const empty = { get: () => undefined } as unknown as ConfigService;
    expect(() => new WebhookSignatureGuard(empty)).toThrow(
      /WEBHOOK_HMAC_SECRET/,
    );
  });
});
