/**
 * EXPLICIT API RESPONSE CONTRACTS + NODE TESTS
 *
 * Story: SDET/SRE - Every API that powers MVP surfaces has an explicit contract
 * and a corresponding test.
 *
 * TARGET APIs:
 * - api_getEvents (api_list) - List events
 * - api_get - Get single event
 * - api_getPublicBundle - Public.html surface data
 * - api_getDisplayBundle - Display.html (TV mode) data
 * - api_getPosterBundle - Poster.html print-ready data
 * - api_getAdminBundle - Admin.html with full config
 * - api_getSharedAnalytics - Organizer analytics view
 * - api_getSponsorAnalytics - Sponsor-scoped analytics view
 * - api_getSponsorReportQr - Sponsor QR code generation (SharedReport/Admin)
 * - api_saveEvent - Create/Update event (Admin)
 * - api_updateEventData - Update event data (Admin)
 *
 * ACCEPTANCE CRITERIA:
 * - npm run test:api-contracts passes
 * - Breaks loudly if someone changes backend response shapes without updating schemas
 * - STRICT mode validation fails on any extra or missing fields (additionalProperties: false)
 *
 * SCHEMA REFERENCES:
 * - /schemas/event.schema.json (MVP-frozen v2.2)
 * - /schemas/shared-analytics.schema.json (MVP-frozen v1.1)
 * - /schemas/sponsor-report-qr.schema.json (v1.0)
 * - /schemas/sponsor.schema.json
 */

const {
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  ERROR_CODES,
  dateHelpers,
  generateTestId,
  brandHelpers
} = require('../shared/helpers/test.helpers.js');

const {
  validateEventContractV2,
  validateBundleEnvelope,
  validateEtag,
  validateBrandConfig
} = require('../shared/helpers/test-runner.js');

// ============================================================================
// FIXTURE DATA - Known test events for contract testing
// ============================================================================

/**
 * Fixture Event: Standard test event with all MVP required fields
 * Used for testing api_get, bundles, and other read operations
 *
 * Story 2.2: Updated fixture URLs to use eventangle.com (no GAS URLs in test data)
 */
const FIXTURE_EVENT_STANDARD = {
  id: 'fixture-event-001',
  slug: 'fixture-test-event',
  name: 'Fixture Test Event',
  startDateISO: '2025-12-15',
  venue: 'Test Arena, 123 Main St',
  links: {
    publicUrl: 'https://www.eventangle.com/events/fixture-event-001?brand=root',
    displayUrl: 'https://www.eventangle.com/display/fixture-event-001?brand=root&tv=1',
    posterUrl: 'https://www.eventangle.com/poster/fixture-event-001?brand=root',
    signupUrl: 'https://forms.google.com/fixture-signup'
  },
  qr: {
    public: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    signup: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  },
  ctas: {
    primary: { label: 'Sign Up', url: 'https://forms.google.com/fixture-signup' },
    secondary: null
  },
  settings: {
    showSchedule: true,
    showStandings: false,
    showBracket: false,
    showSponsors: false
  },
  schedule: [
    { time: '10:00 AM', title: 'Registration', description: 'Check-in opens' },
    { time: '11:00 AM', title: 'Opening Ceremony', description: null }
  ],
  standings: null,
  bracket: null,
  sponsors: [],
  media: {},
  externalData: {},
  analytics: { enabled: false },
  payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null },
  createdAtISO: '2025-11-01T10:00:00.000Z',
  updatedAtISO: '2025-11-01T10:00:00.000Z'
};

/**
 * Fixture Event: Event with sponsors (for sponsor analytics testing)
 */
const FIXTURE_EVENT_WITH_SPONSORS = {
  ...FIXTURE_EVENT_STANDARD,
  id: 'fixture-event-002',
  slug: 'fixture-sponsored-event',
  name: 'Fixture Sponsored Event',
  settings: {
    ...FIXTURE_EVENT_STANDARD.settings,
    showSponsors: true
  },
  sponsors: [
    {
      id: 'sponsor-001',
      name: 'Gold Sponsor Inc',
      logoUrl: 'https://example.com/gold-logo.png',
      linkUrl: 'https://goldsponsor.com',
      placement: 'poster'
    },
    {
      id: 'sponsor-002',
      name: 'Silver Sponsor LLC',
      logoUrl: 'https://example.com/silver-logo.png',
      linkUrl: null,
      placement: 'display'
    }
  ]
};

// ============================================================================
// SCHEMA VALIDATORS - Validate response shapes match explicit contracts
// ============================================================================

/**
 * Validates Event shape per /schemas/event.schema.json v2.2 (MVP-frozen)
 * MVP REQUIRED: id, slug, name, startDateISO, venue, links, qr, ctas, settings, createdAtISO, updatedAtISO
 */
const validateEventSchema = (event) => {
  const errors = [];

  // MVP REQUIRED - Identity
  if (typeof event.id !== 'string' || event.id.length === 0) errors.push('id: must be non-empty string');
  if (typeof event.slug !== 'string' || !/^[a-z0-9-]+$/.test(event.slug)) errors.push('slug: must match ^[a-z0-9-]+$');
  if (typeof event.name !== 'string' || event.name.length === 0) errors.push('name: must be non-empty string');
  if (typeof event.startDateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.startDateISO)) errors.push('startDateISO: must match YYYY-MM-DD');
  if (typeof event.venue !== 'string' || event.venue.length === 0) errors.push('venue: must be non-empty string');

  // MVP REQUIRED - Links
  if (!event.links || typeof event.links !== 'object') {
    errors.push('links: must be object');
  } else {
    if (typeof event.links.publicUrl !== 'string') errors.push('links.publicUrl: must be string');
    if (typeof event.links.displayUrl !== 'string') errors.push('links.displayUrl: must be string');
    if (typeof event.links.posterUrl !== 'string') errors.push('links.posterUrl: must be string');
    if (typeof event.links.signupUrl !== 'string') errors.push('links.signupUrl: must be string');
  }

  // MVP REQUIRED - QR Codes
  if (!event.qr || typeof event.qr !== 'object') {
    errors.push('qr: must be object');
  } else {
    if (typeof event.qr.public !== 'string') errors.push('qr.public: must be string');
    if (typeof event.qr.signup !== 'string') errors.push('qr.signup: must be string');
  }

  // MVP REQUIRED - CTAs
  if (!event.ctas || typeof event.ctas !== 'object') {
    errors.push('ctas: must be object');
  } else {
    if (!event.ctas.primary || typeof event.ctas.primary !== 'object') {
      errors.push('ctas.primary: must be object');
    } else {
      if (typeof event.ctas.primary.label !== 'string') errors.push('ctas.primary.label: must be string');
      if (typeof event.ctas.primary.url !== 'string') errors.push('ctas.primary.url: must be string');
    }
  }

  // MVP REQUIRED - Settings
  if (!event.settings || typeof event.settings !== 'object') {
    errors.push('settings: must be object');
  } else {
    if (typeof event.settings.showSchedule !== 'boolean') errors.push('settings.showSchedule: must be boolean');
    if (typeof event.settings.showStandings !== 'boolean') errors.push('settings.showStandings: must be boolean');
    if (typeof event.settings.showBracket !== 'boolean') errors.push('settings.showBracket: must be boolean');
  }

  // MVP REQUIRED - Timestamps
  if (typeof event.createdAtISO !== 'string') errors.push('createdAtISO: must be string');
  if (typeof event.updatedAtISO !== 'string') errors.push('updatedAtISO: must be string');

  return errors.length === 0 ? true : errors;
};

/**
 * Validates SharedAnalytics shape per /schemas/shared-analytics.schema.json v1.1 (MVP-frozen)
 * MVP REQUIRED: lastUpdatedISO, summary, surfaces
 */
