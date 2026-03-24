/**
 * Analytics Domain Contract
 *
 * Story F2: Analytics Integrity Enforcement (No Silent Drift)
 *
 * This module defines the locked analytics contract ensuring analytics
 * are never partial, stale, or misleading. Analytics are useless if
 * they're wrong - this contract prevents silent drift.
 *
 * CONTRACT VERSION: 1.0.0
 * BREAKING CHANGE POLICY: Any field removal or type change requires version bump
 *
 * Validity Rules (Backend Architect):
 *   - generatedAt: Timestamp when analytics were computed
 *   - windowStart: Start of the aggregation window
 *   - windowEnd: End of the aggregation window
 *
 * Failure Modes:
 *   - INCOMPLETE: Some data sources unavailable
 *   - STALE: Data older than acceptable threshold
 *   - UNAVAILABLE: Analytics cannot be computed
 *
 * Invariants (LOCKED):
 *   - Counts must NEVER decrease (monotonicity)
 *   - Missing data must be EXPLICIT (no silent zeros)
 *   - Backend never returns "complete" if inputs missing
 *   - Responses include integrity metadata
 *
 * System Impacts:
 *   - Upstream: Logging consistency becomes mandatory
 *   - Downstream: SharedReport, sponsor dashboards, billing
 *   - Observability: Analytics failures must be visible
 *
 * @module domain/analytics
 * @see Story F2 - Analytics Integrity Enforcement (No Silent Drift)
 */

// =============================================================================
// Contract Version
// =============================================================================

/**
 * Current analytics contract version
 *
 * LOCKED CONTRACT - Increment for breaking changes:
 *   - Major: Field removed or type changed
 *   - Minor: New optional field added
 *   - Patch: Documentation or validation only
 */
export const ANALYTICS_CONTRACT_VERSION = '1.0.0' as const;

// =============================================================================
// Types - Analytics Integrity Status
// =============================================================================

/**
 * Analytics integrity status values
 *
 * LOCKED CONTRACT - Do not modify without version bump
 */
export const ANALYTICS_INTEGRITY_STATUS = {
  /** All data sources available, window complete */
  COMPLETE: 'COMPLETE',
  /** Some data sources unavailable, partial results */
  INCOMPLETE: 'INCOMPLETE',
  /** Data older than acceptable threshold */
  STALE: 'STALE',
  /** Analytics cannot be computed at all */
  UNAVAILABLE: 'UNAVAILABLE',
} as const;

export type AnalyticsIntegrityStatus = typeof ANALYTICS_INTEGRITY_STATUS[keyof typeof ANALYTICS_INTEGRITY_STATUS];

/**
 * Valid analytics integrity statuses as array
 */
export const VALID_INTEGRITY_STATUSES = [
  ANALYTICS_INTEGRITY_STATUS.COMPLETE,
  ANALYTICS_INTEGRITY_STATUS.INCOMPLETE,
  ANALYTICS_INTEGRITY_STATUS.STALE,
  ANALYTICS_INTEGRITY_STATUS.UNAVAILABLE,
] as const;

// =============================================================================
// Types - Analytics Window
// =============================================================================

/**
 * Analytics aggregation window
 *
 * LOCKED CONTRACT - Defines the time bounds for aggregated data
 */
export interface AnalyticsWindow {
  /** Start of aggregation window (ISO 8601) */
  windowStart: string;
  /** End of aggregation window (ISO 8601) */
  windowEnd: string;
}

/**
 * Required window fields for validation
 */
export const ANALYTICS_WINDOW_REQUIRED_FIELDS = [
  'windowStart',
  'windowEnd',
] as const;

// =============================================================================
// Types - Analytics Metrics (Event Level)
// =============================================================================

/**
 * Event-level analytics metrics
 *
 * LOCKED CONTRACT - All aggregation happens server-side.
 * UI must NEVER compute these values.
 *
 * INVARIANT: metrics are always non-negative integers
 * INVARIANT: counts must NEVER decrease (monotonicity)
 */
export interface EventAnalyticsMetrics {
  /** Total page impressions */
  impressions: number;
  /** Total QR code scans */
  scans: number;
  /** Total dwell time in seconds */
  dwellSeconds: number;
  /** Number of unique sessions */
  uniqueSessions: number;
}

/**
 * Required event metrics fields
 */
export const EVENT_METRICS_REQUIRED_FIELDS = [
  'impressions',
  'scans',
  'dwellSeconds',
  'uniqueSessions',
] as const;

// =============================================================================
// Types - Sponsor Analytics Metrics
// =============================================================================

/**
 * Sponsor-level analytics metrics
 *
 * LOCKED CONTRACT - Sponsor metrics for dashboards and billing
 *
 * INVARIANT: metrics are always non-negative integers
 * INVARIANT: counts must NEVER decrease (monotonicity)
 */
