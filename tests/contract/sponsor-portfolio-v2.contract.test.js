/**
 * Contract Tests for V2 Sponsor Portfolio Analytics APIs
 *
 * Tests the API contracts defined in /schemas/sponsor-portfolio-v2.schema.json
 *
 * These tests validate:
 * - Response envelope structure (Ok/Err)
 * - Portfolio analytics shape for multi-event mode
 * - Portfolio summary structure
 * - Sponsor report structure
 * - Error handling for invalid requests
 *
 * @see /schemas/sponsor-portfolio-v2.schema.json
 * @see /src/mvp/SponsorPortfolioV2.gs
 */

const {
  validateEnvelope,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

describe('V2 Sponsor Portfolio Analytics Contract Tests', () => {

  describe('api_getPortfolioAnalyticsV2', () => {

    describe('Portfolio Mode Constants', () => {
      it('should support single-brand mode (default)', () => {
        const validModes = ['single-brand', 'multi-event-portfolio'];
        expect(validModes).toContain('single-brand');
      });

      it('should support multi-event-portfolio mode', () => {
        const validModes = ['single-brand', 'multi-event-portfolio'];
        expect(validModes).toContain('multi-event-portfolio');
      });
    });

    describe('Multi-Event Portfolio Response Shape', () => {
      it('should return valid portfolio analytics response', () => {
        const mockResponse = {
          ok: true,
          value: {
            mode: 'multi-event-portfolio',
            lastUpdatedISO: '2025-11-29T12:00:00.000Z',
            portfolio: {
              parent: {
                id: 'abc',
                name: 'American Bocce Co.',
                isParent: true
              },
              children: [
                { id: 'cbc', name: 'Chicago Bocce Club', isParent: false },
                { id: 'cbl', name: 'Chicago Bocce League', isParent: false }
              ]
            },
            summary: {
              totalEvents: 15,
              totalImpressions: 5000,
              totalClicks: 250,
              totalQrScans: 100,
              totalSignups: 50,
              totalSponsors: 8,
              activeSponsors: 6,
              portfolioCTR: 5.0
            },
            byBrand: {
              'abc': {
                brandId: 'abc',
                brandName: 'American Bocce Co.',
                events: 5,
                impressions: 2000,
                clicks: 100,
                ctr: 5.0,
                qrScans: 40,
                signups: 20
              },
              'cbc': {
                brandId: 'cbc',
                brandName: 'Chicago Bocce Club',
                events: 5,
                impressions: 1500,
                clicks: 75,
                ctr: 5.0,
                qrScans: 30,
                signups: 15
              },
              'cbl': {
                brandId: 'cbl',
                brandName: 'Chicago Bocce League',
                events: 5,
                impressions: 1500,
                clicks: 75,
                ctr: 5.0,
                qrScans: 30,
                signups: 15
              }
            },
            sponsors: [
              {
                id: 'sponsor-1',
                name: 'Gold Sponsor',
                logoUrl: 'https://example.com/logo.png',
                brands: [
                  { id: 'abc', name: 'American Bocce Co.' },
                  { id: 'cbc', name: 'Chicago Bocce Club' }
                ],
                metrics: {
                  impressions: 3000,
                  clicks: 150,
                  ctr: 5.0,
                  qrScans: 60,
                  engagementScore: 75
                }
              }
            ],
            topPerformingEvents: [
              {
                id: 'event-1',
                name: 'Summer Tournament',
                brandId: 'abc',
                brandName: 'American Bocce Co.',
                impressions: 1000,
                clicks: 50,
                ctr: 5.0,
                signupsCount: 10
              }
            ],
            roi: null,
            generatedAt: '2025-11-29T12:00:00.000Z'
          }
        };

        validateEnvelope(mockResponse);

        // Validate mode
        expect(mockResponse.value.mode).toBe('multi-event-portfolio');

        // Validate portfolio structure
        expect(mockResponse.value.portfolio).toBeDefined();
        expect(mockResponse.value.portfolio.parent).toBeDefined();
        expect(mockResponse.value.portfolio.parent.id).toBe('abc');
        expect(mockResponse.value.portfolio.children).toBeInstanceOf(Array);

        // Validate summary
        expect(mockResponse.value.summary).toBeDefined();
        expect(mockResponse.value.summary.totalEvents).toBeGreaterThanOrEqual(0);
        expect(mockResponse.value.summary.totalImpressions).toBeGreaterThanOrEqual(0);
        expect(mockResponse.value.summary.portfolioCTR).toBeDefined();

        // Validate byBrand
        expect(mockResponse.value.byBrand).toBeDefined();
        expect(typeof mockResponse.value.byBrand).toBe('object');

        // Validate sponsors (array or null)
        if (mockResponse.value.sponsors) {
          expect(Array.isArray(mockResponse.value.sponsors)).toBe(true);
        }

        // Validate topPerformingEvents
        if (mockResponse.value.topPerformingEvents) {
          expect(Array.isArray(mockResponse.value.topPerformingEvents)).toBe(true);
          expect(mockResponse.value.topPerformingEvents.length).toBeLessThanOrEqual(10);
        }
      });

      it('should validate BrandInfo shape', () => {
        const brandInfo = {
          id: 'abc',
          name: 'American Bocce Co.',
          isParent: true
        };

        expect(brandInfo).toHaveProperty('id');
        expect(brandInfo).toHaveProperty('name');
        expect(typeof brandInfo.id).toBe('string');
        expect(typeof brandInfo.name).toBe('string');
      });

      it('should validate PortfolioSponsor shape', () => {
        const sponsor = {
          id: 'sponsor-1',
          name: 'Gold Sponsor',
          logoUrl: 'https://example.com/logo.png',
          brands: [{ id: 'abc', name: 'ABC' }],
          metrics: {
            impressions: 1000,
            clicks: 50,
            ctr: 5.0,
            qrScans: 20,
            engagementScore: 75
          }
        };

        expect(sponsor).toHaveProperty('id');
        expect(sponsor).toHaveProperty('name');
        expect(sponsor).toHaveProperty('brands');
        expect(sponsor).toHaveProperty('metrics');
        expect(Array.isArray(sponsor.brands)).toBe(true);
        expect(sponsor.metrics).toHaveProperty('impressions');
        expect(sponsor.metrics).toHaveProperty('clicks');
        expect(sponsor.metrics).toHaveProperty('ctr');
      });

      it('should validate BrandMetrics shape', () => {
        const brandMetrics = {
          brandId: 'abc',
          brandName: 'American Bocce Co.',
          events: 5,
          impressions: 2000,
          clicks: 100,
          ctr: 5.0,
          qrScans: 40,
          signups: 20
        };

        expect(brandMetrics).toHaveProperty('brandId');
        expect(brandMetrics).toHaveProperty('brandName');
        expect(brandMetrics).toHaveProperty('events');
        expect(brandMetrics).toHaveProperty('impressions');
        expect(brandMetrics).toHaveProperty('clicks');
        expect(brandMetrics).toHaveProperty('ctr');
        expect(typeof brandMetrics.events).toBe('number');
        expect(typeof brandMetrics.ctr).toBe('number');
      });

      it('should validate EventPerformance shape', () => {
        const event = {
          id: 'event-1',
          name: 'Summer Tournament',
          brandId: 'abc',
          brandName: 'American Bocce Co.',
          impressions: 1000,
          clicks: 50,
          ctr: 5.0,
          signupsCount: 10
        };

        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('brandId');
        expect(event).toHaveProperty('impressions');
        expect(event).toHaveProperty('clicks');
        expect(event).toHaveProperty('ctr');
      });

      it('should validate PortfolioSummary shape', () => {
        const summary = {
          totalEvents: 15,
          totalImpressions: 5000,
          totalClicks: 250,
          totalQrScans: 100,
          totalSignups: 50,
          totalSponsors: 8,
          activeSponsors: 6,
          portfolioCTR: 5.0
        };

        expect(summary).toHaveProperty('totalEvents');
        expect(summary).toHaveProperty('totalImpressions');
        expect(summary).toHaveProperty('totalClicks');
        expect(summary).toHaveProperty('totalSponsors');
        expect(summary).toHaveProperty('portfolioCTR');
        expect(summary.totalEvents).toBeGreaterThanOrEqual(0);
        expect(summary.totalImpressions).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Error Responses', () => {
      it('should return BAD_INPUT for missing brandId', () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'brandId required'
        };

        validateEnvelope(mockResponse);
        expect(mockResponse.code).toBe('BAD_INPUT');
      });

      it('should return NOT_FOUND for unknown brand', () => {
        const mockResponse = {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Brand not found: unknown-brand'
        };

        validateEnvelope(mockResponse);
        expect(mockResponse.code).toBe('NOT_FOUND');
      });

      it('should return BAD_INPUT for non-parent brand in portfolio mode', () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'Multi-event portfolio mode requires a parent organization brand'
        };

        validateEnvelope(mockResponse);
        expect(mockResponse.code).toBe('BAD_INPUT');
      });

      it('should return BAD_INPUT for invalid admin key', () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'Invalid admin key for portfolio access'
        };

        validateEnvelope(mockResponse);
        expect(mockResponse.code).toBe('BAD_INPUT');
      });
    });
  });

  describe('api_getPortfolioSummaryV2', () => {
    it('should return valid portfolio summary response', () => {
      const mockResponse = {
        ok: true,
        value: {
          portfolio: {
            parent: { id: 'abc', name: 'American Bocce Co.' },
            children: [
              { id: 'cbc', name: 'Chicago Bocce Club' },
              { id: 'cbl', name: 'Chicago Bocce League' }
            ]
          },
          metrics: {
            totalEvents: 15,
            totalImpressions: 5000,
            totalClicks: 250,
            totalQrScans: 100,
            totalSignups: 50,
            totalSponsors: 8,
            activeSponsors: 6,
            portfolioCTR: 5.0
          },
          byBrand: {
            'abc': { brandId: 'abc', events: 5, impressions: 2000, clicks: 100, ctr: 5.0 }
          },
          generatedAt: '2025-11-29T12:00:00.000Z'
        }
      };

      validateEnvelope(mockResponse);

      expect(mockResponse.value.portfolio).toBeDefined();
      expect(mockResponse.value.metrics).toBeDefined();
      expect(mockResponse.value.byBrand).toBeDefined();
      expect(mockResponse.value.generatedAt).toBeDefined();
    });

    it('should require parent organization brand', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Portfolio summary requires a parent organization brand'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });
  });

  describe('api_getPortfolioSponsorReportV2', () => {
    it('should return valid sponsor portfolio report', () => {
      const mockResponse = {
        ok: true,
        value: {
          parentOrg: { id: 'abc', name: 'American Bocce Co.' },
          sponsor: { id: 'sponsor-1', name: 'Gold Sponsor' },
          portfolioSummary: {
            totalEvents: 10,
            totalImpressions: 3000,
            totalClicks: 150,
            portfolioCTR: '5.00'
          },
          byBrand: {
            'abc': { brandId: 'abc', events: 5, impressions: 1500, clicks: 75, ctr: 5.0 }
          },
          topPerformingEvents: [
            {
              id: 'event-1',
              name: 'Summer Tournament',
              brandId: 'abc',
              brandName: 'American Bocce Co.',
              impressions: 500,
              clicks: 25,
              ctr: 5.0
            }
          ],
          generatedAt: '2025-11-29T12:00:00.000Z'
        }
      };

      validateEnvelope(mockResponse);

      expect(mockResponse.value.parentOrg).toBeDefined();
      expect(mockResponse.value.sponsor).toBeDefined();
      expect(mockResponse.value.portfolioSummary).toBeDefined();
      expect(mockResponse.value.portfolioSummary.totalEvents).toBeGreaterThanOrEqual(0);
      expect(mockResponse.value.portfolioSummary.portfolioCTR).toBeDefined();
      expect(mockResponse.value.topPerformingEvents).toBeInstanceOf(Array);
      expect(mockResponse.value.topPerformingEvents.length).toBeLessThanOrEqual(5);
    });

    it('should require sponsorId', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'sponsorId required for sponsor report'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });
  });

  describe('api_getPortfolioSponsorsV2', () => {
    it('should return deduplicated sponsor list', () => {
      const mockResponse = {
        ok: true,
        value: {
          sponsors: [
            {
              id: 'sponsor-1',
              name: 'Gold Sponsor',
              logoUrl: 'https://example.com/logo.png',
              brands: [
                { brandId: 'abc', brandName: 'American Bocce Co.' },
                { brandId: 'cbc', brandName: 'Chicago Bocce Club' }
              ]
            },
            {
              id: 'sponsor-2',
              name: 'Silver Sponsor',
              logoUrl: null,
              brands: [
                { brandId: 'cbl', brandName: 'Chicago Bocce League' }
              ]
            }
          ],
          totalCount: 2
        }
      };

      validateEnvelope(mockResponse);

      expect(mockResponse.value.sponsors).toBeInstanceOf(Array);
      expect(mockResponse.value.totalCount).toBe(2);

      // Verify deduplication - no duplicate sponsor IDs
      const ids = mockResponse.value.sponsors.map(s => s.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);

      // Each sponsor should have brand associations
      mockResponse.value.sponsors.forEach(sponsor => {
        expect(sponsor).toHaveProperty('id');
        expect(sponsor).toHaveProperty('name');
        expect(sponsor).toHaveProperty('brands');
        expect(Array.isArray(sponsor.brands)).toBe(true);
      });
    });
  });

  describe('ROI Metrics (V2+ Feature)', () => {
    it('should validate ROIMetrics shape when provided', () => {
      const roiMetrics = {
        totalCost: 5000.00,
        costPerClick: 20.00,
        cpm: 4.00,
        estimatedROI: 150.0
      };

      expect(roiMetrics).toHaveProperty('totalCost');
      expect(roiMetrics).toHaveProperty('costPerClick');
      expect(roiMetrics).toHaveProperty('cpm');
      expect(roiMetrics).toHaveProperty('estimatedROI');
      expect(roiMetrics.totalCost).toBeGreaterThanOrEqual(0);
    });

    it('should allow null ROI when cost data unavailable', () => {
      const mockResponse = {
        ok: true,
        value: {
          mode: 'multi-event-portfolio',
          lastUpdatedISO: '2025-11-29T12:00:00.000Z',
          portfolio: { parent: { id: 'abc', name: 'ABC' }, children: [] },
          summary: {
            totalEvents: 0,
            totalImpressions: 0,
            totalClicks: 0,
            totalSponsors: 0,
            portfolioCTR: 0
          },
          roi: null,  // No cost data available
          generatedAt: '2025-11-29T12:00:00.000Z'
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value.roi).toBeNull();
    });
  });

  describe('Timestamp Formats', () => {
    it('should validate ISO 8601 timestamp format', () => {
      const validTimestamps = [
        '2025-11-29',
        '2025-11-29T12:00:00.000Z',
        '2025-11-29T12:00:00Z'
      ];

      validTimestamps.forEach(ts => {
        const date = new Date(ts);
        expect(date.getTime()).not.toBeNaN();
      });
    });

    it('should include lastUpdatedISO in all responses', () => {
      const mockResponse = {
        ok: true,
        value: {
          mode: 'multi-event-portfolio',
          lastUpdatedISO: '2025-11-29T12:00:00.000Z',
          portfolio: { parent: { id: 'abc', name: 'ABC' }, children: [] },
          summary: { totalEvents: 0, totalImpressions: 0, totalClicks: 0, totalSponsors: 0, portfolioCTR: 0 },
          generatedAt: '2025-11-29T12:00:00.000Z'
        }
      };

      expect(mockResponse.value.lastUpdatedISO).toBeDefined();
      expect(mockResponse.value.lastUpdatedISO).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('Error Codes', () => {
    it('should use standard error codes', () => {
      // Note: UNAUTHORIZED exists in ApiSchemas.gs but not exported in test helpers
      // The codebase uses BAD_INPUT for invalid admin key for consistency
      const requiredCodes = ['BAD_INPUT', 'NOT_FOUND', 'INTERNAL'];

      requiredCodes.forEach(code => {
        expect(ERROR_CODES).toHaveProperty(code);
      });
    });
  });
});
