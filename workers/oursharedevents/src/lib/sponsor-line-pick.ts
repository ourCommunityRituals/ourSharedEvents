// ─── The one-name sponsor line: which name, this hour (OSE-1901) ────────────────
//
// Some spots show ONE sponsor name by an event's title and date: the card line on
// the landing, on /events and in the map's place panel, and the TV's "also coming
// up". When an event has more than one consented sponsor, the name is chosen by
// the covenant share (owner, 2026-11-09; OCR-docs invariant 25): money buys how
// OFTEN a name comes up, never its size, slot or position. Every name prints in
// the same place, at the same size, through the same markup; nothing here reaches
// the renderer but a title.
//
// How often: `allocateShares` (lib/sponsor-allocation.ts), unchanged. A higher
// paid level weighs more, up to its cap; the is_local class keeps its floor (30%).
// The shares become whole hours of a cycle (100 hours, or one hour per name when
// there are more names than that), so over a full cycle the numbers are exact and
// not a matter of chance: locals hold at least the floor in every cycle.
//
// Which hour: the cycle is shuffled with a seed made of the event id alone, and
// the clock hour picks the place in it. The inputs are the event id, the hour
// and the event's own consented sponsors. Nothing about the visitor or the
// request is an input, so two visitors in the same hour read the same name, the
// page stays cacheable, and the pick tells nobody anything about a person.
//
// What the share math does NOT promise (it is the canonical math, and this file
// does not change it): the highest paid level is capped at 40%, so with only two
// names, or beside a single local, another name can come up as often or more.

import { SPONSOR_ALLOCATION, allocateShares, sovTierOf } from './sponsor-allocation';
import { seededShuffle } from './sponsor-resolver';

/** Hours in one cycle. One hour is 1% of the line. */
export const LINE_CYCLE_HOURS = 100;

const HOUR_MS = 3_600_000;

/** One consented sponsor of one event, as the line needs it. */
export interface LineCandidate {
  /** sponsor_business id: the identity the share is worked out for. */
  id: string;
  /** What prints. */
  title: string;
  /** The placement's stored level (sponsor_placement.tier); `sovTierOf` maps it. */
  tier: string;
  /** Geo-derived (sponsor_placement.locality_band), never bought. */
  isLocal: boolean;
}

/** A candidate and the hours of one cycle that are its own. */
export interface LineHours {
  candidate: LineCandidate;
  hours: number;
}

/** The clock hour a moment falls in: whole hours since 1970, UTC. */
export function hourOf(nowMs: number): number {
  return Number.isFinite(nowMs) && nowMs > 0 ? Math.floor(nowMs / HOUR_MS) : 0;
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Float dust off a share (29.999999999 is 30), so a floor is not lost to it. */
const tidy = (n: number): number => Math.round(n * 1e6) / 1e6;

/** One row per sponsor, in id order, so the order the rows arrived in means nothing. */
function roster(candidates: readonly LineCandidate[]): LineCandidate[] {
  const seen = new Map<string, LineCandidate>();
  for (const c of candidates) if (!seen.has(c.id)) seen.set(c.id, c);
  return [...seen.values()].sort(byId);
}

interface Row extends LineHours {
  exact: number;
}

/** The row `score` ranks highest; ties go to the lower id. */
function most(rows: readonly Row[], score: (r: Row) => number): Row | undefined {
  let best: Row | undefined;
  for (const r of rows) {
    if (!best || score(r) > score(best) + 1e-9) best = r;
  }
  return best;
}

/**
 * The hours of one cycle each sponsor holds. Pure.
 *
 * - The hours add up to the cycle: 100, or the number of names when there are more.
 * - Each sponsor's hours are its covenant share, rounded by largest remainder.
 * - Whenever a local is among them, the locals together hold at least the floor
 *   (30% of the cycle). Rounding never takes it below: an hour moves from the
 *   non-local furthest above its share to the local furthest below its own.
 * - Up to 50 names, nobody has no hour (the share math gives each at least 2%).
 *   Past that the floor comes first, as it does in the share math.
 */
export function lineHours(candidates: readonly LineCandidate[]): LineHours[] {
  const list = roster(candidates);
  if (list.length === 0) return [];
  const total = Math.max(LINE_CYCLE_HOURS, list.length);
  const pct = new Map(
    allocateShares(
      list.map((c) => ({ id: c.id, tier: sovTierOf(c.tier), is_local: c.isLocal }))
    ).map((s) => [s.id, s.sharePct])
  );
  const rows: Row[] = list.map((candidate) => {
    const exact = tidy(((pct.get(candidate.id) ?? 0) * total) / 100);
    return { candidate, exact, hours: Math.floor(exact) };
  });

  // Largest remainder: the hours the whole numbers left over go to the largest
  // fractions, the lower id first on a tie.
  let left = total - rows.reduce((a, r) => a + r.hours, 0);
  const byFraction = rows
    .slice()
    .sort((a, b) => b.exact - b.hours - (a.exact - a.hours) || byId(a.candidate, b.candidate));
  for (let i = 0; left > 0; i++, left--) byFraction[i % byFraction.length]!.hours += 1;

  // Nobody with no hour, where an hour can be spared (only past 50 names).
  for (const r of rows) {
    if (r.hours > 0) continue;
    const spare = rows.filter((d) => d.hours > 1);
    const from =
      most(
        spare.filter((d) => !d.candidate.isLocal),
        (d) => d.hours - d.exact
      ) ?? most(spare, (d) => d.hours - d.exact);
    if (!from) break;
    from.hours -= 1;
    r.hours += 1;
  }

  // The local floor, held in whole hours.
  const locals = rows.filter((r) => r.candidate.isLocal);
  const others = rows.filter((r) => !r.candidate.isLocal);
  if (locals.length > 0 && others.length > 0) {
    const need = Math.ceil(
      tidy((SPONSOR_ALLOCATION.share_of_voice.walls.local_floor_pct * total) / 100)
    );
    let have = locals.reduce((a, r) => a + r.hours, 0);
    while (have < need) {
      const to = most(locals, (r) => r.exact - r.hours)!;
      const from =
        most(
          others.filter((r) => r.hours > 1),
          (r) => r.hours - r.exact
        ) ??
        most(
          others.filter((r) => r.hours > 0),
          (r) => r.hours - r.exact
        );
      if (!from) break;
      from.hours -= 1;
      to.hours += 1;
      have += 1;
    }
  }

  return rows.map(({ candidate, hours }) => ({ candidate, hours }));
}

/**
 * One cycle for an event: each sponsor as many times as it has hours, in an
 * order shuffled from the event id alone. The order carries no meaning.
 */
export function lineCycle(eventId: string, candidates: readonly LineCandidate[]): LineCandidate[] {
  const cycle: LineCandidate[] = [];
  for (const r of lineHours(candidates)) for (let i = 0; i < r.hours; i++) cycle.push(r.candidate);
  return seededShuffle(cycle, `sponsor-line:${eventId}`);
}

/**
 * The sponsor whose name the line shows for `eventId` in clock hour `hour`
 * (`hourOf`), or null when nobody consented. Pure: the same event, sponsors and
 * hour always give the same name.
 */
export function pickSponsorLine(
  eventId: string,
  candidates: readonly LineCandidate[],
  hour: number
): LineCandidate | null {
  const cycle = lineCycle(eventId, candidates);
  if (cycle.length === 0) return null;
  const h = Number.isFinite(hour) ? Math.floor(hour) : 0;
  return cycle[((h % cycle.length) + cycle.length) % cycle.length] ?? null;
}
