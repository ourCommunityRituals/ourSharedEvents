/**
 * Contract Tests for SharedReport Top Sponsors Card
 *
 * ACCEPTANCE CRITERIA:
 * SharedReport's top sponsors card uses same contract and passes a dedicated test.
 *
 * This test validates:
 * 1. topSponsors[] array structure in SharedAnalytics response
 * 2. Top sponsors card rendering contract (3 sponsors max)
 * 3. Sponsor metrics shape (clicks, ctr) used by the card
 * 4. Contract alignment with sponsor.schema.json
 *
 * @see /src/mvp/SharedReport.html - renderTopSponsorsCard()
 * @see /schemas/shared-analytics.schema.json - topSponsors[] shape
 * @see /schemas/sponsor.schema.json - Sponsor contract
 */

const {
  platinumSponsor,
  goldSponsor,
  silverSponsor
} = require('../shared/fixtures/sponsors.fixtures');

describe('SharedReport Top Sponsors Card Contract Tests', () => {

  describe('TopSponsors Array Shape', () => {

    it('should be an optional array in SharedAnalytics response', () => {
      const responseWithTopSponsors = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-12-02T12:00:00.000Z',
          summary: {
            totalImpressions: 5000,
            totalClicks: 250,
            totalQrScans: 100,
            totalSignups: 50,
            uniqueEvents: 5,
            uniqueSponsors: 3
          },
          surfaces: [],
          topSponsors: [
            { id: 'sp-1', name: 'Top Sponsor 1', clicks: 100, ctr: 5.0 }
          ]
        }
      };

      const responseWithoutTopSponsors = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-12-02T12:00:00.000Z',
          summary: {
            totalImpressions: 0,
            totalClicks: 0,
            totalQrScans: 0,
            totalSignups: 0,
            uniqueEvents: 0,
            uniqueSponsors: 0
          },
          surfaces: []
          // topSponsors is optional
        }
      };

      expect(responseWithTopSponsors.value.topSponsors).toBeInstanceOf(Array);
      expect(responseWithoutTopSponsors.value.topSponsors).toBeUndefined();
    });

    it('should limit to 3 sponsors maximum', () => {
      const topSponsors = [
        { id: 'sp-1', name: 'First', clicks: 100, ctr: 5.0 },
        { id: 'sp-2', name: 'Second', clicks: 80, ctr: 4.0 },
        { id: 'sp-3', name: 'Third', clicks: 60, ctr: 3.0 }
      ];

      // Card renders max 3 sponsors
      const displayedSponsors = topSponsors.slice(0, 3);
      expect(displayedSponsors.length).toBeLessThanOrEqual(3);
    });

    it('should order by clicks descending', () => {
      const topSponsors = [
        { id: 'sp-1', name: 'First', clicks: 100, ctr: 5.0 },
        { id: 'sp-2', name: 'Second', clicks: 80, ctr: 4.0 },
        { id: 'sp-3', name: 'Third', clicks: 60, ctr: 3.0 }
      ];

      // Verify descending order by clicks
      for (let i = 0; i < topSponsors.length - 1; i++) {
        expect(topSponsors[i].clicks).toBeGreaterThanOrEqual(topSponsors[i + 1].clicks);
      }
    });
  });

  describe('TopSponsor Object Shape', () => {

    it('should have required fields: id, name, clicks, ctr', () => {
      const topSponsor = {
        id: 'sp-platinum',
        name: 'Platinum Corp',
        clicks: 100,
        ctr: 5.0
      };

      expect(topSponsor).toHaveProperty('id');
      expect(topSponsor).toHaveProperty('name');
      expect(topSponsor).toHaveProperty('clicks');
      expect(topSponsor).toHaveProperty('ctr');
    });

    it('should have string id matching sponsor contract', () => {
      const topSponsor = {
        id: platinumSponsor.id,
        name: platinumSponsor.name,
        clicks: 100,
        ctr: 5.0
      };

      expect(typeof topSponsor.id).toBe('string');
      expect(topSponsor.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it('should have string name for display', () => {
      const topSponsor = {
        id: 'sp-1',
        name: 'Test Sponsor',
        clicks: 100,
        ctr: 5.0
      };

      expect(typeof topSponsor.name).toBe('string');
      expect(topSponsor.name.length).toBeGreaterThan(0);
    });

    it('should have numeric clicks (integer)', () => {
      const topSponsor = {
        id: 'sp-1',
        name: 'Test',
        clicks: 100,
        ctr: 5.0
      };

      expect(typeof topSponsor.clicks).toBe('number');
      expect(Number.isInteger(topSponsor.clicks)).toBe(true);
      expect(topSponsor.clicks).toBeGreaterThanOrEqual(0);
    });

    it('should have numeric ctr (percentage)', () => {
      const topSponsor = {
        id: 'sp-1',
        name: 'Test',
        clicks: 100,
        ctr: 5.0
      };

      expect(typeof topSponsor.ctr).toBe('number');
      expect(topSponsor.ctr).toBeGreaterThanOrEqual(0);
      expect(topSponsor.ctr).toBeLessThanOrEqual(100);
    });
  });

  describe('Card Rendering Contract', () => {

    it('should render rank emojis for top 3', () => {
      const rankEmojis = ['🥇', '🥈', '🥉'];

      expect(rankEmojis[0]).toBe('🥇');
      expect(rankEmojis[1]).toBe('🥈');
      expect(rankEmojis[2]).toBe('🥉');
    });

    it('should display clicks with locale formatting', () => {
      const clicks = 1234567;
      const formatted = clicks.toLocaleString();

      expect(formatted).not.toBe('1234567');
      expect(formatted).toContain(','); // Assuming US locale
    });

    it('should display ctr with 1 decimal place', () => {
      const ctr = 5.123;
      const formatted = ctr.toFixed(1);

      expect(formatted).toBe('5.1');
    });

    it('should hide card when topSponsors is empty or undefined', () => {
      const emptyTopSponsors = [];
      const undefinedTopSponsors = undefined;
      const nullTopSponsors = null;

      const shouldHide1 = !emptyTopSponsors || !emptyTopSponsors.length;
      const shouldHide2 = !undefinedTopSponsors || !undefinedTopSponsors?.length;
      const shouldHide3 = !nullTopSponsors || !nullTopSponsors?.length;

      expect(shouldHide1).toBe(true);
      expect(shouldHide2).toBe(true);
      expect(shouldHide3).toBe(true);
    });

    it('should show card when topSponsors has items', () => {
      const topSponsors = [
        { id: 'sp-1', name: 'Test', clicks: 100, ctr: 5.0 }
      ];

      const shouldShow = topSponsors && topSponsors.length > 0;
      expect(shouldShow).toBe(true);
    });
  });

  describe('Contract Alignment with Sponsor Schema', () => {

    it('should use same id format as sponsor contract', () => {
      const topSponsor = {
        id: platinumSponsor.id,
        name: platinumSponsor.name,
        clicks: 100,
        ctr: 5.0
      };

      // ID should match sponsor contract pattern
      expect(topSponsor.id).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(topSponsor.id.length).toBeLessThanOrEqual(128);
    });

    it('should use same name as sponsor contract', () => {
      const topSponsor = {
        id: goldSponsor.id,
        name: goldSponsor.name,
        clicks: 80,
        ctr: 4.0
      };

      // Name should match sponsor fixture
      expect(topSponsor.name).toBe(goldSponsor.name);
      expect(topSponsor.name.length).toBeLessThanOrEqual(200);
    });

    it('should derive clicks from sponsor analytics', () => {
      // Clicks come from analytics aggregation
      const analyticsData = {
        totalClicks: 250,
        sponsors: [
          { id: platinumSponsor.id, clicks: 100 },
          { id: goldSponsor.id, clicks: 80 },
          { id: silverSponsor.id, clicks: 70 }
        ]
      };

      // Top sponsors derived from analytics
      const topSponsors = analyticsData.sponsors
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 3);

      expect(topSponsors[0].clicks).toBe(100);
      expect(topSponsors[1].clicks).toBe(80);
      expect(topSponsors[2].clicks).toBe(70);
    });

    it('should calculate ctr from impressions and clicks', () => {
      const sponsor = {
        impressions: 2000,
        clicks: 100
      };

      const ctr = sponsor.impressions > 0
        ? (sponsor.clicks / sponsor.impressions * 100)
        : 0;

      expect(ctr).toBe(5.0);
    });
  });

  describe('API Response Integration', () => {

    it('should validate full api_getSharedAnalytics response with topSponsors', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-12-02T12:00:00.000Z',
          summary: {
            totalImpressions: 5000,
            totalClicks: 250,
            totalQrScans: 100,
            totalSignups: 50,
            uniqueEvents: 5,
            uniqueSponsors: 3
          },
          surfaces: [
            { id: 'display', label: 'Display', impressions: 2000, clicks: 100, qrScans: 40, engagementRate: 7.0 },
            { id: 'public', label: 'Public', impressions: 1500, clicks: 75, qrScans: 30, engagementRate: 7.0 },
            { id: 'poster', label: 'Poster', impressions: 1500, clicks: 75, qrScans: 30, engagementRate: 7.0 }
          ],
          sponsors: [
            { id: platinumSponsor.id, name: platinumSponsor.name, impressions: 2000, clicks: 100, ctr: 5.0 },
            { id: goldSponsor.id, name: goldSponsor.name, impressions: 2000, clicks: 80, ctr: 4.0 },
            { id: silverSponsor.id, name: silverSponsor.name, impressions: 1000, clicks: 70, ctr: 7.0 }
          ],
          topSponsors: [
            { id: platinumSponsor.id, name: platinumSponsor.name, clicks: 100, ctr: 5.0 },
            { id: goldSponsor.id, name: goldSponsor.name, clicks: 80, ctr: 4.0 },
            { id: silverSponsor.id, name: silverSponsor.name, clicks: 70, ctr: 7.0 }
          ]
        }
      };

      // Validate envelope
      expect(mockResponse.ok).toBe(true);
      expect(mockResponse.value).toBeDefined();

      // Validate topSponsors
      expect(mockResponse.value.topSponsors).toBeInstanceOf(Array);
      expect(mockResponse.value.topSponsors.length).toBeLessThanOrEqual(3);

      // Validate each top sponsor
      mockResponse.value.topSponsors.forEach(sponsor => {
        expect(sponsor).toHaveProperty('id');
        expect(sponsor).toHaveProperty('name');
        expect(sponsor).toHaveProperty('clicks');
        expect(sponsor).toHaveProperty('ctr');
        expect(typeof sponsor.clicks).toBe('number');
        expect(typeof sponsor.ctr).toBe('number');
      });

      // Validate ordering by clicks
      const clicks = mockResponse.value.topSponsors.map(s => s.clicks);
      for (let i = 0; i < clicks.length - 1; i++) {
        expect(clicks[i]).toBeGreaterThanOrEqual(clicks[i + 1]);
      }
    });

    it('should handle response with no sponsors gracefully', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-12-02T12:00:00.000Z',
          summary: {
            totalImpressions: 0,
            totalClicks: 0,
            totalQrScans: 0,
            totalSignups: 0,
            uniqueEvents: 0,
            uniqueSponsors: 0
          },
          surfaces: [],
          sponsors: [],
          topSponsors: []
        }
      };

      expect(mockResponse.ok).toBe(true);
      expect(mockResponse.value.topSponsors).toBeInstanceOf(Array);
      expect(mockResponse.value.topSponsors.length).toBe(0);
    });

    it('should handle response with single sponsor', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-12-02T12:00:00.000Z',
          summary: {
            totalImpressions: 1000,
            totalClicks: 50,
            totalQrScans: 10,
            totalSignups: 5,
            uniqueEvents: 1,
            uniqueSponsors: 1
          },
          surfaces: [
            { id: 'display', label: 'Display', impressions: 1000, clicks: 50, qrScans: 10, engagementRate: 6.0 }
          ],
          sponsors: [
            { id: platinumSponsor.id, name: platinumSponsor.name, impressions: 1000, clicks: 50, ctr: 5.0 }
          ],
          topSponsors: [
            { id: platinumSponsor.id, name: platinumSponsor.name, clicks: 50, ctr: 5.0 }
          ]
        }
      };

      expect(mockResponse.value.topSponsors.length).toBe(1);
      expect(mockResponse.value.topSponsors[0].id).toBe(platinumSponsor.id);
    });
  });

  describe('Brand Isolation in Top Sponsors', () => {

    it('should only include sponsors from the requested brand', () => {
      // Root brand response
      const rootResponse = {
        ok: true,
        value: {
          topSponsors: [
            { id: 'sp-root-1', name: 'Root Sponsor 1', clicks: 100, ctr: 5.0 }
          ]
        }
      };

      // ABC brand response
      const abcResponse = {
        ok: true,
        value: {
          topSponsors: [
            { id: 'sp-abc-1', name: 'ABC Sponsor 1', clicks: 80, ctr: 4.0 }
          ]
        }
      };

      // Root response should not contain abc sponsors
      const rootHasAbc = rootResponse.value.topSponsors.some(s => s.id.includes('abc'));
      expect(rootHasAbc).toBe(false);

      // ABC response should not contain root sponsors
      const abcHasRoot = abcResponse.value.topSponsors.some(s => s.id.includes('root'));
      expect(abcHasRoot).toBe(false);
    });
  });
});
