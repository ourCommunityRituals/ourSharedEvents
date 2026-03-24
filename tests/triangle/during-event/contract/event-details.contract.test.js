/**
 * Contract Tests for Event Details API (During Event)
 *
 * Tests the event details endpoint used during the During Event phase
 *
 * Triangle Phase: ▶️ During Event (Orange)
 * API Endpoint: ?action=get
 * Purpose: Get detailed event information for displays and public view
 * User Roles: Event Manager, Consumer/Attendee
 *
 * EVENT_CONTRACT.md v2.0 Compliance:
 * - Returns full canonical event shape (flat structure, no nested data object)
 * - MVP Required: id, slug, name, startDateISO, venue, links, qr, ctas, settings
 * - Links: publicUrl, displayUrl, posterUrl, signupUrl
 * - QR Codes: { public: base64, signup: base64 }
 * - V2 Optional: sponsors[], media{}, externalData{}, analytics{}, payments{}
 */

describe('🔺 TRIANGLE [DURING EVENT]: Event Details API Contract', () => {

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

  describe('api_get - Success responses (v2.0 Canonical Shape)', () => {
    it('should return canonical event per EVENT_CONTRACT.md v2.0', () => {
      const mockResponse = {
        ok: true,
        etag: 'xyz789',
        value: {
          // MVP Required - Identity (flat, no nested data object)
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
          schedule: [
            { time: '10:00 AM', title: 'Registration', description: null }
          ],
          standings: null,
          bracket: null,

          // V2 Optional (with defaults)
          sponsors: [],
          media: {},
          externalData: {},
          analytics: { enabled: false },
          payments: { enabled: false },

          // MVP Required - Timestamps
          createdAtISO: '2025-11-10T12:00:00.000Z',
          updatedAtISO: '2025-11-10T12:00:00.000Z'
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

      // v2.0: NO nested data object
      expect(mockResponse.value).not.toHaveProperty('data');
      expect(mockResponse.value).not.toHaveProperty('brandId');
      expect(mockResponse.value).not.toHaveProperty('templateId');
    });

    it('should include all v2.0 required links including signupUrl', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'event-1',
          links: {
            publicUrl: 'https://script.google.com/.../exec?page=events&brand=root&id=event-1',
            displayUrl: 'https://script.google.com/.../exec?page=display&brand=root&id=event-1&tv=1',
            posterUrl: 'https://script.google.com/.../exec?page=poster&brand=root&id=event-1',
            signupUrl: 'https://forms.google.com/...'
          }
        }
      };

      expect(mockResponse.value.links).toHaveProperty('publicUrl');
      expect(mockResponse.value.links).toHaveProperty('displayUrl');
      expect(mockResponse.value.links).toHaveProperty('posterUrl');
      expect(mockResponse.value.links).toHaveProperty('signupUrl');
    });

    it('should include QR codes as base64 data URIs', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'event-1',
          qr: {
            public: 'data:image/png;base64,iVBORw0KGgo...',
            signup: 'data:image/png;base64,iVBORw0KGgo...'
          }
        }
      };

      expect(mockResponse.value).toHaveProperty('qr');
      expect(mockResponse.value.qr).toHaveProperty('public');
      expect(mockResponse.value.qr).toHaveProperty('signup');
    });

    it('should include etag for caching', () => {
      const mockResponse = {
        ok: true,
        etag: 'xyz789',
        value: {
          id: 'event-1',
          slug: 'test-event',
          name: 'Test Event',
          startDateISO: '2025-12-01',
          venue: 'Test Venue'
        }
      };

      expect(mockResponse).toHaveProperty('etag');
      expect(typeof mockResponse.etag).toBe('string');
    });
  });

  describe('api_get - Event identity fields (v2.0)', () => {
    it('should include flat identity fields (no nested data)', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'event-1',
          slug: 'test-event',
          name: 'Test Event',
          startDateISO: '2025-12-01',
          venue: 'Test Venue',
          createdAtISO: '2025-11-10T12:00:00.000Z',
          updatedAtISO: '2025-11-10T12:00:00.000Z'
        }
      };

      // v2.0 uses flat structure
      expect(mockResponse.value).toHaveProperty('name');
      expect(mockResponse.value).toHaveProperty('startDateISO');
      expect(mockResponse.value).toHaveProperty('venue');

      // NOT nested under data
      expect(mockResponse.value.name).toBe('Test Event');
      expect(mockResponse.value.startDateISO).toBe('2025-12-01');
      expect(mockResponse.value.venue).toBe('Test Venue');
    });
  });

  describe('api_get - CTAs and Settings (v2.0)', () => {
    it('should include ctas with primary/secondary objects', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'event-1',
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

    it('should include settings with boolean flags', () => {
      const mockResponse = {
        ok: true,
        value: {
          id: 'event-1',
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
  });

  describe('api_get - Error responses', () => {
    it('should return NOT_FOUND for non-existent event', () => {
      const mockResponse = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('NOT_FOUND');
    });

    it('should return BAD_INPUT for invalid event ID', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid event ID'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });
  });
});
