import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalString, signRequest } from './hmac';

describe('hmac signer', () => {
  it('produces the canonical string the guard rebuilds', () => {
    expect(canonicalString('1700000000', '{"a":1}')).toBe(
      '1700000000.{"a":1}',
    );
  });

  it('matches an independent HMAC-SHA256 over ${ts}.${rawBody}', async () => {
    const secret = 'demo-hmac-secret-public';
    const rawBody = '{"event_id":"e1"}';
    const timestamp = 1700000000;
    const signed = await signRequest(secret, rawBody, timestamp);

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    expect(signed.signature).toBe(expected);
    expect(signed.canonical).toBe(`${timestamp}.${rawBody}`);
  });
});
