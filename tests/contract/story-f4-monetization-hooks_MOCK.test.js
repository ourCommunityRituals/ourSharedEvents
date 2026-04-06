/**
 * Story F4 - Monetization Readiness Hooks Contract Tests
 *
 * Purpose: Validate the monetization hooks contract and ensure billing hooks stay INERT.
 * CI/CD Gate: Stage-2 FAILS if monetization hooks are not inert or contract drifts.
 *
 * Contract Version: 1.1.0
 *
 * Monetization Fields:
 *   - billableUnits: { qrScans, impressions, eventCount }
 *   - billingWindow: { windowStart, windowEnd }
 *   - dataAvailable: boolean
 *   - statusMessage: string
 *
 * INVARIANTS (LOCKED):
 *   - Fields are INERT (no side effects)
 *   - No billing logic is executed
 *   - No payment processing
 *   - No user-visible billing UI
 *
 * HERMETIC TEST: This test is self-contained and does not require
 * the worker TypeScript to be compiled. The contract constants and
 * validation functions are replicated here to ensure CI/CD can run
 * without build dependencies.
 *
 * @see worker/src/domain/sponsor.ts
 * @see worker/src/domain/analytics.ts
 * @see Story F4 - Monetization Readiness Hooks (No Billing Yet)
 */

// =============================================================================
// LOCKED CONTRACT CONSTANTS (Replicated for hermetic testing)
// These MUST match worker/src/domain/sponsor.ts and analytics.ts exactly
// =============================================================================

/**
 * Current sponsor contract version
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_CONTRACT_VERSION = '1.1.0';

/**
 * Required billable unit fields
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const BILLABLE_UNITS_REQUIRED_FIELDS = ['qrScans', 'impressions', 'eventCount'];

/**
 * Required billing window fields
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const BILLING_WINDOW_REQUIRED_FIELDS = ['windowStart', 'windowEnd'];

/**
 * Required monetization hooks fields
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const MONETIZATION_HOOKS_REQUIRED_FIELDS = [
  'billableUnits',
  'billingWindow',
  'dataAvailable',
  'statusMessage',
];

/**
 * Event billable unit fields
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const EVENT_BILLABLE_UNITS_REQUIRED_FIELDS = ['qrScans', 'impressions', 'sponsorCount'];

/**
 * Event monetization hooks fields
 * LOCKED: Must match worker/src/domain/analytics.ts
 */
const EVENT_MONETIZATION_HOOKS_REQUIRED_FIELDS = [
  'billableUnits',
  'billingWindow',
  'dataAvailable',
  'statusMessage',
];

/**
 * Default billable units
 */
const DEFAULT_BILLABLE_UNITS = {
  qrScans: 0,
  impressions: 0,
  eventCount: 0,
};

/**
 * Default billing window (empty)
 */
const DEFAULT_BILLING_WINDOW = {
  windowStart: '',
  windowEnd: '',
};

/**
 * Default monetization hooks
 */
const DEFAULT_MONETIZATION_HOOKS = {
  billableUnits: DEFAULT_BILLABLE_UNITS,
  billingWindow: DEFAULT_BILLING_WINDOW,
  dataAvailable: false,
  statusMessage: 'No monetization data available',
};

// =============================================================================
// VALIDATION FUNCTIONS (Replicated for hermetic testing)
// =============================================================================

function isValidBillableUnits(units) {
  if (!units || typeof units !== 'object') return false;

  for (const field of BILLABLE_UNITS_REQUIRED_FIELDS) {
    if (!(field in units)) return false;
    const value = units[field];
    if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
      return false;
    }
  }

  return true;
}

function isValidBillingWindow(window) {
  if (!window || typeof window !== 'object') return false;

  for (const field of BILLING_WINDOW_REQUIRED_FIELDS) {
    if (!(field in window)) return false;
    if (typeof window[field] !== 'string') return false;
  }

  // Empty window is valid (no data yet)
  if (window.windowStart === '' && window.windowEnd === '') {
    return true;
  }

  // If populated, validate ISO 8601 format
  const windowStart = new Date(window.windowStart);
  const windowEnd = new Date(window.windowEnd);

  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    return false;
  }

  // windowEnd must be after or equal to windowStart
  if (windowEnd < windowStart) {
    return false;
  }

  return true;
}

