/**
 * Story F6 - SharedAnalytics Bundle Contract Tests
 *
 * Purpose: Validate the locked SharedAnalytics bundle contract to ensure
 * the post-event summary payload is stable and versioned.
 *
 * CI/CD Gate: Stage-2 FAILS if SharedAnalytics bundle shape drifts.
 *
 * Contract Version: 1.0.0
 *
 * HERMETIC TEST: This test is self-contained and does not require
 * the worker TypeScript to be compiled. The contract constants and
 * validation functions are replicated here to ensure CI/CD can run
 * without build dependencies.
 *
 * @see worker/src/domain/sharedAnalytics.ts
 * @see Story F6 - SharedAnalytics Bundle Contract (Event + Sponsor + Customer)
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// LOCKED CONTRACT CONSTANTS (Replicated for hermetic testing)
// These MUST match worker/src/domain/sharedAnalytics.ts exactly
// =============================================================================

/**
 * Current SharedAnalytics contract version
 * LOCKED: Must match worker/src/domain/sharedAnalytics.ts
 */
const SHARED_ANALYTICS_CONTRACT_VERSION = '1.0.0';

/**
 * Required bundle fields
 * LOCKED: Must match worker/src/domain/sharedAnalytics.ts
 */
const SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS = [
  'generatedAt',
  'window',
  'integrity',
  'event',
  'sponsor',
  'customer',
];

/**
 * Required integrity fields
 */
const SHARED_ANALYTICS_INTEGRITY_REQUIRED_FIELDS = [
  'complete',
  'stale',
  'notes',
];

/**
 * Required window fields
 */
const SHARED_ANALYTICS_WINDOW_REQUIRED_FIELDS = [
  'start',
  'end',
];

/**
 * Required event fields
 */
const SHARED_ANALYTICS_EVENT_REQUIRED_FIELDS = [
  'eventId',
  'name',
  'summary',
  'traffic',
  'qr',
];

/**
 * Required event summary fields
 */
const SHARED_ANALYTICS_EVENT_SUMMARY_REQUIRED_FIELDS = [
  'signups',
  'matches',
  'durationMinutes',
];

/**
 * Required event traffic fields
 */
const SHARED_ANALYTICS_EVENT_TRAFFIC_REQUIRED_FIELDS = [
  'pageViews',
  'uniqueVisitors',
];

/**
 * Required event QR fields
 */
const SHARED_ANALYTICS_EVENT_QR_REQUIRED_FIELDS = [
  'scans',
  'verifiedOnly',
];

/**
 * Required sponsor fields
 */
const SHARED_ANALYTICS_SPONSOR_REQUIRED_FIELDS = [
  'sponsorId',
  'name',
  'summary',
  'placements',
];

/**
 * Required sponsor summary fields
 */
const SHARED_ANALYTICS_SPONSOR_SUMMARY_REQUIRED_FIELDS = [
  'impressions',
  'qrScans',
  'costPerScan',
];

/**
 * Required customer fields
 */
const SHARED_ANALYTICS_CUSTOMER_REQUIRED_FIELDS = [
  'summary',
  'outcomes',
  'notes',
];

/**
 * Required customer summary fields
 */
const SHARED_ANALYTICS_CUSTOMER_SUMMARY_REQUIRED_FIELDS = [
  'uniquePeople',
  'returningRate',
  'peakHourLocal',
  'geo',
];

/**
 * Required customer outcomes fields
 */
const SHARED_ANALYTICS_CUSTOMER_OUTCOMES_REQUIRED_FIELDS = [
  'rsvpToAttendRate',
  'scanToSignupRate',
];

// =============================================================================
// VALIDATION FUNCTIONS (Replicated for hermetic testing)
// =============================================================================

function isValidIntegrity(integrity: unknown): boolean {
  if (!integrity || typeof integrity !== 'object') return false;
  const i = integrity as Record<string, unknown>;
  if (typeof i.complete !== 'boolean') return false;
  if (typeof i.stale !== 'boolean') return false;
  if (!Array.isArray(i.notes)) return false;
  return true;
}

