import { JsonLogger } from './json-logger';
import { runWithCorrelationId } from './correlation-context';

function capture(fn: () => void): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  const record = (chunk: string | Uint8Array): boolean => {
    lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
    return true;
  };
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(record);
  const err = jest.spyOn(process.stderr, 'write').mockImplementation(record);
  try {
    fn();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return lines;
}

describe('JsonLogger', () => {
  it('emits a single JSON line with level, context and message', () => {
    const logger = new JsonLogger();
    const [record] = capture(() => logger.log('hello', 'Ctx'));

    expect(record.level).toBe('log');
    expect(record.context).toBe('Ctx');
    expect(record.message).toBe('hello');
    expect(typeof record.time).toBe('string');
  });

  it('includes the ambient correlation id', () => {
    const logger = new JsonLogger();
    const [record] = capture(() =>
      runWithCorrelationId('corr-9', () => logger.log('within')),
    );

    expect(record.correlation_id).toBe('corr-9');
  });

  it('omits correlation id when there is no context', () => {
    const logger = new JsonLogger();
    const [record] = capture(() => logger.log('bare'));

    expect(record.correlation_id).toBeUndefined();
  });

  it('spreads an object message into structured fields', () => {
    const logger = new JsonLogger();
    const [record] = capture(() =>
      logger.log({ message: 'published', event_id: 'evt-1' }),
    );

    expect(record.message).toBe('published');
    expect(record.event_id).toBe('evt-1');
  });

  it('serializes an Error stack on error()', () => {
    const logger = new JsonLogger();
    const [record] = capture(() =>
      logger.error('boom', new Error('root cause')),
    );

    expect(record.level).toBe('error');
    expect(record.message).toBe('boom');
    expect(String(record.stack)).toContain('root cause');
  });

  it('suppresses levels below the configured threshold', () => {
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    try {
      const logger = new JsonLogger();
      const lines = capture(() => {
        logger.log('should be dropped');
        logger.warn('should pass');
      });
      expect(lines).toHaveLength(1);
      expect(lines[0].message).toBe('should pass');
    } finally {
      process.env.LOG_LEVEL = previous;
    }
  });
});
