import { io, type Socket } from 'socket.io-client';
import { config } from './config';
import {
  isSupportedVersion,
  isTelemetryEnvelope,
  type TelemetryEnvelope,
} from './telemetry';

export const FEED_EVENT = 'telemetry';
export const SCOPED_EVENT = 'telemetry:correlation';
export const SUBSCRIBE_EVENT = 'subscribe';
export const UNSUBSCRIBE_EVENT = 'unsubscribe';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface TelemetrySocketHandlers {
  onEnvelope: (envelope: TelemetryEnvelope) => void;
  onUnknownVersion?: (raw: unknown) => void;
  onState?: (state: ConnectionState) => void;
}

export interface TelemetrySocket {
  subscribe: (correlationId: string) => void;
  unsubscribe: (correlationId: string) => void;
  disconnect: () => void;
}

export function createTelemetrySocket(
  handlers: TelemetrySocketHandlers,
): TelemetrySocket {
  const socket: Socket = io(config.wsUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  const deliver = (raw: unknown): void => {
    if (!isTelemetryEnvelope(raw)) {
      return;
    }
    if (!isSupportedVersion(raw)) {
      handlers.onUnknownVersion?.(raw);
      return;
    }
    handlers.onEnvelope(raw);
  };

  socket.on('connect', () => handlers.onState?.('connected'));
  socket.on('disconnect', () => handlers.onState?.('disconnected'));
  socket.io.on('reconnect_attempt', () => handlers.onState?.('connecting'));
  socket.on(FEED_EVENT, deliver);
  socket.on(SCOPED_EVENT, deliver);
  handlers.onState?.('connecting');

  return {
    subscribe: (correlationId) =>
      socket.emit(SUBSCRIBE_EVENT, correlationId),
    unsubscribe: (correlationId) =>
      socket.emit(UNSUBSCRIBE_EVENT, correlationId),
    disconnect: () => socket.disconnect(),
  };
}
