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

/**
 * Floor a total published beside its parts (drop before sum, OSE-683).
 *
 * A part under the floor never joins the sum. Flooring the raw sum is not
 * enough: with parts 6 and 3, publishing 6, "withheld" and a total of 9 hands
 * back the 3. The total is the sum of the parts that are themselves published,
 * so it can only be differenced against them down to zero. With no surviving
 * part it is withheld, however large the small parts are together (3 + 3 is
 * not 6).
 */
export function floorTotalOfParts(
  parts: readonly (number | null | undefined)[],
  floor: number = CORRIDOR_MAP_MIN_COUNT
): FlooredCount {
  let sum = 0;
  for (const part of parts) sum += applyCountFloor(part ?? 0, floor).count ?? 0;
  return applyCountFloor(sum, floor);
}

/**
 * A rate, in percent: `part` of `whole` (people who returned, of people seen).
 *
 * A rate published beside its denominator IS its numerator (20% of 5 is one
 * person), and its complement is the rest of the group (95% of 20 leaves one
 * person who did not). So the two counts go through the nested-count rule
 * below, the one the returns export uses for the same pair: the whole and the
 * part must each clear the floor, and the people left over must be none or at
 * least the floor. Otherwise the rate is null.
 */
export function flooredRatePct(
  part: number,
  whole: number,
  floor: number = CORRIDOR_MAP_MIN_COUNT
): number | null {
  const [w, p] = floorNestedCounts([whole, part], floor, floor);
  // Stryker disable next-line ConditionalExpression: equivalent mutant — skipping this check changes nothing, because the part is null whenever the whole is (a part no larger than a sub-floor whole is itself under the floor, and a part larger than its whole fails closed). Kept for type narrowing and defence in depth.
  if (typeof w !== 'number') return null;
  return typeof p === 'number' ? (p / w) * 100 : null;
}

/**
 * Floor a chain of nested counts, largest first (each one counts a subset of
 * the one before: people ⊇ returned twice ⊇ returned three times …).
 *
 * Flooring each count alone is not enough. With people = 12 and
 * returned_2plus = 9 both published, a reader subtracts and learns that 3
 * people came once: a group under the floor. So a count is published only if
 * it is at or above `floor` AND its difference from the last published count
 * in the chain is 0 or at least `diffFloor`. Otherwise it is null. Any two
 * published counts then differ by 0 or at least `diffFloor`, because every
 * gap between them is a sum of such differences.
 *
 * `floor` may be stricter than `diffFloor` (the corridor baseline publishes a
 * count only from 10 up, but a difference of 5 is already a K-safe group).
 */
export function floorNestedCounts(
  chain: readonly number[],
  floor: number = CORRIDOR_MAP_MIN_COUNT,
  diffFloor: number = CORRIDOR_MAP_MIN_COUNT
): (number | null)[] {
  let last: number | null = null;
  // The chain must be nested (never increasing). Any increase over the
  // previous raw count, published or not, means the input is not what the
  // floor assumes, so it and everything after it fail closed.
  let prevRaw: number | null = null;
  let broken = false;
  return chain.map((raw) => {
    const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    if (prevRaw !== null && n > prevRaw) broken = true;
    prevRaw = n;
    if (broken || n < floor) return null;
    if (last !== null) {
      const gap = last - n;
      if (gap !== 0 && gap < diffFloor) return null;
    }
    last = n;
    return n;
  });
}

/**
 * Every published count is rounded down to a multiple of this before the
 * floors apply (PO decision 2026-10-01). A snapshot is compared with the last
 * one, so an exact count would show a one-person change between them (12 then
 * 13); rounded, small changes disappear inside a step of 5, and a change that
 * crosses a step never says how many people moved.
 */
export const PUBLISH_ROUNDING = CORRIDOR_MAP_MIN_COUNT;

/** A count rounded down to a multiple of PUBLISH_ROUNDING. */
export function roundForPublish(n: number): number {
  return roundDownTo(n, PUBLISH_ROUNDING);
}

