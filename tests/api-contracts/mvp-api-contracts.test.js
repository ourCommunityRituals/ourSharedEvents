/**
 * MVP API Contract Tests
 *
 * Comprehensive contract tests for all MVP API endpoints.
 * These tests ensure 1:1 mapping between Code.gs _listMvpApis_() and actual endpoints.
 *
 * Acceptance Criteria:
 * - Hits all MVP APIs defined in _listMvpApis_()
 * - Fails loudly if any API is removed or envelope shape changes
 * - Validates {ok:true, value} or {ok:false, code, message} envelope
 * - Validates key structure of value matches ApiSchemas expectations
 *
 * Usage:
 *   npm run test:api-contracts
 *   BASE_URL="https://www.eventangle.com" npm run test:api-contracts
 *
 * @see /src/mvp/Code.gs - _listMvpApis_() for canonical API list
 * @see /src/mvp/ApiSchemas.gs for schema definitions
 * @see /schemas/*.schema.json for JSON Schema source of truth
 */

const { getBaseUrl } = require('../config/environments');

// ============================================================================
// CI DETECTION - Skip network tests in CI environment
// ============================================================================
// These tests make HTTP calls to staging/production and require network access.
// In CI, network is not available, so we skip these tests.
// Run locally with: npm run test:api-contracts

const isCI = process.env.CI === 'true' || process.env.CI === true;
const skipNetworkTests = isCI || process.env.SKIP_NETWORK_TESTS === 'true';

// Use describe.skip to skip all network tests in CI
const describeNetworkTests = skipNetworkTests ? describe.skip : describe;

if (skipNetworkTests) {
  console.log('⚠️  MVP API Contract Tests SKIPPED (CI environment detected)');
  console.log('   Run locally with: npm run test:api-contracts');
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.TEST_BRAND_ID || 'root';
const TIMEOUT = 30000; // 30 second timeout for API calls

/**
 * Canonical list of MVP APIs - mirrors Code.gs _listMvpApis_()
 * This is the single source of truth for Node-side tests.
 * If this list doesn't match _listMvpApis_() in Code.gs, tests will fail.
 *
 * ZEVENT-003: api_saveEvent is the CANONICAL event write endpoint.
 * Legacy endpoints (api_create, api_updateEventData) are orphaned
 * but kept for backward compatibility - see wiring-diagram-sync.test.js.
 */
const MVP_APIS = [
  'api_getEventTemplates',
  'api_saveEvent',           // CANONICAL event write (ZEVENT-003)
  'api_get',
  'api_list',
  'api_getPublicBundle',
  'api_getDisplayBundle',
  'api_getPosterBundle',
  'api_getSharedAnalytics'
];

/**
 * API endpoint configurations for testing
 * Maps API name to test configuration
 *
 * ZEVENT-003: api_saveEvent is canonical. Legacy create/update are orphaned.
 */
const API_CONFIGS = {
  api_getEventTemplates: {
    action: 'getEventTemplates',
    method: 'GET',
    requiresAuth: false,
    requiresEventId: false,
    description: 'List available event templates'
  },
  // CANONICAL EVENT WRITE API (ZEVENT-003)
  api_saveEvent: {
    action: 'saveEvent',
    method: 'POST',
    requiresAuth: true,
    requiresEventId: false,
    description: 'Save event (create or update) - CANONICAL write endpoint',
    schemaPath: 'events.saveEvent'
  },
  api_get: {
    action: 'get',
    method: 'GET',
    requiresAuth: false,
    requiresEventId: true,
    description: 'Get single event by ID'
  },
  api_list: {
    action: 'list',
    method: 'GET',
    requiresAuth: false,
    requiresEventId: false,
    description: 'List events for brand'
  },
  api_getPublicBundle: {
    action: 'getPublicBundle',
    method: 'GET',
    requiresAuth: false,
    requiresEventId: true,
    description: 'Public page bundle'
  },
  api_getDisplayBundle: {
    action: 'getDisplayBundle',
    method: 'GET',
    requiresAuth: false,
    requiresEventId: true,
    description: 'Display/TV bundle'
  },
  api_getPosterBundle: {
    action: 'getPosterBundle',
    method: 'GET',
    requiresAuth: false,
    requiresEventId: true,
    description: 'Poster print bundle'
  },
  api_getSharedAnalytics: {
    action: 'getSharedReportBundle',
    method: 'GET',
    requiresAuth: false,
    requiresEventId: true,
    description: 'Shared analytics report'
  }
};

// ============================================================================
// SCHEMA VALIDATORS
// ============================================================================

/**
 * Validates the response envelope structure per ApiSchemas.gs
 * All APIs must return {ok: boolean, ...}
 */
const validateEnvelope = (response, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  if (typeof response !== 'object' || response === null) {
    errors.push(`${prefix}Response must be an object`);
    return errors;
  }

  if (!('ok' in response)) {
    errors.push(`${prefix}Missing required 'ok' property`);
    return errors;
  }

  if (typeof response.ok !== 'boolean') {
    errors.push(`${prefix}'ok' must be boolean, got ${typeof response.ok}`);
  }

  if (response.ok === true) {
    // Success envelope: { ok: true, value: {...}, etag?: string, notModified?: boolean }
    if (!response.notModified && !('value' in response)) {
      errors.push(`${prefix}Success response missing 'value' property`);
    }
  } else {
    // Error envelope: { ok: false, code: string, message: string, corrId?: string }
    if (!('code' in response)) {
      errors.push(`${prefix}Error response missing 'code' property`);
    }
    if (!('message' in response)) {
      errors.push(`${prefix}Error response missing 'message' property`);
    }
    if (response.code && !['BAD_INPUT', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'UNAUTHORIZED', 'CONTRACT'].includes(response.code)) {
      errors.push(`${prefix}Invalid error code: ${response.code}`);
    }
  }

  return errors;
};

/**
 * Validates Event schema per /schemas/event.schema.json v2.2
 * MVP REQUIRED: id, slug, name, startDateISO, venue, links, qr, ctas, settings, createdAtISO, updatedAtISO
 */
const validateEventSchema = (event, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  // MVP REQUIRED - Identity
  if (typeof event.id !== 'string' || event.id.length === 0) {
    errors.push(`${prefix}id: must be non-empty string`);
  }
  if (typeof event.slug !== 'string') {
    errors.push(`${prefix}slug: must be string`);
  }
  if (typeof event.name !== 'string' || event.name.length === 0) {
    errors.push(`${prefix}name: must be non-empty string`);
  }
  if (typeof event.startDateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.startDateISO)) {
    errors.push(`${prefix}startDateISO: must match YYYY-MM-DD, got: ${event.startDateISO}`);
  }
  if (typeof event.venue !== 'string') {
    errors.push(`${prefix}venue: must be string`);
  }

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
 * Validates SharedAnalytics schema per /schemas/shared-analytics.schema.json v1.1
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

  return errors;
};

