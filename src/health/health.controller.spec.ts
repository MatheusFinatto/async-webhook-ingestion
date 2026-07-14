import { ServiceUnavailableException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

function controllerWith(options: {
  dbUp: boolean;
  rabbitUp: boolean;
}): HealthController {
  const dataSource = {
    query: options.dbUp
      ? jest.fn().mockResolvedValue([{ '?column?': 1 }])
      : jest.fn().mockRejectedValue(new Error('connection refused')),
  } as unknown as DataSource;
  const amqp = { connected: options.rabbitUp } as unknown as AmqpConnection;
  return new HealthController(dataSource, amqp);
}

describe('HealthController', () => {
  it('reports ok with both dependencies up', async () => {
    await expect(
      controllerWith({ dbUp: true, rabbitUp: true }).check(),
    ).resolves.toEqual({
      status: 'ok',
      checks: { postgres: 'up', rabbitmq: 'up' },
    });
  });

  it('degrades to 503 when the database is unreachable', async () => {
    await expect(
      controllerWith({ dbUp: false, rabbitUp: true }).check(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('degrades to 503 when the broker is disconnected', async () => {
    const error = await controllerWith({ dbUp: true, rabbitUp: false })
      .check()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'degraded',
      checks: { postgres: 'up', rabbitmq: 'down' },
    });
  });
});