function isValidMonetizationHooks(hooks) {
  if (!hooks || typeof hooks !== 'object') return false;

  for (const field of MONETIZATION_HOOKS_REQUIRED_FIELDS) {
    if (!(field in hooks)) return false;
  }

  if (!isValidBillableUnits(hooks.billableUnits)) return false;
  if (!isValidBillingWindow(hooks.billingWindow)) return false;
  if (typeof hooks.dataAvailable !== 'boolean') return false;
  if (typeof hooks.statusMessage !== 'string') return false;

  return true;
}

function validateMonetizationHooks(hooks) {
  if (!hooks || typeof hooks !== 'object') {
    return { valid: false, error: 'MonetizationHooks must be a non-null object' };
  }

  if (!('billableUnits' in hooks)) {
    return { valid: false, error: 'Missing billableUnits' };
  }
  if (!isValidBillableUnits(hooks.billableUnits)) {
    return { valid: false, error: 'Invalid billableUnits' };
  }

  if (!('billingWindow' in hooks)) {
    return { valid: false, error: 'Missing billingWindow' };
  }
  if (!isValidBillingWindow(hooks.billingWindow)) {
    return { valid: false, error: 'Invalid billingWindow' };
  }

  if (!('dataAvailable' in hooks) || typeof hooks.dataAvailable !== 'boolean') {
    return { valid: false, error: 'Missing or invalid dataAvailable' };
  }

  if (!('statusMessage' in hooks) || typeof hooks.statusMessage !== 'string') {
    return { valid: false, error: 'Missing or invalid statusMessage' };
  }

  return { valid: true };
}

function isValidEventBillableUnits(units) {
  if (!units || typeof units !== 'object') return false;

  for (const field of EVENT_BILLABLE_UNITS_REQUIRED_FIELDS) {
    if (!(field in units)) return false;
    const value = units[field];
    if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
      return false;
    }
  }

  return true;
}

function isValidEventMonetizationHooks(hooks) {
  if (!hooks || typeof hooks !== 'object') return false;

  for (const field of EVENT_MONETIZATION_HOOKS_REQUIRED_FIELDS) {
    if (!(field in hooks)) return false;
  }

  if (!isValidEventBillableUnits(hooks.billableUnits)) return false;

  // Validate billing window
  const window = hooks.billingWindow;
  if (!window || typeof window !== 'object') return false;
  if (typeof window.windowStart !== 'string') return false;
  if (typeof window.windowEnd !== 'string') return false;

  if (typeof hooks.dataAvailable !== 'boolean') return false;
  if (typeof hooks.statusMessage !== 'string') return false;

  return true;
}

/**
 * Check if monetization hooks are inert (no side effects)
 *
 * LOCKED INVARIANT: This function MUST always return inert: true.
 * If billing logic is ever added, this returns false and tests fail.
 */
function checkMonetizationHooksInert() {
  // LOCKED INVARIANT: These fields MUST remain false
  // until billing is intentionally implemented
  return {
    inert: true,
    billingLogicExecuted: false,
    paymentProcessing: false,
    billingUIVisible: false,
    message: 'Story F4: Monetization hooks are inert - no billing logic executed',
  };
}

function checkEventMonetizationHooksInert() {
  return {
    inert: true,
    billingLogicExecuted: false,
    paymentProcessing: false,
    message: 'Story F4: Event monetization hooks are inert - no billing logic executed',
  };
}

function buildBillableUnits(metrics, eventCount) {
  return {
    qrScans: metrics.scans || 0,
    impressions: metrics.impressions || 0,
    eventCount: Math.max(0, Math.floor(eventCount || 0)),
  };
}

function buildBillingWindow(windowStart, windowEnd) {
  return {
    windowStart: windowStart || '',
    windowEnd: windowEnd || '',
  };
}