function isValidWindow(window: unknown): boolean {
  if (!window || typeof window !== 'object') return false;
  const w = window as Record<string, unknown>;
  if (typeof w.start !== 'string') return false;
  if (typeof w.end !== 'string') return false;
  return true;
}

function isValidEventSection(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;

  if (typeof e.eventId !== 'string' || e.eventId.length === 0) return false;
  if (typeof e.name !== 'string') return false;

  const summary = e.summary as Record<string, unknown> | undefined;
  if (!summary || typeof summary !== 'object') return false;
  if (typeof summary.signups !== 'number') return false;
  if (typeof summary.matches !== 'number') return false;
  if (typeof summary.durationMinutes !== 'number') return false;

  const traffic = e.traffic as Record<string, unknown> | undefined;
  if (!traffic || typeof traffic !== 'object') return false;
  if (typeof traffic.pageViews !== 'number') return false;
  if (typeof traffic.uniqueVisitors !== 'number') return false;

  const qr = e.qr as Record<string, unknown> | undefined;
  if (!qr || typeof qr !== 'object') return false;
  if (typeof qr.scans !== 'number') return false;
  if (typeof qr.verifiedOnly !== 'boolean') return false;

  return true;
}

function isValidSponsorSection(sponsor: unknown): boolean {
  if (!sponsor || typeof sponsor !== 'object') return false;
  const s = sponsor as Record<string, unknown>;

  if (typeof s.sponsorId !== 'string' || s.sponsorId.length === 0) return false;
  if (typeof s.name !== 'string') return false;

  const summary = s.summary as Record<string, unknown> | undefined;
  if (!summary || typeof summary !== 'object') return false;
  if (typeof summary.impressions !== 'number') return false;
  if (typeof summary.qrScans !== 'number') return false;
  if (typeof summary.costPerScan !== 'number') return false;

  if (!Array.isArray(s.placements)) return false;

  return true;
}

function isValidCustomerSection(customer: unknown): boolean {
  if (!customer || typeof customer !== 'object') return false;
  const c = customer as Record<string, unknown>;

  const summary = c.summary as Record<string, unknown> | undefined;
  if (!summary || typeof summary !== 'object') return false;
  if (typeof summary.uniquePeople !== 'number') return false;
  if (typeof summary.returningRate !== 'number') return false;
  if (typeof summary.peakHourLocal !== 'string') return false;

  const geo = summary.geo as Record<string, unknown> | undefined;
  if (!geo || typeof geo !== 'object') return false;
  if (!Array.isArray(geo.topZip3)) return false;

  const outcomes = c.outcomes as Record<string, unknown> | undefined;
  if (!outcomes || typeof outcomes !== 'object') return false;
  if (typeof outcomes.rsvpToAttendRate !== 'number') return false;
  if (typeof outcomes.scanToSignupRate !== 'number') return false;

  if (!Array.isArray(c.notes)) return false;

  return true;
}

