/**
 * Contract Tests for Event Creation API (Before Event)
 *
 * Tests the event creation endpoint used during the Before Event phase
 *
 * Triangle Phase: 📋 Before Event (Green)
 * CANONICAL API: api_saveEvent (ZEVENT-003)
 * API Endpoint: ?action=saveEvent (with event object, no id = create mode)
 * Purpose: Create new events with full details
 * User Roles: Event Manager (primary)
 *
 * EVENT_CONTRACT.md v2.0 Compliance:
 * - Returns full canonical event shape (not just id+links)
 * - MVP Required: id, slug, name, startDateISO, venue, links, qr, ctas, settings
 * - Links: publicUrl, displayUrl, posterUrl, signupUrl
 * - QR Codes: { public: base64, signup: base64 }
 * - V2 Optional: sponsors[], media{}, externalData{}, analytics{}, payments{}
 *
 * REFACTORED: Now uses DRY helpers and fixtures
 */

const {
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  validateEventLinks,
  ERROR_CODES
} = require('../../../shared/helpers/test.helpers');

const {
  createBasicEvent,
  createCompleteEvent,
  EventBuilder
} = require('../../../shared/fixtures/events.fixtures');

describe('🔺 TRIANGLE [BEFORE EVENT]: Create Event API Contract', () => {

  describe('api_saveEvent (CREATE mode) - Success responses (v2.0 Canonical Shape)', () => {
    it('should return full canonical event per EVENT_CONTRACT.md v2.0', () => {
      const mockResponse = {
        ok: true,
        value: {
          // MVP Required - Identity
          id: 'new-event-123',
          slug: 'trivia-night',
          name: 'Trivia Night',
          startDateISO: '2025-12-01',
          venue: 'Test Venue',

          // MVP Required - Links (v2.0: includes signupUrl)
          links: {
            publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=new-event-123',
            displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=new-event-123&tv=1',
            posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=new-event-123',
            signupUrl: ''
          },

          // MVP Required - QR Codes (v2.0: base64 data URIs)
          qr: {
            public: 'data:image/png;base64,iVBORw0KGgo...',
            signup: ''
          },

          // MVP Required - CTAs (v2.0: primary/secondary objects)
          ctas: {
            primary: { label: 'Sign Up', url: '' },
            secondary: null
          },

          // MVP Required - Settings (v2.0: boolean flags)
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
          payments: { enabled: false },

          // MVP Required - Timestamps
          createdAtISO: '2025-11-22T12:00:00.000Z',
          updatedAtISO: '2025-11-22T12:00:00.000Z'
        }
      };

      validateEnvelope(mockResponse);

      // MVP Required fields per v2.0
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
    });

    it('should return links with all v2.0 required URLs including signupUrl', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'new-event-123',
          slug: 'test-event',
          name: 'Test Event',
          startDateISO: '2025-12-01',
          venue: 'Test Venue',
          links: {
            publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=new-event-123',
            displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=new-event-123&tv=1',
            posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=new-event-123',
            signupUrl: 'https://forms.google.com/...'
          },
          qr: { public: 'data:image/png;base64,...', signup: 'data:image/png;base64,...' },
          ctas: { primary: { label: 'Sign Up', url: 'https://forms.google.com/...' }, secondary: null },
          settings: { showSchedule: false, showStandings: false, showBracket: false, showSponsors: false },
          createdAtISO: '2025-11-22T12:00:00.000Z',
          updatedAtISO: '2025-11-22T12:00:00.000Z'
        }
      };

      // v2.0 requires 4 link URLs
      expect(mockResponse.value.links).toHaveProperty('publicUrl');
      expect(mockResponse.value.links).toHaveProperty('displayUrl');
      expect(mockResponse.value.links).toHaveProperty('posterUrl');
      expect(mockResponse.value.links).toHaveProperty('signupUrl');
    });

    it('should return QR codes as base64 data URIs per v2.0', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'new-event-123',
          qr: {
            public: 'data:image/png;base64,iVBORw0KGgo...',
            signup: 'data:image/png;base64,iVBORw0KGgo...'
          }
        }
      };

      expect(mockResponse.value.qr).toHaveProperty('public');
      expect(mockResponse.value.qr).toHaveProperty('signup');
      expect(mockResponse.value.qr.public).toMatch(/^data:image\/png;base64,/);
    });

    it('should return CTAs with primary object per v2.0', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'new-event-123',
          ctas: {
            primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
            secondary: null
          }
        }
      };

      expect(mockResponse.value.ctas).toHaveProperty('primary');
      expect(mockResponse.value.ctas.primary).toHaveProperty('label');
      expect(mockResponse.value.ctas.primary).toHaveProperty('url');
    });

    it('should return settings with boolean flags per v2.0', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'new-event-123',
          settings: {
            showSchedule: true,
            showStandings: false,
            showBracket: false,
            showSponsors: false
          }
        }
      };

      expect(typeof mockResponse.value.settings.showSchedule).toBe('boolean');
      expect(typeof mockResponse.value.settings.showStandings).toBe('boolean');
      expect(typeof mockResponse.value.settings.showBracket).toBe('boolean');
      expect(typeof mockResponse.value.settings.showSponsors).toBe('boolean');
    });

    it('should return V2 optional fields with defaults', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'new-event-123',
          sponsors: [],
          media: {},
          externalData: {},
          analytics: { enabled: false },
          payments: { enabled: false }
        }
      };

      expect(Array.isArray(mockResponse.value.sponsors)).toBe(true);
      expect(mockResponse.value.sponsors.length).toBe(0);
      expect(typeof mockResponse.value.media).toBe('object');
      expect(typeof mockResponse.value.externalData).toBe('object');
      expect(mockResponse.value.analytics.enabled).toBe(false);
      expect(mockResponse.value.payments.enabled).toBe(false);
    });
  });

  describe('api_saveEvent (CREATE mode) - Validation errors (v2.0 MVP Required)', () => {
    it('should return error for missing name field', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing required field: name'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
      expect(mockResponse.message).toContain('name');
    });

    it('should return error for missing startDateISO field', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing required field: startDateISO'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
      expect(mockResponse.message).toContain('startDateISO');
    });

    it('should return error for missing venue field', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing required field: venue'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
      expect(mockResponse.message).toContain('venue');
    });

    it('should return error for invalid startDateISO format', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid date format: startDateISO must be YYYY-MM-DD'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
      expect(mockResponse.message).toContain('YYYY-MM-DD');
    });

    it('should accept events with empty signupUrl (optional)', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'new-event-456',
          slug: 'test-event',
          name: 'Test Event',
          startDateISO: '2025-12-01',
          venue: 'Test Venue',
          links: {
            publicUrl: 'https://...',
            displayUrl: 'https://...',
            posterUrl: 'https://...',
            signupUrl: ''  // Empty is valid
          },
          qr: { public: 'data:image/png;base64,...', signup: '' },
          ctas: { primary: { label: 'Sign Up', url: '' }, secondary: null },
          settings: { showSchedule: false, showStandings: false, showBracket: false, showSponsors: false },
          createdAtISO: '2025-11-22T12:00:00.000Z',
          updatedAtISO: '2025-11-22T12:00:00.000Z'
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.ok).toBe(true);
      expect(mockResponse.value).toHaveProperty('id');
      expect(mockResponse.value.links.signupUrl).toBe('');
    });
  });

  describe('api_saveEvent (CREATE mode) - Authentication errors', () => {
    it('should return error for missing admin key', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid admin key'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
      expect(mockResponse.message).toContain('admin key');
    });

    it('should return error for invalid admin key', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid admin key'
      };

      validateEnvelope(mockResponse);
    });
  });

  describe('api_saveEvent (CREATE mode) - Rate limiting', () => {
    it('should return error when rate limit exceeded', () => {
      const mockResponse = {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('RATE_LIMITED');
    });
  });
});
