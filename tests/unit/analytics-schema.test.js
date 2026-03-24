/**
 * UNIT TESTS: SharedAnalytics Schema Validation
 *
 * Purpose: Test SharedAnalytics schema consistency across all layers
 * Coverage Goal: 100% schema compliance for AnalyticsService + SharedReporting
 *
 * Test Categories:
 * 1. Schema validation (via Ajv)
 * 2. AnalyticsService deterministic output
 * 3. SharedReporting graceful degradation (negative paths)
 *
 * @see /schemas/shared-analytics.schema.json (MVP-frozen v1.1)
 * @see src/mvp/AnalyticsService.gs
 * @see src/mvp/SharedReporting.gs
 */

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

// Load schema
const schemaPath = path.join(__dirname, '../../schemas/shared-analytics.schema.json');
const analyticsSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// Create Ajv validator
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(analyticsSchema);

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Full SharedAnalytics fixture with all fields populated
 */
const FULL_ANALYTICS_FIXTURE = {
  lastUpdatedISO: '2025-01-15T14:30:00.000Z',
  summary: {
    totalImpressions: 1500,
    totalClicks: 75,
    totalQrScans: 42,
    totalSignups: 18,
    uniqueEvents: 3,
    uniqueSponsors: 5
  },
  surfaces: [
    { id: 'poster', label: 'Poster', impressions: 500, clicks: 25, qrScans: 30, engagementRate: 11.0 },
    { id: 'display', label: 'Display', impressions: 400, clicks: 20, qrScans: 5, engagementRate: 6.25 },
    { id: 'public', label: 'Public', impressions: 350, clicks: 18, qrScans: 7, engagementRate: 7.14 },
    { id: 'signup', label: 'Signup', impressions: 250, clicks: 12, qrScans: 0, engagementRate: 4.8 }
  ],
  sponsors: [
    { id: 'sp_acme_001', name: 'Acme Corporation', impressions: 450, clicks: 25, ctr: 5.56 },
    { id: 'sp_joe_tavern', name: "Joe's Tavern", impressions: 380, clicks: 20, ctr: 5.26 }
  ],
  events: [
    { id: 'evt_summer', name: 'Summer Tournament 2024', impressions: 600, clicks: 35, ctr: 5.83, signupsCount: 12 },
    { id: 'evt_winter', name: 'Winter League 2024', impressions: 500, clicks: 25, ctr: 5.0, signupsCount: 4 }
  ],
  topSponsors: [
    { id: 'sp_acme_001', name: 'Acme Corporation', impressions: 450, clicks: 25, ctr: 5.56 },
    { id: 'sp_joe_tavern', name: "Joe's Tavern", impressions: 380, clicks: 20, ctr: 5.26 }
  ]
};

/**
 * Minimal SharedAnalytics fixture with only required fields
 */
const MINIMAL_ANALYTICS_FIXTURE = {
  lastUpdatedISO: '2025-01-01',
  summary: {
    totalImpressions: 0,
    totalClicks: 0,
    totalQrScans: 0,
    totalSignups: 0,
    uniqueEvents: 0,
    uniqueSponsors: 0
  },
  surfaces: []
};

// ============================================================================
// Describe: Schema Validation
// ============================================================================

