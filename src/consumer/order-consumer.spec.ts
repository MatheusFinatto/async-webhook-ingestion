import { ConsumeMessage } from 'amqplib';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  ATTEMPT_HEADER,
  DEAD_LETTER_EXCHANGE,
  DEAD_LETTER_ROUTING_KEY,
  RETRY_EXCHANGE,
  RETRY_TIERS,
} from '../messaging/messaging.constants';
import {
  IdempotentEventProcessor,
  ProcessDecision,
} from './idempotent-event-processor';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import { OrderConsumer } from './order-consumer';

function message(
  body: unknown,
  options: {
    headers?: Record<string, unknown>;
    correlationId?: string;
    redelivered?: boolean;
  } = {},
): ConsumeMessage {
  const content = Buffer.from(
    typeof body === 'string' ? body : JSON.stringify(body),
  );
  return {
    content,
    fields: { redelivered: options.redelivered ?? false },
    properties: {
      headers: options.headers,
      correlationId: options.correlationId,
    },
  } as unknown as ConsumeMessage;
}

describe('OrderConsumer', () => {
  let processor: { process: jest.Mock };
  let amqp: { publish: jest.Mock };
  let telemetry: { emit: jest.Mock };
  let consumer: OrderConsumer;

  const validBody = {
    event_id: 'evt-1',
    event_type: 'order.created',
    payload: { amount: 1 },
    correlation_id: 'corr-1',
  };

  beforeEach(() => {
    processor = { process: jest.fn() };
    amqp = { publish: jest.fn().mockResolvedValue(true) };
    telemetry = { emit: jest.fn() };
    consumer = new OrderConsumer(
      processor as unknown as IdempotentEventProcessor,
      amqp as unknown as AmqpConnection,
      telemetry as unknown as TelemetryEmitter,
    );
  });

  function decide(decision: ProcessDecision): void {
    processor.process.mockResolvedValue(decision);
  }

  it('acks a processed event without publishing', async () => {
    decide({ kind: 'processed', attempts: 1 });
    await consumer.handle(validBody, message(validBody));
    expect(amqp.publish).not.toHaveBeenCalled();
  });

  it('acks a duplicate without publishing', async () => {
    decide({ kind: 'duplicate', attempts: 1 });
    await consumer.handle(validBody, message(validBody));
    expect(amqp.publish).not.toHaveBeenCalled();
  });

  it('routes a transient failure to the retry tier for the attempt', async () => {
    decide({ kind: 'retry', attempts: 1 });
    await consumer.handle(validBody, message(validBody));

    expect(amqp.publish).toHaveBeenCalledWith(
      RETRY_EXCHANGE,
      RETRY_TIERS[0].routingKey,
      expect.objectContaining({ event_id: 'evt-1' }),
      expect.objectContaining({
        headers: expect.objectContaining({ [ATTEMPT_HEADER]: 1 }),
      }),
    );
  });

  it('routes an exhausted/permanent failure to the dead-letter exchange', async () => {
    decide({ kind: 'dead', attempts: 3, reason: 'poison' });
    await consumer.handle(validBody, message(validBody));

    expect(amqp.publish).toHaveBeenCalledWith(
      DEAD_LETTER_EXCHANGE,
      DEAD_LETTER_ROUTING_KEY,
      expect.objectContaining({ event_id: 'evt-1', reason: 'poison' }),
      expect.anything(),
    );
  });

  it('marks a delivery from the retry queue as a continuation', async () => {
    decide({ kind: 'processed', attempts: 1 });
    await consumer.handle(
      validBody,
      message(validBody, { headers: { [ATTEMPT_HEADER]: 2 } }),
    );
    expect(processor.process).toHaveBeenCalledWith(expect.anything(), {
      isContinuation: true,
    });
  });

  it('emits the consuming and decision stages for a handled event', async () => {
    decide({ kind: 'processed', attempts: 1 });
    await consumer.handle(validBody, message(validBody));

    expect(
      telemetry.emit.mock.calls.map(
        (call: [{ stage: string }]) => call[0].stage,
      ),
    ).toEqual(['consuming', 'processing_decision']);
    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'processing_decision',
        correlationId: 'corr-1',
        eventId: 'evt-1',
        status: 'processed',
        attempts: 1,
      }),
    );
  });

  it('emits the dead stage when the decision is dead', async () => {
    decide({ kind: 'dead', attempts: 3, reason: 'poison' });
    await consumer.handle(validBody, message(validBody));

    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'dead', eventId: 'evt-1', attempts: 3 }),
    );
  });

  it('dead-letters an unparseable payload without touching the processor', async () => {
    await consumer.handle(
      undefined,
      message('{ not json', { correlationId: 'corr-poison' }),
    );

    expect(processor.process).not.toHaveBeenCalled();
    expect(amqp.publish).toHaveBeenCalledWith(
      DEAD_LETTER_EXCHANGE,
      DEAD_LETTER_ROUTING_KEY,
      expect.objectContaining({
        event_id: null,
        correlation_id: 'corr-poison',
      }),
      expect.anything(),
    );
  });
});
