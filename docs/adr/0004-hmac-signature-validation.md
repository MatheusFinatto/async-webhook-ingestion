# 4. HMAC-SHA256 with a timing-safe comparison at the boundary

- Status: Accepted
- Date: 2026-05-08

## Context

Webhook deliveries arrive from marketplace partners over the public internet. The
endpoint has to authenticate each one: only a partner holding the shared secret should
be able to get an event onto the queue.

Two approaches were on the table:

- **A static token** in a header, compared against a known value.
- **An HMAC-SHA256 signature** of the request body, sent in a header and recomputed on
  the server.

A signature also has to be checked carefully. A naive string compare returns as soon as
two bytes differ, and that timing difference leaks how much of the signature was correct
, a timing oracle an attacker can walk toward a valid value.

## Decision

Verify an HMAC-SHA256 signature over the raw request body, compared in constant time,
before anything is published.

- **The signature covers the raw bytes.** The guard reads the unparsed body
  (`rawBody: true` at bootstrap). Re-serializing the parsed JSON would change whitespace
  and key order and break the signature, so the raw buffer is what gets hashed.
- **The timestamp is inside the HMAC.** The signed value is `"${timestamp}.${rawBody}"`,
  and a delivery whose timestamp is outside the tolerance window is rejected. That closes
  a replay of a captured-but-valid request without a nonce store, and idempotency
  neutralises any replay that slips inside the window.
- **The comparison is constant-time.** Both sides are hashed to a fixed 32-byte digest
  and compared with `crypto.timingSafeEqual`. Hashing first matters: `timingSafeEqual`
  throws on buffers of different length, and the incoming length is attacker-controlled,
  so comparing the raw signatures would itself leak length and could throw. Fixed-size
  digests remove both problems.
- **Validation runs before the broker.** A bad or missing signature is rejected at the
  guard; an invalid delivery never touches RabbitMQ.

## Consequences

- Authentication is cryptographic and body-bound: a signature is valid only for the
  exact bytes it was computed over, so a tampered payload fails.
- A missing, stale, or invalid signature is rejected with `401` at the boundary, at the
  cost of a little more logic than a static token compare. (The `401`-vs-`403` split lives
  on the admin-key guard for the DLQ endpoints, not here.)
- Reading the raw body requires the `rawBody` bootstrap option and a body-size limit so
  the HMAC never runs over an unbounded payload; both are wired in the ingestion path.
- The shared secret is symmetric: rotating it is a coordinated change with each partner.
  Asymmetric signatures were out of scope for this project.
