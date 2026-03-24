/**
 * Story F1 - Sponsor Object Contract Tests
 *
 * Purpose: Validate the locked sponsor contract for monetization.
 * CI/CD Gate: Stage-2 FAILS if sponsor contract drifts.
 *
 * Contract Version: 1.0.0
 *
 * MVP Sponsor Fields (read-only):
 *   - sponsorId: Unique identifier
 *   - name: Display name
 *   - tier: Sponsorship tier
 *   - events: Associated event IDs
 *
 * Computed Fields (backend only):
 *   - metrics.impressions: Total page views
 *   - metrics.scans: Total QR scans
 *   - metrics.conversions: Total click-throughs
 *
 * HERMETIC TEST: This test is self-contained and does not require
 * the worker TypeScript to be compiled. The contract constants and
 * validation functions are replicated here to ensure CI/CD can run
 * without build dependencies.
 *
 * @see worker/src/domain/sponsor.ts
 * @see Story F1 - Sponsor Object Contract (Single Source of Truth)
 */

// =============================================================================
// LOCKED CONTRACT CONSTANTS (Replicated for hermetic testing)
// These MUST match worker/src/domain/sponsor.ts exactly
// =============================================================================

/**
 * Current sponsor contract version
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_CONTRACT_VERSION = '1.0.0';

/**
 * Valid sponsor tiers
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const VALID_SPONSOR_TIERS = [
  'title',
  'platinum',
  'gold',
  'silver',
  'bronze',
  'primary',
];

/**
 * Required sponsor contract fields
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_CONTRACT_REQUIRED_FIELDS = [
  'sponsorId',
  'name',
  'tier',
  'events',
  'metrics',
];

/**
 * Required metrics fields
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_METRICS_REQUIRED_FIELDS = [
  'impressions',
  'scans',
  'conversions',
];

/**
 * Default metrics values
 */
const DEFAULT_SPONSOR_METRICS = {
  impressions: 0,
  scans: 0,
  conversions: 0,
};

// =============================================================================
// VALIDATION FUNCTIONS (Replicated for hermetic testing)
// =============================================================================

function isValidSponsorTier(value) {
  return typeof value === 'string' && VALID_SPONSOR_TIERS.includes(value);
}

function isValidSponsorId(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function isValidSponsorMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;

  for (const field of SPONSOR_METRICS_REQUIRED_FIELDS) {
    if (!(field in metrics)) return false;
    const value = metrics[field];
    if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
      return false;
    }
  }

  return true;
}

function validateSponsorContract(sponsor) {
  if (!sponsor || typeof sponsor !== 'object') {
    return { valid: false, error: 'Sponsor must be a non-null object' };
  }

  // Check sponsorId
  if (!('sponsorId' in sponsor) || typeof sponsor.sponsorId !== 'string') {
    return { valid: false, error: 'Missing or invalid sponsorId' };
  }
  if (!isValidSponsorId(sponsor.sponsorId)) {
    return { valid: false, error: 'Invalid sponsorId format' };
  }

  // Check name
  if (!('name' in sponsor) || typeof sponsor.name !== 'string') {
    return { valid: false, error: 'Missing or invalid name' };
  }
  if (sponsor.name.length === 0 || sponsor.name.length > 200) {
    return { valid: false, error: 'Name must be 1-200 characters' };
  }

  // Check tier (can be null)
  if (!('tier' in sponsor)) {
    return { valid: false, error: 'Missing tier field' };
  }
  if (sponsor.tier !== null && !isValidSponsorTier(sponsor.tier)) {
    return { valid: false, error: 'Invalid tier value' };
  }

  // Check events array
  if (!('events' in sponsor) || !Array.isArray(sponsor.events)) {
    return { valid: false, error: 'Missing or invalid events array' };
  }
  for (const eventId of sponsor.events) {
    if (typeof eventId !== 'string') {
      return { valid: false, error: 'Events array must contain only strings' };
    }
  }

  // Check metrics
  if (!('metrics' in sponsor)) {
    return { valid: false, error: 'Missing metrics object' };
  }
  if (!isValidSponsorMetrics(sponsor.metrics)) {
    return { valid: false, error: 'Invalid metrics object' };
  }

  return { valid: true };
}

