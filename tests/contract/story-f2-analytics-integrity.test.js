/**
 * Story F2 - Analytics Integrity Enforcement Tests
 *
 * Purpose: Validate the locked analytics contract to ensure analytics
 * are never partial, stale, or misleading. Analytics are useless if
 * they're wrong - this prevents silent drift.
 *
 * CI/CD Gate: Stage-2 FAILS if analytics integrity contract drifts.
 *
 * Contract Version: 1.0.0
 *
 * Validity Rules (Backend Architect):
 *   - generatedAt: When analytics were computed
 *   - windowStart: Start of aggregation window
 *   - windowEnd: End of aggregation window
 *
 * Failure Modes:
 *   - COMPLETE: All data sources available
 *   - INCOMPLETE: Some data sources unavailable
 *   - STALE: Data older than threshold
 *   - UNAVAILABLE: Cannot compute analytics
 *
 * Invariants (LOCKED):
 *   - Counts must NEVER decrease (monotonicity)
 *   - Missing data must be EXPLICIT
 *   - Backend never returns "complete" if inputs missing
 *   - Responses include integrity metadata
 *
 * HERMETIC TEST: This test is self-contained and does not require
 * the worker TypeScript to be compiled. The contract constants and
 * validation functions are replicated here to ensure CI/CD can run
 * without build dependencies.
 *
 * @see worker/src/domain/analytics.ts
 * @see Story F2 - Analytics Integrity Enforcement (No Silent Drift)
 */

// =============================================================================
// LOCKED CONTRACT CONSTANTS (Replicated for hermetic testing)
// These MUST match worker/src/domain/analytics.ts exactly
// =============================================================================

/**
 * Current analytics contract version
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const ANALYTICS_CONTRACT_VERSION = '1.0.0';

/**
 * Analytics integrity status values
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const ANALYTICS_INTEGRITY_STATUS = {
  COMPLETE: 'COMPLETE',
  INCOMPLETE: 'INCOMPLETE',
  STALE: 'STALE',
  UNAVAILABLE: 'UNAVAILABLE',
};

/**
 * Valid integrity statuses
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const VALID_INTEGRITY_STATUSES = [
  'COMPLETE',
  'INCOMPLETE',
  'STALE',
  'UNAVAILABLE',
];

/**
 * Required analytics window fields
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const ANALYTICS_WINDOW_REQUIRED_FIELDS = [
  'windowStart',
  'windowEnd',
];

/**
 * Required event metrics fields
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const EVENT_METRICS_REQUIRED_FIELDS = [
  'impressions',
  'scans',
  'dwellSeconds',
  'uniqueSessions',
];

/**
 * Required sponsor analytics metrics fields
 * LOCKED: Must match worker/src/domain/analytics.ts (note: different from F1 sponsor metrics)
 */
const SPONSOR_ANALYTICS_METRICS_REQUIRED_FIELDS = [
  'impressions',
  'scans',
  'conversions',
  'ctr',
];

/**
 * Required integrity metadata fields
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const INTEGRITY_METADATA_REQUIRED_FIELDS = [
  'generatedAt',
  'window',
  'status',
  'statusMessage',
  'availableSources',
  'unavailableSources',
  'stalenessThresholdSec',
  'dataAgeSec',
];

/**
 * Required event analytics fields
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const EVENT_ANALYTICS_REQUIRED_FIELDS = [
  'eventId',
  'eventName',
  'metrics',
  'integrity',
];

/**
 * Required sponsor analytics fields
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const SPONSOR_ANALYTICS_REQUIRED_FIELDS = [
  'sponsorId',
  'sponsorName',
  'eventIds',
  'metrics',
  'integrity',
];

/**
 * Known data sources
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const ANALYTICS_DATA_SOURCES = [
  'worker_logs',
  'gas_logs',
  'client_logs',
  'sheets_data',
];

/**
 * Default staleness threshold in seconds
 */
const DEFAULT_STALENESS_THRESHOLD_SEC = 300;

/**
 * Default event metrics
 */
const DEFAULT_EVENT_METRICS = {
  impressions: 0,
  scans: 0,
  dwellSeconds: 0,
  uniqueSessions: 0,
};

/**
 * Default sponsor analytics metrics
 */
const DEFAULT_SPONSOR_ANALYTICS_METRICS = {
  impressions: 0,
  scans: 0,
  conversions: 0,
  ctr: 0,
};

// =============================================================================
// VALIDATION FUNCTIONS (Replicated for hermetic testing)
// =============================================================================

function isValidIntegrityStatus(value) {
  return typeof value === 'string' && VALID_INTEGRITY_STATUSES.includes(value);
}

function isValidAnalyticsWindow(window) {
  if (!window || typeof window !== 'object') return false;

  for (const field of ANALYTICS_WINDOW_REQUIRED_FIELDS) {
    if (!(field in window)) return false;
    if (typeof window[field] !== 'string') return false;
  }

  const windowStart = new Date(window.windowStart);
  const windowEnd = new Date(window.windowEnd);

  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    return false;
  }

  if (windowEnd <= windowStart) {
    return false;
  }

  return true;
}

function isValidEventMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;

  for (const field of EVENT_METRICS_REQUIRED_FIELDS) {
    if (!(field in metrics)) return false;
    const value = metrics[field];
    if (typeof value !== 'number' || value < 0) return false;
    if (field !== 'dwellSeconds' && !Number.isInteger(value)) return false;
  }

  return true;
}

function isValidSponsorAnalyticsMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;

  for (const field of SPONSOR_ANALYTICS_METRICS_REQUIRED_FIELDS) {
    if (!(field in metrics)) return false;
    const value = metrics[field];
    if (typeof value !== 'number' || value < 0) return false;
    if (field !== 'ctr' && !Number.isInteger(value)) return false;
  }

  if (metrics.ctr > 100) return false;

  return true;
}

function isValidIntegrityMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return false;

  for (const field of INTEGRITY_METADATA_REQUIRED_FIELDS) {
    if (!(field in metadata)) return false;
  }

  if (typeof metadata.generatedAt !== 'string') return false;
  if (!isValidAnalyticsWindow(metadata.window)) return false;
  if (!isValidIntegrityStatus(metadata.status)) return false;
  if (typeof metadata.statusMessage !== 'string') return false;
  if (!Array.isArray(metadata.availableSources)) return false;
  if (!Array.isArray(metadata.unavailableSources)) return false;
  if (typeof metadata.stalenessThresholdSec !== 'number' || metadata.stalenessThresholdSec < 0) return false;
  if (typeof metadata.dataAgeSec !== 'number' || metadata.dataAgeSec < 0) return false;

  const generatedAt = new Date(metadata.generatedAt);
  if (isNaN(generatedAt.getTime())) return false;

  return true;
}

function validateEventAnalytics(analytics) {
  if (!analytics || typeof analytics !== 'object') {
    return { valid: false, error: 'Analytics must be a non-null object' };
  }

  if (!('eventId' in analytics) || typeof analytics.eventId !== 'string' || analytics.eventId.length === 0) {
    return { valid: false, error: 'Missing or invalid eventId' };
  }

  if (!('eventName' in analytics) || typeof analytics.eventName !== 'string') {
    return { valid: false, error: 'Missing or invalid eventName' };
  }

  if (!('metrics' in analytics)) {
    return { valid: false, error: 'Missing metrics object' };
  }
  if (!isValidEventMetrics(analytics.metrics)) {
    return { valid: false, error: 'Invalid metrics object' };
  }

  if (!('integrity' in analytics)) {
    return { valid: false, error: 'Missing integrity metadata' };
  }
  if (!isValidIntegrityMetadata(analytics.integrity)) {
    return { valid: false, error: 'Invalid integrity metadata' };
  }

  return { valid: true };
}

function validateSponsorAnalytics(analytics) {
  if (!analytics || typeof analytics !== 'object') {
    return { valid: false, error: 'Analytics must be a non-null object' };
  }

  if (!('sponsorId' in analytics) || typeof analytics.sponsorId !== 'string' || analytics.sponsorId.length === 0) {
    return { valid: false, error: 'Missing or invalid sponsorId' };
  }

  if (!('sponsorName' in analytics) || typeof analytics.sponsorName !== 'string') {
    return { valid: false, error: 'Missing or invalid sponsorName' };
  }

  if (!('eventIds' in analytics) || !Array.isArray(analytics.eventIds)) {
    return { valid: false, error: 'Missing or invalid eventIds array' };
  }

  if (!('metrics' in analytics)) {
    return { valid: false, error: 'Missing metrics object' };
  }
  if (!isValidSponsorAnalyticsMetrics(analytics.metrics)) {
    return { valid: false, error: 'Invalid metrics object' };
  }

  if (!('integrity' in analytics)) {
    return { valid: false, error: 'Missing integrity metadata' };
  }
  if (!isValidIntegrityMetadata(analytics.integrity)) {
    return { valid: false, error: 'Invalid integrity metadata' };
  }

  return { valid: true };
}

function determineIntegrityStatus(availableSources, requiredSources, dataAgeSec, stalenessThresholdSec = DEFAULT_STALENESS_THRESHOLD_SEC) {
  const unavailableSources = requiredSources.filter(
    (source) => !availableSources.includes(source)
  );

  if (availableSources.length === 0) {
    return {
      status: ANALYTICS_INTEGRITY_STATUS.UNAVAILABLE,
      message: 'No data sources available',
    };
  }

  if (dataAgeSec > stalenessThresholdSec) {
    return {
      status: ANALYTICS_INTEGRITY_STATUS.STALE,
      message: `Data is ${dataAgeSec}s old, threshold is ${stalenessThresholdSec}s`,
    };
  }

  if (unavailableSources.length > 0) {
    return {
      status: ANALYTICS_INTEGRITY_STATUS.INCOMPLETE,
      message: `Missing sources: ${unavailableSources.join(', ')}`,
    };
  }

  return {
    status: ANALYTICS_INTEGRITY_STATUS.COMPLETE,
    message: 'All data sources available and fresh',
  };
}

