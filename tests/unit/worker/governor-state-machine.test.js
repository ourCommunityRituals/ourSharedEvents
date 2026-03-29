/**
 * Sponsor Pricing Tier Balancer — State Machine Tests
 * Tests state transitions: INACTIVE → ACTIVE → COOLING_DOWN → INACTIVE
 * Spec: docs/features/GOVERNOR-DESIGN.md (replaces lost gaming_compression_governor_spec.md)
 * Story: OUR-23 / Governor Implementation
 */

const DEFAULT_CONFIG = {
  ROLLING_WINDOW: 15,
  THRESHOLD: 5,
  HYSTERESIS_WINDOWS: 2
};

const STANDARD_WEIGHTS = { premium: 0.50, med: 0.30, local: 0.20 };
const COMPRESSED_WEIGHTS = { premium: 0.40, med: 0.32, local: 0.28 };

function createGovernorState() {
  return {
    state: 'INACTIVE',
    activated_at: null,
    sub_threshold_windows: 0,
    peak_scan_rate: 0,
    activation_events: []
  };
}

function checkGovernorState(govState, scanCount, config = DEFAULT_CONFIG) {
  if (scanCount > govState.peak_scan_rate) {
    govState.peak_scan_rate = scanCount;
  }

  if (govState.state === 'INACTIVE') {
    if (scanCount >= config.THRESHOLD) {
      govState.state = 'ACTIVE';
      govState.activated_at = new Date().toISOString();
      govState.sub_threshold_windows = 0;
    }
  } else if (govState.state === 'ACTIVE') {
    if (scanCount < config.THRESHOLD) {
      govState.state = 'COOLING_DOWN';
      govState.sub_threshold_windows = 1;
    }
  } else if (govState.state === 'COOLING_DOWN') {
    if (scanCount >= config.THRESHOLD) {
      govState.state = 'ACTIVE';
      govState.sub_threshold_windows = 0;
    } else {
      govState.sub_threshold_windows += 1;
      if (govState.sub_threshold_windows >= config.HYSTERESIS_WINDOWS) {
        govState.state = 'INACTIVE';
        govState.sub_threshold_windows = 0;
      }
    }
  }

  return govState;
}

function getDisplayWeights(govState) {
  return govState.state === 'ACTIVE' ? COMPRESSED_WEIGHTS : STANDARD_WEIGHTS;
}

