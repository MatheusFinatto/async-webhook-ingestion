# 2. NestJS over plain Express for the application framework

- Status: Accepted
- Date: 2026-05-08

## Context

The application is small but has real seams: an HTTP boundary that authenticates and
publishes, a background worker that consumes and deduplicates, and shared concerns like
configuration and structured logging. The same codebase runs in two roles (API and
worker), chosen at startup.

Plain Express would work. So would a structured framework. The question is which one
keeps the seams honest as the code grows, and which one makes the worker testable
without standing up a broker.

## Decision

Use NestJS.

- **Modules draw the domain boundaries.** Webhooks, events, consumer, DLQ, and
  messaging are separate modules with explicit imports and providers. The boundary is
  enforced by the module graph, not by a folder convention that quietly erodes when
  someone is in a hurry.
- **Dependency injection makes the consumer testable in isolation.** The consumer
  depends on an injected `EventPublisher` port and an `OrderHandler` port, so its
  accept/reject and retry logic can be unit-tested by swapping providers, with no RabbitMQ
  in the test. The real AMQP adapter is exercised only in the end-to-end tests against a
  container.
- **Validation happens at the edge.** A global validation pipe rejects a malformed
  payload with a `400` before the guard, the publisher, or the broker ever see it.

## Consequences

- More framework to learn than Express: modules, providers, pipes, guards, and the
  lifecycle. For a service this size that is overhead paid up front.
- The structure pays back at the boundaries. The HTTP guard (HMAC), the admin-key guard,
  the validation pipe, and the two entrypoints slot into framework concepts instead of
  ad-hoc middleware wiring.
- The ports-and-adapters shape (an abstract `EventPublisher`, an abstract `OrderHandler`)
  is a direct consequence of having DI available, and it is what keeps the business rules
  unit-testable without the transport.
