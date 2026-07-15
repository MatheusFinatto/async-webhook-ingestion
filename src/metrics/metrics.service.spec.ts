import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders incremented counters in the Prometheus text format', async () => {
    const service = new MetricsService();
    service.eventsProcessed.inc({ outcome: 'processed' });
    service.eventsProcessed.inc({ outcome: 'dead' });
    service.eventsProcessed.inc({ outcome: 'dead' });
    service.deadLettersPersisted.inc();

    const output = await service.metrics();

    expect(output).toContain('events_processed_total{outcome="processed"} 1');
    expect(output).toContain('events_processed_total{outcome="dead"} 2');
    expect(output).toContain('dead_letters_persisted_total 1');
  });

  it('collects default process metrics into its own registry', async () => {
    const service = new MetricsService();
    const output = await service.metrics();
    expect(output).toContain('process_cpu_user_seconds_total');
  });

  it('observes http series with route and status labels', async () => {
    const service = new MetricsService();
    service.httpRequests.inc({
      method: 'POST',
      route: '/webhooks/orders',
      status: '202',
    });
    service.httpDuration.observe(
      { method: 'POST', route: '/webhooks/orders' },
      0.012,
    );

    const output = await service.metrics();

    expect(output).toContain(
      'http_requests_total{method="POST",route="/webhooks/orders",status="202"} 1',
    );
    expect(output).toContain('http_request_duration_seconds_bucket');
  });
});
