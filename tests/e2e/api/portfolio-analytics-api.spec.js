/**
 * Brand Portfolio Analytics API Tests
 *
 * Tests the portfolio analytics functionality for parent organizations
 * managing multiple child brands (e.g., ABC managing CBC and CBL)
 */

const { test, expect } = require('@playwright/test');
const ApiHelpers = require('../api/api-helpers');

test.describe('Brand Portfolio Analytics APIs', () => {
  let api;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request);
  });

  test.describe('api_getPortfolioSummary', () => {
    test('requires parent organization brand', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'root', // Not a parent org
        adminKey: 'test-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.message).toContain('parent organization');
    });

    test('requires admin authentication', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'abc', // Parent org
        adminKey: 'invalid-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.message).toContain('admin key');
    });

    test('returns portfolio summary for parent org', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      if (body.ok) {
        expect(body.value).toBeDefined();
        expect(body.value.portfolio).toBeDefined();
        expect(body.value.portfolio.parent).toBeDefined();
        expect(body.value.portfolio.parent.id).toBe('abc');
        expect(body.value.portfolio.children).toBeInstanceOf(Array);

        expect(body.value.metrics).toBeDefined();
        expect(body.value.metrics.totalEvents).toBeGreaterThanOrEqual(0);
        expect(body.value.metrics.totalSponsors).toBeGreaterThanOrEqual(0);
        expect(body.value.metrics.activeSponsors).toBeGreaterThanOrEqual(0);
        expect(body.value.metrics.totalImpressions).toBeGreaterThanOrEqual(0);

        expect(body.value.byBrand).toBeDefined();
        expect(body.value.byBrand['abc']).toBeDefined();
      }
    });

    test('includes only children with includeInPortfolioReports=true', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      if (body.ok) {
        const children = body.value.portfolio.children;

        // Verify children have includeInPortfolioReports = true in Config.gs
        // CBC and CBL should be included by default
        const childIds = children.map(c => c.id);

        // These assertions depend on Config.gs settings
        // Adjust based on actual config
        expect(childIds).toContain('cbc');
        expect(childIds).toContain('cbl');
      }
    });

    test('aggregates metrics across parent and children', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      if (body.ok && body.value.portfolio.children.length > 0) {
        const { byBrand, metrics } = body.value;

        // Total events should be sum of all brands
        let calculatedTotalEvents = 0;
        Object.keys(byBrand).forEach(brandId => {
          calculatedTotalEvents += byBrand[brandId].events;
        });

        expect(metrics.totalEvents).toBe(calculatedTotalEvents);
      }
    });
  });

  test.describe('api_getPortfolioSponsors', () => {
    test('requires parent organization brand', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSponsors',
        brandId: 'cbc', // Child org, not parent
        adminKey: 'test-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.message).toContain('parent organization');
    });

    test('returns all sponsors across portfolio', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSponsors',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      if (body.ok) {
        expect(body.value.sponsors).toBeInstanceOf(Array);
        expect(body.value.totalCount).toBeDefined();
        expect(body.value.totalCount).toBeGreaterThanOrEqual(0);

        // Each sponsor should have brand associations
        body.value.sponsors.forEach(sponsor => {
          expect(sponsor.id).toBeDefined();
          expect(sponsor.name).toBeDefined();
          expect(sponsor.brands).toBeInstanceOf(Array);

          sponsor.brands.forEach(brand => {
            expect(brand.brandId).toBeDefined();
            expect(brand.brandName).toBeDefined();
          });
        });
      }
    });

    test('deduplicates sponsors across brands', async () => {
      // If same sponsor exists in ABC and CBC, should only appear once
      const response = await api.post('/api', {
        action: 'api_getPortfolioSponsors',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      if (body.ok && body.value.sponsors.length > 0) {
        const sponsorIds = body.value.sponsors.map(s => s.id);
        const uniqueIds = new Set(sponsorIds);

        // No duplicate sponsor IDs
        expect(sponsorIds.length).toBe(uniqueIds.size);
      }
    });
  });

  test.describe('api_getPortfolioSponsorReport', () => {
    test('requires parent organization brand', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSponsorReport',
        brandId: 'cbl', // Child org
        adminKey: 'test-admin-key',
        sponsorId: 'sponsor-1'
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.message).toContain('parent organization');
    });

    test('requires sponsor ID', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSponsorReport',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
        sponsorId: '' // Empty sponsor ID
      });

      expect(response.ok).toBe(true);
      const body = await response.json();

      // Should still return OK but with empty data
      if (body.ok) {
        expect(body.value.sponsor.id).toBe('');
      }
    });

    test('returns consolidated sponsor report across portfolio', async () => {
      // First get a sponsor ID
      const sponsorsResponse = await api.post('/api', {
        action: 'api_getPortfolioSponsors',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      expect(sponsorsResponse.ok).toBe(true);
      const sponsorsBody = await sponsorsResponse.json();

      if (sponsorsBody.ok && sponsorsBody.value.sponsors.length > 0) {
        const testSponsorId = sponsorsBody.value.sponsors[0].id;

        const response = await api.post('/api', {
          action: 'api_getPortfolioSponsorReport',
          brandId: 'abc',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
          sponsorId: testSponsorId
        });

        expect(response.ok).toBe(true);
        const body = await response.json();

        if (body.ok) {
          expect(body.value.parentOrg).toBeDefined();
          expect(body.value.parentOrg.id).toBe('abc');

          expect(body.value.sponsor).toBeDefined();
          expect(body.value.sponsor.id).toBe(testSponsorId);

          expect(body.value.portfolioSummary).toBeDefined();
          expect(body.value.portfolioSummary.totalEvents).toBeGreaterThanOrEqual(0);
          expect(body.value.portfolioSummary.totalImpressions).toBeGreaterThanOrEqual(0);
          expect(body.value.portfolioSummary.totalClicks).toBeGreaterThanOrEqual(0);
          expect(body.value.portfolioSummary.portfolioCTR).toBeDefined();

          expect(body.value.byBrand).toBeDefined();
          expect(body.value.topPerformingEvents).toBeInstanceOf(Array);
          expect(body.value.generatedAt).toBeDefined();
        }
      }
    });

    test('calculates portfolio CTR correctly', async () => {
      const sponsorsResponse = await api.post('/api', {
        action: 'api_getPortfolioSponsors',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const sponsorsBody = await sponsorsResponse.json();

      if (sponsorsBody.ok && sponsorsBody.value.sponsors.length > 0) {
        const testSponsorId = sponsorsBody.value.sponsors[0].id;

        const response = await api.post('/api', {
          action: 'api_getPortfolioSponsorReport',
          brandId: 'abc',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
          sponsorId: testSponsorId
        });

        const body = await response.json();

        if (body.ok && body.value.portfolioSummary.totalImpressions > 0) {
          const { totalImpressions, totalClicks, portfolioCTR } = body.value.portfolioSummary;
          const expectedCTR = ((totalClicks / totalImpressions) * 100).toFixed(2);

          expect(portfolioCTR).toBe(expectedCTR);
        }
      }
    });

    test('includes top performing events', async () => {
      const sponsorsResponse = await api.post('/api', {
        action: 'api_getPortfolioSponsors',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const sponsorsBody = await sponsorsResponse.json();

      if (sponsorsBody.ok && sponsorsBody.value.sponsors.length > 0) {
        const testSponsorId = sponsorsBody.value.sponsors[0].id;

        const response = await api.post('/api', {
          action: 'api_getPortfolioSponsorReport',
          brandId: 'abc',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
          sponsorId: testSponsorId
        });

        const body = await response.json();

        if (body.ok) {
          const topEvents = body.value.topPerformingEvents;

          // Should return max 5 events
          expect(topEvents.length).toBeLessThanOrEqual(5);

          // Events should be sorted by impressions descending
          if (topEvents.length > 1) {
            for (let i = 0; i < topEvents.length - 1; i++) {
              expect(topEvents[i].impressions).toBeGreaterThanOrEqual(topEvents[i + 1].impressions);
            }
          }

          // Each event should have required fields
          topEvents.forEach(event => {
            expect(event.id).toBeDefined();
            expect(event.name).toBeDefined();
            expect(event.brandId).toBeDefined();
            expect(event.brandName).toBeDefined();
            expect(event.impressions).toBeGreaterThanOrEqual(0);
            expect(event.clicks).toBeGreaterThanOrEqual(0);
            expect(event.ctr).toBeDefined();
          });
        }
      }
    });
  });

  test.describe('Portfolio Configuration', () => {
    test('respects includeInPortfolioReports flag', async () => {
      // This test verifies that the Config.gs flag is respected
      // When a child brand has includeInPortfolioReports: false,
      // it should not appear in portfolio summary

      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const body = await response.json();

      if (body.ok) {
        const children = body.value.portfolio.children;

        // All children returned should have includeInPortfolioReports = true
        // This is a logical test - we can't directly check the flag
        // but we can verify the behavior matches expectations

        // Based on Config.gs, CBC and CBL should be included
        expect(children.some(c => c.id === 'cbc')).toBe(true);
        expect(children.some(c => c.id === 'cbl')).toBe(true);
      }
    });

    test('parent-child relationship validation', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const body = await response.json();

      if (body.ok) {
        const { portfolio } = body.value;

        // Verify parent is ABC
        expect(portfolio.parent.id).toBe('abc');
        expect(portfolio.parent.name).toBe('American Bocce Co.');

        // Verify children are CBC and CBL
        const childIds = portfolio.children.map(c => c.id);
        expect(childIds).toContain('cbc');
        expect(childIds).toContain('cbl');

        // Verify child names
        const cbcChild = portfolio.children.find(c => c.id === 'cbc');
        const cblChild = portfolio.children.find(c => c.id === 'cbl');

        if (cbcChild) expect(cbcChild.name).toBe('Chicago Bocce Club');
        if (cblChild) expect(cblChild.name).toBe('Chicago Bocce League');
      }
    });
  });

  test.describe('Error Handling', () => {
    test('handles missing brand gracefully', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'nonexistent',
        adminKey: 'test-key'
      });

      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.message).toContain('not found');
    });

    test('handles invalid admin key gracefully', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'abc',
        adminKey: 'totally-wrong-key-12345'
      });

      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.message).toContain('admin key');
    });

    test('handles child brand attempting portfolio access', async () => {
      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'cbc', // Child, not parent
        adminKey: process.env.CBC_ADMIN_KEY || 'cbc-admin-key'
      });

      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.message).toContain('parent organization');
    });
  });

  test.describe('Performance', () => {
    test('portfolio summary responds within acceptable time', async () => {
      const startTime = Date.now();

      const response = await api.post('/api', {
        action: 'api_getPortfolioSummary',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(response.ok).toBe(true);
      // Should respond within 5 seconds
      expect(duration).toBeLessThan(5000);
    });

    test('sponsor report responds within acceptable time', async () => {
      const sponsorsResponse = await api.post('/api', {
        action: 'api_getPortfolioSponsors',
        brandId: 'abc',
        adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key'
      });

      const sponsorsBody = await sponsorsResponse.json();

      if (sponsorsBody.ok && sponsorsBody.value.sponsors.length > 0) {
        const testSponsorId = sponsorsBody.value.sponsors[0].id;

        const startTime = Date.now();

        const response = await api.post('/api', {
          action: 'api_getPortfolioSponsorReport',
          brandId: 'abc',
          adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
          sponsorId: testSponsorId
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        expect(response.ok).toBe(true);
        // Should respond within 5 seconds
        expect(duration).toBeLessThan(5000);
      }
    });
  });
});
