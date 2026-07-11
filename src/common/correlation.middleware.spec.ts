import { Request, Response } from 'express';
import { currentCorrelationId } from './correlation-context';
import { CorrelationMiddleware } from './correlation.middleware';

function run(incoming?: string): { echoed: string; seen: string | undefined } {
  const middleware = new CorrelationMiddleware();
  const headers: Record<string, string> = {};
  if (incoming !== undefined) {
    headers['x-correlation-id'] = incoming;
  }
  let echoed = '';
  let seen: string | undefined;
  const req = { headers } as unknown as Request;
  const res = {
    setHeader: (_name: string, value: string) => {
      echoed = value;
    },
  } as unknown as Response;
  middleware.use(req, res, () => {
    seen = currentCorrelationId();
  });
  return { echoed, seen };
}

describe('CorrelationMiddleware', () => {
  it('propagates a well-formed inbound id to the context and response', () => {
    const { echoed, seen } = run('corr-abc.123:z-9');
    expect(seen).toBe('corr-abc.123:z-9');
    expect(echoed).toBe('corr-abc.123:z-9');
  });

  it('generates an id when the header is absent', () => {
    const { echoed, seen } = run();
    expect(seen).toHaveLength(36);
    expect(echoed).toBe(seen);
  });

  it('replaces an oversized id instead of letting it reach storage', () => {
    const { seen } = run('x'.repeat(300));
    expect(seen).toHaveLength(36);
  });

  it('replaces an id with unsafe characters instead of echoing it', () => {
    const { seen } = run('bad\r\nvalue');
    expect(seen).toHaveLength(36);
  });
});