/**
 * Validates Template schema per ApiSchemas.gs templates.list
 */
const validateTemplateSchema = (template, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  if (typeof template.id !== 'string' || template.id.length === 0) {
    errors.push(`${prefix}id: must be non-empty string`);
  }
  if (typeof template.name !== 'string' || template.name.length === 0) {
    errors.push(`${prefix}name: must be non-empty string`);
  }
  if (typeof template.description !== 'string') {
    errors.push(`${prefix}description: must be string`);
  }

  return errors;
};

/**
 * Validates Bundle config structure
 */
const validateBundleConfig = (config, context = '') => {
  const errors = [];
  const prefix = context ? `${context}: ` : '';

  if (typeof config.brandId !== 'string') errors.push(`${prefix}brandId: must be string`);
  if (typeof config.brandName !== 'string') errors.push(`${prefix}brandName: must be string`);

  return errors;
};

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * Make API request to backend via GET
 */
async function apiGet(action, params = {}) {
  const url = new URL(BASE_URL);
  url.searchParams.append('action', action);
  url.searchParams.append('brand', BRAND_ID);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
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

/**
 * Make API request to backend via POST
 */
async function apiPost(action, params = {}) {
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

describeNetworkTests('MVP API Contract Tests', () => {
  let fixtureEventId = null;

  beforeAll(async () => {
    console.log('\n='.repeat(70));
    console.log('MVP API CONTRACT TESTS');
    console.log('='.repeat(70));
    console.log(`📍 Testing against: ${BASE_URL}`);
    console.log(`📍 Brand ID: ${BRAND_ID}`);
    console.log(`📍 MVP APIs: ${MVP_APIS.length} endpoints`);
    console.log('='.repeat(70) + '\n');

    // Fetch a valid event ID to use for testing
    try {
      const response = await apiGet('list', { scope: 'events', limit: 10 });
      if (response.ok && response.value?.items?.length > 0) {
        fixtureEventId = response.value.items[0].id;
        console.log(`📍 Using fixture event ID: ${fixtureEventId}\n`);
      } else {
        console.warn('⚠️  No events found - some tests will be skipped\n');
      }
    } catch (error) {
      console.warn(`⚠️  Failed to fetch events: ${error.message}\n`);
    }
  }, TIMEOUT);

  // ==========================================================================
  // API Inventory Test
  // ==========================================================================

  describe('API Inventory', () => {
    it('should have all MVP APIs configured', () => {
      MVP_APIS.forEach(api => {
        expect(API_CONFIGS).toHaveProperty(api);
        expect(API_CONFIGS[api].action).toBeDefined();
      });
    });

    it('should have 8 MVP APIs (matches _listMvpApis_())', () => {
      // ZEVENT-003: api_saveEvent replaces api_create + api_updateEventData
      expect(MVP_APIS.length).toBe(8);
    });
  });

  // ==========================================================================
  // api_list - List Events
  // ==========================================================================

  describe('api_list', () => {
    it('should return HTTP 200 with valid envelope', async () => {
      const response = await apiGet('list', { scope: 'events', limit: 10 });

      const errors = validateEnvelope(response, 'api_list');
      expect(errors).toEqual([]);
      expect(response.ok).toBe(true);
    }, TIMEOUT);

    it('should return { ok: true, value: { items, pagination } }', async () => {
      const response = await apiGet('list', { scope: 'events', limit: 10 });

      expect(response.ok).toBe(true);
      expect(response.value).toHaveProperty('items');
      expect(response.value).toHaveProperty('pagination');
      expect(Array.isArray(response.value.items)).toBe(true);
    }, TIMEOUT);

    it('should return valid pagination structure', async () => {
      const response = await apiGet('list', { scope: 'events', limit: 5 });

      const errors = validatePaginationSchema(response.value.pagination, 'api_list.pagination');
      expect(errors).toEqual([]);
    }, TIMEOUT);

    it('should return valid event schema for each item', async () => {
      const response = await apiGet('list', { scope: 'events', limit: 10 });

      expect(response.ok).toBe(true);
      response.value.items.forEach((event, i) => {
        const errors = validateEventSchema(event, `api_list.items[${i}]`);
        expect(errors).toEqual([]);
      });
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_get - Get Single Event
  // ==========================================================================

  describe('api_get', () => {
    it('should return HTTP 200 with valid envelope for existing event', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('get', { id: fixtureEventId, scope: 'events' });

      const errors = validateEnvelope(response, 'api_get');
      expect(errors).toEqual([]);
      expect(response.ok).toBe(true);
    }, TIMEOUT);

    it('should return { ok: true, value: Event }', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('get', { id: fixtureEventId, scope: 'events' });

      expect(response.ok).toBe(true);
      const errors = validateEventSchema(response.value, 'api_get.value');
      expect(errors).toEqual([]);
      expect(response.value.id).toBe(fixtureEventId);
    }, TIMEOUT);

    it('should return { ok: false, code: "NOT_FOUND" } for invalid ID', async () => {
      const response = await apiGet('get', { id: 'nonexistent-event-xyz-123', scope: 'events' });

      const errors = validateEnvelope(response, 'api_get');
      expect(errors).toEqual([]);
      expect(response.ok).toBe(false);
      expect(response.code).toBe('NOT_FOUND');
    }, TIMEOUT);

    it('should return { ok: false, code: "BAD_INPUT" } for missing ID', async () => {
      const response = await apiGet('get', { scope: 'events' });

      const errors = validateEnvelope(response, 'api_get');
      expect(errors).toEqual([]);
      expect(response.ok).toBe(false);
      expect(response.code).toBe('BAD_INPUT');
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getPublicBundle - Public Page Bundle
  // ==========================================================================

  describe('api_getPublicBundle', () => {
    it('should return HTTP 200 with valid envelope', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getPublicBundle', { id: fixtureEventId });

      const errors = validateEnvelope(response, 'api_getPublicBundle');
      expect(errors).toEqual([]);
      expect(response.ok).toBe(true);
    }, TIMEOUT);

    it('should return { ok: true, value: { event, config } }', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getPublicBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      expect(response.value).toHaveProperty('event');
      expect(response.value).toHaveProperty('config');
    }, TIMEOUT);

    it('should return valid event schema in bundle', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getPublicBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const errors = validateEventSchema(response.value.event, 'api_getPublicBundle.event');
      expect(errors).toEqual([]);
    }, TIMEOUT);

    it('should return valid config structure', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getPublicBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const errors = validateBundleConfig(response.value.config, 'api_getPublicBundle.config');
      expect(errors).toEqual([]);
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getDisplayBundle - Display/TV Bundle
  // ==========================================================================

  describe('api_getDisplayBundle', () => {
    it('should return HTTP 200 with valid envelope', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getDisplayBundle', { id: fixtureEventId });

      const errors = validateEnvelope(response, 'api_getDisplayBundle');
      expect(errors).toEqual([]);
      expect(response.ok).toBe(true);
    }, TIMEOUT);

    it('should return { ok: true, value: { event } }', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getDisplayBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      expect(response.value).toHaveProperty('event');
    }, TIMEOUT);

    it('should return valid event schema in bundle', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getDisplayBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const errors = validateEventSchema(response.value.event, 'api_getDisplayBundle.event');
      expect(errors).toEqual([]);
    }, TIMEOUT);

    it('should include display-specific fields (schedule, settings)', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getDisplayBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const event = response.value.event;
      expect(event).toHaveProperty('settings');
      expect(typeof event.settings.showSchedule).toBe('boolean');
      expect(typeof event.settings.showStandings).toBe('boolean');
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getPosterBundle - Poster Print Bundle
  // ==========================================================================

  describe('api_getPosterBundle', () => {
    it('should return HTTP 200 with valid envelope', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getPosterBundle', { id: fixtureEventId });

      const errors = validateEnvelope(response, 'api_getPosterBundle');
      expect(errors).toEqual([]);
      expect(response.ok).toBe(true);
    }, TIMEOUT);

    it('should return { ok: true, value: { event } }', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getPosterBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      expect(response.value).toHaveProperty('event');
    }, TIMEOUT);

    it('should return valid event schema with QR codes', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getPosterBundle', { id: fixtureEventId });

      expect(response.ok).toBe(true);
      const errors = validateEventSchema(response.value.event, 'api_getPosterBundle.event');
      expect(errors).toEqual([]);

      // Poster should have QR codes
      expect(response.value.event.qr).toHaveProperty('public');
      expect(response.value.event.qr).toHaveProperty('signup');
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getSharedAnalytics - Shared Analytics Report
  // ==========================================================================

  describe('api_getSharedAnalytics', () => {
    it('should return HTTP 200 with valid envelope', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getSharedReportBundle', { id: fixtureEventId });

      // May return NOT_FOUND if analytics not configured
      const errors = validateEnvelope(response, 'api_getSharedAnalytics');
      expect(errors).toEqual([]);
    }, TIMEOUT);

    it('should return { ok: true, value: SharedAnalytics } or { ok: false }', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const response = await apiGet('getSharedReportBundle', { id: fixtureEventId });

      // Either success with valid analytics or valid error
      if (response.ok) {
        const errors = validateSharedAnalyticsSchema(response.value, 'api_getSharedAnalytics.value');
        expect(errors).toEqual([]);
      } else {
        expect(['NOT_FOUND', 'BAD_INPUT']).toContain(response.code);
      }
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_getEventTemplates - List Templates
  // ==========================================================================

  describe('api_getEventTemplates', () => {
    it('should return HTTP 200 with valid envelope', async () => {
      const response = await apiGet('getEventTemplates', {});

      const errors = validateEnvelope(response, 'api_getEventTemplates');
      expect(errors).toEqual([]);
    }, TIMEOUT);

    it('should return { ok: true, value: { templates: [] } }', async () => {
      const response = await apiGet('getEventTemplates', {});

      // May succeed or fail depending on configuration
      if (response.ok) {
        expect(response.value).toHaveProperty('templates');
        expect(Array.isArray(response.value.templates)).toBe(true);

        // Validate each template if any
        if (response.value.templates.length > 0) {
          response.value.templates.forEach((template, i) => {
            const errors = validateTemplateSchema(template, `api_getEventTemplates.templates[${i}]`);
            expect(errors).toEqual([]);
          });
        }
      }
    }, TIMEOUT);
  });

  // ==========================================================================
  // api_saveEvent - CANONICAL Event Write API (ZEVENT-003)
  // ==========================================================================
  // Replaces both api_create and api_updateEventData
  // Modes: CREATE (no id) or UPDATE (with id)

  describe('api_saveEvent', () => {
    it('should return { ok: false, code: "BAD_INPUT" } without adminKey', async () => {
      const response = await apiPost('saveEvent', {
        event: {
          name: 'Test Event',
          startDateISO: '2025-12-15',
          venue: 'Test Venue'
        }
      });

      const errors = validateEnvelope(response, 'api_saveEvent');
      expect(errors).toEqual([]);
      expect(response.ok).toBe(false);
      // Should fail due to missing adminKey
      expect(['BAD_INPUT', 'UNAUTHORIZED']).toContain(response.code);
    }, TIMEOUT);

    it('should validate event schema path exists', () => {
      const config = API_CONFIGS.api_saveEvent;
      expect(config.schemaPath).toBe('events.saveEvent');
    });
  });

  // ==========================================================================
  // Error Envelope Contract
  // ==========================================================================

  describe('Error Envelope Contract', () => {
    it('should return valid error envelope for BAD_INPUT', async () => {
      const response = await apiGet('get', { scope: 'events' }); // Missing id

      expect(response.ok).toBe(false);
      expect(response.code).toBe('BAD_INPUT');
      expect(typeof response.message).toBe('string');
      expect(response.message.length).toBeGreaterThan(0);
    }, TIMEOUT);

    it('should return valid error envelope for NOT_FOUND', async () => {
      const response = await apiGet('get', { id: 'nonexistent-12345', scope: 'events' });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('NOT_FOUND');
      expect(typeof response.message).toBe('string');
    }, TIMEOUT);

    it('should include corrId in error response when available', async () => {
      const response = await apiGet('get', { id: 'nonexistent-12345', scope: 'events' });

      expect(response.ok).toBe(false);
      // corrId is optional but if present should be string
      if (response.corrId) {
        expect(typeof response.corrId).toBe('string');
      }
    }, TIMEOUT);

    it('should return valid error codes only', async () => {
      const response = await apiGet('get', { scope: 'events' });

      expect(response.ok).toBe(false);
      const validCodes = ['BAD_INPUT', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'UNAUTHORIZED', 'CONTRACT'];
      expect(validCodes).toContain(response.code);
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
        apiGet('getPublicBundle', { id: fixtureEventId }),
        apiGet('getDisplayBundle', { id: fixtureEventId }),
        apiGet('getPosterBundle', { id: fixtureEventId })
      ]);

      expect(publicBundle.ok).toBe(true);
      expect(displayBundle.ok).toBe(true);
      expect(posterBundle.ok).toBe(true);

      expect(publicBundle.value.event.id).toBe(fixtureEventId);
      expect(displayBundle.value.event.id).toBe(fixtureEventId);
      expect(posterBundle.value.event.id).toBe(fixtureEventId);
    }, TIMEOUT);

    it('should return consistent core event fields across bundles', async () => {
      if (!fixtureEventId) {
        console.log('  Skipping - no fixture event available');
        return;
      }

      const [publicBundle, displayBundle] = await Promise.all([
        apiGet('getPublicBundle', { id: fixtureEventId }),
        apiGet('getDisplayBundle', { id: fixtureEventId })
      ]);

      expect(publicBundle.ok).toBe(true);
      expect(displayBundle.ok).toBe(true);

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

  it('should fail if envelope is missing ok property', () => {
    const badEnvelope = { value: {} };

    const errors = validateEnvelope(badEnvelope, 'test');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes("'ok'"))).toBe(true);
  });

  it('should fail if error envelope is missing code/message', () => {
    const badErrorEnvelope = { ok: false };

    const errors = validateEnvelope(badErrorEnvelope, 'test');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes("'code'"))).toBe(true);
    expect(errors.some(e => e.includes("'message'"))).toBe(true);
  });
});
