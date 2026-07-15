import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      // The route template, not the URL: /dlq/:id/replay stays one series no
      // matter how many ids pass through it. Unmatched requests (404s) are
      // folded into a single label for the same reason.
      const route = request.route
        ? `${request.baseUrl}${(request.route as { path: string }).path}`
        : 'unmatched';
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.httpRequests.inc({
        method: request.method,
        route,
        status: String(response.statusCode),
      });
      this.metrics.httpDuration.observe(
        { method: request.method, route },
        seconds,
      );
    });
    next();
  }
}