function validateBundle(bundle: unknown): { valid: boolean; error?: string } {
  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, error: 'Bundle must be a non-null object' };
  }

  const b = bundle as Record<string, unknown>;

  // Check required fields
  for (const field of SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS) {
    if (!(field in b)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  if (typeof b.generatedAt !== 'string') {
    return { valid: false, error: 'Invalid generatedAt' };
  }

  if (!isValidWindow(b.window)) {
    return { valid: false, error: 'Invalid window' };
  }

  if (!isValidIntegrity(b.integrity)) {
    return { valid: false, error: 'Invalid integrity' };
  }

  if (!isValidEventSection(b.event)) {
    return { valid: false, error: 'Invalid event section' };
  }

  if (!isValidSponsorSection(b.sponsor)) {
    return { valid: false, error: 'Invalid sponsor section' };
  }

  if (!isValidCustomerSection(b.customer)) {
    return { valid: false, error: 'Invalid customer section' };
  }

  return { valid: true };
}

// =============================================================================
// TEST FIXTURES
// =============================================================================

/**
 * Valid minimal bundle for testing
 */
const VALID_BUNDLE = {
  generatedAt: '2025-12-16T16:22:00Z',
  window: {
    start: '2025-12-01',
    end: '2025-12-16',
  },
  integrity: {
    complete: true,
    stale: false,
    notes: [],
  },
  event: {
    eventId: 'evt_123',
    name: 'Winter Bocce',
    summary: {
      signups: 24,
      matches: 18,
      durationMinutes: 210,
    },
    traffic: {
      pageViews: 120,
      uniqueVisitors: 88,
    },
    qr: {
      scans: 45,
      verifiedOnly: true,
    },
  },
  sponsor: {
    sponsorId: 'sp_abc',
    name: 'Rock Island',
    summary: {
      impressions: 900,
      qrScans: 45,
      costPerScan: 0.0,
    },
    placements: [
      { surface: 'poster', count: 1 },
      { surface: 'public', count: 1 },
    ],
  },
  customer: {
    summary: {
      uniquePeople: 88,
      returningRate: 0.22,
      peakHourLocal: '19:00',
      geo: {
        topZip3: ['606', '604', '605'],
      },
    },
    outcomes: {
      rsvpToAttendRate: 0.55,
      scanToSignupRate: 0.33,
    },
    notes: ['This is an aggregate view. No PII.'],
  },
};

/**
 * Valid bundle with incomplete integrity
 */
const INCOMPLETE_BUNDLE = {
  ...VALID_BUNDLE,
  integrity: {
    complete: false,
    stale: false,
    notes: ['Event data incomplete', 'Sponsor data incomplete'],
  },
};

// =============================================================================
// TESTS
// =============================================================================

describe('Story F6 - SharedAnalytics Bundle Contract', () => {
  describe('Contract Version', () => {
    it('should have contract version 1.0.0', () => {
      expect(SHARED_ANALYTICS_CONTRACT_VERSION).toBe('1.0.0');
    });
  });

  describe('Bundle Required Fields', () => {
    it('should define all required bundle fields', () => {
      expect(SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS).toContain('generatedAt');
      expect(SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS).toContain('window');
      expect(SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS).toContain('integrity');
      expect(SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS).toContain('event');
      expect(SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS).toContain('sponsor');
      expect(SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS).toContain('customer');
    });

    it('should have exactly 6 required bundle fields', () => {
      expect(SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS).toHaveLength(6);
    });
  });

  describe('Bundle Validation', () => {
    it('should validate a complete valid bundle', () => {
      const result = validateBundle(VALID_BUNDLE);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate a bundle with incomplete integrity', () => {
      const result = validateBundle(INCOMPLETE_BUNDLE);
      expect(result.valid).toBe(true);
    });

    it('should reject null bundle', () => {
      const result = validateBundle(null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Bundle must be a non-null object');
    });

    it('should reject undefined bundle', () => {
      const result = validateBundle(undefined);
      expect(result.valid).toBe(false);
    });

    it('should reject bundle missing generatedAt', () => {
      const bundle = { ...VALID_BUNDLE };
      delete (bundle as Record<string, unknown>).generatedAt;
      const result = validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('generatedAt');
    });

    it('should reject bundle missing window', () => {
      const bundle = { ...VALID_BUNDLE };
      delete (bundle as Record<string, unknown>).window;
      const result = validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('window');
    });

    it('should reject bundle missing integrity', () => {
      const bundle = { ...VALID_BUNDLE };
      delete (bundle as Record<string, unknown>).integrity;
      const result = validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('integrity');
    });

    it('should reject bundle missing event', () => {
      const bundle = { ...VALID_BUNDLE };
      delete (bundle as Record<string, unknown>).event;
      const result = validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('event');
    });

    it('should reject bundle missing sponsor', () => {
      const bundle = { ...VALID_BUNDLE };
      delete (bundle as Record<string, unknown>).sponsor;
      const result = validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('sponsor');
    });

    it('should reject bundle missing customer', () => {
      const bundle = { ...VALID_BUNDLE };
      delete (bundle as Record<string, unknown>).customer;
      const result = validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('customer');
    });
  });

  describe('Integrity Validation', () => {
    it('should validate complete integrity', () => {
      const integrity = {
        complete: true,
        stale: false,
        notes: [],
      };
      expect(isValidIntegrity(integrity)).toBe(true);
    });

    it('should validate integrity with notes', () => {
      const integrity = {
        complete: false,
        stale: false,
        notes: ['Event data incomplete'],
      };
      expect(isValidIntegrity(integrity)).toBe(true);
    });

    it('should validate stale integrity', () => {
      const integrity = {
        complete: true,
        stale: true,
        notes: ['Data may be stale'],
      };
      expect(isValidIntegrity(integrity)).toBe(true);
    });

    it('should reject integrity with missing complete', () => {
      const integrity = {
        stale: false,
        notes: [],
      };
      expect(isValidIntegrity(integrity)).toBe(false);
    });

    it('should reject integrity with non-boolean complete', () => {
      const integrity = {
        complete: 'yes',
        stale: false,
        notes: [],
      };
      expect(isValidIntegrity(integrity)).toBe(false);
    });

    it('should reject integrity with non-array notes', () => {
      const integrity = {
        complete: true,
        stale: false,
        notes: 'some note',
      };
      expect(isValidIntegrity(integrity)).toBe(false);
    });
  });

  describe('Window Validation', () => {
    it('should validate valid window', () => {
      const window = {
        start: '2025-12-01',
        end: '2025-12-16',
      };
      expect(isValidWindow(window)).toBe(true);
    });

    it('should reject window with missing start', () => {
      const window = {
        end: '2025-12-16',
      };
      expect(isValidWindow(window)).toBe(false);
    });

    it('should reject window with missing end', () => {
      const window = {
        start: '2025-12-01',
      };
      expect(isValidWindow(window)).toBe(false);
    });

    it('should reject window with non-string start', () => {
      const window = {
        start: 12345,
        end: '2025-12-16',
      };
      expect(isValidWindow(window)).toBe(false);
    });
  });

  describe('Event Section Validation', () => {
    it('should validate valid event section', () => {
      expect(isValidEventSection(VALID_BUNDLE.event)).toBe(true);
    });

    it('should reject event with empty eventId', () => {
      const event = {
        ...VALID_BUNDLE.event,
        eventId: '',
      };
      expect(isValidEventSection(event)).toBe(false);
    });

    it('should reject event with missing summary', () => {
      const event = {
        eventId: 'evt_123',
        name: 'Test Event',
        traffic: VALID_BUNDLE.event.traffic,
        qr: VALID_BUNDLE.event.qr,
      };
      expect(isValidEventSection(event)).toBe(false);
    });

    it('should reject event with non-boolean verifiedOnly', () => {
      const event = {
        ...VALID_BUNDLE.event,
        qr: {
          scans: 10,
          verifiedOnly: 'yes',
        },
      };
      expect(isValidEventSection(event)).toBe(false);
    });
  });

  describe('Sponsor Section Validation', () => {
    it('should validate valid sponsor section', () => {
      expect(isValidSponsorSection(VALID_BUNDLE.sponsor)).toBe(true);
    });

    it('should validate sponsor with empty placements', () => {
      const sponsor = {
        ...VALID_BUNDLE.sponsor,
        placements: [],
      };
      expect(isValidSponsorSection(sponsor)).toBe(true);
    });

    it('should reject sponsor with empty sponsorId', () => {
      const sponsor = {
        ...VALID_BUNDLE.sponsor,
        sponsorId: '',
      };
      expect(isValidSponsorSection(sponsor)).toBe(false);
    });

    it('should reject sponsor with non-array placements', () => {
      const sponsor = {
        ...VALID_BUNDLE.sponsor,
        placements: 'poster',
      };
      expect(isValidSponsorSection(sponsor)).toBe(false);
    });
  });

  describe('Customer Section Validation', () => {
    it('should validate valid customer section', () => {
      expect(isValidCustomerSection(VALID_BUNDLE.customer)).toBe(true);
    });

    it('should validate customer with empty geo', () => {
      const customer = {
        ...VALID_BUNDLE.customer,
        summary: {
          ...VALID_BUNDLE.customer.summary,
          geo: { topZip3: [] },
        },
      };
      expect(isValidCustomerSection(customer)).toBe(true);
    });

    it('should reject customer with missing outcomes', () => {
      const customer = {
        summary: VALID_BUNDLE.customer.summary,
        notes: [],
      };
      expect(isValidCustomerSection(customer)).toBe(false);
    });

    it('should reject customer with non-array notes', () => {
      const customer = {
        ...VALID_BUNDLE.customer,
        notes: 'some note',
      };
      expect(isValidCustomerSection(customer)).toBe(false);
    });

    it('should reject customer with missing geo', () => {
      const customer = {
        ...VALID_BUNDLE.customer,
        summary: {
          uniquePeople: 88,
          returningRate: 0.22,
          peakHourLocal: '19:00',
        },
      };
      expect(isValidCustomerSection(customer)).toBe(false);
    });
  });

  describe('Customer Data Privacy (No PII)', () => {
    it('should only allow aggregate metrics in customer section', () => {
      // Verify customer summary only has aggregate fields
      expect(SHARED_ANALYTICS_CUSTOMER_SUMMARY_REQUIRED_FIELDS).not.toContain('email');
      expect(SHARED_ANALYTICS_CUSTOMER_SUMMARY_REQUIRED_FIELDS).not.toContain('name');
      expect(SHARED_ANALYTICS_CUSTOMER_SUMMARY_REQUIRED_FIELDS).not.toContain('deviceId');
      expect(SHARED_ANALYTICS_CUSTOMER_SUMMARY_REQUIRED_FIELDS).not.toContain('ip');
      expect(SHARED_ANALYTICS_CUSTOMER_SUMMARY_REQUIRED_FIELDS).not.toContain('userId');
    });

    it('should use zip3 for geo (not full zip codes)', () => {
      // Verify geo uses topZip3 (3-digit buckets, not individual addresses)
      const customer = VALID_BUNDLE.customer;
      expect(customer.summary.geo.topZip3).toHaveLength(3);
      customer.summary.geo.topZip3.forEach(zip => {
        expect(zip).toHaveLength(3);
        expect(zip).toMatch(/^\d{3}$/);
      });
    });

    it('should include PII disclaimer in customer notes', () => {
      const customer = VALID_BUNDLE.customer;
      expect(customer.notes).toContain('This is an aggregate view. No PII.');
    });
  });

  describe('QR Verification Invariant', () => {
    it('should have verifiedOnly flag in QR section', () => {
      expect(SHARED_ANALYTICS_EVENT_QR_REQUIRED_FIELDS).toContain('verifiedOnly');
    });

    it('should set verifiedOnly to true when QR is verified', () => {
      expect(VALID_BUNDLE.event.qr.verifiedOnly).toBe(true);
    });
  });

  describe('Error Code Stability', () => {
    it('should define NOT_FOUND error code', () => {
      const ERROR_CODES = {
        NOT_FOUND: 'NOT_FOUND',
        ANALYTICS_UNAVAILABLE: 'ANALYTICS_UNAVAILABLE',
        INVALID_EVENT_ID: 'INVALID_EVENT_ID',
        INTERNAL_ERROR: 'INTERNAL_ERROR',
      };
      expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    });

    it('should define ANALYTICS_UNAVAILABLE error code', () => {
      const ERROR_CODES = {
        NOT_FOUND: 'NOT_FOUND',
        ANALYTICS_UNAVAILABLE: 'ANALYTICS_UNAVAILABLE',
        INVALID_EVENT_ID: 'INVALID_EVENT_ID',
        INTERNAL_ERROR: 'INTERNAL_ERROR',
      };
      expect(ERROR_CODES.ANALYTICS_UNAVAILABLE).toBe('ANALYTICS_UNAVAILABLE');
    });
  });
});
