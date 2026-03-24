/**
 * SharedAnalytics Domain Contract
 *
 * Story F6: SharedAnalytics Bundle Contract (Event + Sponsor + Customer)
 *
 * This module defines the locked contract for the unified post-event summary
 * payload. This becomes the case-study generator and monetization anchor.
 *
 * CONTRACT VERSION: 1.0.0
 * BREAKING CHANGE POLICY: Any field removal or type change requires version bump
 *
 * Purpose:
 *   - Single, trustworthy "post-event summary" payload
 *   - Supports SharedReport and can be emailed/shared later
 *   - Canonical "single report surface" for Event + Sponsor + Customer data
 *
 * Invariants (LOCKED):
 *   - Customer view must be aggregate-only (No PII, no device IDs, no raw IPs)
 *   - Bundle must include integrity metadata (generatedAt, window, integrity)
 *   - Each section renders even if others incomplete (with integrity messaging)
 *   - No QR is shown unless verified
 *
 * System Impacts:
 *   - Upstream: relies on event + sponsor analytics sources
 *   - Downstream: SharedReport becomes canonical single report surface
 *   - Contract Boundary: Bundle shape must be stable and versioned
 *
 * @module domain/sharedAnalytics
 * @see Story F6 - SharedAnalytics Bundle Contract (Event + Sponsor + Customer)
 */

// =============================================================================
// Contract Version
// =============================================================================

/**
 * Current SharedAnalytics contract version
 *
 * LOCKED CONTRACT - Increment for breaking changes:
 *   - Major: Field removed or type changed
 *   - Minor: New optional field added
 *   - Patch: Documentation or validation only
 */
export const SHARED_ANALYTICS_CONTRACT_VERSION = '1.0.0' as const;

// =============================================================================
// Types - Bundle Integrity
// =============================================================================

/**
 * Integrity metadata for the bundle
 *
 * LOCKED CONTRACT - Indicates data completeness and freshness
 */
export interface SharedAnalyticsIntegrity {
  /** Whether all data sources were available */
  complete: boolean;
  /** Whether data is considered stale (older than threshold) */
  stale: boolean;
  /** Notes about data availability or issues */
  notes: string[];
}

/**
 * Required integrity fields for validation
 */
export const SHARED_ANALYTICS_INTEGRITY_REQUIRED_FIELDS = [
  'complete',
  'stale',
  'notes',
] as const;

/**
 * Bundle window (aggregation period)
 */
export interface SharedAnalyticsWindow {
  /** Start of aggregation window (ISO 8601 date, e.g., "2025-12-01") */
  start: string;
  /** End of aggregation window (ISO 8601 date, e.g., "2025-12-16") */
  end: string;
}

/**
 * Required window fields for validation
 */
export const SHARED_ANALYTICS_WINDOW_REQUIRED_FIELDS = [
  'start',
  'end',
] as const;

// =============================================================================
// Types - Event Section
// =============================================================================

/**
 * Event summary metrics
 */
export interface SharedAnalyticsEventSummary {
  /** Number of signups/registrations */
  signups: number;
  /** Number of matches/games played */
  matches: number;
  /** Total event duration in minutes */
  durationMinutes: number;
}

/**
 * Event traffic metrics
 */
export interface SharedAnalyticsEventTraffic {
  /** Total page views */
  pageViews: number;
  /** Unique visitors */
  uniqueVisitors: number;
}

/**
 * Event QR metrics
 */
export interface SharedAnalyticsEventQR {
  /** Total QR code scans */
  scans: number;
  /** Whether only verified QR data is included */
  verifiedOnly: boolean;
}

/**
 * Event section of the bundle
 *
 * LOCKED CONTRACT - Event analytics data
 */
export interface SharedAnalyticsEvent {
  /** Event identifier */
  eventId: string;
  /** Event display name */
  name: string;
  /** Summary metrics */
  summary: SharedAnalyticsEventSummary;
  /** Traffic metrics */
  traffic: SharedAnalyticsEventTraffic;
  /** QR code metrics */
  qr: SharedAnalyticsEventQR;
}

/**
 * Required event fields for validation
 */
