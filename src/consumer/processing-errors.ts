import { QueryFailedError } from 'typeorm';

export class TransientProcessingError extends Error {
  constructor(message = 'transient processing failure') {
    super(message);
    this.name = 'TransientProcessingError';
  }
}

export class PermanentProcessingError extends Error {
  constructor(message = 'permanent processing failure') {
    super(message);
    this.name = 'PermanentProcessingError';
  }
}

// SQLSTATE classes 22 (data exception) and 23 (integrity violation) are
// deterministic for a given message: a value too long or a null where the
// schema forbids one fails identically on every redelivery. Requeueing such a
// message spins forever; it has to dead-letter instead. 23505
// (unique_violation) stays out: the claim INSERT handles it by design, so a
// surviving one points at a race worth retrying, not at a poison payload.
const NON_RECOVERABLE_SQLSTATE = /^(22|23)/;
const UNIQUE_VIOLATION = '23505';

export function isNonRecoverableDbError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const code = (error.driverError as { code?: unknown } | undefined)?.code;
  return (
    typeof code === 'string' &&
    NON_RECOVERABLE_SQLSTATE.test(code) &&
    code !== UNIQUE_VIOLATION
  );
}
