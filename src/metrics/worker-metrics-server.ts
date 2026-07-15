import { createServer, Server } from 'node:http';
import { MetricsService } from './metrics.service';

// The worker deliberately has no Nest HTTP adapter (the api owns the HTTP
// surface), but Prometheus still needs to scrape it. A bare node server on a
// separate port keeps that boundary: no routing, no middleware, one path.
export function startWorkerMetricsServer(
  metrics: MetricsService,
  port: number,
): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/metrics') {
      metrics.metrics().then(
        (body) => {
          response.setHeader('content-type', metrics.contentType);
          response.end(body);
        },
        () => {
          response.statusCode = 500;
          response.end();
        },
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}
