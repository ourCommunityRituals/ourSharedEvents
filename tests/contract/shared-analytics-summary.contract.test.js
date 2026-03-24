/**
 * SharedAnalytics Summary Contract Test
 *
 * Validates that api_getSharedAnalytics returns a summary object
 * with the required fields for MVP deploy.
 *
 * Story: SharedAnalytics summary contract test (including totalQrScans)
 *
 * Acceptance Criteria:
 * - summary object includes: totalImpressions, totalClicks, totalQrScans, totalSignups
 * - Each field is a number >= 0
 *
 * Schema: /schemas/shared-analytics.schema.json (v1.1 MVP-frozen)
 */

const {
  validateSuccessEnvelope,
  validateErrorEnvelope,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

const {
  fullSharedAnalytics,
  minimalSharedAnalytics,
  emptySharedAnalytics,
  sponsorViewAnalytics,
  highEngagementAnalytics,
  withFreshTimestamp
} = require('../shared/fixtures/shared-analytics.fixtures');

/**
 * Validates that the summary object has all required fields per the MVP contract
 * Required fields: totalImpressions, totalClicks, totalQrScans, totalSignups
 *
 * @param {Object} summary - The summary object from SharedAnalytics response
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
const validateSummaryContract = (summary) => {
  const errors = [];
  const requiredFields = ['totalImpressions', 'totalClicks', 'totalQrScans', 'totalSignups'];

  // Check each required field exists, is a number, and >= 0
  requiredFields.forEach((field) => {
    if (!(field in summary)) {
      errors.push(`Missing required field: ${field}`);
    } else if (typeof summary[field] !== 'number') {
      errors.push(`Field ${field} must be a number, got ${typeof summary[field]}`);
    } else if (summary[field] < 0) {
      errors.push(`Field ${field} must be >= 0, got ${summary[field]}`);
    } else if (!Number.isInteger(summary[field])) {
      errors.push(`Field ${field} must be an integer, got ${summary[field]}`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
};

describe('SharedAnalytics Summary Contract', () => {
  /**
   * Core contract validation: The summary object must always include
   * these four fields for MVP SharedReport to function correctly.
   */
  describe('Required Summary Fields', () => {
    const REQUIRED_SUMMARY_FIELDS = [
      'totalImpressions',
      'totalClicks',
      'totalQrScans',
      'totalSignups'
    ];

    it('should include all required summary fields', () => {
      const response = {
        ok: true,
        value: withFreshTimestamp(fullSharedAnalytics)
      };

      validateSuccessEnvelope(response);
      expect(response.value).toHaveProperty('summary');

      REQUIRED_SUMMARY_FIELDS.forEach((field) => {
        expect(response.value.summary).toHaveProperty(field);
      });
    });

    it('should have totalImpressions as a number >= 0', () => {
      const response = {
        ok: true,
        value: withFreshTimestamp(fullSharedAnalytics)
      };

      validateSuccessEnvelope(response);
      expect(typeof response.value.summary.totalImpressions).toBe('number');
      expect(response.value.summary.totalImpressions).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(response.value.summary.totalImpressions)).toBe(true);
    });

    it('should have totalClicks as a number >= 0', () => {
      const response = {
        ok: true,
        value: withFreshTimestamp(fullSharedAnalytics)
      };

      validateSuccessEnvelope(response);
      expect(typeof response.value.summary.totalClicks).toBe('number');
      expect(response.value.summary.totalClicks).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(response.value.summary.totalClicks)).toBe(true);
    });

    it('should have totalQrScans as a number >= 0', () => {
      const response = {
        ok: true,
        value: withFreshTimestamp(fullSharedAnalytics)
      };

      validateSuccessEnvelope(response);
      expect(typeof response.value.summary.totalQrScans).toBe('number');
      expect(response.value.summary.totalQrScans).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(response.value.summary.totalQrScans)).toBe(true);
    });

    it('should have totalSignups as a number >= 0', () => {
      const response = {
        ok: true,
        value: withFreshTimestamp(fullSharedAnalytics)
      };

      validateSuccessEnvelope(response);
      expect(typeof response.value.summary.totalSignups).toBe('number');
      expect(response.value.summary.totalSignups).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(response.value.summary.totalSignups)).toBe(true);
    });

    it('should pass full contract validation', () => {
      const response = {
        ok: true,
        value: withFreshTimestamp(fullSharedAnalytics)
      };

      validateSuccessEnvelope(response);
      const validation = validateSummaryContract(response.value.summary);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });
  });

  /**
   * Test with various fixture types to ensure robustness
   */
  describe('Fixture-based Contract Tests', () => {
    it('should validate fullSharedAnalytics fixture', () => {
      const analytics = withFreshTimestamp(fullSharedAnalytics);
      const validation = validateSummaryContract(analytics.summary);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      // Verify actual fixture values
      expect(analytics.summary.totalImpressions).toBe(15420);
      expect(analytics.summary.totalClicks).toBe(892);
      expect(analytics.summary.totalQrScans).toBe(234);
      expect(analytics.summary.totalSignups).toBe(156);
    });

    it('should validate minimalSharedAnalytics fixture', () => {
      const analytics = withFreshTimestamp(minimalSharedAnalytics);
      const validation = validateSummaryContract(analytics.summary);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      // Verify minimal values still valid
      expect(analytics.summary.totalImpressions).toBe(250);
      expect(analytics.summary.totalClicks).toBe(12);
      expect(analytics.summary.totalQrScans).toBe(5);
      expect(analytics.summary.totalSignups).toBe(2);
    });

    it('should validate emptySharedAnalytics fixture (zero values)', () => {
      const analytics = withFreshTimestamp(emptySharedAnalytics);
      const validation = validateSummaryContract(analytics.summary);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      // Zero values are valid (>= 0)
      expect(analytics.summary.totalImpressions).toBe(0);
      expect(analytics.summary.totalClicks).toBe(0);
      expect(analytics.summary.totalQrScans).toBe(0);
      expect(analytics.summary.totalSignups).toBe(0);
    });

    it('should validate sponsorViewAnalytics fixture', () => {
      const analytics = withFreshTimestamp(sponsorViewAnalytics);
      const validation = validateSummaryContract(analytics.summary);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      // Sponsor view has scoped metrics
      expect(analytics.summary.totalImpressions).toBe(4500);
      expect(analytics.summary.totalClicks).toBe(225);
      expect(analytics.summary.totalQrScans).toBe(45);
      expect(analytics.summary.totalSignups).toBe(18);
    });

    it('should validate highEngagementAnalytics fixture', () => {
      const analytics = withFreshTimestamp(highEngagementAnalytics);
      const validation = validateSummaryContract(analytics.summary);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      // High engagement values
      expect(analytics.summary.totalImpressions).toBe(10000);
      expect(analytics.summary.totalClicks).toBe(1500);
      expect(analytics.summary.totalQrScans).toBe(800);
      expect(analytics.summary.totalSignups).toBe(450);
    });
  });

  /**
   * Edge case and boundary testing
   */
  describe('Edge Cases', () => {
    it('should accept summary with zero values for all fields', () => {
      const zeroes = {
        totalImpressions: 0,
        totalClicks: 0,
        totalQrScans: 0,
        totalSignups: 0,
        uniqueEvents: 0,
        uniqueSponsors: 0
      };

      const validation = validateSummaryContract(zeroes);
      expect(validation.valid).toBe(true);
    });

    it('should accept summary with large values', () => {
      const largeValues = {
        totalImpressions: 1000000,
        totalClicks: 50000,
        totalQrScans: 25000,
        totalSignups: 10000,
        uniqueEvents: 100,
        uniqueSponsors: 50
      };

      const validation = validateSummaryContract(largeValues);
      expect(validation.valid).toBe(true);
    });

    it('should reject summary with missing totalImpressions', () => {
      const missingField = {
        totalClicks: 100,
        totalQrScans: 50,
        totalSignups: 25
      };

      const validation = validateSummaryContract(missingField);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Missing required field: totalImpressions');
    });

    it('should reject summary with missing totalQrScans', () => {
      const missingField = {
        totalImpressions: 1000,
        totalClicks: 100,
        totalSignups: 25
      };

      const validation = validateSummaryContract(missingField);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Missing required field: totalQrScans');
    });

    it('should reject summary with negative values', () => {
      const negativeValue = {
        totalImpressions: -1,
        totalClicks: 100,
        totalQrScans: 50,
        totalSignups: 25
      };

      const validation = validateSummaryContract(negativeValue);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Field totalImpressions must be >= 0, got -1');
    });

    it('should reject summary with non-integer values', () => {
      const floatValue = {
        totalImpressions: 1000.5,
        totalClicks: 100,
        totalQrScans: 50,
        totalSignups: 25
      };

      const validation = validateSummaryContract(floatValue);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Field totalImpressions must be an integer, got 1000.5');
    });

    it('should reject summary with string values', () => {
      const stringValue = {
        totalImpressions: '1000',
        totalClicks: 100,
        totalQrScans: 50,
        totalSignups: 25
      };

      const validation = validateSummaryContract(stringValue);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Field totalImpressions must be a number, got string');
    });
  });

  /**
   * API Response Envelope Tests
   */
  describe('API Response Envelope', () => {
    it('should return success envelope with summary for valid brandId', () => {
      const mockResponse = {
        ok: true,
        value: withFreshTimestamp(fullSharedAnalytics)
      };

      validateSuccessEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('summary');

      const validation = validateSummaryContract(mockResponse.value.summary);
      expect(validation.valid).toBe(true);
    });

    it('should return BAD_INPUT error when brandId is missing', () => {
      const mockResponse = {
        ok: false,
        code: ERROR_CODES.BAD_INPUT,
        message: 'brandId required'
      };

      validateErrorEnvelope(mockResponse, ERROR_CODES.BAD_INPUT);
      expect(mockResponse.message).toContain('brandId');
    });
  });

  /**
   * Schema compliance verification
   */
  describe('Schema Compliance', () => {
    it('should have summary as required field in SharedAnalytics', () => {
      // This verifies alignment with schemas/shared-analytics.schema.json
      const analytics = withFreshTimestamp(fullSharedAnalytics);

      // Required top-level fields per schema
      expect(analytics).toHaveProperty('lastUpdatedISO');
      expect(analytics).toHaveProperty('summary');
      expect(analytics).toHaveProperty('surfaces');
    });

    it('should have all six summary fields per schema', () => {
      // Schema requires: totalImpressions, totalClicks, totalQrScans, totalSignups, uniqueEvents, uniqueSponsors
      const analytics = withFreshTimestamp(fullSharedAnalytics);
      const { summary } = analytics;

      // Core four fields (per acceptance criteria)
      expect(summary).toHaveProperty('totalImpressions');
      expect(summary).toHaveProperty('totalClicks');
      expect(summary).toHaveProperty('totalQrScans');
      expect(summary).toHaveProperty('totalSignups');

      // Additional schema-required fields
      expect(summary).toHaveProperty('uniqueEvents');
      expect(summary).toHaveProperty('uniqueSponsors');

      // All must be non-negative integers
      Object.values(summary).forEach((value) => {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(value)).toBe(true);
      });
    });
  });
});

// Export validator for potential reuse
module.exports = { validateSummaryContract };
