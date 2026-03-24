/**
 * SponsorService Unit Tests
 *
 * Tests for graceful degradation with sparse sponsor data:
 * - No sponsors: surfaces render with no sponsor strip/banner and no errors
 * - Partial sponsors: Missing logoUrl displays text-only sponsor
 * - Partial sponsors: Missing linkUrl displays non-clickable sponsor
 * - V2 placement hints do not break MVP placements
 *
 * @module tests/unit/sponsor-service.test.js
 */

const {
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

describe('SponsorService', () => {
  // Error codes
  const ERR = {
    BAD_INPUT: 'BAD_INPUT',
    NOT_FOUND: 'NOT_FOUND',
    INTERNAL: 'INTERNAL'
  };

  // Helper envelope functions
  const Ok = (value) => ({ ok: true, value });
  const Err = (code, message) => ({ ok: false, code, message });

  // Mock MetricsUtils functions
  const MetricsUtils_createBucket = (withCtr = false) => ({
    impressions: 0,
    clicks: 0,
    dwellSec: 0,
    ...(withCtr ? { ctr: 0 } : {})
  });

  const MetricsUtils_applyCTR = (bucket) => {
    bucket.ctr = bucket.impressions > 0
      ? parseFloat(((bucket.clicks / bucket.impressions) * 100).toFixed(2))
      : 0;
  };

  // Mock implementations
  let mockAnalyticsSheet;
  let SponsorService_getAnalytics;
  let SponsorService_aggregateMetrics;
  let SponsorService_calculateEngagementScore;
  let SponsorService_generateInsights;
  let SponsorService_getSettings;
  let SponsorService_validatePlacements;
  let SponsorService_renderSponsorStrip;

  beforeEach(() => {
    mockAnalyticsSheet = {
      getDataRange: jest.fn(() => ({
        getValues: jest.fn(() => [
          ['timestamp', 'eventId', 'surface', 'metric', 'sponsorId', 'value'],
          ['2024-01-01', 'event-123', 'poster', 'impression', 'sponsor-1', '1'],
          ['2024-01-01', 'event-123', 'poster', 'click', 'sponsor-1', '1'],
          ['2024-01-02', 'event-123', 'display', 'impression', 'sponsor-1', '1']
        ])
      })),
      getLastRow: jest.fn(() => 4)
    };

    global._ensureAnalyticsSheet_ = jest.fn(() => mockAnalyticsSheet);
    global.diag_ = jest.fn();

    // Calculate engagement score implementation
    SponsorService_calculateEngagementScore = (ctr, dwellSec, impressions) => {
      if (impressions === 0) return 0;

      const avgDwellPerImpression = dwellSec / impressions;
      const normalizedDwell = Math.min(avgDwellPerImpression / 5 * 100, 100);

      const score = (ctr * 0.6) + (normalizedDwell * 0.4);
      return +score.toFixed(2);
    };

    // Generate insights implementation
    SponsorService_generateInsights = (agg) => {
      const insights = [];

      let bestSurface = null;
      let bestCTR = 0;

      for (const [surface, data] of Object.entries(agg.bySurface || {})) {
        if (data.ctr > bestCTR && data.impressions >= 10) {
          bestCTR = data.ctr;
          bestSurface = surface;
        }
      }

      if (bestSurface) {
        insights.push({
          type: 'best_surface',
          message: `Best performing surface: ${bestSurface} (${bestCTR}% CTR)`,
          surface: bestSurface,
          ctr: bestCTR
        });
      }

      const score = agg.totals?.engagementScore || 0;
      if (score >= 70) {
        insights.push({
          type: 'high_engagement',
          message: `Excellent engagement score: ${score}/100`,
          score: score,
          rating: 'excellent'
        });
      } else if (score < 40) {
        insights.push({
          type: 'low_engagement',
          message: `Low engagement score: ${score}/100. Consider optimizing creative or placement.`,
          score: score,
          rating: 'needs_improvement'
        });
      }

      return insights;
    };

    // Aggregate metrics implementation
    SponsorService_aggregateMetrics = (data, sponsorId) => {
      const agg = {
        sponsorId: sponsorId,
        totals: MetricsUtils_createBucket(true),
        bySurface: {},
        byEvent: {},
        timeline: []
      };

      for (const r of data) {
        const timestamp = r[0];
        const eventId = r[1];
        const surface = r[2];
        const metric = r[3];
        const value = parseInt(r[5] || 1, 10);

        if (!agg.bySurface[surface]) agg.bySurface[surface] = MetricsUtils_createBucket(true);
        if (!agg.byEvent[eventId]) agg.byEvent[eventId] = MetricsUtils_createBucket(true);

        if (metric === 'impression') {
          agg.totals.impressions += value;
          agg.bySurface[surface].impressions += value;
          agg.byEvent[eventId].impressions += value;
        } else if (metric === 'click') {
          agg.totals.clicks += value;
          agg.bySurface[surface].clicks += value;
          agg.byEvent[eventId].clicks += value;
        }
      }

      MetricsUtils_applyCTR(agg.totals);
      Object.values(agg.bySurface).forEach(MetricsUtils_applyCTR);
      Object.values(agg.byEvent).forEach(MetricsUtils_applyCTR);

      agg.totals.engagementScore = SponsorService_calculateEngagementScore(
        agg.totals.ctr,
        agg.totals.dwellSec,
        agg.totals.impressions
      );

      agg.insights = SponsorService_generateInsights(agg);

      return agg;
    };

    // Get analytics implementation
    SponsorService_getAnalytics = (params) => {
      if (!params || typeof params !== 'object') {
        return Err(ERR.BAD_INPUT, 'Missing payload');
      }

      const { sponsorId, eventId, dateFrom, dateTo } = params;

      if (!sponsorId) return Err(ERR.BAD_INPUT, 'Missing sponsorId');

      try {
        const sh = _ensureAnalyticsSheet_();
        let data = sh.getDataRange().getValues().slice(1);

        data = data.filter(r => r[4] === sponsorId);

        if (eventId) {
          data = data.filter(r => r[1] === eventId);
        }

        const agg = SponsorService_aggregateMetrics(data, sponsorId);
        return Ok(agg);
      } catch (e) {
        return Err(ERR.INTERNAL, `Failed to get analytics: ${e.message}`);
      }
    };

    // Get settings implementation
    SponsorService_getSettings = (params) => {
      const { brandId } = params || {};

      return Ok({
        placements: {
          posterTop: {
            name: 'Poster Top Banner',
            surface: 'poster',
            maxSponsors: 1
          },
          posterBottom: {
            name: 'Poster Bottom Banner',
            surface: 'poster',
            maxSponsors: 1
          },
          tvTop: {
            name: 'TV Display Top Banner',
            surface: 'display',
            maxSponsors: 1,
            recommended: true
          },
          tvSide: {
            name: 'TV Display Side Cards',
            surface: 'display',
            maxSponsors: 5
          },
          tvDedicated: {
            name: 'Dedicated TV Pane (Premium)',
            surface: 'display',
            maxSponsors: 3,
            premium: true,
            v2Only: true // V2+ feature marker
          },
          mobileBanner: {
            name: 'Mobile Banner',
            surface: 'public',
            maxSponsors: 1
          }
        },
        surfaces: {
          poster: { name: 'Poster/Print', allowedPlacements: ['posterTop', 'posterBottom'] },
          display: { name: 'TV Display', allowedPlacements: ['tvTop', 'tvSide', 'tvDedicated'] },
          public: { name: 'Mobile/Public Page', allowedPlacements: ['mobileBanner'] }
        }
      });
    };

    // Validate placements implementation
    SponsorService_validatePlacements = (params) => {
      const { sponsors, brandId } = params || {};

      if (!Array.isArray(sponsors)) {
        return Err(ERR.BAD_INPUT, 'Sponsors must be an array');
      }

      const settingsResult = SponsorService_getSettings({ brandId });
      if (!settingsResult.ok) return settingsResult;

      const settings = settingsResult.value;
      const placementSettings = settings.placements;

      const errors = [];
      const warnings = [];
      const placementCounts = {};

      for (const sponsor of sponsors) {
        const placements = sponsor.placements || {};

        for (const [placementId, enabled] of Object.entries(placements)) {
          if (!enabled) continue;

          if (!placementSettings[placementId]) {
            errors.push({
              sponsorId: sponsor.id,
              placement: placementId,
              message: `Invalid placement: ${placementId}`
            });
            continue;
          }

          placementCounts[placementId] = (placementCounts[placementId] || 0) + 1;
        }
      }

      for (const [placementId, count] of Object.entries(placementCounts)) {
        const setting = placementSettings[placementId];
        const maxSponsors = setting.maxSponsors || 999;

        if (count > maxSponsors) {
          errors.push({
            placement: placementId,
            count: count,
            max: maxSponsors,
            message: `Placement ${placementId} has ${count} sponsors but only allows ${maxSponsors}`
          });
        }
      }

      return Ok({
        valid: errors.length === 0,
        errors,
        warnings,
        placementCounts,
        totalSponsors: sponsors.length
      });
    };

    // Render sponsor strip - graceful degradation function
    SponsorService_renderSponsorStrip = (params) => {
      const { sponsors = [], surface = 'display', placement = 'default' } = params || {};

      // Gracefully handle empty sponsors array
      if (!sponsors || sponsors.length === 0) {
        return Ok({
          rendered: true,
          sponsors: [],
          hasSponsors: false,
          html: '',
          errors: []
        });
      }

      const renderedSponsors = [];
      const errors = [];

      for (const sponsor of sponsors) {
        const renderedSponsor = {
          id: sponsor.id,
          name: sponsor.name || 'Unknown Sponsor',
          displayMode: 'full'
        };

        // Handle missing logoUrl - text-only mode
        if (!sponsor.logoUrl) {
          renderedSponsor.displayMode = 'text-only';
          renderedSponsor.logoUrl = null;
          renderedSponsor.textOnly = true;
        } else {
          renderedSponsor.logoUrl = sponsor.logoUrl;
          renderedSponsor.textOnly = false;
        }

        // Handle missing linkUrl - non-clickable mode
        if (!sponsor.linkUrl) {
          renderedSponsor.clickable = false;
          renderedSponsor.linkUrl = null;
        } else {
          renderedSponsor.clickable = true;
          renderedSponsor.linkUrl = sponsor.linkUrl;
        }

        // Validate placement for surface
        const validPlacements = ['poster', 'display', 'public', 'tv-banner'];
        if (sponsor.placement && !validPlacements.includes(sponsor.placement)) {
          errors.push({
            sponsorId: sponsor.id,
            message: `Invalid placement: ${sponsor.placement}. Using default.`
          });
          renderedSponsor.placement = surface;
        } else {
          renderedSponsor.placement = sponsor.placement || surface;
        }

        renderedSponsors.push(renderedSponsor);
      }

      return Ok({
        rendered: true,
        sponsors: renderedSponsors,
        hasSponsors: renderedSponsors.length > 0,
        errors: errors.length > 0 ? errors : []
      });
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // B. SponsorService Tests - No Sponsors (Graceful Degradation)
  // =========================================================================

  describe('No sponsors: surfaces render with no sponsor strip/banner and no errors', () => {

    test('should render successfully with empty sponsors array', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [],
        surface: 'display'
      });

      validateSuccessEnvelope(result);
      expect(result.value.rendered).toBe(true);
      expect(result.value.hasSponsors).toBe(false);
    });

    test('should return no errors when sponsors array is empty', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [],
        surface: 'poster'
      });

      expect(result.ok).toBe(true);
      expect(result.value.errors).toEqual([]);
    });

    test('should return empty sponsors array in response', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [],
        surface: 'public'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors).toEqual([]);
      expect(result.value.sponsors.length).toBe(0);
    });

    test('should handle undefined sponsors gracefully', () => {
      const result = SponsorService_renderSponsorStrip({
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.hasSponsors).toBe(false);
      expect(result.value.errors).toEqual([]);
    });

    test('should handle null sponsors gracefully', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: null,
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.hasSponsors).toBe(false);
    });

    test('should not throw error for any surface with no sponsors', () => {
      const surfaces = ['poster', 'display', 'public', 'tv-banner'];

      surfaces.forEach(surface => {
        const result = SponsorService_renderSponsorStrip({
          sponsors: [],
          surface
        });

        expect(result.ok).toBe(true);
        expect(result.value.rendered).toBe(true);
      });
    });
  });

  // =========================================================================
  // B. SponsorService Tests - Partial Sponsors (Missing logoUrl)
  // =========================================================================

  describe('Partial sponsors: Missing logoUrl displays text-only sponsor', () => {

    test('should render sponsor with text-only mode when logoUrl missing', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'ACME Corp' }
          // No logoUrl provided
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].textOnly).toBe(true);
      expect(result.value.sponsors[0].displayMode).toBe('text-only');
    });

    test('should not have broken image icon for missing logoUrl', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'ACME Corp', logoUrl: null }
        ],
        surface: 'poster'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].logoUrl).toBeNull();
      expect(result.value.sponsors[0].textOnly).toBe(true);
    });

    test('should still render sponsor name when logoUrl missing', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'ACME Corporation' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].name).toBe('ACME Corporation');
    });

    test('should set displayMode to text-only for missing logo', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Sponsor Without Logo' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].displayMode).toBe('text-only');
    });

    test('should handle mix of sponsors with and without logos', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Has Logo', logoUrl: 'https://example.com/logo.png' },
          { id: 'sponsor-2', name: 'No Logo' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].textOnly).toBe(false);
      expect(result.value.sponsors[0].logoUrl).toBe('https://example.com/logo.png');
      expect(result.value.sponsors[1].textOnly).toBe(true);
      expect(result.value.sponsors[1].logoUrl).toBeNull();
    });

    test('should not produce errors for missing logoUrl', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'No Logo Sponsor' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.errors).toEqual([]);
    });
  });

  // =========================================================================
  // B. SponsorService Tests - Partial Sponsors (Missing linkUrl)
  // =========================================================================

  describe('Partial sponsors: Missing linkUrl displays non-clickable sponsor', () => {

    test('should render sponsor as non-clickable when linkUrl missing', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'ACME Corp', logoUrl: 'https://example.com/logo.png' }
          // No linkUrl provided
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].clickable).toBe(false);
    });

    test('should set linkUrl to null when missing', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'ACME Corp', logoUrl: 'https://example.com/logo.png' }
        ],
        surface: 'poster'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].linkUrl).toBeNull();
    });

    test('should still render sponsor nicely when linkUrl missing', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Nice Sponsor', logoUrl: 'https://example.com/logo.png' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.rendered).toBe(true);
      expect(result.value.hasSponsors).toBe(true);
      expect(result.value.sponsors[0].name).toBe('Nice Sponsor');
      expect(result.value.sponsors[0].logoUrl).toBe('https://example.com/logo.png');
    });

    test('should handle sponsors with null linkUrl explicitly', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Sponsor', logoUrl: 'https://example.com/logo.png', linkUrl: null }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].clickable).toBe(false);
      expect(result.value.sponsors[0].linkUrl).toBeNull();
    });

    test('should handle mix of clickable and non-clickable sponsors', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Clickable', logoUrl: 'https://example.com/logo1.png', linkUrl: 'https://example.com' },
          { id: 'sponsor-2', name: 'Not Clickable', logoUrl: 'https://example.com/logo2.png' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].clickable).toBe(true);
      expect(result.value.sponsors[0].linkUrl).toBe('https://example.com');
      expect(result.value.sponsors[1].clickable).toBe(false);
      expect(result.value.sponsors[1].linkUrl).toBeNull();
    });

    test('should not produce errors for missing linkUrl', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'No Link', logoUrl: 'https://example.com/logo.png' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.errors).toEqual([]);
    });

    test('should handle sponsor with both missing logoUrl and linkUrl', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Minimal Sponsor' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].textOnly).toBe(true);
      expect(result.value.sponsors[0].clickable).toBe(false);
      expect(result.value.sponsors[0].name).toBe('Minimal Sponsor');
    });
  });

  // =========================================================================
  // B. SponsorService Tests - V2 Placement Hints
  // =========================================================================

  describe('V2 placement hints do not break MVP placements', () => {

    test('should accept MVP placements without errors', () => {
      const mvpPlacements = ['poster', 'display', 'public'];

      mvpPlacements.forEach(placement => {
        const result = SponsorService_renderSponsorStrip({
          sponsors: [
            { id: 'sponsor-1', name: 'Test', logoUrl: 'https://example.com/logo.png', placement }
          ],
          surface: 'display'
        });

        expect(result.ok).toBe(true);
        expect(result.value.sponsors[0].placement).toBe(placement);
      });
    });

    test('should handle tv-banner placement (MVP)', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Test', logoUrl: 'https://example.com/logo.png', placement: 'tv-banner' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.sponsors[0].placement).toBe('tv-banner');
    });

    test('should gracefully handle unknown V2 placements', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Test', logoUrl: 'https://example.com/logo.png', placement: 'v2-premium-slot' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      // Should fall back to default surface, not crash
      expect(result.value.sponsors[0].placement).toBe('display');
    });

    test('should report warning for invalid placement but still render', () => {
      const result = SponsorService_renderSponsorStrip({
        sponsors: [
          { id: 'sponsor-1', name: 'Test', logoUrl: 'https://example.com/logo.png', placement: 'future-placement' }
        ],
        surface: 'display'
      });

      expect(result.ok).toBe(true);
      expect(result.value.rendered).toBe(true);
      expect(result.value.sponsors.length).toBe(1);
      expect(result.value.errors.length).toBe(1);
      expect(result.value.errors[0].message).toContain('Invalid placement');
    });

    test('should not crash when V2 placement settings are present', () => {
      const settingsResult = SponsorService_getSettings({ brandId: 'root' });

      expect(settingsResult.ok).toBe(true);
      expect(settingsResult.value.placements.tvDedicated).toBeDefined();
      expect(settingsResult.value.placements.tvDedicated.v2Only).toBe(true);
    });

    test('should validate MVP placements correctly', () => {
      const result = SponsorService_validatePlacements({
        sponsors: [
          { id: 'sponsor-1', name: 'Test', placements: { posterTop: true } },
          { id: 'sponsor-2', name: 'Test 2', placements: { tvTop: true } }
        ],
        brandId: 'root'
      });

      expect(result.ok).toBe(true);
      expect(result.value.valid).toBe(true);
      expect(result.value.errors).toEqual([]);
    });

    test('should report errors for invalid placements in validation', () => {
      const result = SponsorService_validatePlacements({
        sponsors: [
          { id: 'sponsor-1', name: 'Test', placements: { invalidPlacement: true } }
        ],
        brandId: 'root'
      });

      expect(result.ok).toBe(true);
      expect(result.value.valid).toBe(false);
      expect(result.value.errors.length).toBeGreaterThan(0);
    });

    test('should enforce placement limits', () => {
      const result = SponsorService_validatePlacements({
        sponsors: [
          { id: 'sponsor-1', placements: { posterTop: true } },
          { id: 'sponsor-2', placements: { posterTop: true } }
        ],
        brandId: 'root'
      });

      expect(result.ok).toBe(true);
      expect(result.value.valid).toBe(false);
      expect(result.value.errors.some(e => e.message.includes('posterTop'))).toBe(true);
    });
  });

  // =========================================================================
  // Additional SponsorService Tests - Analytics
  // =========================================================================

  describe('SponsorService_getAnalytics', () => {

    test('should return analytics for valid sponsorId', () => {
      mockAnalyticsSheet.getDataRange.mockReturnValue({
        getValues: () => [
          ['timestamp', 'eventId', 'surface', 'metric', 'sponsorId', 'value'],
          ['2024-01-01', 'event-123', 'poster', 'impression', 'sponsor-1', '10'],
          ['2024-01-01', 'event-123', 'poster', 'click', 'sponsor-1', '2']
        ]
      });

      const result = SponsorService_getAnalytics({ sponsorId: 'sponsor-1' });

      expect(result.ok).toBe(true);
      expect(result.value.sponsorId).toBe('sponsor-1');
      expect(result.value.totals).toBeDefined();
    });

    test('should return BAD_INPUT for missing sponsorId', () => {
      const result = SponsorService_getAnalytics({});

      validateErrorEnvelope(result, ERR.BAD_INPUT);
      expect(result.message).toContain('sponsorId');
    });

    test('should return BAD_INPUT for null params', () => {
      const result = SponsorService_getAnalytics(null);

      validateErrorEnvelope(result, ERR.BAD_INPUT);
    });

    test('should calculate CTR correctly', () => {
      mockAnalyticsSheet.getDataRange.mockReturnValue({
        getValues: () => [
          ['timestamp', 'eventId', 'surface', 'metric', 'sponsorId', 'value'],
          ['2024-01-01', 'event-123', 'poster', 'impression', 'sponsor-1', '100'],
          ['2024-01-01', 'event-123', 'poster', 'click', 'sponsor-1', '5']
        ]
      });

      const result = SponsorService_getAnalytics({ sponsorId: 'sponsor-1' });

      expect(result.ok).toBe(true);
      expect(result.value.totals.ctr).toBe(5); // 5%
    });

    test('should aggregate by surface', () => {
      mockAnalyticsSheet.getDataRange.mockReturnValue({
        getValues: () => [
          ['timestamp', 'eventId', 'surface', 'metric', 'sponsorId', 'value'],
          ['2024-01-01', 'event-123', 'poster', 'impression', 'sponsor-1', '50'],
          ['2024-01-01', 'event-123', 'display', 'impression', 'sponsor-1', '30']
        ]
      });

      const result = SponsorService_getAnalytics({ sponsorId: 'sponsor-1' });

      expect(result.ok).toBe(true);
      expect(result.value.bySurface.poster).toBeDefined();
      expect(result.value.bySurface.display).toBeDefined();
    });
  });

  describe('SponsorService_calculateEngagementScore', () => {

    test('should return 0 for zero impressions', () => {
      const score = SponsorService_calculateEngagementScore(5, 100, 0);
      expect(score).toBe(0);
    });

    test('should calculate score based on CTR and dwell time', () => {
      // CTR: 10%, Dwell: 5 sec avg = 100% normalized
      // Score = (10 * 0.6) + (100 * 0.4) = 6 + 40 = 46
      const score = SponsorService_calculateEngagementScore(10, 500, 100);
      expect(score).toBe(46);
    });

    test('should cap dwell time normalization at 100', () => {
      // Very high dwell time should cap at 100%
      const score = SponsorService_calculateEngagementScore(10, 10000, 100);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('should weight CTR at 60% and dwell at 40%', () => {
      // CTR: 100% (max), Dwell: 0
      const ctaOnlyScore = SponsorService_calculateEngagementScore(100, 0, 100);
      expect(ctaOnlyScore).toBe(60); // 100 * 0.6 = 60
    });
  });

  describe('SponsorService_generateInsights', () => {

    test('should generate insights for high engagement', () => {
      const agg = {
        totals: { engagementScore: 75, ctr: 5, impressions: 100 },
        bySurface: {},
        timeline: []
      };

      const insights = SponsorService_generateInsights(agg);

      expect(insights.some(i => i.type === 'high_engagement')).toBe(true);
    });

    test('should generate insights for low engagement', () => {
      const agg = {
        totals: { engagementScore: 30, ctr: 1, impressions: 100 },
        bySurface: {},
        timeline: []
      };

      const insights = SponsorService_generateInsights(agg);

      expect(insights.some(i => i.type === 'low_engagement')).toBe(true);
    });

    test('should identify best performing surface', () => {
      const agg = {
        totals: { engagementScore: 50, ctr: 3, impressions: 100 },
        bySurface: {
          poster: { ctr: 5, impressions: 50 },
          display: { ctr: 2, impressions: 50 }
        },
        timeline: []
      };

      const insights = SponsorService_generateInsights(agg);

      expect(insights.some(i => i.type === 'best_surface' && i.surface === 'poster')).toBe(true);
    });

    test('should return empty insights for minimal data', () => {
      const agg = {
        totals: { engagementScore: 50, ctr: 3, impressions: 5 },
        bySurface: {
          poster: { ctr: 5, impressions: 5 } // Below threshold of 10
        },
        timeline: []
      };

      const insights = SponsorService_generateInsights(agg);

      // Should not identify best surface due to low impressions
      expect(insights.some(i => i.type === 'best_surface')).toBe(false);
    });
  });
});
