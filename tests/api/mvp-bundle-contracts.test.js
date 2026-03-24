/**
 * MVP Bundle API Contract Tests
 *
 * Live integration tests that hit real API endpoints and validate
 * responses match the schemas defined in ApiSchemas.gs.
 *
 * Targets all MVP surfaces:
 * - api_list (api_getEvents)
 * - api_get
 * - api_getPublicBundle
 * - api_getDisplayBundle
 * - api_getPosterBundle
 * - api_getSharedAnalytics
 * - api_getSponsorAnalytics
 *
 * Usage:
 *   BASE_URL="https://script.google.com/macros/s/XXXX/exec" npm run test:api-contracts
 *   BASE_URL="https://www.eventangle.com/events" npm run test:api-contracts
 *
 * @see /src/mvp/ApiSchemas.gs for canonical schema definitions
 * @see /schemas/*.schema.json for JSON Schema source of truth
 */

const { getBaseUrl } = require('../config/environments');

// ============================================================================
// CI DETECTION - Skip network tests in CI environment
// ============================================================================
// These tests make HTTP calls to staging/production and require network access.
// In CI, network is not available, so we skip these tests.
// Run locally with: npm run test:api-contracts:legacy

const isCI = process.env.CI === 'true' || process.env.CI === true;
const skipNetworkTests = isCI || process.env.SKIP_NETWORK_TESTS === 'true';

// Use describe.skip to skip all network tests in CI
const describeNetworkTests = skipNetworkTests ? describe.skip : describe;

if (skipNetworkTests) {
  console.log('⚠️  MVP Bundle API Contract Tests SKIPPED (CI environment detected)');
  console.log('   Run locally with: npm run test:api-contracts:legacy');
}

// Get BASE_URL from environment configuration
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.TEST_BRAND_ID || 'root';
const TIMEOUT = 30000; // 30 second timeout for API calls

// ============================================================================
// SCHEMA VALIDATORS - Match ApiSchemas.gs
// ============================================================================

/**
 * Validates Event schema per /schemas/event.schema.json v2.2 (MVP-frozen)
 * MVP REQUIRED: id, slug, name, startDateISO, venue, links, qr, ctas, settings, createdAtISO, updatedAtISO
 */
const validateEventSchema = (event, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  // MVP REQUIRED - Identity
  if (typeof event.id !== 'string' || event.id.length === 0) errors.push(`${prefix}id: must be non-empty string`);
  if (typeof event.slug !== 'string') errors.push(`${prefix}slug: must be string`);
  if (typeof event.name !== 'string' || event.name.length === 0) errors.push(`${prefix}name: must be non-empty string`);
  if (typeof event.startDateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.startDateISO)) {
    errors.push(`${prefix}startDateISO: must match YYYY-MM-DD, got: ${event.startDateISO}`);
  }
  if (typeof event.venue !== 'string') errors.push(`${prefix}venue: must be string`);

  // MVP REQUIRED - Links
  if (!event.links || typeof event.links !== 'object') {
    errors.push(`${prefix}links: must be object`);
  } else {
    if (typeof event.links.publicUrl !== 'string') errors.push(`${prefix}links.publicUrl: must be string`);
    if (typeof event.links.displayUrl !== 'string') errors.push(`${prefix}links.displayUrl: must be string`);
    if (typeof event.links.posterUrl !== 'string') errors.push(`${prefix}links.posterUrl: must be string`);
    if (typeof event.links.signupUrl !== 'string') errors.push(`${prefix}links.signupUrl: must be string`);
  }

  // MVP REQUIRED - QR Codes
  if (!event.qr || typeof event.qr !== 'object') {
    errors.push(`${prefix}qr: must be object`);
  } else {
    if (typeof event.qr.public !== 'string') errors.push(`${prefix}qr.public: must be string`);
    if (typeof event.qr.signup !== 'string') errors.push(`${prefix}qr.signup: must be string`);
  }

  // MVP REQUIRED - CTAs
  if (!event.ctas || typeof event.ctas !== 'object') {
    errors.push(`${prefix}ctas: must be object`);
  } else {
    if (!event.ctas.primary || typeof event.ctas.primary !== 'object') {
      errors.push(`${prefix}ctas.primary: must be object`);
    } else {
      if (typeof event.ctas.primary.label !== 'string') errors.push(`${prefix}ctas.primary.label: must be string`);
      if (typeof event.ctas.primary.url !== 'string') errors.push(`${prefix}ctas.primary.url: must be string`);
    }
  }

  // MVP REQUIRED - Settings
  if (!event.settings || typeof event.settings !== 'object') {
    errors.push(`${prefix}settings: must be object`);
  } else {
    if (typeof event.settings.showSchedule !== 'boolean') errors.push(`${prefix}settings.showSchedule: must be boolean`);
    if (typeof event.settings.showStandings !== 'boolean') errors.push(`${prefix}settings.showStandings: must be boolean`);
    if (typeof event.settings.showBracket !== 'boolean') errors.push(`${prefix}settings.showBracket: must be boolean`);
  }

  // MVP REQUIRED - Timestamps
  if (typeof event.createdAtISO !== 'string') errors.push(`${prefix}createdAtISO: must be string`);
  if (typeof event.updatedAtISO !== 'string') errors.push(`${prefix}updatedAtISO: must be string`);

  return errors;
};