export const SHARED_ANALYTICS_EVENT_REQUIRED_FIELDS = [
  'eventId',
  'name',
  'summary',
  'traffic',
  'qr',
] as const;

/**
 * Required event summary fields for validation
 */
export const SHARED_ANALYTICS_EVENT_SUMMARY_REQUIRED_FIELDS = [
  'signups',
  'matches',
  'durationMinutes',
] as const;

/**
 * Required event traffic fields for validation
 */
export const SHARED_ANALYTICS_EVENT_TRAFFIC_REQUIRED_FIELDS = [
  'pageViews',
  'uniqueVisitors',
] as const;

/**
 * Required event QR fields for validation
 */
export const SHARED_ANALYTICS_EVENT_QR_REQUIRED_FIELDS = [
  'scans',
  'verifiedOnly',
] as const;

// =============================================================================
// Types - Sponsor Section
// =============================================================================

/**
 * Sponsor summary metrics
 */
export interface SharedAnalyticsSponsorSummary {
  /** Total impressions */
  impressions: number;
  /** Total QR scans attributed to sponsor */
  qrScans: number;
  /** Cost per scan (0.0 for MVP - billing not active) */
  costPerScan: number;
}

/**
 * Sponsor placement info
 */
export interface SharedAnalyticsSponsorPlacement {
  /** Surface type (e.g., "poster", "public", "display") */
  surface: string;
  /** Number of placements on this surface */
  count: number;
}

/**
 * Sponsor section of the bundle
 *
 * LOCKED CONTRACT - Sponsor analytics data
 */
export interface SharedAnalyticsSponsor {
  /** Sponsor identifier */
  sponsorId: string;
  /** Sponsor display name */
  name: string;
  /** Summary metrics */
  summary: SharedAnalyticsSponsorSummary;
  /** Placement breakdown */
  placements: SharedAnalyticsSponsorPlacement[];
}

/**
 * Required sponsor fields for validation
 */
export const SHARED_ANALYTICS_SPONSOR_REQUIRED_FIELDS = [
  'sponsorId',
  'name',
  'summary',
  'placements',
] as const;

/**
 * Required sponsor summary fields for validation
 */
export const SHARED_ANALYTICS_SPONSOR_SUMMARY_REQUIRED_FIELDS = [
  'impressions',
  'qrScans',
  'costPerScan',
] as const;

/**
 * Required sponsor placement fields for validation
 */
export const SHARED_ANALYTICS_SPONSOR_PLACEMENT_REQUIRED_FIELDS = [
  'surface',
  'count',
] as const;

// =============================================================================
// Types - Customer Section
// =============================================================================

/**
 * Customer geographic data (aggregate only - no PII)
 *
 * INVARIANT: Only zip3 buckets, no individual addresses
 */
export interface SharedAnalyticsCustomerGeo {
  /** Top 3 zip code prefixes (3-digit) */
  topZip3: string[];
}

/**
 * Customer summary metrics (aggregate only - no PII)
 *
 * INVARIANT: No individual identifiers, device IDs, or raw IPs
 */
export interface SharedAnalyticsCustomerSummary {
  /** Unique people (deduplicated count) */
  uniquePeople: number;
  /** Returning rate (0.0 - 1.0) */
  returningRate: number;
  /** Peak hour in local time (e.g., "19:00") */
  peakHourLocal: string;
  /** Geographic distribution (aggregate buckets only) */
  geo: SharedAnalyticsCustomerGeo;
}

/**
 * Customer outcome metrics
 */
export interface SharedAnalyticsCustomerOutcomes {
  /** RSVP to attendance conversion rate (0.0 - 1.0) */
  rsvpToAttendRate: number;
  /** Scan to signup conversion rate (0.0 - 1.0) */
  scanToSignupRate: number;
}

/**
 * Customer section of the bundle
 *
 * LOCKED CONTRACT - Customer analytics data (aggregate only)
 *
 * CRITICAL INVARIANT: This view must be aggregate-only.
 * - No PII (personally identifiable information)
 * - No device IDs
 * - No raw IPs
 * - No individual-level data
 */
export interface SharedAnalyticsCustomer {
  /** Aggregate summary metrics */
  summary: SharedAnalyticsCustomerSummary;
  /** Conversion outcome metrics */
  outcomes: SharedAnalyticsCustomerOutcomes;
  /** Notes about data (e.g., "This is an aggregate view. No PII.") */
  notes: string[];
}

