/**
 * OSE-665 — uniform count floor (governance decision 2026-08-08: "0-5
 * consistency so everyone sees the same information").
 *
 * A sub-threshold cohort must be represented IDENTICALLY on every surface —
 * the organizer's admin tile, the sponsor-facing view, and the SharedReport —
 * so no surface becomes a side-channel that leaks an exact small count another
 * surface hides. This reuses CORRIDOR_MAP_MIN_COUNT (the SharedReport /
 * corridor-map suppression floor, K=5) and applies the SAME rule the corridor
 * map uses: `count < floor` is suppressed (0..K-1), `count >= floor` shows the
 * exact number. Enforced SERVER-SIDE so the exact sub-K value never reaches any
 * client.
 *
 * NOTE ON SCOPE: this floors the aggregate COUNT representation. It does not
 * govern the organizer's first-party operational LIST views (their own
 * attendee/registration rows), which are guarded by #1 (two-DB) + #8 (TTL) and
 * are legitimately exact — an organizer must be able to run their own event.
 */

import { CORRIDOR_MAP_MIN_COUNT } from './shared-report';

export interface FlooredCount {
  /** The exact count when >= floor; null when suppressed. */
  count: number | null;
  /** True when the true count is below the floor (0..floor-1). */
  suppressed: boolean;
  /** The floor applied (echoed so clients render "below N" without hardcoding). */
  floor: number;
}

/**
 * Apply the uniform K-anonymity floor to a raw count. Matches the corridor-map
 * rule (`count < floor` → suppressed) so the admin tile and the SharedReport
 * show the same thing for the same cohort.
 */
export function applyCountFloor(raw: number, floor: number = CORRIDOR_MAP_MIN_COUNT): FlooredCount {
  // Stryker disable next-line EqualityOperator,ConditionalExpression: equivalent mutants — `raw > 0` vs `raw >= 0` are identical at raw=0 (both floor to 0), and `raw > 0`→`true` changes nothing because a negative raw floors below the K-floor and is suppressed either way. The finiteness guard, the `&&`, and Math.floor ARE covered (killed by the Infinity / NaN / 42 / 4.9 cases in count-floor.spec.ts). OSE-1186.
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  if (n < floor) return { count: null, suppressed: true, floor };
  return { count: n, suppressed: false, floor };
}
