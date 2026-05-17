import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { WEBHOOK_EXCHANGE } from './messaging.constants';

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
          {
            name: WEBHOOK_EXCHANGE,
            type: 'topic',
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
