import {
  CanActivate,
  ExecutionContext,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { Request } from 'express';
import { timingSafeEqualString } from '../common/timing-safe';

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly secret: string;
  private readonly toleranceSeconds: number;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('WEBHOOK_HMAC_SECRET') ?? '';
    this.toleranceSeconds = Number(
      config.get<string>('WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS') ?? 300,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const signature = headerValue(request, 'x-signature');
    const timestamp = headerValue(request, 'x-timestamp');
    if (!signature || !timestamp) {
      throw new UnauthorizedException('missing signature or timestamp');
    }
    if (!this.withinTolerance(timestamp)) {
      throw new UnauthorizedException('stale or invalid timestamp');
    }
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const expected = createHmac('sha256', this.secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    if (!timingSafeEqualString(signature, expected)) {
      throw new UnauthorizedException('invalid signature');
    }
    return true;
  }

  private withinTolerance(timestamp: string): boolean {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      return false;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Math.abs(nowSeconds - ts) <= this.toleranceSeconds;
  }
}