describe('Governor State Machine', () => {
  describe('INACTIVE → ACTIVE transition', () => {
    test('activates when scan count meets threshold', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5);
      expect(state.state).toBe('ACTIVE');
    });

    test('activates when scan count exceeds threshold', () => {
      const state = createGovernorState();
      checkGovernorState(state, 10);
      expect(state.state).toBe('ACTIVE');
    });

    test('stays inactive below threshold', () => {
      const state = createGovernorState();
      checkGovernorState(state, 4);
      expect(state.state).toBe('INACTIVE');
    });

    test('stays inactive at zero scans', () => {
      const state = createGovernorState();
      checkGovernorState(state, 0);
      expect(state.state).toBe('INACTIVE');
    });

    test('sets activated_at timestamp on activation', () => {
      const state = createGovernorState();
      expect(state.activated_at).toBeNull();
      checkGovernorState(state, 5);
      expect(state.activated_at).not.toBeNull();
    });

    test('resets sub_threshold_windows on activation', () => {
      const state = createGovernorState();
      state.sub_threshold_windows = 99;
      checkGovernorState(state, 5);
      expect(state.sub_threshold_windows).toBe(0);
    });
  });

  describe('ACTIVE → COOLING_DOWN transition', () => {
    test('enters cooling when scans drop below threshold', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5); // ACTIVE
      checkGovernorState(state, 2); // COOLING_DOWN
      expect(state.state).toBe('COOLING_DOWN');
      expect(state.sub_threshold_windows).toBe(1);
    });

    test('stays active when scans remain above threshold', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5); // ACTIVE
      checkGovernorState(state, 8); // still ACTIVE
      expect(state.state).toBe('ACTIVE');
    });

    test('stays active at exactly threshold', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5); // ACTIVE
      checkGovernorState(state, 5); // still ACTIVE
      expect(state.state).toBe('ACTIVE');
    });
  });

  describe('COOLING_DOWN → INACTIVE (hysteresis)', () => {
    test('deactivates after 2 consecutive sub-threshold windows', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5); // ACTIVE
      checkGovernorState(state, 2); // COOLING_DOWN (window 1)
      checkGovernorState(state, 1); // window 2 → INACTIVE
      expect(state.state).toBe('INACTIVE');
    });

    test('does not deactivate after only 1 sub-threshold window', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5); // ACTIVE
      checkGovernorState(state, 2); // COOLING_DOWN (window 1)
      expect(state.state).toBe('COOLING_DOWN');
      expect(state.sub_threshold_windows).toBe(1);
    });
  });

  describe('COOLING_DOWN → ACTIVE (re-activation)', () => {
    test('returns to ACTIVE if threshold exceeded during cooling', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5); // ACTIVE
      checkGovernorState(state, 2); // COOLING_DOWN
      checkGovernorState(state, 6); // back to ACTIVE
      expect(state.state).toBe('ACTIVE');
      expect(state.sub_threshold_windows).toBe(0);
    });

    test('rapid cycling scenario — governor stays stable', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5); // ACTIVE
      checkGovernorState(state, 1); // COOLING_DOWN
      checkGovernorState(state, 6); // ACTIVE
      checkGovernorState(state, 1); // COOLING_DOWN
      checkGovernorState(state, 6); // ACTIVE
      expect(state.state).toBe('ACTIVE');
    });
  });

  describe('Display weights', () => {
    test('returns standard weights when INACTIVE', () => {
      const state = createGovernorState();
      expect(getDisplayWeights(state)).toEqual(STANDARD_WEIGHTS);
    });

    test('returns compressed weights when ACTIVE', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5);
      expect(getDisplayWeights(state)).toEqual(COMPRESSED_WEIGHTS);
    });

    test('returns standard weights when COOLING_DOWN', () => {
      const state = createGovernorState();
      checkGovernorState(state, 5); // ACTIVE
      checkGovernorState(state, 2); // COOLING_DOWN
      // COOLING_DOWN uses standard weights (not active)
      expect(getDisplayWeights(state)).toEqual(STANDARD_WEIGHTS);
    });

    test('premium drops 10pp when governor active', () => {
      expect(COMPRESSED_WEIGHTS.premium).toBe(STANDARD_WEIGHTS.premium - 0.10);
    });

    test('local gains 8pp when governor active', () => {
      expect(COMPRESSED_WEIGHTS.local).toBe(STANDARD_WEIGHTS.local + 0.08);
    });

    test('med gains 2pp when governor active', () => {
      expect(COMPRESSED_WEIGHTS.med).toBe(STANDARD_WEIGHTS.med + 0.02);
    });

    test('weights always sum to 1.0', () => {
      const stdSum = Object.values(STANDARD_WEIGHTS).reduce((a, b) => a + b, 0);
      const cmpSum = Object.values(COMPRESSED_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(Math.round(stdSum * 100)).toBe(100);
      expect(Math.round(cmpSum * 100)).toBe(100);
    });
  });

  describe('Peak tracking', () => {
    test('tracks peak scan rate', () => {
      const state = createGovernorState();
      checkGovernorState(state, 3);
      checkGovernorState(state, 8);
      checkGovernorState(state, 5);
      expect(state.peak_scan_rate).toBe(8);
    });

    test('peak never decreases', () => {
      const state = createGovernorState();
      checkGovernorState(state, 10);
      checkGovernorState(state, 5);
      checkGovernorState(state, 1);
      expect(state.peak_scan_rate).toBe(10);
    });
  });

  describe('Custom config', () => {
    test('respects custom threshold', () => {
      const state = createGovernorState();
      checkGovernorState(state, 9, { ...DEFAULT_CONFIG, THRESHOLD: 10 });
      expect(state.state).toBe('INACTIVE');
      checkGovernorState(state, 10, { ...DEFAULT_CONFIG, THRESHOLD: 10 });
      expect(state.state).toBe('ACTIVE');
    });

    test('respects custom hysteresis windows', () => {
      const config = { ...DEFAULT_CONFIG, HYSTERESIS_WINDOWS: 3 };
      const state = createGovernorState();
      checkGovernorState(state, 5, config); // ACTIVE
      checkGovernorState(state, 1, config); // COOLING (1)
      checkGovernorState(state, 1, config); // COOLING (2)
      expect(state.state).toBe('COOLING_DOWN');
      checkGovernorState(state, 1, config); // COOLING (3) → INACTIVE
      expect(state.state).toBe('INACTIVE');
    });
  });
});
