import { join } from 'node:path';
import { DataSourceOptions } from 'typeorm';
import { DlqMessage } from '../events/entities/dlq-message.entity';
import { Event } from '../events/entities/event.entity';

export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    username: process.env.POSTGRES_USER ?? 'webhook',
    password: process.env.POSTGRES_PASSWORD ?? 'webhook',
    database: process.env.POSTGRES_DB ?? 'webhook_ingestion',
    entities: [Event, DlqMessage],
    migrations: [join(__dirname, '..', 'database', 'migrations', '*.{ts,js}')],
    synchronize: false,
  };
}