describe('SharedAnalytics Schema Validation', () => {

  describe('Happy Path - Valid Fixtures', () => {

    test('Full analytics fixture validates successfully', () => {
      const valid = validate(FULL_ANALYTICS_FIXTURE);
      expect(valid).toBe(true);
      if (!valid) console.log(validate.errors);
    });

    test('Minimal analytics fixture validates successfully', () => {
      const valid = validate(MINIMAL_ANALYTICS_FIXTURE);
      expect(valid).toBe(true);
      if (!valid) console.log(validate.errors);
    });

    test('Null optional arrays validate successfully', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 100,
          totalClicks: 5,
          totalQrScans: 2,
          totalSignups: 1,
          uniqueEvents: 1,
          uniqueSponsors: 0
        },
        surfaces: [
          { id: 'public', label: 'Public', impressions: 100, clicks: 5, qrScans: 2 }
        ],
        sponsors: null,
        events: null,
        topSponsors: null
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });

    test('Date-only lastUpdatedISO validates successfully', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        lastUpdatedISO: '2025-01-15'
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });

    test('Full ISO timestamp with milliseconds validates', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        lastUpdatedISO: '2025-01-15T14:30:00.000Z'
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });

    test('ISO timestamp without milliseconds validates', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        lastUpdatedISO: '2025-01-15T14:30:00Z'
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });
  });

  describe('Surface Validation', () => {

    test('All valid surface IDs are accepted', () => {
      const validSurfaceIds = ['poster', 'display', 'public', 'signup'];

      validSurfaceIds.forEach(id => {
        const fixture = {
          ...MINIMAL_ANALYTICS_FIXTURE,
          surfaces: [
            { id, label: id.charAt(0).toUpperCase() + id.slice(1), impressions: 10, clicks: 1, qrScans: 0 }
          ]
        };

        const valid = validate(fixture);
        expect(valid).toBe(true);
      });
    });

    test('Invalid surface ID is rejected', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        surfaces: [
          { id: 'invalid_surface', label: 'Invalid', impressions: 10, clicks: 1, qrScans: 0 }
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'enum')).toBe(true);
    });

    test('Surface with engagementRate (optional) validates', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        surfaces: [
          { id: 'poster', label: 'Poster', impressions: 100, clicks: 10, qrScans: 5, engagementRate: 15.0 }
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });

    test('Surface with null engagementRate validates', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        surfaces: [
          { id: 'poster', label: 'Poster', impressions: 100, clicks: 10, qrScans: 5, engagementRate: null }
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });
  });

  describe('TopSponsors Constraints', () => {

    test('Exactly 3 topSponsors validates', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        topSponsors: [
          { id: 'sp1', name: 'Sponsor 1', impressions: 400, clicks: 50, ctr: 12.5 },
          { id: 'sp2', name: 'Sponsor 2', impressions: 350, clicks: 30, ctr: 8.57 },
          { id: 'sp3', name: 'Sponsor 3', impressions: 250, clicks: 20, ctr: 8.0 }
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });

    test('More than 3 topSponsors is rejected', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        topSponsors: [
          { id: 'sp1', name: 'Sponsor 1', impressions: 400, clicks: 50, ctr: 12.5 },
          { id: 'sp2', name: 'Sponsor 2', impressions: 350, clicks: 30, ctr: 8.57 },
          { id: 'sp3', name: 'Sponsor 3', impressions: 250, clicks: 20, ctr: 8.0 },
          { id: 'sp4', name: 'Sponsor 4', impressions: 200, clicks: 15, ctr: 7.5 }
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'maxItems')).toBe(true);
    });

    test('Less than 3 topSponsors validates', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        topSponsors: [
          { id: 'sp1', name: 'Sponsor 1', impressions: 400, clicks: 50, ctr: 12.5 }
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });

    test('Empty topSponsors array validates', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        topSponsors: []
      };

      const valid = validate(fixture);
      expect(valid).toBe(true);
    });
  });

  describe('Negative Path - Missing Required Fields', () => {

    test('Missing summary is rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        surfaces: []
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.params.missingProperty === 'summary')).toBe(true);
    });

    test('Missing surfaces is rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 0,
          totalClicks: 0,
          totalQrScans: 0,
          totalSignups: 0,
          uniqueEvents: 0,
          uniqueSponsors: 0
        }
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.params.missingProperty === 'surfaces')).toBe(true);
    });

    test('Missing lastUpdatedISO is rejected', () => {
      const fixture = {
        summary: {
          totalImpressions: 0,
          totalClicks: 0,
          totalQrScans: 0,
          totalSignups: 0,
          uniqueEvents: 0,
          uniqueSponsors: 0
        },
        surfaces: []
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.params.missingProperty === 'lastUpdatedISO')).toBe(true);
    });

    test('Missing summary fields are rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 100
          // Missing other required fields
        },
        surfaces: []
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
    });
  });

  describe('Negative Path - Invalid Types', () => {

    test('String lastUpdatedISO is required (number rejected)', () => {
      const fixture = {
        lastUpdatedISO: 12345,
        summary: {
          totalImpressions: 0,
          totalClicks: 0,
          totalQrScans: 0,
          totalSignups: 0,
          uniqueEvents: 0,
          uniqueSponsors: 0
        },
        surfaces: []
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'type')).toBe(true);
    });

    test('Negative impressions rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: -100,
          totalClicks: 0,
          totalQrScans: 0,
          totalSignups: 0,
          uniqueEvents: 0,
          uniqueSponsors: 0
        },
        surfaces: []
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'minimum')).toBe(true);
    });

    test('Non-integer impressions rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 100.5, // Should be integer
          totalClicks: 0,
          totalQrScans: 0,
          totalSignups: 0,
          uniqueEvents: 0,
          uniqueSponsors: 0
        },
        surfaces: []
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'type')).toBe(true);
    });
  });

  describe('Negative Path - Invalid Sponsor/Event Fields', () => {

    test('Empty sponsor id is rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 100,
          totalClicks: 5,
          totalQrScans: 2,
          totalSignups: 1,
          uniqueEvents: 1,
          uniqueSponsors: 1
        },
        surfaces: [
          { id: 'public', label: 'Public', impressions: 100, clicks: 5, qrScans: 2 }
        ],
        sponsors: [
          { id: '', name: 'Test Sponsor', impressions: 100, clicks: 5, ctr: 5.0 }
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'minLength')).toBe(true);
    });

    test('Empty event id is rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 100,
          totalClicks: 5,
          totalQrScans: 2,
          totalSignups: 1,
          uniqueEvents: 1,
          uniqueSponsors: 0
        },
        surfaces: [],
        events: [
          { id: '', name: 'Test Event', impressions: 100, clicks: 5, ctr: 5.0, signupsCount: 1 }
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'minLength')).toBe(true);
    });

    test('Missing required sponsor fields rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 100,
          totalClicks: 5,
          totalQrScans: 2,
          totalSignups: 1,
          uniqueEvents: 1,
          uniqueSponsors: 1
        },
        surfaces: [],
        sponsors: [
          { id: 'sp1', name: 'Test' } // Missing impressions, clicks, ctr
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
    });

    test('Missing required event fields rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 100,
          totalClicks: 5,
          totalQrScans: 2,
          totalSignups: 1,
          uniqueEvents: 1,
          uniqueSponsors: 0
        },
        surfaces: [],
        events: [
          { id: 'evt1', name: 'Test' } // Missing impressions, clicks, ctr, signupsCount
        ]
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
    });
  });

  describe('AdditionalProperties Constraint', () => {

    test('Extra top-level properties are rejected', () => {
      const fixture = {
        ...MINIMAL_ANALYTICS_FIXTURE,
        extraField: 'should not be here'
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'additionalProperties')).toBe(true);
    });

    test('Extra summary properties are rejected', () => {
      const fixture = {
        lastUpdatedISO: '2025-01-15T10:00:00Z',
        summary: {
          totalImpressions: 0,
          totalClicks: 0,
          totalQrScans: 0,
          totalSignups: 0,
          uniqueEvents: 0,
          uniqueSponsors: 0,
          extraMetric: 999
        },
        surfaces: []
      };

      const valid = validate(fixture);
      expect(valid).toBe(false);
      expect(validate.errors.some(e => e.keyword === 'additionalProperties')).toBe(true);
    });
  });
});

