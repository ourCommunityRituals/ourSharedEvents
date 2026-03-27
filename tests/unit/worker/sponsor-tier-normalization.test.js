/**
 * Sponsor Tier Normalization Tests
 * Tests the isPrimary → tier coercion logic applied in this migration
 * Story: OUR-23 / isPrimary→tier migration
 */

function normalizeSponsorTier(input) {
  let tier = 'local';
  if (input.tier) {
    const validTiers = ['premium', 'med', 'local'];
    tier = validTiers.includes(input.tier) ? input.tier : 'local';
  } else if (typeof input.isPrimary !== 'undefined') {
    tier = !!input.isPrimary ? 'premium' : 'local';
  }
  return tier;
}

describe('Sponsor tier normalization', () => {
  describe('tier field (new schema)', () => {
    test('returns "local" as default when no tier or isPrimary', () => {
      expect(normalizeSponsorTier({})).toBe('local');
    });

    test('preserves tier: "premium"', () => {
      expect(normalizeSponsorTier({ tier: 'premium' })).toBe('premium');
    });

    test('preserves tier: "med"', () => {
      expect(normalizeSponsorTier({ tier: 'med' })).toBe('med');
    });

    test('preserves tier: "local"', () => {
      expect(normalizeSponsorTier({ tier: 'local' })).toBe('local');
    });

    test('rejects invalid tier — falls back to "local"', () => {
      expect(normalizeSponsorTier({ tier: 'gold' })).toBe('local');
      expect(normalizeSponsorTier({ tier: 'platinum' })).toBe('local');
      expect(normalizeSponsorTier({ tier: 'primary' })).toBe('local');
      expect(normalizeSponsorTier({ tier: 'bronze' })).toBe('local');
    });

    test('tier takes precedence over isPrimary', () => {
      expect(normalizeSponsorTier({ tier: 'med', isPrimary: true })).toBe('med');
      expect(normalizeSponsorTier({ tier: 'local', isPrimary: true })).toBe('local');
    });
  });

  describe('legacy isPrimary coercion', () => {
    test('isPrimary: true → "premium"', () => {
      expect(normalizeSponsorTier({ isPrimary: true })).toBe('premium');
    });

    test('isPrimary: false → "local"', () => {
      expect(normalizeSponsorTier({ isPrimary: false })).toBe('local');
    });

    test('isPrimary: 1 (truthy) → "premium"', () => {
      expect(normalizeSponsorTier({ isPrimary: 1 })).toBe('premium');
    });

    test('isPrimary: 0 (falsy) → "local"', () => {
      expect(normalizeSponsorTier({ isPrimary: 0 })).toBe('local');
    });

    test('isPrimary: "" (empty string) → "local"', () => {
      expect(normalizeSponsorTier({ isPrimary: '' })).toBe('local');
    });

    test('isPrimary: null → "local"', () => {
      expect(normalizeSponsorTier({ isPrimary: null })).toBe('local');
    });

    test('isPrimary: undefined → default "local" (no isPrimary key)', () => {
      expect(normalizeSponsorTier({ isPrimary: undefined })).toBe('local');
    });
  });

  describe('edge cases', () => {
    test('empty string tier falls back to "local"', () => {
      // Empty string is falsy, so isPrimary check runs
      expect(normalizeSponsorTier({ tier: '' })).toBe('local');
    });

    test('null tier falls back to "local"', () => {
      expect(normalizeSponsorTier({ tier: null })).toBe('local');
    });

    test('no sponsor data at all', () => {
      expect(normalizeSponsorTier({})).toBe('local');
    });
  });
});