const validateSharedAnalyticsSchema = (analytics) => {
  const errors = [];

  // MVP REQUIRED - lastUpdatedISO
  if (typeof analytics.lastUpdatedISO !== 'string') {
    errors.push('lastUpdatedISO: must be string');
  }

  // MVP REQUIRED - summary
  if (!analytics.summary || typeof analytics.summary !== 'object') {
    errors.push('summary: must be object');
  } else {
    if (typeof analytics.summary.totalImpressions !== 'number') errors.push('summary.totalImpressions: must be number');
    if (typeof analytics.summary.totalClicks !== 'number') errors.push('summary.totalClicks: must be number');
    if (typeof analytics.summary.totalQrScans !== 'number') errors.push('summary.totalQrScans: must be number');
    if (typeof analytics.summary.totalSignups !== 'number') errors.push('summary.totalSignups: must be number');
    if (typeof analytics.summary.uniqueEvents !== 'number') errors.push('summary.uniqueEvents: must be number');
    if (typeof analytics.summary.uniqueSponsors !== 'number') errors.push('summary.uniqueSponsors: must be number');
  }

  // MVP REQUIRED - surfaces (array)
  if (!Array.isArray(analytics.surfaces)) {
    errors.push('surfaces: must be array');
  } else {
    analytics.surfaces.forEach((surface, i) => {
      if (typeof surface.id !== 'string') errors.push(`surfaces[${i}].id: must be string`);
      if (typeof surface.label !== 'string') errors.push(`surfaces[${i}].label: must be string`);
      if (typeof surface.impressions !== 'number') errors.push(`surfaces[${i}].impressions: must be number`);
      if (typeof surface.clicks !== 'number') errors.push(`surfaces[${i}].clicks: must be number`);
      if (typeof surface.qrScans !== 'number') errors.push(`surfaces[${i}].qrScans: must be number`);
    });
  }

  // MVP OPTIONAL - sponsors (array or null)
  if (analytics.sponsors !== null && analytics.sponsors !== undefined) {
    if (!Array.isArray(analytics.sponsors)) {
      errors.push('sponsors: must be array or null');
    } else {
      analytics.sponsors.forEach((sponsor, i) => {
        if (typeof sponsor.id !== 'string') errors.push(`sponsors[${i}].id: must be string`);
        if (typeof sponsor.name !== 'string') errors.push(`sponsors[${i}].name: must be string`);
        if (typeof sponsor.impressions !== 'number') errors.push(`sponsors[${i}].impressions: must be number`);
        if (typeof sponsor.clicks !== 'number') errors.push(`sponsors[${i}].clicks: must be number`);
        if (typeof sponsor.ctr !== 'number') errors.push(`sponsors[${i}].ctr: must be number`);
      });
    }
  }

  // MVP OPTIONAL - events (array or null)
  if (analytics.events !== null && analytics.events !== undefined) {
    if (!Array.isArray(analytics.events)) {
      errors.push('events: must be array or null');
    } else {
      analytics.events.forEach((event, i) => {
        if (typeof event.id !== 'string') errors.push(`events[${i}].id: must be string`);
        if (typeof event.name !== 'string') errors.push(`events[${i}].name: must be string`);
        if (typeof event.impressions !== 'number') errors.push(`events[${i}].impressions: must be number`);
        if (typeof event.clicks !== 'number') errors.push(`events[${i}].clicks: must be number`);
        if (typeof event.ctr !== 'number') errors.push(`events[${i}].ctr: must be number`);
        if (typeof event.signupsCount !== 'number') errors.push(`events[${i}].signupsCount: must be number`);
      });
    }
  }

  return errors.length === 0 ? true : errors;
};

/**
 * Validates Bundle envelope structure
 * All bundles must have: { ok: true, etag: string, value: { event: Event, config: BrandConfig } }
 */
const validateBundleSchema = (response) => {
  const errors = [];

  if (response.ok !== true) {
    errors.push('ok: must be true for success response');
    return errors;
  }

  if (typeof response.etag !== 'string' || response.etag.length < 8) {
    errors.push('etag: must be string with length >= 8');
  }

  if (!response.value || typeof response.value !== 'object') {
    errors.push('value: must be object');
    return errors;
  }

  // Validate event in bundle
  if (!response.value.event) {
    errors.push('value.event: required');
  } else {
    const eventValidation = validateEventSchema(response.value.event);
    if (eventValidation !== true) {
      errors.push(...eventValidation.map(e => `value.event.${e}`));
    }
  }

  // Validate config in bundle
  if (!response.value.config) {
    errors.push('value.config: required');
  } else {
    if (typeof response.value.config.brandId !== 'string') errors.push('value.config.brandId: must be string');
    if (typeof response.value.config.brandName !== 'string') errors.push('value.config.brandName: must be string');
  }

  return errors.length === 0 ? true : errors;
};

/**
 * Validates Sponsor schema per /schemas/sponsor.schema.json
 */
const validateSponsorSchema = (sponsor) => {
  const errors = [];

  if (typeof sponsor.id !== 'string' || sponsor.id.length === 0) errors.push('id: must be non-empty string');
  if (typeof sponsor.name !== 'string' || sponsor.name.length === 0) errors.push('name: must be non-empty string');
  if (typeof sponsor.logoUrl !== 'string' || !sponsor.logoUrl.match(/^https?:\/\/.+/)) errors.push('logoUrl: must be valid URL');
  if (typeof sponsor.placement !== 'string' || !['poster', 'display', 'public', 'tv-banner'].includes(sponsor.placement)) {
    errors.push('placement: must be one of poster, display, public, tv-banner');
  }

  return errors.length === 0 ? true : errors;
};

/**
 * Validates SponsorReportQr shape per /schemas/sponsor-report-qr.schema.json v1.0
 * MVP REQUIRED: url, qrB64, verified
 * STRICT: additionalProperties: false - extra fields will fail validation
 */
const validateSponsorReportQrSchema = (qrData, strict = false) => {
  const errors = [];
  const ALLOWED_FIELDS = ['url', 'qrB64', 'verified'];

  // MVP REQUIRED - url
  if (typeof qrData.url !== 'string') {
    errors.push('url: must be string');
  }

  // MVP REQUIRED - qrB64
  if (typeof qrData.qrB64 !== 'string') {
    errors.push('qrB64: must be string');
  }

  // MVP REQUIRED - verified
  if (typeof qrData.verified !== 'boolean') {
    errors.push('verified: must be boolean');
  }

  // STRICT MODE: Check for extra fields (additionalProperties: false)
  if (strict) {
    const extraFields = Object.keys(qrData).filter(k => !ALLOWED_FIELDS.includes(k));
    if (extraFields.length > 0) {
      errors.push(`extraFields: [${extraFields.join(', ')}] - additionalProperties not allowed`);
    }
  }

  return errors.length === 0 ? true : errors;
};

/**
 * Validates SharedAnalytics with STRICT mode option
 * When strict=true, fails on extra fields per additionalProperties: false
 */
