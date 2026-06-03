import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { runWithCorrelationId } from './correlation-context';

const HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[HEADER];
    const correlationId =
      typeof incoming === 'string' && incoming ? incoming : randomUUID();
    res.setHeader(HEADER, correlationId);
    runWithCorrelationId(correlationId, () => next());
  }
}
