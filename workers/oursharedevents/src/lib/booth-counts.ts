// ─── Scans per stall at a fair (OSE-2004, OSE ADR-034 decision 6) ────────────
//
// A stall's number is a sum of the SAME cells every other scan figure is a sum
// of (lib/scan-cells.ts): one placement in one hour, kept only when that cell
// holds 5 or more scans on its own (K = CORRIDOR_MAP_MIN_COUNT). Nothing here
// floors anything a second way, and nothing here reads a raw total.
//
//   a stall      the cells of the placements that point at it, those that
//                clear the floor, summed (floorTotalOfParts). A stall with
//                no such cell reads withheld: "Fewer than 5 scans in any hour".
//   no stall     the cells of every other placement of the event (and of any
//                scan whose placement is not one of the event's), the same way.
//                It is one more part, never a remainder worked out by
//                subtraction.
//   a category   the published counts of its stalls, through floorTotalOfParts.
//   the fair     the published counts of every stall and of "no stall",
//                through floorTotalOfParts.
//
// WHY NOTHING CAN BE DIFFERENCED BACK. Every number this module returns is a
// sum of cells that each hold 5 or more. A cell under the floor joins no sum,
// on this route or any other (the poster list, /stats, the pre-event card, the
// dashboards all read scan-cells). So every published number is a function of
// the cleared cells alone: change any cell that stays under the floor, by any
// amount, and nothing published moves. No arithmetic over published numbers
// can then find a withheld cell's value, because two datasets that differ only
// there publish the same numbers. In particular:
//   - the fair total minus every published stall and "no stall" is always 0;
//   - a stall's count is the sum of its placements' counts on the poster list,
//     exactly, so the two lists hold the same information;
//   - the fair total here equals the event's scans on /stats, exactly.
// The proof sketch, and what it does not cover, is in
// docs/features/FAIR-REPORTING.md.
//
// ORDER NEVER FOLLOWS A COUNT. Stalls come in the organizer's order (in use
// first, then sort, number, id) and categories in BOOTH_CATEGORIES order: a
// list sorted by raw scans would rank the withheld stalls against each other.
//
// Pure: no request, no DB. The handler (handlers/booth-counts.ts) reads the
// rows and hands them here.

import { floorTotalOfParts, type FlooredCount } from './count-floor';
import { BOOTH_CATEGORIES } from './event-booths';
import type { ScanCell } from './scan-cells';

/** What the count needs of a stall. Organizer data, never a person. */
export interface BoothRef {
  id: string;
  number: string;
  name: string;
  category: string | null;
  is_active: boolean;
}

/** What the count needs of a placement: which stall it points at, if any. */
export interface PlacementRef {
  id: string;
  booth_id: string | null;
}

export interface BoothCountRow {
  id: string;
  number: string;
  name: string;
  category: string | null;
  is_active: boolean;
  /** The stall's placement-hours that clear the floor, summed; withheld when none does. */
  scans: FlooredCount;
}

export interface CategoryCountRow {
  /** A category from BOOTH_CATEGORIES, or null for stalls with none. */
  category: string | null;
  /** Stalls in this category, in use or not. A count of stalls, not of people. */
  booths: number;
  /** The published counts of its stalls, through floorTotalOfParts. */
  scans: FlooredCount;
}

export interface BoothCounts {
  booths: BoothCountRow[];
  categories: CategoryCountRow[];
  /** Placements that point at no stall of this event: one more part, never a remainder. */
  no_stall: { placements: number; scans: FlooredCount };
  /** Every published stall count and "no stall", through floorTotalOfParts. */
  total: FlooredCount;
  /** Is any row (a stall, or "no stall" when it has placements) withheld? A boolean only. */
  any_withheld: boolean;
}

/** Every key a published BoothCounts holds, for the shape gates. */
export const BOOTH_COUNTS_KEYS = [
  'booths',
  'categories',
  'no_stall',
  'total',
  'any_withheld',
] as const;
export const BOOTH_COUNT_ROW_KEYS = [
  'id',
  'number',
  'name',
  'category',
  'is_active',
  'scans',
] as const;

function categoryRank(c: string | null): number {
  if (c === null) return BOOTH_CATEGORIES.length + 1;
  const i = (BOOTH_CATEGORIES as readonly string[]).indexOf(c);
  return i === -1 ? BOOTH_CATEGORIES.length : i;
}

/**
 * Scans per stall, per category, for "no stall" and for the fair, from the
 * event's raw poster-hour cells. `booths` must be in the order to publish
 * (the handler reads them in the organizer's order); it is kept as given.
 */
export function boothCounts(
  booths: readonly BoothRef[],
  placements: readonly PlacementRef[],
  cells: readonly ScanCell[]
): BoothCounts {
  const boothIds = new Set(booths.map((b) => b.id));
  // A placement counts toward a stall only when that stall is one of this
  // event's (the handler reads both by the event). Anything else, including a
  // scan whose placement is not in the list, is "no stall".
  const stallOf = new Map<string, string>();
  let unstalled = 0;
  for (const p of placements) {
    if (p.booth_id !== null && boothIds.has(p.booth_id)) stallOf.set(p.id, p.booth_id);
    else unstalled++;
  }

  const partsOf = new Map<string, number[]>();
  const noStallParts: number[] = [];
  for (const c of cells) {
    const stall = stallOf.get(c.poster);
    if (stall === undefined) noStallParts.push(c.n);
    else {
      const list = partsOf.get(stall) ?? [];
      list.push(c.n);
      partsOf.set(stall, list);
    }
  }

  const rows: BoothCountRow[] = booths.map((b) => ({
    id: b.id,
    number: b.number,
    name: b.name,
    category: b.category,
    is_active: b.is_active,
    scans: floorTotalOfParts(partsOf.get(b.id) ?? []),
  }));
  const noStall = { placements: unstalled, scans: floorTotalOfParts(noStallParts) };

  const byCategory = new Map<string | null, BoothCountRow[]>();
  for (const r of rows) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const categories: CategoryCountRow[] = [...byCategory.entries()]
    .sort(
      ([a], [b]) => categoryRank(a) - categoryRank(b) || String(a ?? '').localeCompare(String(b))
    )
    .map(([category, members]) => ({
      category,
      booths: members.length,
      scans: floorTotalOfParts(members.map((m) => m.scans.count)),
    }));

  const total = floorTotalOfParts([...rows.map((r) => r.scans.count), noStall.scans.count]);
  const any_withheld =
    rows.some((r) => r.scans.suppressed) || (noStall.placements > 0 && noStall.scans.suppressed);

  return { booths: rows, categories, no_stall: noStall, total, any_withheld };
}