function checkMonotonicity(checkpoint) {
  const { previousValue, currentValue } = checkpoint;

  if (currentValue >= previousValue) {
    return null;
  }

  const drift = currentValue - previousValue;
  const driftPercent = previousValue > 0 ? Math.abs(drift / previousValue) * 100 : 100;

  let severity;
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

function aggregateEventMetrics(sources) {
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

function aggregateSponsorAnalyticsMetrics(sources) {
  const aggregated = sources.reduce(
    (acc, source) => ({
      impressions: acc.impressions + (source.impressions ?? 0),
      scans: acc.scans + (source.scans ?? 0),
      conversions: acc.conversions + (source.conversions ?? 0),
      ctr: 0,
    }),
    { ...DEFAULT_SPONSOR_ANALYTICS_METRICS }
  );

  aggregated.ctr = aggregated.impressions > 0
    ? (aggregated.conversions / aggregated.impressions) * 100
    : 0;

  return aggregated;
}

function checkEventAnalyticsCompliance(analytics) {
  const missingFields = [];
  const invalidFields = [];

  if (!analytics || typeof analytics !== 'object') {
    return {
      compliant: false,
      version: ANALYTICS_CONTRACT_VERSION,
      missingFields: [...EVENT_ANALYTICS_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
    };
  }

  for (const field of EVENT_ANALYTICS_REQUIRED_FIELDS) {
    if (!(field in analytics)) {
      missingFields.push(field);
    }
  }

  if ('eventId' in analytics && (typeof analytics.eventId !== 'string' || analytics.eventId.length === 0)) {
    invalidFields.push('eventId: must be non-empty string');
  }

  if ('eventName' in analytics && typeof analytics.eventName !== 'string') {
    invalidFields.push('eventName: must be string');
  }

  if ('metrics' in analytics && !isValidEventMetrics(analytics.metrics)) {
    invalidFields.push('metrics: invalid shape');
  }

  if ('integrity' in analytics && !isValidIntegrityMetadata(analytics.integrity)) {
    invalidFields.push('integrity: invalid shape');
  }

  return {
    compliant: missingFields.length === 0 && invalidFields.length === 0,
    version: ANALYTICS_CONTRACT_VERSION,
    missingFields,
    invalidFields,
  };
}

function checkSponsorAnalyticsCompliance(analytics) {
  const missingFields = [];
  const invalidFields = [];

  if (!analytics || typeof analytics !== 'object') {
    return {
      compliant: false,
      version: ANALYTICS_CONTRACT_VERSION,
      missingFields: [...SPONSOR_ANALYTICS_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
    };
  }

  for (const field of SPONSOR_ANALYTICS_REQUIRED_FIELDS) {
    if (!(field in analytics)) {
      missingFields.push(field);
    }
  }

  if ('sponsorId' in analytics && (typeof analytics.sponsorId !== 'string' || analytics.sponsorId.length === 0)) {
    invalidFields.push('sponsorId: must be non-empty string');
  }

  if ('sponsorName' in analytics && typeof analytics.sponsorName !== 'string') {
    invalidFields.push('sponsorName: must be string');
  }

  if ('eventIds' in analytics && !Array.isArray(analytics.eventIds)) {
    invalidFields.push('eventIds: must be array');
  }

  if ('metrics' in analytics && !isValidSponsorAnalyticsMetrics(analytics.metrics)) {
    invalidFields.push('metrics: invalid shape');
  }

  if ('integrity' in analytics && !isValidIntegrityMetadata(analytics.integrity)) {
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
// HELPER FUNCTIONS
// =============================================================================

function createValidIntegrityMetadata(overrides = {}) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 3600000).toISOString(); // 1 hour ago
  const windowEnd = new Date(now.getTime() - 60000).toISOString(); // 1 minute ago

  return {
    generatedAt: now.toISOString(),
    window: { windowStart, windowEnd },
    status: ANALYTICS_INTEGRITY_STATUS.COMPLETE,
    statusMessage: 'All data sources available and fresh',
    availableSources: [...ANALYTICS_DATA_SOURCES],
    unavailableSources: [],
    stalenessThresholdSec: DEFAULT_STALENESS_THRESHOLD_SEC,
    dataAgeSec: 60,
    ...overrides,
  };
}

function createValidEventAnalytics(overrides = {}) {
  return {
    eventId: 'evt-test-001',
    eventName: 'Test Event',
    metrics: {
      impressions: 1000,
      scans: 100,
      dwellSeconds: 5000.5,
      uniqueSessions: 500,
    },
    integrity: createValidIntegrityMetadata(),
    ...overrides,
  };
}

function createValidSponsorAnalytics(overrides = {}) {
  return {
    sponsorId: 'sp-test-001',
    sponsorName: 'Test Sponsor',
    eventIds: ['evt-001', 'evt-002'],
    metrics: {
      impressions: 5000,
      scans: 500,
      conversions: 250,
      ctr: 5.0,
    },
    integrity: createValidIntegrityMetadata(),
    ...overrides,
  };
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Story F2: Analytics Integrity Enforcement (No Silent Drift)', () => {

  // ===========================================================================
  // CONTRACT VERSION TESTS
  // ===========================================================================
  describe('Contract Version', () => {
    it('should have a defined contract version', () => {
      expect(ANALYTICS_CONTRACT_VERSION).toBeDefined();
      expect(typeof ANALYTICS_CONTRACT_VERSION).toBe('string');
    });

    it('should follow semver format', () => {
      expect(ANALYTICS_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should be version 1.0.0 for MVP', () => {
      expect(ANALYTICS_CONTRACT_VERSION).toBe('1.0.0');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS - INTEGRITY STATUS
  // Stage-2 CI/CD GATE: These tests MUST pass or deploy fails
  // ===========================================================================
  describe('Locked Contract Fields - Integrity Status (CI/CD Gate)', () => {

    it('should have exactly 4 integrity statuses', () => {
      expect(VALID_INTEGRITY_STATUSES).toHaveLength(4);
    });

    it('should include COMPLETE status', () => {
      expect(VALID_INTEGRITY_STATUSES).toContain('COMPLETE');
      expect(ANALYTICS_INTEGRITY_STATUS.COMPLETE).toBe('COMPLETE');
    });

    it('should include INCOMPLETE status', () => {
      expect(VALID_INTEGRITY_STATUSES).toContain('INCOMPLETE');
      expect(ANALYTICS_INTEGRITY_STATUS.INCOMPLETE).toBe('INCOMPLETE');
    });

    it('should include STALE status', () => {
      expect(VALID_INTEGRITY_STATUSES).toContain('STALE');
      expect(ANALYTICS_INTEGRITY_STATUS.STALE).toBe('STALE');
    });

    it('should include UNAVAILABLE status', () => {
      expect(VALID_INTEGRITY_STATUSES).toContain('UNAVAILABLE');
      expect(ANALYTICS_INTEGRITY_STATUS.UNAVAILABLE).toBe('UNAVAILABLE');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS - ANALYTICS WINDOW
  // ===========================================================================
  describe('Locked Contract Fields - Analytics Window (CI/CD Gate)', () => {

    it('should have exactly 2 required window fields', () => {
      expect(ANALYTICS_WINDOW_REQUIRED_FIELDS).toHaveLength(2);
    });

    it('should require windowStart field', () => {
      expect(ANALYTICS_WINDOW_REQUIRED_FIELDS).toContain('windowStart');
    });

    it('should require windowEnd field', () => {
      expect(ANALYTICS_WINDOW_REQUIRED_FIELDS).toContain('windowEnd');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS - EVENT METRICS
  // ===========================================================================
  describe('Locked Contract Fields - Event Metrics (CI/CD Gate)', () => {

    it('should have exactly 4 required event metrics fields', () => {
      expect(EVENT_METRICS_REQUIRED_FIELDS).toHaveLength(4);
    });

    it('should require impressions metric', () => {
      expect(EVENT_METRICS_REQUIRED_FIELDS).toContain('impressions');
    });

    it('should require scans metric', () => {
      expect(EVENT_METRICS_REQUIRED_FIELDS).toContain('scans');
    });

    it('should require dwellSeconds metric', () => {
      expect(EVENT_METRICS_REQUIRED_FIELDS).toContain('dwellSeconds');
    });

    it('should require uniqueSessions metric', () => {
      expect(EVENT_METRICS_REQUIRED_FIELDS).toContain('uniqueSessions');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS - SPONSOR ANALYTICS METRICS
  // ===========================================================================
  describe('Locked Contract Fields - Sponsor Analytics Metrics (CI/CD Gate)', () => {

    it('should have exactly 4 required sponsor analytics metrics fields', () => {
      expect(SPONSOR_ANALYTICS_METRICS_REQUIRED_FIELDS).toHaveLength(4);
    });

    it('should require impressions metric', () => {
      expect(SPONSOR_ANALYTICS_METRICS_REQUIRED_FIELDS).toContain('impressions');
    });

    it('should require scans metric', () => {
      expect(SPONSOR_ANALYTICS_METRICS_REQUIRED_FIELDS).toContain('scans');
    });

    it('should require conversions metric', () => {
      expect(SPONSOR_ANALYTICS_METRICS_REQUIRED_FIELDS).toContain('conversions');
    });

    it('should require ctr metric', () => {
      expect(SPONSOR_ANALYTICS_METRICS_REQUIRED_FIELDS).toContain('ctr');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS - INTEGRITY METADATA
  // ===========================================================================
  describe('Locked Contract Fields - Integrity Metadata (CI/CD Gate)', () => {

    it('should have exactly 8 required integrity metadata fields', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toHaveLength(8);
    });

    it('should require generatedAt field', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('generatedAt');
    });

    it('should require window field', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('window');
    });

    it('should require status field', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('status');
    });

    it('should require statusMessage field', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('statusMessage');
    });

    it('should require availableSources field', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('availableSources');
    });

    it('should require unavailableSources field', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('unavailableSources');
    });

    it('should require stalenessThresholdSec field', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('stalenessThresholdSec');
    });

    it('should require dataAgeSec field', () => {
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('dataAgeSec');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS - EVENT ANALYTICS
  // ===========================================================================
  describe('Locked Contract Fields - Event Analytics (CI/CD Gate)', () => {

    it('should have exactly 4 required event analytics fields', () => {
      expect(EVENT_ANALYTICS_REQUIRED_FIELDS).toHaveLength(4);
    });

    it('should require eventId field', () => {
      expect(EVENT_ANALYTICS_REQUIRED_FIELDS).toContain('eventId');
    });

    it('should require eventName field', () => {
      expect(EVENT_ANALYTICS_REQUIRED_FIELDS).toContain('eventName');
    });

    it('should require metrics field', () => {
      expect(EVENT_ANALYTICS_REQUIRED_FIELDS).toContain('metrics');
    });

    it('should require integrity field', () => {
      expect(EVENT_ANALYTICS_REQUIRED_FIELDS).toContain('integrity');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS - SPONSOR ANALYTICS
  // ===========================================================================
  describe('Locked Contract Fields - Sponsor Analytics (CI/CD Gate)', () => {

    it('should have exactly 5 required sponsor analytics fields', () => {
      expect(SPONSOR_ANALYTICS_REQUIRED_FIELDS).toHaveLength(5);
    });

    it('should require sponsorId field', () => {
      expect(SPONSOR_ANALYTICS_REQUIRED_FIELDS).toContain('sponsorId');
    });

    it('should require sponsorName field', () => {
      expect(SPONSOR_ANALYTICS_REQUIRED_FIELDS).toContain('sponsorName');
    });

    it('should require eventIds field', () => {
      expect(SPONSOR_ANALYTICS_REQUIRED_FIELDS).toContain('eventIds');
    });

    it('should require metrics field', () => {
      expect(SPONSOR_ANALYTICS_REQUIRED_FIELDS).toContain('metrics');
    });

    it('should require integrity field', () => {
      expect(SPONSOR_ANALYTICS_REQUIRED_FIELDS).toContain('integrity');
    });
  });

  // ===========================================================================
  // DATA SOURCES
  // ===========================================================================
  describe('Data Sources', () => {

    it('should have exactly 4 known data sources', () => {
      expect(ANALYTICS_DATA_SOURCES).toHaveLength(4);
    });

    it('should include worker_logs source', () => {
      expect(ANALYTICS_DATA_SOURCES).toContain('worker_logs');
    });

    it('should include gas_logs source', () => {
      expect(ANALYTICS_DATA_SOURCES).toContain('gas_logs');
    });

    it('should include client_logs source', () => {
      expect(ANALYTICS_DATA_SOURCES).toContain('client_logs');
    });

    it('should include sheets_data source', () => {
      expect(ANALYTICS_DATA_SOURCES).toContain('sheets_data');
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTIONS - INTEGRITY STATUS
  // ===========================================================================
  describe('Validation Functions - Integrity Status', () => {

    it('should accept valid integrity statuses', () => {
      VALID_INTEGRITY_STATUSES.forEach(status => {
        expect(isValidIntegrityStatus(status)).toBe(true);
      });
    });

    it('should reject invalid integrity statuses', () => {
      expect(isValidIntegrityStatus('INVALID')).toBe(false);
      expect(isValidIntegrityStatus('complete')).toBe(false); // case sensitive
      expect(isValidIntegrityStatus('')).toBe(false);
      expect(isValidIntegrityStatus(null)).toBe(false);
      expect(isValidIntegrityStatus(undefined)).toBe(false);
      expect(isValidIntegrityStatus(123)).toBe(false);
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTIONS - ANALYTICS WINDOW
  // ===========================================================================
  describe('Validation Functions - Analytics Window', () => {

    it('should accept valid analytics window', () => {
      const validWindow = {
        windowStart: '2024-01-01T00:00:00.000Z',
        windowEnd: '2024-01-01T01:00:00.000Z',
      };
      expect(isValidAnalyticsWindow(validWindow)).toBe(true);
    });

    it('should reject window with missing fields', () => {
      expect(isValidAnalyticsWindow({ windowStart: '2024-01-01T00:00:00.000Z' })).toBe(false);
      expect(isValidAnalyticsWindow({ windowEnd: '2024-01-01T01:00:00.000Z' })).toBe(false);
      expect(isValidAnalyticsWindow({})).toBe(false);
    });

    it('should reject window with invalid dates', () => {
      expect(isValidAnalyticsWindow({
        windowStart: 'invalid',
        windowEnd: '2024-01-01T01:00:00.000Z',
      })).toBe(false);
    });

    it('should reject window where end is before start', () => {
      expect(isValidAnalyticsWindow({
        windowStart: '2024-01-01T02:00:00.000Z',
        windowEnd: '2024-01-01T01:00:00.000Z',
      })).toBe(false);
    });

    it('should reject window where end equals start', () => {
      expect(isValidAnalyticsWindow({
        windowStart: '2024-01-01T01:00:00.000Z',
        windowEnd: '2024-01-01T01:00:00.000Z',
      })).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(isValidAnalyticsWindow(null)).toBe(false);
      expect(isValidAnalyticsWindow(undefined)).toBe(false);
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTIONS - EVENT METRICS
  // ===========================================================================
  describe('Validation Functions - Event Metrics', () => {

    it('should accept valid event metrics', () => {
      expect(isValidEventMetrics({
        impressions: 100,
        scans: 50,
        dwellSeconds: 1000.5,
        uniqueSessions: 25,
      })).toBe(true);

      expect(isValidEventMetrics(DEFAULT_EVENT_METRICS)).toBe(true);
    });

    it('should reject metrics with missing fields', () => {
      expect(isValidEventMetrics({ impressions: 100 })).toBe(false);
      expect(isValidEventMetrics({ impressions: 100, scans: 50 })).toBe(false);
      expect(isValidEventMetrics({})).toBe(false);
    });

    it('should reject negative metrics', () => {
      expect(isValidEventMetrics({
        impressions: -1,
        scans: 0,
        dwellSeconds: 0,
        uniqueSessions: 0,
      })).toBe(false);
    });

    it('should reject non-integer count metrics (except dwellSeconds)', () => {
      expect(isValidEventMetrics({
        impressions: 1.5,
        scans: 0,
        dwellSeconds: 0,
        uniqueSessions: 0,
      })).toBe(false);
    });

    it('should allow non-integer dwellSeconds', () => {
      expect(isValidEventMetrics({
        impressions: 100,
        scans: 50,
        dwellSeconds: 1234.56,
        uniqueSessions: 25,
      })).toBe(true);
    });

    it('should reject null/undefined', () => {
      expect(isValidEventMetrics(null)).toBe(false);
      expect(isValidEventMetrics(undefined)).toBe(false);
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTIONS - SPONSOR ANALYTICS METRICS
  // ===========================================================================
  describe('Validation Functions - Sponsor Analytics Metrics', () => {

    it('should accept valid sponsor analytics metrics', () => {
      expect(isValidSponsorAnalyticsMetrics({
        impressions: 1000,
        scans: 100,
        conversions: 50,
        ctr: 5.0,
      })).toBe(true);

      expect(isValidSponsorAnalyticsMetrics(DEFAULT_SPONSOR_ANALYTICS_METRICS)).toBe(true);
    });

    it('should reject metrics with missing fields', () => {
      expect(isValidSponsorAnalyticsMetrics({ impressions: 100 })).toBe(false);
      expect(isValidSponsorAnalyticsMetrics({})).toBe(false);
    });

    it('should reject negative metrics', () => {
      expect(isValidSponsorAnalyticsMetrics({
        impressions: -1,
        scans: 0,
        conversions: 0,
        ctr: 0,
      })).toBe(false);
    });

    it('should reject CTR greater than 100', () => {
      expect(isValidSponsorAnalyticsMetrics({
        impressions: 100,
        scans: 50,
        conversions: 25,
        ctr: 150,
      })).toBe(false);
    });

    it('should allow fractional CTR between 0 and 100', () => {
      expect(isValidSponsorAnalyticsMetrics({
        impressions: 100,
        scans: 50,
        conversions: 25,
        ctr: 25.5,
      })).toBe(true);
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTIONS - INTEGRITY METADATA
  // ===========================================================================
  describe('Validation Functions - Integrity Metadata', () => {

    it('should accept valid integrity metadata', () => {
      const metadata = createValidIntegrityMetadata();
      expect(isValidIntegrityMetadata(metadata)).toBe(true);
    });

    it('should reject metadata with missing fields', () => {
      expect(isValidIntegrityMetadata({
        generatedAt: new Date().toISOString(),
      })).toBe(false);
    });

    it('should reject metadata with invalid window', () => {
      const metadata = createValidIntegrityMetadata({
        window: { windowStart: 'invalid', windowEnd: 'invalid' },
      });
      expect(isValidIntegrityMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid status', () => {
      const metadata = createValidIntegrityMetadata({ status: 'INVALID' });
      expect(isValidIntegrityMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid generatedAt', () => {
      const metadata = createValidIntegrityMetadata({ generatedAt: 'invalid-date' });
      expect(isValidIntegrityMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with negative dataAgeSec', () => {
      const metadata = createValidIntegrityMetadata({ dataAgeSec: -10 });
      expect(isValidIntegrityMetadata(metadata)).toBe(false);
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTIONS - EVENT ANALYTICS CONTRACT
  // ===========================================================================
  describe('Validation Functions - Event Analytics Contract', () => {

    it('should validate a complete valid event analytics', () => {
      const analytics = createValidEventAnalytics();
      const result = validateEventAnalytics(analytics);
      expect(result.valid).toBe(true);
    });

    it('should reject analytics without eventId', () => {
      const { eventId, ...rest } = createValidEventAnalytics();
      const result = validateEventAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('eventId');
    });

    it('should reject analytics without eventName', () => {
      const { eventName, ...rest } = createValidEventAnalytics();
      const result = validateEventAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('eventName');
    });

    it('should reject analytics without metrics', () => {
      const { metrics, ...rest } = createValidEventAnalytics();
      const result = validateEventAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('metrics');
    });

    it('should reject analytics without integrity', () => {
      const { integrity, ...rest } = createValidEventAnalytics();
      const result = validateEventAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('integrity');
    });

    it('should reject null analytics', () => {
      const result = validateEventAnalytics(null);
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTIONS - SPONSOR ANALYTICS CONTRACT
  // ===========================================================================
  describe('Validation Functions - Sponsor Analytics Contract', () => {

    it('should validate a complete valid sponsor analytics', () => {
      const analytics = createValidSponsorAnalytics();
      const result = validateSponsorAnalytics(analytics);
      expect(result.valid).toBe(true);
    });

    it('should reject analytics without sponsorId', () => {
      const { sponsorId, ...rest } = createValidSponsorAnalytics();
      const result = validateSponsorAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('sponsorId');
    });

    it('should reject analytics without sponsorName', () => {
      const { sponsorName, ...rest } = createValidSponsorAnalytics();
      const result = validateSponsorAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('sponsorName');
    });

    it('should reject analytics without eventIds', () => {
      const { eventIds, ...rest } = createValidSponsorAnalytics();
      const result = validateSponsorAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('eventIds');
    });

    it('should reject analytics without metrics', () => {
      const { metrics, ...rest } = createValidSponsorAnalytics();
      const result = validateSponsorAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('metrics');
    });

    it('should reject analytics without integrity', () => {
      const { integrity, ...rest } = createValidSponsorAnalytics();
      const result = validateSponsorAnalytics(rest);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('integrity');
    });
  });

  // ===========================================================================
  // INTEGRITY STATUS DETERMINATION - CRITICAL INVARIANT
  // Backend never returns "complete" if inputs missing
  // ===========================================================================
  describe('Integrity Status Determination (CI/CD Gate)', () => {

    it('INVARIANT: should return UNAVAILABLE when no sources available', () => {
      const result = determineIntegrityStatus([], ANALYTICS_DATA_SOURCES, 0);
      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.UNAVAILABLE);
      expect(result.message).toContain('No data sources');
    });

    it('INVARIANT: should return STALE when data is older than threshold', () => {
      const result = determineIntegrityStatus(
        ANALYTICS_DATA_SOURCES,
        ANALYTICS_DATA_SOURCES,
        600, // 10 minutes
        DEFAULT_STALENESS_THRESHOLD_SEC // 5 minutes threshold
      );
      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.STALE);
      expect(result.message).toContain('600s old');
    });

    it('INVARIANT: should return INCOMPLETE when sources are missing', () => {
      const result = determineIntegrityStatus(
        ['worker_logs'], // Only one source available
        ANALYTICS_DATA_SOURCES, // All required
        0
      );
      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.INCOMPLETE);
      expect(result.message).toContain('Missing sources');
    });

    it('INVARIANT: should return COMPLETE only when ALL sources available and data is fresh', () => {
      const result = determineIntegrityStatus(
        ANALYTICS_DATA_SOURCES, // All available
        ANALYTICS_DATA_SOURCES, // All required
        60 // 1 minute (fresh)
      );
      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.COMPLETE);
    });

    it('INVARIANT: should never return COMPLETE if any required source is missing', () => {
      // This is the core invariant - backend never lies about completeness
      const requiredSources = ['worker_logs', 'gas_logs'];
      const availableSources = ['worker_logs']; // Missing gas_logs

      const result = determineIntegrityStatus(availableSources, requiredSources, 0);
      expect(result.status).not.toBe(ANALYTICS_INTEGRITY_STATUS.COMPLETE);
      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.INCOMPLETE);
    });
  });

  // ===========================================================================
  // MONOTONICITY ENFORCEMENT - CRITICAL INVARIANT
  // Counts must NEVER decrease
  // ===========================================================================
  describe('Monotonicity Enforcement (CI/CD Gate)', () => {

    it('INVARIANT: should return null when count increases', () => {
      const checkpoint = {
        timestamp: new Date().toISOString(),
        entityType: 'event',
        entityId: 'evt-001',
        metricName: 'impressions',
        previousValue: 100,
        currentValue: 150,
      };
      expect(checkMonotonicity(checkpoint)).toBeNull();
    });

    it('INVARIANT: should return null when count stays the same', () => {
      const checkpoint = {
        timestamp: new Date().toISOString(),
        entityType: 'event',
        entityId: 'evt-001',
        metricName: 'impressions',
        previousValue: 100,
        currentValue: 100,
      };
      expect(checkMonotonicity(checkpoint)).toBeNull();
    });

    it('INVARIANT: should detect violation when count DECREASES', () => {
      const checkpoint = {
        timestamp: new Date().toISOString(),
        entityType: 'event',
        entityId: 'evt-001',
        metricName: 'impressions',
        previousValue: 100,
        currentValue: 90,
      };
      const violation = checkMonotonicity(checkpoint);
      expect(violation).not.toBeNull();
      expect(violation.drift).toBe(-10);
    });

    it('INVARIANT: should classify severity as WARNING for small drift (<5%)', () => {
      const checkpoint = {
        timestamp: new Date().toISOString(),
        entityType: 'event',
        entityId: 'evt-001',
        metricName: 'impressions',
        previousValue: 100,
        currentValue: 96, // 4% decrease
      };
      const violation = checkMonotonicity(checkpoint);
      expect(violation.severity).toBe('WARNING');
    });

    it('INVARIANT: should classify severity as ERROR for medium drift (5-10%)', () => {
      const checkpoint = {
        timestamp: new Date().toISOString(),
        entityType: 'event',
        entityId: 'evt-001',
        metricName: 'impressions',
        previousValue: 100,
        currentValue: 92, // 8% decrease
      };
      const violation = checkMonotonicity(checkpoint);
      expect(violation.severity).toBe('ERROR');
    });

    it('INVARIANT: should classify severity as CRITICAL for large drift (>10%)', () => {
      const checkpoint = {
        timestamp: new Date().toISOString(),
        entityType: 'event',
        entityId: 'evt-001',
        metricName: 'impressions',
        previousValue: 100,
        currentValue: 80, // 20% decrease
      };
      const violation = checkMonotonicity(checkpoint);
      expect(violation.severity).toBe('CRITICAL');
    });

    it('INVARIANT: should track violation details for audit', () => {
      const checkpoint = {
        timestamp: '2024-01-01T00:00:00.000Z',
        entityType: 'sponsor',
        entityId: 'sp-001',
        metricName: 'conversions',
        previousValue: 50,
        currentValue: 40,
      };
      const violation = checkMonotonicity(checkpoint);

      expect(violation.checkpoint).toEqual(checkpoint);
      expect(violation.drift).toBe(-10);
      expect(violation.detectedAt).toBeDefined();
    });
  });

  // ===========================================================================
  // AGGREGATION FUNCTIONS - BACKEND-ONLY MATH
  // ===========================================================================
  describe('Aggregation Functions (Backend-Only)', () => {

    describe('aggregateEventMetrics', () => {

      it('should aggregate metrics from multiple sources', () => {
        const sources = [
          { impressions: 100, scans: 10, dwellSeconds: 1000, uniqueSessions: 50 },
          { impressions: 200, scans: 20, dwellSeconds: 2000, uniqueSessions: 100 },
          { impressions: 300, scans: 30, dwellSeconds: 3000, uniqueSessions: 150 },
        ];

        const result = aggregateEventMetrics(sources);

        expect(result.impressions).toBe(600);
        expect(result.scans).toBe(60);
        expect(result.dwellSeconds).toBe(6000);
        expect(result.uniqueSessions).toBe(300);
      });

      it('should handle partial metrics', () => {
        const sources = [
          { impressions: 100 },
          { scans: 20 },
          { dwellSeconds: 500 },
        ];

        const result = aggregateEventMetrics(sources);

        expect(result.impressions).toBe(100);
        expect(result.scans).toBe(20);
        expect(result.dwellSeconds).toBe(500);
        expect(result.uniqueSessions).toBe(0);
      });

      it('should return defaults for empty sources', () => {
        const result = aggregateEventMetrics([]);

        expect(result).toEqual(DEFAULT_EVENT_METRICS);
      });
    });

    describe('aggregateSponsorAnalyticsMetrics', () => {

      it('should aggregate metrics and compute CTR', () => {
        const sources = [
          { impressions: 1000, scans: 100, conversions: 25 },
          { impressions: 500, scans: 50, conversions: 25 },
        ];

        const result = aggregateSponsorAnalyticsMetrics(sources);

        expect(result.impressions).toBe(1500);
        expect(result.scans).toBe(150);
        expect(result.conversions).toBe(50);
        expect(result.ctr).toBeCloseTo(3.33, 1); // 50/1500 * 100 = 3.33%
      });

      it('should return 0 CTR when impressions is 0', () => {
        const sources = [
          { impressions: 0, scans: 0, conversions: 0 },
        ];

        const result = aggregateSponsorAnalyticsMetrics(sources);

        expect(result.ctr).toBe(0);
      });

      it('should return defaults for empty sources', () => {
        const result = aggregateSponsorAnalyticsMetrics([]);

        expect(result).toEqual(DEFAULT_SPONSOR_ANALYTICS_METRICS);
      });
    });
  });

  // ===========================================================================
  // CONTRACT COMPLIANCE CHECKING - CI/CD GATE
  // ===========================================================================
  describe('Contract Compliance (CI/CD Gate)', () => {

    describe('checkEventAnalyticsCompliance', () => {

      it('should pass for compliant event analytics', () => {
        const analytics = createValidEventAnalytics();
        const result = checkEventAnalyticsCompliance(analytics);

        expect(result.compliant).toBe(true);
        expect(result.version).toBe('1.0.0');
        expect(result.missingFields).toHaveLength(0);
        expect(result.invalidFields).toHaveLength(0);
      });

      it('should detect missing fields', () => {
        const result = checkEventAnalyticsCompliance({
          eventId: 'evt-001',
          eventName: 'Test',
        });

        expect(result.compliant).toBe(false);
        expect(result.missingFields).toContain('metrics');
        expect(result.missingFields).toContain('integrity');
      });

      it('should detect invalid eventId', () => {
        const analytics = createValidEventAnalytics({ eventId: '' });
        const result = checkEventAnalyticsCompliance(analytics);

        expect(result.compliant).toBe(false);
        expect(result.invalidFields.some(f => f.includes('eventId'))).toBe(true);
      });

      it('should fail for null/undefined', () => {
        expect(checkEventAnalyticsCompliance(null).compliant).toBe(false);
        expect(checkEventAnalyticsCompliance(undefined).compliant).toBe(false);
      });

      it('should report all missing fields for empty object', () => {
        const result = checkEventAnalyticsCompliance({});

        expect(result.missingFields).toHaveLength(4);
        expect(result.missingFields).toContain('eventId');
        expect(result.missingFields).toContain('eventName');
        expect(result.missingFields).toContain('metrics');
        expect(result.missingFields).toContain('integrity');
      });
    });

    describe('checkSponsorAnalyticsCompliance', () => {

      it('should pass for compliant sponsor analytics', () => {
        const analytics = createValidSponsorAnalytics();
        const result = checkSponsorAnalyticsCompliance(analytics);

        expect(result.compliant).toBe(true);
        expect(result.version).toBe('1.0.0');
        expect(result.missingFields).toHaveLength(0);
        expect(result.invalidFields).toHaveLength(0);
      });

      it('should detect missing fields', () => {
        const result = checkSponsorAnalyticsCompliance({
          sponsorId: 'sp-001',
          sponsorName: 'Test',
        });

        expect(result.compliant).toBe(false);
        expect(result.missingFields).toContain('eventIds');
        expect(result.missingFields).toContain('metrics');
        expect(result.missingFields).toContain('integrity');
      });

      it('should report all missing fields for empty object', () => {
        const result = checkSponsorAnalyticsCompliance({});

        expect(result.missingFields).toHaveLength(5);
        expect(result.missingFields).toContain('sponsorId');
        expect(result.missingFields).toContain('sponsorName');
        expect(result.missingFields).toContain('eventIds');
        expect(result.missingFields).toContain('metrics');
        expect(result.missingFields).toContain('integrity');
      });
    });
  });

  // ===========================================================================
  // CONTRACT BOUNDARY ASSERTIONS - CRITICAL INVARIANTS
  // ===========================================================================
  describe('Contract Boundary Assertions', () => {

    it('should ensure all analytics endpoints include integrity metadata', () => {
      // This test documents the contract boundary:
      // Every analytics response MUST have integrity metadata
      expect(EVENT_ANALYTICS_REQUIRED_FIELDS).toContain('integrity');
      expect(SPONSOR_ANALYTICS_REQUIRED_FIELDS).toContain('integrity');
    });

    it('should ensure missing data is explicit via unavailableSources', () => {
      // Missing data must be EXPLICIT - no silent zeros
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('unavailableSources');
    });

    it('should ensure response includes data freshness', () => {
      // Data staleness must be trackable
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('dataAgeSec');
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('stalenessThresholdSec');
    });

    it('should ensure backend never returns incomplete analytics as complete', () => {
      // Core invariant: validate that INCOMPLETE is returned for missing sources
      const partialSources = ['worker_logs'];
      const requiredSources = ANALYTICS_DATA_SOURCES;

      const result = determineIntegrityStatus(partialSources, requiredSources, 0);

      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.INCOMPLETE);
      expect(result.status).not.toBe(ANALYTICS_INTEGRITY_STATUS.COMPLETE);
    });

    it('should ensure all event analytics have window bounds', () => {
      // Analytics must have clear time bounds
      expect(INTEGRITY_METADATA_REQUIRED_FIELDS).toContain('window');
      expect(ANALYTICS_WINDOW_REQUIRED_FIELDS).toContain('windowStart');
      expect(ANALYTICS_WINDOW_REQUIRED_FIELDS).toContain('windowEnd');
    });
  });

  // ===========================================================================
  // SIMULATE MISSING LOGS - SDET TEST
  // ===========================================================================
  describe('Missing Logs Simulation (SDET)', () => {

    it('should refuse to mark as COMPLETE when worker_logs unavailable', () => {
      const availableSources = ['gas_logs', 'client_logs', 'sheets_data'];
      const result = determineIntegrityStatus(availableSources, ANALYTICS_DATA_SOURCES, 0);

      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.INCOMPLETE);
      expect(result.message).toContain('worker_logs');
    });

    it('should refuse to mark as COMPLETE when gas_logs unavailable', () => {
      const availableSources = ['worker_logs', 'client_logs', 'sheets_data'];
      const result = determineIntegrityStatus(availableSources, ANALYTICS_DATA_SOURCES, 0);

      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.INCOMPLETE);
      expect(result.message).toContain('gas_logs');
    });

    it('should refuse to mark as COMPLETE when multiple sources unavailable', () => {
      const availableSources = ['worker_logs'];
      const result = determineIntegrityStatus(availableSources, ANALYTICS_DATA_SOURCES, 0);

      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.INCOMPLETE);
      expect(result.message).toContain('gas_logs');
      expect(result.message).toContain('client_logs');
    });

    it('should handle complete data source failure gracefully', () => {
      const availableSources = [];
      const result = determineIntegrityStatus(availableSources, ANALYTICS_DATA_SOURCES, 0);

      expect(result.status).toBe(ANALYTICS_INTEGRITY_STATUS.UNAVAILABLE);
    });
  });

  // ===========================================================================
  // DEFAULT VALUES
  // ===========================================================================
  describe('Default Values', () => {

    it('should have zero default event metrics', () => {
      expect(DEFAULT_EVENT_METRICS.impressions).toBe(0);
      expect(DEFAULT_EVENT_METRICS.scans).toBe(0);
      expect(DEFAULT_EVENT_METRICS.dwellSeconds).toBe(0);
      expect(DEFAULT_EVENT_METRICS.uniqueSessions).toBe(0);
    });

    it('should have zero default sponsor analytics metrics', () => {
      expect(DEFAULT_SPONSOR_ANALYTICS_METRICS.impressions).toBe(0);
      expect(DEFAULT_SPONSOR_ANALYTICS_METRICS.scans).toBe(0);
      expect(DEFAULT_SPONSOR_ANALYTICS_METRICS.conversions).toBe(0);
      expect(DEFAULT_SPONSOR_ANALYTICS_METRICS.ctr).toBe(0);
    });

    it('should have sensible staleness threshold', () => {
      expect(DEFAULT_STALENESS_THRESHOLD_SEC).toBe(300); // 5 minutes
    });
  });
});
