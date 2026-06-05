# 3. PostgreSQL as the idempotency store

- Status: Accepted
- Date: 2026-05-08

## Context

Delivery is at-least-once, so the same `event_id` can be consumed more than once,
after a partner retry, after a redelivery, or when two workers happen to pick up
duplicate copies at the same moment. The system must process each `event_id` exactly
once and record the rest as duplicates.

The hard case is concurrency: two consumers processing the same `event_id` in parallel.
A `SELECT` to check whether it exists followed by an `INSERT` is the classic race: both
reads miss, both insert, and the event is processed twice.

Two stores were considered:

- **Redis `SETNX`** on the `event_id` as a dedup lock.
- **A PostgreSQL table** with a unique constraint on `event_id`.

## Decision

Use PostgreSQL, and let the database settle the race.

- **The unique index is the arbiter.** The worker runs
  `INSERT ... ON CONFLICT (event_id) DO NOTHING` inside a transaction. The winner of the
  conflict advances the row through its states and acks; the loser sees no insert, reads
  the already-processed row, increments a duplicate counter, and acks safely. There is no
  check-then-insert window because the check *is* the insert.
- **The guarantee lives in the transaction, not in application coordination.** A crash
  before commit rolls back, and redelivery re-claims the work cleanly. No distributed
  lock, no lease to renew.
- **The same table is the audit trail.** Status, attempt count, failure reason, and
  timestamps are queryable as a side effect of storing the idempotency key, with no extra
  store to keep in sync.

## Consequences

- Deduplication is one round-trip to a database already in the stack. Redis is not added
  just to hold locks.
- The hot path stays off PostgreSQL: the API publishes and returns, and the first write
  happens in the worker. Idempotency is a worker concern, which is what makes the
  concurrent-consumer race real instead of hypothetical: if the API deduplicated at the
  edge, the second delivery would never reach a competing consumer.
- A relational write per event is heavier than a Redis `SETNX`. For webhook volumes that
  is an acceptable cost, in exchange for ACID guarantees and the audit trail.
- Correctness leans on one unique index. That constraint and the transaction boundary are
  critical and are covered directly by the concurrent-delivery tests.
