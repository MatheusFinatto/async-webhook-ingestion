import { timingSafeEqualString } from './timing-safe';

describe('timingSafeEqualString', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualString('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeEqualString('abc123', 'abc124')).toBe(false);
  });

  it('returns false without throwing when lengths differ', () => {
    expect(() => timingSafeEqualString('short', 'a'.repeat(512))).not.toThrow();
    expect(timingSafeEqualString('short', 'a'.repeat(512))).toBe(false);
  });
});
