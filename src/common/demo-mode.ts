export function isDemoMode(
  value: string | undefined = process.env.DEMO_MODE,
): boolean {
  return value === 'true';
}

export const DEFAULT_WEB_ORIGIN = 'http://localhost:5173';

export function demoWebOrigin(
  value: string | undefined = process.env.WEB_ORIGIN,
): string {
  return value && value.length > 0 ? value : DEFAULT_WEB_ORIGIN;
}

export function assertDemoModeAllowed(
  demoMode: boolean = isDemoMode(),
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (demoMode && nodeEnv === 'production') {
    throw new Error(
      'DEMO_MODE is not allowed with NODE_ENV=production: it exposes public HMAC and admin credentials',
    );
  }
}
