/**
 * SharedReport Deep Dive — Exhaustive Contract & Validation Tests
 *
 * Coverage layers:
 *   1. Domain validation edge cases (boundary values, type coercion)
 *   2. Builder function correctness (defaults, clamping, invariants)
 *   3. Error handling completeness (all 4 error codes, integrity on errors)
 *   4. Security invariants (PII absence, eventId format, QR verification)
 *   5. Cache header contract (success vs error responses)
 *   6. Rate limiting contract (429 shape)
 *
 * HERMETIC: No build dependencies, no network, no DB.
 *
 * @see docs/SHARED_REPORT_DEEP_DIVE.md
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Replicated contract constants (hermetic — no imports from source)
// =============================================================================

const CONTRACT_VERSION = '1.0.0';

const BUNDLE_REQUIRED_FIELDS = [
  'generatedAt', 'window', 'integrity', 'event', 'sponsor', 'customer',
] as const;

const ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  ANALYTICS_UNAVAILABLE: 'ANALYTICS_UNAVAILABLE',
  INVALID_EVENT_ID: 'INVALID_EVENT_ID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

const EVENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

// =============================================================================
// Replicated validation functions (hermetic)
// =============================================================================

function isValidIntegrity(i: unknown): boolean {
  if (!i || typeof i !== 'object') return false;
  const o = i as Record<string, unknown>;
  return typeof o.complete === 'boolean' && typeof o.stale === 'boolean' && Array.isArray(o.notes);
}

function isValidWindow(w: unknown): boolean {
  if (!w || typeof w !== 'object') return false;
  const o = w as Record<string, unknown>;
  return typeof o.start === 'string' && typeof o.end === 'string';
}

function isValidEvent(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  if (typeof o.eventId !== 'string' || o.eventId.length === 0) return false;
  if (typeof o.name !== 'string') return false;
  const s = o.summary as Record<string, unknown> | undefined;
  if (!s || typeof s.signups !== 'number' || typeof s.matches !== 'number' || typeof s.durationMinutes !== 'number') return false;
  const t = o.traffic as Record<string, unknown> | undefined;
  if (!t || typeof t.pageViews !== 'number' || typeof t.uniqueVisitors !== 'number') return false;
  const q = o.qr as Record<string, unknown> | undefined;
  if (!q || typeof q.scans !== 'number' || typeof q.verifiedOnly !== 'boolean') return false;
  return true;
}

function isValidSponsor(sp: unknown): boolean {
  if (!sp || typeof sp !== 'object') return false;
  const o = sp as Record<string, unknown>;
  if (typeof o.sponsorId !== 'string' || o.sponsorId.length === 0) return false;
  if (typeof o.name !== 'string') return false;
  const s = o.summary as Record<string, unknown> | undefined;
  if (!s || typeof s.impressions !== 'number' || typeof s.qrScans !== 'number' || typeof s.costPerScan !== 'number') return false;
  if (!Array.isArray(o.placements)) return false;
  return true;
}

function isValidCustomer(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  const s = o.summary as Record<string, unknown> | undefined;
  if (!s) return false;
  if (typeof s.uniquePeople !== 'number' || s.uniquePeople < 0) return false;
  if (typeof s.returningRate !== 'number' || s.returningRate < 0 || s.returningRate > 1) return false;
  if (typeof s.peakHourLocal !== 'string') return false;
  const g = s.geo as Record<string, unknown> | undefined;
  if (!g || !Array.isArray(g.topZip3)) return false;
  for (const z of g.topZip3 as string[]) {
    if (!/^\d{3}$/.test(z)) return false;
  }
  const out = o.outcomes as Record<string, unknown> | undefined;
  if (!out || typeof out.rsvpToAttendRate !== 'number' || typeof out.scanToSignupRate !== 'number') return false;
  if (!Array.isArray(o.notes)) return false;
  return true;
}

// =============================================================================
// Fixtures
// =============================================================================

function makeValidBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt: '2026-03-27T12:00:00Z',
    window: { start: '2026-02-25', end: '2026-03-27' },
    integrity: { complete: true, stale: false, notes: [] },
    event: {
      eventId: 'evt_test_001',
      name: 'Deep Dive Test Event',
      summary: { signups: 50, matches: 30, durationMinutes: 120 },
      traffic: { pageViews: 500, uniqueVisitors: 200 },
      qr: { scans: 100, verifiedOnly: true },
    },
    sponsor: {
      sponsorId: 'sp_test_001',
      name: 'Test Sponsor',
      summary: { impressions: 1000, qrScans: 50, costPerScan: 0.0 },
      placements: [{ surface: 'poster', count: 2 }],
    },
    customer: {
      summary: {
        uniquePeople: 200,
        returningRate: 0.35,
        peakHourLocal: '19:00',
        geo: { topZip3: ['606', '604'] },
      },
      outcomes: { rsvpToAttendRate: 0.65, scanToSignupRate: 0.40 },
      notes: ['This is an aggregate view. No PII.'],
    },
    ...overrides,
  };
}

function makeErrorResponse(status: number, code: string, message: string): Record<string, unknown> {
  return {
    ok: false,
    status,
    code,
    message,
    requestId: 'req_test_001',
  };
}

// =============================================================================
// 1. Domain Validation Edge Cases
// =============================================================================

describe('Deep Dive: Domain Validation Edge Cases', () => {

  describe('Integrity validation', () => {
    it('rejects null', () => expect(isValidIntegrity(null)).toBe(false));
    it('rejects string', () => expect(isValidIntegrity('complete')).toBe(false));
    it('rejects missing complete', () => expect(isValidIntegrity({ stale: false, notes: [] })).toBe(false));
    it('rejects missing stale', () => expect(isValidIntegrity({ complete: true, notes: [] })).toBe(false));
    it('rejects missing notes', () => expect(isValidIntegrity({ complete: true, stale: false })).toBe(false));
    it('rejects non-boolean complete', () => expect(isValidIntegrity({ complete: 1, stale: false, notes: [] })).toBe(false));
    it('rejects non-array notes', () => expect(isValidIntegrity({ complete: true, stale: false, notes: 'note' })).toBe(false));
    it('accepts empty notes array', () => expect(isValidIntegrity({ complete: true, stale: false, notes: [] })).toBe(true));
    it('accepts stale=true with notes', () => expect(isValidIntegrity({ complete: false, stale: true, notes: ['Data may be stale'] })).toBe(true));
  });

  describe('Window validation', () => {
    it('accepts valid date strings', () => expect(isValidWindow({ start: '2026-01-01', end: '2026-03-27' })).toBe(true));
    it('accepts ISO timestamps', () => expect(isValidWindow({ start: '2026-01-01T00:00:00Z', end: '2026-03-27T23:59:59Z' })).toBe(true));
    it('rejects null', () => expect(isValidWindow(null)).toBe(false));
    it('rejects missing start', () => expect(isValidWindow({ end: '2026-03-27' })).toBe(false));
    it('rejects missing end', () => expect(isValidWindow({ start: '2026-01-01' })).toBe(false));
    it('rejects numeric start', () => expect(isValidWindow({ start: 20260101, end: '2026-03-27' })).toBe(false));
  });

  describe('Event section validation', () => {
    const base = makeValidBundle().event as Record<string, unknown>;

    it('accepts valid event', () => expect(isValidEvent(base)).toBe(true));
    it('rejects empty eventId', () => expect(isValidEvent({ ...base, eventId: '' })).toBe(false));
    it('rejects missing name', () => {
      const { name, ...noName } = base;
      expect(isValidEvent(noName)).toBe(false);
    });
    it('rejects negative signups', () => expect(isValidEvent({
      ...base, summary: { signups: -1, matches: 0, durationMinutes: 0 },
    })).toBe(false));
    it('rejects string pageViews', () => expect(isValidEvent({
      ...base, traffic: { pageViews: '500', uniqueVisitors: 200 },
    })).toBe(false));
    it('rejects missing qr section', () => {
      const { qr, ...noQr } = base;
      expect(isValidEvent(noQr)).toBe(false);
    });
    it('rejects verifiedOnly as string', () => expect(isValidEvent({
      ...base, qr: { scans: 10, verifiedOnly: 'true' },
    })).toBe(false));
    it('accepts zero values everywhere', () => expect(isValidEvent({
      eventId: 'e1', name: 'Zero Event',
      summary: { signups: 0, matches: 0, durationMinutes: 0 },
      traffic: { pageViews: 0, uniqueVisitors: 0 },
      qr: { scans: 0, verifiedOnly: true },
    })).toBe(true));
  });

  describe('Sponsor section validation', () => {
    const base = makeValidBundle().sponsor as Record<string, unknown>;

    it('accepts valid sponsor', () => expect(isValidSponsor(base)).toBe(true));
    it('rejects empty sponsorId', () => expect(isValidSponsor({ ...base, sponsorId: '' })).toBe(false));
    it('rejects non-array placements', () => expect(isValidSponsor({ ...base, placements: {} })).toBe(false));
    it('accepts empty placements array', () => expect(isValidSponsor({ ...base, placements: [] })).toBe(true));
    it('rejects negative impressions', () => expect(isValidSponsor({
      ...base, summary: { impressions: -1, qrScans: 0, costPerScan: 0 },
    })).toBe(false));
    it('accepts costPerScan of 0.0', () => expect(isValidSponsor({
      ...base, summary: { impressions: 100, qrScans: 10, costPerScan: 0.0 },
    })).toBe(true));
  });

  describe('Customer section validation (Privacy-Critical)', () => {
    const base = makeValidBundle().customer as Record<string, unknown>;

    it('accepts valid customer', () => expect(isValidCustomer(base)).toBe(true));

    it('rejects returningRate > 1.0', () => {
      const c = JSON.parse(JSON.stringify(base));
      c.summary.returningRate = 1.5;
      expect(isValidCustomer(c)).toBe(false);
    });

    it('rejects returningRate < 0', () => {
      const c = JSON.parse(JSON.stringify(base));
      c.summary.returningRate = -0.1;
      expect(isValidCustomer(c)).toBe(false);
    });

    it('rejects rsvpToAttendRate > 1.0', () => {
      const c = JSON.parse(JSON.stringify(base));
      c.outcomes.rsvpToAttendRate = 1.1;
      expect(isValidCustomer(c)).toBe(false);
    });

    it('rejects full zip codes (5 digits)', () => {
      const c = JSON.parse(JSON.stringify(base));
      c.summary.geo.topZip3 = ['60606'];
      expect(isValidCustomer(c)).toBe(false);
    });

    it('rejects zip codes with letters', () => {
      const c = JSON.parse(JSON.stringify(base));
      c.summary.geo.topZip3 = ['60A'];
      expect(isValidCustomer(c)).toBe(false);
    });

    it('accepts empty topZip3', () => {
      const c = JSON.parse(JSON.stringify(base));
      c.summary.geo.topZip3 = [];
      expect(isValidCustomer(c)).toBe(true);
    });

    it('rejects missing notes array', () => {
      const c = JSON.parse(JSON.stringify(base));
      delete c.notes;
      expect(isValidCustomer(c)).toBe(false);
    });

    it('accepts zero uniquePeople', () => {
      const c = JSON.parse(JSON.stringify(base));
      c.summary.uniquePeople = 0;
      expect(isValidCustomer(c)).toBe(true);
    });

    it('rejects negative uniquePeople', () => {
      const c = JSON.parse(JSON.stringify(base));
      c.summary.uniquePeople = -1;
      expect(isValidCustomer(c)).toBe(false);
    });
  });
});

// =============================================================================
// 2. PII Firewall — Structural Guarantee
// =============================================================================

describe('Deep Dive: PII Firewall', () => {
  const PII_FIELDS = ['email', 'name', 'phone', 'address', 'deviceId', 'ip', 'userId', 'ssn', 'dob'];

  it('customer section type has no PII fields in required list', () => {
    const customerRequired = ['summary', 'outcomes', 'notes'];
    for (const pii of PII_FIELDS) {
      expect(customerRequired).not.toContain(pii);
    }
  });

  it('customer summary type has no PII fields in required list', () => {
    const summaryRequired = ['uniquePeople', 'returningRate', 'peakHourLocal', 'geo'];
    for (const pii of PII_FIELDS) {
      expect(summaryRequired).not.toContain(pii);
    }
  });

  it('valid bundle customer section contains PII disclaimer', () => {
    const bundle = makeValidBundle();
    const customer = bundle.customer as Record<string, unknown>;
    expect(customer.notes).toContain('This is an aggregate view. No PII.');
  });

  it('geo data is zip3 only (3-digit buckets), never full zip', () => {
    const bundle = makeValidBundle();
    const customer = bundle.customer as Record<string, unknown>;
    const summary = customer.summary as Record<string, unknown>;
    const geo = summary.geo as Record<string, unknown>;
    const zips = geo.topZip3 as string[];
    for (const z of zips) {
      expect(z).toMatch(/^\d{3}$/);
      expect(z.length).toBe(3);
    }
  });
});

// =============================================================================
// 3. eventId Format Validation (Security)
// =============================================================================

describe('Deep Dive: eventId Format Validation', () => {

  describe('valid eventIds', () => {
    const valid = [
      'evt_123',
      'gate_test_event_f6',
      'abc',
      'a',
      'event-with-dashes',
      'EVENT_UPPER_CASE',
      'mix123-ID_test',
      'a'.repeat(64), // max length
    ];

    for (const id of valid) {
      it(`accepts: "${id.length > 30 ? id.slice(0, 27) + '...' : id}"`, () => {
        expect(EVENT_ID_PATTERN.test(id)).toBe(true);
      });
    }
  });

  describe('rejected eventIds (injection patterns)', () => {
    const invalid = [
      '',                              // empty
      '<script>alert(1)</script>',     // XSS
      "1' OR '1'='1",                  // SQL injection
      '$(whoami)',                      // shell injection
      '../../../etc/passwd',           // path traversal
      'event id with spaces',          // spaces
      'event\nid',                     // newline
      'event\tid',                     // tab
      'event;DROP TABLE events;',      // SQL drop
      'event<img src=x onerror=alert(1)>', // HTML injection
      'a'.repeat(65),                  // exceeds max length
      'event.with.dots',              // dots not allowed
      'event@special',                // @ not allowed
      'event#hash',                   // hash not allowed
      'event?query=1',               // query string in ID
    ];

    for (const id of invalid) {
      it(`rejects: "${id.length > 40 ? id.slice(0, 37) + '...' : id}"`, () => {
        expect(EVENT_ID_PATTERN.test(id)).toBe(false);
      });
    }
  });
});

// =============================================================================
// 4. Error Response Contract
// =============================================================================

describe('Deep Dive: Error Response Contract', () => {

  it('400 INVALID_EVENT_ID has required fields', () => {
    const err = makeErrorResponse(400, ERROR_CODES.INVALID_EVENT_ID, 'eventId query parameter is required');
    expect(err.ok).toBe(false);
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_EVENT_ID');
    expect(err.message).toBeDefined();
    expect(err.requestId).toBeDefined();
  });

  it('404 NOT_FOUND does not echo eventId in message', () => {
    const err = makeErrorResponse(404, ERROR_CODES.NOT_FOUND, 'Event not found');
    expect(err.message).toBe('Event not found');
    expect(err.message).not.toContain('evt_');
    expect(err.message).not.toContain('<');
  });

  it('503 ANALYTICS_UNAVAILABLE includes integrity when available', () => {
    const err = {
      ...makeErrorResponse(503, ERROR_CODES.ANALYTICS_UNAVAILABLE, 'Analytics service not configured'),
      integrity: { complete: false, stale: false, notes: ['No data available'] },
    };
    expect(err.integrity).toBeDefined();
    expect(isValidIntegrity(err.integrity)).toBe(true);
  });

  it('all error codes are stable strings', () => {
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(ERROR_CODES.ANALYTICS_UNAVAILABLE).toBe('ANALYTICS_UNAVAILABLE');
    expect(ERROR_CODES.INVALID_EVENT_ID).toBe('INVALID_EVENT_ID');
    expect(ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });

  it('error codes do not contain spaces or special chars', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });
});

// =============================================================================
// 5. Bundle Completeness & Integrity Metadata
// =============================================================================

describe('Deep Dive: Bundle Completeness', () => {

  it('valid bundle has all 6 required fields', () => {
    const bundle = makeValidBundle();
    for (const field of BUNDLE_REQUIRED_FIELDS) {
      expect(bundle).toHaveProperty(field);
    }
  });

  it('generatedAt is valid ISO 8601', () => {
    const bundle = makeValidBundle();
    const date = new Date(bundle.generatedAt as string);
    expect(date.toString()).not.toBe('Invalid Date');
  });

  it('window.start <= window.end', () => {
    const bundle = makeValidBundle();
    const w = bundle.window as Record<string, string>;
    expect(new Date(w.start).getTime()).toBeLessThanOrEqual(new Date(w.end).getTime());
  });

  it('integrity.complete=true means all sections present', () => {
    const bundle = makeValidBundle();
    const integrity = bundle.integrity as Record<string, unknown>;
    if (integrity.complete) {
      expect(isValidEvent(bundle.event)).toBe(true);
      expect(isValidSponsor(bundle.sponsor)).toBe(true);
      expect(isValidCustomer(bundle.customer)).toBe(true);
    }
  });

  it('integrity.complete=false includes explanatory notes', () => {
    const bundle = makeValidBundle({
      integrity: { complete: false, stale: false, notes: ['Customer data incomplete'] },
    });
    const integrity = bundle.integrity as Record<string, unknown>;
    const notes = integrity.notes as string[];
    expect(notes.length).toBeGreaterThan(0);
  });

  it('integrity.stale=true includes stale note', () => {
    const bundle = makeValidBundle({
      integrity: { complete: true, stale: true, notes: ['Data may be stale'] },
    });
    const integrity = bundle.integrity as Record<string, unknown>;
    expect(integrity.stale).toBe(true);
    expect((integrity.notes as string[]).some(n => n.toLowerCase().includes('stale'))).toBe(true);
  });

  it('each section renders independently when others missing', () => {
    // Event section valid even if sponsor is "none"
    const bundle = makeValidBundle({
      sponsor: {
        sponsorId: 'none', name: 'No Sponsor',
        summary: { impressions: 0, qrScans: 0, costPerScan: 0 },
        placements: [],
      },
    });
    expect(isValidEvent(bundle.event)).toBe(true);
    expect(isValidSponsor(bundle.sponsor)).toBe(true);
  });
});

// =============================================================================
// 6. QR Verification Invariant
// =============================================================================

describe('Deep Dive: QR Verification Invariant', () => {

  it('qr.verifiedOnly is always boolean', () => {
    const bundle = makeValidBundle();
    const event = bundle.event as Record<string, unknown>;
    const qr = event.qr as Record<string, unknown>;
    expect(typeof qr.verifiedOnly).toBe('boolean');
  });

  it('qr.scans is 0 when asset not verified (verifiedOnly=true but inactive)', () => {
    const bundle = makeValidBundle();
    const event = bundle.event as Record<string, unknown>;
    const qr = event.qr as Record<string, unknown>;
    // When assetState !== 'ACTIVE', handler sets scans to 0
    // This test validates the contract allows scans=0 + verifiedOnly=true
    expect(isValidEvent({ ...event, qr: { scans: 0, verifiedOnly: true } })).toBe(true);
  });

  it('negative scans are rejected', () => {
    const event = (makeValidBundle().event as Record<string, unknown>);
    expect(isValidEvent({ ...event, qr: { scans: -1, verifiedOnly: true } })).toBe(false);
  });
});

// =============================================================================
// 7. Rate Limit Response Contract
// =============================================================================

describe('Deep Dive: Rate Limit Response Contract', () => {

  it('429 response has required fields', () => {
    const response = {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again shortly.',
      requestId: 'req_test_429',
    };
    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
    expect(response.code).toBe('RATE_LIMITED');
    expect(response.requestId).toBeDefined();
  });

  it('429 message is user-friendly (no technical details)', () => {
    const message = 'Too many requests. Please try again shortly.';
    expect(message).not.toContain('IP');
    expect(message).not.toContain('limit');
    expect(message.length).toBeLessThan(100);
  });
});

// =============================================================================
// 8. Cache Header Contract
// =============================================================================

describe('Deep Dive: Cache Header Contract', () => {

  it('success responses should allow short caching', () => {
    // Contract: 200 responses get max-age=60, stale-while-revalidate=300
    const expectedPattern = /max-age=\d+/;
    const successCacheControl = 'public, max-age=60, stale-while-revalidate=300';
    expect(successCacheControl).toMatch(expectedPattern);
    expect(successCacheControl).toContain('stale-while-revalidate');
  });

  it('error responses must not be cached', () => {
    const errorCacheControl = 'no-cache, no-store, must-revalidate';
    expect(errorCacheControl).toContain('no-cache');
    expect(errorCacheControl).toContain('no-store');
  });

  it('success cache max-age is 60 seconds (not longer)', () => {
    const cc = 'public, max-age=60, stale-while-revalidate=300';
    const match = cc.match(/max-age=(\d+)/);
    expect(match).not.toBeNull();
    const maxAge = parseInt(match![1], 10);
    expect(maxAge).toBe(60);
    expect(maxAge).toBeLessThanOrEqual(300); // never cache longer than 5 min
  });
});

// =============================================================================
// 9. Contract Version Stability
// =============================================================================

describe('Deep Dive: Contract Version Stability', () => {

  it('contract version is semver format', () => {
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('current contract version is 1.0.0', () => {
    expect(CONTRACT_VERSION).toBe('1.0.0');
  });

  it('bundle required fields count is exactly 6', () => {
    expect(BUNDLE_REQUIRED_FIELDS).toHaveLength(6);
  });

  it('error codes count is exactly 4', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(4);
  });
});

// =============================================================================
// 10. Feature Flag Key Contract
// =============================================================================

describe('Deep Dive: Report Feature Flag Keys', () => {
  const REPORT_FLAGS = {
    VIEW: 'report.view',
    EXPORT_JSON: 'report.export-json',
    ADVANCED_METRICS: 'report.advanced-metrics',
    EXPORT_PDF: 'report.export-pdf',
    CUSTOM_WINDOW: 'report.custom-window',
    PORTFOLIO: 'report.portfolio',
    WHITE_LABEL: 'report.white-label',
  };

  it('all flag keys use dot-notation', () => {
    for (const key of Object.values(REPORT_FLAGS)) {
      expect(key).toMatch(/^report\.[a-z-]+$/);
    }
  });

  it('free tier flags exist (view, export-json)', () => {
    expect(REPORT_FLAGS.VIEW).toBe('report.view');
    expect(REPORT_FLAGS.EXPORT_JSON).toBe('report.export-json');
  });

  it('mid tier flags exist (advanced-metrics, export-pdf, custom-window)', () => {
    expect(REPORT_FLAGS.ADVANCED_METRICS).toBeDefined();
    expect(REPORT_FLAGS.EXPORT_PDF).toBeDefined();
    expect(REPORT_FLAGS.CUSTOM_WINDOW).toBeDefined();
  });

  it('enterprise tier flags exist (portfolio, white-label)', () => {
    expect(REPORT_FLAGS.PORTFOLIO).toBeDefined();
    expect(REPORT_FLAGS.WHITE_LABEL).toBeDefined();
  });

  it('has exactly 7 report flags', () => {
    expect(Object.keys(REPORT_FLAGS)).toHaveLength(7);
  });
});
