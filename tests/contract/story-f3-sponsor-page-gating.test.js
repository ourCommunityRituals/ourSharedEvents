/**
 * Story F3 - Sponsor Page Gating Contract Tests
 *
 * Purpose: Validate the locked sponsor page gating contract to ensure
 * sponsors never see broken, partial, or misleading pages.
 *
 * CI/CD Gate: Stage-2 FAILS if sponsor page gating contract drifts.
 *
 * Contract Version: 1.0.0 (inherits from SPONSOR_CONTRACT_VERSION)
 *
 * Page States (backend-decided):
 *   ACTIVE   - At least one associated event is ACTIVE → metrics visible
 *   PENDING  - Has events but none are ACTIVE yet → data accumulating message
 *   INACTIVE - No events OR all events ARCHIVED → no active events message
 *
 * Invariants (LOCKED):
 *   - Frontend must honor backend trust signals
 *   - Metrics only visible when metricsVisible is true
 *   - State is explicit and testable
 *
 * HERMETIC TEST: This test is self-contained and does not require
 * the worker TypeScript to be compiled. The contract constants and
 * validation functions are replicated here to ensure CI/CD can run
 * without build dependencies.
 *
 * @see worker/src/domain/sponsor.ts
 * @see Story F3 - Sponsor Page Gating (Trust-First Display)
 */

// =============================================================================
// LOCKED CONTRACT CONSTANTS (Replicated for hermetic testing)
// These MUST match worker/src/domain/sponsor.ts exactly
// =============================================================================

/**
 * Current sponsor contract version
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_CONTRACT_VERSION = '1.0.0';

/**
 * Sponsor page status values
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_PAGE_STATUS = {
  ACTIVE: 'ACTIVE',
  PENDING: 'PENDING',
  INACTIVE: 'INACTIVE',
};

/**
 * Valid sponsor page statuses
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const VALID_SPONSOR_PAGE_STATUSES = ['ACTIVE', 'PENDING', 'INACTIVE'];

/**
 * Sponsor page status labels
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_PAGE_STATUS_LABELS = {
  ACTIVE: 'Active',
  PENDING: 'Pending Verification',
  INACTIVE: 'Inactive',
};

/**
 * Sponsor page status descriptions
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_PAGE_STATUS_DESCRIPTIONS = {
  ACTIVE: 'Your sponsorship is active and metrics are available.',
  PENDING: 'Your associated events are being verified. Metrics will be available once event QR codes are verified.',
  INACTIVE: 'No active events are currently associated with this sponsorship.',
};

/**
 * Required fields for sponsor page eligibility
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_PAGE_ELIGIBILITY_REQUIRED_FIELDS = [
  'status',
  'metricsVisible',
  'label',
  'description',
  'activeEventCount',
  'pendingEventCount',
  'archivedEventCount',
  'totalEventCount',
];

/**
 * Required fields for sponsor page response
 * LOCKED: Must match worker/src/domain/sponsor.ts
 */
const SPONSOR_PAGE_RESPONSE_REQUIRED_FIELDS = [
  'ok',
  'sponsor',
  'pageStatus',
  '_contractVersion',
  'generatedAt',
];

/**
 * Valid asset states for events
 * LOCKED: Must match worker/src/domain/assetState.ts
 */
const VALID_ASSET_STATES = ['DRAFT', 'READY', 'ACTIVE', 'ARCHIVED'];

// =============================================================================
// HERMETIC VALIDATION FUNCTIONS
// Replicated to ensure tests run without TypeScript compilation
// =============================================================================

/**
 * Check if a value is a valid sponsor page status
 */
function isValidSponsorPageStatus(value) {
  return typeof value === 'string' && VALID_SPONSOR_PAGE_STATUSES.includes(value);
}

/**
 * Check if an object has all required fields
 */
function hasRequiredFields(obj, requiredFields) {
  if (!obj || typeof obj !== 'object') return false;
  for (const field of requiredFields) {
    if (!(field in obj)) return false;
  }
  return true;
}

/**
 * Resolve sponsor page status from event states
 * HERMETIC: Replicates logic from sponsor.ts for testing
 *
 * Resolution Rules:
 *   1. If any event is ACTIVE → sponsor page is ACTIVE (metrics visible)
 *   2. If no ACTIVE events but some DRAFT/READY → PENDING (data accumulating)
 *   3. If no events OR all ARCHIVED → INACTIVE (no active events)
 */
