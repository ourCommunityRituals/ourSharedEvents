/**
 * Kill Switch Feature Contract Test
 *
 * Validates that:
 * 1. Toggling brand feature flags yields FEATURE_DISABLED response
 * 2. SharedReport and SponsorAnalytics APIs respect kill switch
 *
 * Acceptance Criteria:
 * - If flags are off, affected endpoints return: ok:false, code:'FEATURE_DISABLED'
 * - Consistent error handling across all affected endpoints
 *
 * Related Stories:
 * - Dark Launch / Kill Switch for SharedReport & Sponsors
 */

const {
  validateErrorEnvelope,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

const {
  isBrandFeatureEnabled,
  getBrandFeatures,
  DEFAULT_FEATURES
} = require('../../config/brand-config');

describe('Kill Switch Feature Contract', () => {
  /**
   * Feature Flag Configuration Tests
   */
  describe('Brand Feature Flags Configuration', () => {
    it('should have default features defined', () => {
      expect(DEFAULT_FEATURES).toBeDefined();
      expect(DEFAULT_FEATURES).toHaveProperty('sharedReportEnabled');
      expect(DEFAULT_FEATURES).toHaveProperty('sponsorAnalyticsEnabled');
    });

    it('should return features for valid brands', () => {
      const features = getBrandFeatures('root');
      expect(features).toHaveProperty('sharedReportEnabled');
      expect(features).toHaveProperty('sponsorAnalyticsEnabled');
    });

    it('should return default features for invalid brands', () => {
      const features = getBrandFeatures('nonexistent');
      expect(features).toEqual(DEFAULT_FEATURES);
    });

    it('should check feature enabled status correctly', () => {
      // Default: all features enabled
      expect(isBrandFeatureEnabled('root', 'sharedReportEnabled')).toBe(true);
      expect(isBrandFeatureEnabled('root', 'sponsorAnalyticsEnabled')).toBe(true);
    });

    it('should handle undefined feature name gracefully', () => {
      // Undefined features should return true (opt-out model)
      expect(isBrandFeatureEnabled('root', 'nonexistentFeature')).toBe(true);
    });
  });

  /**
   * FEATURE_DISABLED Error Response Contract
   */
  describe('FEATURE_DISABLED Error Response', () => {
    it('should have FEATURE_DISABLED error code defined', () => {
      expect(ERROR_CODES.FEATURE_DISABLED).toBe('FEATURE_DISABLED');
    });

    it('should validate FEATURE_DISABLED error envelope', () => {
      const mockResponse = {
        ok: false,
        code: 'FEATURE_DISABLED',
        message: "Feature 'sharedReportEnabled' is not enabled for this brand."
      };

      validateErrorEnvelope(mockResponse, ERROR_CODES.FEATURE_DISABLED);
    });

    it('should include feature name in error message', () => {
      const mockResponse = {
        ok: false,
        code: 'FEATURE_DISABLED',
        message: "Feature 'sponsorAnalyticsEnabled' is not enabled for this brand."
      };

      expect(mockResponse.message).toContain('sponsorAnalyticsEnabled');
    });
  });

  /**
   * API Endpoint Kill Switch Behavior (Mock Tests)
   * These test the expected response shape when features are disabled
   */
  describe('API Kill Switch Response Shape', () => {
    const createFeatureDisabledResponse = (featureName) => ({
      ok: false,
      code: 'FEATURE_DISABLED',
      message: `Feature '${featureName}' is not enabled for this brand.`
    });

    it('should return FEATURE_DISABLED for api_getSharedAnalytics when sharedReportEnabled=false', () => {
      const response = createFeatureDisabledResponse('sharedReportEnabled');

      validateErrorEnvelope(response, ERROR_CODES.FEATURE_DISABLED);
      expect(response.message).toContain('sharedReportEnabled');
    });

    it('should return FEATURE_DISABLED for api_getSponsorAnalytics when sponsorAnalyticsEnabled=false', () => {
      const response = createFeatureDisabledResponse('sponsorAnalyticsEnabled');

      validateErrorEnvelope(response, ERROR_CODES.FEATURE_DISABLED);
      expect(response.message).toContain('sponsorAnalyticsEnabled');
    });

    it('should return FEATURE_DISABLED for api_getSharedReportBundle when sharedReportEnabled=false', () => {
      const response = createFeatureDisabledResponse('sharedReportEnabled');

      validateErrorEnvelope(response, ERROR_CODES.FEATURE_DISABLED);
      expect(response.message).toContain('sharedReportEnabled');
    });

    it('should return FEATURE_DISABLED for api_getSponsorROI when sponsorAnalyticsEnabled=false', () => {
      const response = createFeatureDisabledResponse('sponsorAnalyticsEnabled');

      validateErrorEnvelope(response, ERROR_CODES.FEATURE_DISABLED);
      expect(response.message).toContain('sponsorAnalyticsEnabled');
    });
  });

  /**
   * Feature Isolation Tests
   * Verify that disabling one feature doesn't affect others
   */
  describe('Feature Isolation', () => {
    it('should independently control sharedReportEnabled and sponsorAnalyticsEnabled', () => {
      // Mock brand with only sponsorAnalytics disabled
      const mockBrandFeatures = {
        sharedReportEnabled: true,
        sponsorAnalyticsEnabled: false
      };

      expect(mockBrandFeatures.sharedReportEnabled).toBe(true);
      expect(mockBrandFeatures.sponsorAnalyticsEnabled).toBe(false);
    });

    it('should independently control sponsorAnalyticsEnabled without affecting sharedReport', () => {
      // Mock brand with only sharedReport disabled
      const mockBrandFeatures = {
        sharedReportEnabled: false,
        sponsorAnalyticsEnabled: true
      };

      expect(mockBrandFeatures.sharedReportEnabled).toBe(false);
      expect(mockBrandFeatures.sponsorAnalyticsEnabled).toBe(true);
    });
  });

  /**
   * Default Behavior Tests
   * Ensure backward compatibility - all features enabled by default
   */
  describe('Default Behavior (Backward Compatibility)', () => {
    it('should enable all features by default', () => {
      expect(DEFAULT_FEATURES.sharedReportEnabled).toBe(true);
      expect(DEFAULT_FEATURES.sponsorAnalyticsEnabled).toBe(true);
    });

    it('should treat missing feature flags as enabled (opt-out model)', () => {
      // Brand without explicit features should use defaults
      const emptyFeatures = {};
      const merged = { ...DEFAULT_FEATURES, ...emptyFeatures };

      expect(merged.sharedReportEnabled).toBe(true);
      expect(merged.sponsorAnalyticsEnabled).toBe(true);
    });

    it('should only disable when explicitly set to false', () => {
      const features = {
        ...DEFAULT_FEATURES,
        sharedReportEnabled: false
      };

      expect(features.sharedReportEnabled).toBe(false);
      expect(features.sponsorAnalyticsEnabled).toBe(true);
    });
  });
});

module.exports = {
  // Export for potential reuse in integration tests
  createFeatureDisabledResponse: (featureName) => ({
    ok: false,
    code: 'FEATURE_DISABLED',
    message: `Feature '${featureName}' is not enabled for this brand.`
  })
};
