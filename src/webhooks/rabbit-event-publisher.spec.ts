import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  PUBLISH_TOKEN_HEADER,
  RabbitEventPublisher,
} from './rabbit-event-publisher';
import { OrderWebhookDto } from './dto/order-webhook.dto';

const UNROUTABLE = 'corr-unroutable';
const FOREIGN_RETURN = 'corr-foreign-return';

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
        // The broker echoes the published message back on basic.return,
        // headers included.
        onReturn?.({ properties: { headers: options.headers } });
      }
      if (options.correlationId === FOREIGN_RETURN) {
        // A return for some other in-flight publish that happens to share
        // the caller-supplied correlation id.
        onReturn?.({
          properties: {
            headers: {
              ...(options.headers as Record<string, unknown>),
              [PUBLISH_TOKEN_HEADER]: 'someone-elses-token',
            },
          },
        });
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
    const headers = publishes[0].options.headers as Record<string, unknown>;
    expect(typeof headers[PUBLISH_TOKEN_HEADER]).toBe('string');
  });

  it('rejects when the broker returns the message as unroutable', async () => {
    const { amqp } = fakeAmqp();
    const publisher = new RabbitEventPublisher(amqp, config());
    await publisher.onApplicationBootstrap();

    await expect(publisher.publish(event, UNROUTABLE)).rejects.toThrow(
      /unroutable/,
    );
  });

  it('ignores a return that belongs to a different publish with the same correlation id', async () => {
    const { amqp } = fakeAmqp();
    const publisher = new RabbitEventPublisher(amqp, config());
    await publisher.onApplicationBootstrap();

    await expect(
      publisher.publish(event, FOREIGN_RETURN),
    ).resolves.toBeUndefined();
  });
});