/**
 * Validates SharedAnalytics schema per /schemas/shared-analytics.schema.json v1.1 (MVP-frozen)
 * MVP REQUIRED: lastUpdatedISO, summary, surfaces
 */
const validateSharedAnalyticsSchema = (analytics, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  // MVP REQUIRED - lastUpdatedISO
  if (typeof analytics.lastUpdatedISO !== 'string') {
    errors.push(`${prefix}lastUpdatedISO: must be string`);
  }

  // MVP REQUIRED - summary
  if (!analytics.summary || typeof analytics.summary !== 'object') {
    errors.push(`${prefix}summary: must be object`);
  } else {
    const summaryFields = ['totalImpressions', 'totalClicks', 'totalQrScans', 'totalSignups', 'uniqueEvents', 'uniqueSponsors'];
    summaryFields.forEach(field => {
      if (typeof analytics.summary[field] !== 'number') {
        errors.push(`${prefix}summary.${field}: must be number`);
      }
    });
  }

  // MVP REQUIRED - surfaces (array)
  if (!Array.isArray(analytics.surfaces)) {
    errors.push(`${prefix}surfaces: must be array`);
  } else {
    analytics.surfaces.forEach((surface, i) => {
      if (typeof surface.id !== 'string') errors.push(`${prefix}surfaces[${i}].id: must be string`);
      if (typeof surface.label !== 'string') errors.push(`${prefix}surfaces[${i}].label: must be string`);
      if (typeof surface.impressions !== 'number') errors.push(`${prefix}surfaces[${i}].impressions: must be number`);
      if (typeof surface.clicks !== 'number') errors.push(`${prefix}surfaces[${i}].clicks: must be number`);
      if (typeof surface.qrScans !== 'number') errors.push(`${prefix}surfaces[${i}].qrScans: must be number`);
    });
  }

  // MVP OPTIONAL - sponsors (array or null)
  if (analytics.sponsors !== null && analytics.sponsors !== undefined && !Array.isArray(analytics.sponsors)) {
    errors.push(`${prefix}sponsors: must be array or null`);
  }

  return errors;
};

/**
 * Validates Pagination schema per ApiSchemas.gs events.list
 */
const validatePaginationSchema = (pagination, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  if (typeof pagination.total !== 'number') errors.push(`${prefix}total: must be number`);
  if (typeof pagination.limit !== 'number') errors.push(`${prefix}limit: must be number`);
  if (typeof pagination.offset !== 'number') errors.push(`${prefix}offset: must be number`);
  if (typeof pagination.hasMore !== 'boolean') errors.push(`${prefix}hasMore: must be boolean`);

  return errors;
};

/**
 * Validates success envelope per ApiSchemas.gs RESPONSE ENVELOPE CONTRACT
 */
const validateSuccessEnvelope = (response, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  if (response.ok !== true) {
    errors.push(`${prefix}ok: expected true, got ${response.ok}`);
    if (response.code) errors.push(`${prefix}error code: ${response.code}`);
    if (response.message) errors.push(`${prefix}error message: ${response.message}`);
    return errors;
  }

  // For non-304 responses, value is required
  if (!response.notModified && response.value === undefined) {
    errors.push(`${prefix}value: required for success response`);
  }

  return errors;
};

/**
 * Validates etag format
 */
