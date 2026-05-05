# Async Webhook Ingestion

Receives order webhooks from marketplace partners and processes them asynchronously.
The HTTP endpoint checks the signature, hands the event to RabbitMQ and returns right
away. Workers do the actual processing, so a slow downstream never blocks a partner's
request.

Work in progress.

## What it does

- Checks an HMAC-SHA256 signature over the raw body, with a replay window and a timing-safe compare.
- Publishes with publisher confirms: returns `202` once the broker acks, `503` if it doesn't. Nothing touches Postgres on the hot path.
- Idempotent consumer: a repeated `event_id` takes effect exactly once, even under concurrent delivery, thanks to a transactional insert on a unique index.
- Durable topology with retry (5s / 30s / 2min) and dead-letter queues.
- Reversible migrations.

## Stack

NestJS · PostgreSQL · RabbitMQ · Docker Compose

## Running

```bash
docker compose up
```

## Still to do

- DLQ inspection endpoint
- `correlation_id` in structured logs, end to end
- Write up the design decisions (RabbitMQ vs BullMQ, Postgres as the idempotency store)