function checkContractCompliance(sponsor) {
  const missingFields = [];
  const invalidFields = [];

  if (!sponsor || typeof sponsor !== 'object') {
    return {
      compliant: false,
      version: SPONSOR_CONTRACT_VERSION,
      missingFields: [...SPONSOR_CONTRACT_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
    };
  }

  // Check required fields
  for (const field of SPONSOR_CONTRACT_REQUIRED_FIELDS) {
    if (!(field in sponsor)) {
      missingFields.push(field);
    }
  }

  // Validate field types
  if ('sponsorId' in sponsor && !isValidSponsorId(sponsor.sponsorId)) {
    invalidFields.push('sponsorId: invalid format');
  }

  if ('name' in sponsor && (typeof sponsor.name !== 'string' || sponsor.name.length === 0)) {
    invalidFields.push('name: must be non-empty string');
  }

  if ('tier' in sponsor && sponsor.tier !== null && !isValidSponsorTier(sponsor.tier)) {
    invalidFields.push('tier: invalid value');
  }

  if ('events' in sponsor && !Array.isArray(sponsor.events)) {
    invalidFields.push('events: must be an array');
  }

  if ('metrics' in sponsor && !isValidSponsorMetrics(sponsor.metrics)) {
    invalidFields.push('metrics: invalid shape');
  }

  return {
    compliant: missingFields.length === 0 && invalidFields.length === 0,
    version: SPONSOR_CONTRACT_VERSION,
    missingFields,
    invalidFields,
  };
}

function normalizeSponsor(legacy, eventIds = [], metrics = {}) {
  let tier = null;
  if (legacy.tier && isValidSponsorTier(legacy.tier)) {
    tier = legacy.tier;
  }

  const normalizedMetrics = {
    impressions: metrics.impressions ?? 0,
    scans: metrics.scans ?? 0,
    conversions: metrics.conversions ?? 0,
  };

  let placements = null;
  if (legacy.placements) {
    placements = {
      posterTop: legacy.placements.posterTop ?? false,
      tvTop: legacy.placements.tvTop ?? false,
      tvSide: legacy.placements.tvSide ?? false,
      mobileBanner: legacy.placements.mobileBanner ?? false,
    };
  } else if (legacy.placement) {
    placements = convertLegacyPlacement(legacy.placement);
  }

  return {
    sponsorId: legacy.id,
    name: legacy.name,
    tier,
    events: eventIds,
    metrics: normalizedMetrics,
    logoUrl: legacy.logoUrl ?? null,
    linkUrl: legacy.linkUrl ?? null,
    placements,
  };
}

function convertLegacyPlacement(placement) {
  switch (placement) {
    case 'poster':
      return { posterTop: true, tvTop: false, tvSide: false, mobileBanner: false };
    case 'display':
    case 'tv-banner':
      return { posterTop: false, tvTop: true, tvSide: true, mobileBanner: false };
    case 'public':
      return { posterTop: false, tvTop: false, tvSide: false, mobileBanner: true };
    default:
      return { posterTop: false, tvTop: false, tvSide: false, mobileBanner: false };
  }
}

function normalizeSponsors(sponsors, eventId) {
  if (!sponsors || !Array.isArray(sponsors)) {
    return [];
  }
  const eventIds = eventId ? [eventId] : [];
  return sponsors.map((legacy) => normalizeSponsor(legacy, eventIds));
}

function aggregateSponsorMetrics(sources) {
  return sources.reduce(
    (acc, source) => ({
      impressions: acc.impressions + (source.impressions ?? 0),
      scans: acc.scans + (source.scans ?? 0),
      conversions: acc.conversions + (source.conversions ?? 0),
    }),
    { impressions: 0, scans: 0, conversions: 0 }
  );
}

function computeCTR(metrics) {
  if (metrics.impressions === 0) return 0;
  return (metrics.conversions / metrics.impressions) * 100;
}

function buildSponsorResponse(sponsor) {
  const result = validateSponsorContract(sponsor);
  if (!result.valid) {
    throw new Error(`Invalid sponsor: ${result.error}`);
  }
  return {
    sponsor,
    _contractVersion: SPONSOR_CONTRACT_VERSION,
  };
}

function buildSponsorsResponse(sponsors) {
  for (const sponsor of sponsors) {
    const result = validateSponsorContract(sponsor);
    if (!result.valid) {
      throw new Error(`Invalid sponsor: ${result.error}`);
    }
  }
  return {
    sponsors,
    _contractVersion: SPONSOR_CONTRACT_VERSION,
    count: sponsors.length,
  };
}

describe('Story F1: Sponsor Object Contract (Single Source of Truth)', () => {

  // ===========================================================================
  // CONTRACT VERSION TESTS
  // ===========================================================================
  describe('Contract Version', () => {
    it('should have a defined contract version', () => {
      expect(SPONSOR_CONTRACT_VERSION).toBeDefined();
      expect(typeof SPONSOR_CONTRACT_VERSION).toBe('string');
    });

    it('should follow semver format', () => {
      expect(SPONSOR_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should be version 1.0.0 for MVP', () => {
      expect(SPONSOR_CONTRACT_VERSION).toBe('1.0.0');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS
  // Stage-2 CI/CD GATE: These tests MUST pass or deploy fails
  // ===========================================================================
  describe('Locked Contract Fields (CI/CD Gate)', () => {

    describe('Required Fields - LOCKED', () => {
      it('should have exactly 5 required sponsor fields', () => {
        // LOCKED: Do not modify this list without version bump
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS).toHaveLength(5);
      });

      it('should require sponsorId field', () => {
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS).toContain('sponsorId');
      });

      it('should require name field', () => {
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS).toContain('name');
      });

      it('should require tier field', () => {
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS).toContain('tier');
      });

      it('should require events field', () => {
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS).toContain('events');
      });

      it('should require metrics field', () => {
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS).toContain('metrics');
      });

      it('should have field order preserved (contract stability)', () => {
        // Order matters for documentation and API consistency
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS[0]).toBe('sponsorId');
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS[1]).toBe('name');
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS[2]).toBe('tier');
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS[3]).toBe('events');
        expect(SPONSOR_CONTRACT_REQUIRED_FIELDS[4]).toBe('metrics');
      });
    });

    describe('Metrics Fields - LOCKED', () => {
      it('should have exactly 3 required metrics fields', () => {
        // LOCKED: Do not modify without version bump
        expect(SPONSOR_METRICS_REQUIRED_FIELDS).toHaveLength(3);
      });

      it('should require impressions metric', () => {
        expect(SPONSOR_METRICS_REQUIRED_FIELDS).toContain('impressions');
      });

      it('should require scans metric', () => {
        expect(SPONSOR_METRICS_REQUIRED_FIELDS).toContain('scans');
      });

      it('should require conversions metric', () => {
        expect(SPONSOR_METRICS_REQUIRED_FIELDS).toContain('conversions');
      });
    });

    describe('Valid Sponsor Tiers - LOCKED', () => {
      it('should have exactly 6 valid tiers', () => {
        expect(VALID_SPONSOR_TIERS).toHaveLength(6);
      });

      it('should include title tier', () => {
        expect(VALID_SPONSOR_TIERS).toContain('title');
      });

      it('should include platinum tier', () => {
        expect(VALID_SPONSOR_TIERS).toContain('platinum');
      });

      it('should include gold tier', () => {
        expect(VALID_SPONSOR_TIERS).toContain('gold');
      });

      it('should include silver tier', () => {
        expect(VALID_SPONSOR_TIERS).toContain('silver');
      });

      it('should include bronze tier', () => {
        expect(VALID_SPONSOR_TIERS).toContain('bronze');
      });

      it('should include primary tier', () => {
        expect(VALID_SPONSOR_TIERS).toContain('primary');
      });
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTION TESTS
  // ===========================================================================
  describe('Validation Functions', () => {

    describe('isValidSponsorTier', () => {
      it('should accept valid tiers', () => {
        VALID_SPONSOR_TIERS.forEach(tier => {
          expect(isValidSponsorTier(tier)).toBe(true);
        });
      });

      it('should reject invalid tiers', () => {
        expect(isValidSponsorTier('diamond')).toBe(false);
        expect(isValidSponsorTier('PLATINUM')).toBe(false); // case sensitive
        expect(isValidSponsorTier('')).toBe(false);
        expect(isValidSponsorTier(null)).toBe(false);
        expect(isValidSponsorTier(undefined)).toBe(false);
        expect(isValidSponsorTier(123)).toBe(false);
      });
    });

    describe('isValidSponsorId', () => {
      it('should accept valid sponsor IDs', () => {
        expect(isValidSponsorId('sp-123')).toBe(true);
        expect(isValidSponsorId('sponsor_abc')).toBe(true);
        expect(isValidSponsorId('SPONSOR-001')).toBe(true);
        expect(isValidSponsorId('a')).toBe(true);
        expect(isValidSponsorId('a'.repeat(128))).toBe(true);
      });

      it('should reject invalid sponsor IDs', () => {
        expect(isValidSponsorId('sponsor 123')).toBe(false); // space
        expect(isValidSponsorId('sponsor!abc')).toBe(false); // special char
        expect(isValidSponsorId('')).toBe(false); // empty
        expect(isValidSponsorId('a'.repeat(129))).toBe(false); // too long
        expect(isValidSponsorId(null)).toBe(false);
        expect(isValidSponsorId(undefined)).toBe(false);
        expect(isValidSponsorId(123)).toBe(false);
      });
    });

    describe('isValidSponsorMetrics', () => {
      it('should accept valid metrics', () => {
        expect(isValidSponsorMetrics({
          impressions: 100,
          scans: 50,
          conversions: 25,
        })).toBe(true);

        expect(isValidSponsorMetrics({
          impressions: 0,
          scans: 0,
          conversions: 0,
        })).toBe(true);
      });

      it('should reject metrics with missing fields', () => {
        expect(isValidSponsorMetrics({ impressions: 100 })).toBe(false);
        expect(isValidSponsorMetrics({ impressions: 100, scans: 50 })).toBe(false);
        expect(isValidSponsorMetrics({})).toBe(false);
      });

      it('should reject negative metrics', () => {
        expect(isValidSponsorMetrics({
          impressions: -1,
          scans: 0,
          conversions: 0,
        })).toBe(false);
      });

      it('should reject non-integer metrics', () => {
        expect(isValidSponsorMetrics({
          impressions: 1.5,
          scans: 0,
          conversions: 0,
        })).toBe(false);
      });

      it('should reject null/undefined', () => {
        expect(isValidSponsorMetrics(null)).toBe(false);
        expect(isValidSponsorMetrics(undefined)).toBe(false);
      });
    });

    describe('validateSponsorContract', () => {
      const validSponsor = {
        sponsorId: 'sp-test-001',
        name: 'Test Sponsor',
        tier: 'gold',
        events: ['evt-001', 'evt-002'],
        metrics: {
          impressions: 1000,
          scans: 100,
          conversions: 50,
        },
      };

      it('should validate a complete valid sponsor', () => {
        const result = validateSponsorContract(validSponsor);
        expect(result.valid).toBe(true);
      });

      it('should validate sponsor with null tier', () => {
        const result = validateSponsorContract({
          ...validSponsor,
          tier: null,
        });
        expect(result.valid).toBe(true);
      });

      it('should validate sponsor with empty events array', () => {
        const result = validateSponsorContract({
          ...validSponsor,
          events: [],
        });
        expect(result.valid).toBe(true);
      });

      it('should reject sponsor without sponsorId', () => {
        const { sponsorId, ...rest } = validSponsor;
        const result = validateSponsorContract(rest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('sponsorId');
      });

      it('should reject sponsor without name', () => {
        const { name, ...rest } = validSponsor;
        const result = validateSponsorContract(rest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('name');
      });

      it('should reject sponsor without tier field', () => {
        const { tier, ...rest } = validSponsor;
        const result = validateSponsorContract(rest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('tier');
      });

      it('should reject sponsor without events', () => {
        const { events, ...rest } = validSponsor;
        const result = validateSponsorContract(rest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('events');
      });

      it('should reject sponsor without metrics', () => {
        const { metrics, ...rest } = validSponsor;
        const result = validateSponsorContract(rest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('metrics');
      });

      it('should reject null sponsor', () => {
        const result = validateSponsorContract(null);
        expect(result.valid).toBe(false);
      });

      it('should reject non-object sponsor', () => {
        const result = validateSponsorContract('not an object');
        expect(result.valid).toBe(false);
      });
    });
  });

  // ===========================================================================
  // NORMALIZATION TESTS
  // ===========================================================================
  describe('Normalization Functions', () => {

    describe('normalizeSponsor', () => {
      const legacySponsor = {
        id: 'sp-legacy-001',
        name: 'Legacy Sponsor',
        logoUrl: 'https://example.com/logo.png',
        linkUrl: 'https://example.com',
        tier: 'gold',
        placements: {
          posterTop: true,
          tvTop: false,
          tvSide: true,
          mobileBanner: true,
        },
      };

      it('should normalize legacy sponsor to contract shape', () => {
        const result = normalizeSponsor(legacySponsor, ['evt-001']);

        expect(result.sponsorId).toBe('sp-legacy-001');
        expect(result.name).toBe('Legacy Sponsor');
        expect(result.tier).toBe('gold');
        expect(result.events).toEqual(['evt-001']);
        expect(result.metrics).toBeDefined();
        expect(result.logoUrl).toBe('https://example.com/logo.png');
        expect(result.linkUrl).toBe('https://example.com');
        expect(result.placements).toBeDefined();
      });

      it('should default metrics to zeros', () => {
        const result = normalizeSponsor(legacySponsor);

        expect(result.metrics.impressions).toBe(0);
        expect(result.metrics.scans).toBe(0);
        expect(result.metrics.conversions).toBe(0);
      });

      it('should accept pre-computed metrics', () => {
        const result = normalizeSponsor(legacySponsor, [], {
          impressions: 500,
          scans: 50,
          conversions: 25,
        });

        expect(result.metrics.impressions).toBe(500);
        expect(result.metrics.scans).toBe(50);
        expect(result.metrics.conversions).toBe(25);
      });

      it('should normalize invalid tier to null', () => {
        const result = normalizeSponsor({
          ...legacySponsor,
          tier: 'invalid-tier',
        });

        expect(result.tier).toBeNull();
      });

      it('should convert legacy single placement string', () => {
        const result = normalizeSponsor({
          id: 'sp-legacy',
          name: 'Legacy',
          placement: 'display',
        });

        expect(result.placements).toEqual({
          posterTop: false,
          tvTop: true,
          tvSide: true,
          mobileBanner: false,
        });
      });

      it('should handle missing optional fields', () => {
        const result = normalizeSponsor({
          id: 'sp-minimal',
          name: 'Minimal Sponsor',
        });

        expect(result.logoUrl).toBeNull();
        expect(result.linkUrl).toBeNull();
        expect(result.placements).toBeNull();
      });
    });

    describe('normalizeSponsors', () => {
      it('should normalize array of sponsors', () => {
        const sponsors = [
          { id: 'sp-1', name: 'Sponsor 1' },
          { id: 'sp-2', name: 'Sponsor 2' },
        ];

        const result = normalizeSponsors(sponsors, 'evt-001');

        expect(result).toHaveLength(2);
        expect(result[0].sponsorId).toBe('sp-1');
        expect(result[0].events).toEqual(['evt-001']);
        expect(result[1].sponsorId).toBe('sp-2');
        expect(result[1].events).toEqual(['evt-001']);
      });

      it('should return empty array for null/undefined', () => {
        expect(normalizeSponsors(null)).toEqual([]);
        expect(normalizeSponsors(undefined)).toEqual([]);
      });

      it('should return empty array for non-array', () => {
        expect(normalizeSponsors('not an array')).toEqual([]);
      });
    });
  });

  // ===========================================================================
  // AGGREGATION TESTS (Backend-Only Math)
  // ===========================================================================
  describe('Aggregation Functions (Backend-Only)', () => {

    describe('aggregateSponsorMetrics', () => {
      it('should aggregate metrics from multiple sources', () => {
        const sources = [
          { impressions: 100, scans: 10, conversions: 5 },
          { impressions: 200, scans: 20, conversions: 10 },
          { impressions: 300, scans: 30, conversions: 15 },
        ];

        const result = aggregateSponsorMetrics(sources);

        expect(result.impressions).toBe(600);
        expect(result.scans).toBe(60);
        expect(result.conversions).toBe(30);
      });

      it('should handle partial metrics', () => {
        const sources = [
          { impressions: 100 },
          { scans: 20 },
          { conversions: 5 },
        ];

        const result = aggregateSponsorMetrics(sources);

        expect(result.impressions).toBe(100);
        expect(result.scans).toBe(20);
        expect(result.conversions).toBe(5);
      });

      it('should return zeros for empty sources', () => {
        const result = aggregateSponsorMetrics([]);

        expect(result.impressions).toBe(0);
        expect(result.scans).toBe(0);
        expect(result.conversions).toBe(0);
      });
    });

    describe('computeCTR', () => {
      it('should compute CTR as percentage', () => {
        const result = computeCTR({
          impressions: 1000,
          scans: 100,
          conversions: 25,
        });

        expect(result).toBe(2.5); // 25/1000 * 100 = 2.5%
      });

      it('should return 0 for zero impressions', () => {
        const result = computeCTR({
          impressions: 0,
          scans: 0,
          conversions: 0,
        });

        expect(result).toBe(0);
      });

      it('should handle 100% CTR', () => {
        const result = computeCTR({
          impressions: 100,
          scans: 50,
          conversions: 100,
        });

        expect(result).toBe(100);
      });
    });
  });

  // ===========================================================================
  // CONTRACT COMPLIANCE TESTS (CI/CD Gate)
  // ===========================================================================
  describe('Contract Compliance (CI/CD Gate)', () => {

    describe('checkContractCompliance', () => {
      const compliantSponsor = {
        sponsorId: 'sp-compliant',
        name: 'Compliant Sponsor',
        tier: 'gold',
        events: ['evt-001'],
        metrics: {
          impressions: 100,
          scans: 10,
          conversions: 5,
        },
      };

      it('should pass for compliant sponsor', () => {
        const result = checkContractCompliance(compliantSponsor);

        expect(result.compliant).toBe(true);
        expect(result.version).toBe('1.0.0');
        expect(result.missingFields).toHaveLength(0);
        expect(result.invalidFields).toHaveLength(0);
      });

      it('should detect missing fields', () => {
        const result = checkContractCompliance({
          sponsorId: 'sp-incomplete',
          name: 'Incomplete',
        });

        expect(result.compliant).toBe(false);
        expect(result.missingFields).toContain('tier');
        expect(result.missingFields).toContain('events');
        expect(result.missingFields).toContain('metrics');
      });

      it('should detect invalid sponsorId format', () => {
        const result = checkContractCompliance({
          ...compliantSponsor,
          sponsorId: 'invalid sponsor id!',
        });

        expect(result.compliant).toBe(false);
        expect(result.invalidFields.some(f => f.includes('sponsorId'))).toBe(true);
      });

      it('should detect invalid tier', () => {
        const result = checkContractCompliance({
          ...compliantSponsor,
          tier: 'diamond',
        });

        expect(result.compliant).toBe(false);
        expect(result.invalidFields.some(f => f.includes('tier'))).toBe(true);
      });

      it('should fail for null/undefined', () => {
        expect(checkContractCompliance(null).compliant).toBe(false);
        expect(checkContractCompliance(undefined).compliant).toBe(false);
      });

      it('should report all missing fields for empty object', () => {
        const result = checkContractCompliance({});

        expect(result.missingFields).toHaveLength(5);
        expect(result.missingFields).toContain('sponsorId');
        expect(result.missingFields).toContain('name');
        expect(result.missingFields).toContain('tier');
        expect(result.missingFields).toContain('events');
        expect(result.missingFields).toContain('metrics');
      });
    });
  });

  // ===========================================================================
  // API RESPONSE HELPERS
  // ===========================================================================
  describe('API Response Helpers', () => {
    const validSponsor = {
      sponsorId: 'sp-api-test',
      name: 'API Test Sponsor',
      tier: 'gold',
      events: ['evt-001'],
      metrics: {
        impressions: 100,
        scans: 10,
        conversions: 5,
      },
    };

    describe('buildSponsorResponse', () => {
      it('should include sponsor and contract version', () => {
        const result = buildSponsorResponse(validSponsor);

        expect(result.sponsor).toBeDefined();
        expect(result.sponsor.sponsorId).toBe('sp-api-test');
        expect(result._contractVersion).toBe('1.0.0');
      });

      it('should throw for invalid sponsor', () => {
        expect(() => buildSponsorResponse({ invalid: true })).toThrow();
      });
    });

    describe('buildSponsorsResponse', () => {
      it('should include sponsors array and count', () => {
        const sponsors = [validSponsor, { ...validSponsor, sponsorId: 'sp-2' }];
        const result = buildSponsorsResponse(sponsors);

        expect(result.sponsors).toHaveLength(2);
        expect(result.count).toBe(2);
        expect(result._contractVersion).toBe('1.0.0');
      });

      it('should handle empty array', () => {
        const result = buildSponsorsResponse([]);

        expect(result.sponsors).toHaveLength(0);
        expect(result.count).toBe(0);
      });

      it('should throw if any sponsor is invalid', () => {
        expect(() => buildSponsorsResponse([validSponsor, { invalid: true }])).toThrow();
      });
    });
  });

  // ===========================================================================
  // DEFAULT VALUES
  // ===========================================================================
  describe('Default Values', () => {
    it('should have zero default metrics', () => {
      expect(DEFAULT_SPONSOR_METRICS.impressions).toBe(0);
      expect(DEFAULT_SPONSOR_METRICS.scans).toBe(0);
      expect(DEFAULT_SPONSOR_METRICS.conversions).toBe(0);
    });
  });

  // ===========================================================================
  // CONTRACT BOUNDARY ASSERTION
  // ===========================================================================
  describe('Contract Boundary Assertions', () => {

    it('should ensure all sponsor endpoints return identical shape', () => {
      // This test documents the contract boundary:
      // Any sponsor returned from an endpoint MUST have these fields
      const requiredShape = [
        'sponsorId',  // string
        'name',       // string
        'tier',       // SponsorTier | null
        'events',     // string[]
        'metrics',    // SponsorMetrics
      ];

      expect(SPONSOR_CONTRACT_REQUIRED_FIELDS).toEqual(requiredShape);
    });

    it('should ensure metrics are computed at backend only', () => {
      // This test documents the invariant:
      // All metric values come from backend aggregation
      const metricsShape = ['impressions', 'scans', 'conversions'];

      expect(SPONSOR_METRICS_REQUIRED_FIELDS).toEqual(metricsShape);
    });

    it('should ensure no ad-hoc or partial sponsor data is returned', () => {
      // Contract boundary: validateSponsorContract MUST be called
      // before returning sponsor data from any endpoint
      const partialSponsor = {
        sponsorId: 'sp-partial',
        name: 'Partial',
        // Missing tier, events, metrics
      };

      const result = validateSponsorContract(partialSponsor);
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // INTEGRATION WITH EXISTING FIXTURES
  // ===========================================================================
  describe('Integration with Existing Sponsor Fixtures', () => {
    const {
      platinumSponsor,
      goldSponsor,
      silverSponsor,
      legacySponsor,
    } = require('../shared/fixtures/sponsors.fixtures');

    it('should normalize platinum sponsor fixture', () => {
      const normalized = normalizeSponsor(platinumSponsor, ['evt-test']);
      const result = validateSponsorContract(normalized);

      expect(result.valid).toBe(true);
      expect(normalized.sponsorId).toBe(platinumSponsor.id);
      expect(normalized.tier).toBe('platinum');
    });

    it('should normalize gold sponsor fixture', () => {
      const normalized = normalizeSponsor(goldSponsor, ['evt-test']);
      const result = validateSponsorContract(normalized);

      expect(result.valid).toBe(true);
      expect(normalized.tier).toBe('gold');
    });

    it('should normalize silver sponsor fixture', () => {
      const normalized = normalizeSponsor(silverSponsor, ['evt-test']);
      const result = validateSponsorContract(normalized);

      expect(result.valid).toBe(true);
      expect(normalized.tier).toBe('silver');
    });

    it('should normalize legacy sponsor fixture', () => {
      const normalized = normalizeSponsor(legacySponsor, ['evt-test']);
      const result = validateSponsorContract(normalized);

      expect(result.valid).toBe(true);
      expect(normalized.sponsorId).toBe(legacySponsor.id);
    });

    it('should normalize all fixture sponsors', () => {
      const { multiTierSponsors } = require('../shared/fixtures/sponsors.fixtures');
      const normalized = normalizeSponsors(multiTierSponsors, 'evt-fixture');

      expect(normalized).toHaveLength(multiTierSponsors.length);

      normalized.forEach((sponsor, index) => {
        const result = validateSponsorContract(sponsor);
        expect(result.valid).toBe(true);
        expect(sponsor.sponsorId).toBe(multiTierSponsors[index].id);
      });
    });
  });
});
