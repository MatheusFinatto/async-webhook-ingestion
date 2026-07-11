import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { runWithCorrelationId } from './correlation-context';

const HEADER = 'x-correlation-id';

// The inbound value is caller-controlled and ends up in a response header, in
// log lines, and in a varchar(255) column. Anything that does not look like a
// sane id is replaced, never propagated.
const VALID_CORRELATION_ID = /^[\w.:-]{1,128}$/;

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[HEADER];
    const correlationId =
      typeof incoming === 'string' && VALID_CORRELATION_ID.test(incoming)
        ? incoming
        : randomUUID();
    res.setHeader(HEADER, correlationId);
    runWithCorrelationId(correlationId, () => next());
  }
}
