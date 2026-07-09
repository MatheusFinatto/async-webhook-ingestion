import { io, type Socket } from 'socket.io-client';
import { config } from './config';
import {
  isSupportedVersion,
  isTelemetryEnvelope,
  type TelemetryEnvelope,
} from './telemetry';

// The dashboard is a global view, so it consumes the firehose feed the gateway
// broadcasts to every client. The gateway ALSO re-emits each envelope on a
// per-correlation scoped channel; listening to both would deliver, and count,
// every event twice, so this client deliberately ignores the scoped channel.
export const FEED_EVENT = 'telemetry';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface TelemetrySocketHandlers {
  onEnvelope: (envelope: TelemetryEnvelope) => void;
  onUnknownVersion?: (raw: unknown) => void;
  onState?: (state: ConnectionState) => void;
}

export interface TelemetrySocket {
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
  handlers.onState?.('connecting');

  return {
    disconnect: () => socket.disconnect(),
  };
}