const validateEtag = (response, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  if (!response.etag) {
    errors.push(`${prefix}etag: required`);
  } else if (typeof response.etag !== 'string' || response.etag.length < 8) {
    errors.push(`${prefix}etag: must be string with length >= 8`);
  }

  return errors;
};

/**
 * Validates Bundle config per ApiSchemas.gs bundles
 */
const validateBundleConfig = (config, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  if (typeof config.brandId !== 'string') errors.push(`${prefix}brandId: must be string`);
  if (typeof config.brandName !== 'string') errors.push(`${prefix}brandName: must be string`);

  return errors;
};

/**
 * Validates Sponsor schema per /schemas/sponsor.schema.json
 */
const validateSponsorSchema = (sponsor, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  if (typeof sponsor.id !== 'string' || sponsor.id.length === 0) errors.push(`${prefix}id: must be non-empty string`);
  if (typeof sponsor.name !== 'string' || sponsor.name.length === 0) errors.push(`${prefix}name: must be non-empty string`);
  if (typeof sponsor.logoUrl !== 'string') errors.push(`${prefix}logoUrl: must be string`);
  if (sponsor.placement !== undefined) {
    const validPlacements = ['poster', 'display', 'public', 'tv-banner'];
    if (!validPlacements.includes(sponsor.placement)) {
      errors.push(`${prefix}placement: must be one of ${validPlacements.join(', ')}`);
    }
  }

  return errors;
};

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * Make API request to backend
 */
