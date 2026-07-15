import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { MetricsService } from './metrics.service';
import { startWorkerMetricsServer } from './worker-metrics-server';

describe('startWorkerMetricsServer', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const metrics = new MetricsService();
    metrics.eventsProcessed.inc({ outcome: 'processed' });
    server = await startWorkerMetricsServer(metrics, 0);
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('serves the registry on /metrics', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const body = await response.text();
    expect(body).toContain('events_processed_total{outcome="processed"} 1');
  });

  it('answers 404 on any other path', async () => {
    const response = await fetch(`${baseUrl}/anything`);
    expect(response.status).toBe(404);
  });
});