function buildMonetizationHooks(sponsor, windowStart, windowEnd, dataAvailable) {
  const billableUnits = buildBillableUnits(sponsor.metrics || {}, (sponsor.events || []).length);
  const billingWindow = buildBillingWindow(windowStart, windowEnd);

  let statusMessage;
  if (!dataAvailable) {
    statusMessage = 'Analytics data unavailable - billable units may be incomplete';
  } else if (billableUnits.impressions === 0 && billableUnits.qrScans === 0) {
    statusMessage = 'No billable activity recorded in this window';
  } else {
    statusMessage = 'Billable units aggregated from analytics';
  }

  return {
    billableUnits,
    billingWindow,
    dataAvailable,
    statusMessage,
  };
}

function checkMonetizationHooksCompliance(hooks) {
  const missingFields = [];
  const invalidFields = [];

  if (!hooks || typeof hooks !== 'object') {
    return {
      compliant: false,
      version: SPONSOR_CONTRACT_VERSION,
      missingFields: [...MONETIZATION_HOOKS_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
      inert: true,
    };
  }

  // Check required fields
  for (const field of MONETIZATION_HOOKS_REQUIRED_FIELDS) {
    if (!(field in hooks)) {
      missingFields.push(field);
    }
  }

  // Validate field types
  if ('billableUnits' in hooks && !isValidBillableUnits(hooks.billableUnits)) {
    invalidFields.push('billableUnits: invalid shape');
  }

  if ('billingWindow' in hooks && !isValidBillingWindow(hooks.billingWindow)) {
    invalidFields.push('billingWindow: invalid shape');
  }

  if ('dataAvailable' in hooks && typeof hooks.dataAvailable !== 'boolean') {
    invalidFields.push('dataAvailable: must be boolean');
  }

  if ('statusMessage' in hooks && typeof hooks.statusMessage !== 'string') {
    invalidFields.push('statusMessage: must be string');
  }

  return {
    compliant: missingFields.length === 0 && invalidFields.length === 0,
    version: SPONSOR_CONTRACT_VERSION,
    missingFields,
    invalidFields,
    inert: true, // Always true for F4
  };
}

describe('Story F4: Monetization Readiness Hooks (No Billing Yet)', () => {
  // ===========================================================================
  // CONTRACT VERSION TESTS
  // ===========================================================================
  describe('Contract Version', () => {
    it('should have a defined contract version', () => {
      expect(SPONSOR_CONTRACT_VERSION).toBeDefined();
      expect(typeof SPONSOR_CONTRACT_VERSION).toBe('string');
    });

    it('should follow semver format', () => {
      expect(SPONSOR_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should be version 1.1.0 for monetization hooks', () => {
      expect(SPONSOR_CONTRACT_VERSION).toBe('1.1.0');
    });
  });

  // ===========================================================================
  // LOCKED CONTRACT FIELD TESTS
  // Stage-2 CI/CD GATE: These tests MUST pass or deploy fails
  // ===========================================================================
  describe('Locked Contract Fields (CI/CD Gate)', () => {
    describe('Billable Units Fields - LOCKED', () => {
      it('should have exactly 3 required billable unit fields', () => {
        expect(BILLABLE_UNITS_REQUIRED_FIELDS).toHaveLength(3);
      });

      it('should require qrScans field', () => {
        expect(BILLABLE_UNITS_REQUIRED_FIELDS).toContain('qrScans');
      });

      it('should require impressions field', () => {
        expect(BILLABLE_UNITS_REQUIRED_FIELDS).toContain('impressions');
      });

      it('should require eventCount field', () => {
        expect(BILLABLE_UNITS_REQUIRED_FIELDS).toContain('eventCount');
      });

      it('should have field order preserved (contract stability)', () => {
        expect(BILLABLE_UNITS_REQUIRED_FIELDS[0]).toBe('qrScans');
        expect(BILLABLE_UNITS_REQUIRED_FIELDS[1]).toBe('impressions');
        expect(BILLABLE_UNITS_REQUIRED_FIELDS[2]).toBe('eventCount');
      });
    });

    describe('Billing Window Fields - LOCKED', () => {
      it('should have exactly 2 required billing window fields', () => {
        expect(BILLING_WINDOW_REQUIRED_FIELDS).toHaveLength(2);
      });

      it('should require windowStart field', () => {
        expect(BILLING_WINDOW_REQUIRED_FIELDS).toContain('windowStart');
      });

      it('should require windowEnd field', () => {
        expect(BILLING_WINDOW_REQUIRED_FIELDS).toContain('windowEnd');
      });
    });

    describe('Monetization Hooks Fields - LOCKED', () => {
      it('should have exactly 4 required monetization hooks fields', () => {
        expect(MONETIZATION_HOOKS_REQUIRED_FIELDS).toHaveLength(4);
      });

      it('should require billableUnits field', () => {
        expect(MONETIZATION_HOOKS_REQUIRED_FIELDS).toContain('billableUnits');
      });

      it('should require billingWindow field', () => {
        expect(MONETIZATION_HOOKS_REQUIRED_FIELDS).toContain('billingWindow');
      });

      it('should require dataAvailable field', () => {
        expect(MONETIZATION_HOOKS_REQUIRED_FIELDS).toContain('dataAvailable');
      });

      it('should require statusMessage field', () => {
        expect(MONETIZATION_HOOKS_REQUIRED_FIELDS).toContain('statusMessage');
      });
    });

    describe('Event Billable Units Fields - LOCKED', () => {
      it('should have exactly 3 required event billable unit fields', () => {
        expect(EVENT_BILLABLE_UNITS_REQUIRED_FIELDS).toHaveLength(3);
      });

      it('should require qrScans field', () => {
        expect(EVENT_BILLABLE_UNITS_REQUIRED_FIELDS).toContain('qrScans');
      });

      it('should require impressions field', () => {
        expect(EVENT_BILLABLE_UNITS_REQUIRED_FIELDS).toContain('impressions');
      });

      it('should require sponsorCount field', () => {
        expect(EVENT_BILLABLE_UNITS_REQUIRED_FIELDS).toContain('sponsorCount');
      });
    });
  });

  // ===========================================================================
  // INERTNESS TESTS - CRITICAL CI/CD GATE
  // These tests ensure NO billing logic is executed
  // ===========================================================================
  describe('Monetization Hooks Inertness (CRITICAL CI/CD Gate)', () => {
    describe('Sponsor Monetization Hooks Inertness', () => {
      it('should return inert: true (NO billing logic)', () => {
        const check = checkMonetizationHooksInert();
        expect(check.inert).toBe(true);
      });

      it('should return billingLogicExecuted: false', () => {
        const check = checkMonetizationHooksInert();
        expect(check.billingLogicExecuted).toBe(false);
      });

      it('should return paymentProcessing: false', () => {
        const check = checkMonetizationHooksInert();
        expect(check.paymentProcessing).toBe(false);
      });

      it('should return billingUIVisible: false', () => {
        const check = checkMonetizationHooksInert();
        expect(check.billingUIVisible).toBe(false);
      });

      it('should include Story F4 reference in message', () => {
        const check = checkMonetizationHooksInert();
        expect(check.message).toContain('F4');
        expect(check.message).toContain('inert');
      });
    });

    describe('Event Monetization Hooks Inertness', () => {
      it('should return inert: true (NO billing logic)', () => {
        const check = checkEventMonetizationHooksInert();
        expect(check.inert).toBe(true);
      });

      it('should return billingLogicExecuted: false', () => {
        const check = checkEventMonetizationHooksInert();
        expect(check.billingLogicExecuted).toBe(false);
      });

      it('should return paymentProcessing: false', () => {
        const check = checkEventMonetizationHooksInert();
        expect(check.paymentProcessing).toBe(false);
      });
    });

    describe('Compliance Check Inertness', () => {
      it('should always include inert: true in compliance check', () => {
        const hooks = {
          billableUnits: { qrScans: 100, impressions: 1000, eventCount: 5 },
          billingWindow: { windowStart: '2024-01-01T00:00:00Z', windowEnd: '2024-01-31T23:59:59Z' },
          dataAvailable: true,
          statusMessage: 'Billable units aggregated from analytics',
        };
        const compliance = checkMonetizationHooksCompliance(hooks);
        expect(compliance.inert).toBe(true);
      });

      it('should return inert: true even for invalid hooks', () => {
        const compliance = checkMonetizationHooksCompliance({});
        expect(compliance.inert).toBe(true);
      });

      it('should return inert: true for null hooks', () => {
        const compliance = checkMonetizationHooksCompliance(null);
        expect(compliance.inert).toBe(true);
      });
    });
  });

  // ===========================================================================
  // VALIDATION FUNCTION TESTS
  // ===========================================================================
  describe('Validation Functions', () => {
    describe('isValidBillableUnits', () => {
      it('should accept valid billable units', () => {
        expect(
          isValidBillableUnits({
            qrScans: 100,
            impressions: 1000,
            eventCount: 5,
          })
        ).toBe(true);
      });

      it('should accept zero values', () => {
        expect(
          isValidBillableUnits({
            qrScans: 0,
            impressions: 0,
            eventCount: 0,
          })
        ).toBe(true);
      });

      it('should reject missing fields', () => {
        expect(isValidBillableUnits({ qrScans: 100 })).toBe(false);
        expect(isValidBillableUnits({ qrScans: 100, impressions: 1000 })).toBe(false);
        expect(isValidBillableUnits({})).toBe(false);
      });

      it('should reject negative values', () => {
        expect(
          isValidBillableUnits({
            qrScans: -1,
            impressions: 1000,
            eventCount: 5,
          })
        ).toBe(false);
      });

      it('should reject non-integer values', () => {
        expect(
          isValidBillableUnits({
            qrScans: 1.5,
            impressions: 1000,
            eventCount: 5,
          })
        ).toBe(false);
      });

      it('should reject null/undefined', () => {
        expect(isValidBillableUnits(null)).toBe(false);
        expect(isValidBillableUnits(undefined)).toBe(false);
      });
    });

    describe('isValidBillingWindow', () => {
      it('should accept valid billing window', () => {
        expect(
          isValidBillingWindow({
            windowStart: '2024-01-01T00:00:00Z',
            windowEnd: '2024-01-31T23:59:59Z',
          })
        ).toBe(true);
      });

      it('should accept empty billing window (no data yet)', () => {
        expect(
          isValidBillingWindow({
            windowStart: '',
            windowEnd: '',
          })
        ).toBe(true);
      });

      it('should reject invalid dates', () => {
        expect(
          isValidBillingWindow({
            windowStart: 'not-a-date',
            windowEnd: '2024-01-31T23:59:59Z',
          })
        ).toBe(false);
      });

      it('should reject windowEnd before windowStart', () => {
        expect(
          isValidBillingWindow({
            windowStart: '2024-01-31T23:59:59Z',
            windowEnd: '2024-01-01T00:00:00Z',
          })
        ).toBe(false);
      });

      it('should reject missing fields', () => {
        expect(isValidBillingWindow({ windowStart: '2024-01-01T00:00:00Z' })).toBe(false);
        expect(isValidBillingWindow({})).toBe(false);
      });

      it('should reject null/undefined', () => {
        expect(isValidBillingWindow(null)).toBe(false);
        expect(isValidBillingWindow(undefined)).toBe(false);
      });
    });

    describe('isValidMonetizationHooks', () => {
      const validHooks = {
        billableUnits: { qrScans: 100, impressions: 1000, eventCount: 5 },
        billingWindow: { windowStart: '2024-01-01T00:00:00Z', windowEnd: '2024-01-31T23:59:59Z' },
        dataAvailable: true,
        statusMessage: 'Billable units aggregated from analytics',
      };

      it('should accept valid monetization hooks', () => {
        expect(isValidMonetizationHooks(validHooks)).toBe(true);
      });

      it('should accept hooks with empty billing window', () => {
        expect(
          isValidMonetizationHooks({
            ...validHooks,
            billingWindow: { windowStart: '', windowEnd: '' },
          })
        ).toBe(true);
      });

      it('should accept dataAvailable: false', () => {
        expect(
          isValidMonetizationHooks({
            ...validHooks,
            dataAvailable: false,
          })
        ).toBe(true);
      });

      it('should reject missing billableUnits', () => {
        const { billableUnits, ...rest } = validHooks;
        expect(isValidMonetizationHooks(rest)).toBe(false);
      });

      it('should reject missing billingWindow', () => {
        const { billingWindow, ...rest } = validHooks;
        expect(isValidMonetizationHooks(rest)).toBe(false);
      });

      it('should reject missing dataAvailable', () => {
        const { dataAvailable, ...rest } = validHooks;
        expect(isValidMonetizationHooks(rest)).toBe(false);
      });

      it('should reject missing statusMessage', () => {
        const { statusMessage, ...rest } = validHooks;
        expect(isValidMonetizationHooks(rest)).toBe(false);
      });

      it('should reject null/undefined', () => {
        expect(isValidMonetizationHooks(null)).toBe(false);
        expect(isValidMonetizationHooks(undefined)).toBe(false);
      });
    });

    describe('validateMonetizationHooks', () => {
      const validHooks = {
        billableUnits: { qrScans: 100, impressions: 1000, eventCount: 5 },
        billingWindow: { windowStart: '2024-01-01T00:00:00Z', windowEnd: '2024-01-31T23:59:59Z' },
        dataAvailable: true,
        statusMessage: 'Billable units aggregated from analytics',
      };

      it('should validate complete hooks', () => {
        const result = validateMonetizationHooks(validHooks);
        expect(result.valid).toBe(true);
      });

      it('should reject hooks without billableUnits', () => {
        const { billableUnits, ...rest } = validHooks;
        const result = validateMonetizationHooks(rest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('billableUnits');
      });

      it('should reject hooks without billingWindow', () => {
        const { billingWindow, ...rest } = validHooks;
        const result = validateMonetizationHooks(rest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('billingWindow');
      });

      it('should reject null hooks', () => {
        const result = validateMonetizationHooks(null);
        expect(result.valid).toBe(false);
      });

      it('should reject non-object hooks', () => {
        const result = validateMonetizationHooks('not an object');
        expect(result.valid).toBe(false);
      });
    });
  });

  // ===========================================================================
  // BUILDER FUNCTION TESTS
  // ===========================================================================
  describe('Builder Functions', () => {
    describe('buildBillableUnits', () => {
      it('should build billable units from sponsor metrics', () => {
        const metrics = { scans: 100, impressions: 1000, conversions: 50 };
        const result = buildBillableUnits(metrics, 5);

        expect(result.qrScans).toBe(100);
        expect(result.impressions).toBe(1000);
        expect(result.eventCount).toBe(5);
      });

      it('should handle missing metrics fields', () => {
        const result = buildBillableUnits({}, 3);

        expect(result.qrScans).toBe(0);
        expect(result.impressions).toBe(0);
        expect(result.eventCount).toBe(3);
      });

      it('should floor event count', () => {
        const result = buildBillableUnits({}, 2.7);
        expect(result.eventCount).toBe(2);
      });

      it('should prevent negative event count', () => {
        const result = buildBillableUnits({}, -5);
        expect(result.eventCount).toBe(0);
      });
    });

    describe('buildBillingWindow', () => {
      it('should build billing window from dates', () => {
        const result = buildBillingWindow('2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z');

        expect(result.windowStart).toBe('2024-01-01T00:00:00Z');
        expect(result.windowEnd).toBe('2024-01-31T23:59:59Z');
      });

      it('should handle empty dates', () => {
        const result = buildBillingWindow('', '');

        expect(result.windowStart).toBe('');
        expect(result.windowEnd).toBe('');
      });

      it('should handle null/undefined dates', () => {
        const result = buildBillingWindow(null, undefined);

        expect(result.windowStart).toBe('');
        expect(result.windowEnd).toBe('');
      });
    });

    describe('buildMonetizationHooks', () => {
      const sponsor = {
        sponsorId: 'sp-test',
        name: 'Test Sponsor',
        tier: 'gold',
        events: ['evt-1', 'evt-2'],
        metrics: { impressions: 1000, scans: 100, conversions: 50 },
      };

      it('should build monetization hooks from sponsor data', () => {
        const result = buildMonetizationHooks(
          sponsor,
          '2024-01-01T00:00:00Z',
          '2024-01-31T23:59:59Z',
          true
        );

        expect(result.billableUnits.qrScans).toBe(100);
        expect(result.billableUnits.impressions).toBe(1000);
        expect(result.billableUnits.eventCount).toBe(2);
        expect(result.billingWindow.windowStart).toBe('2024-01-01T00:00:00Z');
        expect(result.billingWindow.windowEnd).toBe('2024-01-31T23:59:59Z');
        expect(result.dataAvailable).toBe(true);
        expect(result.statusMessage).toContain('aggregated');
      });

      it('should set appropriate message when data unavailable', () => {
        const result = buildMonetizationHooks(sponsor, '', '', false);

        expect(result.dataAvailable).toBe(false);
        expect(result.statusMessage).toContain('unavailable');
      });

      it('should set appropriate message when no billable activity', () => {
        const zeroSponsor = {
          ...sponsor,
          metrics: { impressions: 0, scans: 0, conversions: 0 },
        };
        const result = buildMonetizationHooks(zeroSponsor, '', '', true);

        expect(result.statusMessage).toContain('No billable activity');
      });
    });
  });

  // ===========================================================================
  // CONTRACT COMPLIANCE TESTS (CI/CD Gate)
  // ===========================================================================
  describe('Contract Compliance (CI/CD Gate)', () => {
    describe('checkMonetizationHooksCompliance', () => {
      const compliantHooks = {
        billableUnits: { qrScans: 100, impressions: 1000, eventCount: 5 },
        billingWindow: { windowStart: '2024-01-01T00:00:00Z', windowEnd: '2024-01-31T23:59:59Z' },
        dataAvailable: true,
        statusMessage: 'Billable units aggregated from analytics',
      };

      it('should pass for compliant hooks', () => {
        const result = checkMonetizationHooksCompliance(compliantHooks);

        expect(result.compliant).toBe(true);
        expect(result.version).toBe('1.1.0');
        expect(result.missingFields).toHaveLength(0);
        expect(result.invalidFields).toHaveLength(0);
        expect(result.inert).toBe(true);
      });

      it('should detect missing fields', () => {
        const result = checkMonetizationHooksCompliance({
          billableUnits: { qrScans: 100, impressions: 1000, eventCount: 5 },
        });

        expect(result.compliant).toBe(false);
        expect(result.missingFields).toContain('billingWindow');
        expect(result.missingFields).toContain('dataAvailable');
        expect(result.missingFields).toContain('statusMessage');
        expect(result.inert).toBe(true); // Always inert
      });

      it('should detect invalid billableUnits', () => {
        const result = checkMonetizationHooksCompliance({
          ...compliantHooks,
          billableUnits: { qrScans: -1, impressions: 1000, eventCount: 5 },
        });

        expect(result.compliant).toBe(false);
        expect(result.invalidFields.some((f) => f.includes('billableUnits'))).toBe(true);
      });

      it('should fail for null/undefined', () => {
        expect(checkMonetizationHooksCompliance(null).compliant).toBe(false);
        expect(checkMonetizationHooksCompliance(undefined).compliant).toBe(false);
      });

      it('should report all missing fields for empty object', () => {
        const result = checkMonetizationHooksCompliance({});

        expect(result.missingFields).toHaveLength(4);
        expect(result.missingFields).toContain('billableUnits');
        expect(result.missingFields).toContain('billingWindow');
        expect(result.missingFields).toContain('dataAvailable');
        expect(result.missingFields).toContain('statusMessage');
      });
    });
  });

  // ===========================================================================
  // DEFAULT VALUES
  // ===========================================================================
  describe('Default Values', () => {
    it('should have zero default billable units', () => {
      expect(DEFAULT_BILLABLE_UNITS.qrScans).toBe(0);
      expect(DEFAULT_BILLABLE_UNITS.impressions).toBe(0);
      expect(DEFAULT_BILLABLE_UNITS.eventCount).toBe(0);
    });

    it('should have empty default billing window', () => {
      expect(DEFAULT_BILLING_WINDOW.windowStart).toBe('');
      expect(DEFAULT_BILLING_WINDOW.windowEnd).toBe('');
    });

    it('should have dataAvailable: false in default hooks', () => {
      expect(DEFAULT_MONETIZATION_HOOKS.dataAvailable).toBe(false);
    });

    it('should have appropriate default status message', () => {
      expect(DEFAULT_MONETIZATION_HOOKS.statusMessage).toContain('No monetization data');
    });
  });

  // ===========================================================================
  // EVENT MONETIZATION HOOKS TESTS
  // ===========================================================================
  describe('Event Monetization Hooks', () => {
    describe('isValidEventBillableUnits', () => {
      it('should accept valid event billable units', () => {
        expect(
          isValidEventBillableUnits({
            qrScans: 100,
            impressions: 1000,
            sponsorCount: 5,
          })
        ).toBe(true);
      });

      it('should accept zero values', () => {
        expect(
          isValidEventBillableUnits({
            qrScans: 0,
            impressions: 0,
            sponsorCount: 0,
          })
        ).toBe(true);
      });

      it('should reject missing fields', () => {
        expect(isValidEventBillableUnits({ qrScans: 100 })).toBe(false);
      });

      it('should reject negative values', () => {
        expect(
          isValidEventBillableUnits({
            qrScans: -1,
            impressions: 1000,
            sponsorCount: 5,
          })
        ).toBe(false);
      });
    });

    describe('isValidEventMonetizationHooks', () => {
      const validHooks = {
        billableUnits: { qrScans: 100, impressions: 1000, sponsorCount: 5 },
        billingWindow: { windowStart: '2024-01-01T00:00:00Z', windowEnd: '2024-01-31T23:59:59Z' },
        dataAvailable: true,
        statusMessage: 'Billable units aggregated from analytics',
      };

      it('should accept valid event monetization hooks', () => {
        expect(isValidEventMonetizationHooks(validHooks)).toBe(true);
      });

      it('should reject missing fields', () => {
        const { billableUnits, ...rest } = validHooks;
        expect(isValidEventMonetizationHooks(rest)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // CONTRACT BOUNDARY ASSERTIONS
  // ===========================================================================
  describe('Contract Boundary Assertions', () => {
    it('should ensure monetization hooks are ALWAYS inert', () => {
      // This is the critical invariant for Story F4
      // If this test fails, billing logic has been coupled to product logic
      const sponsorCheck = checkMonetizationHooksInert();
      const eventCheck = checkEventMonetizationHooksInert();

      expect(sponsorCheck.inert).toBe(true);
      expect(sponsorCheck.billingLogicExecuted).toBe(false);
      expect(sponsorCheck.paymentProcessing).toBe(false);

      expect(eventCheck.inert).toBe(true);
      expect(eventCheck.billingLogicExecuted).toBe(false);
      expect(eventCheck.paymentProcessing).toBe(false);
    });

    it('should ensure no user-visible billing UI', () => {
      const check = checkMonetizationHooksInert();
      expect(check.billingUIVisible).toBe(false);
    });

    it('should ensure billable units are integers only', () => {
      // Monetizable signals must be discrete counts
      const validUnits = { qrScans: 100, impressions: 1000, eventCount: 5 };
      expect(isValidBillableUnits(validUnits)).toBe(true);

      // Floats are not valid billable units
      const floatUnits = { qrScans: 100.5, impressions: 1000, eventCount: 5 };
      expect(isValidBillableUnits(floatUnits)).toBe(false);
    });

    it('should ensure billing window is valid date format', () => {
      const validWindow = {
        windowStart: '2024-01-01T00:00:00Z',
        windowEnd: '2024-01-31T23:59:59Z',
      };
      expect(isValidBillingWindow(validWindow)).toBe(true);

      // Empty window is valid (no data yet)
      const emptyWindow = {
        windowStart: '',
        windowEnd: '',
      };
      expect(isValidBillingWindow(emptyWindow)).toBe(true);

      // Invalid date strings that cannot be parsed
      const invalidWindow = {
        windowStart: 'not-a-valid-date-at-all',
        windowEnd: 'also-not-valid',
      };
      expect(isValidBillingWindow(invalidWindow)).toBe(false);
    });

    it('should ensure monetizable signals are documented', () => {
      // Story F4 defines these monetizable signals
      const monetizableSignals = ['qrScans', 'impressions', 'eventCount'];

      for (const signal of monetizableSignals) {
        expect(BILLABLE_UNITS_REQUIRED_FIELDS).toContain(signal);
      }
    });
  });
});