/**
 * Required customer fields for validation
 */
export const SHARED_ANALYTICS_CUSTOMER_REQUIRED_FIELDS = [
  'summary',
  'outcomes',
  'notes',
] as const;

/**
 * Required customer summary fields for validation
 */
export const SHARED_ANALYTICS_CUSTOMER_SUMMARY_REQUIRED_FIELDS = [
  'uniquePeople',
  'returningRate',
  'peakHourLocal',
  'geo',
] as const;

/**
 * Required customer outcomes fields for validation
 */
export const SHARED_ANALYTICS_CUSTOMER_OUTCOMES_REQUIRED_FIELDS = [
  'rsvpToAttendRate',
  'scanToSignupRate',
] as const;

// =============================================================================
// Types - Full Bundle
// =============================================================================

/**
 * SharedAnalytics Bundle - Single Source of Truth
 *
 * LOCKED CONTRACT - All SharedReport endpoints MUST return this shape.
 */
export interface SharedAnalyticsBundle {
  /** When the bundle was generated (ISO 8601 timestamp) */
  generatedAt: string;
  /** Aggregation window */
  window: SharedAnalyticsWindow;
  /** Integrity metadata */
  integrity: SharedAnalyticsIntegrity;
  /** Event analytics section */
  event: SharedAnalyticsEvent;
  /** Sponsor analytics section */
  sponsor: SharedAnalyticsSponsor;
  /** Customer analytics section (aggregate only - no PII) */
  customer: SharedAnalyticsCustomer;
}

/**
 * Required bundle fields for validation
 */
export const SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS = [
  'generatedAt',
  'window',
  'integrity',
  'event',
  'sponsor',
  'customer',
] as const;

/**
 * SharedAnalytics API Response
 *
 * LOCKED CONTRACT - Response envelope for the bundle
 */
export interface SharedAnalyticsResponse {
  /** Success indicator */
  ok: true;
  /** HTTP status code */
  status: 200;
  /** The analytics bundle */
  bundle: SharedAnalyticsBundle;
  /** Request ID for tracing */
  requestId: string;
}

/**
 * SharedAnalytics Error Response
 */
export interface SharedAnalyticsErrorResponse {
  /** Failure indicator */
  ok: false;
  /** HTTP status code */
  status: number;
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Integrity notes (if applicable) */
  integrity?: SharedAnalyticsIntegrity;
  /** Request ID for tracing */
  requestId: string;
}

// =============================================================================
// Error Codes
// =============================================================================

/**
 * SharedAnalytics error codes
 *
 * LOCKED CONTRACT - These codes MUST remain stable for CI/CD gates
 */
