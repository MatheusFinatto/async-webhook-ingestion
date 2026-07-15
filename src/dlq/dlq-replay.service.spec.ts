import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DataSource } from 'typeorm';
import { DlqMessage } from '../events/entities/dlq-message.entity';
import { Event } from '../events/entities/event.entity';
import { EventStatus } from '../events/event-status.enum';
import {
  ATTEMPT_HEADER,
  ORDER_RECEIVED_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from '../messaging/messaging.constants';
import { DlqReplayService } from './dlq-replay.service';

const originalMessage = {
  event_id: 'evt-1',
  event_type: 'order.created',
  payload: { amount: 1 },
  correlation_id: 'corr-1',
};

function makeDeadRow(overrides?: Partial<DlqMessage>): Partial<DlqMessage> {
  return {
    id: 'dlq-1',
    messageId: 'evt-1',
    eventId: 'evt-1',
    correlationId: 'corr-1',
    reason: 'poison',
    attempts: 3,
    payload: JSON.stringify(originalMessage),
    ...overrides,
  };
}

function makeService(opts: {
  dead: Partial<DlqMessage> | null;
  event: Partial<Event> | null;
  publish?: jest.Mock;
}): {
  service: DlqReplayService;
  publish: jest.Mock;
  update: jest.Mock;
} {
  const publish = opts.publish ?? jest.fn().mockResolvedValue(true);
  const update = jest.fn().mockResolvedValue(undefined);
  const manager = {
    findOne: jest.fn((entity: unknown) => {
      if (entity === DlqMessage) {
        return Promise.resolve(opts.dead);
      }
      return Promise.resolve(opts.event);
    }),
    update,
  };
  const dataSource = {
    transaction: (run: (m: unknown) => Promise<unknown>) => run(manager),
  } as unknown as DataSource;
  const amqp = { publish } as unknown as AmqpConnection;
  const config = { get: () => '5000' } as unknown as ConfigService;

  return {
    service: new DlqReplayService(dataSource, amqp, config),
    publish,
    update,
  };
}

describe('DlqReplayService', () => {
  it('resets the event, stamps the dead letter and republishes the original message', async () => {
    const { service, publish, update } = makeService({
      dead: makeDeadRow(),
      event: { status: EventStatus.Dead, attempts: 3 },
    });

    const receipt = await service.replay('dlq-1');

    expect(receipt).toEqual({
      event_id: 'evt-1',
      correlation_id: 'corr-1',
      status: 'replayed',
    });
    expect(update).toHaveBeenCalledWith(
      Event,
      { eventId: 'evt-1' },
      { status: EventStatus.Received, attempts: 0, failureReason: null },
    );
    expect(update).toHaveBeenCalledWith(
      DlqMessage,
      { id: 'dlq-1' },
      { replayedAt: expect.any(Date) },
    );
    expect(publish).toHaveBeenCalledWith(
      WEBHOOK_EXCHANGE,
      ORDER_RECEIVED_ROUTING_KEY,
      originalMessage,
      expect.objectContaining({
        persistent: true,
        messageId: 'evt-1',
        correlationId: 'corr-1',
        headers: expect.objectContaining({ [ATTEMPT_HEADER]: 0 }),
      }),
    );
  });

  it('replays an event stuck in failed', async () => {
    const { service, publish } = makeService({
      dead: makeDeadRow(),
      event: { status: EventStatus.Failed, attempts: 3 },
    });
    await service.replay('dlq-1');
    expect(publish).toHaveBeenCalled();
  });

  it('replays even when the events row is missing', async () => {
    const { service, publish, update } = makeService({
      dead: makeDeadRow(),
      event: null,
    });

    await service.replay('dlq-1');

    expect(publish).toHaveBeenCalled();
    const eventUpdates = update.mock.calls.filter(
      ([entity]) => entity === Event,
    );
    expect(eventUpdates).toHaveLength(0);
  });

  it('rejects an unknown dead letter with 404', async () => {
    const { service } = makeService({ dead: null, event: null });
    await expect(service.replay('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a dead letter without an event id', async () => {
    const { service, publish } = makeService({
      dead: makeDeadRow({ eventId: null }),
      event: null,
    });
    await expect(service.replay('dlq-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a replay when the event is already processed', async () => {
    const { service, publish } = makeService({
      dead: makeDeadRow(),
      event: { status: EventStatus.Processed, attempts: 1 },
    });
    await expect(service.replay('dlq-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a stored payload that is not the original message', async () => {
    const { service, publish } = makeService({
      dead: makeDeadRow({ payload: 'not json at all' }),
      event: { status: EventStatus.Dead, attempts: 3 },
    });
    await expect(service.replay('dlq-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns 503 when the republish fails, leaving the event replayable', async () => {
    const { service } = makeService({
      dead: makeDeadRow(),
      event: { status: EventStatus.Dead, attempts: 3 },
      publish: jest.fn().mockRejectedValue(new Error('broker down')),
    });
    await expect(service.replay('dlq-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
