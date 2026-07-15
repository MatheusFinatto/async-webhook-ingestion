import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'Prometheus scrape endpoint',
    description:
      'Metrics for this process only; the worker exposes its own registry on WORKER_METRICS_PORT.',
  })
  @ApiProduces('text/plain')
  async scrape(@Res() response: Response): Promise<void> {
    response.set('content-type', this.metrics.contentType);
    response.send(await this.metrics.metrics());
  }
}
