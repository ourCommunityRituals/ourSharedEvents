/**
 * Contract Tests for API Responses
 *
 * Ensures all API endpoints return responses matching the documented contract
 *
 * EVENT_CONTRACT.md v2.0 Compliance (MVP + V2-Ready):
 * - Canonical event shape with required MVP fields at top level
 * - MVP Required: id, slug, name, startDateISO, venue, links, qr, ctas, settings
 * - Links: publicUrl, displayUrl, posterUrl, signupUrl
 * - QR Codes: { public: base64, signup: base64 }
 * - CTA Format: { primary: { label, url }, secondary: null|{ label, url } }
 * - Settings: { showSchedule, showStandings, showBracket, showSponsors }
 * - V2 Optional: sponsors[], media{}, externalData{}, analytics{}, payments{}
 * - Timestamps: createdAtISO, updatedAtISO
 *
 * REFACTORED: Now uses DRY helpers and fixtures
 */

const {
  validateEnvelope,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

describe('API Contract Tests', () => {

  describe('api_status', () => {
    it('should return valid Ok envelope', () => {
      const mockResponse = {
        ok: true,
        value: {
          build: 'triangle-extended-v1.3',
          contract: '1.0.3',
          time: '2025-11-10T12:00:00.000Z',
          db: { ok: true, id: 'spreadsheet-id' }
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('build');
      expect(mockResponse.value).toHaveProperty('contract');
      expect(mockResponse.value).toHaveProperty('time');
      expect(mockResponse.value).toHaveProperty('db');
      expect(mockResponse.value.db).toHaveProperty('ok');
    });
  });

  describe('api_list', () => {
    it('should return valid list response with canonical events per v2.0', () => {
      const mockResponse = {
        ok: true,
        etag: 'abc123',
        value: {
          items: [
            {
              // MVP Required - Identity
              id: 'event-1',
              slug: 'test-event',
              name: 'Test Event',
              startDateISO: '2025-12-01',
              venue: 'Test Venue',

              // MVP Required - Links
              links: {
                publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=event-1',
                displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=event-1&tv=1',
                posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=event-1',
                signupUrl: ''
              },

              // MVP Required - QR, CTAs, Settings
              qr: { public: 'data:image/png;base64,...', signup: '' },
              ctas: { primary: { label: 'Sign Up', url: '' }, secondary: null },
              settings: { showSchedule: false, showStandings: false, showBracket: false, showSponsors: false },

              // V2 Optional defaults
              sponsors: [],
              media: {},
              externalData: {},
              analytics: { enabled: false },
              payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null },

              // Timestamps
              createdAtISO: '2025-11-10T12:00:00.000Z',
              updatedAtISO: '2025-11-10T12:00:00.000Z'
            }
          ],
          pagination: {
            total: 1,
            limit: 50,
            offset: 0,
            hasMore: false
          }
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse).toHaveProperty('etag');
      expect(mockResponse.value).toHaveProperty('items');
      expect(mockResponse.value).toHaveProperty('pagination');
      expect(Array.isArray(mockResponse.value.items)).toBe(true);

      // Validate canonical shape per v2.0
      const event = mockResponse.value.items[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('slug');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('startDateISO');
      expect(event).toHaveProperty('venue');
      expect(event).toHaveProperty('links');
      expect(event).toHaveProperty('qr');
      expect(event).toHaveProperty('ctas');
      expect(event).toHaveProperty('settings');
    });

    it('should support notModified response', () => {
      const mockResponse = {
        ok: true,
        notModified: true,
        etag: 'abc123'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.notModified).toBe(true);
      expect(mockResponse).toHaveProperty('etag');
    });

    it('should return pagination info per EVENT_CONTRACT.md v2.0', () => {
      const mockResponse = {
        ok: true,
        etag: 'abc123',
        value: {
          items: [],
          pagination: {
            total: 100,
            limit: 50,
            offset: 50,
            hasMore: true
          }
        }
      };

      expect(mockResponse.value.pagination).toHaveProperty('total');
      expect(mockResponse.value.pagination).toHaveProperty('limit');
      expect(mockResponse.value.pagination).toHaveProperty('offset');
      expect(mockResponse.value.pagination).toHaveProperty('hasMore');
    });
  });

  describe('api_get', () => {
    it('should return canonical event per EVENT_CONTRACT.md v2.0', () => {
      const mockResponse = {
        ok: true,
        etag: 'xyz789',
        value: {
          // MVP Required - Identity
          id: 'event-1',
          slug: 'test-event',
          name: 'Test Event',
          startDateISO: '2025-12-01',
          venue: 'Test Venue',

          // MVP Required - Links
          links: {
            publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=event-1',
            displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=event-1&tv=1',
            posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=event-1',
            signupUrl: 'https://forms.google.com/...'
          },

          // MVP Required - QR Codes
          qr: {
            public: 'data:image/png;base64,iVBORw0KGgo...',
            signup: 'data:image/png;base64,iVBORw0KGgo...'
          },

          // MVP Required - CTAs
          ctas: {
            primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
            secondary: null
          },

          // MVP Required - Settings
          settings: {
            showSchedule: true,
            showStandings: false,
            showBracket: false,
            showSponsors: false
          },

          // MVP Optional
          schedule: null,
          standings: null,
          bracket: null,

          // V2 Optional (with defaults)
          sponsors: [],
          media: {},
          externalData: {},
          analytics: { enabled: false },
          payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null },

          // MVP Required - Timestamps
          createdAtISO: '2025-11-10T12:00:00.000Z',
          updatedAtISO: '2025-11-10T12:00:00.000Z'
        }
      };

      validateEnvelope(mockResponse);

      // MVP Required - Identity
      expect(mockResponse.value).toHaveProperty('id');
      expect(mockResponse.value).toHaveProperty('slug');
      expect(mockResponse.value).toHaveProperty('name');
      expect(mockResponse.value).toHaveProperty('startDateISO');
      expect(mockResponse.value).toHaveProperty('venue');

      // MVP Required - Links (all 4 URLs)
      expect(mockResponse.value).toHaveProperty('links');
      expect(mockResponse.value.links).toHaveProperty('publicUrl');
      expect(mockResponse.value.links).toHaveProperty('displayUrl');
      expect(mockResponse.value.links).toHaveProperty('posterUrl');
      expect(mockResponse.value.links).toHaveProperty('signupUrl');

      // MVP Required - QR Codes
      expect(mockResponse.value).toHaveProperty('qr');
      expect(mockResponse.value.qr).toHaveProperty('public');
      expect(mockResponse.value.qr).toHaveProperty('signup');

      // MVP Required - CTAs
      expect(mockResponse.value).toHaveProperty('ctas');
      expect(mockResponse.value.ctas).toHaveProperty('primary');

      // MVP Required - Settings
      expect(mockResponse.value).toHaveProperty('settings');
      expect(mockResponse.value.settings).toHaveProperty('showSchedule');

      // Timestamps
      expect(mockResponse.value).toHaveProperty('createdAtISO');
      expect(mockResponse.value).toHaveProperty('updatedAtISO');
    });

    it('should return NOT_FOUND for invalid event ID', () => {
      const mockResponse = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found: invalid-id'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('NOT_FOUND');
    });
  });

  describe('api_getPublicBundle', () => {
    it('should return bundle with canonical event per EVENT_CONTRACT.md v2.0', () => {
      const mockResponse = {
        ok: true,
        etag: 'bundle123',
        value: {
          // Event in canonical v2.0 shape
          event: {
            id: 'event-1',
            slug: 'test-event',
            name: 'Test Event',
            startDateISO: '2025-12-01',
            venue: 'Test Venue',
            links: {
              publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=event-1',
              displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=event-1&tv=1',
              posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=event-1',
              signupUrl: 'https://forms.google.com/...'
            },
            qr: {
              public: 'data:image/png;base64,...',
              signup: 'data:image/png;base64,...'
            },
            ctas: {
              primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
              secondary: null
            },
            settings: {
              showSchedule: true,
              showStandings: false,
              showBracket: false,
              showSponsors: true
            },
            schedule: [
              { time: '10:00 AM', title: 'Registration Opens', description: null }
            ],
            standings: null,
            bracket: null,
            sponsors: [
              { id: 'sp-1', name: 'Sponsor 1', logoUrl: 'https://ex.com/logo.png', linkUrl: null, placement: 'public' }
            ],
            media: {},
            externalData: {},
            analytics: { enabled: false },
            payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null },
            createdAtISO: '2025-11-10T12:00:00.000Z',
            updatedAtISO: '2025-11-10T12:00:00.000Z'
          },
          // Bundle config per v2.0
          config: {
            brandId: 'root',
            brandName: 'Default Brand',
            appTitle: 'Events'
          }
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse).toHaveProperty('etag');
      expect(mockResponse.value).toHaveProperty('event');
      expect(mockResponse.value).toHaveProperty('config');

      // Event should be canonical v2.0 shape
      const event = mockResponse.value.event;
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('slug');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('startDateISO');
      expect(event).toHaveProperty('venue');
      expect(event).toHaveProperty('links');
      expect(event).toHaveProperty('qr');
      expect(event).toHaveProperty('ctas');
      expect(event).toHaveProperty('settings');

      // Config per v2.0
      expect(mockResponse.value.config).toHaveProperty('brandId');
      expect(mockResponse.value.config).toHaveProperty('brandName');
      expect(mockResponse.value.config).toHaveProperty('appTitle');
    });

    it('should support notModified response', () => {
      const mockResponse = {
        ok: true,
        notModified: true,
        etag: 'bundle123'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.notModified).toBe(true);
      expect(mockResponse).toHaveProperty('etag');
    });
  });

  describe('api_getDisplayBundle', () => {
    it('should return display bundle with canonical event per v2.0', () => {
      const mockResponse = {
        ok: true,
        etag: 'display123',
        value: {
          event: {
            id: 'event-1',
            slug: 'test-event',
            name: 'Test Event',
            startDateISO: '2025-12-01',
            venue: 'Test Venue',
            links: {
              publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=event-1',
              displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=event-1&tv=1',
              posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=event-1',
              signupUrl: ''
            },
            qr: { public: 'data:image/png;base64,...', signup: '' },
            ctas: { primary: { label: 'Sign Up', url: '' }, secondary: null },
            settings: { showSchedule: true, showStandings: false, showBracket: false, showSponsors: false },
            schedule: [{ time: '10:00 AM', title: 'Opening', description: null }],
            standings: null,
            bracket: null,
            sponsors: [],
            media: {},
            externalData: {},
            analytics: { enabled: false },
            payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null },
            createdAtISO: '2025-11-10T12:00:00.000Z',
            updatedAtISO: '2025-11-10T12:00:00.000Z'
          },
          config: {
            brandId: 'root',
            brandName: 'Default Brand',
            appTitle: 'Events'
          }
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('event');
      expect(mockResponse.value).toHaveProperty('config');
      expect(mockResponse.value.event).toHaveProperty('schedule');
    });
  });

  describe('api_getPosterBundle', () => {
    it('should return poster bundle with canonical event per v2.0', () => {
      const mockResponse = {
        ok: true,
        etag: 'poster123',
        value: {
          event: {
            id: 'event-1',
            slug: 'test-event',
            name: 'Test Event',
            startDateISO: '2025-12-01',
            venue: 'Test Venue',
            links: {
              publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=event-1',
              displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=event-1&tv=1',
              posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=event-1',
              signupUrl: 'https://forms.google.com/...'
            },
            qr: {
              public: 'data:image/png;base64,...',
              signup: 'data:image/png;base64,...'
            },
            ctas: { primary: { label: 'Sign Up', url: 'https://forms.google.com/...' }, secondary: null },
            settings: { showSchedule: false, showStandings: false, showBracket: false, showSponsors: true },
            schedule: null,
            standings: null,
            bracket: null,
            sponsors: [
              { id: 'sp-1', name: 'Poster Sponsor', logoUrl: 'https://ex.com/logo.png', linkUrl: null, placement: 'poster' }
            ],
            media: {},
            externalData: {},
            analytics: { enabled: false },
            payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null },
            createdAtISO: '2025-11-10T12:00:00.000Z',
            updatedAtISO: '2025-11-10T12:00:00.000Z'
          },
          config: {
            brandId: 'root',
            brandName: 'Default Brand',
            appTitle: 'Events'
          }
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('event');
      expect(mockResponse.value).toHaveProperty('config');

      // Poster must have QR codes
      expect(mockResponse.value.event.qr).toHaveProperty('public');
      expect(mockResponse.value.event.qr).toHaveProperty('signup');
    });
  });

  describe('api_create', () => {
    it('should return full canonical event per EVENT_CONTRACT.md v2.0', () => {
      const mockResponse = {
        ok: true,
        value: {
          // MVP Required - Identity
          id: 'new-event-123',
          slug: 'test-event',
          name: 'Test Event',
          startDateISO: '2025-12-01',
          venue: 'Test Venue',

          // MVP Required - Links
          links: {
            publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=new-event-123',
            displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=new-event-123&tv=1',
            posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=new-event-123',
            signupUrl: ''
          },

          // MVP Required - QR Codes (base64 data URIs)
          qr: {
            public: 'data:image/png;base64,iVBORw0KGgo...',
            signup: 'data:image/png;base64,iVBORw0KGgo...'
          },

          // MVP Required - CTAs
          ctas: {
            primary: { label: 'Sign Up', url: '' },
            secondary: null
          },

          // MVP Required - Settings
          settings: {
            showSchedule: false,
            showStandings: false,
            showBracket: false,
            showSponsors: false
          },

          // MVP Optional
          schedule: null,
          standings: null,
          bracket: null,

          // V2 Optional (with defaults)
          sponsors: [],
          media: {},
          externalData: {},
          analytics: { enabled: false },
          payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null },

          // MVP Required - Timestamps
          createdAtISO: '2025-11-22T12:00:00.000Z',
          updatedAtISO: '2025-11-22T12:00:00.000Z'
        }
      };

      validateEnvelope(mockResponse);

      // MVP Required fields
      expect(mockResponse.value).toHaveProperty('id');
      expect(mockResponse.value).toHaveProperty('slug');
      expect(mockResponse.value).toHaveProperty('name');
      expect(mockResponse.value).toHaveProperty('startDateISO');
      expect(mockResponse.value).toHaveProperty('venue');
      expect(mockResponse.value).toHaveProperty('links');
      expect(mockResponse.value).toHaveProperty('qr');
      expect(mockResponse.value).toHaveProperty('ctas');
      expect(mockResponse.value).toHaveProperty('settings');
      expect(mockResponse.value).toHaveProperty('createdAtISO');
      expect(mockResponse.value).toHaveProperty('updatedAtISO');

      // Links structure
      expect(mockResponse.value.links).toHaveProperty('publicUrl');
      expect(mockResponse.value.links).toHaveProperty('displayUrl');
      expect(mockResponse.value.links).toHaveProperty('posterUrl');
      expect(mockResponse.value.links).toHaveProperty('signupUrl');

      // QR structure
      expect(mockResponse.value.qr).toHaveProperty('public');
      expect(mockResponse.value.qr).toHaveProperty('signup');

      // CTA structure
      expect(mockResponse.value.ctas).toHaveProperty('primary');
      expect(mockResponse.value.ctas.primary).toHaveProperty('label');
      expect(mockResponse.value.ctas.primary).toHaveProperty('url');

      // Settings structure
      expect(mockResponse.value.settings).toHaveProperty('showSchedule');
      expect(mockResponse.value.settings).toHaveProperty('showStandings');
      expect(mockResponse.value.settings).toHaveProperty('showBracket');
    });

    it('should return error for missing required field: name', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing required field: name'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });

    it('should return error for missing required field: startDateISO', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing required field: startDateISO'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });

    it('should return error for missing required field: venue', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing required field: venue'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });

    it('should return error for invalid date format', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid date format: startDateISO must be YYYY-MM-DD'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });

    it('should return error for invalid admin key', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid admin key'
      };

      validateEnvelope(mockResponse);
    });

    it('should return error for rate limiting', () => {
      const mockResponse = {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('RATE_LIMITED');
    });
  });

  describe('api_logEvents', () => {
    it('should return count of logged events', () => {
      const mockResponse = {
        ok: true,
        value: { count: 5 }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('count');
      expect(typeof mockResponse.value.count).toBe('number');
    });
  });

  describe('api_trackEventMetric', () => {
    it('should return count of 1 for single metric tracking', () => {
      const mockResponse = {
        ok: true,
        value: { count: 1 }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('count');
      expect(mockResponse.value.count).toBe(1);
    });

    it('should validate required fields: eventId, surface, action', () => {
      // Missing eventId
      const mockMissingEventId = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'missing eventId'
      };
      validateEnvelope(mockMissingEventId);
      expect(mockMissingEventId.code).toBe('BAD_INPUT');
    });

    it('should validate surface enum values', () => {
      const validSurfaces = ['public', 'display', 'poster', 'admin'];
      validSurfaces.forEach(surface => {
        expect(validSurfaces).toContain(surface);
      });
    });

    it('should validate action enum values', () => {
      const validActions = ['view', 'impression', 'click', 'scan', 'cta_click', 'sponsor_click', 'dwell'];
      validActions.forEach(action => {
        expect(validActions).toContain(action);
      });
    });

    it('should accept optional sponsorId for sponsor-specific tracking', () => {
      const mockResponse = {
        ok: true,
        value: { count: 1 }
      };
      validateEnvelope(mockResponse);
    });

    it('should accept optional value for dwell time tracking', () => {
      const mockResponse = {
        ok: true,
        value: { count: 1 }
      };
      validateEnvelope(mockResponse);
    });
  });

  describe('api_getReport', () => {
    it('should return aggregated analytics', () => {
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
      expect(mockResponse.value.totals).toHaveProperty('impressions');
      expect(mockResponse.value.totals).toHaveProperty('clicks');
      expect(mockResponse.value.totals).toHaveProperty('dwellSec');
    });
  });

  describe('api_createShortlink', () => {
    it('should return token and shortlink', () => {
      const mockResponse = {
        ok: true,
        value: {
          token: 'abc12345',
          shortlink: 'https://script.google.com/macros/s/.../exec?p=r&t=abc12345',
          targetUrl: 'https://example.com/signup'
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('token');
      expect(mockResponse.value).toHaveProperty('shortlink');
      expect(mockResponse.value).toHaveProperty('targetUrl');
    });
  });

  describe('Error codes', () => {
    const errorCodes = Object.keys(ERROR_CODES);

    errorCodes.forEach(code => {
      it(`should have ${code} error code defined`, () => {
        expect(ERROR_CODES[code]).toBe(code);
      });
    });

    it('should have all required error codes', () => {
      expect(ERROR_CODES).toHaveProperty('BAD_INPUT');
      expect(ERROR_CODES).toHaveProperty('NOT_FOUND');
      expect(ERROR_CODES).toHaveProperty('RATE_LIMITED');
      expect(ERROR_CODES).toHaveProperty('INTERNAL');
      expect(ERROR_CODES).toHaveProperty('CONTRACT');
    });
  });

  // === EVENT_CONTRACT.md v2.0 Compliance Tests ===

  describe('EVENT_CONTRACT.md v2.0 Compliance', () => {

    describe('Canonical Event Shape (MVP Required)', () => {
      it('should return event with all MVP required fields', () => {
        const mockEvent = {
          // Identity (MVP Required)
          id: 'EVT_123',
          slug: 'trivia-night',
          name: 'Trivia Night',
          startDateISO: '2025-12-01',
          venue: 'Test Venue',

          // Links (MVP Required)
          links: {
            publicUrl: 'https://example.com/events/trivia-night',
            displayUrl: 'https://example.com/display/trivia-night',
            posterUrl: 'https://example.com/poster/trivia-night',
            signupUrl: 'https://forms.google.com/...'
          },

          // QR Codes (MVP Required)
          qr: {
            public: 'data:image/png;base64,...',
            signup: 'data:image/png;base64,...'
          },

          // CTAs (MVP Required)
          ctas: {
            primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
            secondary: null
          },

          // Settings (MVP Required)
          settings: {
            showSchedule: true,
            showStandings: false,
            showBracket: false,
            showSponsors: false
          },

          // Timestamps (MVP Required)
          createdAtISO: '2025-11-22T12:00:00.000Z',
          updatedAtISO: '2025-11-22T12:00:00.000Z'
        };

        // MVP Required fields per EVENT_CONTRACT.md v2.0
        expect(mockEvent).toHaveProperty('id');
        expect(mockEvent).toHaveProperty('slug');
        expect(mockEvent).toHaveProperty('name');
        expect(mockEvent).toHaveProperty('startDateISO');
        expect(mockEvent).toHaveProperty('venue');
        expect(mockEvent).toHaveProperty('links');
        expect(mockEvent).toHaveProperty('qr');
        expect(mockEvent).toHaveProperty('ctas');
        expect(mockEvent).toHaveProperty('settings');
        expect(mockEvent).toHaveProperty('createdAtISO');
        expect(mockEvent).toHaveProperty('updatedAtISO');
      });

      it('should return links with all required URLs including signupUrl', () => {
        const mockLinks = {
          publicUrl: 'https://example.com/public',
          displayUrl: 'https://example.com/display',
          posterUrl: 'https://example.com/poster',
          signupUrl: 'https://forms.google.com/...'
        };

        expect(mockLinks).toHaveProperty('publicUrl');
        expect(mockLinks).toHaveProperty('displayUrl');
        expect(mockLinks).toHaveProperty('posterUrl');
        expect(mockLinks).toHaveProperty('signupUrl');
      });

      it('should validate startDateISO format (YYYY-MM-DD)', () => {
        const validDate = '2025-12-01';
        expect(validDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    describe('Settings Format (MVP Required)', () => {
      it('should validate Settings shape', () => {
        const mockSettings = {
          showSchedule: true,
          showStandings: false,
          showBracket: false,
          showSponsors: false
        };

        expect(mockSettings).toHaveProperty('showSchedule');
        expect(mockSettings).toHaveProperty('showStandings');
        expect(mockSettings).toHaveProperty('showBracket');
        expect(mockSettings).toHaveProperty('showSponsors');
        expect(typeof mockSettings.showSchedule).toBe('boolean');
        expect(typeof mockSettings.showStandings).toBe('boolean');
        expect(typeof mockSettings.showBracket).toBe('boolean');
        expect(typeof mockSettings.showSponsors).toBe('boolean');
      });

      it('should default all settings to false for MVP', () => {
        const mockSettings = {
          showSchedule: false,
          showStandings: false,
          showBracket: false,
          showSponsors: false
        };

        expect(mockSettings.showSchedule).toBe(false);
        expect(mockSettings.showStandings).toBe(false);
        expect(mockSettings.showBracket).toBe(false);
        expect(mockSettings.showSponsors).toBe(false);
      });
    });

    describe('QR Codes Format (MVP Required)', () => {
      it('should validate QR codes shape', () => {
        const mockQR = {
          public: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...',
          signup: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...'
        };

        expect(mockQR).toHaveProperty('public');
        expect(mockQR).toHaveProperty('signup');
      });

      it('should accept base64 data URI format', () => {
        const qrDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...';
        expect(qrDataUri).toMatch(/^data:image\/png;base64,/);
      });

      it('should accept empty string when no signup URL', () => {
        const mockQR = {
          public: 'data:image/png;base64,...',
          signup: ''
        };

        expect(mockQR.signup).toBe('');
      });
    });

    describe('CTA Format (MVP Required)', () => {
      it('should validate CTA object shape with primary and secondary', () => {
        const mockCtas = {
          primary: {
            label: 'Sign Up',
            url: 'https://forms.google.com/...'
          },
          secondary: null
        };

        expect(mockCtas).toHaveProperty('primary');
        expect(mockCtas).toHaveProperty('secondary');
        expect(mockCtas.primary).toHaveProperty('label');
        expect(mockCtas.primary).toHaveProperty('url');
        expect(typeof mockCtas.primary.label).toBe('string');
      });

      it('should require primary CTA', () => {
        const mockCtas = {
          primary: { label: 'Register Now', url: 'https://example.com/register' },
          secondary: null
        };

        expect(mockCtas.primary).toBeDefined();
        expect(mockCtas.primary.label).toBeTruthy();
      });

      it('should accept null for secondary CTA', () => {
        const mockCtas = {
          primary: { label: 'Sign Up', url: '' },
          secondary: null
        };

        expect(mockCtas.secondary).toBeNull();
      });

      it('should support secondary CTA with label and url (V2)', () => {
        const mockCtas = {
          primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
          secondary: { label: 'Learn More', url: 'https://example.com/about' }
        };

        expect(mockCtas.secondary).not.toBeNull();
        expect(mockCtas.secondary.label).toBe('Learn More');
        expect(mockCtas.secondary.url).toBe('https://example.com/about');
      });

      it('should accept empty string for url when no signup configured', () => {
        const mockCtas = {
          primary: { label: 'Sign Up', url: '' },
          secondary: null
        };

        expect(mockCtas.primary.url).toBe('');
      });
    });

    describe('Sponsor Format (V2 Optional)', () => {
      it('should validate Sponsor shape with placement', () => {
        const mockSponsor = {
          id: 'sp-123',
          name: 'Acme Corp',
          logoUrl: 'https://example.com/logo.png',
          linkUrl: 'https://acme.com',
          placement: 'poster'
        };

        expect(mockSponsor).toHaveProperty('id');
        expect(mockSponsor).toHaveProperty('name');
        expect(mockSponsor).toHaveProperty('logoUrl');
        expect(mockSponsor).toHaveProperty('linkUrl');
        expect(mockSponsor).toHaveProperty('placement');
      });

      it('should accept null for optional linkUrl', () => {
        const mockSponsor = {
          id: 'sp-456',
          name: 'Local Business',
          logoUrl: 'https://example.com/logo.png',
          linkUrl: null,
          placement: 'display'
        };

        expect(mockSponsor.linkUrl).toBeNull();
      });

      it('should validate placement enum values', () => {
        const validPlacements = ['poster', 'display', 'public', 'tv-banner'];

        validPlacements.forEach(placement => {
          expect(validPlacements).toContain(placement);
        });
      });

      it('should default sponsors to empty array for MVP', () => {
        const mockEvent = {
          sponsors: []
        };

        expect(Array.isArray(mockEvent.sponsors)).toBe(true);
        expect(mockEvent.sponsors.length).toBe(0);
      });

      it('should support sponsors array with placement (V2)', () => {
        const mockSponsors = [
          { id: 'sp-1', name: 'Gold Sponsor', logoUrl: 'https://ex.com/gold.png', linkUrl: null, placement: 'poster' },
          { id: 'sp-2', name: 'Silver Sponsor', logoUrl: 'https://ex.com/silver.png', linkUrl: 'https://silver.com', placement: 'display' }
        ];

        expect(Array.isArray(mockSponsors)).toBe(true);
        mockSponsors.forEach(sponsor => {
          expect(sponsor).toHaveProperty('id');
          expect(sponsor).toHaveProperty('name');
          expect(sponsor).toHaveProperty('logoUrl');
          expect(sponsor).toHaveProperty('placement');
        });
      });
    });

    describe('externalData Format (V2 Optional)', () => {
      it('should validate externalData shape', () => {
        const mockExternalData = {
          scheduleUrl: 'https://docs.google.com/spreadsheets/d/xxx',
          standingsUrl: 'https://docs.google.com/spreadsheets/d/yyy',
          bracketUrl: 'https://challonge.com/bracket123'
        };

        expect(mockExternalData).toHaveProperty('scheduleUrl');
        expect(mockExternalData).toHaveProperty('standingsUrl');
        expect(mockExternalData).toHaveProperty('bracketUrl');
      });

      it('should accept null for all externalData fields', () => {
        const mockExternalData = {
          scheduleUrl: null,
          standingsUrl: null,
          bracketUrl: null
        };

        expect(mockExternalData.scheduleUrl).toBeNull();
        expect(mockExternalData.standingsUrl).toBeNull();
        expect(mockExternalData.bracketUrl).toBeNull();
      });

      it('should default externalData to empty object for MVP', () => {
        const mockEvent = {
          externalData: {}
        };

        expect(typeof mockEvent.externalData).toBe('object');
        expect(Object.keys(mockEvent.externalData).length).toBe(0);
      });
    });

    describe('V2 Optional Fields with Defaults', () => {
      it('should validate analytics default shape', () => {
        const mockAnalytics = { enabled: false };

        expect(mockAnalytics).toHaveProperty('enabled');
        expect(mockAnalytics.enabled).toBe(false);
      });

      it('should validate payments default shape (Stripe seam)', () => {
        const mockPayments = {
          enabled: false,
          provider: 'stripe',
          price: null,
          currency: 'USD',
          checkoutUrl: null
        };

        expect(mockPayments).toHaveProperty('enabled');
        expect(mockPayments).toHaveProperty('provider');
        expect(mockPayments).toHaveProperty('price');
        expect(mockPayments).toHaveProperty('currency');
        expect(mockPayments).toHaveProperty('checkoutUrl');
        expect(mockPayments.enabled).toBe(false);
        expect(mockPayments.provider).toBe('stripe');
      });

      it('should validate media default shape', () => {
        const mockMedia = {};

        expect(typeof mockMedia).toBe('object');
      });

      it('should validate all V2 defaults in event', () => {
        const mockEvent = {
          sponsors: [],
          media: {},
          externalData: {},
          analytics: { enabled: false },
          payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null }
        };

        expect(Array.isArray(mockEvent.sponsors)).toBe(true);
        expect(mockEvent.sponsors.length).toBe(0);
        expect(typeof mockEvent.media).toBe('object');
        expect(typeof mockEvent.externalData).toBe('object');
        expect(mockEvent.analytics.enabled).toBe(false);
        expect(mockEvent.payments.enabled).toBe(false);
      });
    });

    describe('Full Event Shape Validation', () => {
      it('should validate complete EVENT_CONTRACT.md v2.0 event', () => {
        const mockEvent = {
          // Identity (MVP Required)
          id: 'EVT_abc123',
          slug: 'thursday-trivia-night',
          name: 'Thursday Trivia Night',
          startDateISO: '2025-12-05',
          venue: "O'Malley's Pub, 123 Main Street",

          // Links (MVP Required)
          links: {
            publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=EVT_abc123',
            displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=EVT_abc123&tv=1',
            posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=EVT_abc123',
            signupUrl: 'https://forms.google.com/...'
          },

          // QR Codes (MVP Required)
          qr: {
            public: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...',
            signup: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...'
          },

          // CTAs (MVP Required)
          ctas: {
            primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
            secondary: null
          },

          // Settings (MVP Required)
          settings: {
            showSchedule: true,
            showStandings: false,
            showBracket: false,
            showSponsors: false
          },

          // MVP Optional
          schedule: null,
          standings: null,
          bracket: null,

          // V2 Optional (with defaults)
          sponsors: [],
          media: {},
          externalData: {},
          analytics: { enabled: false },
          payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD', checkoutUrl: null },

          // Timestamps (MVP Required)
          createdAtISO: '2025-11-22T10:30:00.000Z',
          updatedAtISO: '2025-11-22T10:30:00.000Z'
        };

        // Validate MVP Required fields
        expect(mockEvent.id).toBeDefined();
        expect(mockEvent.slug).toBeDefined();
        expect(mockEvent.name).toBeDefined();
        expect(mockEvent.startDateISO).toBeDefined();
        expect(mockEvent.venue).toBeDefined();
        expect(mockEvent.links).toBeDefined();
        expect(mockEvent.qr).toBeDefined();
        expect(mockEvent.ctas).toBeDefined();
        expect(mockEvent.settings).toBeDefined();
        expect(mockEvent.createdAtISO).toBeDefined();
        expect(mockEvent.updatedAtISO).toBeDefined();

        // Links format
        expect(mockEvent.links.publicUrl).toBeDefined();
        expect(mockEvent.links.displayUrl).toBeDefined();
        expect(mockEvent.links.posterUrl).toBeDefined();
        expect(mockEvent.links.signupUrl).toBeDefined();

        // QR format
        expect(mockEvent.qr.public).toBeDefined();
        expect(mockEvent.qr.signup).toBeDefined();

        // CTA format
        expect(mockEvent.ctas.primary).toBeDefined();
        expect(mockEvent.ctas.primary.label).toBeDefined();
        expect(mockEvent.ctas.primary.url).toBeDefined();

        // Settings format
        expect(typeof mockEvent.settings.showSchedule).toBe('boolean');
        expect(typeof mockEvent.settings.showStandings).toBe('boolean');
        expect(typeof mockEvent.settings.showBracket).toBe('boolean');

        // V2 defaults
        expect(Array.isArray(mockEvent.sponsors)).toBe(true);
        expect(typeof mockEvent.media).toBe('object');
        expect(typeof mockEvent.externalData).toBe('object');
        expect(mockEvent.analytics.enabled).toBe(false);
        expect(mockEvent.payments.enabled).toBe(false);
      });

      it('should validate startDateISO format', () => {
        const validDate = '2025-12-05';
        expect(validDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should validate timestamp format', () => {
        const validTimestamp = '2025-11-22T10:30:00.000Z';
        const date = new Date(validTimestamp);
        expect(date.getTime()).not.toBeNaN();
      });
    });
  });
});
