import { NotFoundException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../messaging/messaging.constants';
import { DemoPoisonController, POISON_BYTES } from './demo-poison.controller';

describe('DemoPoisonController', () => {
  const previousDemoMode = process.env.DEMO_MODE;
  let publish: jest.Mock;
  let controller: DemoPoisonController;

  beforeEach(() => {
    publish = jest.fn().mockResolvedValue(undefined);
    controller = new DemoPoisonController({
      publish,
    } as unknown as AmqpConnection);
  });

  afterEach(() => {
    process.env.DEMO_MODE = previousDemoMode;
  });

  it('returns 404 when DEMO_MODE is off', async () => {
    process.env.DEMO_MODE = 'false';
    await expect(controller.inject()).rejects.toBeInstanceOf(NotFoundException);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes broken bytes to the webhooks exchange in demo mode', async () => {
    process.env.DEMO_MODE = 'true';
    const receipt = await controller.inject();

    expect(receipt.status).toBe('injected');
    expect(publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, content, options] = publish.mock.calls[0] as [
      string,
      string,
      Buffer,
      { correlationId: string },
    ];
    expect(exchange).toBe(WEBHOOK_EXCHANGE);
    expect(routingKey).toBe(ORDER_RECEIVED_ROUTING_KEY);
    expect(content.toString('utf8')).toBe(POISON_BYTES);
    expect(options.correlationId).toBe(receipt.correlation_id);
    expect(() => JSON.parse(content.toString('utf8'))).toThrow();
  });
});
