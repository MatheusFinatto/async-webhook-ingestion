import { DemoOrderHandler } from './demo-order-handler';
import { HandledEvent } from './order-handler';
import {
  PermanentProcessingError,
  TransientProcessingError,
} from './processing-errors';

function event(payload: Record<string, unknown>): HandledEvent {
  return {
    eventId: 'evt-1',
    eventType: 'order.created',
    correlationId: 'corr-1',
    payload,
  };
}

describe('DemoOrderHandler', () => {
  const handler = new DemoOrderHandler();

  it('succeeds on a payload without a scenario', async () => {
    await expect(
      handler.handle(event({ amount: 1 }), 1),
    ).resolves.toBeUndefined();
  });

  it('succeeds on an unknown scenario value', async () => {
    await expect(
      handler.handle(event({ __scenario: 'chaos' }), 1),
    ).resolves.toBeUndefined();
  });

  it('always throws a permanent error for the permanent scenario', async () => {
    await expect(
      handler.handle(event({ __scenario: 'permanent' }), 1),
    ).rejects.toBeInstanceOf(PermanentProcessingError);
    await expect(
      handler.handle(event({ __scenario: 'permanent' }), 9),
    ).rejects.toBeInstanceOf(PermanentProcessingError);
  });

  it('always throws a transient error for the exhaust scenario without a window', async () => {
    await expect(
      handler.handle(event({ __scenario: 'exhaust' }), 1),
    ).rejects.toBeInstanceOf(TransientProcessingError);
    await expect(
      handler.handle(event({ __scenario: 'exhaust' }), 9),
    ).rejects.toBeInstanceOf(TransientProcessingError);
  });

  it('fails the exhaust scenario while the outage window is open', async () => {
    await expect(
      handler.handle(
        event({ __scenario: 'exhaust', __outage_until: Date.now() + 60_000 }),
        1,
      ),
    ).rejects.toBeInstanceOf(TransientProcessingError);
  });

  it('succeeds the exhaust scenario after the outage window closes', async () => {
    await expect(
      handler.handle(
        event({ __scenario: 'exhaust', __outage_until: Date.now() - 1_000 }),
        1,
      ),
    ).resolves.toBeUndefined();
  });

  it('fails the transient scenario on the first two attempts', async () => {
    await expect(
      handler.handle(event({ __scenario: 'transient' }), 1),
    ).rejects.toBeInstanceOf(TransientProcessingError);
    await expect(
      handler.handle(event({ __scenario: 'transient' }), 2),
    ).rejects.toBeInstanceOf(TransientProcessingError);
  });

  it('succeeds the transient scenario on the third attempt', async () => {
    await expect(
      handler.handle(event({ __scenario: 'transient' }), 3),
    ).resolves.toBeUndefined();
  });
});