export const SHARED_ANALYTICS_ERROR_CODES = {
  /** Event not found */
  NOT_FOUND: 'NOT_FOUND',
  /** Analytics service unavailable */
  ANALYTICS_UNAVAILABLE: 'ANALYTICS_UNAVAILABLE',
  /** Invalid event ID parameter */
  INVALID_EVENT_ID: 'INVALID_EVENT_ID',
  /** Internal error */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SharedAnalyticsErrorCode = typeof SHARED_ANALYTICS_ERROR_CODES[keyof typeof SHARED_ANALYTICS_ERROR_CODES];

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default event summary (zeros)
 */
export const DEFAULT_EVENT_SUMMARY: SharedAnalyticsEventSummary = {
  signups: 0,
  matches: 0,
  durationMinutes: 0,
};

/**
 * Default event traffic (zeros)
 */
export const DEFAULT_EVENT_TRAFFIC: SharedAnalyticsEventTraffic = {
  pageViews: 0,
  uniqueVisitors: 0,
};

/**
 * Default event QR (zeros, verified only)
 */
export const DEFAULT_EVENT_QR: SharedAnalyticsEventQR = {
  scans: 0,
  verifiedOnly: true,
};

/**
 * Default sponsor summary (zeros)
 */
export const DEFAULT_SPONSOR_SUMMARY: SharedAnalyticsSponsorSummary = {
  impressions: 0,
  qrScans: 0,
  costPerScan: 0.0,
};

/**
 * Default customer geo (empty)
 */
export const DEFAULT_CUSTOMER_GEO: SharedAnalyticsCustomerGeo = {
  topZip3: [],
};

/**
 * Default customer summary
 */
export const DEFAULT_CUSTOMER_SUMMARY: SharedAnalyticsCustomerSummary = {
  uniquePeople: 0,
  returningRate: 0,
  peakHourLocal: '00:00',
  geo: DEFAULT_CUSTOMER_GEO,
};

/**
 * Default customer outcomes (zeros)
 */
export const DEFAULT_CUSTOMER_OUTCOMES: SharedAnalyticsCustomerOutcomes = {
  rsvpToAttendRate: 0,
  scanToSignupRate: 0,
};

/**
 * Default integrity (incomplete, not stale)
 */
export const DEFAULT_INTEGRITY: SharedAnalyticsIntegrity = {
  complete: false,
  stale: false,
  notes: ['No data available'],
};

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate SharedAnalytics integrity
 */
export function isValidSharedAnalyticsIntegrity(
  integrity: unknown
): integrity is SharedAnalyticsIntegrity {
  if (!integrity || typeof integrity !== 'object') return false;

  const i = integrity as Record<string, unknown>;

  if (typeof i.complete !== 'boolean') return false;
  if (typeof i.stale !== 'boolean') return false;
  if (!Array.isArray(i.notes)) return false;

  // Validate notes are all strings
  for (const note of i.notes) {
    if (typeof note !== 'string') return false;
  }

  return true;
}

/**
 * Validate SharedAnalytics window
 */
export function isValidSharedAnalyticsWindow(
  window: unknown
): window is SharedAnalyticsWindow {
  if (!window || typeof window !== 'object') return false;

  const w = window as Record<string, unknown>;

  if (typeof w.start !== 'string') return false;
  if (typeof w.end !== 'string') return false;

  // Validate date format (basic check)
  const startDate = new Date(w.start as string);
  const endDate = new Date(w.end as string);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return false;
  }

  return true;
}

/**
 * Validate event section
 */
export function isValidSharedAnalyticsEvent(
  event: unknown
): event is SharedAnalyticsEvent {
  if (!event || typeof event !== 'object') return false;

  const e = event as Record<string, unknown>;

  // Check required fields
  if (typeof e.eventId !== 'string' || e.eventId.length === 0) return false;
  if (typeof e.name !== 'string') return false;

  // Check summary
  const summary = e.summary as Record<string, unknown> | undefined;
  if (!summary || typeof summary !== 'object') return false;
  if (typeof summary.signups !== 'number' || summary.signups < 0) return false;
  if (typeof summary.matches !== 'number' || summary.matches < 0) return false;
  if (typeof summary.durationMinutes !== 'number' || summary.durationMinutes < 0) return false;

  // Check traffic
  const traffic = e.traffic as Record<string, unknown> | undefined;
  if (!traffic || typeof traffic !== 'object') return false;
  if (typeof traffic.pageViews !== 'number' || traffic.pageViews < 0) return false;
  if (typeof traffic.uniqueVisitors !== 'number' || traffic.uniqueVisitors < 0) return false;

  // Check QR
  const qr = e.qr as Record<string, unknown> | undefined;
  if (!qr || typeof qr !== 'object') return false;
  if (typeof qr.scans !== 'number' || qr.scans < 0) return false;
  if (typeof qr.verifiedOnly !== 'boolean') return false;

  return true;
}

/**
 * Validate sponsor section
 */
export function isValidSharedAnalyticsSponsor(
  sponsor: unknown
): sponsor is SharedAnalyticsSponsor {
  if (!sponsor || typeof sponsor !== 'object') return false;

  const s = sponsor as Record<string, unknown>;

  // Check required fields
  if (typeof s.sponsorId !== 'string' || s.sponsorId.length === 0) return false;
  if (typeof s.name !== 'string') return false;

  // Check summary
  const summary = s.summary as Record<string, unknown> | undefined;
  if (!summary || typeof summary !== 'object') return false;
  if (typeof summary.impressions !== 'number' || summary.impressions < 0) return false;
  if (typeof summary.qrScans !== 'number' || summary.qrScans < 0) return false;
  if (typeof summary.costPerScan !== 'number' || summary.costPerScan < 0) return false;

  // Check placements
  if (!Array.isArray(s.placements)) return false;
  for (const placement of s.placements) {
    if (!placement || typeof placement !== 'object') return false;
    const p = placement as Record<string, unknown>;
    if (typeof p.surface !== 'string') return false;
    if (typeof p.count !== 'number' || p.count < 0) return false;
  }

  return true;
}

