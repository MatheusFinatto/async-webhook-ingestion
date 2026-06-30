function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function canonicalString(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message),
  );
  return toHex(signature);
}

export interface SignedRequest {
  timestamp: string;
  rawBody: string;
  canonical: string;
  signature: string;
}

export async function signRequest(
  secret: string,
  rawBody: string,
  timestampSeconds: number,
): Promise<SignedRequest> {
  const timestamp = String(timestampSeconds);
  const canonical = canonicalString(timestamp, rawBody);
  const signature = await hmacSha256Hex(secret, canonical);
  return { timestamp, rawBody, canonical, signature };
}
