import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { currentCorrelationId } from '../common/correlation-context';
import { EventPublisher } from './event-publisher';
import { OrderWebhookDto } from './dto/order-webhook.dto';
import { WebhookSignatureGuard } from './webhook-signature.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly publisher: EventPublisher) {}

  @Post('orders')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(WebhookSignatureGuard)
  async ingestOrder(
    @Body() event: OrderWebhookDto,
  ): Promise<{ correlation_id: string; status: string }> {
    const correlationId = currentCorrelationId() ?? randomUUID();
    try {
      await this.publisher.publish(event, correlationId);
    } catch {
      throw new ServiceUnavailableException('event could not be accepted');
    }
    return { correlation_id: correlationId, status: 'accepted' };
  }
}