export interface SponsorAnalyticsMetrics {
  /** Total impressions attributed to sponsor */
  impressions: number;
  /** Total scans attributed to sponsor */
  scans: number;
  /** Total click-throughs (conversions) */
  conversions: number;
  /** Computed click-through rate (backend computed) */
  ctr: number;
}

/**
 * Required sponsor metrics fields
 */
export const SPONSOR_METRICS_REQUIRED_FIELDS = [
  'impressions',
  'scans',
  'conversions',
  'ctr',
] as const;

// =============================================================================
// Types - Analytics Integrity Metadata
// =============================================================================

/**
 * Analytics integrity metadata
 *
 * LOCKED CONTRACT - Every analytics response MUST include this.
 * Backend never returns analytics marked "complete" if inputs missing.
 */
export interface AnalyticsIntegrityMetadata {
  /** When analytics were computed (ISO 8601) */
  generatedAt: string;
  /** Aggregation window */
  window: AnalyticsWindow;
  /** Integrity status - NEVER falsely claim COMPLETE */
  status: AnalyticsIntegrityStatus;
  /** Human-readable status description */
  statusMessage: string;
  /** Data sources that were available */
  availableSources: string[];
  /** Data sources that were unavailable (explicit missing) */
  unavailableSources: string[];
  /** Staleness threshold in seconds (for STALE status) */
  stalenessThresholdSec: number;
  /** Actual data age in seconds */
  dataAgeSec: number;
}

/**
 * Required integrity metadata fields
 */
export const INTEGRITY_METADATA_REQUIRED_FIELDS = [
  'generatedAt',
  'window',
  'status',
  'statusMessage',
  'availableSources',
  'unavailableSources',
  'stalenessThresholdSec',
  'dataAgeSec',
] as const;

// =============================================================================
// Types - Event Analytics Contract
// =============================================================================

/**
 * Event Analytics Contract - Single Source of Truth
 *
 * LOCKED CONTRACT - All event analytics endpoints MUST return this shape.
 */
export interface EventAnalyticsContract {
  /** Event ID */
  eventId: string;
  /** Event name (for display) */
  eventName: string;
  /** Aggregated metrics */
  metrics: EventAnalyticsMetrics;
  /** Integrity metadata */
  integrity: AnalyticsIntegrityMetadata;
}

/**
 * Required event analytics fields
 */
export const EVENT_ANALYTICS_REQUIRED_FIELDS = [
  'eventId',
  'eventName',
  'metrics',
  'integrity',
] as const;

// =============================================================================
// Types - Sponsor Analytics Contract
// =============================================================================

/**
 * Sponsor Analytics Contract - Single Source of Truth
 *
 * LOCKED CONTRACT - All sponsor analytics endpoints MUST return this shape.
 */
export interface SponsorAnalyticsContract {
  /** Sponsor ID */
  sponsorId: string;
  /** Sponsor name (for display) */
  sponsorName: string;
  /** Associated event IDs */
  eventIds: string[];
  /** Aggregated metrics */
  metrics: SponsorAnalyticsMetrics;
  /** Integrity metadata */
  integrity: AnalyticsIntegrityMetadata;
}

/**
 * Required sponsor analytics fields
 */
export const SPONSOR_ANALYTICS_REQUIRED_FIELDS = [
  'sponsorId',
  'sponsorName',
  'eventIds',
  'metrics',
  'integrity',
] as const;

// =============================================================================
// Types - Monotonicity Tracking
// =============================================================================

/**
 * Monotonicity checkpoint for drift detection
 *
 * INVARIANT: Counts must NEVER decrease
 * Used to detect and prevent silent drift
 */
export interface MonotonicityCheckpoint {
  /** Checkpoint timestamp (ISO 8601) */
  timestamp: string;
  /** Entity type (event | sponsor) */
  entityType: 'event' | 'sponsor';
  /** Entity ID */
  entityId: string;
  /** Metric name */
  metricName: string;
  /** Previous value */
  previousValue: number;
  /** Current value */
  currentValue: number;
}

/**
 * Monotonicity violation record
 */
export interface MonotonicityViolation {
  /** Violation detected at */
  detectedAt: string;
  /** Checkpoint that detected violation */
  checkpoint: MonotonicityCheckpoint;
  /** Drift amount (negative = decrease) */
  drift: number;
  /** Severity level */
  severity: 'WARNING' | 'ERROR' | 'CRITICAL';
}

// =============================================================================
// Constants - Data Sources
// =============================================================================

/**
 * Known data sources for analytics
 */
export const ANALYTICS_DATA_SOURCES = [
  'worker_logs',
  'gas_logs',
  'client_logs',
  'sheets_data',
] as const;

export type AnalyticsDataSource = typeof ANALYTICS_DATA_SOURCES[number];

// =============================================================================
// Constants - Staleness Thresholds
// =============================================================================

/**
 * Default staleness threshold in seconds (5 minutes)
 */
export const DEFAULT_STALENESS_THRESHOLD_SEC = 300;

/**
 * Maximum acceptable staleness in seconds (1 hour)
 */
