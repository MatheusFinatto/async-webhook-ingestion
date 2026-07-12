import { QueryFailedError } from 'typeorm';
import { isNonRecoverableDbError } from './processing-errors';

function dbError(code?: string): QueryFailedError {
  const driverError = Object.assign(new Error('boom'), { code });
  return new QueryFailedError('INSERT INTO events', [], driverError);
}

describe('isNonRecoverableDbError', () => {
  it('flags data exceptions (class 22) as non-recoverable', () => {
    expect(isNonRecoverableDbError(dbError('22001'))).toBe(true);
    expect(isNonRecoverableDbError(dbError('22P02'))).toBe(true);
  });

  it('flags integrity violations (class 23) as non-recoverable', () => {
    expect(isNonRecoverableDbError(dbError('23502'))).toBe(true);
  });

  it('keeps unique_violation retryable: the claim insert owns that race', () => {
    expect(isNonRecoverableDbError(dbError('23505'))).toBe(false);
  });

  it('treats connection-class failures as retryable', () => {
    expect(isNonRecoverableDbError(dbError('08006'))).toBe(false);
    expect(isNonRecoverableDbError(dbError('40001'))).toBe(false);
    expect(isNonRecoverableDbError(dbError(undefined))).toBe(false);
  });

  it('ignores errors that are not database failures', () => {
    expect(isNonRecoverableDbError(new Error('anything'))).toBe(false);
    expect(isNonRecoverableDbError('not even an error')).toBe(false);
  });
});
