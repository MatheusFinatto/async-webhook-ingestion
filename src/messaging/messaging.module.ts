import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import {
  DEAD_LETTER_EXCHANGE,
  DEAD_LETTER_QUEUE,
  DEAD_LETTER_ROUTING_KEY,
  ORDER_RECEIVED_ROUTING_KEY,
  RETRY_EXCHANGE,
  RETRY_TIERS,
  WEBHOOK_EXCHANGE,
  WORK_QUEUE,
} from './messaging.constants';

function buildAmqpUri(config: ConfigService): string {
  const explicit = config.get<string>('RABBITMQ_URL');
  if (explicit) {
    return explicit;
  }
  const host = config.get<string>('RABBITMQ_HOST') ?? 'localhost';
  const port = config.get<string>('RABBITMQ_PORT') ?? '5672';
  const user = config.get<string>('RABBITMQ_USER') ?? 'guest';
  const password = config.get<string>('RABBITMQ_PASSWORD') ?? 'guest';
  return `amqp://${user}:${password}@${host}:${port}`;
}

@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        uri: buildAmqpUri(config),
        exchanges: [
          { name: WEBHOOK_EXCHANGE, type: 'topic', options: { durable: true } },
          { name: RETRY_EXCHANGE, type: 'topic', options: { durable: true } },
          {
            name: DEAD_LETTER_EXCHANGE,
            type: 'topic',
            options: { durable: true },
          },
        ],
        queues: [
          {
            name: WORK_QUEUE,
            exchange: WEBHOOK_EXCHANGE,
            routingKey: ORDER_RECEIVED_ROUTING_KEY,
            options: { durable: true },
          },
          ...RETRY_TIERS.map((tier) => ({
            name: tier.queue,
            exchange: RETRY_EXCHANGE,
            routingKey: tier.routingKey,
            options: {
              durable: true,
              arguments: {
                'x-message-ttl': tier.ttlMs,
                'x-dead-letter-exchange': WEBHOOK_EXCHANGE,
                'x-dead-letter-routing-key': ORDER_RECEIVED_ROUTING_KEY,
              },
            },
          })),
          {
            name: DEAD_LETTER_QUEUE,
            exchange: DEAD_LETTER_EXCHANGE,
            routingKey: DEAD_LETTER_ROUTING_KEY,
            options: { durable: true },
          },
        ],
        defaultPublishOptions: { persistent: true },
        connectionInitOptions: { wait: true, reject: true, timeout: 10_000 },
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [RabbitMQModule],
})
export class MessagingModule {}
