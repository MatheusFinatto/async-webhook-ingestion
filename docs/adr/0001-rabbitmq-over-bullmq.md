# 1. RabbitMQ over BullMQ for the message transport

- Status: Accepted
- Date: 2026-05-08

## Context

The system has to decouple webhook reception from processing: the HTTP endpoint
accepts a delivery, hands it off, and returns before any downstream work runs. That
needs a broker between the API and the worker.

Two options fit the Node ecosystem:

- **BullMQ** on Redis. Fewer moving parts if Redis is already around, a pleasant
  JavaScript API, delayed jobs and retries built in.
- **RabbitMQ**, a broker that speaks AMQP 0-9-1.

The delivery guarantee matters here. Partners retry on non-2xx, so the same order can
arrive more than once, and a dropped message means a lost order. Failed messages also
need somewhere to go instead of spinning in place.

## Decision

Use RabbitMQ as the transport.

The reasons that decided it:

- **Dead-lettering is part of the protocol.** A message that a consumer rejects, or
  that outlives a queue TTL, is routed by the broker to a dead-letter exchange. Retry
  with backoff comes from the queue topology itself: staged retry queues with growing TTLs that
  dead-letter back to the work queue, instead of retry bookkeeping layered on top of
  Redis. Poison messages land in a durable DLQ the same way.
- **Acknowledgement is explicit and per message.** The consumer decides when a message
  is done. Nothing is removed from the queue until it acks, so a worker that crashes
  mid-processing leaves the message to be redelivered. That gives at-least-once at the
  protocol level, not something the application has to implement itself.
- **Durability across a broker restart** is a built-in setting: persistent messages
  on durable queues survive a restart once the publish is confirmed.

## Consequences

- Retry, dead-lettering, and durability are expressed as broker configuration that can
  be inspected and reasoned about, instead of application code.
- One more stateful service to run and understand. AMQP has more concepts than a Redis
  job queue (exchanges, bindings, routing keys, confirms) and the topology has to be
  declared and asserted on boot by both processes.
- Backoff is staged (fixed TTL steps) rather than a continuous exponential curve. This
  is a deliberate trade-off of the topology-based approach; the staged retry queues live
  in the messaging module.
- Redis is not pulled into the stack for queueing, which keeps the moving parts to
  PostgreSQL and RabbitMQ.
