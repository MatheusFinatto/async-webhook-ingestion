import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { currentCorrelationId } from './correlation-context';

const LEVEL_ORDER: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

function thresholdIndex(): number {
  const configured = (process.env.LOG_LEVEL ?? 'log') as LogLevel;
  const index = LEVEL_ORDER.indexOf(configured);
  return index === -1 ? LEVEL_ORDER.indexOf('log') : index;
}

@Injectable()
export class JsonLogger implements LoggerService {
  private readonly threshold = thresholdIndex();

  log(message: unknown, ...params: unknown[]): void {
    this.emit('log', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }

  private emit(level: LogLevel, message: unknown, params: unknown[]): void {
    if (LEVEL_ORDER.indexOf(level) > this.threshold) {
      return;
    }

    const { context, stack } = this.split(params);
    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
    };
    const correlationId = currentCorrelationId();
    if (correlationId) {
      record.correlation_id = correlationId;
    }
    if (context) {
      record.context = context;
    }

    if (message instanceof Error) {
      record.message = message.message;
      record.stack = message.stack;
    } else if (message !== null && typeof message === 'object') {
      Object.assign(record, message);
    } else {
      record.message = message;
    }
    if (stack && record.stack === undefined) {
      record.stack = stack;
    }

    const line = JSON.stringify(record);
    if (level === 'error') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  private split(params: unknown[]): { context?: string; stack?: string } {
    let context: string | undefined;
    let stack: string | undefined;
    for (const param of params) {
      if (param instanceof Error) {
        stack = param.stack;
      } else if (typeof param === 'string') {
        if (context === undefined) {
          context = param;
        } else {
          stack = context;
          context = param;
        }
      }
    }
    return { context, stack };
  }
}
