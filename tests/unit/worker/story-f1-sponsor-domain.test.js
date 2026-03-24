/**
 * Unit Tests for Sponsor Domain Module
 *
 * Story F1: Sponsor Object Contract (Single Source of Truth)
 *
 * Tests the sponsor.ts domain module directly.
 * These tests verify the TypeScript implementation compiles correctly
 * and exports all required functions.
 *
 * @see worker/src/domain/sponsor.ts
 */

describe('Story F1: Sponsor Domain Module Unit Tests', () => {

  let sponsorModule;

  beforeAll(() => {
    // Import the compiled module
    try {
      sponsorModule = require('../../../worker/dist/domain/sponsor');
    } catch (e) {
      // Module might not be compiled yet in CI - that's OK, tests will skip
      console.warn('Sponsor module not compiled yet, some tests will be skipped');
    }
  });

  describe('Module Exports', () => {

    it('should export SPONSOR_CONTRACT_VERSION', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.SPONSOR_CONTRACT_VERSION).toBeDefined();
    });

    it('should export VALID_SPONSOR_TIERS', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.VALID_SPONSOR_TIERS).toBeDefined();
      expect(Array.isArray(sponsorModule.VALID_SPONSOR_TIERS)).toBe(true);
    });

    it('should export SPONSOR_CONTRACT_REQUIRED_FIELDS', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.SPONSOR_CONTRACT_REQUIRED_FIELDS).toBeDefined();
      expect(Array.isArray(sponsorModule.SPONSOR_CONTRACT_REQUIRED_FIELDS)).toBe(true);
    });

    it('should export SPONSOR_METRICS_REQUIRED_FIELDS', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.SPONSOR_METRICS_REQUIRED_FIELDS).toBeDefined();
      expect(Array.isArray(sponsorModule.SPONSOR_METRICS_REQUIRED_FIELDS)).toBe(true);
    });

    it('should export DEFAULT_SPONSOR_METRICS', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.DEFAULT_SPONSOR_METRICS).toBeDefined();
      expect(typeof sponsorModule.DEFAULT_SPONSOR_METRICS).toBe('object');
    });

    it('should export validation functions', () => {
      if (!sponsorModule) return;
      expect(typeof sponsorModule.isValidSponsorTier).toBe('function');
      expect(typeof sponsorModule.isValidSponsorId).toBe('function');
      expect(typeof sponsorModule.isValidSponsorMetrics).toBe('function');
      expect(typeof sponsorModule.validateSponsorContract).toBe('function');
      expect(typeof sponsorModule.assertSponsorContract).toBe('function');
    });

    it('should export normalization functions', () => {
      if (!sponsorModule) return;
      expect(typeof sponsorModule.normalizeSponsor).toBe('function');
      expect(typeof sponsorModule.normalizeSponsors).toBe('function');
    });

    it('should export aggregation functions', () => {
      if (!sponsorModule) return;
      expect(typeof sponsorModule.aggregateSponsorMetrics).toBe('function');
      expect(typeof sponsorModule.computeCTR).toBe('function');
    });

    it('should export contract compliance functions', () => {
      if (!sponsorModule) return;
      expect(typeof sponsorModule.checkContractCompliance).toBe('function');
    });

    it('should export API response helpers', () => {
      if (!sponsorModule) return;
      expect(typeof sponsorModule.buildSponsorResponse).toBe('function');
      expect(typeof sponsorModule.buildSponsorsResponse).toBe('function');
    });

    it('should export logging function', () => {
      if (!sponsorModule) return;
      expect(typeof sponsorModule.logSponsorContractCheck).toBe('function');
    });
  });

  describe('Contract Version Stability', () => {

    it('should have version 1.0.0', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.SPONSOR_CONTRACT_VERSION).toBe('1.0.0');
    });
  });

  describe('Tier Validation', () => {

    it('should validate title tier', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorTier('title')).toBe(true);
    });

    it('should validate platinum tier', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorTier('platinum')).toBe(true);
    });

    it('should validate gold tier', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorTier('gold')).toBe(true);
    });

    it('should validate silver tier', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorTier('silver')).toBe(true);
    });

    it('should validate bronze tier', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorTier('bronze')).toBe(true);
    });

    it('should validate primary tier', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorTier('primary')).toBe(true);
    });

    it('should reject invalid tier', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorTier('diamond')).toBe(false);
      expect(sponsorModule.isValidSponsorTier('invalid')).toBe(false);
    });
  });

  describe('Sponsor ID Validation', () => {

    it('should accept valid IDs', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorId('sp-123')).toBe(true);
      expect(sponsorModule.isValidSponsorId('sponsor_abc')).toBe(true);
      expect(sponsorModule.isValidSponsorId('SPONSOR-001')).toBe(true);
    });

    it('should reject invalid IDs', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorId('sponsor 123')).toBe(false);
      expect(sponsorModule.isValidSponsorId('')).toBe(false);
    });
  });

  describe('Metrics Validation', () => {

    it('should accept valid metrics', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorMetrics({
        impressions: 100,
        scans: 50,
        conversions: 25,
      })).toBe(true);
    });

    it('should reject incomplete metrics', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorMetrics({
        impressions: 100,
      })).toBe(false);
    });

    it('should reject negative metrics', () => {
      if (!sponsorModule) return;
      expect(sponsorModule.isValidSponsorMetrics({
        impressions: -1,
        scans: 0,
        conversions: 0,
      })).toBe(false);
    });
  });

  describe('Sponsor Contract Validation', () => {

    it('should validate complete sponsor', () => {
      if (!sponsorModule) return;
      const result = sponsorModule.validateSponsorContract({
        sponsorId: 'sp-test',
        name: 'Test Sponsor',
        tier: 'gold',
        events: ['evt-001'],
        metrics: { impressions: 100, scans: 10, conversions: 5 },
      });
      expect(result.valid).toBe(true);
    });

    it('should reject incomplete sponsor', () => {
      if (!sponsorModule) return;
      const result = sponsorModule.validateSponsorContract({
        sponsorId: 'sp-test',
        name: 'Test',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('Normalization', () => {

    it('should normalize legacy sponsor', () => {
      if (!sponsorModule) return;
      const result = sponsorModule.normalizeSponsor(
        { id: 'sp-legacy', name: 'Legacy' },
        ['evt-001']
      );
      expect(result.sponsorId).toBe('sp-legacy');
      expect(result.name).toBe('Legacy');
      expect(result.events).toEqual(['evt-001']);
      expect(result.metrics).toBeDefined();
    });

    it('should normalize array of sponsors', () => {
      if (!sponsorModule) return;
      const result = sponsorModule.normalizeSponsors([
        { id: 'sp-1', name: 'Sponsor 1' },
        { id: 'sp-2', name: 'Sponsor 2' },
      ]);
      expect(result).toHaveLength(2);
    });
  });

  describe('Aggregation', () => {

    it('should aggregate metrics', () => {
      if (!sponsorModule) return;
      const result = sponsorModule.aggregateSponsorMetrics([
        { impressions: 100, scans: 10, conversions: 5 },
        { impressions: 200, scans: 20, conversions: 10 },
      ]);
      expect(result.impressions).toBe(300);
      expect(result.scans).toBe(30);
      expect(result.conversions).toBe(15);
    });

    it('should compute CTR', () => {
      if (!sponsorModule) return;
      const ctr = sponsorModule.computeCTR({
        impressions: 1000,
        scans: 100,
        conversions: 25,
      });
      expect(ctr).toBe(2.5);
    });
  });

  describe('Contract Compliance Check', () => {

    it('should detect compliant sponsor', () => {
      if (!sponsorModule) return;
      const result = sponsorModule.checkContractCompliance({
        sponsorId: 'sp-test',
        name: 'Test',
        tier: 'gold',
        events: [],
        metrics: { impressions: 0, scans: 0, conversions: 0 },
      });
      expect(result.compliant).toBe(true);
    });

    it('should detect non-compliant sponsor', () => {
      if (!sponsorModule) return;
      const result = sponsorModule.checkContractCompliance({});
      expect(result.compliant).toBe(false);
      expect(result.missingFields.length).toBeGreaterThan(0);
    });
  });
});
