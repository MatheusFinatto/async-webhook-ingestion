import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  TELEMETRY_ENVELOPE_VERSION,
  TELEMETRY_EXCHANGE,
} from '../messaging/messaging.constants';
import {
  AmqpTelemetryEmitter,
  NoopTelemetryEmitter,
  TelemetryStageInput,
} from './telemetry-emitter';

const stage: TelemetryStageInput = {
  stage: 'processed',
  correlationId: 'corr-1',
  eventId: 'evt-1',
  eventType: 'order.created',
  status: 'processed',
  attempts: 2,
};

describe('AmqpTelemetryEmitter', () => {
  it('publishes a versioned envelope on the telemetry exchange', () => {
    const amqp = { publish: jest.fn().mockResolvedValue(undefined) };
    new AmqpTelemetryEmitter(amqp as unknown as AmqpConnection).emit(stage);

    expect(amqp.publish).toHaveBeenCalledWith(
      TELEMETRY_EXCHANGE,
      'telemetry.processed',
      expect.objectContaining({
        version: TELEMETRY_ENVELOPE_VERSION,
        stage: 'processed',
        correlation_id: 'corr-1',
        event_id: 'evt-1',
        event_type: 'order.created',
        status: 'processed',
        attempts: 2,
        ts: expect.any(String),
      }),
    );
  });

  it('routes each stage to its own routing key', () => {
    const amqp = { publish: jest.fn().mockResolvedValue(undefined) };
    const emitter = new AmqpTelemetryEmitter(amqp as unknown as AmqpConnection);

    emitter.emit({ ...stage, stage: 'consuming' });
    emitter.emit({ ...stage, stage: 'dead' });

    expect(amqp.publish.mock.calls.map((call) => call[1])).toEqual([
      'telemetry.consuming',
      'telemetry.dead',
    ]);
  });

  it('never propagates a rejected publish', async () => {
    const amqp = {
      publish: jest.fn().mockRejectedValue(new Error('no route')),
    };
    const emitter = new AmqpTelemetryEmitter(amqp as unknown as AmqpConnection);

    expect(() => emitter.emit(stage)).not.toThrow();
    await Promise.resolve();
  });

  it('never propagates a synchronous publish failure', () => {
    const amqp = {
      publish: jest.fn(() => {
        throw new Error('channel closed');
      }),
    };
    const emitter = new AmqpTelemetryEmitter(amqp as unknown as AmqpConnection);

    expect(() => emitter.emit(stage)).not.toThrow();
  });
});

describe('NoopTelemetryEmitter', () => {
  it('does nothing', () => {
    expect(() => new NoopTelemetryEmitter().emit()).not.toThrow();
  });
});
