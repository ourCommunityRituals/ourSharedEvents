/**
 * Sponsor Tier Normalization Tests
 * Tests the isPrimary → tier coercion logic applied during D1 migration.
 * Valid tiers per sponsor.schema.json: title, platinum, gold, silver, bronze, primary
 * Legacy isPrimary boolean coerces to: true → 'title', false → 'primary'
 * Story: OUR-23 / isPrimary→tier migration
 * Updated: OSE-168 fix (0018_fix_sponsor_tier_default.sql)
 */

function normalizeSponsorTier(input) {
  const validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
  let tier = 'primary';
  if (input.tier) {
    tier = validTiers.includes(input.tier) ? input.tier : 'primary';
  } else if (typeof input.isPrimary !== 'undefined') {
    tier = input.isPrimary ? 'title' : 'primary';
  }
  return tier;
}

describe('normalizeSponsorTier', () => {
  describe('tier field (current schema)', () => {
    test('returns "primary" as default when no tier or legacy isPrimary present', () => {
      expect(normalizeSponsorTier({})).toBe('primary');
    });

    test('preserves tier: "title"', () => {
      expect(normalizeSponsorTier({ tier: 'title' })).toBe('title');
    });

    test('preserves tier: "platinum"', () => {
      expect(normalizeSponsorTier({ tier: 'platinum' })).toBe('platinum');
    });

    test('preserves tier: "gold"', () => {
      expect(normalizeSponsorTier({ tier: 'gold' })).toBe('gold');
    });

    test('preserves tier: "silver"', () => {
      expect(normalizeSponsorTier({ tier: 'silver' })).toBe('silver');
    });

    test('preserves tier: "bronze"', () => {
      expect(normalizeSponsorTier({ tier: 'bronze' })).toBe('bronze');
    });

    test('preserves tier: "primary"', () => {
      expect(normalizeSponsorTier({ tier: 'primary' })).toBe('primary');
    });

    test('rejects invalid tier — falls back to "primary" (OSE-168)', () => {
      expect(normalizeSponsorTier({ tier: 'standard' })).toBe('primary');
      expect(normalizeSponsorTier({ tier: 'premium' })).toBe('primary');
      expect(normalizeSponsorTier({ tier: 'local' })).toBe('primary');
      expect(normalizeSponsorTier({ tier: 'med' })).toBe('primary');
    });

    test('tier takes precedence over legacy isPrimary (intentional coercion)', () => {
      expect(normalizeSponsorTier({ tier: 'gold', isPrimary: true })).toBe('gold');
      expect(normalizeSponsorTier({ tier: 'bronze', isPrimary: true })).toBe('bronze');
    });
  });

  describe('legacy isPrimary → tier coercion (intentional — tests backward compat)', () => {
    test('coerces isPrimary: true → "title" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: true })).toBe('title');
    });

    test('coerces isPrimary: false → "primary" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: false })).toBe('primary');
    });

    test('coerces isPrimary: 1 (truthy) → "title" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: 1 })).toBe('title');
    });

    test('coerces isPrimary: 0 (falsy) → "primary" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: 0 })).toBe('primary');
    });

    test('coerces isPrimary: "" (empty string) → "primary" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: '' })).toBe('primary');
    });

    test('coerces isPrimary: null → "primary" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: null })).toBe('primary');
    });

    test('coerces isPrimary: undefined → "primary" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: undefined })).toBe('primary');
    });
  });

  describe('edge cases (malformed input)', () => {
    test('handles empty string tier — falls back to "primary"', () => {
      expect(normalizeSponsorTier({ tier: '' })).toBe('primary');
    });

    test('handles null tier — falls back to "primary"', () => {
      expect(normalizeSponsorTier({ tier: null })).toBe('primary');
    });

    test('handles empty object — returns "primary"', () => {
      expect(normalizeSponsorTier({})).toBe('primary');
    });
  });
});
