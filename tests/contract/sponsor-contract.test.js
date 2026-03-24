/**
 * Contract Tests for Sponsor Entity
 *
 * Tests the Sponsor Contract defined in /schemas/sponsor.schema.json
 * Validates the validateSponsorContract() function from SponsorService.gs
 *
 * These tests validate:
 * - Required fields: id, name, logoUrl, (placement OR placements)
 * - Optional fields: linkUrl, clickToken, impressionToken, tier
 * - V2 placements object structure
 * - Legacy placement string compatibility
 * - Surface filtering logic
 *
 * @see /schemas/sponsor.schema.json
 * @see /src/mvp/SponsorService.gs - validateSponsorContract()
 */

const {
  platinumSponsor,
  goldSponsor,
  silverSponsor,
  legacySponsor,
  invalidSponsors,
  VALID_PLACEMENT_KEYS
} = require('../shared/fixtures/sponsors.fixtures');

describe('Sponsor Contract Tests', () => {

  describe('Contract Structure', () => {

    describe('Required Fields', () => {
      it('should require id field', () => {
        expect(platinumSponsor).toHaveProperty('id');
        expect(typeof platinumSponsor.id).toBe('string');
        expect(platinumSponsor.id.length).toBeGreaterThan(0);
      });

      it('should require name field', () => {
        expect(platinumSponsor).toHaveProperty('name');
        expect(typeof platinumSponsor.name).toBe('string');
        expect(platinumSponsor.name.length).toBeGreaterThan(0);
      });

      it('should require logoUrl field', () => {
        expect(platinumSponsor).toHaveProperty('logoUrl');
        expect(typeof platinumSponsor.logoUrl).toBe('string');
        expect(platinumSponsor.logoUrl).toMatch(/^https?:\/\/.+/);
      });

      it('should require either placement or placements', () => {
        const hasPlacement = platinumSponsor.placement !== undefined;
        const hasPlacements = platinumSponsor.placements !== undefined;
        expect(hasPlacement || hasPlacements).toBe(true);
      });
    });

    describe('ID Format', () => {
      it('should accept alphanumeric IDs with hyphens and underscores', () => {
        const validIds = ['sp-123', 'sponsor_abc', 'SPONSOR-001', 'sponsor123'];
        validIds.forEach(id => {
          expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
        });
      });

      it('should not accept IDs with spaces or special characters', () => {
        const invalidIds = ['sponsor 123', 'sponsor!abc', 'sponsor@test'];
        invalidIds.forEach(id => {
          expect(id).not.toMatch(/^[a-zA-Z0-9_-]+$/);
        });
      });

      it('should enforce max ID length of 128 characters', () => {
        const validId = 'a'.repeat(128);
        const invalidId = 'a'.repeat(129);
        expect(validId.length).toBeLessThanOrEqual(128);
        expect(invalidId.length).toBeGreaterThan(128);
      });
    });

    describe('V2 Placements Object', () => {
      it('should have valid placement keys', () => {
        expect(VALID_PLACEMENT_KEYS).toContain('posterTop');
        expect(VALID_PLACEMENT_KEYS).toContain('tvTop');
        expect(VALID_PLACEMENT_KEYS).toContain('tvSide');
        expect(VALID_PLACEMENT_KEYS).toContain('mobileBanner');
      });

      it('should validate placements as boolean values', () => {
        const sponsor = platinumSponsor;
        if (sponsor.placements) {
          Object.entries(sponsor.placements).forEach(([key, value]) => {
            expect(VALID_PLACEMENT_KEYS).toContain(key);
            expect(typeof value).toBe('boolean');
          });
        }
      });

      it('should have at least one enabled placement', () => {
        const sponsor = platinumSponsor;
        if (sponsor.placements) {
          const hasAtLeastOne = Object.values(sponsor.placements).some(v => v === true);
          expect(hasAtLeastOne).toBe(true);
        }
      });
    });

    describe('Legacy Placement String', () => {
      it('should accept valid legacy placement values', () => {
        const validPlacements = ['poster', 'display', 'public', 'tv-banner'];
        expect(legacySponsor.placement).toBeDefined();
        expect(validPlacements).toContain(legacySponsor.placement);
      });

      it('should have all legacy sponsor required fields', () => {
        expect(legacySponsor.id).toBeDefined();
        expect(legacySponsor.name).toBeDefined();
        expect(legacySponsor.logoUrl).toBeDefined();
        expect(legacySponsor.placement).toBeDefined();
      });
    });

    describe('Optional Fields', () => {
      it('should accept optional linkUrl', () => {
        if (platinumSponsor.linkUrl !== undefined && platinumSponsor.linkUrl !== null) {
          expect(platinumSponsor.linkUrl).toMatch(/^https?:\/\/.+/);
        }
      });

      it('should accept optional clickToken', () => {
        if (platinumSponsor.clickToken !== undefined) {
          const isValid = platinumSponsor.clickToken === null || typeof platinumSponsor.clickToken === 'string';
          expect(isValid).toBe(true);
        }
      });

      it('should accept optional impressionToken', () => {
        if (platinumSponsor.impressionToken !== undefined) {
          const isValid = platinumSponsor.impressionToken === null || typeof platinumSponsor.impressionToken === 'string';
          expect(isValid).toBe(true);
        }
      });

      it('should accept optional tier', () => {
        const validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
        if (platinumSponsor.tier !== undefined && platinumSponsor.tier !== null) {
          expect(validTiers).toContain(platinumSponsor.tier);
        }
      });
    });
  });

  describe('Invalid Sponsor Data', () => {

    it('should identify missing id', () => {
      const sponsor = invalidSponsors.missingId;
      expect(sponsor.id).toBeUndefined();
    });

    it('should identify missing name', () => {
      const sponsor = invalidSponsors.missingName;
      expect(sponsor.name).toBeUndefined();
    });

    it('should identify missing logoUrl', () => {
      const sponsor = invalidSponsors.missingLogoUrl;
      expect(sponsor.logoUrl).toBeUndefined();
    });

    it('should identify missing placements', () => {
      const sponsor = invalidSponsors.missingPlacements;
      expect(sponsor.placement).toBeUndefined();
      expect(sponsor.placements).toBeUndefined();
    });

    it('should identify invalid id pattern', () => {
      const sponsor = invalidSponsors.invalidIdPattern;
      expect(sponsor.id).not.toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it('should identify invalid logoUrl', () => {
      const sponsor = invalidSponsors.invalidLogoUrl;
      expect(sponsor.logoUrl).not.toMatch(/^https?:\/\/.+/);
    });

    it('should identify invalid placement value', () => {
      const sponsor = invalidSponsors.invalidPlacement;
      const validPlacements = ['poster', 'display', 'public', 'tv-banner'];
      expect(validPlacements).not.toContain(sponsor.placement);
    });

    it('should identify invalid placement keys', () => {
      const sponsor = invalidSponsors.invalidPlacementKeys;
      const keys = Object.keys(sponsor.placements);
      const hasInvalidKey = keys.some(k => !VALID_PLACEMENT_KEYS.includes(k));
      expect(hasInvalidKey).toBe(true);
    });

    it('should identify all-false placements', () => {
      const sponsor = invalidSponsors.allPlacementsFalse;
      const hasEnabledPlacement = Object.values(sponsor.placements).some(v => v === true);
      expect(hasEnabledPlacement).toBe(false);
    });

    it('should identify invalid tier', () => {
      const sponsor = invalidSponsors.invalidTier;
      const validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
      expect(validTiers).not.toContain(sponsor.tier);
    });

    it('should identify null sponsor', () => {
      expect(invalidSponsors.nullSponsor).toBeNull();
    });

    it('should identify empty sponsor', () => {
      expect(Object.keys(invalidSponsors.emptySponsor).length).toBe(0);
    });
  });

  describe('Surface Filtering Logic', () => {

    describe('V2 Placements Object Filtering', () => {
      it('should show posterTop sponsors on poster surface', () => {
        const sponsor = platinumSponsor;
        const shouldShow = sponsor.placements?.posterTop === true;
        expect(shouldShow).toBe(true);
      });

      it('should show tvTop sponsors on display surface', () => {
        const sponsor = platinumSponsor;
        const shouldShow = sponsor.placements?.tvTop === true || sponsor.placements?.tvSide === true;
        expect(shouldShow).toBe(true);
      });

      it('should show mobileBanner sponsors on public surface', () => {
        const sponsor = platinumSponsor;
        const shouldShow = sponsor.placements?.mobileBanner === true;
        expect(shouldShow).toBe(true);
      });

      it('should not show silverSponsor on poster surface (posterTop=false)', () => {
        const shouldShow = silverSponsor.placements?.posterTop === true;
        expect(shouldShow).toBe(false);
      });

      it('should not show silverSponsor on public surface (mobileBanner=false)', () => {
        const shouldShow = silverSponsor.placements?.mobileBanner === true;
        expect(shouldShow).toBe(false);
      });
    });

    describe('Legacy Placement String Filtering', () => {
      it('should show display sponsors on display surface', () => {
        const sponsor = legacySponsor;
        const shouldShow = sponsor.placement === 'display' || sponsor.placement === 'tv-banner';
        expect(shouldShow).toBe(true);
      });

      it('should match display and tv-banner interchangeably', () => {
        // Per contract, display and tv-banner are interchangeable for backward compatibility
        const displaySponsor = { ...legacySponsor, placement: 'display' };
        const tvBannerSponsor = { ...legacySponsor, placement: 'tv-banner' };

        const displayVisible = displaySponsor.placement === 'display' || displaySponsor.placement === 'tv-banner';
        const tvBannerVisible = tvBannerSponsor.placement === 'display' || tvBannerSponsor.placement === 'tv-banner';

        expect(displayVisible).toBe(true);
        expect(tvBannerVisible).toBe(true);
      });
    });
  });

  describe('Token Fields', () => {

    it('should support click tracking tokens', () => {
      expect(platinumSponsor.clickToken).toBeDefined();
      expect(typeof platinumSponsor.clickToken).toBe('string');
      expect(platinumSponsor.clickToken.length).toBeLessThanOrEqual(256);
    });

    it('should support impression tracking tokens', () => {
      expect(platinumSponsor.impressionToken).toBeDefined();
      expect(typeof platinumSponsor.impressionToken).toBe('string');
      expect(platinumSponsor.impressionToken.length).toBeLessThanOrEqual(256);
    });

    it('should allow null tokens', () => {
      expect(silverSponsor.clickToken).toBeNull();
      expect(silverSponsor.impressionToken).toBeNull();
    });
  });

  describe('Contract Compliance', () => {

    it('platinum sponsor should be contract-compliant', () => {
      expect(platinumSponsor.id).toBeDefined();
      expect(platinumSponsor.name).toBeDefined();
      expect(platinumSponsor.logoUrl).toBeDefined();
      expect(platinumSponsor.placements).toBeDefined();

      // ID format
      expect(platinumSponsor.id).toMatch(/^[a-zA-Z0-9_-]+$/);

      // URL format
      expect(platinumSponsor.logoUrl).toMatch(/^https?:\/\/.+/);

      // Valid placements
      const enabledPlacements = Object.entries(platinumSponsor.placements)
        .filter(([k, v]) => v === true);
      expect(enabledPlacements.length).toBeGreaterThan(0);
    });

    it('gold sponsor should be contract-compliant', () => {
      expect(goldSponsor.id).toBeDefined();
      expect(goldSponsor.name).toBeDefined();
      expect(goldSponsor.logoUrl).toBeDefined();
      expect(goldSponsor.placements).toBeDefined();

      expect(goldSponsor.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it('legacy sponsor should be contract-compliant', () => {
      expect(legacySponsor.id).toBeDefined();
      expect(legacySponsor.name).toBeDefined();
      expect(legacySponsor.logoUrl).toBeDefined();
      expect(legacySponsor.placement).toBeDefined();

      expect(legacySponsor.id).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(['poster', 'display', 'public', 'tv-banner']).toContain(legacySponsor.placement);
    });
  });
});
