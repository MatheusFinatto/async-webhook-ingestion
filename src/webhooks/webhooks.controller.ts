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
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { currentCorrelationId } from '../common/correlation-context';
import { EventPublisher } from './event-publisher';
import { OrderWebhookDto } from './dto/order-webhook.dto';
import { WebhookSignatureGuard } from './webhook-signature.guard';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly publisher: EventPublisher) {}

  // The throttler runs before the signature guard: a flood of garbage must
  // hit the cheap counter, not burn an HMAC per request.
  @Post('orders')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard, WebhookSignatureGuard)
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
