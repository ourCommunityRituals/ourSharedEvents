/**
 * Event Fixtures for Testing
 *
 * Shared event data for all test types across Triangle phases
 *
 * EVENT_CONTRACT.md v2.0 Compliance:
 * - Uses canonical field names: startDateISO, venue
 * - Flat event structure (no nested data object)
 * - MVP Required: name, startDateISO, venue, links, qr, ctas, settings
 * - V2 Optional: sponsors[], media{}, externalData{}, analytics{}, payments{}
 *
 * BASE_URL-Aware: Automatically uses centralized environment config
 * Default: https://stg.eventangle.com (staging via Cloudflare Workers)
 */

const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to stg.eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';

/**
 * Generate a unique timestamp-based event name
 */
const generateEventName = (prefix = 'Test Event') => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `${prefix} ${timestamp}`;
};

/**
 * Generate a unique event ID
 */
const generateEventId = () => {
  return `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Event Builder - Creates events with builder pattern (v2.0 compliant)
 */
class EventBuilder {
  constructor() {
    // v2.0 canonical field names
    this.event = {
      name: generateEventName('Test Event'),
      startDateISO: '2025-12-15',  // v2.0: was dateISO
      venue: 'Test Venue',          // v2.0: was location
      ctas: {
        primary: { label: 'Sign Up', url: '' },
        secondary: null
      },
      settings: {
        showSchedule: false,
        showStandings: false,
        showBracket: false,
        showSponsors: false
      }
    };
  }

  withName(name) {
    this.event.name = name;
    return this;
  }

  withDate(startDateISO) {
    this.event.startDateISO = startDateISO;  // v2.0 field name
    return this;
  }

  withVenue(venue) {
    this.event.venue = venue;  // v2.0 field name
    return this;
  }

  // Legacy alias for backward compatibility
  withLocation(location) {
    this.event.venue = location;  // Maps to v2.0 venue field
    return this;
  }

  withSignupUrl(url) {
    this.event.ctas.primary.url = url;
    return this;
  }

  withCTALabel(label) {
    this.event.ctas.primary.label = label;
    return this;
  }

  withSchedule(schedule) {
    this.event.schedule = schedule;
    this.event.settings.showSchedule = true;
    return this;
  }

  withStandings(standings) {
    this.event.standings = standings;
    this.event.settings.showStandings = true;
    return this;
  }

  withSettings(settings) {
    this.event.settings = { ...this.event.settings, ...settings };
    return this;
  }

  withSponsors(sponsors) {
    this.event.sponsors = sponsors;
    if (sponsors && sponsors.length > 0) {
      this.event.settings.showSponsors = true;
    }
    return this;
  }

  withMedia(media) {
    this.event.media = media;
    return this;
  }

  withExternalData(externalData) {
    this.event.externalData = externalData;
    return this;
  }

  build() {
    return { ...this.event };
  }
}

/**
 * Factory function for basic event (MVP required fields only)
 * Returns a NEW instance each time per v2.0 structure
 */
const createBasicEvent = (overrides = {}) => ({
  name: generateEventName('Basic Event'),
  startDateISO: '2025-12-15',  // v2.0 field name
  venue: 'Test Venue',          // v2.0 field name
  ctas: {
    primary: { label: 'Sign Up', url: '' },
    secondary: null
  },
  settings: {
    showSchedule: false,
    showStandings: false,
    showBracket: false,
    showSponsors: false
  },
  ...overrides
});

/**
 * Factory function for complete event (all v2.0 fields)
 * Returns a NEW instance each time
 */
const createCompleteEvent = (overrides = {}) => ({
  name: generateEventName('Complete Event'),
  startDateISO: '2025-12-20',  // v2.0 field name
  venue: 'Complete Test Venue', // v2.0 field name

  // v2.0 CTAs
  ctas: {
    primary: { label: 'Register Now', url: 'https://forms.google.com/...' },
    secondary: { label: 'Learn More', url: 'https://example.com/about' }
  },

  // v2.0 Settings
  settings: {
    showSchedule: true,
    showStandings: false,
    showBracket: false,
    showSponsors: true
  },

  // MVP Optional
  schedule: [
    { time: '18:00', title: 'Registration Opens', description: null },
    { time: '19:00', title: 'Main Event Begins', description: 'Welcome and introductions' },
    { time: '22:00', title: 'Event Ends', description: null }
  ],
  standings: null,
  bracket: null,

  // V2 Optional - Sponsors with placement
  sponsors: [
    { id: 'sp-1', name: 'Platinum Sponsor', logoUrl: 'https://via.placeholder.com/300x100/FFD700/000000?text=Platinum', linkUrl: 'https://platinum.example.com', placement: 'poster' },
    { id: 'sp-2', name: 'Gold Sponsor', logoUrl: 'https://via.placeholder.com/300x100/C0C0C0/000000?text=Gold', linkUrl: 'https://gold.example.com', placement: 'display' }
  ],

  // V2 Optional - Media
  media: {
    videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    mapUrl: 'https://www.google.com/maps/embed?pb=...'
  },

  // V2 Optional - External Data
  externalData: {},

  // V2 Optional defaults
  analytics: { enabled: false },
  payments: { enabled: false },

  ...overrides
});

/**
 * Factory function for event with sponsors (Before Event phase) - v2.0
 */
const createEventWithSponsors = (overrides = {}) => ({
  name: generateEventName('Sponsored Event'),
  startDateISO: '2025-12-25',
  venue: 'Sponsored Venue',
  ctas: {
    primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
    secondary: null
  },
  settings: {
    showSchedule: false,
    showStandings: false,
    showBracket: false,
    showSponsors: true
  },
  // v2.0 Sponsors with placement field
  sponsors: [
    {
      id: 'sp-plat',
      name: 'Platinum Corp',
      logoUrl: 'https://via.placeholder.com/300x100/FFD700/000000?text=Platinum+Corp',
      linkUrl: 'https://platinum-corp.example.com',
      placement: 'poster'
    },
    {
      id: 'sp-gold',
      name: 'Gold Industries',
      logoUrl: 'https://via.placeholder.com/300x100/C0C0C0/000000?text=Gold+Industries',
      linkUrl: 'https://gold-industries.example.com',
      placement: 'display'
    },
    {
      id: 'sp-silver',
      name: 'Silver Solutions',
      logoUrl: 'https://via.placeholder.com/300x100/CD7F32/000000?text=Silver+Solutions',
      linkUrl: 'https://silver-solutions.example.com',
      placement: 'public'
    }
  ],
  ...overrides
});

/**
 * Factory function for event with schedule (During Event phase) - v2.0
 */
const createEventWithDisplay = (overrides = {}) => ({
  name: generateEventName('Display Event'),
  startDateISO: '2025-12-30',
  venue: 'Display Venue',
  ctas: {
    primary: { label: 'Sign Up', url: '' },
    secondary: null
  },
  settings: {
    showSchedule: true,
    showStandings: false,
    showBracket: false,
    showSponsors: false
  },
  schedule: [
    { time: '09:00 AM', title: 'Registration', description: 'Check-in opens' },
    { time: '10:00 AM', title: 'Opening Ceremony', description: null },
    { time: '12:00 PM', title: 'Lunch Break', description: 'Sponsored by Gold Corp' },
    { time: '05:00 PM', title: 'Closing', description: null }
  ],
  // v2.0 media for display
  media: {
    videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    mapUrl: 'https://maps.google.com/...'
  },
  ...overrides
});

/**
 * Factory function for past event (After Event phase - for analytics) - v2.0
 */
const createPastEvent = (overrides = {}) => ({
  name: generateEventName('Past Event'),
  startDateISO: '2025-01-01',
  venue: 'Past Venue',
  ctas: {
    primary: { label: 'View Results', url: 'https://example.com/results' },
    secondary: null
  },
  settings: {
    showSchedule: false,
    showStandings: true,
    showBracket: false,
    showSponsors: false
  },
  standings: [
    { rank: 1, team: 'Champions', wins: 10, losses: 0, points: 100 },
    { rank: 2, team: 'Runners Up', wins: 8, losses: 2, points: 80 }
  ],
  analytics: { enabled: true },
  ...overrides
});

// DEPRECATED: Use factory functions instead (e.g., createBasicEvent())
// These are kept for backwards compatibility but will cause timestamp collisions
const basicEvent = createBasicEvent();
const completeEvent = createCompleteEvent();
const eventWithSponsors = createEventWithSponsors();
const eventWithDisplay = createEventWithDisplay();
const pastEvent = createPastEvent();

/**
 * Event API response envelope per EVENT_CONTRACT.md v2.0
 * Returns canonical event shape (flat, no nested data object)
 */
const createEventResponse = (eventData, id = null) => {
  const eventId = id || generateEventId();
  const slug = eventData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = new Date().toISOString();

  return {
    ok: true,
    value: {
      // MVP Required - Identity
      id: eventId,
      slug: slug,
      name: eventData.name,
      startDateISO: eventData.startDateISO || eventData.dateISO || '2025-12-01',
      venue: eventData.venue || eventData.location || 'Test Venue',

      // MVP Required - Links
      links: {
        publicUrl: `${BASE_URL}?page=events&brand=${BRAND_ID}&id=${eventId}`,
        displayUrl: `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${eventId}&tv=1`,
        posterUrl: `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${eventId}`,
        signupUrl: eventData.ctas?.primary?.url || ''
      },

      // MVP Required - QR Codes
      qr: {
        public: 'data:image/png;base64,iVBORw0KGgo...',
        signup: eventData.ctas?.primary?.url ? 'data:image/png;base64,iVBORw0KGgo...' : ''
      },

      // MVP Required - CTAs
      ctas: eventData.ctas || {
        primary: { label: 'Sign Up', url: '' },
        secondary: null
      },

      // MVP Required - Settings
      settings: eventData.settings || {
        showSchedule: false,
        showStandings: false,
        showBracket: false,
        showSponsors: false
      },

      // MVP Optional
      schedule: eventData.schedule || null,
      standings: eventData.standings || null,
      bracket: eventData.bracket || null,

      // V2 Optional
      sponsors: eventData.sponsors || [],
      media: eventData.media || {},
      externalData: eventData.externalData || {},
      analytics: eventData.analytics || { enabled: false },
      payments: eventData.payments || { enabled: false },

      // MVP Required - Timestamps
      createdAtISO: now,
      updatedAtISO: now
    }
  };
};

/**
 * Event list response per EVENT_CONTRACT.md v2.0
 */
const createEventListResponse = (events = []) => ({
  ok: true,
  etag: `etag-${Date.now()}`,
  value: {
    items: events.map((event, index) => {
      const eventId = event.id || generateEventId();
      const createdAt = new Date(Date.now() - index * 86400000).toISOString();

      return {
        // MVP Required - Identity
        id: eventId,
        slug: event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: event.name,
        startDateISO: event.startDateISO || event.dateISO || '2025-12-01',
        venue: event.venue || event.location || 'Test Venue',

        // MVP Required - Links
        links: {
          publicUrl: `${BASE_URL}?page=events&brand=${BRAND_ID}&id=${eventId}`,
          displayUrl: `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${eventId}&tv=1`,
          posterUrl: `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${eventId}`,
          signupUrl: event.ctas?.primary?.url || ''
        },

        // MVP Required - QR Codes
        qr: {
          public: 'data:image/png;base64,iVBORw0KGgo...',
          signup: ''
        },

        // MVP Required - CTAs
        ctas: event.ctas || {
          primary: { label: 'Sign Up', url: '' },
          secondary: null
        },

        // MVP Required - Settings
        settings: event.settings || {
          showSchedule: false,
          showStandings: false,
          showBracket: false,
          showSponsors: false
        },

        // V2 Optional
        sponsors: event.sponsors || [],
        media: event.media || {},
        externalData: event.externalData || {},
        analytics: event.analytics || { enabled: false },
        payments: event.payments || { enabled: false },

        // Timestamps
        createdAtISO: createdAt,
        updatedAtISO: createdAt
      };
    }),
    pagination: {
      total: events.length,
      limit: 100,
      offset: 0,
      hasMore: false
    }
  }
});

/**
 * Invalid event fixtures (for validation testing) - v2.0
 */
const invalidEvents = {
  missingName: {
    startDateISO: '2025-12-15',
    venue: 'Test Venue'
  },
  missingStartDateISO: {
    name: 'Event Without Date',
    venue: 'Test Venue'
  },
  missingVenue: {
    name: 'Event Without Venue',
    startDateISO: '2025-12-15'
  },
  invalidDateFormat: {
    name: 'Invalid Date Event',
    startDateISO: '12/15/2025',  // Wrong format (should be YYYY-MM-DD)
    venue: 'Test Venue'
  },
  emptyName: {
    name: '',
    startDateISO: '2025-12-15',
    venue: 'Test Venue'
  },
  emptyVenue: {
    name: 'Event with Empty Venue',
    startDateISO: '2025-12-15',
    venue: ''
  }
};

module.exports = {
  // Generators
  generateEventName,
  generateEventId,

  // Builder Pattern (RECOMMENDED - v2.0 compliant)
  EventBuilder,

  // Factory Functions (RECOMMENDED - v2.0 compliant)
  createBasicEvent,
  createCompleteEvent,
  createEventWithSponsors,
  createEventWithDisplay,
  createPastEvent,

  // DEPRECATED fixtures (use factory functions instead)
  basicEvent,
  completeEvent,
  eventWithSponsors,
  eventWithDisplay,
  pastEvent,

  // Response builders (v2.0 compliant)
  createEventResponse,
  createEventListResponse,

  // Invalid data (v2.0 field names)
  invalidEvents,

  // Constants
  BASE_URL,
  BRAND_ID
};
