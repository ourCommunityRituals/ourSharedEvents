/**
 * Who × plan: what an admin read may return about an event (OSE-682, owner
 * decisions 2026-11-04).
 *
 * The SharedReport caps its depth by the event's plan (capDepthToPlan). The same
 * numbers also leave through admin reads (the event dashboard, the corridor
 * dashboard, pre-event activity, poster deployments), and what the front end
 * hides does not matter if the back end returns it. So those reads follow the
 * same rule, decided by WHO asks and WHAT PLAN the event is on:
 *
 *   - Platform admin (scope `all`, or a member of `ose-platform`): everything,
 *     on every plan. Their reads are audited (owner, 2026-11-04).
 *   - Anyone else (the event's brand admin; brand scoping still decides WHICH
 *     events they reach): on an event whose plan lacks the paid report, the
 *     Local line only, meaning totals. Per-poster and per-placement counts, map
 *     cells and flows, and per-day series are withheld, and the response names
 *     what it withheld (a refusal is printed, not promised).
 *
 * The plan is the `analytics.shared-report` flag: an event override, then the
 * global value, then the flags-contract default (on) when there is no row. It is
 * read once per request by `readReportPlan` (lib/feature-flags.ts), which fails
 * CLOSED. This module is pure.
 */

export type ReportPlan =
  | { full: true }
  | {
      full: false;
      /** The global `analytics.shared-report` value (no row = the contract default, on). */
      globalPaid: boolean;
      /** Event-level overrides of the same flag. */
      overrides: ReadonlyMap<string, boolean>;
    };

/** A platform admin's view: every event reads as if its plan included the paid report. */
export const FULL_PLAN: ReportPlan = { full: true };

/** What a failed plan read becomes: nothing is paid (fail closed). */
export const CLOSED_PLAN: ReportPlan = { full: false, globalPaid: false, overrides: new Map() };

/** Does this event's plan include the paid report, for this caller? */
export function hasPaidReport(plan: ReportPlan, eventId: string): boolean {
  if (plan.full) return true;
  const override = plan.overrides.get(eventId);
  return override ?? plan.globalPaid;
}

/** The printed refusal on a capped admin read. */
export interface PlanNote {
  paid_report: false;
  /** The response keys left out because the event's plan lacks the paid report. */
  locked_sections: string[];
  /** The plan that includes them. */
  next_plan: 'mid';
}

export function planNote(locked: string[]): PlanNote {
  return { paid_report: false, locked_sections: [...locked], next_plan: 'mid' };
}

/**
 * A SQL condition that keeps only events whose plan includes the paid report,
 * for a brand-wide read (the corridor dashboard). `column` names the event id.
 * The override list is bound once, as JSON through `json_each` (the pattern in
 * handlers/audit.ts): D1 caps a statement at 100 bound parameters, and a long
 * list must neither be cut short nor empty every brand's map.
 */
export function paidEventsSql(
  plan: ReportPlan,
  column: string
): { sql: string; binds: string[]; narrowed: boolean } {
  if (plan.full) return { sql: '1 = 1', binds: [], narrowed: false };
  const on: string[] = [];
  const off: string[] = [];
  for (const [id, paid] of plan.overrides) (paid ? on : off).push(id);
  if (plan.globalPaid) {
    if (off.length === 0) return { sql: '1 = 1', binds: [], narrowed: false };
    return {
      sql: `${column} NOT IN (SELECT value FROM json_each(?))`,
      binds: [JSON.stringify(off)],
      narrowed: true,
    };
  }
  if (on.length === 0) return { sql: '0 = 1', binds: [], narrowed: true };
  return {
    sql: `${column} IN (SELECT value FROM json_each(?))`,
    binds: [JSON.stringify(on)],
    narrowed: true,
  };
}
