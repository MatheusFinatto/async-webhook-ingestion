import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CorrelationMiddleware } from './correlation.middleware';
import { JsonLogger } from './json-logger';

@Global()
@Module({
  providers: [JsonLogger],
  exports: [JsonLogger],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
