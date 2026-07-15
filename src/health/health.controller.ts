import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DataSource } from 'typeorm';

const DB_PING_TIMEOUT_MS = 2_000;

type CheckState = 'up' | 'down';

export interface HealthReport {
  status: 'ok';
  checks: { postgres: CheckState; rabbitmq: CheckState };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly amqp: AmqpConnection,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Probe Postgres and RabbitMQ connectivity' })
  @ApiResponse({ status: 200, description: 'Both dependencies are up' })
  @ApiResponse({ status: 503, description: 'At least one dependency is down' })
  async check(): Promise<HealthReport> {
    const checks = {
      postgres: await this.postgresState(),
      rabbitmq: (this.amqp.connected ? 'up' : 'down') as CheckState,
    };
    if (checks.postgres !== 'up' || checks.rabbitmq !== 'up') {
      throw new ServiceUnavailableException({ status: 'degraded', checks });
    }
    return { status: 'ok', checks };
  }

  private async postgresState(): Promise<CheckState> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('database ping timed out')),
            DB_PING_TIMEOUT_MS,
          );
        }),
      ]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
