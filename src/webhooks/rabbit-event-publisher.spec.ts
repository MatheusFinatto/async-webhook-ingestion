import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { RabbitEventPublisher } from './rabbit-event-publisher';
import { OrderWebhookDto } from './dto/order-webhook.dto';

const UNROUTABLE = 'corr-unroutable';

const event: OrderWebhookDto = {
  event_id: 'evt-1',
  event_type: 'order.created',
  payload: { amount: 1 },
};

function config(): ConfigService {
  return {
    get: () => '5000',
  } as unknown as ConfigService;
}

interface Publish {
  exchange: string;
  routingKey: string;
  options: Record<string, unknown>;
}

function fakeAmqp(): { amqp: AmqpConnection; publishes: Publish[] } {
  let onReturn: ((message: unknown) => void) | undefined;
  const publishes: Publish[] = [];
  const amqp = {
    managedChannel: {
      addSetup: (setup: (channel: unknown) => void) => {
        setup({
          on: (event_: string, handler: (message: unknown) => void) => {
            if (event_ === 'return') {
              onReturn = handler;
            }
          },
        });
        return Promise.resolve();
      },
    },
    publish: (
      exchange: string,
      routingKey: string,
      _message: unknown,
      options: Record<string, unknown>,
    ) => {
      publishes.push({ exchange, routingKey, options });
      if (options.correlationId === UNROUTABLE) {
        onReturn?.({ properties: { correlationId: UNROUTABLE } });
      }
      return Promise.resolve(true);
    },
  } as unknown as AmqpConnection;
  return { amqp, publishes };
}

describe('RabbitEventPublisher', () => {
  it('publishes persistent and mandatory, resolving on a routable confirm', async () => {
    const { amqp, publishes } = fakeAmqp();
    const publisher = new RabbitEventPublisher(amqp, config());
    await publisher.onApplicationBootstrap();

    await expect(publisher.publish(event, 'corr-ok')).resolves.toBeUndefined();
    expect(publishes[0].options).toMatchObject({
      persistent: true,
      mandatory: true,
      messageId: 'evt-1',
      correlationId: 'corr-ok',
    });
  });

  it('rejects when the broker returns the message as unroutable', async () => {
    const { amqp } = fakeAmqp();
    const publisher = new RabbitEventPublisher(amqp, config());
    await publisher.onApplicationBootstrap();

    await expect(publisher.publish(event, UNROUTABLE)).rejects.toThrow(
      /unroutable/,
    );
  });
});
