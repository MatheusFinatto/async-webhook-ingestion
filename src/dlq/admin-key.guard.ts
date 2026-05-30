import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqualString } from '../common/timing-safe';

@Injectable()
export class AdminKeyGuard implements CanActivate {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('ADMIN_API_KEY') ?? '';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-admin-key'];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided) {
      throw new UnauthorizedException('missing admin key');
    }
    if (!timingSafeEqualString(provided, this.secret)) {
      throw new ForbiddenException('invalid admin key');
    }
    return true;
  }
}