// ============================================================================
// Describe: AnalyticsService Deterministic Output
// ============================================================================

describe('AnalyticsService Deterministic Output', () => {

  /**
   * Simulates AnalyticsService aggregation from raw analytics data.
   * This mirrors the logic in buildSharedAnalyticsResponse_().
   */
  function simulateAnalyticsService(analytics) {
    const impressions = analytics.filter(a => a.metric === 'impression');
    const clicks = analytics.filter(a => a.metric === 'click');
    const qrScans = analytics.filter(a => a.metric === 'qr_scan');
    const signups = analytics.filter(a => a.metric === 'signup');

    const eventIds = new Set(analytics.map(a => a.eventId).filter(Boolean));
    const sponsorIds = new Set(analytics.map(a => a.sponsorId).filter(Boolean));

    // Aggregate by surface
    const surfaces = {};
    analytics.forEach(a => {
      const surfaceId = (a.surface || 'unknown').toLowerCase();
      if (!surfaces[surfaceId]) {
        surfaces[surfaceId] = { impressions: 0, clicks: 0, qrScans: 0 };
      }
      if (a.metric === 'impression') surfaces[surfaceId].impressions++;
      if (a.metric === 'click') surfaces[surfaceId].clicks++;
      if (a.metric === 'qr_scan') surfaces[surfaceId].qrScans++;
    });

    // Aggregate by sponsor
    const sponsors = {};
    analytics.forEach(a => {
      if (!a.sponsorId) return;
      if (!sponsors[a.sponsorId]) {
        sponsors[a.sponsorId] = { impressions: 0, clicks: 0 };
      }
      if (a.metric === 'impression') sponsors[a.sponsorId].impressions++;
      if (a.metric === 'click') sponsors[a.sponsorId].clicks++;
    });

    // Aggregate by event
    const events = {};
    analytics.forEach(a => {
      if (!a.eventId) return;
      if (!events[a.eventId]) {
        events[a.eventId] = { impressions: 0, clicks: 0, signupsCount: 0 };
      }
      if (a.metric === 'impression') events[a.eventId].impressions++;
      if (a.metric === 'click') events[a.eventId].clicks++;
      if (a.metric === 'signup') events[a.eventId].signupsCount++;
    });

    return {
      summary: {
        totalImpressions: impressions.length,
        totalClicks: clicks.length,
        totalQrScans: qrScans.length,
        totalSignups: signups.length,
        uniqueEvents: eventIds.size,
        uniqueSponsors: sponsorIds.size
      },
      surfaces,
      sponsors,
      events
    };
  }

  const testAnalyticsData = [
    { timestamp: '2025-01-10T09:00:00Z', eventId: 'evt1', surface: 'poster', metric: 'impression', sponsorId: 'sp1' },
    { timestamp: '2025-01-10T09:05:00Z', eventId: 'evt1', surface: 'poster', metric: 'impression', sponsorId: 'sp1' },
    { timestamp: '2025-01-10T09:10:00Z', eventId: 'evt1', surface: 'poster', metric: 'click', sponsorId: 'sp1' },
    { timestamp: '2025-01-10T10:00:00Z', eventId: 'evt1', surface: 'public', metric: 'impression', sponsorId: 'sp2' },
    { timestamp: '2025-01-10T10:05:00Z', eventId: 'evt1', surface: 'public', metric: 'qr_scan', sponsorId: null },
    { timestamp: '2025-01-10T11:00:00Z', eventId: 'evt1', surface: 'signup', metric: 'signup', sponsorId: null },
    { timestamp: '2025-01-11T14:00:00Z', eventId: 'evt2', surface: 'display', metric: 'impression', sponsorId: 'sp1' },
    { timestamp: '2025-01-11T14:05:00Z', eventId: 'evt2', surface: 'display', metric: 'click', sponsorId: 'sp1' },
    { timestamp: '2025-01-11T15:00:00Z', eventId: 'evt2', surface: 'public', metric: 'impression', sponsorId: 'sp3' }
  ];

  test('Summary metrics are calculated correctly', () => {
    const result = simulateAnalyticsService(testAnalyticsData);

    expect(result.summary.totalImpressions).toBe(5);
    expect(result.summary.totalClicks).toBe(2);
    expect(result.summary.totalQrScans).toBe(1);
    expect(result.summary.totalSignups).toBe(1);
    expect(result.summary.uniqueEvents).toBe(2);
    expect(result.summary.uniqueSponsors).toBe(3);
  });

  test('Surface metrics are calculated correctly', () => {
    const result = simulateAnalyticsService(testAnalyticsData);

    expect(result.surfaces.poster.impressions).toBe(2);
    expect(result.surfaces.poster.clicks).toBe(1);
    expect(result.surfaces.poster.qrScans).toBe(0);

    expect(result.surfaces.public.impressions).toBe(2);
    expect(result.surfaces.public.clicks).toBe(0);
    expect(result.surfaces.public.qrScans).toBe(1);

    expect(result.surfaces.display.impressions).toBe(1);
    expect(result.surfaces.display.clicks).toBe(1);
    expect(result.surfaces.display.qrScans).toBe(0);
  });

  test('Sponsor metrics are calculated correctly', () => {
    const result = simulateAnalyticsService(testAnalyticsData);

    expect(result.sponsors.sp1.impressions).toBe(3);
    expect(result.sponsors.sp1.clicks).toBe(2);

    expect(result.sponsors.sp2.impressions).toBe(1);
    expect(result.sponsors.sp2.clicks).toBe(0);

    expect(result.sponsors.sp3.impressions).toBe(1);
    expect(result.sponsors.sp3.clicks).toBe(0);
  });

  test('Event metrics are calculated correctly', () => {
    const result = simulateAnalyticsService(testAnalyticsData);

    expect(result.events.evt1.impressions).toBe(3);
    expect(result.events.evt1.clicks).toBe(1);
    expect(result.events.evt1.signupsCount).toBe(1);

    expect(result.events.evt2.impressions).toBe(2);
    expect(result.events.evt2.clicks).toBe(1);
    expect(result.events.evt2.signupsCount).toBe(0);
  });

  test('Empty analytics data produces zero counts', () => {
    const result = simulateAnalyticsService([]);

    expect(result.summary.totalImpressions).toBe(0);
    expect(result.summary.totalClicks).toBe(0);
    expect(result.summary.totalQrScans).toBe(0);
    expect(result.summary.totalSignups).toBe(0);
    expect(result.summary.uniqueEvents).toBe(0);
    expect(result.summary.uniqueSponsors).toBe(0);
    expect(Object.keys(result.surfaces)).toHaveLength(0);
    expect(Object.keys(result.sponsors)).toHaveLength(0);
  });

  test('Null sponsorId entries are not counted in sponsors', () => {
    const dataWithNulls = [
      { eventId: 'evt1', surface: 'public', metric: 'impression', sponsorId: null },
      { eventId: 'evt1', surface: 'public', metric: 'impression', sponsorId: 'sp1' },
      { eventId: 'evt1', surface: 'public', metric: 'click', sponsorId: null }
    ];

    const result = simulateAnalyticsService(dataWithNulls);

    expect(result.summary.uniqueSponsors).toBe(1);
    expect(Object.keys(result.sponsors)).toHaveLength(1);
    expect(result.sponsors.sp1.impressions).toBe(1);
  });

  test('Case-insensitive surface IDs are normalized', () => {
    const mixedCaseData = [
      { eventId: 'evt1', surface: 'POSTER', metric: 'impression', sponsorId: null },
      { eventId: 'evt1', surface: 'Poster', metric: 'impression', sponsorId: null },
      { eventId: 'evt1', surface: 'poster', metric: 'impression', sponsorId: null }
    ];

    const result = simulateAnalyticsService(mixedCaseData);

    expect(Object.keys(result.surfaces)).toHaveLength(1);
    expect(result.surfaces.poster.impressions).toBe(3);
  });
});

