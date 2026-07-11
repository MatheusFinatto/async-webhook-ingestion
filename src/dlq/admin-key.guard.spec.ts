import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminKeyGuard } from './admin-key.guard';

function contextWithHeaders(
  headers: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('AdminKeyGuard', () => {
  const secret = 'super-secret-admin-key';
  const guard = new AdminKeyGuard({
    get: () => secret,
  } as unknown as ConfigService);

  it('rejects a missing key with 401', () => {
    expect(() => guard.canActivate(contextWithHeaders({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an invalid key with 403', () => {
    expect(() =>
      guard.canActivate(contextWithHeaders({ 'x-admin-key': 'wrong' })),
    ).toThrow(ForbiddenException);
  });

  it('accepts the correct key', () => {
    expect(
      guard.canActivate(contextWithHeaders({ 'x-admin-key': secret })),
    ).toBe(true);
  });

  it('refuses to construct without a key', () => {
    const empty = { get: () => undefined } as unknown as ConfigService;
    expect(() => new AdminKeyGuard(empty)).toThrow(/ADMIN_API_KEY/);
  });
});
