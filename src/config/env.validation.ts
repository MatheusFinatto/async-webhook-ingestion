const APP_ROLES = ['api', 'worker'] as const;
const LOG_LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;

// Every var read through Number(...) somewhere in the app. A value like "" or
// "abc" would silently become 0/NaN and change behaviour (tolerance 0 rejects
// every webhook; MAX_PROCESSING_ATTEMPTS 0 dead-letters on the first failure).
const POSITIVE_INT_VARS = [
  'PORT',
  'POSTGRES_PORT',
  'RABBITMQ_PORT',
  'PUBLISH_CONFIRM_TIMEOUT_MS',
  'WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS',
  'MAX_PROCESSING_ATTEMPTS',
  'RABBITMQ_PREFETCH',
  'POSTGRES_POOL_SIZE',
  'RATE_LIMIT_TTL_SECONDS',
  'RATE_LIMIT_MAX',
  'WORKER_METRICS_PORT',
] as const;

// Secrets the HTTP boundary compares against. An empty HMAC secret is
// fail-open: anyone can compute a valid signature with the empty key.
const API_SECRET_VARS = ['WEBHOOK_HMAC_SECRET', 'ADMIN_API_KEY'] as const;

function present(
  env: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function validateEnv(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  const role = present(env, 'APP_ROLE') ?? 'api';
  if (!(APP_ROLES as readonly string[]).includes(role)) {
    errors.push(
      `APP_ROLE must be one of [${APP_ROLES.join(', ')}], got "${role}"`,
    );
  }

  if (role !== 'worker') {
    for (const key of API_SECRET_VARS) {
      if (!present(env, key)) {
        errors.push(
          `${key} must be set to a non-empty value; an empty secret would leave the boundary open`,
        );
      }
    }
  }

  for (const key of POSITIVE_INT_VARS) {
    const value = present(env, key);
    if (value !== undefined && !/^[1-9]\d*$/.test(value)) {
      errors.push(`${key} must be a positive integer, got "${value}"`);
    }
  }

  const logLevel = present(env, 'LOG_LEVEL');
  if (logLevel && !(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    errors.push(
      `LOG_LEVEL must be one of [${LOG_LEVELS.join(', ')}], got "${logLevel}"`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n- ${errors.join('\n- ')}`);
  }

  // Drop empty-string vars (".env" placeholders like RABBITMQ_URL=) so that
  // `config.get(...) ?? default` falls back instead of reading "".
  return Object.fromEntries(
    Object.entries(env).filter(
      ([, value]) => !(typeof value === 'string' && value.length === 0),
    ),
  );
}