/**
 * Validate customer section
 *
 * INVARIANT: Customer data must be aggregate-only. No PII validation is
 * enforced here because the data structure itself prevents PII.
 */
export function isValidSharedAnalyticsCustomer(
  customer: unknown
): customer is SharedAnalyticsCustomer {
  if (!customer || typeof customer !== 'object') return false;

  const c = customer as Record<string, unknown>;

  // Check summary
  const summary = c.summary as Record<string, unknown> | undefined;
  if (!summary || typeof summary !== 'object') return false;
  if (typeof summary.uniquePeople !== 'number' || summary.uniquePeople < 0) return false;
  if (typeof summary.returningRate !== 'number' || summary.returningRate < 0 || summary.returningRate > 1) return false;
  if (typeof summary.peakHourLocal !== 'string') return false;

  // Check geo
  const geo = summary.geo as Record<string, unknown> | undefined;
  if (!geo || typeof geo !== 'object') return false;
  if (!Array.isArray(geo.topZip3)) return false;
  for (const zip of geo.topZip3) {
    if (typeof zip !== 'string') return false;
    // Validate zip3 format (3 digits)
    if (!/^\d{3}$/.test(zip)) return false;
  }

  // Check outcomes
  const outcomes = c.outcomes as Record<string, unknown> | undefined;
  if (!outcomes || typeof outcomes !== 'object') return false;
  if (typeof outcomes.rsvpToAttendRate !== 'number' || outcomes.rsvpToAttendRate < 0 || outcomes.rsvpToAttendRate > 1) return false;
  if (typeof outcomes.scanToSignupRate !== 'number' || outcomes.scanToSignupRate < 0 || outcomes.scanToSignupRate > 1) return false;

  // Check notes
  if (!Array.isArray(c.notes)) return false;
  for (const note of c.notes) {
    if (typeof note !== 'string') return false;
  }

  return true;
}

/**
 * Validate full SharedAnalytics bundle
 */
export function validateSharedAnalyticsBundle(
  bundle: unknown
): { valid: true } | { valid: false; error: string } {
  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, error: 'Bundle must be a non-null object' };
  }

  const b = bundle as Record<string, unknown>;

  // Check generatedAt
  if (typeof b.generatedAt !== 'string') {
    return { valid: false, error: 'Missing or invalid generatedAt' };
  }
  const generatedAtDate = new Date(b.generatedAt as string);
  if (isNaN(generatedAtDate.getTime())) {
    return { valid: false, error: 'Invalid generatedAt format' };
  }

  // Check window
  if (!isValidSharedAnalyticsWindow(b.window)) {
    return { valid: false, error: 'Invalid window' };
  }

  // Check integrity
  if (!isValidSharedAnalyticsIntegrity(b.integrity)) {
    return { valid: false, error: 'Invalid integrity' };
  }

  // Check event
  if (!isValidSharedAnalyticsEvent(b.event)) {
    return { valid: false, error: 'Invalid event section' };
  }

  // Check sponsor
  if (!isValidSharedAnalyticsSponsor(b.sponsor)) {
    return { valid: false, error: 'Invalid sponsor section' };
  }

  // Check customer
  if (!isValidSharedAnalyticsCustomer(b.customer)) {
    return { valid: false, error: 'Invalid customer section' };
  }

  return { valid: true };
}

/**
 * Assert bundle is valid (throws if invalid)
 */
export function assertSharedAnalyticsBundle(
  bundle: unknown
): asserts bundle is SharedAnalyticsBundle {
  const result = validateSharedAnalyticsBundle(bundle);
  if (!result.valid) {
    throw new Error(`[SharedAnalyticsBundle] Validation failed: ${result.error}`);
  }
}

