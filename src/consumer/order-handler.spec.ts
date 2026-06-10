import { NoopOrderHandler, OrderHandler } from './order-handler';

describe('NoopOrderHandler', () => {
  const event = {
    eventId: 'evt-1',
    eventType: 'order.created',
    correlationId: 'corr-1',
    payload: {},
  };

  const handler: OrderHandler = new NoopOrderHandler();

  it('ignores the attempt number', async () => {
    await expect(handler.handle(event, 3)).resolves.toBeUndefined();
  });

  it('succeeds on a payload carrying the demo scenario key', async () => {
    const scripted = { ...event, payload: { __scenario: 'permanent' } };

    await expect(handler.handle(scripted, 1)).resolves.toBeUndefined();
  });
});