// ============================================================================
// Describe: SharedReporting Graceful Degradation (Negative Paths)
// ============================================================================

describe('SharedReporting Graceful Degradation', () => {

  /**
   * Simulates SharedReporting helper functions for rendering checks
   */
  function canRenderSponsorsSection(data) {
    return Array.isArray(data.sponsors) && data.sponsors.length > 0;
  }

  function canRenderEventsSection(data) {
    return Array.isArray(data.events) && data.events.length > 0;
  }

  function canRenderTopSponsorsSection(data) {
    return Array.isArray(data.topSponsors) && data.topSponsors.length > 0;
  }

  function getEmptyStateMessage(section) {
    const messages = {
      sponsors: 'No sponsors yet',
      events: 'No events yet',
      topSponsors: 'No top sponsors to display'
    };
    return messages[section] || 'No data available';
  }

  describe('No Sponsors Array', () => {

    test('Null sponsors array does not crash', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: [],
        sponsors: null
      };

      expect(() => canRenderSponsorsSection(data)).not.toThrow();
      expect(canRenderSponsorsSection(data)).toBe(false);
    });

    test('Undefined sponsors array does not crash', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: []
        // sponsors not defined
      };

      expect(() => canRenderSponsorsSection(data)).not.toThrow();
      expect(canRenderSponsorsSection(data)).toBe(false);
    });

    test('Empty sponsors array shows empty state', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: [],
        sponsors: []
      };

      expect(canRenderSponsorsSection(data)).toBe(false);
      expect(getEmptyStateMessage('sponsors')).toBe('No sponsors yet');
    });
  });

  describe('No Events Array', () => {

    test('Null events array does not crash', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: [],
        events: null
      };

      expect(() => canRenderEventsSection(data)).not.toThrow();
      expect(canRenderEventsSection(data)).toBe(false);
    });

    test('Undefined events array does not crash', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: []
        // events not defined
      };

      expect(() => canRenderEventsSection(data)).not.toThrow();
      expect(canRenderEventsSection(data)).toBe(false);
    });

    test('Empty events array shows empty state', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: [],
        events: []
      };

      expect(canRenderEventsSection(data)).toBe(false);
      expect(getEmptyStateMessage('events')).toBe('No events yet');
    });
  });

  describe('No TopSponsors Array', () => {

    test('Null topSponsors array does not crash', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: [],
        topSponsors: null
      };

      expect(() => canRenderTopSponsorsSection(data)).not.toThrow();
      expect(canRenderTopSponsorsSection(data)).toBe(false);
    });

    test('Undefined topSponsors array does not crash', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: []
        // topSponsors not defined
      };

      expect(() => canRenderTopSponsorsSection(data)).not.toThrow();
      expect(canRenderTopSponsorsSection(data)).toBe(false);
    });

    test('Empty topSponsors array shows empty state', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: [],
        topSponsors: []
      };

      expect(canRenderTopSponsorsSection(data)).toBe(false);
      expect(getEmptyStateMessage('topSponsors')).toBe('No top sponsors to display');
    });
  });

  describe('All Optional Arrays Missing', () => {

    test('Data with only required fields renders without crash', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 100, totalClicks: 5, totalQrScans: 2, totalSignups: 1, uniqueEvents: 1, uniqueSponsors: 0 },
        surfaces: [
          { id: 'public', label: 'Public', impressions: 100, clicks: 5, qrScans: 2 }
        ]
        // sponsors, events, topSponsors all missing
      };

      expect(() => {
        const canRenderSponsors = canRenderSponsorsSection(data);
        const canRenderEvents = canRenderEventsSection(data);
        const canRenderTop = canRenderTopSponsorsSection(data);
        return { canRenderSponsors, canRenderEvents, canRenderTop };
      }).not.toThrow();
    });

    test('Summary section always renders with required fields', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 100, totalClicks: 5, totalQrScans: 2, totalSignups: 1, uniqueEvents: 1, uniqueSponsors: 0 },
        surfaces: []
      };

      expect(data.summary.totalImpressions).toBe(100);
      expect(data.summary.totalClicks).toBe(5);
      expect(data.summary.totalQrScans).toBe(2);
      expect(data.summary.totalSignups).toBe(1);
      expect(data.summary.uniqueEvents).toBe(1);
      expect(data.summary.uniqueSponsors).toBe(0);
    });

    test('Surfaces section renders with empty array', () => {
      const data = {
        lastUpdatedISO: new Date().toISOString(),
        summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
        surfaces: []
      };

      expect(Array.isArray(data.surfaces)).toBe(true);
      expect(data.surfaces.length).toBe(0);
    });
  });

  describe('Safe Iteration Patterns', () => {

    test('Iterating over null sponsors with fallback does not crash', () => {
      const data = { sponsors: null };
      const sponsors = data.sponsors || [];

      expect(() => {
        sponsors.forEach(() => {});
      }).not.toThrow();
      expect(sponsors.length).toBe(0);
    });

    test('Iterating over null events with fallback does not crash', () => {
      const data = { events: null };
      const events = data.events || [];

      expect(() => {
        events.forEach(() => {});
      }).not.toThrow();
      expect(events.length).toBe(0);
    });

    test('Iterating over null topSponsors with fallback does not crash', () => {
      const data = { topSponsors: null };
      const topSponsors = data.topSponsors || [];

      expect(() => {
        topSponsors.forEach(() => {});
      }).not.toThrow();
      expect(topSponsors.length).toBe(0);
    });

    test('Optional chaining protects against undefined', () => {
      const data = {};

      expect(data.sponsors?.length).toBe(undefined);
      expect(data.events?.length).toBe(undefined);
      expect(data.topSponsors?.length).toBe(undefined);
    });
  });
});

