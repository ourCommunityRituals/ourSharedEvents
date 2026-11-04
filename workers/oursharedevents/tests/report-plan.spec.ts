/**
 * OSE-682 — who × plan: the pure plan module, the plan read failing closed, and
 * the sponsor home printing totals only.
 *
 * Runs in the node project (no runtime bound).
 *
 * @born-red OSE-682 | method: invert-default | verified: making hasPaidReport
 *   return true for a plan without the paid report turns "Free global, no
 *   override → not paid" red; making readReportPlan's catch return FULL_PLAN
 *   turns "an unreadable plan reads as nothing paid" red.
 */
import { describe, it, expect } from 'vitest';
import {
  CLOSED_PLAN,
  FULL_PLAN,
  hasPaidReport,
  paidEventsSql,
  planNote,
  type ReportPlan,
} from '../src/lib/report-plan';
import { readReportPlan } from '../src/lib/feature-flags';
import { renderPreEventReach } from '../src/lib/sponsor-home-render';

const plan = (globalPaid: boolean, overrides: Array<[string, boolean]> = []): ReportPlan => ({
  full: false,
  globalPaid,
  overrides: new Map(overrides),
});

describe('OSE-682 | hasPaidReport', () => {
  it('Free global, no override → not paid', () => {
    expect(hasPaidReport(plan(false), 'e1')).toBe(false);
  });
  it('Mid global → paid', () => {
    expect(hasPaidReport(plan(true), 'e1')).toBe(true);
  });
  it('an event override wins over global, both ways', () => {
    expect(hasPaidReport(plan(false, [['e1', true]]), 'e1')).toBe(true);
    expect(hasPaidReport(plan(false, [['e1', true]]), 'e2')).toBe(false);
    expect(hasPaidReport(plan(true, [['e1', false]]), 'e1')).toBe(false);
  });
  it('a platform admin (FULL_PLAN) sees every event as paid', () => {
    expect(hasPaidReport(FULL_PLAN, 'anything')).toBe(true);
  });
  it('the fail-closed plan pays for nothing', () => {
    expect(hasPaidReport(CLOSED_PLAN, 'e1')).toBe(false);
  });
});

describe('OSE-682 | paidEventsSql (brand-wide reads)', () => {
  it('platform or Mid with no off-override: no narrowing', () => {
    expect(paidEventsSql(FULL_PLAN, 'e.id')).toEqual({ sql: '1 = 1', binds: [], narrowed: false });
    expect(paidEventsSql(plan(true), 'e.id').narrowed).toBe(false);
  });
  it('Mid with an off-override: that event is left out', () => {
    expect(paidEventsSql(plan(true, [['e1', false]]), 'e.id')).toEqual({
      sql: 'e.id NOT IN (?)',
      binds: ['e1'],
      narrowed: true,
    });
  });
  it('Free with on-overrides: only those events', () => {
    expect(
      paidEventsSql(
        plan(false, [
          ['e1', true],
          ['e2', false],
        ]),
        'e.id'
      )
    ).toEqual({
      sql: 'e.id IN (?)',
      binds: ['e1'],
      narrowed: true,
    });
  });
  it('Free with no override: nothing', () => {
    expect(paidEventsSql(plan(false), 'e.id')).toEqual({ sql: '0 = 1', binds: [], narrowed: true });
  });
  it('too many off-overrides to bind: fails safe to nothing, not everything', () => {
    const off = Array.from({ length: 200 }, (_, i) => [`e${i}`, false] as [string, boolean]);
    expect(paidEventsSql(plan(true, off), 'e.id').sql).toBe('0 = 1');
  });
});

describe('OSE-682 | planNote', () => {
  it('names what was withheld and the plan that has it', () => {
    expect(planNote(['flows'])).toEqual({
      paid_report: false,
      locked_sections: ['flows'],
      next_plan: 'mid',
    });
  });
});

describe('OSE-682 | readReportPlan fails closed', () => {
  it('an unreadable plan reads as nothing paid', async () => {
    const broken = {
      prepare() {
        throw new Error('D1_ERROR: no such table: feature_flags');
      },
    } as unknown as D1Database;
    const p = await readReportPlan(broken);
    expect(p.full).toBe(false);
    expect(hasPaidReport(p, 'e1')).toBe(false);
  });
});

describe('OSE-682 | sponsor home prints totals only (Local line)', () => {
  it('the pre-event reach line carries no per-day series', () => {
    const html = renderPreEventReach({
      posters: 3,
      places: 2,
      scans: { count: 12, suppressed: false, floor: 5 },
      clicks: { count: 9, suppressed: false, floor: 5 },
      scansByDay: [
        { day: '2031-02-03', count: { count: 7, suppressed: false, floor: 5 } },
        { day: '2031-02-04', count: { count: 5, suppressed: false, floor: 5 } },
      ],
    });
    expect(html).toContain('12 poster scans');
    expect(html).not.toContain('2031-02-03');
    expect(html).not.toContain('2031-02-04');
  });
});
