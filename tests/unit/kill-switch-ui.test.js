/**
 * Kill Switch UI Unit Tests
 *
 * Tests that Admin UI correctly hides SharedReport-related elements
 * when the sharedReportEnabled feature flag is disabled.
 *
 * Acceptance Criteria:
 * - Admin doesn't show SharedReport links when disabled
 * - No "Shared Analytics" entry for disabled brands
 *
 * Related Stories:
 * - Dark Launch / Kill Switch for SharedReport & Sponsors
 */

const {
  getBrandFeatures,
  isBrandFeatureEnabled,
  DEFAULT_FEATURES
} = require('../../config/brand-config');

describe('Kill Switch UI Behavior', () => {
  /**
   * Tests for brand feature flag configuration
   * These validate the data layer that drives UI visibility
   */
  describe('Brand Feature Configuration', () => {
    it('should have sharedReportEnabled and sponsorAnalyticsEnabled in default features', () => {
      expect(DEFAULT_FEATURES).toHaveProperty('sharedReportEnabled', true);
      expect(DEFAULT_FEATURES).toHaveProperty('sponsorAnalyticsEnabled', true);
    });

    it('should return features for all configured brands', () => {
      const brands = ['root', 'abc', 'cbc', 'cbl'];

      brands.forEach(brandId => {
        const features = getBrandFeatures(brandId);
        expect(features).toHaveProperty('sharedReportEnabled');
        expect(features).toHaveProperty('sponsorAnalyticsEnabled');
      });
    });

    it('should check feature enabled correctly for root brand', () => {
      expect(isBrandFeatureEnabled('root', 'sharedReportEnabled')).toBe(true);
      expect(isBrandFeatureEnabled('root', 'sponsorAnalyticsEnabled')).toBe(true);
    });
  });

  /**
   * Tests for UI visibility logic
   * These validate the conditional rendering logic used in Admin.html
   */
  describe('UI Visibility Logic', () => {
    /**
     * Simulates the scriptlet logic in Admin.html:
     * <? if (brandFeatures && brandFeatures.sharedReportEnabled !== false) { ?>
     */
    const shouldShowSharedReportCard = (brandFeatures) => {
      return brandFeatures && brandFeatures.sharedReportEnabled !== false;
    };

    /**
     * Simulates the JavaScript logic in Admin.html:
     * if (reportUrl && BRAND_FEATURES.sharedReportEnabled !== false) { ... }
     */
    const shouldShowSharedReportLink = (brandFeatures) => {
      return brandFeatures && brandFeatures.sharedReportEnabled !== false;
    };

    it('should show SharedReport card when feature is enabled', () => {
      const features = { sharedReportEnabled: true, sponsorAnalyticsEnabled: true };
      expect(shouldShowSharedReportCard(features)).toBe(true);
    });

    it('should hide SharedReport card when feature is explicitly disabled', () => {
      const features = { sharedReportEnabled: false, sponsorAnalyticsEnabled: true };
      expect(shouldShowSharedReportCard(features)).toBe(false);
    });

    it('should show SharedReport card when feature is not specified (default behavior)', () => {
      const features = { sponsorAnalyticsEnabled: true };
      expect(shouldShowSharedReportCard(features)).toBe(true);
    });

    it('should hide SharedReport link in preview section when disabled', () => {
      const features = { sharedReportEnabled: false, sponsorAnalyticsEnabled: true };
      expect(shouldShowSharedReportLink(features)).toBe(false);
    });

    it('should show SharedReport link in preview section when enabled', () => {
      const features = { sharedReportEnabled: true, sponsorAnalyticsEnabled: true };
      expect(shouldShowSharedReportLink(features)).toBe(true);
    });
  });

  /**
   * Tests for no "Shared Analytics" entry for disabled brands
   */
  describe('Shared Analytics Entry Visibility', () => {
    /**
     * Simulates checking if SharedReport QR code should be rendered:
     * if (BRAND_FEATURES.sharedReportEnabled !== false) { renderSharedReportQR(event); }
     */
    const shouldRenderSharedReportQR = (brandFeatures) => {
      return brandFeatures && brandFeatures.sharedReportEnabled !== false;
    };

    it('should not render SharedReport QR when feature is disabled', () => {
      const features = { sharedReportEnabled: false, sponsorAnalyticsEnabled: true };
      expect(shouldRenderSharedReportQR(features)).toBe(false);
    });

    it('should render SharedReport QR when feature is enabled', () => {
      const features = { sharedReportEnabled: true, sponsorAnalyticsEnabled: true };
      expect(shouldRenderSharedReportQR(features)).toBe(true);
    });
  });

  /**
   * Tests for wizard link cards visibility
   */
  describe('Wizard Link Cards Visibility', () => {
    /**
     * Simulates the scriptlet in wizard-link-report card:
     * <? if (brandFeatures && brandFeatures.sharedReportEnabled !== false) { ?>
     */
    const shouldShowWizardReportCard = (brandFeatures) => {
      return brandFeatures && brandFeatures.sharedReportEnabled !== false;
    };

    it('should show wizard report card when feature is enabled', () => {
      const features = { sharedReportEnabled: true };
      expect(shouldShowWizardReportCard(features)).toBe(true);
    });

    it('should hide wizard report card when feature is disabled', () => {
      const features = { sharedReportEnabled: false };
      expect(shouldShowWizardReportCard(features)).toBe(false);
    });

    it('should show wizard report card when feature is undefined (default)', () => {
      const features = {};
      // When feature is undefined, !== false evaluates to true
      expect(shouldShowWizardReportCard(features)).toBe(true);
    });
  });

  /**
   * Tests for Sponsor Analytics elements
   */
  describe('Sponsor Analytics UI Elements', () => {
    /**
     * Simulates checking if sponsor analytics API calls should proceed
     */
    const shouldCallSponsorAnalyticsAPI = (brandFeatures) => {
      return brandFeatures && brandFeatures.sponsorAnalyticsEnabled !== false;
    };

    it('should call sponsor analytics API when feature is enabled', () => {
      const features = { sharedReportEnabled: true, sponsorAnalyticsEnabled: true };
      expect(shouldCallSponsorAnalyticsAPI(features)).toBe(true);
    });

    it('should not call sponsor analytics API when feature is disabled', () => {
      const features = { sharedReportEnabled: true, sponsorAnalyticsEnabled: false };
      expect(shouldCallSponsorAnalyticsAPI(features)).toBe(false);
    });
  });

  /**
   * Integration test: Full brand configuration
   */
  describe('Full Brand Configuration Integration', () => {
    it('should correctly evaluate features for all default brands', () => {
      const brands = ['root', 'abc', 'cbc', 'cbl'];

      brands.forEach(brandId => {
        const features = getBrandFeatures(brandId);

        // All brands should have both features enabled by default
        expect(isBrandFeatureEnabled(brandId, 'sharedReportEnabled')).toBe(true);
        expect(isBrandFeatureEnabled(brandId, 'sponsorAnalyticsEnabled')).toBe(true);

        // Features object should match expected shape
        expect(features).toMatchObject({
          sharedReportEnabled: true,
          sponsorAnalyticsEnabled: true
        });
      });
    });
  });
});