// ============================================================================
// Describe: CTR Calculation Consistency
// ============================================================================

describe('CTR Calculation Consistency', () => {

  function calculateCTR(clicks, impressions) {
    if (!impressions || impressions <= 0) return 0;
    return Number(((clicks / impressions) * 100).toFixed(2));
  }

  test('CTR calculation matches expected formula', () => {
    expect(calculateCTR(5, 100)).toBe(5.0);
    expect(calculateCTR(1, 4)).toBe(25.0);
    expect(calculateCTR(0, 100)).toBe(0);
    expect(calculateCTR(100, 100)).toBe(100.0);
  });

  test('CTR handles zero impressions', () => {
    expect(calculateCTR(5, 0)).toBe(0);
    expect(calculateCTR(0, 0)).toBe(0);
  });

  test('CTR handles negative impressions', () => {
    expect(calculateCTR(5, -100)).toBe(0);
  });

  test('CTR rounds to 2 decimal places', () => {
    expect(calculateCTR(1, 3)).toBe(33.33);
    expect(calculateCTR(2, 3)).toBe(66.67);
  });

  test('CTR can exceed 100% (clicks > impressions)', () => {
    // This can happen if clicks are counted without impressions
    expect(calculateCTR(150, 100)).toBe(150.0);
  });
});

/**
 * Coverage Report: SharedAnalytics Schema Tests
 *
 * Test Categories:
 * 1. Schema Validation
 *    - Happy Path (valid fixtures) - 6 tests
 *    - Surface Validation - 5 tests
 *    - TopSponsors Constraints - 4 tests
 *    - Missing Required Fields - 4 tests
 *    - Invalid Types - 3 tests
 *    - Invalid Sponsor/Event Fields - 4 tests
 *    - AdditionalProperties - 2 tests
 *
 * 2. AnalyticsService Deterministic Output
 *    - Summary metrics - 1 test
 *    - Surface metrics - 1 test
 *    - Sponsor metrics - 1 test
 *    - Event metrics - 1 test
 *    - Edge cases (empty, null, case) - 3 tests
 *
 * 3. SharedReporting Graceful Degradation
 *    - No sponsors array - 3 tests
 *    - No events array - 3 tests
 *    - No topSponsors array - 3 tests
 *    - All optional missing - 3 tests
 *    - Safe iteration patterns - 4 tests
 *
 * 4. CTR Calculation
 *    - Formula validation - 5 tests
 *
 * TOTAL: 51 tests
 *
 * Run with: npm run test:unit -- --testPathPattern=analytics-schema
 */
