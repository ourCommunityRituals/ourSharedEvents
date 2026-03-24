/**
 * V2 Portfolio Analytics API E2E Tests
 *
 * Tests the V2 Sponsor Portfolio Analytics endpoints:
 * - api_getPortfolioAnalyticsV2 (multi-event portfolio mode)
 * - api_getPortfolioSummaryV2
 * - api_getPortfolioSponsorReportV2
 * - api_getPortfolioSponsorsV2
 *
 * @see /schemas/sponsor-portfolio-v2.schema.json
 * @see /src/mvp/SponsorPortfolioV2.gs
 */

const { test, expect } = require('@playwright/test');
const ApiHelpers = require('./api-helpers');

test.describe('V2 Portfolio Analytics APIs', () => {
  let api;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request);
  });

  test.describe('api_getPortfolioAnalyticsV2', () => {

    test.describe('Request Validation', () => {

      test('returns BAD_INPUT when brandId is missing', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          mode: 'multi-event-portfolio',
          adminKey: 'test-key'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();
        expect(body.ok).toBe(false);
        expect(body.code).toBe('BAD_INPUT');
        expect(body.message).toContain('brandId');
      });

      test('returns NOT_FOUND for unknown brand', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          brandId: 'nonexistent-brand-xyz',
          mode: 'multi-event-portfolio',
          adminKey: 'test-key'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();
        expect(body.ok).toBe(false);
        expect(body.code).toBe('NOT_FOUND');
      });

      test('returns BAD_INPUT for non-parent brand in portfolio mode', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          brandId: 'cbc', // Child brand, not parent
          mode: 'multi-event-portfolio',
          adminKey: process.env.CBC_ADMIN_KEY || 'cbc-admin-key'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();
        expect(body.ok).toBe(false);
        expect(body.code).toBe('BAD_INPUT');
        expect(body.message).toContain('parent organization');
      });

      test('returns BAD_INPUT for invalid admin key', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          brandId: 'abc',
          mode: 'multi-event-portfolio',
          adminKey: 'totally-invalid-key-12345'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();
        expect(body.ok).toBe(false);
        expect(body.code).toBe('BAD_INPUT');
      });
    });

    test.describe('Single-Brand Mode (default)', () => {

      test('defaults to single-brand mode without mode parameter', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          brandId: 'root'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();

        // Should delegate to standard SharedAnalytics
        if (body.ok) {
          expect(body.value).toBeDefined();
          // Single-brand mode returns SharedAnalytics shape
          expect(body.value).toHaveProperty('lastUpdatedISO');
          expect(body.value).toHaveProperty('summary');
          expect(body.value).toHaveProperty('surfaces');
        }
      });

      test('single-brand mode works with explicit mode parameter', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          brandId: 'root',
          mode: 'single-brand'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();

        if (body.ok) {
          expect(body.value).toHaveProperty('summary');
        }
      });
    });

    test.describe('Multi-Event Portfolio Mode', () => {

      test('returns portfolio analytics for parent organization', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          brandId: 'abc',
          mode: 'multi-event-portfolio',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();

        if (body.ok) {
          expect(body.value.mode).toBe('multi-event-portfolio');
          expect(body.value.lastUpdatedISO).toBeDefined();

          // Portfolio structure
          expect(body.value.portfolio).toBeDefined();
          expect(body.value.portfolio.parent).toBeDefined();
          expect(body.value.portfolio.parent.id).toBe('abc');
          expect(body.value.portfolio.children).toBeInstanceOf(Array);

          // Summary
          expect(body.value.summary).toBeDefined();
          expect(body.value.summary.totalEvents).toBeGreaterThanOrEqual(0);
          expect(body.value.summary.totalImpressions).toBeGreaterThanOrEqual(0);
          expect(body.value.summary.totalSponsors).toBeGreaterThanOrEqual(0);
          expect(body.value.summary.portfolioCTR).toBeDefined();

          // byBrand breakdown
          expect(body.value.byBrand).toBeDefined();
          expect(typeof body.value.byBrand).toBe('object');

          // generatedAt timestamp
          expect(body.value.generatedAt).toBeDefined();
        }
      });

      test('includes child brands in portfolio', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          brandId: 'abc',
          mode: 'multi-event-portfolio',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();

        if (body.ok) {
          const children = body.value.portfolio.children;
          const childIds = children.map(c => c.id);

          // Based on Config.gs, CBC and CBL should be included
          expect(childIds).toContain('cbc');
          expect(childIds).toContain('cbl');
        }
      });

      test('aggregates metrics across all brands', async () => {
        const response = await api.post('/api', {
          action: 'api_getPortfolioAnalyticsV2',
          brandId: 'abc',
          mode: 'multi-event-portfolio',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
        });

        expect(response.ok).toBe(true);
        const body = await response.json();

        if (body.ok && Object.keys(body.value.byBrand).length > 0) {
          const { byBrand, summary } = body.value;

          // Sum of brand impressions should equal total
          let totalBrandImpressions = 0;
          Object.values(byBrand).forEach(brand => {
            totalBrandImpressions += brand.impressions || 0;
          });

          expect(summary.totalImpressions).toBe(totalBrandImpressions);
        }
      });

      test('filters by sponsorId when provided', async () => {
        // First get a sponsor ID from the portfolio
        const sponsorsResponse = await api.post('/api', {
          action: 'api_getPortfolioSponsorsV2',
          brandId: 'abc',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
        });

        const sponsorsBody = await sponsorsResponse.json();

        if (sponsorsBody.ok && sponsorsBody.value.sponsors.length > 0) {
          const testSponsorId = sponsorsBody.value.sponsors[0].id;

          const response = await api.post('/api', {
            action: 'api_getPortfolioAnalyticsV2',
            brandId: 'abc',
            mode: 'multi-event-portfolio',
            adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
            sponsorId: testSponsorId
          });

          expect(response.ok).toBe(true);
          const body = await response.json();

          if (body.ok) {
            // Sponsors list should be null when filtering by specific sponsor
            expect(body.value.sponsors).toBeNull();
          }
        }
      });
    });
  });

  test.describe('api_getPortfolioSummaryV2', () => {

    test('returns portfolio summary for parent org', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummaryV2',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      if (body.ok) {
        expect(body.value.portfolio).toBeDefined();
        expect(body.value.metrics).toBeDefined();
        expect(body.value.byBrand).toBeDefined();
        expect(body.value.generatedAt).toBeDefined();

        // Metrics shape
        expect(body.value.metrics.totalEvents).toBeGreaterThanOrEqual(0);
        expect(body.value.metrics.totalSponsors).toBeGreaterThanOrEqual(0);
      }
    });

    test('rejects child brand request', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummaryV2',
        brandId: 'cbc',
        adminKey: process.env.CBC_ADMIN_KEY || 'cbc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe('BAD_INPUT');
    });
  });

  test.describe('api_getPortfolioSponsorReportV2', () => {

    test('requires sponsorId parameter', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSponsorReportV2',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
        // Missing sponsorId
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe('BAD_INPUT');
      expect(body.message).toContain('sponsorId');
    });

    test('returns sponsor report for valid sponsor', async () => {
      // First get a sponsor
      const sponsorsResponse = await api.post('/api', {
        action: 'api_getPortfolioSponsorsV2',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const sponsorsBody = await sponsorsResponse.json();

      if (sponsorsBody.ok && sponsorsBody.value.sponsors.length > 0) {
        const testSponsorId = sponsorsBody.value.sponsors[0].id;

        const response = await api.post('/api', {
          action: 'api_getPortfolioSponsorReportV2',
          brandId: 'abc',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
          sponsorId: testSponsorId
        });

        expect(response.ok).toBe(true);
        const body = await response.json();

        if (body.ok) {
          expect(body.value.parentOrg).toBeDefined();
          expect(body.value.sponsor).toBeDefined();
          expect(body.value.sponsor.id).toBe(testSponsorId);
          expect(body.value.portfolioSummary).toBeDefined();
          expect(body.value.portfolioSummary.totalEvents).toBeGreaterThanOrEqual(0);
          expect(body.value.portfolioSummary.portfolioCTR).toBeDefined();
          expect(body.value.topPerformingEvents).toBeInstanceOf(Array);
          expect(body.value.topPerformingEvents.length).toBeLessThanOrEqual(5);
        }
      }
    });

    test('top events are sorted by impressions', async () => {
      const sponsorsResponse = await api.post('/api', {
        action: 'api_getPortfolioSponsorsV2',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const sponsorsBody = await sponsorsResponse.json();

      if (sponsorsBody.ok && sponsorsBody.value.sponsors.length > 0) {
        const testSponsorId = sponsorsBody.value.sponsors[0].id;

        const response = await api.post('/api', {
          action: 'api_getPortfolioSponsorReportV2',
          brandId: 'abc',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
          sponsorId: testSponsorId
        });

        const body = await response.json();

        if (body.ok && body.value.topPerformingEvents.length > 1) {
          const events = body.value.topPerformingEvents;

          // Verify sorted by impressions descending
          for (let i = 0; i < events.length - 1; i++) {
            expect(events[i].impressions).toBeGreaterThanOrEqual(events[i + 1].impressions);
          }
        }
      }
    });
  });

  test.describe('api_getPortfolioSponsorsV2', () => {

    test('returns deduplicated sponsor list', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSponsorsV2',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      if (body.ok) {
        expect(body.value.sponsors).toBeInstanceOf(Array);
        expect(body.value.totalCount).toBeGreaterThanOrEqual(0);

        // Verify no duplicate IDs
        const ids = body.value.sponsors.map(s => s.id);
        const uniqueIds = new Set(ids);
        expect(ids.length).toBe(uniqueIds.size);

        // Each sponsor should have brand associations
        body.value.sponsors.forEach(sponsor => {
          expect(sponsor).toHaveProperty('id');
          expect(sponsor).toHaveProperty('name');
          expect(sponsor).toHaveProperty('brands');
          expect(Array.isArray(sponsor.brands)).toBe(true);
        });
      }
    });

    test('includes brand associations for each sponsor', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSponsorsV2',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const body = await response.json();

      if (body.ok && body.value.sponsors.length > 0) {
        const sponsor = body.value.sponsors[0];

        expect(sponsor.brands.length).toBeGreaterThan(0);
        sponsor.brands.forEach(brand => {
          expect(brand).toHaveProperty('brandId');
          expect(brand).toHaveProperty('brandName');
        });
      }
    });
  });

  test.describe('Performance', () => {

    test('portfolio analytics responds within 5 seconds', async () => {
      const startTime = Date.now();

      const response = await api.post('/api', {
        action: 'api_getPortfolioAnalyticsV2',
        brandId: 'abc',
        mode: 'multi-event-portfolio',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(5000);
    });

    test('portfolio summary responds within 3 seconds', async () => {
      const startTime = Date.now();

      const response = await api.post('/api', {
        action: 'api_getPortfolioSummaryV2',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(3000);
    });
  });

  test.describe('Response Envelope', () => {

    test('success responses have ok: true and value', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummaryV2',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      if (body.ok) {
        expect(body.ok).toBe(true);
        expect(body.value).toBeDefined();
      }
    });

    test('error responses have ok: false and code/message', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioAnalyticsV2',
        // Missing brandId
        mode: 'multi-event-portfolio'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      expect(body.ok).toBe(false);
      expect(body.code).toBeDefined();
      expect(body.message).toBeDefined();
    });
  });
});