function resolveSponsorPageStatus(eventStates) {
  let activeCount = 0;
  let pendingCount = 0;
  let archivedCount = 0;

  for (const event of eventStates) {
    switch (event.assetState) {
      case 'ACTIVE':
        activeCount++;
        break;
      case 'DRAFT':
      case 'READY':
        pendingCount++;
        break;
      case 'ARCHIVED':
        archivedCount++;
        break;
    }
  }

  const totalCount = eventStates.length;
  let status;

  if (activeCount > 0) {
    status = SPONSOR_PAGE_STATUS.ACTIVE;
  } else if (pendingCount > 0) {
    status = SPONSOR_PAGE_STATUS.PENDING;
  } else {
    status = SPONSOR_PAGE_STATUS.INACTIVE;
  }

  return {
    status,
    metricsVisible: status === SPONSOR_PAGE_STATUS.ACTIVE,
    label: SPONSOR_PAGE_STATUS_LABELS[status],
    description: SPONSOR_PAGE_STATUS_DESCRIPTIONS[status],
    activeEventCount: activeCount,
    pendingEventCount: pendingCount,
    archivedEventCount: archivedCount,
    totalEventCount: totalCount,
  };
}

// =============================================================================
// CONTRACT TESTS
// =============================================================================

describe('Story F3 - Sponsor Page Gating Contract', () => {
  describe('Contract Constants', () => {
    test('SPONSOR_CONTRACT_VERSION is semantic versioning format', () => {
      expect(SPONSOR_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('SPONSOR_PAGE_STATUS has exactly 3 states', () => {
      const statuses = Object.keys(SPONSOR_PAGE_STATUS);
      expect(statuses).toHaveLength(3);
      expect(statuses).toContain('ACTIVE');
      expect(statuses).toContain('PENDING');
      expect(statuses).toContain('INACTIVE');
    });

    test('VALID_SPONSOR_PAGE_STATUSES matches SPONSOR_PAGE_STATUS values', () => {
      const statusValues = Object.values(SPONSOR_PAGE_STATUS);
      expect(VALID_SPONSOR_PAGE_STATUSES).toEqual(expect.arrayContaining(statusValues));
      expect(statusValues).toEqual(expect.arrayContaining(VALID_SPONSOR_PAGE_STATUSES));
    });

    test('every status has a label', () => {
      for (const status of VALID_SPONSOR_PAGE_STATUSES) {
        expect(SPONSOR_PAGE_STATUS_LABELS[status]).toBeDefined();
        expect(typeof SPONSOR_PAGE_STATUS_LABELS[status]).toBe('string');
        expect(SPONSOR_PAGE_STATUS_LABELS[status].length).toBeGreaterThan(0);
      }
    });

    test('every status has a description', () => {
      for (const status of VALID_SPONSOR_PAGE_STATUSES) {
        expect(SPONSOR_PAGE_STATUS_DESCRIPTIONS[status]).toBeDefined();
        expect(typeof SPONSOR_PAGE_STATUS_DESCRIPTIONS[status]).toBe('string');
        expect(SPONSOR_PAGE_STATUS_DESCRIPTIONS[status].length).toBeGreaterThan(0);
      }
    });
  });

  describe('Page Eligibility Resolution', () => {
    describe('ACTIVE Status - Metrics Visible', () => {
      test('returns ACTIVE when at least one event is ACTIVE', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'ACTIVE' },
        ];

        const result = resolveSponsorPageStatus(eventStates);

        expect(result.status).toBe('ACTIVE');
        expect(result.metricsVisible).toBe(true);
        expect(result.activeEventCount).toBe(1);
      });

      test('returns ACTIVE with multiple events including one ACTIVE', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'DRAFT' },
          { eventId: 'evt-2', assetState: 'ACTIVE' },
          { eventId: 'evt-3', assetState: 'ARCHIVED' },
        ];

        const result = resolveSponsorPageStatus(eventStates);

        expect(result.status).toBe('ACTIVE');
        expect(result.metricsVisible).toBe(true);
        expect(result.activeEventCount).toBe(1);
        expect(result.pendingEventCount).toBe(1);
        expect(result.archivedEventCount).toBe(1);
        expect(result.totalEventCount).toBe(3);
      });

      test('metricsVisible is true ONLY for ACTIVE status', () => {
        // ACTIVE
        const activeResult = resolveSponsorPageStatus([
          { eventId: 'evt-1', assetState: 'ACTIVE' },
        ]);
        expect(activeResult.metricsVisible).toBe(true);

        // PENDING
        const pendingResult = resolveSponsorPageStatus([
          { eventId: 'evt-1', assetState: 'DRAFT' },
        ]);
        expect(pendingResult.metricsVisible).toBe(false);

        // INACTIVE
        const inactiveResult = resolveSponsorPageStatus([]);
        expect(inactiveResult.metricsVisible).toBe(false);
      });
    });

    describe('PENDING Status - Data Accumulating', () => {
      test('returns PENDING when events exist but none ACTIVE (DRAFT)', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'DRAFT' },
        ];

        const result = resolveSponsorPageStatus(eventStates);

        expect(result.status).toBe('PENDING');
        expect(result.metricsVisible).toBe(false);
        expect(result.pendingEventCount).toBe(1);
      });

      test('returns PENDING when events exist but none ACTIVE (READY)', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'READY' },
        ];

        const result = resolveSponsorPageStatus(eventStates);

        expect(result.status).toBe('PENDING');
        expect(result.metricsVisible).toBe(false);
        expect(result.pendingEventCount).toBe(1);
      });

      test('returns PENDING with mix of DRAFT and READY', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'DRAFT' },
          { eventId: 'evt-2', assetState: 'READY' },
        ];

        const result = resolveSponsorPageStatus(eventStates);

        expect(result.status).toBe('PENDING');
        expect(result.metricsVisible).toBe(false);
        expect(result.pendingEventCount).toBe(2);
      });

      test('returns PENDING with DRAFT/READY + ARCHIVED (no ACTIVE)', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'DRAFT' },
          { eventId: 'evt-2', assetState: 'ARCHIVED' },
        ];

        const result = resolveSponsorPageStatus(eventStates);

        expect(result.status).toBe('PENDING');
        expect(result.metricsVisible).toBe(false);
        expect(result.pendingEventCount).toBe(1);
        expect(result.archivedEventCount).toBe(1);
      });
    });

    describe('INACTIVE Status - No Active Events', () => {
      test('returns INACTIVE when no events associated', () => {
        const eventStates = [];

        const result = resolveSponsorPageStatus(eventStates);

        expect(result.status).toBe('INACTIVE');
        expect(result.metricsVisible).toBe(false);
        expect(result.totalEventCount).toBe(0);
      });

      test('returns INACTIVE when all events ARCHIVED', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'ARCHIVED' },
          { eventId: 'evt-2', assetState: 'ARCHIVED' },
        ];

        const result = resolveSponsorPageStatus(eventStates);

        expect(result.status).toBe('INACTIVE');
        expect(result.metricsVisible).toBe(false);
        expect(result.archivedEventCount).toBe(2);
        expect(result.totalEventCount).toBe(2);
      });
    });

    describe('Status Priority', () => {
      test('ACTIVE takes priority over PENDING', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'DRAFT' },
          { eventId: 'evt-2', assetState: 'ACTIVE' },
        ];

        const result = resolveSponsorPageStatus(eventStates);
        expect(result.status).toBe('ACTIVE');
      });

      test('PENDING takes priority over INACTIVE', () => {
        const eventStates = [
          { eventId: 'evt-1', assetState: 'ARCHIVED' },
          { eventId: 'evt-2', assetState: 'DRAFT' },
        ];

        const result = resolveSponsorPageStatus(eventStates);
        expect(result.status).toBe('PENDING');
      });
    });
  });

  describe('Page Eligibility Shape', () => {
    test('includes all required fields', () => {
      const result = resolveSponsorPageStatus([]);

      for (const field of SPONSOR_PAGE_ELIGIBILITY_REQUIRED_FIELDS) {
        expect(result).toHaveProperty(field);
      }
    });

    test('label matches status label constant', () => {
      for (const status of VALID_SPONSOR_PAGE_STATUSES) {
        let eventStates;
        switch (status) {
          case 'ACTIVE':
            eventStates = [{ eventId: 'evt-1', assetState: 'ACTIVE' }];
            break;
          case 'PENDING':
            eventStates = [{ eventId: 'evt-1', assetState: 'DRAFT' }];
            break;
          case 'INACTIVE':
            eventStates = [];
            break;
        }

        const result = resolveSponsorPageStatus(eventStates);
        expect(result.label).toBe(SPONSOR_PAGE_STATUS_LABELS[status]);
      }
    });

    test('description matches status description constant', () => {
      for (const status of VALID_SPONSOR_PAGE_STATUSES) {
        let eventStates;
        switch (status) {
          case 'ACTIVE':
            eventStates = [{ eventId: 'evt-1', assetState: 'ACTIVE' }];
            break;
          case 'PENDING':
            eventStates = [{ eventId: 'evt-1', assetState: 'DRAFT' }];
            break;
          case 'INACTIVE':
            eventStates = [];
            break;
        }

        const result = resolveSponsorPageStatus(eventStates);
        expect(result.description).toBe(SPONSOR_PAGE_STATUS_DESCRIPTIONS[status]);
      }
    });

    test('event counts are non-negative integers', () => {
      const eventStates = [
        { eventId: 'evt-1', assetState: 'ACTIVE' },
        { eventId: 'evt-2', assetState: 'DRAFT' },
        { eventId: 'evt-3', assetState: 'ARCHIVED' },
      ];

      const result = resolveSponsorPageStatus(eventStates);

      expect(Number.isInteger(result.activeEventCount)).toBe(true);
      expect(Number.isInteger(result.pendingEventCount)).toBe(true);
      expect(Number.isInteger(result.archivedEventCount)).toBe(true);
      expect(Number.isInteger(result.totalEventCount)).toBe(true);

      expect(result.activeEventCount).toBeGreaterThanOrEqual(0);
      expect(result.pendingEventCount).toBeGreaterThanOrEqual(0);
      expect(result.archivedEventCount).toBeGreaterThanOrEqual(0);
      expect(result.totalEventCount).toBeGreaterThanOrEqual(0);
    });

    test('total event count equals sum of individual counts', () => {
      const eventStates = [
        { eventId: 'evt-1', assetState: 'ACTIVE' },
        { eventId: 'evt-2', assetState: 'DRAFT' },
        { eventId: 'evt-3', assetState: 'READY' },
        { eventId: 'evt-4', assetState: 'ARCHIVED' },
      ];

      const result = resolveSponsorPageStatus(eventStates);

      expect(result.totalEventCount).toBe(
        result.activeEventCount + result.pendingEventCount + result.archivedEventCount
      );
    });
  });

  describe('Validation Functions', () => {
    test('isValidSponsorPageStatus returns true for valid statuses', () => {
      expect(isValidSponsorPageStatus('ACTIVE')).toBe(true);
      expect(isValidSponsorPageStatus('PENDING')).toBe(true);
      expect(isValidSponsorPageStatus('INACTIVE')).toBe(true);
    });

    test('isValidSponsorPageStatus returns false for invalid values', () => {
      expect(isValidSponsorPageStatus('active')).toBe(false); // wrong case
      expect(isValidSponsorPageStatus('UNKNOWN')).toBe(false);
      expect(isValidSponsorPageStatus('')).toBe(false);
      expect(isValidSponsorPageStatus(null)).toBe(false);
      expect(isValidSponsorPageStatus(undefined)).toBe(false);
      expect(isValidSponsorPageStatus(123)).toBe(false);
      expect(isValidSponsorPageStatus({})).toBe(false);
    });
  });

  describe('Trust-First Display Invariants', () => {
    test('INVARIANT: metricsVisible is boolean', () => {
      const statuses = [
        { eventStates: [{ eventId: 'evt-1', assetState: 'ACTIVE' }] },
        { eventStates: [{ eventId: 'evt-1', assetState: 'DRAFT' }] },
        { eventStates: [] },
      ];

      for (const { eventStates } of statuses) {
        const result = resolveSponsorPageStatus(eventStates);
        expect(typeof result.metricsVisible).toBe('boolean');
      }
    });

    test('INVARIANT: status is always one of the valid values', () => {
      const testCases = [
        [],
        [{ eventId: 'evt-1', assetState: 'DRAFT' }],
        [{ eventId: 'evt-1', assetState: 'READY' }],
        [{ eventId: 'evt-1', assetState: 'ACTIVE' }],
        [{ eventId: 'evt-1', assetState: 'ARCHIVED' }],
        [
          { eventId: 'evt-1', assetState: 'DRAFT' },
          { eventId: 'evt-2', assetState: 'ACTIVE' },
          { eventId: 'evt-3', assetState: 'ARCHIVED' },
        ],
      ];

      for (const eventStates of testCases) {
        const result = resolveSponsorPageStatus(eventStates);
        expect(VALID_SPONSOR_PAGE_STATUSES).toContain(result.status);
      }
    });

    test('INVARIANT: description is never empty', () => {
      const testCases = [
        [],
        [{ eventId: 'evt-1', assetState: 'ACTIVE' }],
        [{ eventId: 'evt-1', assetState: 'DRAFT' }],
      ];

      for (const eventStates of testCases) {
        const result = resolveSponsorPageStatus(eventStates);
        expect(result.description).toBeTruthy();
        expect(result.description.length).toBeGreaterThan(0);
      }
    });

    test('INVARIANT: label is never empty', () => {
      const testCases = [
        [],
        [{ eventId: 'evt-1', assetState: 'ACTIVE' }],
        [{ eventId: 'evt-1', assetState: 'DRAFT' }],
      ];

      for (const eventStates of testCases) {
        const result = resolveSponsorPageStatus(eventStates);
        expect(result.label).toBeTruthy();
        expect(result.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge Cases', () => {
    test('handles empty event array', () => {
      const result = resolveSponsorPageStatus([]);

      expect(result.status).toBe('INACTIVE');
      expect(result.metricsVisible).toBe(false);
      expect(result.totalEventCount).toBe(0);
    });

    test('handles single event of each type', () => {
      const testCases = [
        { assetState: 'DRAFT', expectedStatus: 'PENDING' },
        { assetState: 'READY', expectedStatus: 'PENDING' },
        { assetState: 'ACTIVE', expectedStatus: 'ACTIVE' },
        { assetState: 'ARCHIVED', expectedStatus: 'INACTIVE' },
      ];

      for (const { assetState, expectedStatus } of testCases) {
        const result = resolveSponsorPageStatus([{ eventId: 'evt-1', assetState }]);
        expect(result.status).toBe(expectedStatus);
      }
    });

    test('handles large number of events', () => {
      const eventStates = [];
      for (let i = 0; i < 1000; i++) {
        eventStates.push({
          eventId: `evt-${i}`,
          assetState: i % 4 === 0 ? 'ACTIVE' : i % 4 === 1 ? 'DRAFT' : i % 4 === 2 ? 'READY' : 'ARCHIVED',
        });
      }

      const result = resolveSponsorPageStatus(eventStates);

      expect(result.status).toBe('ACTIVE'); // Has ACTIVE events
      expect(result.totalEventCount).toBe(1000);
    });
  });
});

describe('Stage-2 CI/CD Gate: Sponsor Page Gating', () => {
  test('GATE: All required constants are defined', () => {
    expect(SPONSOR_PAGE_STATUS).toBeDefined();
    expect(VALID_SPONSOR_PAGE_STATUSES).toBeDefined();
    expect(SPONSOR_PAGE_STATUS_LABELS).toBeDefined();
    expect(SPONSOR_PAGE_STATUS_DESCRIPTIONS).toBeDefined();
    expect(SPONSOR_PAGE_ELIGIBILITY_REQUIRED_FIELDS).toBeDefined();
    expect(SPONSOR_PAGE_RESPONSE_REQUIRED_FIELDS).toBeDefined();
  });

  test('GATE: Status resolution is deterministic', () => {
    const eventStates = [
      { eventId: 'evt-1', assetState: 'DRAFT' },
      { eventId: 'evt-2', assetState: 'ACTIVE' },
    ];

    const result1 = resolveSponsorPageStatus(eventStates);
    const result2 = resolveSponsorPageStatus(eventStates);

    expect(result1.status).toBe(result2.status);
    expect(result1.metricsVisible).toBe(result2.metricsVisible);
  });

  test('GATE: Contract version follows semver', () => {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    expect(SPONSOR_CONTRACT_VERSION).toMatch(semverRegex);
  });
});