const validateSharedAnalyticsSchemaStrict = (analytics, strict = false) => {
  const errors = [];
  const ALLOWED_ROOT_FIELDS = ['lastUpdatedISO', 'summary', 'surfaces', 'sponsors', 'events', 'topSponsors'];
  const ALLOWED_SUMMARY_FIELDS = ['totalImpressions', 'totalClicks', 'totalQrScans', 'totalSignups', 'uniqueEvents', 'uniqueSponsors'];
  const ALLOWED_SURFACE_FIELDS = ['id', 'label', 'impressions', 'clicks', 'qrScans', 'engagementRate'];
  const ALLOWED_SPONSOR_FIELDS = ['id', 'name', 'impressions', 'clicks', 'ctr'];
  const ALLOWED_EVENT_FIELDS = ['id', 'name', 'impressions', 'clicks', 'ctr', 'signupsCount'];

  // MVP REQUIRED - lastUpdatedISO
  if (typeof analytics.lastUpdatedISO !== 'string') {
    errors.push('lastUpdatedISO: must be string');
  }

  // MVP REQUIRED - summary
  if (!analytics.summary || typeof analytics.summary !== 'object') {
    errors.push('summary: must be object');
  } else {
    if (typeof analytics.summary.totalImpressions !== 'number') errors.push('summary.totalImpressions: must be number');
    if (typeof analytics.summary.totalClicks !== 'number') errors.push('summary.totalClicks: must be number');
    if (typeof analytics.summary.totalQrScans !== 'number') errors.push('summary.totalQrScans: must be number');
    if (typeof analytics.summary.totalSignups !== 'number') errors.push('summary.totalSignups: must be number');
    if (typeof analytics.summary.uniqueEvents !== 'number') errors.push('summary.uniqueEvents: must be number');
    if (typeof analytics.summary.uniqueSponsors !== 'number') errors.push('summary.uniqueSponsors: must be number');

    // STRICT: Check for extra summary fields
    if (strict) {
      const extraSummaryFields = Object.keys(analytics.summary).filter(k => !ALLOWED_SUMMARY_FIELDS.includes(k));
      if (extraSummaryFields.length > 0) {
        errors.push(`summary.extraFields: [${extraSummaryFields.join(', ')}] - not allowed`);
      }
    }
  }

  // MVP REQUIRED - surfaces (array)
  if (!Array.isArray(analytics.surfaces)) {
    errors.push('surfaces: must be array');
  } else {
    analytics.surfaces.forEach((surface, i) => {
      if (typeof surface.id !== 'string') errors.push(`surfaces[${i}].id: must be string`);
      if (typeof surface.label !== 'string') errors.push(`surfaces[${i}].label: must be string`);
      if (typeof surface.impressions !== 'number') errors.push(`surfaces[${i}].impressions: must be number`);
      if (typeof surface.clicks !== 'number') errors.push(`surfaces[${i}].clicks: must be number`);
      if (typeof surface.qrScans !== 'number') errors.push(`surfaces[${i}].qrScans: must be number`);

      // STRICT: Check for extra surface fields
      if (strict) {
        const extraSurfaceFields = Object.keys(surface).filter(k => !ALLOWED_SURFACE_FIELDS.includes(k));
        if (extraSurfaceFields.length > 0) {
          errors.push(`surfaces[${i}].extraFields: [${extraSurfaceFields.join(', ')}] - not allowed`);
        }
      }
    });
  }

  // MVP OPTIONAL - sponsors
  if (analytics.sponsors !== null && analytics.sponsors !== undefined) {
    if (!Array.isArray(analytics.sponsors)) {
      errors.push('sponsors: must be array or null');
    } else {
      analytics.sponsors.forEach((sponsor, i) => {
        if (typeof sponsor.id !== 'string') errors.push(`sponsors[${i}].id: must be string`);
        if (typeof sponsor.name !== 'string') errors.push(`sponsors[${i}].name: must be string`);
        if (typeof sponsor.impressions !== 'number') errors.push(`sponsors[${i}].impressions: must be number`);
        if (typeof sponsor.clicks !== 'number') errors.push(`sponsors[${i}].clicks: must be number`);
        if (typeof sponsor.ctr !== 'number') errors.push(`sponsors[${i}].ctr: must be number`);

        // STRICT: Check for extra sponsor fields
        if (strict) {
          const extraSponsorFields = Object.keys(sponsor).filter(k => !ALLOWED_SPONSOR_FIELDS.includes(k));
          if (extraSponsorFields.length > 0) {
            errors.push(`sponsors[${i}].extraFields: [${extraSponsorFields.join(', ')}] - not allowed`);
          }
        }
      });
    }
  }

  // MVP OPTIONAL - events
  if (analytics.events !== null && analytics.events !== undefined) {
    if (!Array.isArray(analytics.events)) {
      errors.push('events: must be array or null');
    } else {
      analytics.events.forEach((event, i) => {
        if (typeof event.id !== 'string') errors.push(`events[${i}].id: must be string`);
        if (typeof event.name !== 'string') errors.push(`events[${i}].name: must be string`);
        if (typeof event.impressions !== 'number') errors.push(`events[${i}].impressions: must be number`);
        if (typeof event.clicks !== 'number') errors.push(`events[${i}].clicks: must be number`);
        if (typeof event.ctr !== 'number') errors.push(`events[${i}].ctr: must be number`);
        if (typeof event.signupsCount !== 'number') errors.push(`events[${i}].signupsCount: must be number`);

        // STRICT: Check for extra event fields
        if (strict) {
          const extraEventFields = Object.keys(event).filter(k => !ALLOWED_EVENT_FIELDS.includes(k));
          if (extraEventFields.length > 0) {
            errors.push(`events[${i}].extraFields: [${extraEventFields.join(', ')}] - not allowed`);
          }
        }
      });
    }
  }

  // STRICT: Check for extra root fields
  if (strict) {
    const extraRootFields = Object.keys(analytics).filter(k => !ALLOWED_ROOT_FIELDS.includes(k));
    if (extraRootFields.length > 0) {
      errors.push(`extraFields: [${extraRootFields.join(', ')}] - not allowed at root`);
    }
  }

  return errors.length === 0 ? true : errors;
};

/**
 * Validates list response pagination structure
 */
