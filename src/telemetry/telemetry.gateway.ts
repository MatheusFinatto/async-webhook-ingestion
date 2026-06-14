import { Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { demoWebOrigin } from '../common/demo-mode';
import {
  TELEMETRY_BINDING_KEY,
  TELEMETRY_EXCHANGE,
} from '../messaging/messaging.constants';
import { TelemetryEnvelope } from './telemetry-emitter';

export const TELEMETRY_FEED_EVENT = 'telemetry';
export const TELEMETRY_SCOPED_EVENT = 'telemetry:correlation';
export const TELEMETRY_SUBSCRIBE_EVENT = 'subscribe';
export const TELEMETRY_UNSUBSCRIBE_EVENT = 'unsubscribe';

export function correlationRoom(correlationId: string): string {
  return `correlation:${correlationId}`;
}

export interface SubscriptionAck {
  correlation_id: string | null;
}

@WebSocketGateway({
  cors: {
    origin: demoWebOrigin(),
    methods: ['GET', 'POST'],
  },
})
export class TelemetryGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TelemetryGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    this.logger.log({
      message: 'telemetry client connected',
      client_id: client.id,
    });
  }

  handleDisconnect(client: Socket): void {
    this.logger.log({
      message: 'telemetry client disconnected',
      client_id: client.id,
    });
  }

  @SubscribeMessage(TELEMETRY_SUBSCRIBE_EVENT)
  subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() correlationId: unknown,
  ): SubscriptionAck {
    if (typeof correlationId !== 'string' || correlationId.length === 0) {
      return { correlation_id: null };
    }
    void client.join(correlationRoom(correlationId));
    return { correlation_id: correlationId };
  }

  @SubscribeMessage(TELEMETRY_UNSUBSCRIBE_EVENT)
  unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() correlationId: unknown,
  ): SubscriptionAck {
    if (typeof correlationId !== 'string' || correlationId.length === 0) {
      return { correlation_id: null };
    }
    void client.leave(correlationRoom(correlationId));
    return { correlation_id: correlationId };
  }

  @RabbitSubscribe({
    exchange: TELEMETRY_EXCHANGE,
    routingKey: TELEMETRY_BINDING_KEY,
    queue: '',
    queueOptions: { durable: false, exclusive: true, autoDelete: true },
  })
  broadcast(envelope: TelemetryEnvelope): void {
    if (!this.server) {
      return;
    }
    try {
      this.server.emit(TELEMETRY_FEED_EVENT, envelope);
      this.server
        .to(correlationRoom(envelope.correlation_id))
        .emit(TELEMETRY_SCOPED_EVENT, envelope);
    } catch (error) {
      this.logger.debug({
        message: 'telemetry broadcast failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
