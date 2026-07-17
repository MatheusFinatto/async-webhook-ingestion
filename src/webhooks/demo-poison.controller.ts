import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'node:crypto';
import { currentCorrelationId } from '../common/correlation-context';
import { isDemoMode } from '../common/demo-mode';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../messaging/messaging.constants';

export const POISON_BYTES = '{"event_id": <not even json';

@ApiTags('demo')
@Controller('demo')
export class DemoPoisonController {
  constructor(private readonly amqp: AmqpConnection) {}

  @Post('poison')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Inject unparseable bytes straight into the work queue',
    description:
      'Publishes a broken message to the webhooks exchange, bypassing the signed HTTP boundary on purpose. Plays the role of a rogue producer so the worker can demonstrate dead-lettering a poison message. Only exists while DEMO_MODE=true.',
  })
  @ApiResponse({ status: 202, description: 'Broken message published' })
  @ApiResponse({ status: 404, description: 'DEMO_MODE is off' })
  async inject(): Promise<{ correlation_id: string; status: string }> {
    if (!isDemoMode()) {
      throw new NotFoundException();
    }
    const correlationId = currentCorrelationId() ?? randomUUID();
    await this.amqp.publish(
      WEBHOOK_EXCHANGE,
      ORDER_RECEIVED_ROUTING_KEY,
      Buffer.from(POISON_BYTES),
      {
        persistent: true,
        correlationId,
        contentType: 'application/json',
        headers: { 'x-correlation-id': correlationId },
      },
    );
    return { correlation_id: correlationId, status: 'injected' };
  }
}
