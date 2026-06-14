import { Server, Socket } from 'socket.io';
import {
  TELEMETRY_FEED_EVENT,
  TELEMETRY_SCOPED_EVENT,
  TelemetryGateway,
  correlationRoom,
} from './telemetry.gateway';
import { TelemetryEnvelope } from './telemetry-emitter';

function envelope(
  overrides: Partial<TelemetryEnvelope> = {},
): TelemetryEnvelope {
  return {
    version: 1,
    stage: 'processed',
    correlation_id: 'cid-1',
    event_id: 'evt-1',
    event_type: 'order.created',
    status: 'processed',
    attempts: 1,
    ts: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('TelemetryGateway', () => {
  let gateway: TelemetryGateway;
  let roomEmit: jest.Mock;
  let to: jest.Mock;
  let emit: jest.Mock;

  beforeEach(() => {
    gateway = new TelemetryGateway();
    roomEmit = jest.fn();
    to = jest.fn().mockReturnValue({ emit: roomEmit });
    emit = jest.fn();
    gateway.server = { emit, to } as unknown as Server;
  });

  it('broadcasts every envelope on the global feed', () => {
    const message = envelope();

    gateway.broadcast(message);

    expect(emit).toHaveBeenCalledWith(TELEMETRY_FEED_EVENT, message);
  });

  it('mirrors the envelope into the room of its correlation id', () => {
    const message = envelope({ correlation_id: 'cid-9' });

    gateway.broadcast(message);

    expect(to).toHaveBeenCalledWith(correlationRoom('cid-9'));
    expect(roomEmit).toHaveBeenCalledWith(TELEMETRY_SCOPED_EVENT, message);
  });

  it('does not throw when no socket server is attached yet', () => {
    gateway.server = undefined as unknown as Server;

    expect(() => gateway.broadcast(envelope())).not.toThrow();
  });

  it('swallows broadcast failures so the amqp message is never nacked', () => {
    emit.mockImplementation(() => {
      throw new Error('socket server closed');
    });

    expect(() => gateway.broadcast(envelope())).not.toThrow();
  });

  it('joins and leaves the room for a valid correlation id', () => {
    const client = { join: jest.fn(), leave: jest.fn() } as unknown as Socket;

    expect(gateway.subscribe(client, 'cid-2')).toEqual({
      correlation_id: 'cid-2',
    });
    expect(client.join).toHaveBeenCalledWith(correlationRoom('cid-2'));

    expect(gateway.unsubscribe(client, 'cid-2')).toEqual({
      correlation_id: 'cid-2',
    });
    expect(client.leave).toHaveBeenCalledWith(correlationRoom('cid-2'));
  });

  it('ignores subscription requests that carry no correlation id', () => {
    const client = { join: jest.fn(), leave: jest.fn() } as unknown as Socket;

    expect(gateway.subscribe(client, '')).toEqual({ correlation_id: null });
    expect(gateway.subscribe(client, 42)).toEqual({ correlation_id: null });
    expect(client.join).not.toHaveBeenCalled();
  });
});