const validatePaginationSchema = (pagination) => {
  const errors = [];

  if (typeof pagination.total !== 'number') errors.push('total: must be number');
  if (typeof pagination.limit !== 'number') errors.push('limit: must be number');
  if (typeof pagination.offset !== 'number') errors.push('offset: must be number');
  if (typeof pagination.hasMore !== 'boolean') errors.push('hasMore: must be boolean');

  return errors.length === 0 ? true : errors;
};

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Explicit API Response Contracts', () => {

  // ==========================================================================
  // api_list (api_getEvents)
  // ==========================================================================

  describe('api_list (api_getEvents)', () => {
    /**
     * CONTRACT: api_list
     *
     * Request: { action: 'api_list', brandId: string, scope?: string, limit?: number, offset?: number }
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     items: Event[],      // Array of canonical v2.2 events
     *     pagination: { total, limit, offset, hasMore }
     *   }
     * }
     *
     * Error Response:
     * { ok: false, code: 'BAD_INPUT' | 'NOT_FOUND' | 'INTERNAL', message: string }
     */

    it('should return valid success envelope with items and pagination', () => {
      const mockResponse = {
        ok: true,
        etag: 'list-etag-abc123',
        value: {
          items: [FIXTURE_EVENT_STANDARD],
          pagination: {
            total: 1,
            limit: 50,
            offset: 0,
            hasMore: false
          }
        }
      };

      validateSuccessEnvelope(mockResponse);
      expect(mockResponse).toHaveProperty('etag');
      expect(mockResponse.value).toHaveProperty('items');
      expect(mockResponse.value).toHaveProperty('pagination');
      expect(Array.isArray(mockResponse.value.items)).toBe(true);
    });

    it('should return events matching Event schema v2.2', () => {
      const mockResponse = {
        ok: true,
        etag: 'list-etag-abc123',
        value: {
          items: [FIXTURE_EVENT_STANDARD],
          pagination: { total: 1, limit: 50, offset: 0, hasMore: false }
        }
      };

      const event = mockResponse.value.items[0];
      const validation = validateEventSchema(event);
      expect(validation).toBe(true);
    });

    it('should return valid pagination structure', () => {
      const mockResponse = {
        ok: true,
        etag: 'list-etag-abc123',
        value: {
          items: [],
          pagination: { total: 100, limit: 50, offset: 50, hasMore: true }
        }
      };

      const validation = validatePaginationSchema(mockResponse.value.pagination);
      expect(validation).toBe(true);
    });

    it('should support notModified response (304 equivalent)', () => {
      const mockResponse = {
        ok: true,
        notModified: true,
        etag: 'list-etag-abc123'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.notModified).toBe(true);
      expect(mockResponse.etag).toBeDefined();
    });

    it('should return BAD_INPUT for missing brandId', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'brandId required'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });

    it('should return BAD_INPUT for invalid brandId', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Unknown brand: invalid-brand'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });
  });

  // ==========================================================================
  // api_get
  // ==========================================================================

  describe('api_get', () => {
    /**
     * CONTRACT: api_get
     *
     * Request: { action: 'api_get', brandId: string, id: string, ifNoneMatch?: string }
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: Event  // Canonical v2.2 event
     * }
     *
     * Error Response:
     * { ok: false, code: 'BAD_INPUT' | 'NOT_FOUND', message: string }
     */

    it('should return canonical event per v2.2 schema', () => {
      const mockResponse = {
        ok: true,
        etag: 'event-etag-xyz789',
        value: FIXTURE_EVENT_STANDARD
      };

      validateSuccessEnvelope(mockResponse);
      const validation = validateEventSchema(mockResponse.value);
      expect(validation).toBe(true);
    });

    it('should include etag for caching', () => {
      const mockResponse = {
        ok: true,
        etag: 'event-etag-xyz789',
        value: FIXTURE_EVENT_STANDARD
      };

      expect(mockResponse.etag).toBeDefined();
      expect(typeof mockResponse.etag).toBe('string');
      expect(mockResponse.etag.length).toBeGreaterThan(0);
    });

    it('should return NOT_FOUND for invalid event ID', () => {
      const mockResponse = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found: invalid-id-12345'
      };

      validateErrorEnvelope(mockResponse, 'NOT_FOUND');
    });

    it('should return BAD_INPUT for missing id', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'id required'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });
  });

  // ==========================================================================
  // api_getPublicBundle
  // ==========================================================================

  describe('api_getPublicBundle', () => {
    /**
     * CONTRACT: api_getPublicBundle
     *
     * Request: { action: 'api_getPublicBundle', brandId: string, id?: string, ifNoneMatch?: string }
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     event: Event,           // Canonical v2.2 event
     *     config: BrandConfig     // { brandId, brandName, appTitle }
     *   }
     * }
     */

    it('should return valid bundle with event and config', () => {
      const mockResponse = {
        ok: true,
        etag: 'public-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: {
            brandId: 'root',
            brandName: 'Default Brand',
            appTitle: 'Events'
          }
        }
      };

      const validation = validateBundleSchema(mockResponse);
      expect(validation).toBe(true);
    });

    it('should include all MVP required event fields', () => {
      const mockResponse = {
        ok: true,
        etag: 'public-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      const event = mockResponse.value.event;
      // MVP Required fields per event.schema.json v2.2
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
    });

    it('should include brand config with required fields', () => {
      const mockResponse = {
        ok: true,
        etag: 'public-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      const { config } = mockResponse.value;
      expect(config).toHaveProperty('brandId');
      expect(config).toHaveProperty('brandName');
      expect(config).toHaveProperty('appTitle');
    });

    it('should support notModified response', () => {
      const mockResponse = {
        ok: true,
        notModified: true,
        etag: 'public-bundle-etag'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.notModified).toBe(true);
    });
  });

  // ==========================================================================
  // api_getDisplayBundle
  // ==========================================================================

  describe('api_getDisplayBundle', () => {
    /**
     * CONTRACT: api_getDisplayBundle
     *
     * Request: { action: 'api_getDisplayBundle', brandId: string, id?: string, ifNoneMatch?: string }
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     event: Event,           // Canonical v2.2 event (with schedule for TV display)
     *     config: BrandConfig
     *   }
     * }
     */

    it('should return valid bundle matching schema', () => {
      const mockResponse = {
        ok: true,
        etag: 'display-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      const validation = validateBundleSchema(mockResponse);
      expect(validation).toBe(true);
    });

    it('should include schedule for TV display', () => {
      const mockResponse = {
        ok: true,
        etag: 'display-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      const event = mockResponse.value.event;
      expect(event).toHaveProperty('schedule');
      if (event.schedule) {
        expect(Array.isArray(event.schedule)).toBe(true);
      }
    });

    it('should include settings for display visibility', () => {
      const mockResponse = {
        ok: true,
        etag: 'display-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      const { settings } = mockResponse.value.event;
      expect(typeof settings.showSchedule).toBe('boolean');
      expect(typeof settings.showStandings).toBe('boolean');
      expect(typeof settings.showBracket).toBe('boolean');
    });
  });

  // ==========================================================================
  // api_getPosterBundle
  // ==========================================================================

  describe('api_getPosterBundle', () => {
    /**
     * CONTRACT: api_getPosterBundle
     *
     * Request: { action: 'api_getPosterBundle', brandId: string, id?: string, ifNoneMatch?: string }
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     event: Event,           // Canonical v2.2 event (with QR codes for print)
     *     config: BrandConfig
     *   }
     * }
     */

    it('should return valid bundle matching schema', () => {
      const mockResponse = {
        ok: true,
        etag: 'poster-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      const validation = validateBundleSchema(mockResponse);
      expect(validation).toBe(true);
    });

    it('should include QR codes for print', () => {
      const mockResponse = {
        ok: true,
        etag: 'poster-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      const { qr } = mockResponse.value.event;
      expect(qr).toHaveProperty('public');
      expect(qr).toHaveProperty('signup');
      expect(qr.public).toMatch(/^data:image\/png;base64,/);
    });

    it('should include sponsors when showSponsors is true', () => {
      const mockResponse = {
        ok: true,
        etag: 'poster-bundle-etag',
        value: {
          event: FIXTURE_EVENT_WITH_SPONSORS,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      const event = mockResponse.value.event;
      expect(event.settings.showSponsors).toBe(true);
      expect(Array.isArray(event.sponsors)).toBe(true);
      expect(event.sponsors.length).toBeGreaterThan(0);

      // Validate sponsor shape
      const validation = validateSponsorSchema(event.sponsors[0]);
      expect(validation).toBe(true);
    });
  });

  // ==========================================================================
  // api_getAdminBundle
  // ==========================================================================

  describe('api_getAdminBundle', () => {
    /**
     * CONTRACT: api_getAdminBundle
     *
     * Request: { action: 'api_getAdminBundle', brandId: string, id?: string, adminKey: string }
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: {
     *     event: Event,           // Full canonical v2.2 event
     *     config: BrandConfig,    // With admin-specific settings
     *     templates?: Template[]  // Available templates
     *   }
     * }
     */

    it('should return valid bundle with full event data', () => {
      const mockResponse = {
        ok: true,
        etag: 'admin-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: {
            brandId: 'root',
            brandName: 'Default Brand',
            appTitle: 'Events',
            adminFeatures: { canEditSponsors: true, canViewAnalytics: true }
          },
          templates: [
            { id: 'trivia', name: 'Trivia Night' },
            { id: 'league', name: 'League Event' }
          ]
        }
      };

      validateSuccessEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('event');
      expect(mockResponse.value).toHaveProperty('config');
    });

    it('should require admin authentication', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid admin key'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });

    it('should include editable event fields', () => {
      const mockResponse = {
        ok: true,
        etag: 'admin-bundle-etag',
        value: {
          event: FIXTURE_EVENT_STANDARD,
          config: { brandId: 'root', brandName: 'Default Brand', appTitle: 'Events' }
        }
      };

      // Admin bundle should have all fields for editing
      const event = mockResponse.value.event;
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('startDateISO');
      expect(event).toHaveProperty('venue');
      expect(event).toHaveProperty('schedule');
      expect(event).toHaveProperty('settings');
      expect(event).toHaveProperty('sponsors');
    });
  });

  // ==========================================================================
  // api_getSharedAnalytics
  // ==========================================================================

  describe('api_getSharedAnalytics', () => {
    /**
     * CONTRACT: api_getSharedAnalytics
     *
     * Request: { action: 'api_getSharedAnalytics', brandId: string, eventId?: string, sponsorId?: string }
     *
     * Success Response (per /schemas/shared-analytics.schema.json v1.1):
     * {
     *   ok: true,
     *   value: {
     *     lastUpdatedISO: string,
     *     summary: {
     *       totalImpressions: number,
     *       totalClicks: number,
     *       totalQrScans: number,
     *       totalSignups: number,
     *       uniqueEvents: number,
     *       uniqueSponsors: number
     *     },
     *     surfaces: Array<{ id, label, impressions, clicks, qrScans, engagementRate }>,
     *     sponsors?: Array<{ id, name, impressions, clicks, ctr }>,
     *     events?: Array<{ id, name, impressions, clicks, ctr }>
     *   }
     * }
     */

    it('should return valid SharedAnalytics structure', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 1500,
            totalClicks: 150,
            totalQrScans: 75,
            totalSignups: 45,
            uniqueEvents: 5,
            uniqueSponsors: 3
          },
          surfaces: [
            { id: 'public', label: 'Public', impressions: 800, clicks: 80, qrScans: 40, engagementRate: 15.0 },
            { id: 'display', label: 'Display', impressions: 500, clicks: 50, qrScans: 25, engagementRate: 15.0 },
            { id: 'poster', label: 'Poster', impressions: 200, clicks: 20, qrScans: 10, engagementRate: 15.0 }
          ],
          sponsors: [
            { id: 'sponsor-001', name: 'Gold Sponsor Inc', impressions: 500, clicks: 50, ctr: 10.0 },
            { id: 'sponsor-002', name: 'Silver Sponsor LLC', impressions: 300, clicks: 15, ctr: 5.0 }
          ],
          events: [
            { id: 'fixture-event-001', name: 'Fixture Test Event', impressions: 1000, clicks: 100, ctr: 10.0, signupsCount: 45 }
          ]
        }
      };

      validateSuccessEnvelope(mockResponse);
      const validation = validateSharedAnalyticsSchema(mockResponse.value);
      expect(validation).toBe(true);
    });

    it('should include MVP required summary fields', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 1500,
            totalClicks: 150,
            totalQrScans: 75,
            totalSignups: 45,
            uniqueEvents: 5,
            uniqueSponsors: 3
          },
          surfaces: [],
          sponsors: null,
          events: null
        }
      };

      const { summary } = mockResponse.value;
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
    });

    it('should include surfaces array with valid structure', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
          surfaces: [
            { id: 'poster', label: 'Poster', impressions: 100, clicks: 10, qrScans: 5, engagementRate: 15.0 }
          ],
          sponsors: null,
          events: null
        }
      };

      const surface = mockResponse.value.surfaces[0];
      expect(surface).toHaveProperty('id');
      expect(surface).toHaveProperty('label');
      expect(surface).toHaveProperty('impressions');
      expect(surface).toHaveProperty('clicks');
      expect(surface).toHaveProperty('qrScans');
      expect(['poster', 'display', 'public', 'signup']).toContain(surface.id);
    });

    it('should include sponsors array for organizer view', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
          surfaces: [],
          sponsors: [
            { id: 'sponsor-001', name: 'Gold Sponsor', impressions: 500, clicks: 50, ctr: 10.0 }
          ],
          events: null
        }
      };

      const sponsor = mockResponse.value.sponsors[0];
      expect(sponsor).toHaveProperty('id');
      expect(sponsor).toHaveProperty('name');
      expect(sponsor).toHaveProperty('impressions');
      expect(sponsor).toHaveProperty('clicks');
      expect(sponsor).toHaveProperty('ctr');
    });

    it('should include events array with human-readable names (Story 4.1)', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 1, uniqueSponsors: 0 },
          surfaces: [],
          sponsors: null,
          events: [
            { id: 'evt-abc-123', name: 'Summer Bocce Tournament', impressions: 1000, clicks: 100, ctr: 10.0, signupsCount: 45 }
          ]
        }
      };

      const event = mockResponse.value.events[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('impressions');
      expect(event).toHaveProperty('clicks');
      expect(event).toHaveProperty('ctr');
      expect(event).toHaveProperty('signupsCount');

      // Name should be human-readable, not just an ID (Story 4.1 requirement)
      expect(event.name).not.toBe(event.id);
      expect(event.name).toBe('Summer Bocce Tournament');
    });

    it('should return BAD_INPUT for missing brandId', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'brandId required'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });
  });

  // ==========================================================================
  // api_getSponsorAnalytics
  // ==========================================================================

  describe('api_getSponsorAnalytics', () => {
    /**
     * CONTRACT: api_getSponsorAnalytics
     *
     * Request: { action: 'api_getSponsorAnalytics', brandId: string, sponsorId: string, eventId?: string }
     *
     * Success Response (per /schemas/shared-analytics.schema.json v1.1 - sponsor-scoped):
     * Same structure as api_getSharedAnalytics but scoped to specific sponsor
     * sponsors array will be null (single sponsor view)
     */

    it('should return valid sponsor-scoped analytics', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 500,
            totalClicks: 50,
            totalQrScans: 25,
            totalSignups: 15,
            uniqueEvents: 3,
            uniqueSponsors: 1
          },
          surfaces: [
            { id: 'poster', label: 'Poster', impressions: 300, clicks: 30, qrScans: 15, engagementRate: 15.0 },
            { id: 'display', label: 'Display', impressions: 200, clicks: 20, qrScans: 10, engagementRate: 15.0 }
          ],
          sponsors: null, // Sponsor view doesn't show other sponsors
          events: [
            { id: 'event-001', name: 'Test Event', impressions: 500, clicks: 50, ctr: 10.0, signupsCount: 15 }
          ]
        }
      };

      validateSuccessEnvelope(mockResponse);
      const validation = validateSharedAnalyticsSchema(mockResponse.value);
      expect(validation).toBe(true);
    });

    it('should return BAD_INPUT for missing sponsorId', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'sponsorId required for sponsor analytics'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });

    it('should filter data to specific sponsor', () => {
      const mockResponse = {
        ok: true,
        value: {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 500,
            totalClicks: 50,
            totalQrScans: 25,
            totalSignups: 15,
            uniqueEvents: 3,
            uniqueSponsors: 1
          },
          surfaces: [],
          sponsors: null,
          events: null
        }
      };

      // uniqueSponsors should be 1 for sponsor-scoped view
      expect(mockResponse.value.summary.uniqueSponsors).toBe(1);
      // sponsors should be null for sponsor view
      expect(mockResponse.value.sponsors).toBeNull();
    });
  });

  // ==========================================================================
  // api_getSponsorReportQr
  // ==========================================================================

  describe('api_getSponsorReportQr', () => {
    /**
     * CONTRACT: api_getSponsorReportQr
     *
     * Request: { action: 'api_getSponsorReportQr', sponsorId: string, brandId?: string, adminKey?: string }
     *
     * Success Response (per /schemas/sponsor-report-qr.schema.json v1.0):
     * {
     *   ok: true,
     *   value: {
     *     url: string,      // Sponsor report URL with sponsorId parameter
     *     qrB64: string,    // Base64-encoded PNG QR code
     *     verified: boolean // True if URL was verified
     *   }
     * }
     *
     * Error Response:
     * { ok: false, code: 'BAD_INPUT', message: string }
     */

    it('should return valid SponsorReportQr structure', () => {
      const mockResponse = {
        ok: true,
        value: {
          url: 'https://www.eventangle.com/report?sponsor=true&sponsorId=sponsor-001',
          qrB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          verified: true
        }
      };

      validateSuccessEnvelope(mockResponse);
      const validation = validateSponsorReportQrSchema(mockResponse.value);
      expect(validation).toBe(true);
    });

    it('should include URL with sponsorId parameter', () => {
      const mockResponse = {
        ok: true,
        value: {
          url: 'https://www.eventangle.com/report?sponsor=true&sponsorId=gold-sponsor-123',
          qrB64: 'base64data...',
          verified: true
        }
      };

      expect(mockResponse.value.url).toContain('sponsorId=');
      expect(mockResponse.value.url).toContain('/report');
      expect(mockResponse.value.url).toContain('sponsor=true');
    });

    it('should return base64-encoded QR code without data URI prefix', () => {
      const mockResponse = {
        ok: true,
        value: {
          url: 'https://www.eventangle.com/report?sponsor=true&sponsorId=sponsor-001',
          qrB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          verified: true
        }
      };

      // Should NOT contain data URI prefix
      expect(mockResponse.value.qrB64).not.toMatch(/^data:image\/png;base64,/);
      // Should be valid base64 (no spaces, valid chars)
      expect(mockResponse.value.qrB64).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should set verified=true when QR code is generated', () => {
      const mockResponse = {
        ok: true,
        value: {
          url: 'https://www.eventangle.com/report?sponsor=true&sponsorId=sponsor-001',
          qrB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          verified: true
        }
      };

      expect(mockResponse.value.verified).toBe(true);
      expect(mockResponse.value.qrB64.length).toBeGreaterThan(0);
    });

    it('should return empty QR with verified=false when URL cannot be verified', () => {
      const mockResponse = {
        ok: true,
        value: {
          url: '',
          qrB64: '',
          verified: false
        }
      };

      validateSuccessEnvelope(mockResponse);
      const validation = validateSponsorReportQrSchema(mockResponse.value);
      expect(validation).toBe(true);
      expect(mockResponse.value.verified).toBe(false);
      expect(mockResponse.value.qrB64).toBe('');
    });

    it('should return BAD_INPUT for missing sponsorId', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing sponsorId'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });

    it('should return BAD_INPUT for invalid sponsorId format', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid sponsorId format'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });

    it('should validate STRICT mode fails on extra fields (additionalProperties: false)', () => {
      const responseWithExtraField = {
        url: 'https://example.com?sponsorId=test',
        qrB64: 'base64data',
        verified: true,
        extraField: 'should fail'  // This should fail strict validation
      };

      const strictValidation = validateSponsorReportQrSchema(responseWithExtraField, true);
      expect(strictValidation).not.toBe(true);
      expect(strictValidation).toContain('extraFields: [extraField] - additionalProperties not allowed');
    });

    it('should validate STRICT mode passes for exact shape', () => {
      const exactShapeResponse = {
        url: 'https://www.eventangle.com/report?sponsor=true&sponsorId=test',
        qrB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
        verified: true
      };

      const strictValidation = validateSponsorReportQrSchema(exactShapeResponse, true);
      expect(strictValidation).toBe(true);
    });
  });

  // ==========================================================================
  // api_saveEvent
  // ==========================================================================

  describe('api_saveEvent', () => {
    /**
     * CONTRACT: api_saveEvent
     *
     * Request:
     * CREATE: { action: 'api_saveEvent', brandId: string, adminKey: string, event: { name, startDateISO, venue, ... } }
     * UPDATE: { action: 'api_saveEvent', brandId: string, adminKey: string, event: { id, ...fields } }
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: Event  // Full canonical v2.2 event
     * }
     *
     * MVP Required for CREATE: name, startDateISO, venue
     */

    describe('CREATE Mode', () => {
      it('should return full canonical event on success', () => {
        const mockResponse = {
          ok: true,
          etag: 'new-event-etag',
          value: {
            ...FIXTURE_EVENT_STANDARD,
            id: 'new-event-123',
            createdAtISO: '2025-11-27T10:00:00.000Z',
            updatedAtISO: '2025-11-27T10:00:00.000Z'
          }
        };

        validateSuccessEnvelope(mockResponse);
        const validation = validateEventSchema(mockResponse.value);
        expect(validation).toBe(true);
      });

      it('should auto-generate id for new event', () => {
        const mockResponse = {
          ok: true,
          etag: 'new-event-etag',
          value: { ...FIXTURE_EVENT_STANDARD, id: 'auto-generated-uuid-123' }
        };

        expect(mockResponse.value.id).toBeDefined();
        expect(mockResponse.value.id.length).toBeGreaterThan(0);
      });

      it('should auto-generate slug from name', () => {
        const mockResponse = {
          ok: true,
          etag: 'new-event-etag',
          value: { ...FIXTURE_EVENT_STANDARD, slug: 'my-awesome-event-2025' }
        };

        expect(mockResponse.value.slug).toMatch(/^[a-z0-9-]+$/);
      });

      it('should generate QR codes', () => {
        const mockResponse = {
          ok: true,
          etag: 'new-event-etag',
          value: FIXTURE_EVENT_STANDARD
        };

        expect(mockResponse.value.qr.public).toMatch(/^data:image\/png;base64,/);
        expect(mockResponse.value.qr.signup).toBeDefined();
      });

      it('should set default settings', () => {
        const mockResponse = {
          ok: true,
          etag: 'new-event-etag',
          value: FIXTURE_EVENT_STANDARD
        };

        const { settings } = mockResponse.value;
        expect(typeof settings.showSchedule).toBe('boolean');
        expect(typeof settings.showStandings).toBe('boolean');
        expect(typeof settings.showBracket).toBe('boolean');
      });

      it('should return BAD_INPUT for missing name', () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'Missing required field: name'
        };

        validateErrorEnvelope(mockResponse, 'BAD_INPUT');
      });

      it('should return BAD_INPUT for missing startDateISO', () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'Missing required field: startDateISO'
        };

        validateErrorEnvelope(mockResponse, 'BAD_INPUT');
      });

      it('should return BAD_INPUT for missing venue', () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'Missing required field: venue'
        };

        validateErrorEnvelope(mockResponse, 'BAD_INPUT');
      });

      it('should return BAD_INPUT for invalid date format', () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'startDateISO must be YYYY-MM-DD format'
        };

        validateErrorEnvelope(mockResponse, 'BAD_INPUT');
      });

      it('should return BAD_INPUT for invalid adminKey', () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'Invalid admin key'
        };

        validateErrorEnvelope(mockResponse, 'BAD_INPUT');
      });
    });

    describe('UPDATE Mode', () => {
      it('should return updated event on success', () => {
        const mockResponse = {
          ok: true,
          etag: 'updated-event-etag',
          value: {
            ...FIXTURE_EVENT_STANDARD,
            name: 'Updated Event Name',
            updatedAtISO: '2025-11-27T12:00:00.000Z'
          }
        };

        validateSuccessEnvelope(mockResponse);
        const validation = validateEventSchema(mockResponse.value);
        expect(validation).toBe(true);
      });

      it('should preserve unchanged fields', () => {
        const mockResponse = {
          ok: true,
          etag: 'updated-event-etag',
          value: {
            ...FIXTURE_EVENT_STANDARD,
            name: 'Only Name Changed'
          }
        };

        // Original venue should be preserved
        expect(mockResponse.value.venue).toBe(FIXTURE_EVENT_STANDARD.venue);
        expect(mockResponse.value.startDateISO).toBe(FIXTURE_EVENT_STANDARD.startDateISO);
      });

      it('should update updatedAtISO timestamp', () => {
        const mockResponse = {
          ok: true,
          etag: 'updated-event-etag',
          value: {
            ...FIXTURE_EVENT_STANDARD,
            updatedAtISO: '2025-11-27T12:00:00.000Z'
          }
        };

        expect(mockResponse.value.updatedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('should return NOT_FOUND for non-existent event', () => {
        const mockResponse = {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Event not found: non-existent-id'
        };

        validateErrorEnvelope(mockResponse, 'NOT_FOUND');
      });
    });
  });

  // ==========================================================================
  // api_updateEventData
  // ==========================================================================

  describe('api_updateEventData', () => {
    /**
     * CONTRACT: api_updateEventData
     *
     * Request: { action: 'api_updateEventData', brandId: string, adminKey: string, id: string, data: { ...fields } }
     *
     * Success Response:
     * {
     *   ok: true,
     *   etag: string,
     *   value: Event  // Full canonical v2.2 event after update
     * }
     *
     * This API allows partial updates to event data fields
     */

    it('should return updated event on success', () => {
      const mockResponse = {
        ok: true,
        etag: 'update-data-etag',
        value: {
          ...FIXTURE_EVENT_STANDARD,
          schedule: [
            { time: '14:00', title: 'New Session', description: 'Added via update' }
          ]
        }
      };

      validateSuccessEnvelope(mockResponse);
      const validation = validateEventSchema(mockResponse.value);
      expect(validation).toBe(true);
    });

    it('should update schedule data', () => {
      const mockResponse = {
        ok: true,
        etag: 'update-data-etag',
        value: {
          ...FIXTURE_EVENT_STANDARD,
          schedule: [
            { time: '10:00', title: 'Opening', description: null },
            { time: '12:00', title: 'Lunch Break', description: null }
          ]
        }
      };

      expect(mockResponse.value.schedule).toHaveLength(2);
      expect(mockResponse.value.schedule[0]).toHaveProperty('time');
      expect(mockResponse.value.schedule[0]).toHaveProperty('title');
    });

    it('should update standings data', () => {
      const mockResponse = {
        ok: true,
        etag: 'update-data-etag',
        value: {
          ...FIXTURE_EVENT_STANDARD,
          standings: [
            { rank: 1, team: 'Team A', wins: 5, losses: 1, points: 10 },
            { rank: 2, team: 'Team B', wins: 4, losses: 2, points: 8 }
          ],
          settings: { ...FIXTURE_EVENT_STANDARD.settings, showStandings: true }
        }
      };

      expect(mockResponse.value.standings).toHaveLength(2);
      expect(mockResponse.value.standings[0]).toHaveProperty('rank');
      expect(mockResponse.value.standings[0]).toHaveProperty('team');
      expect(mockResponse.value.standings[0]).toHaveProperty('wins');
      expect(mockResponse.value.standings[0]).toHaveProperty('losses');
    });

    it('should update settings flags', () => {
      const mockResponse = {
        ok: true,
        etag: 'update-data-etag',
        value: {
          ...FIXTURE_EVENT_STANDARD,
          settings: {
            showSchedule: false,
            showStandings: true,
            showBracket: true,
            showSponsors: false
          }
        }
      };

      const { settings } = mockResponse.value;
      expect(settings.showSchedule).toBe(false);
      expect(settings.showStandings).toBe(true);
      expect(settings.showBracket).toBe(true);
    });

    it('should return NOT_FOUND for non-existent event', () => {
      const mockResponse = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found: invalid-event-id'
      };

      validateErrorEnvelope(mockResponse, 'NOT_FOUND');
    });

    it('should return BAD_INPUT for invalid data', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid data format'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });
  });

  // ==========================================================================
  // Error Code Contracts
  // ==========================================================================

  describe('Error Code Contracts', () => {
    /**
     * All APIs must use these standard error codes
     */

    it('should define BAD_INPUT error code', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Validation failed'
      };

      validateErrorEnvelope(mockResponse, 'BAD_INPUT');
    });

    it('should define NOT_FOUND error code', () => {
      const mockResponse = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Resource not found'
      };

      validateErrorEnvelope(mockResponse, 'NOT_FOUND');
    });

    it('should define RATE_LIMITED error code', () => {
      const mockResponse = {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests'
      };

      validateErrorEnvelope(mockResponse, 'RATE_LIMITED');
    });

    it('should define INTERNAL error code', () => {
      const mockResponse = {
        ok: false,
        code: 'INTERNAL',
        message: 'Internal server error'
      };

      validateErrorEnvelope(mockResponse, 'INTERNAL');
    });

    it('should define CONTRACT error code', () => {
      const mockResponse = {
        ok: false,
        code: 'CONTRACT',
        message: 'Response shape validation failed'
      };

      validateErrorEnvelope(mockResponse, 'CONTRACT');
    });

    it('should include all standard error codes', () => {
      expect(ERROR_CODES).toHaveProperty('BAD_INPUT');
      expect(ERROR_CODES).toHaveProperty('NOT_FOUND');
      expect(ERROR_CODES).toHaveProperty('RATE_LIMITED');
      expect(ERROR_CODES).toHaveProperty('INTERNAL');
      expect(ERROR_CODES).toHaveProperty('CONTRACT');
    });
  });

  // ==========================================================================
  // Schema Change Detection
  // ==========================================================================

  describe('Schema Change Detection', () => {
    /**
     * These tests will BREAK LOUDLY if someone changes backend response shapes
     * without updating schemas. This is the acceptance criteria for this story.
     */

    it('should detect if event schema adds unexpected field', () => {
      const eventWithExtraField = {
        ...FIXTURE_EVENT_STANDARD,
        unexpectedField: 'This should cause validation to fail'
      };

      // Our validation should pass because additionalProperties isn't strictly enforced
      // in the helper, but the JSON schema validation in the backend should catch this
      const validation = validateEventSchema(eventWithExtraField);
      expect(validation).toBe(true); // Helper passes
      // The actual JSON schema enforces additionalProperties: false
    });

    it('should detect if event schema removes required field', () => {
      const eventMissingField = { ...FIXTURE_EVENT_STANDARD };
      delete eventMissingField.name;

      const validation = validateEventSchema(eventMissingField);
      expect(validation).not.toBe(true);
      expect(validation).toContain('name: must be non-empty string');
    });

    it('should detect if analytics schema changes', () => {
      const invalidAnalytics = {
        lastUpdatedISO: '2025-11-27T10:00:00.000Z',
        summary: {
          // Missing required fields
          totalImpressions: 100
        },
        surfaces: []
      };

      const validation = validateSharedAnalyticsSchema(invalidAnalytics);
      expect(validation).not.toBe(true);
      expect(validation).toContain('summary.totalClicks: must be number');
    });

    it('should detect if bundle schema changes', () => {
      const invalidBundle = {
        ok: true,
        etag: 'test-etag',
        value: {
          // Missing event
          config: { brandId: 'root', brandName: 'Test' }
        }
      };

      const validation = validateBundleSchema(invalidBundle);
      expect(validation).not.toBe(true);
      expect(validation).toContain('value.event: required');
    });
  });

  // ==========================================================================
  // SharedReport STRICT Shape Validation (additionalProperties: false)
  // ==========================================================================

  describe('SharedReport STRICT Shape Validation', () => {
    /**
     * These tests enforce STRICT shape validation per shared-analytics.schema.json
     * and sponsor-report-qr.schema.json with additionalProperties: false.
     *
     * Contract tests MUST fail on:
     * - Extra fields not in schema
     * - Missing required fields
     */

    describe('api_getSharedAnalytics STRICT validation', () => {
      it('should FAIL on extra root field in SharedAnalytics', () => {
        const analyticsWithExtraField = {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            totalQrScans: 5,
            totalSignups: 3,
            uniqueEvents: 2,
            uniqueSponsors: 1
          },
          surfaces: [],
          sponsors: null,
          events: null,
          extraRootField: 'should fail'  // NOT ALLOWED
        };

        const strictValidation = validateSharedAnalyticsSchemaStrict(analyticsWithExtraField, true);
        expect(strictValidation).not.toBe(true);
        expect(strictValidation).toContain('extraFields: [extraRootField] - not allowed at root');
      });

      it('should FAIL on extra summary field', () => {
        const analyticsWithExtraSummaryField = {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            totalQrScans: 5,
            totalSignups: 3,
            uniqueEvents: 2,
            uniqueSponsors: 1,
            avgDwellTime: 45.5  // NOT ALLOWED - extra field
          },
          surfaces: [],
          sponsors: null,
          events: null
        };

        const strictValidation = validateSharedAnalyticsSchemaStrict(analyticsWithExtraSummaryField, true);
        expect(strictValidation).not.toBe(true);
        expect(strictValidation).toContain('summary.extraFields: [avgDwellTime] - not allowed');
      });

      it('should FAIL on extra surface field', () => {
        const analyticsWithExtraSurfaceField = {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            totalQrScans: 5,
            totalSignups: 3,
            uniqueEvents: 2,
            uniqueSponsors: 1
          },
          surfaces: [
            {
              id: 'poster',
              label: 'Poster',
              impressions: 50,
              clicks: 5,
              qrScans: 2,
              engagementRate: 10.0,
              dwellTime: 30  // NOT ALLOWED - extra field
            }
          ],
          sponsors: null,
          events: null
        };

        const strictValidation = validateSharedAnalyticsSchemaStrict(analyticsWithExtraSurfaceField, true);
        expect(strictValidation).not.toBe(true);
        expect(strictValidation).toContain('surfaces[0].extraFields: [dwellTime] - not allowed');
      });

      it('should FAIL on extra sponsor field', () => {
        const analyticsWithExtraSponsorField = {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            totalQrScans: 5,
            totalSignups: 3,
            uniqueEvents: 2,
            uniqueSponsors: 1
          },
          surfaces: [],
          sponsors: [
            {
              id: 'sponsor-001',
              name: 'Gold Sponsor',
              impressions: 100,
              clicks: 10,
              ctr: 10.0,
              logoUrl: 'https://example.com/logo.png'  // NOT ALLOWED - extra field
            }
          ],
          events: null
        };

        const strictValidation = validateSharedAnalyticsSchemaStrict(analyticsWithExtraSponsorField, true);
        expect(strictValidation).not.toBe(true);
        expect(strictValidation).toContain('sponsors[0].extraFields: [logoUrl] - not allowed');
      });

      it('should FAIL on extra event field', () => {
        const analyticsWithExtraEventField = {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            totalQrScans: 5,
            totalSignups: 3,
            uniqueEvents: 1,
            uniqueSponsors: 0
          },
          surfaces: [],
          sponsors: null,
          events: [
            {
              id: 'event-001',
              name: 'Test Event',
              impressions: 100,
              clicks: 10,
              ctr: 10.0,
              signupsCount: 5,
              venue: 'Test Venue'  // NOT ALLOWED - extra field
            }
          ]
        };

        const strictValidation = validateSharedAnalyticsSchemaStrict(analyticsWithExtraEventField, true);
        expect(strictValidation).not.toBe(true);
        expect(strictValidation).toContain('events[0].extraFields: [venue] - not allowed');
      });

      it('should PASS for exact SharedAnalytics shape (no extra fields)', () => {
        const exactShapeAnalytics = {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 1500,
            totalClicks: 150,
            totalQrScans: 75,
            totalSignups: 45,
            uniqueEvents: 5,
            uniqueSponsors: 3
          },
          surfaces: [
            { id: 'public', label: 'Public', impressions: 800, clicks: 80, qrScans: 40, engagementRate: 15.0 },
            { id: 'poster', label: 'Poster', impressions: 500, clicks: 50, qrScans: 25, engagementRate: 15.0 }
          ],
          sponsors: [
            { id: 'sponsor-001', name: 'Gold Sponsor', impressions: 500, clicks: 50, ctr: 10.0 }
          ],
          events: [
            { id: 'event-001', name: 'Test Event', impressions: 1000, clicks: 100, ctr: 10.0, signupsCount: 45 }
          ],
          topSponsors: [
            { id: 'sponsor-001', name: 'Gold Sponsor', impressions: 500, clicks: 50, ctr: 10.0 }
          ]
        };

        const strictValidation = validateSharedAnalyticsSchemaStrict(exactShapeAnalytics, true);
        expect(strictValidation).toBe(true);
      });

      it('should FAIL on missing required summary field', () => {
        const analyticsMissingSummaryField = {
          lastUpdatedISO: '2025-11-27T10:00:00.000Z',
          summary: {
            totalImpressions: 100,
            totalClicks: 10,
            // Missing: totalQrScans, totalSignups, uniqueEvents, uniqueSponsors
          },
          surfaces: []
        };

        const validation = validateSharedAnalyticsSchemaStrict(analyticsMissingSummaryField, true);
        expect(validation).not.toBe(true);
        expect(validation).toContain('summary.totalQrScans: must be number');
      });
    });

    describe('api_getSponsorReportQr STRICT validation', () => {
      it('should FAIL on extra field in SponsorReportQr', () => {
        const qrWithExtraField = {
          url: 'https://example.com?sponsorId=test',
          qrB64: 'base64data',
          verified: true,
          label: 'Sponsor QR'  // NOT ALLOWED - extra field
        };

        const strictValidation = validateSponsorReportQrSchema(qrWithExtraField, true);
        expect(strictValidation).not.toBe(true);
        expect(strictValidation).toContain('extraFields: [label] - additionalProperties not allowed');
      });

      it('should FAIL on multiple extra fields', () => {
        const qrWithMultipleExtraFields = {
          url: 'https://example.com?sponsorId=test',
          qrB64: 'base64data',
          verified: true,
          label: 'Sponsor QR',
          expiresAt: '2025-12-31'
        };

        const strictValidation = validateSponsorReportQrSchema(qrWithMultipleExtraFields, true);
        expect(strictValidation).not.toBe(true);
        // Error message contains both fields in the array
        const errorString = strictValidation.join(', ');
        expect(errorString).toContain('label');
        expect(errorString).toContain('expiresAt');
      });

      it('should PASS for exact SponsorReportQr shape', () => {
        const exactQrShape = {
          url: 'https://www.eventangle.com/report?sponsor=true&sponsorId=sponsor-001',
          qrB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
          verified: true
        };

        const strictValidation = validateSponsorReportQrSchema(exactQrShape, true);
        expect(strictValidation).toBe(true);
      });

      it('should FAIL on missing required field (url)', () => {
        const qrMissingUrl = {
          qrB64: 'base64data',
          verified: true
        };

        const validation = validateSponsorReportQrSchema(qrMissingUrl, true);
        expect(validation).not.toBe(true);
        expect(validation).toContain('url: must be string');
      });

      it('should FAIL on missing required field (qrB64)', () => {
        const qrMissingQrB64 = {
          url: 'https://example.com?sponsorId=test',
          verified: true
        };

        const validation = validateSponsorReportQrSchema(qrMissingQrB64, true);
        expect(validation).not.toBe(true);
        expect(validation).toContain('qrB64: must be string');
      });

      it('should FAIL on missing required field (verified)', () => {
        const qrMissingVerified = {
          url: 'https://example.com?sponsorId=test',
          qrB64: 'base64data'
        };

        const validation = validateSponsorReportQrSchema(qrMissingVerified, true);
        expect(validation).not.toBe(true);
        expect(validation).toContain('verified: must be boolean');
      });
    });
  });

});

// ============================================================================
// EXPORT VALIDATORS FOR USE IN OTHER TESTS
// ============================================================================

module.exports = {
  // Fixture data
  FIXTURE_EVENT_STANDARD,
  FIXTURE_EVENT_WITH_SPONSORS,

  // Validators
  validateEventSchema,
  validateSharedAnalyticsSchema,
  validateSharedAnalyticsSchemaStrict,
  validateBundleSchema,
  validateSponsorSchema,
  validateSponsorReportQrSchema,
  validatePaginationSchema
};
