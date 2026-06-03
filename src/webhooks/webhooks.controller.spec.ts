import { ServiceUnavailableException } from '@nestjs/common';
import { runWithCorrelationId } from '../common/correlation-context';
import { EventPublisher } from './event-publisher';
import { OrderWebhookDto } from './dto/order-webhook.dto';
import { WebhooksController } from './webhooks.controller';

const event: OrderWebhookDto = {
  event_id: 'evt-1',
  event_type: 'order.created',
  payload: { amount: 100 },
};

describe('WebhooksController', () => {
  it('publishes and returns 202 body with the ambient correlation id', async () => {
    const publisher: EventPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new WebhooksController(publisher);

    const result = await runWithCorrelationId('corr-in', () =>
      controller.ingestOrder(event),
    );

    expect(publisher.publish).toHaveBeenCalledWith(event, 'corr-in');
    expect(result).toEqual({ correlation_id: 'corr-in', status: 'accepted' });
  });

  it('generates a correlation id when the context has none', async () => {
    const publisher: EventPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new WebhooksController(publisher);

    const result = await controller.ingestOrder(event);

    expect(result.status).toBe('accepted');
    expect(result.correlation_id).toHaveLength(36);
    expect(publisher.publish).toHaveBeenCalledWith(
      event,
      result.correlation_id,
    );
  });

  it('maps a failed publisher confirm to 503', async () => {
    const publisher: EventPublisher = {
      publish: jest.fn().mockRejectedValue(new Error('confirm failed')),
    };
    const controller = new WebhooksController(publisher);

    await expect(
      runWithCorrelationId('corr-in', () => controller.ingestOrder(event)),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
