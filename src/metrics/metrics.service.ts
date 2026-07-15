import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

// Each process (api, worker) owns its registry and exposes it itself; the
// scraper aggregates. Counters never cross process boundaries, so the worker
// numbers are only visible on the worker's endpoint and vice versa.
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests served, labelled by method, route and status code',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds, labelled by method and route',
    labelNames: ['method', 'route'] as const,
    registers: [this.registry],
  });

  readonly eventsProcessed = new Counter({
    name: 'events_processed_total',
    help: 'Processing decisions taken by the worker, labelled by outcome',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  readonly processingDuration = new Histogram({
    name: 'event_processing_duration_seconds',
    help: 'Seconds from consuming a message to its processing decision',
    registers: [this.registry],
  });

  readonly deadLettersPersisted = new Counter({
    name: 'dead_letters_persisted_total',
    help: 'Dead letters written to dlq_messages by the DLQ consumer',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
