import { validateEnv } from './env.validation';

const apiSecrets = {
  WEBHOOK_HMAC_SECRET: 'secret',
  ADMIN_API_KEY: 'admin',
};

describe('validateEnv', () => {
  it('accepts a minimal api environment with secrets set', () => {
    expect(() => validateEnv({ ...apiSecrets })).not.toThrow();
  });

  it('rejects an api environment with a missing or empty HMAC secret', () => {
    expect(() => validateEnv({ ADMIN_API_KEY: 'admin' })).toThrow(
      /WEBHOOK_HMAC_SECRET/,
    );
    expect(() =>
      validateEnv({ ...apiSecrets, WEBHOOK_HMAC_SECRET: '' }),
    ).toThrow(/WEBHOOK_HMAC_SECRET/);
  });

  it('does not require boundary secrets for the worker role', () => {
    expect(() => validateEnv({ APP_ROLE: 'worker' })).not.toThrow();
  });

  it('rejects an unknown APP_ROLE', () => {
    expect(() => validateEnv({ ...apiSecrets, APP_ROLE: 'both' })).toThrow(
      /APP_ROLE/,
    );
  });

  it('rejects numeric vars that would silently become 0 or NaN', () => {
    expect(() =>
      validateEnv({ ...apiSecrets, MAX_PROCESSING_ATTEMPTS: '0' }),
    ).toThrow(/MAX_PROCESSING_ATTEMPTS/);
    expect(() =>
      validateEnv({
        ...apiSecrets,
        WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: 'abc',
      }),
    ).toThrow(/WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS/);
  });

  it('strips empty-string placeholders so ?? defaults apply', () => {
    const validated = validateEnv({ ...apiSecrets, RABBITMQ_URL: '' });
    expect(validated).not.toHaveProperty('RABBITMQ_URL');
    expect(validated.WEBHOOK_HMAC_SECRET).toBe('secret');
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => validateEnv({ ...apiSecrets, LOG_LEVEL: 'trace' })).toThrow(
      /LOG_LEVEL/,
    );
  });
});
