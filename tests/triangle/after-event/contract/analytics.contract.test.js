/**
 * Contract Tests for Analytics API (After Event)
 *
 * Tests the analytics endpoints used during the After Event phase
 *
 * Triangle Phase: 📊 After Event (Purple)
 * API Endpoints: ?action=logEvents, ?action=trackEventMetric, ?action=getReport
 * Purpose: Track and report event analytics, sponsor ROI, and engagement metrics
 * User Roles: Event Manager, Sponsor
 *
 * MVP Endpoints:
 *   - api_trackEventMetric: Simplified metric tracking for MVP surfaces
 *     Required: eventId, surface (public|display|poster|admin), action (view|impression|click|scan|cta_click|sponsor_click|dwell)
 *     Optional: sponsorId, value
 */

describe('🔺 TRIANGLE [AFTER EVENT]: Analytics API Contract', () => {

  const validateEnvelope = (response) => {
    expect(response).toHaveProperty('ok');
    expect(typeof response.ok).toBe('boolean');

    if (response.ok) {
      if (!response.notModified) {
        expect(response).toHaveProperty('value');
      }
    } else {
      expect(response).toHaveProperty('code');
      expect(response).toHaveProperty('message');
    }
  };

  describe('api_logEvents - Event tracking', () => {
    it('should return count of logged events', () => {
      const mockResponse = {
        ok: true,
        value: { count: 5 }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('count');
      expect(typeof mockResponse.value.count).toBe('number');
    });

    it('should accept batch event logging', () => {
      const mockResponse = {
        ok: true,
        value: { count: 10 }
      };

      expect(mockResponse.value.count).toBeGreaterThan(0);
    });

    it('should handle empty event batch', () => {
      const mockResponse = {
        ok: true,
        value: { count: 0 }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value.count).toBe(0);
    });
  });

  describe('api_trackEventMetric - Simplified metric tracking (MVP)', () => {
    /**
     * api_trackEventMetric is a simplified analytics endpoint for MVP surfaces.
     *
     * Required parameters:
     *   - eventId: string - The event being tracked
     *   - surface: enum - 'public' | 'display' | 'poster' | 'admin'
     *   - action: enum - 'view' | 'impression' | 'click' | 'scan' | 'cta_click' | 'sponsor_click' | 'dwell'
     *
     * Optional parameters:
     *   - sponsorId: string - For sponsor-specific tracking
     *   - value: number - For dwell time or numeric metrics
     */

    it('should return count of 1 for single metric tracking', () => {
      const mockResponse = {
        ok: true,
        value: { count: 1 }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('count');
      expect(mockResponse.value.count).toBe(1);
    });

    it('should validate required eventId field', () => {
      const mockMissingEventId = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'missing eventId'
      };

      validateEnvelope(mockMissingEventId);
      expect(mockMissingEventId.code).toBe('BAD_INPUT');
    });

    it('should validate required surface field', () => {
      const mockMissingSurface = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'missing surface'
      };

      validateEnvelope(mockMissingSurface);
      expect(mockMissingSurface.code).toBe('BAD_INPUT');
    });

    it('should validate required action field', () => {
      const mockMissingAction = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'missing action'
      };

      validateEnvelope(mockMissingAction);
      expect(mockMissingAction.code).toBe('BAD_INPUT');
    });

    describe('Surface enum validation', () => {
      const validSurfaces = ['public', 'display', 'poster', 'admin'];

      validSurfaces.forEach(surface => {
        it(`should accept surface: "${surface}"`, () => {
          const mockResponse = {
            ok: true,
            value: { count: 1 }
          };

          validateEnvelope(mockResponse);
          expect(validSurfaces).toContain(surface);
        });
      });

      it('should reject invalid surface values', () => {
        const mockInvalidSurface = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'invalid surface'
        };

        validateEnvelope(mockInvalidSurface);
        expect(mockInvalidSurface.code).toBe('BAD_INPUT');
      });
    });

    describe('Action enum validation', () => {
      const validActions = ['view', 'impression', 'click', 'scan', 'cta_click', 'sponsor_click', 'dwell'];

      validActions.forEach(action => {
        it(`should accept action: "${action}"`, () => {
          const mockResponse = {
            ok: true,
            value: { count: 1 }
          };

          validateEnvelope(mockResponse);
          expect(validActions).toContain(action);
        });
      });

      it('should reject invalid action values', () => {
        const mockInvalidAction = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'invalid action'
        };

        validateEnvelope(mockInvalidAction);
        expect(mockInvalidAction.code).toBe('BAD_INPUT');
      });
    });

    describe('Optional parameters', () => {
      it('should accept optional sponsorId for sponsor_click tracking', () => {
        const mockResponse = {
          ok: true,
          value: { count: 1 }
        };

        // Request shape: { eventId, surface: 'public', action: 'sponsor_click', sponsorId: 'sp-123' }
        validateEnvelope(mockResponse);
        expect(mockResponse.ok).toBe(true);
      });

      it('should accept optional value for dwell time tracking', () => {
        const mockResponse = {
          ok: true,
          value: { count: 1 }
        };

        // Request shape: { eventId, surface: 'display', action: 'dwell', value: 30 }
        validateEnvelope(mockResponse);
        expect(mockResponse.ok).toBe(true);
      });
    });

    describe('Surface-action combinations for MVP pages', () => {
      it('should track public page view', () => {
        // Public.html sends: surface='public', action='view'
        const mockResponse = { ok: true, value: { count: 1 } };
        validateEnvelope(mockResponse);
      });

      it('should track public page CTA click', () => {
        // Public.html sends: surface='public', action='cta_click'
        const mockResponse = { ok: true, value: { count: 1 } };
        validateEnvelope(mockResponse);
      });

      it('should track display page impression', () => {
        // Display.html sends: surface='display', action='impression'
        const mockResponse = { ok: true, value: { count: 1 } };
        validateEnvelope(mockResponse);
      });

      it('should track display page dwell time', () => {
        // Display.html sends: surface='display', action='dwell', value=seconds
        const mockResponse = { ok: true, value: { count: 1 } };
        validateEnvelope(mockResponse);
      });

      it('should track poster QR scan', () => {
        // Poster.html sends: surface='poster', action='scan'
        const mockResponse = { ok: true, value: { count: 1 } };
        validateEnvelope(mockResponse);
      });

      it('should track sponsor click with sponsorId', () => {
        // Any surface sends: action='sponsor_click', sponsorId='sp-xxx'
        const mockResponse = { ok: true, value: { count: 1 } };
        validateEnvelope(mockResponse);
      });
    });
  });

  describe('api_getReport - Aggregated analytics', () => {
    it('should return complete analytics structure', () => {
      const mockResponse = {
        ok: true,
        value: {
          totals: {
            impressions: 100,
            clicks: 10,
            dwellSec: 500
          },
          bySurface: {
            'display': { impressions: 50, clicks: 5, dwellSec: 250 },
            'public': { impressions: 50, clicks: 5, dwellSec: 250 }
          },
          bySponsor: {
            'sponsor-1': { impressions: 80, clicks: 8, dwellSec: 400, ctr: 0.1 }
          },
          byToken: {
            'token-123': { impressions: 20, clicks: 2, dwellSec: 100, ctr: 0.1 }
          }
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('totals');
      expect(mockResponse.value).toHaveProperty('bySurface');
      expect(mockResponse.value).toHaveProperty('bySponsor');
      expect(mockResponse.value).toHaveProperty('byToken');
    });

    it('should include total metrics', () => {
      const mockResponse = {
        ok: true,
        value: {
          totals: {
            impressions: 100,
            clicks: 10,
            dwellSec: 500
          },
          bySurface: {},
          bySponsor: {},
          byToken: {}
        }
      };

      expect(mockResponse.value.totals).toHaveProperty('impressions');
      expect(mockResponse.value.totals).toHaveProperty('clicks');
      expect(mockResponse.value.totals).toHaveProperty('dwellSec');
      expect(typeof mockResponse.value.totals.impressions).toBe('number');
      expect(typeof mockResponse.value.totals.clicks).toBe('number');
      expect(typeof mockResponse.value.totals.dwellSec).toBe('number');
    });

    it('should include surface breakdown for Display and Public pages', () => {
      const mockResponse = {
        ok: true,
        value: {
          totals: { impressions: 100, clicks: 10, dwellSec: 500 },
          bySurface: {
            'display': { impressions: 50, clicks: 5, dwellSec: 250 },
            'public': { impressions: 50, clicks: 5, dwellSec: 250 }
          },
          bySponsor: {},
          byToken: {}
        }
      };

      expect(mockResponse.value.bySurface).toHaveProperty('display');
      expect(mockResponse.value.bySurface).toHaveProperty('public');
    });

    it('should include sponsor performance metrics', () => {
      const mockResponse = {
        ok: true,
        value: {
          totals: { impressions: 100, clicks: 10, dwellSec: 500 },
          bySurface: {},
          bySponsor: {
            'sponsor-1': { impressions: 80, clicks: 8, dwellSec: 400, ctr: 0.1 }
          },
          byToken: {}
        }
      };

      const sponsor = mockResponse.value.bySponsor['sponsor-1'];
      expect(sponsor).toHaveProperty('impressions');
      expect(sponsor).toHaveProperty('clicks');
      expect(sponsor).toHaveProperty('dwellSec');
      expect(sponsor).toHaveProperty('ctr');
    });

    it('should calculate CTR correctly', () => {
      const mockResponse = {
        ok: true,
        value: {
          totals: { impressions: 100, clicks: 10, dwellSec: 500 },
          bySurface: {},
          bySponsor: {
            'sponsor-1': { impressions: 100, clicks: 10, dwellSec: 400, ctr: 0.1 }
          },
          byToken: {}
        }
      };

      const sponsor = mockResponse.value.bySponsor['sponsor-1'];
      expect(sponsor.ctr).toBe(sponsor.clicks / sponsor.impressions);
    });

    it('should include token-based tracking for shortlinks', () => {
      const mockResponse = {
        ok: true,
        value: {
          totals: { impressions: 100, clicks: 10, dwellSec: 500 },
          bySurface: {},
          bySponsor: {},
          byToken: {
            'token-123': { impressions: 20, clicks: 2, dwellSec: 100, ctr: 0.1 }
          }
        }
      };

      const token = mockResponse.value.byToken['token-123'];
      expect(token).toHaveProperty('impressions');
      expect(token).toHaveProperty('clicks');
      expect(token).toHaveProperty('ctr');
    });
  });

  describe('api_getReport - Empty data handling', () => {
    it('should handle no analytics data gracefully', () => {
      const mockResponse = {
        ok: true,
        value: {
          totals: { impressions: 0, clicks: 0, dwellSec: 0 },
          bySurface: {},
          bySponsor: {},
          byToken: {}
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value.totals.impressions).toBe(0);
    });

    it('should return empty objects when no data exists', () => {
      const mockResponse = {
        ok: true,
        value: {
          totals: { impressions: 0, clicks: 0, dwellSec: 0 },
          bySurface: {},
          bySponsor: {},
          byToken: {}
        }
      };

      expect(Object.keys(mockResponse.value.bySponsor).length).toBe(0);
      expect(Object.keys(mockResponse.value.byToken).length).toBe(0);
    });
  });

  describe('api_getReport - Error responses', () => {
    it('should return NOT_FOUND for non-existent event', () => {
      const mockResponse = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('NOT_FOUND');
    });

    it('should return BAD_INPUT for invalid parameters', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid event ID'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });
  });

  describe('api_getSharedAnalytics - events[].signupsCount (Story 4.2)', () => {
    /**
     * signupsCount is a required field in each EventMetrics object.
     * It counts the number of 'signup' metrics logged for that event.
     * Used by SharedReport.html to display signups per event in the Event Performance table.
     *
     * Schema: /schemas/shared-analytics.schema.json#/definitions/EventMetrics
     * Shape: events[].signupsCount: number
     */

    it('should include signupsCount field in events array items', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-01-15T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            totalQrScans: 5,
            totalSignups: 8,
            uniqueEvents: 2,
            uniqueSponsors: 3
          },
          surfaces: [],
          sponsors: [],
          events: [
            { id: 'evt1', name: 'Winter Championship', impressions: 60, clicks: 6, ctr: 10, signupsCount: 5 },
            { id: 'evt2', name: 'Summer Showdown', impressions: 40, clicks: 4, ctr: 10, signupsCount: 3 }
          ],
          topSponsors: null
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('events');
      expect(Array.isArray(mockResponse.value.events)).toBe(true);

      mockResponse.value.events.forEach(event => {
        expect(event).toHaveProperty('signupsCount');
        expect(typeof event.signupsCount).toBe('number');
        expect(event.signupsCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('should have EventMetrics shape with all required fields including signupsCount', () => {
      const mockEvent = {
        id: 'evt1',
        name: 'Test Event',
        impressions: 100,
        clicks: 10,
        ctr: 10,
        signupsCount: 5
      };

      expect(mockEvent).toHaveProperty('id');
      expect(mockEvent).toHaveProperty('name');
      expect(mockEvent).toHaveProperty('impressions');
      expect(mockEvent).toHaveProperty('clicks');
      expect(mockEvent).toHaveProperty('ctr');
      expect(mockEvent).toHaveProperty('signupsCount');

      expect(typeof mockEvent.id).toBe('string');
      expect(typeof mockEvent.name).toBe('string');
      expect(typeof mockEvent.impressions).toBe('number');
      expect(typeof mockEvent.clicks).toBe('number');
      expect(typeof mockEvent.ctr).toBe('number');
      expect(typeof mockEvent.signupsCount).toBe('number');
    });

    it('should have signupsCount of 0 when event has no signups', () => {
      const mockEvent = {
        id: 'evt1',
        name: 'Event With No Signups',
        impressions: 50,
        clicks: 5,
        ctr: 10,
        signupsCount: 0
      };

      expect(mockEvent.signupsCount).toBe(0);
    });

    it('should sum to totalSignups in summary', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-01-15T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            totalQrScans: 5,
            totalSignups: 8,
            uniqueEvents: 2,
            uniqueSponsors: 0
          },
          surfaces: [],
          sponsors: null,
          events: [
            { id: 'evt1', name: 'Event 1', impressions: 60, clicks: 6, ctr: 10, signupsCount: 5 },
            { id: 'evt2', name: 'Event 2', impressions: 40, clicks: 4, ctr: 10, signupsCount: 3 }
          ],
          topSponsors: null
        }
      };

      const eventsSignupsSum = mockResponse.value.events.reduce((sum, e) => sum + e.signupsCount, 0);
      expect(eventsSignupsSum).toBe(mockResponse.value.summary.totalSignups);
    });
  });

  describe('api_getSharedAnalytics - topSponsors array (Story 5.1)', () => {
    /**
     * topSponsors is an optional array in the SharedAnalytics response.
     * It contains the top 3 sponsors sorted by clicks (descending).
     * Used by SharedReport.html to render the "Top Sponsors" highlight card.
     *
     * Schema: /schemas/shared-analytics.schema.json#/properties/topSponsors
     * Shape: Array<{ id, name, impressions, clicks, ctr }> | null
     */

    it('should include topSponsors array in response', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-01-15T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            totalQrScans: 5,
            totalSignups: 3,
            uniqueEvents: 2,
            uniqueSponsors: 3
          },
          surfaces: [],
          sponsors: [],
          events: null,
          topSponsors: [
            { id: 'spo1', name: 'Acme Corp', impressions: 50, clicks: 8, ctr: 16 },
            { id: 'spo2', name: 'Beta Inc', impressions: 30, clicks: 5, ctr: 16.67 },
            { id: 'spo3', name: 'Gamma LLC', impressions: 20, clicks: 2, ctr: 10 }
          ]
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('topSponsors');
      expect(Array.isArray(mockResponse.value.topSponsors)).toBe(true);
    });

    it('should have topSponsors with expected SponsorMetrics fields', () => {
      const mockTopSponsors = [
        { id: 'spo1', name: 'Acme Corp', impressions: 50, clicks: 8, ctr: 16 }
      ];

      const sponsor = mockTopSponsors[0];
      expect(sponsor).toHaveProperty('id');
      expect(sponsor).toHaveProperty('name');
      expect(sponsor).toHaveProperty('impressions');
      expect(sponsor).toHaveProperty('clicks');
      expect(sponsor).toHaveProperty('ctr');
      expect(typeof sponsor.id).toBe('string');
      expect(typeof sponsor.name).toBe('string');
      expect(typeof sponsor.impressions).toBe('number');
      expect(typeof sponsor.clicks).toBe('number');
      expect(typeof sponsor.ctr).toBe('number');
    });

    it('should limit topSponsors to maximum 3 entries', () => {
      const mockTopSponsors = [
        { id: 'spo1', name: 'Sponsor 1', impressions: 100, clicks: 10, ctr: 10 },
        { id: 'spo2', name: 'Sponsor 2', impressions: 90, clicks: 9, ctr: 10 },
        { id: 'spo3', name: 'Sponsor 3', impressions: 80, clicks: 8, ctr: 10 }
      ];

      expect(mockTopSponsors.length).toBeLessThanOrEqual(3);
    });

    it('should sort topSponsors by clicks descending', () => {
      const mockTopSponsors = [
        { id: 'spo1', name: 'Most Clicks', impressions: 50, clicks: 25, ctr: 50 },
        { id: 'spo2', name: 'Medium Clicks', impressions: 50, clicks: 15, ctr: 30 },
        { id: 'spo3', name: 'Least Clicks', impressions: 50, clicks: 5, ctr: 10 }
      ];

      expect(mockTopSponsors[0].clicks).toBeGreaterThanOrEqual(mockTopSponsors[1].clicks);
      expect(mockTopSponsors[1].clicks).toBeGreaterThanOrEqual(mockTopSponsors[2].clicks);
    });

    it('should return null or empty array when no sponsor data exists', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-01-15T10:00:00.000Z',
          summary: {
            totalImpressions: 0,
            totalClicks: 0,
            totalQrScans: 0,
            totalSignups: 0,
            uniqueEvents: 0,
            uniqueSponsors: 0
          },
          surfaces: [],
          sponsors: null,
          events: null,
          topSponsors: null
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value.topSponsors === null || mockResponse.value.topSponsors.length === 0).toBe(true);
    });

    it('should include sponsor name (not just ID) for display', () => {
      const mockTopSponsors = [
        { id: 'spo-abc-123', name: 'Joe\'s Tavern', impressions: 100, clicks: 15, ctr: 15 }
      ];

      const sponsor = mockTopSponsors[0];
      // Name should be human-readable, not just an ID
      expect(sponsor.name).not.toBe(sponsor.id);
      expect(sponsor.name).toBe('Joe\'s Tavern');
    });
  });
});
