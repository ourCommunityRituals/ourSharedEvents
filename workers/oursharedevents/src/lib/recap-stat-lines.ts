/**
 * The post-event recap's stat lines (the "By the numbers" card on the public event
 * page). Pure markup from counts, so the rules can be tested without the page.
 *
 * Moved out of `handlers/pages.ts` for OSE-1752 so that a withheld walk-in line
 * is built in ONE place.
 */

import { applyCountFloor, floorNestedCounts } from './count-floor';
import { fmt, msg } from './i18n/catalog';
import { DEFAULT_LANG, type Lang } from './i18n/languages';

/**
 * D1 (CCR 2026-09-14) — the public post-event recap is the LEAST-trusted surface
 * (unauthenticated) and must not become a side-channel that leaks an exact small
 * count the admin tile + SharedReport hide. Every attendee-derived stat here
 * routes through the SAME uniform floor the admin tile and corridor map use
 * (applyCountFloor, K=5): a sub-K cohort renders "Fewer than 5", never the exact
 * number. A 3-of-5 or "50% of 2" line back-derives an individual — the exact
 * never-who break OSE-665 exists to close. Server-side, so the raw value never
 * reaches the client.
 *
 * `null` is a count the caller has already withheld (a nested floor said no). It reads
 * as every other withheld count does, "Fewer than 5", so the page has one form for it.
 * The words come from the page language ("Menos de 5" in Spanish); the floor
 * is the same in every language.
 */
export function statLine(
  raw: number | null,
  label: string,
  testid: string,
  lang: Lang = DEFAULT_LANG
): string {
  const f = applyCountFloor(raw ?? 0);
  const inner = f.suppressed
    ? fmt(lang, 'stats.fewerThan', { floor: f.floor, label })
    : `<strong>${f.count}</strong> ${label}`;
  return `<p data-testid="${testid}">${inner}</p>`;
}

/** True when a count clears the uniform floor (safe to publish exactly / use in a ratio). */
export function clearsFloor(raw: number): boolean {
  return !applyCountFloor(raw).suppressed;
}

/**
 * The "Walked in" line. Walk-ins are a subset of check-ins. Floored one by one,
 * 8 check-ins and 6 walk-ins would both print and give back the 2 who came
 * through registration. Floored as a nested pair, a walk-in count prints only
 * when what is left is 0 or at least 5.
 *
 * A withheld walk-in count has two causes: it is under 5, or it is 5 or more and
 * what is left of the check-ins would be 1 to 4. Both read "Fewer than 5" (OSE-1752).
 * A line that told them apart (the old "held" line) said
 * walk-ins were 5 or more AND the rest was a small group, which OSE-1657 forbids.
 */
export function walkInStatLine(
  checkinCount: number,
  walkInCount: number,
  lang: Lang = DEFAULT_LANG
): string {
  if (!clearsFloor(checkinCount)) return '';
  const [, walkInShown] = floorNestedCounts([checkinCount, walkInCount]);
  return statLine(walkInShown, msg(lang, 'stats.walkedIn'), 'stat-walk-ins', lang);
}
