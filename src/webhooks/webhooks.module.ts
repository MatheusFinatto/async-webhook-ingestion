import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { seconds, ThrottlerModule } from '@nestjs/throttler';
import { MessagingModule } from '../messaging/messaging.module';
import { EventPublisher } from './event-publisher';
import { RabbitEventPublisher } from './rabbit-event-publisher';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    MessagingModule,
    // In-memory counters, so the limit is per process, not per fleet. Good
    // enough as an abuse guardrail for one instance; a multi-instance
    // deployment would swap in the Redis storage.
    ThrottlerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: seconds(
              Number(config.get<string>('RATE_LIMIT_TTL_SECONDS') ?? 60),
            ),
            limit: Number(config.get<string>('RATE_LIMIT_MAX') ?? 600),
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhookSignatureGuard,
    { provide: EventPublisher, useClass: RabbitEventPublisher },
  ],
})
export class WebhooksModule {}