// One argument on purpose: callers pass roundForPublish straight to `.map`, which
// would hand a second argument (the index) to a step parameter.
function roundDownTo(n: number, step: number): number {
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return v - (v % step);
}

/**
 * Round, then chain-floor: the safe way to publish nested counts, and the
 * shortest. Flooring alone leaves a chain open to arithmetic that the rounding
 * closes (OSE-1782), so a surface that publishes a chain calls this and not
 * `floorNestedCounts` directly.
 */
export function floorPublishedChain(
  chain: readonly number[],
  floor: number = CORRIDOR_MAP_MIN_COUNT,
  diffFloor: number = CORRIDOR_MAP_MIN_COUNT
): (number | null)[] {
  const published = floorNestedCounts(
    chain.map((n) => roundForPublish(n)),
    floor,
    diffFloor
  );
  // The nesting test must see the exact counts: 11 then 14 both round to 10, so
  // the rounded chain looks nested when it is not. An increase in the exact
  // counts means the input is not what the floor assumes, so it and everything
  // after it fail closed.
  let broken = false;
  let prev: number | null = null;
  return published.map((value, i) => {
    const exact = Number.isFinite(chain[i]) && chain[i] > 0 ? Math.floor(chain[i]) : 0;
    if (prev !== null && exact > prev) broken = true;
    prev = exact;
    return broken ? null : value;
  });
}

/**
 * Round, then floor, a running total (people so far, across shows): the
 * cumulative twin of `floorPublishedChain`, where each value counts everything
 * before it so the series never goes down.
 *
 * Published as exact numbers, a running total gives away every increment by
 * subtraction (8 then 15 says the third show drew exactly 7), and two sub-floor
 * shows summed (4 + 4 = 8) have one solution. So each value is rounded first,
 * then published only if it is at or above `floor` and its gap from the last
 * PUBLISHED value is 0 or at least `diffFloor`. A series that goes down is not a
 * running total, so it and everything after it fail closed.
 *
 * The series must already be sums of PUBLISHED parts. Handed raw totals of shows
 * that were each withheld, it publishes a total that names them (five shows under
 * 5 sum to at most 20, so a published 20 says every show had exactly four). To
 * publish a running total from per-show counts, call `floorCumulativeOfParts`.
 */
export function floorCumulativeSeries(
  series: readonly number[],
  floor: number = CORRIDOR_MAP_MIN_COUNT,
  diffFloor: number = CORRIDOR_MAP_MIN_COUNT,
  step: number = PUBLISH_ROUNDING
): (number | null)[] {
  let last: number | null = null;
  let prev: number | null = null;
  let broken = false;
  return series.map((raw) => {
    // The decrease test uses the exact (floored) counts, not the rounded ones: 14
    // then 11 is a fall inside one bucket of 5 and must break the series.
    const exact = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    const n = roundDownTo(raw, step);
    if (prev !== null && exact < prev) broken = true;
    prev = exact;
    if (broken || n < floor) return null;
    if (last !== null) {
      const gap = n - last;
      if (gap !== 0 && gap < diffFloor) return null;
    }
    last = n;
    return n;
  });
}

/**
 * A running total from per-show counts: the cumulative twin of
 * `floorTotalOfParts` (drop before sum, OSE-683). A show under the floor never
 * joins the sum, so the total cannot be differenced or bounded back to a
 * withheld show. The totals are then rounded and floored as
 * `floorCumulativeSeries` does. With no published part so far the total is
 * withheld.
 */
export function floorCumulativeOfParts(
  parts: readonly (number | null | undefined)[],
  floor: number = CORRIDOR_MAP_MIN_COUNT,
  diffFloor: number = CORRIDOR_MAP_MIN_COUNT
): (number | null)[] {
  let sum = 0;
  const totals = parts.map((part) => {
    sum += applyCountFloor(part ?? 0, floor).count ?? 0;
    return sum;
  });
  return floorCumulativeSeries(totals, floor, diffFloor);
}
