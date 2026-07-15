import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { currentCorrelationId } from '../common/correlation-context';
import { EventPublisher } from './event-publisher';
import { OrderWebhookDto } from './dto/order-webhook.dto';
import { WebhookSignatureGuard } from './webhook-signature.guard';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly publisher: EventPublisher) {}

  // The throttler runs before the signature guard: a flood of garbage must
  // hit the cheap counter, not burn an HMAC per request.
  @Post('orders')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard, WebhookSignatureGuard)
  @ApiOperation({
    summary: 'Ingest a signed order webhook',
    description:
      'Accepted means durably queued: the broker confirmed the publish before the 202. Processing happens asynchronously in the worker.',
  })
  @ApiHeader({
    name: 'x-timestamp',
    required: true,
    description: 'Unix seconds; rejected outside the replay tolerance window',
  })
  @ApiHeader({
    name: 'x-signature',
    required: true,
    description:
      'Hex HMAC-SHA256 of "timestamp.rawBody" with the shared secret',
  })
  @ApiResponse({ status: 202, description: 'Event confirmed and queued' })
  @ApiResponse({ status: 400, description: 'Body failed validation' })
  @ApiResponse({
    status: 401,
    description: 'Missing, stale or invalid signature',
  })
  @ApiResponse({ status: 413, description: 'Body over WEBHOOK_BODY_LIMIT' })
  @ApiResponse({ status: 429, description: 'Per-IP rate limit exceeded' })
  @ApiResponse({
    status: 503,
    description: 'Broker did not confirm the publish; safe to retry',
  })
  async ingestOrder(
    @Body() event: OrderWebhookDto,
  ): Promise<{ correlation_id: string; status: string }> {
    const correlationId = currentCorrelationId() ?? randomUUID();
    try {
      await this.publisher.publish(event, correlationId);
    } catch (error) {
      this.logger.error(
        {
          message: 'publish failed, returning 503',
          event_id: event.event_id,
          correlation_id: correlationId,
        },
        error instanceof Error ? error : new Error(String(error)),
      );
      throw new ServiceUnavailableException('event could not be accepted');
    }
    return { correlation_id: correlationId, status: 'accepted' };
  }
}
