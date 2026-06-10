import { assertDemoModeAllowed, isDemoMode } from './demo-mode';

describe('isDemoMode', () => {
  it('is on only for the exact string "true"', () => {
    expect(isDemoMode('true')).toBe(true);
  });

  it.each(['false', 'False', 'TRUE', '1', 'yes', '', ' true', undefined])(
    'is off for %p',
    (value) => {
      expect(isDemoMode(value)).toBe(false);
    },
  );
});

describe('assertDemoModeAllowed', () => {
  it('refuses demo mode in production', () => {
    expect(() => assertDemoModeAllowed(true, 'production')).toThrow(
      /NODE_ENV=production/,
    );
  });

  it('allows demo mode outside production', () => {
    expect(() => assertDemoModeAllowed(true, 'development')).not.toThrow();
    expect(() => assertDemoModeAllowed(true, undefined)).not.toThrow();
  });

  it('allows production when demo mode is off', () => {
    expect(() => assertDemoModeAllowed(false, 'production')).not.toThrow();
  });
});