export const MAX_STALENESS_THRESHOLD_SEC = 3600;

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Check if a value is a valid integrity status
 */
export function isValidIntegrityStatus(value: unknown): value is AnalyticsIntegrityStatus {
  return typeof value === 'string' && VALID_INTEGRITY_STATUSES.includes(value as AnalyticsIntegrityStatus);
}

/**
 * Validate analytics window
 */
export function isValidAnalyticsWindow(window: unknown): window is AnalyticsWindow {
  if (!window || typeof window !== 'object') return false;

  const w = window as Record<string, unknown>;

  // Check required fields
  for (const field of ANALYTICS_WINDOW_REQUIRED_FIELDS) {
    if (!(field in w)) return false;
    if (typeof w[field] !== 'string') return false;
  }

  // Validate ISO 8601 format (basic check)
  const windowStart = new Date(w.windowStart as string);
  const windowEnd = new Date(w.windowEnd as string);

  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    return false;
  }

  // windowEnd must be after windowStart
  if (windowEnd <= windowStart) {
    return false;
  }

  return true;
}

/**
 * Validate event analytics metrics
 *
 * INVARIANT: All metrics must be non-negative integers (except dwellSeconds can be float)
 */
export function isValidEventMetrics(metrics: unknown): metrics is EventAnalyticsMetrics {
  if (!metrics || typeof metrics !== 'object') return false;

  const m = metrics as Record<string, unknown>;

  // Check all required fields exist and are valid
  for (const field of EVENT_METRICS_REQUIRED_FIELDS) {
    if (!(field in m)) return false;
    const value = m[field];
    if (typeof value !== 'number' || value < 0) return false;

    // Integer check for count fields (dwellSeconds can be float)
    if (field !== 'dwellSeconds' && !Number.isInteger(value)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate sponsor analytics metrics
 *
 * INVARIANT: All metrics must be non-negative
 */
export function isValidSponsorAnalyticsMetrics(metrics: unknown): metrics is SponsorAnalyticsMetrics {
  if (!metrics || typeof metrics !== 'object') return false;

  const m = metrics as Record<string, unknown>;

  // Check all required fields
  for (const field of SPONSOR_METRICS_REQUIRED_FIELDS) {
    if (!(field in m)) return false;
    const value = m[field];
    if (typeof value !== 'number' || value < 0) return false;

    // Integer check for count fields (ctr is a percentage, can be float)
    if (field !== 'ctr' && !Number.isInteger(value)) {
      return false;
    }
  }

  // CTR should be between 0 and 100
  if (m.ctr !== undefined && (m.ctr as number) > 100) {
    return false;
  }

  return true;
}

/**
 * Validate integrity metadata
 */
export function isValidIntegrityMetadata(metadata: unknown): metadata is AnalyticsIntegrityMetadata {
  if (!metadata || typeof metadata !== 'object') return false;

  const m = metadata as Record<string, unknown>;

  // Check required fields
  for (const field of INTEGRITY_METADATA_REQUIRED_FIELDS) {
    if (!(field in m)) return false;
  }

  // Validate individual fields
  if (typeof m.generatedAt !== 'string') return false;
  if (!isValidAnalyticsWindow(m.window)) return false;
  if (!isValidIntegrityStatus(m.status)) return false;
  if (typeof m.statusMessage !== 'string') return false;
  if (!Array.isArray(m.availableSources)) return false;
  if (!Array.isArray(m.unavailableSources)) return false;
  if (typeof m.stalenessThresholdSec !== 'number' || m.stalenessThresholdSec < 0) return false;
  if (typeof m.dataAgeSec !== 'number' || m.dataAgeSec < 0) return false;

  // Validate generatedAt is valid ISO date
  const generatedAt = new Date(m.generatedAt as string);
  if (isNaN(generatedAt.getTime())) return false;

  return true;
}

/**
 * Validate full EventAnalyticsContract
 */
export function validateEventAnalytics(
  analytics: unknown
): { valid: true } | { valid: false; error: string } {
  if (!analytics || typeof analytics !== 'object') {
    return { valid: false, error: 'Analytics must be a non-null object' };
  }

  const a = analytics as Record<string, unknown>;

  // Check eventId
  if (!('eventId' in a) || typeof a.eventId !== 'string' || a.eventId.length === 0) {
    return { valid: false, error: 'Missing or invalid eventId' };
  }

  // Check eventName
  if (!('eventName' in a) || typeof a.eventName !== 'string') {
    return { valid: false, error: 'Missing or invalid eventName' };
  }

  // Check metrics
  if (!('metrics' in a)) {
    return { valid: false, error: 'Missing metrics object' };
  }
  if (!isValidEventMetrics(a.metrics)) {
    return { valid: false, error: 'Invalid metrics object' };
  }

  // Check integrity
  if (!('integrity' in a)) {
    return { valid: false, error: 'Missing integrity metadata' };
  }
  if (!isValidIntegrityMetadata(a.integrity)) {
    return { valid: false, error: 'Invalid integrity metadata' };
  }

  return { valid: true };
}

/**
 * Validate full SponsorAnalyticsContract
 */
export function validateSponsorAnalytics(
  analytics: unknown
): { valid: true } | { valid: false; error: string } {
  if (!analytics || typeof analytics !== 'object') {
    return { valid: false, error: 'Analytics must be a non-null object' };
  }

  const a = analytics as Record<string, unknown>;

  // Check sponsorId
  if (!('sponsorId' in a) || typeof a.sponsorId !== 'string' || a.sponsorId.length === 0) {
    return { valid: false, error: 'Missing or invalid sponsorId' };
  }

  // Check sponsorName
  if (!('sponsorName' in a) || typeof a.sponsorName !== 'string') {
    return { valid: false, error: 'Missing or invalid sponsorName' };
  }

  // Check eventIds
  if (!('eventIds' in a) || !Array.isArray(a.eventIds)) {
    return { valid: false, error: 'Missing or invalid eventIds array' };
  }

  // Check metrics
  if (!('metrics' in a)) {
    return { valid: false, error: 'Missing metrics object' };
  }
  if (!isValidSponsorAnalyticsMetrics(a.metrics)) {
    return { valid: false, error: 'Invalid metrics object' };
  }

  // Check integrity
  if (!('integrity' in a)) {
    return { valid: false, error: 'Missing integrity metadata' };
  }
  if (!isValidIntegrityMetadata(a.integrity)) {
    return { valid: false, error: 'Invalid integrity metadata' };
  }

  return { valid: true };
}

/**
 * Assert event analytics contract is valid (throws if invalid)
 */
export function assertEventAnalytics(analytics: unknown): asserts analytics is EventAnalyticsContract {
  const result = validateEventAnalytics(analytics);
  if (!result.valid) {
    throw new Error(`[EventAnalyticsContract] Validation failed: ${result.error}`);
  }
}

/**
 * Assert sponsor analytics contract is valid (throws if invalid)
 */
export function assertSponsorAnalytics(analytics: unknown): asserts analytics is SponsorAnalyticsContract {
  const result = validateSponsorAnalytics(analytics);
  if (!result.valid) {
    throw new Error(`[SponsorAnalyticsContract] Validation failed: ${result.error}`);
  }
}

// =============================================================================
// Integrity Status Determination
// =============================================================================

/**
 * Determine integrity status based on data availability and freshness
 *
 * INVARIANT: Never return COMPLETE if any source is unavailable
 */
export function determineIntegrityStatus(
  availableSources: string[],
  requiredSources: string[],
  dataAgeSec: number,
  stalenessThresholdSec: number = DEFAULT_STALENESS_THRESHOLD_SEC
): { status: AnalyticsIntegrityStatus; message: string } {
  // Check if all required sources are available
  const unavailableSources = requiredSources.filter(
    (source) => !availableSources.includes(source)
  );

  // UNAVAILABLE: No data sources available
  if (availableSources.length === 0) {
    return {
      status: ANALYTICS_INTEGRITY_STATUS.UNAVAILABLE,
      message: 'No data sources available',
    };
  }

  // STALE: Data is too old
  if (dataAgeSec > stalenessThresholdSec) {
    return {
      status: ANALYTICS_INTEGRITY_STATUS.STALE,
      message: `Data is ${dataAgeSec}s old, threshold is ${stalenessThresholdSec}s`,
    };
  }

  // INCOMPLETE: Some sources unavailable
  if (unavailableSources.length > 0) {
    return {
      status: ANALYTICS_INTEGRITY_STATUS.INCOMPLETE,
      message: `Missing sources: ${unavailableSources.join(', ')}`,
    };
  }

  // COMPLETE: All checks pass
  return {
    status: ANALYTICS_INTEGRITY_STATUS.COMPLETE,
    message: 'All data sources available and fresh',
  };
}

// =============================================================================
// Monotonicity Enforcement
// =============================================================================

/**
 * Check monotonicity constraint (counts must never decrease)
 *
 * INVARIANT: Returns violation if current < previous
 */
export function checkMonotonicity(
  checkpoint: MonotonicityCheckpoint
): MonotonicityViolation | null {
  const { previousValue, currentValue } = checkpoint;

  // No violation if current >= previous
  if (currentValue >= previousValue) {
    return null;
  }

  const drift = currentValue - previousValue;
  const driftPercent = previousValue > 0 ? Math.abs(drift / previousValue) * 100 : 100;

  // Determine severity based on drift percentage
  let severity: MonotonicityViolation['severity'];
  if (driftPercent > 10) {
    severity = 'CRITICAL';
  } else if (driftPercent > 5) {
    severity = 'ERROR';
  } else {
    severity = 'WARNING';
  }

  return {
    detectedAt: new Date().toISOString(),
    checkpoint,
    drift,
    severity,
  };
}

/**
 * Assert monotonicity (throws on violation)
 *
 * Use in endpoints to enforce count monotonicity
 */
export function assertMonotonicity(checkpoint: MonotonicityCheckpoint): void {
  const violation = checkMonotonicity(checkpoint);
  if (violation) {
    // Log the violation for observability
    logMonotonicityViolation(violation);

    if (violation.severity === 'CRITICAL') {
      throw new Error(
        `[AnalyticsIntegrity] CRITICAL: Count decreased for ${checkpoint.entityType}:${checkpoint.entityId}.${checkpoint.metricName} ` +
        `(${checkpoint.previousValue} -> ${checkpoint.currentValue})`
      );
    }
  }
}

/**
 * Batch check monotonicity for multiple metrics
 */
export function checkBatchMonotonicity(
  checkpoints: MonotonicityCheckpoint[]
): MonotonicityViolation[] {
  return checkpoints
    .map(checkMonotonicity)
    .filter((v): v is MonotonicityViolation => v !== null);
}

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default event metrics (all zeros with explicit meaning)
 */
export const DEFAULT_EVENT_METRICS: EventAnalyticsMetrics = {
  impressions: 0,
  scans: 0,
  dwellSeconds: 0,
  uniqueSessions: 0,
};

/**
 * Default sponsor analytics metrics
 */
export const DEFAULT_SPONSOR_ANALYTICS_METRICS: SponsorAnalyticsMetrics = {
  impressions: 0,
  scans: 0,
  conversions: 0,
  ctr: 0,
};

// =============================================================================
// Aggregation Functions
// =============================================================================

/**
 * Aggregate event metrics from multiple sources
 *
 * BACKEND AGGREGATION: All metric computation happens here.
 */
export function aggregateEventMetrics(
  sources: Array<Partial<EventAnalyticsMetrics>>
): EventAnalyticsMetrics {
  return sources.reduce(
    (acc, source) => ({
      impressions: acc.impressions + (source.impressions ?? 0),
      scans: acc.scans + (source.scans ?? 0),
      dwellSeconds: acc.dwellSeconds + (source.dwellSeconds ?? 0),
      uniqueSessions: acc.uniqueSessions + (source.uniqueSessions ?? 0),
    }),
    { ...DEFAULT_EVENT_METRICS }
  );
}

/**
 * Aggregate sponsor analytics metrics from multiple sources
 */
export function aggregateSponsorAnalyticsMetrics(
  sources: Array<Partial<SponsorAnalyticsMetrics>>
): SponsorAnalyticsMetrics {
  const aggregated = sources.reduce(
    (acc, source) => ({
      impressions: acc.impressions + (source.impressions ?? 0),
      scans: acc.scans + (source.scans ?? 0),
      conversions: acc.conversions + (source.conversions ?? 0),
      ctr: 0, // Will be computed below
    }),
    { ...DEFAULT_SPONSOR_ANALYTICS_METRICS }
  );

  // Compute CTR from aggregated values
  aggregated.ctr = aggregated.impressions > 0
    ? (aggregated.conversions / aggregated.impressions) * 100
    : 0;

  return aggregated;
}

// =============================================================================
// Builder Functions
// =============================================================================

/**
 * Build integrity metadata
 *
 * INVARIANT: Status is computed, not manually set
 */
export function buildIntegrityMetadata(
  windowStart: string,
  windowEnd: string,
  availableSources: string[],
  requiredSources: string[] = [...ANALYTICS_DATA_SOURCES],
  stalenessThresholdSec: number = DEFAULT_STALENESS_THRESHOLD_SEC
): AnalyticsIntegrityMetadata {
  const generatedAt = new Date().toISOString();
  const windowEndDate = new Date(windowEnd);
  const dataAgeSec = Math.floor((Date.now() - windowEndDate.getTime()) / 1000);

  const unavailableSources = requiredSources.filter(
    (source) => !availableSources.includes(source)
  );

  const { status, message } = determineIntegrityStatus(
    availableSources,
    requiredSources,
    dataAgeSec,
    stalenessThresholdSec
  );

  return {
    generatedAt,
    window: { windowStart, windowEnd },
    status,
    statusMessage: message,
    availableSources,
    unavailableSources,
    stalenessThresholdSec,
    dataAgeSec,
  };
}

/**
 * Build event analytics response
 */
export function buildEventAnalyticsResponse(
  eventId: string,
  eventName: string,
  metrics: EventAnalyticsMetrics,
  integrity: AnalyticsIntegrityMetadata
): {
  analytics: EventAnalyticsContract;
  _contractVersion: string;
} {
  const analytics: EventAnalyticsContract = {
    eventId,
    eventName,
    metrics,
    integrity,
  };

  // Validate before returning
  assertEventAnalytics(analytics);

  return {
    analytics,
    _contractVersion: ANALYTICS_CONTRACT_VERSION,
  };
}

/**
 * Build sponsor analytics response
 */
export function buildSponsorAnalyticsResponse(
  sponsorId: string,
  sponsorName: string,
  eventIds: string[],
  metrics: SponsorAnalyticsMetrics,
  integrity: AnalyticsIntegrityMetadata
): {
  analytics: SponsorAnalyticsContract;
  _contractVersion: string;
} {
  const analytics: SponsorAnalyticsContract = {
    sponsorId,
    sponsorName,
    eventIds,
    metrics,
    integrity,
  };

  // Validate before returning
  assertSponsorAnalytics(analytics);

  return {
    analytics,
    _contractVersion: ANALYTICS_CONTRACT_VERSION,
  };
}

// =============================================================================
// Contract Compliance Checking
// =============================================================================

/**
 * Check if event analytics object matches current contract
 *
 * Used by CI/CD to detect contract drift.
 */
export function checkEventAnalyticsCompliance(analytics: unknown): {
  compliant: boolean;
  version: string;
  missingFields: string[];
  invalidFields: string[];
} {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  if (!analytics || typeof analytics !== 'object') {
    return {
      compliant: false,
      version: ANALYTICS_CONTRACT_VERSION,
      missingFields: [...EVENT_ANALYTICS_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
    };
  }

  const a = analytics as Record<string, unknown>;

  // Check required fields
  for (const field of EVENT_ANALYTICS_REQUIRED_FIELDS) {
    if (!(field in a)) {
      missingFields.push(field);
    }
  }

  // Validate field types
  if ('eventId' in a && (typeof a.eventId !== 'string' || a.eventId.length === 0)) {
    invalidFields.push('eventId: must be non-empty string');
  }

  if ('eventName' in a && typeof a.eventName !== 'string') {
    invalidFields.push('eventName: must be string');
  }

  if ('metrics' in a && !isValidEventMetrics(a.metrics)) {
    invalidFields.push('metrics: invalid shape');
  }

  if ('integrity' in a && !isValidIntegrityMetadata(a.integrity)) {
    invalidFields.push('integrity: invalid shape');
  }

  return {
    compliant: missingFields.length === 0 && invalidFields.length === 0,
    version: ANALYTICS_CONTRACT_VERSION,
    missingFields,
    invalidFields,
  };
}

/**
 * Check if sponsor analytics object matches current contract
 */
export function checkSponsorAnalyticsCompliance(analytics: unknown): {
  compliant: boolean;
  version: string;
  missingFields: string[];
  invalidFields: string[];
} {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  if (!analytics || typeof analytics !== 'object') {
    return {
      compliant: false,
      version: ANALYTICS_CONTRACT_VERSION,
      missingFields: [...SPONSOR_ANALYTICS_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
    };
  }

  const a = analytics as Record<string, unknown>;

  // Check required fields
  for (const field of SPONSOR_ANALYTICS_REQUIRED_FIELDS) {
    if (!(field in a)) {
      missingFields.push(field);
    }
  }

  // Validate field types
  if ('sponsorId' in a && (typeof a.sponsorId !== 'string' || a.sponsorId.length === 0)) {
    invalidFields.push('sponsorId: must be non-empty string');
  }

  if ('sponsorName' in a && typeof a.sponsorName !== 'string') {
    invalidFields.push('sponsorName: must be string');
  }

  if ('eventIds' in a && !Array.isArray(a.eventIds)) {
    invalidFields.push('eventIds: must be array');
  }

  if ('metrics' in a && !isValidSponsorAnalyticsMetrics(a.metrics)) {
    invalidFields.push('metrics: invalid shape');
  }

  if ('integrity' in a && !isValidIntegrityMetadata(a.integrity)) {
    invalidFields.push('integrity: invalid shape');
  }

  return {
    compliant: missingFields.length === 0 && invalidFields.length === 0,
    version: ANALYTICS_CONTRACT_VERSION,
    missingFields,
    invalidFields,
  };
}

// =============================================================================
// Error Response Helpers
// =============================================================================

/**
 * Analytics unavailable error response
 *
 * Use when analytics cannot be computed at all
 */
export function createAnalyticsUnavailableResponse(
  reason: string,
  requestId?: string
): {
  ok: false;
  status: 503;
  code: string;
  message: string;
  corrId?: string;
} {
  return {
    ok: false,
    status: 503,
    code: 'ANALYTICS_UNAVAILABLE',
    message: reason,
    corrId: requestId,
  };
}

/**
 * Analytics incomplete warning (included in response metadata)
 *
 * Use when analytics can be partially computed but data is missing
 */
export function createAnalyticsIncompleteWarning(
  unavailableSources: string[]
): {
  warning: string;
  code: string;
  unavailableSources: string[];
} {
  return {
    warning: `Analytics incomplete: missing ${unavailableSources.join(', ')}`,
    code: 'ANALYTICS_INCOMPLETE',
    unavailableSources,
  };
}

// =============================================================================
// Logging & Diagnostics
// =============================================================================

/**
 * Log analytics integrity check for debugging/audit
 */
export function logAnalyticsIntegrityCheck(
  entityType: 'event' | 'sponsor',
  entityId: string,
  integrity: AnalyticsIntegrityMetadata
): void {
  console.log(JSON.stringify({
    type: 'ANALYTICS_INTEGRITY_CHECK',
    timestamp: new Date().toISOString(),
    entityType,
    entityId,
    status: integrity.status,
    statusMessage: integrity.statusMessage,
    availableSources: integrity.availableSources,
    unavailableSources: integrity.unavailableSources,
    dataAgeSec: integrity.dataAgeSec,
    stalenessThresholdSec: integrity.stalenessThresholdSec,
    invariant: 'F2_ANALYTICS_INTEGRITY',
  }));
}

/**
 * Log monotonicity violation for observability
 *
 * CRITICAL: Analytics failures must be visible
 */
export function logMonotonicityViolation(violation: MonotonicityViolation): void {
  console.log(JSON.stringify({
    type: 'MONOTONICITY_VIOLATION',
    timestamp: violation.detectedAt,
    severity: violation.severity,
    entityType: violation.checkpoint.entityType,
    entityId: violation.checkpoint.entityId,
    metricName: violation.checkpoint.metricName,
    previousValue: violation.checkpoint.previousValue,
    currentValue: violation.checkpoint.currentValue,
    drift: violation.drift,
    invariant: 'F2_MONOTONICITY',
  }));
}

/**
 * Log analytics contract compliance check
 */
export function logAnalyticsContractCheck(
  entityType: 'event' | 'sponsor',
  entityId: string,
  compliance: ReturnType<typeof checkEventAnalyticsCompliance>
): void {
  console.log(JSON.stringify({
    type: 'ANALYTICS_CONTRACT_CHECK',
    timestamp: new Date().toISOString(),
    entityType,
    entityId,
    compliant: compliance.compliant,
    version: compliance.version,
    missingFields: compliance.missingFields,
    invalidFields: compliance.invalidFields,
    invariant: 'F2_ANALYTICS_CONTRACT',
  }));
}

// =============================================================================
// Story F4: Event-Level Monetization Hooks
// =============================================================================

/**
 * Event-level billable units for monetization
 *
 * Story F4: Monetization Readiness Hooks
 *
 * These are the monetizable signals for events:
 *   - qrScans: Total QR code scans for this event
 *   - impressions: Total page impressions for this event
 *   - sponsorCount: Number of sponsors associated with event
 *
 * INERT: These fields are for future billing integration.
 * NO billing logic is executed. NO payment processing.
 */
export interface EventBillableUnits {
  /** Total QR code scans for this event */
  qrScans: number;
  /** Total page impressions for this event */
  impressions: number;
  /** Number of sponsors associated with event */
  sponsorCount: number;
}

/**
 * Required event billable unit fields for validation
 */
export const EVENT_BILLABLE_UNITS_REQUIRED_FIELDS = [
  'qrScans',
  'impressions',
  'sponsorCount',
] as const;

/**
 * Event monetization hooks
 *
 * Story F4: Monetization Readiness Hooks
 *
 * FUTURE-PROOFING: Usage metrics become billable signals.
 * Pricing can be added without refactoring.
 *
 * INVARIANTS:
 *   - Fields are INERT (no side effects)
 *   - No billing logic is executed
 *   - Read-only exposure via API
 */
export interface EventMonetizationHooks {
  /** Event billable units from analytics */
  billableUnits: EventBillableUnits;
  /** Billing window for aggregation */
  billingWindow: { windowStart: string; windowEnd: string };
  /** Whether data is available for this event */
  dataAvailable: boolean;
  /** Human-readable status */
  statusMessage: string;
}

/**
 * Required event monetization fields
 */
export const EVENT_MONETIZATION_HOOKS_REQUIRED_FIELDS = [
  'billableUnits',
  'billingWindow',
  'dataAvailable',
  'statusMessage',
] as const;

/**
 * Default event billable units
 */
export const DEFAULT_EVENT_BILLABLE_UNITS: EventBillableUnits = {
  qrScans: 0,
  impressions: 0,
  sponsorCount: 0,
};

/**
 * Default event monetization hooks
 */
export const DEFAULT_EVENT_MONETIZATION_HOOKS: EventMonetizationHooks = {
  billableUnits: DEFAULT_EVENT_BILLABLE_UNITS,
  billingWindow: { windowStart: '', windowEnd: '' },
  dataAvailable: false,
  statusMessage: 'No monetization data available',
};

/**
 * Validate EventBillableUnits shape
 *
 * INVARIANT: All billable units must be non-negative integers
 */
export function isValidEventBillableUnits(units: unknown): units is EventBillableUnits {
  if (!units || typeof units !== 'object') return false;

  const u = units as Record<string, unknown>;

  for (const field of EVENT_BILLABLE_UNITS_REQUIRED_FIELDS) {
    if (!(field in u)) return false;
    const value = u[field];
    if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate EventMonetizationHooks shape
 */
export function isValidEventMonetizationHooks(hooks: unknown): hooks is EventMonetizationHooks {
  if (!hooks || typeof hooks !== 'object') return false;

  const h = hooks as Record<string, unknown>;

  for (const field of EVENT_MONETIZATION_HOOKS_REQUIRED_FIELDS) {
    if (!(field in h)) return false;
  }

  if (!isValidEventBillableUnits(h.billableUnits)) return false;

  // Validate billing window
  const window = h.billingWindow as Record<string, unknown>;
  if (!window || typeof window !== 'object') return false;
  if (typeof window.windowStart !== 'string') return false;
  if (typeof window.windowEnd !== 'string') return false;

  if (typeof h.dataAvailable !== 'boolean') return false;
  if (typeof h.statusMessage !== 'string') return false;

  return true;
}

/**
 * Build event billable units from analytics metrics
 *
 * Story F4: Populates event billable units from analytics.
 * INERT: No billing logic is executed.
 *
 * @param metrics - Event analytics metrics
 * @param sponsorCount - Number of sponsors for this event
 * @returns EventBillableUnits object
 */
export function buildEventBillableUnits(
  metrics: EventAnalyticsMetrics,
  sponsorCount: number
): EventBillableUnits {
  return {
    qrScans: metrics.scans,
    impressions: metrics.impressions,
    sponsorCount: Math.max(0, Math.floor(sponsorCount)),
  };
}

/**
 * Build event monetization hooks from analytics
 *
 * Story F4: Creates monetization hooks from event analytics.
 * INERT: These fields are for future billing integration only.
 *
 * @param metrics - Event analytics metrics
 * @param sponsorCount - Number of sponsors
 * @param integrity - Analytics integrity metadata
 * @returns EventMonetizationHooks object
 */
export function buildEventMonetizationHooks(
  metrics: EventAnalyticsMetrics,
  sponsorCount: number,
  integrity: AnalyticsIntegrityMetadata
): EventMonetizationHooks {
  const billableUnits = buildEventBillableUnits(metrics, sponsorCount);
  const dataAvailable = integrity.status === ANALYTICS_INTEGRITY_STATUS.COMPLETE ||
                        integrity.status === ANALYTICS_INTEGRITY_STATUS.INCOMPLETE;

  let statusMessage: string;
  if (!dataAvailable) {
    statusMessage = 'Analytics data unavailable - billable units may be incomplete';
  } else if (billableUnits.impressions === 0 && billableUnits.qrScans === 0) {
    statusMessage = 'No billable activity recorded in this window';
  } else {
    statusMessage = 'Billable units aggregated from analytics';
  }

  return {
    billableUnits,
    billingWindow: {
      windowStart: integrity.window.windowStart,
      windowEnd: integrity.window.windowEnd,
    },
    dataAvailable,
    statusMessage,
  };
}

/**
 * Event monetization response structure
 *
 * Story F4: API response shape for event monetization endpoint.
 */
export interface EventMonetizationResponse {
  ok: boolean;
  /** Event identifier */
  eventId: string;
  /** Event name */
  eventName: string;
  /** Monetization hooks (INERT - no billing logic) */
  monetization: EventMonetizationHooks;
  /** Analytics integrity metadata */
  integrity: AnalyticsIntegrityMetadata;
  /** Contract version */
  _contractVersion: string;
  /** Timestamp of response generation */
  generatedAt: string;
  /** Invariant marker for contract testing */
  _invariant: 'F4_MONETIZATION_HOOKS';
}

/**
 * Build event monetization response
 *
 * Story F4: Creates the full API response for event monetization endpoint.
 * INERT: No billing logic is executed.
 */
export function buildEventMonetizationResponse(
  eventId: string,
  eventName: string,
  monetization: EventMonetizationHooks,
  integrity: AnalyticsIntegrityMetadata
): EventMonetizationResponse {
  return {
    ok: true,
    eventId,
    eventName,
    monetization,
    integrity,
    _contractVersion: ANALYTICS_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    _invariant: 'F4_MONETIZATION_HOOKS',
  };
}

/**
 * Log event monetization hooks access for audit
 */
export function logEventMonetizationAccess(
  eventId: string,
  monetization: EventMonetizationHooks
): void {
  console.log(JSON.stringify({
    type: 'EVENT_MONETIZATION_ACCESS',
    timestamp: new Date().toISOString(),
    eventId,
    billableUnits: monetization.billableUnits,
    billingWindow: monetization.billingWindow,
    dataAvailable: monetization.dataAvailable,
    inert: true, // Billing hooks are always inert in F4
    invariant: 'F4_MONETIZATION_HOOKS',
  }));
}

/**
 * Check if event monetization hooks are inert
 *
 * Story F4 CI/CD Gate: Ensures billing hooks stay inert.
 */
export function checkEventMonetizationHooksInert(): {
  inert: true;
  billingLogicExecuted: false;
  paymentProcessing: false;
  message: string;
} {
  return {
    inert: true,
    billingLogicExecuted: false,
    paymentProcessing: false,
    message: 'Story F4: Event monetization hooks are inert - no billing logic executed',
  };
}