async function apiRequest(action, params = {}) {
  const payload = {
    action,
    brandId: BRAND_ID,
    ...params
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${TIMEOUT}ms`);
    }
    throw error;
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describeNetworkTests('MVP Bundle API Contract Tests', () => {
  let fixtureEventId = null;

  // Before all tests, get a valid event ID to use for testing
  beforeAll(async () => {
    console.log(`\n📍 Testing against: ${BASE_URL}`);
    console.log(`📍 Brand ID: ${BRAND_ID}\n`);

    try {
      // Fetch events list to get a valid event ID
      const response = await apiRequest('api_list', { scope: 'events', limit: 10 });

      if (response.ok && response.value?.items?.length > 0) {
        fixtureEventId = response.value.items[0].id;
        console.log(`📍 Using fixture event ID: ${fixtureEventId}\n`);
      } else {
        console.warn('⚠️  No events found - some tests will be skipped');
      }
    } catch (error) {
      console.warn(`⚠️  Failed to fetch events: ${error.message}`);
    }
  }, TIMEOUT);

  // ==========================================================================
  // api_list (events.list)
  // ==========================================================================

  describe('api_list (events.list)', () => {
    /**
     * CONTRACT per ApiSchemas.gs events.list:
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     items: Event[],
     *     pagination: { total, limit, offset, hasMore }
     *   }
     * }
     */

    it('should return valid list response with items and pagination', async () => {
      const response = await apiRequest('api_list', { scope: 'events', limit: 10 });

      // Validate envelope
      const envelopeErrors = validateSuccessEnvelope(response, 'api_list');
      expect(envelopeErrors).toEqual([]);

      // Validate etag
      const etagErrors = validateEtag(response, 'api_list');
      expect(etagErrors).toEqual([]);

      // Validate value structure
      expect(response.value).toHaveProperty('items');
      expect(response.value).toHaveProperty('pagination');
      expect(Array.isArray(response.value.items)).toBe(true);

      // Validate pagination
      const paginationErrors = validatePaginationSchema(response.value.pagination, 'api_list.pagination');
      expect(paginationErrors).toEqual([]);

      // Validate each event in items
      response.value.items.forEach((event, i) => {
        const eventErrors = validateEventSchema(event, `api_list.items[${i}]`);
        expect(eventErrors).toEqual([]);
      });
    }, TIMEOUT);

    it('should return valid pagination with custom limit/offset', async () => {
      const response = await apiRequest('api_list', { scope: 'events', limit: 5, offset: 0 });

      const envelopeErrors = validateSuccessEnvelope(response, 'api_list');
      expect(envelopeErrors).toEqual([]);

      expect(response.value.pagination.limit).toBe(5);
      expect(response.value.pagination.offset).toBe(0);
    }, TIMEOUT);

    it('should return notModified when etag matches', async () => {
      // First request to get etag
      const first = await apiRequest('api_list', { scope: 'events', limit: 1 });

      if (!first.etag) {
        console.log('  Skipping notModified test - no etag in first response');
        return;
      }

      // Second request with matching etag
      const second = await apiRequest('api_list', {
        scope: 'events',
        limit: 1,
        ifNoneMatch: first.etag
      });

      expect(second.ok).toBe(true);
      if (second.notModified) {
        expect(second.notModified).toBe(true);
        expect(second.etag).toBe(first.etag);
      }
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_get (events.get)
  // ==========================================================================

  describe('api_get (events.get)', () => {
    /**
     * CONTRACT per ApiSchemas.gs events.get:
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: Event
     * }
     */

    it('should return valid event matching schema v2.2', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_get', { id: fixtureEventId, scope: 'events' });

      // Validate envelope
      const envelopeErrors = validateSuccessEnvelope(response, 'api_get');
      expect(envelopeErrors).toEqual([]);

      // Validate etag
      const etagErrors = validateEtag(response, 'api_get');
      expect(etagErrors).toEqual([]);

      // Validate event
      const eventErrors = validateEventSchema(response.value, 'api_get.value');
      expect(eventErrors).toEqual([]);

      // Event ID should match requested ID
      expect(response.value.id).toBe(fixtureEventId);
    }, TIMEOUT);

    it('should return NOT_FOUND for invalid event ID', async () => {
      const response = await apiRequest('api_get', { id: 'nonexistent-event-id-12345', scope: 'events' });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('NOT_FOUND');
      expect(response.message).toBeDefined();
    }, TIMEOUT);

    it('should return BAD_INPUT for missing id', async () => {
      const response = await apiRequest('api_get', { scope: 'events' });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('BAD_INPUT');
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getPublicBundle (bundles.public)
  // ==========================================================================

  describe('api_getPublicBundle (bundles.public)', () => {
    /**
     * CONTRACT per ApiSchemas.gs bundles.public:
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     event: Event,
     *     config: { brandId, brandName, appTitle }
     *   }
     * }
     */

    it('should return valid public bundle with event and config', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getPublicBundle', { id: fixtureEventId });

      // Validate envelope
      const envelopeErrors = validateSuccessEnvelope(response, 'api_getPublicBundle');
      expect(envelopeErrors).toEqual([]);

      // Validate etag
      const etagErrors = validateEtag(response, 'api_getPublicBundle');
      expect(etagErrors).toEqual([]);

      // Validate bundle structure
      expect(response.value).toHaveProperty('event');
      expect(response.value).toHaveProperty('config');

      // Validate event
      const eventErrors = validateEventSchema(response.value.event, 'api_getPublicBundle.value.event');
      expect(eventErrors).toEqual([]);

      // Validate config
      const configErrors = validateBundleConfig(response.value.config, 'api_getPublicBundle.value.config');
      expect(configErrors).toEqual([]);
    }, TIMEOUT);

    it('should include all MVP required event fields', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getPublicBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const event = response.value.event;

      // MVP Required per event.schema.json v2.2
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('slug');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('startDateISO');
      expect(event).toHaveProperty('venue');
      expect(event).toHaveProperty('links');
      expect(event).toHaveProperty('qr');
      expect(event).toHaveProperty('ctas');
      expect(event).toHaveProperty('settings');
      expect(event).toHaveProperty('createdAtISO');
      expect(event).toHaveProperty('updatedAtISO');
    }, TIMEOUT);

    it('should return valid links block', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getPublicBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const { links } = response.value.event;

      expect(links).toHaveProperty('publicUrl');
      expect(links).toHaveProperty('displayUrl');
      expect(links).toHaveProperty('posterUrl');
      expect(links).toHaveProperty('signupUrl');
    }, TIMEOUT);

    it('should return valid QR codes', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getPublicBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const { qr } = response.value.event;

      expect(qr).toHaveProperty('public');
      expect(qr).toHaveProperty('signup');
      expect(typeof qr.public).toBe('string');
      expect(typeof qr.signup).toBe('string');
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getDisplayBundle (bundles.display)
  // ==========================================================================

  describe('api_getDisplayBundle (bundles.display)', () => {
    /**
     * CONTRACT per ApiSchemas.gs bundles.display:
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     event: Event,
     *     rotation?: { sponsorSlots, rotationMs },
     *     layout?: { hasSidePane, emphasis }
     *   }
     * }
     */

    it('should return valid display bundle with event', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getDisplayBundle', { id: fixtureEventId });

      // Validate envelope
      const envelopeErrors = validateSuccessEnvelope(response, 'api_getDisplayBundle');
      expect(envelopeErrors).toEqual([]);

      // Validate etag
      const etagErrors = validateEtag(response, 'api_getDisplayBundle');
      expect(etagErrors).toEqual([]);

      // Validate event
      expect(response.value).toHaveProperty('event');
      const eventErrors = validateEventSchema(response.value.event, 'api_getDisplayBundle.value.event');
      expect(eventErrors).toEqual([]);
    }, TIMEOUT);

    it('should include schedule for TV display', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getDisplayBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const event = response.value.event;

      // Schedule may be array or null
      if (event.schedule !== null) {
        expect(Array.isArray(event.schedule)).toBe(true);
      }
    }, TIMEOUT);

    it('should include settings for display visibility', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getDisplayBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const { settings } = response.value.event;

      expect(typeof settings.showSchedule).toBe('boolean');
      expect(typeof settings.showStandings).toBe('boolean');
      expect(typeof settings.showBracket).toBe('boolean');
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getPosterBundle (bundles.poster)
  // ==========================================================================

  describe('api_getPosterBundle (bundles.poster)', () => {
    /**
     * CONTRACT per ApiSchemas.gs bundles.poster:
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     event: Event,
     *     qrCodes?: { public, signup },
     *     print?: { dateLine, venueLine }
     *   }
     * }
     */

    it('should return valid poster bundle with event', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getPosterBundle', { id: fixtureEventId });

      // Validate envelope
      const envelopeErrors = validateSuccessEnvelope(response, 'api_getPosterBundle');
      expect(envelopeErrors).toEqual([]);

      // Validate etag
      const etagErrors = validateEtag(response, 'api_getPosterBundle');
      expect(etagErrors).toEqual([]);

      // Validate event
      expect(response.value).toHaveProperty('event');
      const eventErrors = validateEventSchema(response.value.event, 'api_getPosterBundle.value.event');
      expect(eventErrors).toEqual([]);
    }, TIMEOUT);

    it('should include QR codes for print', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getPosterBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const { qr } = response.value.event;

      expect(qr).toHaveProperty('public');
      expect(qr).toHaveProperty('signup');

      // QR codes should be base64 data URIs
      if (qr.public && qr.public.length > 0) {
        expect(qr.public).toMatch(/^data:image\/png;base64,/);
      }
    }, TIMEOUT);

    it('should include sponsors when showSponsors is true', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getPosterBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const event = response.value.event;

      if (event.settings.showSponsors && event.sponsors?.length > 0) {
        event.sponsors.forEach((sponsor, i) => {
          const sponsorErrors = validateSponsorSchema(sponsor, `sponsors[${i}]`);
          expect(sponsorErrors).toEqual([]);
        });
      }
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getSharedAnalytics (analytics.getSharedReport)
  // ==========================================================================

  describe('api_getSharedAnalytics (analytics.getSharedReport)', () => {
    /**
     * CONTRACT per ApiSchemas.gs analytics.getSharedReport:
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag?: string,
     *   value: SharedAnalytics
     * }
     *
     * SharedAnalytics per /schemas/shared-analytics.schema.json v1.1:
     * {
     *   lastUpdatedISO: string,
     *   summary: { totalImpressions, totalClicks, totalQrScans, totalSignups, uniqueEvents, uniqueSponsors },
     *   surfaces: [{ id, label, impressions, clicks, qrScans, engagementRate? }],
     *   sponsors?: [{ id, name, impressions, clicks, ctr }],
     *   events?: [{ id, name, impressions, clicks, ctr, signupsCount }]
     * }
     */

    it('should return valid SharedAnalytics structure', async () => {
      const response = await apiRequest('api_getSharedAnalytics', {});

      // Check if analytics endpoint is available
      if (response.ok === false && response.code === 'NOT_FOUND') {
        console.log('  Skipping - SharedAnalytics endpoint not available');
        return;
      }

      // Validate envelope
      const envelopeErrors = validateSuccessEnvelope(response, 'api_getSharedAnalytics');
      expect(envelopeErrors).toEqual([]);

      // Validate SharedAnalytics schema
      const analyticsErrors = validateSharedAnalyticsSchema(response.value, 'api_getSharedAnalytics.value');
      expect(analyticsErrors).toEqual([]);
    }, TIMEOUT);

    it('should include MVP required summary fields', async () => {
      const response = await apiRequest('api_getSharedAnalytics', {});

      if (response.ok === false) {
        console.log('  Skipping - SharedAnalytics endpoint not available');
        return;
      }

      const { summary } = response.value;

      // MVP Required per shared-analytics.schema.json v1.1
      expect(summary).toHaveProperty('totalImpressions');
      expect(summary).toHaveProperty('totalClicks');
      expect(summary).toHaveProperty('totalQrScans');
      expect(summary).toHaveProperty('totalSignups');
      expect(summary).toHaveProperty('uniqueEvents');
      expect(summary).toHaveProperty('uniqueSponsors');

      // All must be numbers
      expect(typeof summary.totalImpressions).toBe('number');
      expect(typeof summary.totalClicks).toBe('number');
      expect(typeof summary.totalQrScans).toBe('number');
      expect(typeof summary.totalSignups).toBe('number');
      expect(typeof summary.uniqueEvents).toBe('number');
      expect(typeof summary.uniqueSponsors).toBe('number');
    }, TIMEOUT);

    it('should include surfaces array with valid structure', async () => {
      const response = await apiRequest('api_getSharedAnalytics', {});

      if (response.ok === false) {
        console.log('  Skipping - SharedAnalytics endpoint not available');
        return;
      }

      expect(Array.isArray(response.value.surfaces)).toBe(true);

      if (response.value.surfaces.length > 0) {
        const surface = response.value.surfaces[0];
        expect(surface).toHaveProperty('id');
        expect(surface).toHaveProperty('label');
        expect(surface).toHaveProperty('impressions');
        expect(surface).toHaveProperty('clicks');
        expect(surface).toHaveProperty('qrScans');
      }
    }, TIMEOUT);

    it('should filter by eventId when provided', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiRequest('api_getSharedAnalytics', { eventId: fixtureEventId });

      if (response.ok === false) {
        console.log('  Skipping - SharedAnalytics endpoint not available');
        return;
      }

      // Should still be valid SharedAnalytics
      const analyticsErrors = validateSharedAnalyticsSchema(response.value, 'api_getSharedAnalytics.value');
      expect(analyticsErrors).toEqual([]);
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getSponsorAnalytics (analytics.getSponsorAnalytics)
  // ==========================================================================

  describe('api_getSponsorAnalytics (sponsors.getAnalytics)', () => {
    /**
     * CONTRACT per ApiSchemas.gs analytics.getSponsorAnalytics:
     *
     * Same structure as getSharedReport but scoped to specific sponsor
     * sponsors array will be null (single sponsor view)
     */

    it('should return BAD_INPUT for missing sponsorId', async () => {
      const response = await apiRequest('api_getSponsorAnalytics', {});

      // Should require sponsorId
      expect(response.ok).toBe(false);
      expect(response.code).toBe('BAD_INPUT');
    }, TIMEOUT);

    it('should return valid sponsor-scoped analytics when sponsorId provided', async () => {
      // Use a generic sponsor ID - actual validation depends on data
      const response = await apiRequest('api_getSponsorAnalytics', { sponsorId: 'test-sponsor' });

      // If sponsor exists, validate structure
      if (response.ok) {
        const analyticsErrors = validateSharedAnalyticsSchema(response.value, 'api_getSponsorAnalytics.value');
        expect(analyticsErrors).toEqual([]);

        // Sponsor view should have uniqueSponsors = 1
        expect(response.value.summary.uniqueSponsors).toBeLessThanOrEqual(1);
      } else {
        // NOT_FOUND is acceptable for non-existent sponsor
        expect(['NOT_FOUND', 'BAD_INPUT']).toContain(response.code);
      }
    }, TIMEOUT);
  });

  // ==========================================================================
  // Error Envelope Contract
  // ==========================================================================

  describe('Error Envelope Contract', () => {
    /**
     * ERROR ENVELOPE CONTRACT per ApiSchemas.gs:
     * {
     *   ok: false,
     *   code: "BAD_INPUT" | "NOT_FOUND" | "RATE_LIMITED" | "INTERNAL" | "UNAUTHORIZED" | "CONTRACT",
     *   message: string,
     *   corrId?: string
     * }
     */

    it('should return valid error envelope for BAD_INPUT', async () => {
      const response = await apiRequest('api_get', { scope: 'events' }); // Missing id

      expect(response.ok).toBe(false);
      expect(response.code).toBe('BAD_INPUT');
      expect(typeof response.message).toBe('string');
      expect(response.message.length).toBeGreaterThan(0);
    }, TIMEOUT);

    it('should return valid error envelope for NOT_FOUND', async () => {
      const response = await apiRequest('api_get', { id: 'nonexistent-12345', scope: 'events' });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('NOT_FOUND');
      expect(typeof response.message).toBe('string');
    }, TIMEOUT);

    it('should include corrId in error response when available', async () => {
      const response = await apiRequest('api_get', { id: 'nonexistent-12345', scope: 'events' });

      expect(response.ok).toBe(false);
      // corrId is optional but if present should be string
      if (response.corrId) {
        expect(typeof response.corrId).toBe('string');
      }
    }, TIMEOUT);
  });

  // ==========================================================================
  // Cross-Bundle Consistency
  // ==========================================================================

  describe('Cross-Bundle Consistency', () => {
    it('should return consistent event ID across all bundles', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const [publicBundle, displayBundle, posterBundle] = await Promise.all([
        apiRequest('api_getPublicBundle', { id: fixtureEventId }),
        apiRequest('api_getDisplayBundle', { id: fixtureEventId }),
        apiRequest('api_getPosterBundle', { id: fixtureEventId })
      ]);

      expect(publicBundle.ok).toBe(true);
      expect(displayBundle.ok).toBe(true);
      expect(posterBundle.ok).toBe(true);

      // All should return same event ID
      expect(publicBundle.value.event.id).toBe(fixtureEventId);
      expect(displayBundle.value.event.id).toBe(fixtureEventId);
      expect(posterBundle.value.event.id).toBe(fixtureEventId);
    }, TIMEOUT);

    it('should return consistent event data across bundles', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const [publicBundle, displayBundle] = await Promise.all([
        apiRequest('api_getPublicBundle', { id: fixtureEventId }),
        apiRequest('api_getDisplayBundle', { id: fixtureEventId })
      ]);

      expect(publicBundle.ok).toBe(true);
      expect(displayBundle.ok).toBe(true);

      // Core event fields should match
      expect(publicBundle.value.event.name).toBe(displayBundle.value.event.name);
      expect(publicBundle.value.event.startDateISO).toBe(displayBundle.value.event.startDateISO);
      expect(publicBundle.value.event.venue).toBe(displayBundle.value.event.venue);
    }, TIMEOUT);
  });
});

// ============================================================================
// SCHEMA CHANGE DETECTION
// ============================================================================

describe('Schema Change Detection', () => {
  /**
   * These tests will BREAK LOUDLY if someone changes backend response shapes
   * without updating schemas. This is the acceptance criteria for this story.
   */

  it('should fail if event is missing MVP required fields', () => {
    const incompleteEvent = {
      id: 'test',
      name: 'Test Event'
      // Missing: slug, startDateISO, venue, links, qr, ctas, settings, timestamps
    };

    const errors = validateEventSchema(incompleteEvent, 'test');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('startDateISO'))).toBe(true);
    expect(errors.some(e => e.includes('links'))).toBe(true);
    expect(errors.some(e => e.includes('qr'))).toBe(true);
    expect(errors.some(e => e.includes('ctas'))).toBe(true);
    expect(errors.some(e => e.includes('settings'))).toBe(true);
  });

  it('should fail if SharedAnalytics is missing required fields', () => {
    const incompleteAnalytics = {
      lastUpdatedISO: '2025-01-01T00:00:00Z',
      summary: { totalImpressions: 100 }
      // Missing: other summary fields, surfaces
    };

    const errors = validateSharedAnalyticsSchema(incompleteAnalytics, 'test');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('totalClicks'))).toBe(true);
    expect(errors.some(e => e.includes('surfaces'))).toBe(true);
  });

  it('should fail if pagination is missing required fields', () => {
    const incompletePagination = {
      total: 10
      // Missing: limit, offset, hasMore
    };

    const errors = validatePaginationSchema(incompletePagination, 'test');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('limit'))).toBe(true);
    expect(errors.some(e => e.includes('offset'))).toBe(true);
    expect(errors.some(e => e.includes('hasMore'))).toBe(true);
  });
});