// =============================================================================
// Builder Functions
// =============================================================================

/**
 * Build integrity metadata
 */
export function buildSharedAnalyticsIntegrity(
  eventComplete: boolean,
  sponsorComplete: boolean,
  customerComplete: boolean,
  stale: boolean = false
): SharedAnalyticsIntegrity {
  const notes: string[] = [];

  if (!eventComplete) {
    notes.push('Event data incomplete');
  }
  if (!sponsorComplete) {
    notes.push('Sponsor data incomplete');
  }
  if (!customerComplete) {
    notes.push('Customer data incomplete');
  }
  if (stale) {
    notes.push('Data may be stale');
  }

  return {
    complete: eventComplete && sponsorComplete && customerComplete,
    stale,
    notes,
  };
}

/**
 * Build event section
 */
export function buildSharedAnalyticsEvent(
  eventId: string,
  name: string,
  summary: Partial<SharedAnalyticsEventSummary> = {},
  traffic: Partial<SharedAnalyticsEventTraffic> = {},
  qr: Partial<SharedAnalyticsEventQR> = {}
): SharedAnalyticsEvent {
  return {
    eventId,
    name,
    summary: {
      signups: summary.signups ?? DEFAULT_EVENT_SUMMARY.signups,
      matches: summary.matches ?? DEFAULT_EVENT_SUMMARY.matches,
      durationMinutes: summary.durationMinutes ?? DEFAULT_EVENT_SUMMARY.durationMinutes,
    },
    traffic: {
      pageViews: traffic.pageViews ?? DEFAULT_EVENT_TRAFFIC.pageViews,
      uniqueVisitors: traffic.uniqueVisitors ?? DEFAULT_EVENT_TRAFFIC.uniqueVisitors,
    },
    qr: {
      scans: qr.scans ?? DEFAULT_EVENT_QR.scans,
      verifiedOnly: qr.verifiedOnly ?? DEFAULT_EVENT_QR.verifiedOnly,
    },
  };
}

/**
 * Build sponsor section
 */
export function buildSharedAnalyticsSponsor(
  sponsorId: string,
  name: string,
  summary: Partial<SharedAnalyticsSponsorSummary> = {},
  placements: SharedAnalyticsSponsorPlacement[] = []
): SharedAnalyticsSponsor {
  return {
    sponsorId,
    name,
    summary: {
      impressions: summary.impressions ?? DEFAULT_SPONSOR_SUMMARY.impressions,
      qrScans: summary.qrScans ?? DEFAULT_SPONSOR_SUMMARY.qrScans,
      costPerScan: summary.costPerScan ?? DEFAULT_SPONSOR_SUMMARY.costPerScan,
    },
    placements,
  };
}

/**
 * Build customer section
 *
 * INVARIANT: Only aggregate data, no PII
 */
export function buildSharedAnalyticsCustomer(
  summary: Partial<SharedAnalyticsCustomerSummary> = {},
  outcomes: Partial<SharedAnalyticsCustomerOutcomes> = {}
): SharedAnalyticsCustomer {
  return {
    summary: {
      uniquePeople: summary.uniquePeople ?? DEFAULT_CUSTOMER_SUMMARY.uniquePeople,
      returningRate: summary.returningRate ?? DEFAULT_CUSTOMER_SUMMARY.returningRate,
      peakHourLocal: summary.peakHourLocal ?? DEFAULT_CUSTOMER_SUMMARY.peakHourLocal,
      geo: {
        topZip3: summary.geo?.topZip3 ?? DEFAULT_CUSTOMER_GEO.topZip3,
      },
    },
    outcomes: {
      rsvpToAttendRate: outcomes.rsvpToAttendRate ?? DEFAULT_CUSTOMER_OUTCOMES.rsvpToAttendRate,
      scanToSignupRate: outcomes.scanToSignupRate ?? DEFAULT_CUSTOMER_OUTCOMES.scanToSignupRate,
    },
    notes: ['This is an aggregate view. No PII.'],
  };
}

/**
 * Build full SharedAnalytics bundle
 */
