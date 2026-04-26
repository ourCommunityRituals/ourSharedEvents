/**
 * OSE-242 — Canonical event-phase resolver L1 unit tests.
 *
 * Verifies the contract declared in
 * `OCR-docs/ocr-docs-brain/event-phase-contract.yaml`:
 *
 *   - Decision 1 (status gates, time refines)
 *   - Decision 2 (subset-typed input, injectable now)
 *   - Decision 3 (status fallback for null/malformed dates)
 *
 * The cross-surface coherence test (bundled #1 from CCR-4 audit) lives in
 * a separate spec — see event-phase-coherence.spec.ts.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  computeEventPhase,
  explainEventPhase,
  assertSurfaceCoherence,
  VALID_EVENT_PHASES,
  EVENT_PHASE_LABELS,
  type EventPhase,
  type EventPhaseInput,
} from '../src/domain/event-phase';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const T = {
  beforeStart: new Date('2026-05-01T18:00:00Z'),
  atStart: new Date('2026-05-01T19:00:00Z'),
  during: new Date('2026-05-01T20:30:00Z'),
  atEnd: new Date('2026-05-01T22:00:00Z'),
  afterEnd: new Date('2026-05-01T23:00:00Z'),
};

const ACTIVE_DATED: EventPhaseInput = {
  status: 'active',
  start_date: '2026-05-01T19:00:00Z',
  end_date: '2026-05-01T22:00:00Z',
};

// ─── Decision 1.1 — status forces pre_event for draft / ready ──────────────

describe('OSE-242 Decision 1: status forces pre_event for draft + ready', () => {
  test('status=draft → pre_event regardless of time', () => {
    const e = { ...ACTIVE_DATED, status: 'draft' };
    expect(computeEventPhase(e, T.beforeStart)).toBe<EventPhase>('pre_event');
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('pre_event');
    expect(computeEventPhase(e, T.afterEnd)).toBe<EventPhase>('pre_event');
  });

  test('status=ready → pre_event regardless of time', () => {
    const e = { ...ACTIVE_DATED, status: 'ready' };
    expect(computeEventPhase(e, T.beforeStart)).toBe<EventPhase>('pre_event');
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('pre_event');
    expect(computeEventPhase(e, T.afterEnd)).toBe<EventPhase>('pre_event');
  });

  test('explain returns reason=status_pre for draft/ready', () => {
    expect(explainEventPhase({ ...ACTIVE_DATED, status: 'draft' }, T.during).reason).toBe(
      'status_pre'
    );
    expect(explainEventPhase({ ...ACTIVE_DATED, status: 'ready' }, T.during).reason).toBe(
      'status_pre'
    );
  });
});

// ─── Decision 1.2 — status=active → time decides ──────────────────────────

describe('OSE-242 Decision 1: status=active, time decides', () => {
  test('now < start_date → pre_event', () => {
    expect(computeEventPhase(ACTIVE_DATED, T.beforeStart)).toBe<EventPhase>('pre_event');
    expect(explainEventPhase(ACTIVE_DATED, T.beforeStart).reason).toBe('time_before_start');
  });

  test('now exactly at start_date → event (boundary, inclusive)', () => {
    expect(computeEventPhase(ACTIVE_DATED, T.atStart)).toBe<EventPhase>('event');
    expect(explainEventPhase(ACTIVE_DATED, T.atStart).reason).toBe('time_within');
  });

  test('start_date < now < end_date → event', () => {
    expect(computeEventPhase(ACTIVE_DATED, T.during)).toBe<EventPhase>('event');
    expect(explainEventPhase(ACTIVE_DATED, T.during).reason).toBe('time_within');
  });

  test('now exactly at end_date → event (boundary, inclusive)', () => {
    expect(computeEventPhase(ACTIVE_DATED, T.atEnd)).toBe<EventPhase>('event');
    expect(explainEventPhase(ACTIVE_DATED, T.atEnd).reason).toBe('time_within');
  });

  test('now > end_date → post_event', () => {
    expect(computeEventPhase(ACTIVE_DATED, T.afterEnd)).toBe<EventPhase>('post_event');
    expect(explainEventPhase(ACTIVE_DATED, T.afterEnd).reason).toBe('time_after_end');
  });
});

// ─── Decision 1.3 — status=archived → post_event ──────────────────────────

describe('OSE-242 Decision 1: status=archived → post_event regardless of time', () => {
  test('status=archived → post_event regardless of time', () => {
    const e = { ...ACTIVE_DATED, status: 'archived' };
    expect(computeEventPhase(e, T.beforeStart)).toBe<EventPhase>('post_event');
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('post_event');
    expect(computeEventPhase(e, T.afterEnd)).toBe<EventPhase>('post_event');
  });

  test('explain returns reason=status_post for archived', () => {
    expect(explainEventPhase({ ...ACTIVE_DATED, status: 'archived' }, T.during).reason).toBe(
      'status_post'
    );
  });
});

// ─── Unknown status — warn + treat as active ───────────────────────────────

describe('OSE-242 unknown status: warn + treat as active for time derivation', () => {
  test('status="paused" (forward-compat) → time-decides like active, with warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = { ...ACTIVE_DATED, status: 'paused' };
    expect(computeEventPhase(e, T.beforeStart)).toBe<EventPhase>('pre_event');
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('event');
    expect(computeEventPhase(e, T.afterEnd)).toBe<EventPhase>('post_event');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('status="" (empty) → still falls into time-decides', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(computeEventPhase({ ...ACTIVE_DATED, status: '' }, T.during)).toBe<EventPhase>('event');
    warnSpy.mockRestore();
  });

  test('case-insensitive: status="ACTIVE" normalises to active', () => {
    expect(computeEventPhase({ ...ACTIVE_DATED, status: 'ACTIVE' }, T.during)).toBe<EventPhase>(
      'event'
    );
  });
});

// ─── Decision 3 — null / malformed date handling ──────────────────────────

describe('OSE-242 Decision 3: null/malformed dates → status fallback', () => {
  test('both dates null + active → event (trust admin)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e: EventPhaseInput = { status: 'active', start_date: null, end_date: null };
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('event');
    expect(explainEventPhase(e, T.during).reason).toBe('no_dates_status_active');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('start set + end null + active + now < start → pre_event', () => {
    const e: EventPhaseInput = {
      status: 'active',
      start_date: '2026-05-01T19:00:00Z',
      end_date: null,
    };
    expect(computeEventPhase(e, T.beforeStart)).toBe<EventPhase>('pre_event');
    expect(explainEventPhase(e, T.beforeStart).reason).toBe('time_before_start');
  });

  test('start set + end null + active + now ≥ start → event (no auto post_event)', () => {
    const e: EventPhaseInput = {
      status: 'active',
      start_date: '2026-05-01T19:00:00Z',
      end_date: null,
    };
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('event');
    expect(computeEventPhase(e, T.afterEnd)).toBe<EventPhase>('event');
    expect(explainEventPhase(e, T.during).reason).toBe('partial_dates_after_start');
  });

  test('start null + end set + active → event with warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e: EventPhaseInput = {
      status: 'active',
      start_date: null,
      end_date: '2026-05-01T22:00:00Z',
    };
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('event');
    expect(explainEventPhase(e, T.during).reason).toBe('malformed_dates_status_fallback');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('malformed start_date string + active → event with warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e: EventPhaseInput = { status: 'active', start_date: 'not-a-date', end_date: 'also-not' };
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('event');
    expect(explainEventPhase(e, T.during).reason).toBe('malformed_dates_status_fallback');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('null dates + draft still resolves to pre_event (status forces)', () => {
    const e: EventPhaseInput = { status: 'draft', start_date: null, end_date: null };
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('pre_event');
  });

  test('null dates + archived still resolves to post_event (status forces)', () => {
    const e: EventPhaseInput = { status: 'archived', start_date: null, end_date: null };
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('post_event');
  });
});

// ─── Decision 2 — signature shape ──────────────────────────────────────────

describe('OSE-242 Decision 2: function signature is subset-typed + injectable now', () => {
  test('accepts only the 3 required fields, not full event row', () => {
    // No need for id/title/brand_id/etc. — proves subset-typed input.
    const minimal: EventPhaseInput = { status: 'active', start_date: null, end_date: null };
    expect(() => computeEventPhase(minimal, T.during)).not.toThrow();
  });

  test('now is optional; defaults to current time', () => {
    const e: EventPhaseInput = { status: 'active', start_date: null, end_date: null };
    // Calling without explicit `now` should not throw.
    expect(() => computeEventPhase(e)).not.toThrow();
  });

  test('return type is exactly the 3-value union', () => {
    const phase = computeEventPhase(ACTIVE_DATED, T.during);
    expect(VALID_EVENT_PHASES).toContain(phase);
    expect(VALID_EVENT_PHASES).toEqual(['pre_event', 'event', 'post_event']);
  });
});

// ─── Constants ─────────────────────────────────────────────────────────────

describe('OSE-242 exported constants', () => {
  test('VALID_EVENT_PHASES has exactly 3 values', () => {
    expect(VALID_EVENT_PHASES).toHaveLength(3);
  });

  test('EVENT_PHASE_LABELS has a label for each phase', () => {
    for (const phase of VALID_EVENT_PHASES) {
      expect(EVENT_PHASE_LABELS[phase]).toBeTruthy();
      expect(typeof EVENT_PHASE_LABELS[phase]).toBe('string');
    }
  });
});

// ─── assertSurfaceCoherence helper ─────────────────────────────────────────

describe('OSE-242 assertSurfaceCoherence: cross-surface drift detection', () => {
  test('all surfaces agree → ok=true', () => {
    const result = assertSurfaceCoherence([
      { surface: 'poster', phase: 'event' },
      { surface: 'display', phase: 'event' },
      { surface: 'public', phase: 'event' },
    ]);
    expect(result.ok).toBe(true);
  });

  test('one surface diverges → ok=false with divergence list', () => {
    const result = assertSurfaceCoherence([
      { surface: 'poster', phase: 'event' },
      { surface: 'display', phase: 'event' },
      { surface: 'public', phase: 'pre_event' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.expected).toBe<EventPhase>('event');
      expect(result.divergences).toEqual([{ surface: 'public', phase: 'pre_event' }]);
    }
  });

  test('empty list → ok=true (vacuously)', () => {
    expect(assertSurfaceCoherence([]).ok).toBe(true);
  });

  test('single observation → ok=true', () => {
    expect(assertSurfaceCoherence([{ surface: 'poster', phase: 'event' }]).ok).toBe(true);
  });

  test('all surfaces diverge from first → reports all divergences', () => {
    const result = assertSurfaceCoherence([
      { surface: 'poster', phase: 'event' },
      { surface: 'display', phase: 'pre_event' },
      { surface: 'public', phase: 'post_event' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.divergences).toHaveLength(2);
    }
  });
});

// ─── Multi-day events (canonical, per OQ:3 closed 2026-04-26) ─────────────

describe('OSE-242 multi-day events: canonical, duration-agnostic', () => {
  // Festival fixture: Friday evening → Sunday late-night
  const festival: EventPhaseInput = {
    status: 'active',
    start_date: '2026-08-15T17:00:00Z',
    end_date: '2026-08-17T23:00:00Z',
  };

  test('before festival start → pre_event', () => {
    expect(computeEventPhase(festival, new Date('2026-08-15T16:59:00Z'))).toBe<EventPhase>(
      'pre_event'
    );
  });

  test('Friday evening (day 1) → event', () => {
    expect(computeEventPhase(festival, new Date('2026-08-15T18:00:00Z'))).toBe<EventPhase>('event');
  });

  test('Saturday noon (day 2, mid-festival) → event', () => {
    expect(computeEventPhase(festival, new Date('2026-08-16T12:00:00Z'))).toBe<EventPhase>('event');
  });

  test('Saturday 4am (diurnal break, no programmed activity) → still event (relationship-building substrate)', () => {
    expect(computeEventPhase(festival, new Date('2026-08-16T04:00:00Z'))).toBe<EventPhase>('event');
  });

  test('Sunday late-night (day 3, last hour) → event', () => {
    expect(computeEventPhase(festival, new Date('2026-08-17T22:00:00Z'))).toBe<EventPhase>('event');
  });

  test('after festival end → post_event', () => {
    expect(computeEventPhase(festival, new Date('2026-08-17T23:01:00Z'))).toBe<EventPhase>(
      'post_event'
    );
  });

  test('weeklong workshop (canonical phase remains 3-value regardless of span)', () => {
    const workshop: EventPhaseInput = {
      status: 'active',
      start_date: '2026-09-07T09:00:00Z',
      end_date: '2026-09-13T17:00:00Z', // 6+ days
    };
    expect(computeEventPhase(workshop, new Date('2026-09-06T08:00:00Z'))).toBe<EventPhase>(
      'pre_event'
    );
    expect(computeEventPhase(workshop, new Date('2026-09-10T14:00:00Z'))).toBe<EventPhase>('event');
    expect(computeEventPhase(workshop, new Date('2026-09-14T00:00:00Z'))).toBe<EventPhase>(
      'post_event'
    );
  });
});

// ─── Real-world scenarios from the matrix ──────────────────────────────────

describe('OSE-242 matrix scenarios', () => {
  test('PreEvent column: status=ready, before start → pre_event', () => {
    const e: EventPhaseInput = {
      status: 'ready',
      start_date: '2026-05-01T19:00:00Z',
      end_date: '2026-05-01T22:00:00Z',
    };
    expect(computeEventPhase(e, T.beforeStart)).toBe<EventPhase>('pre_event');
  });

  test('PreEvent column: status=active but admin promoted before start time → pre_event by time', () => {
    expect(computeEventPhase(ACTIVE_DATED, T.beforeStart)).toBe<EventPhase>('pre_event');
  });

  test('Active column: status=active, mid-event → event (LIVE NOW)', () => {
    expect(computeEventPhase(ACTIVE_DATED, T.during)).toBe<EventPhase>('event');
  });

  test('PostEvent column: status=active, after end_date → post_event by time (admin will archive)', () => {
    expect(computeEventPhase(ACTIVE_DATED, T.afterEnd)).toBe<EventPhase>('post_event');
  });

  test('PostEvent column: status=archived → post_event regardless', () => {
    const e = { ...ACTIVE_DATED, status: 'archived' };
    expect(computeEventPhase(e, T.during)).toBe<EventPhase>('post_event');
  });
});
