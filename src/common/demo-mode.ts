export function isDemoMode(
  value: string | undefined = process.env.DEMO_MODE,
): boolean {
  return value === 'true';
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