export function buildSharedAnalyticsBundle(
  windowStart: string,
  windowEnd: string,
  event: SharedAnalyticsEvent,
  sponsor: SharedAnalyticsSponsor,
  customer: SharedAnalyticsCustomer,
  integrity: SharedAnalyticsIntegrity
): SharedAnalyticsBundle {
  const bundle: SharedAnalyticsBundle = {
    generatedAt: new Date().toISOString(),
    window: { start: windowStart, end: windowEnd },
    integrity,
    event,
    sponsor,
    customer,
  };

  // Validate before returning
  assertSharedAnalyticsBundle(bundle);

  return bundle;
}

/**
 * Build success response
 */
export function buildSharedAnalyticsResponse(
  bundle: SharedAnalyticsBundle,
  requestId: string
): SharedAnalyticsResponse {
  return {
    ok: true,
    status: 200,
    bundle,
    requestId,
  };
}

/**
 * Build error response
 */
export function buildSharedAnalyticsErrorResponse(
  status: number,
  code: SharedAnalyticsErrorCode,
  message: string,
  requestId: string,
  integrity?: SharedAnalyticsIntegrity
): SharedAnalyticsErrorResponse {
  return {
    ok: false,
    status,
    code,
    message,
    integrity,
    requestId,
  };
}

// =============================================================================
// Contract Compliance Checking
// =============================================================================

/**
 * Check if bundle matches current contract version
 *
 * Used by CI/CD to detect contract drift.
 */
export function checkSharedAnalyticsBundleCompliance(bundle: unknown): {
  compliant: boolean;
  version: string;
  missingFields: string[];
  invalidFields: string[];
} {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  if (!bundle || typeof bundle !== 'object') {
    return {
      compliant: false,
      version: SHARED_ANALYTICS_CONTRACT_VERSION,
      missingFields: [...SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
    };
  }

  const b = bundle as Record<string, unknown>;

  // Check required fields
  for (const field of SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS) {
    if (!(field in b)) {
      missingFields.push(field);
    }
  }

  // Validate field types
  if ('generatedAt' in b && typeof b.generatedAt !== 'string') {
    invalidFields.push('generatedAt: must be string');
  }

  if ('window' in b && !isValidSharedAnalyticsWindow(b.window)) {
    invalidFields.push('window: invalid shape');
  }

  if ('integrity' in b && !isValidSharedAnalyticsIntegrity(b.integrity)) {
    invalidFields.push('integrity: invalid shape');
  }

  if ('event' in b && !isValidSharedAnalyticsEvent(b.event)) {
    invalidFields.push('event: invalid shape');
  }

  if ('sponsor' in b && !isValidSharedAnalyticsSponsor(b.sponsor)) {
    invalidFields.push('sponsor: invalid shape');
  }

  if ('customer' in b && !isValidSharedAnalyticsCustomer(b.customer)) {
    invalidFields.push('customer: invalid shape');
  }

  return {
    compliant: missingFields.length === 0 && invalidFields.length === 0,
    version: SHARED_ANALYTICS_CONTRACT_VERSION,
    missingFields,
    invalidFields,
  };
}

// =============================================================================
// Logging & Diagnostics
// =============================================================================

/**
 * Log SharedAnalytics bundle generation for audit
 */
export function logSharedAnalyticsBundleGeneration(
  eventId: string,
  bundle: SharedAnalyticsBundle,
  requestId: string
): void {
  console.log(JSON.stringify({
    type: 'SHARED_ANALYTICS_BUNDLE_GENERATED',
    timestamp: new Date().toISOString(),
    eventId,
    integrity: bundle.integrity,
    window: bundle.window,
    eventName: bundle.event.name,
    sponsorName: bundle.sponsor.name,
    customerUnique: bundle.customer.summary.uniquePeople,
    requestId,
    invariant: 'F6_SHARED_ANALYTICS_BUNDLE',
  }));
}

/**
 * Log SharedAnalytics access for observability
 */
export function logSharedAnalyticsAccess(
  eventId: string,
  requestId: string,
  success: boolean,
  errorCode?: string
): void {
  console.log(JSON.stringify({
    type: 'SHARED_ANALYTICS_ACCESS',
    timestamp: new Date().toISOString(),
    eventId,
    success,
    errorCode,
    requestId,
    invariant: 'F6_SHARED_ANALYTICS_BUNDLE',
  }));
}
