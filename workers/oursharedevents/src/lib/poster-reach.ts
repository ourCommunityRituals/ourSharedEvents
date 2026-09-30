// ─── Poster reach: where the posters are working, and which links get tapped ──
//
// OSE-1357 poster tiers (2026-09-30). Three layers compose into one picture:
//
//   Tier 1  the CODES on the poster (lib/poster-codes.ts) — each a /s/ short
//           link whose only signal is a running `shortlinks.clicks` counter;
//   Tier 2  the PLACEMENTS (poster_deployments) — at the venue (an area of the
//           event's own location) or out in the community (a place with an
//           address), each with its own /q/ QR;
//   Tier 3  this module: the organizer's REACH picture — scans per placement,
//           split venue vs community, plus taps per code.
//
// NEVER WHO, ONLY HOW MANY (hard rules, gated by tests/poster-tiers.spec.ts and
// tests/e2e/0-architecture/aggregate-only.invariant.spec.ts):
//   - a physical scan resolves ONLY to the poster it came from
//     (scan_placement_events.poster_deployment_id) — the place is the
//     organizer-declared placement, never where a scanner stood;
//   - a digital tap is a COUNT per code with NO location at all — there are no
//     per-click rows to break down, and nothing here reads the request;
//   - no session/person data: scan_node_returns and FORMS_DB are never read.
//
// Audience: the ORGANIZER only (admin). Physical placement scans are exact —
// the same rule as /stats (a scan resolves to the organizer's own poster).
// Digital TAPS are floored at K=5 at the finest grain shown (PO, 2026-09-30):
// every per-code count, the group of small codes and the total all go through
// applyCountFloor (lib/count-floor.ts) — no local threshold here — and a lone
// small code is never left derivable by subtraction (total minus the shown
// codes): the smallest shown code joins it in "other links" (complementary
// suppression). The sponsor surface does not read this module.

import { applyCountFloor, type FlooredCount } from './count-floor';
import { posterCodeKind } from './poster-codes';

export const PLACEMENT_TYPES = ['venue', 'community'] as const;
export type PlacementType = (typeof PLACEMENT_TYPES)[number];

/**
 * Parse a client-sent placement type. `undefined` when absent (the caller
 * picks the default), `null` when present but not one of the two values.
 */
export function parsePlacementType(raw: unknown): PlacementType | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  return typeof raw === 'string' && (PLACEMENT_TYPES as readonly string[]).includes(raw)
    ? (raw as PlacementType)
    : null;
}

export interface ReachPlacement {
  id: string;
  label: string;
  description: string | null;
  address: string | null;
  active: boolean;
  scans: number;
}

export interface ReachGroup {
  /** Scans across every placement in the group. */
  scans: number;
  /** Distinct organizer-declared res-7 cells the group's placements cover. */
  places: number;
  /** Placements, most-scanned first (ties: label). */
  placements: ReachPlacement[];
}

export interface ReachCode {
  kind: string;
  word: string;
  /** Floored (K=5): only codes whose own count clears the floor are listed. */
  taps: FlooredCount;
}

export interface FlooredTaps {
  /** Codes whose tap count clears the floor, most first. */
  codes: ReachCode[];
  /** The codes NOT listed, together (never a lone code), floored; null if none. */
  other: { codes: number; taps: FlooredCount } | null;
  /** All taps, floored. */
  total: FlooredCount;
}

export interface PosterReach {
  venue: ReachGroup;
  community: ReachGroup;
  /** Short-link taps per code (a bare counter — no location, no time series), floored. */
  taps: FlooredTaps;
  /** Physical scans exact; digital taps floored. No combined sum (it would un-floor taps). */
  totals: { scans: number; taps: FlooredCount };
}

/**
 * Floor a set of per-code tap counts for display. Every number goes through
 * applyCountFloor; which codes are listed is decided by its `suppressed` flag.
 * If exactly one code would be hidden, the smallest listed code is hidden with
 * it, so "total minus the listed codes" never recovers one small count.
 * Pure; exported for tests.
 */
export function floorTaps(raw: { kind: string; taps: number }[]): FlooredTaps {
  const rows = raw
    .map((r) => ({ kind: String(r.kind), taps: Number(r.taps) || 0 }))
    .sort((a, b) => b.taps - a.taps || a.kind.localeCompare(b.kind));
  const listed = rows.filter((r) => !applyCountFloor(r.taps).suppressed);
  const hidden = rows.filter((r) => applyCountFloor(r.taps).suppressed);
  if (hidden.length === 1 && listed.length > 0) hidden.push(listed.pop()!);
  const sum = (xs: { taps: number }[]) => xs.reduce((t, x) => t + x.taps, 0);
  return {
    codes: listed.map((r) => ({
      kind: r.kind,
      word: posterCodeKind(r.kind).word,
      taps: applyCountFloor(r.taps),
    })),
    other: hidden.length ? { codes: hidden.length, taps: applyCountFloor(sum(hidden)) } : null,
    total: applyCountFloor(sum(rows)),
  };
}

interface PlacementRow {
  id: string;
  placement_label: string | null;
  location_desc: string | null;
  address: string | null;
  placement_type: string | null;
  h3_res7: string | null;
  is_active: number;
  scans: number;
}

function group(rows: PlacementRow[]): ReachGroup {
  const placements = rows
    .map((r) => ({
      id: String(r.id),
      label: String(r.placement_label ?? '').trim() || 'Poster',
      description: r.location_desc ? String(r.location_desc) : null,
      address: r.address ? String(r.address) : null,
      active: Number(r.is_active) === 1,
      scans: Number(r.scans) || 0,
    }))
    // A retired poster with no scans is noise; with scans it is history.
    .filter((p) => p.active || p.scans > 0)
    .sort((a, b) => b.scans - a.scans || a.label.localeCompare(b.label));
  const cells = new Set(
    rows.filter((r) => Number(r.is_active) === 1 && r.h3_res7).map((r) => String(r.h3_res7))
  );
  return {
    scans: placements.reduce((t, p) => t + p.scans, 0),
    places: cells.size,
    placements,
  };
}

/**
 * The organizer's reach picture for one event. Counts only. A failed
 * sub-query reads as empty rather than failing the card (same stance as
 * readPreEventActivity).
 */
export async function readPosterReach(db: D1Database, eventId: string): Promise<PosterReach> {
  let rows: PlacementRow[] = [];
  try {
    const res = await db
      .prepare(
        `SELECT pd.id, pd.placement_label, pd.location_desc, pd.address, pd.placement_type,
                pd.h3_res7, pd.is_active, COALESCE(s.scans, 0) AS scans
           FROM poster_deployments pd
           LEFT JOIN (SELECT poster_deployment_id, COUNT(*) AS scans
                        FROM scan_placement_events
                       WHERE event_id = ?
                       GROUP BY poster_deployment_id) s
             ON s.poster_deployment_id = pd.id
          WHERE pd.event_id = ?`
      )
      .bind(eventId, eventId)
      .all<PlacementRow>();
    rows = res.results ?? [];
  } catch {
    rows = [];
  }

  let tapRows: { kind: string; taps: number }[] = [];
  try {
    const res = await db
      .prepare(
        `SELECT COALESCE(NULLIF(kind, ''), 'public') AS kind, COALESCE(SUM(clicks), 0) AS taps
           FROM shortlinks
          WHERE event_id = ?
          GROUP BY COALESCE(NULLIF(kind, ''), 'public')`
      )
      .bind(eventId)
      .all<{ kind: string; taps: number }>();
    tapRows = res.results ?? [];
  } catch {
    tapRows = [];
  }

  const venue = group(rows.filter((r) => r.placement_type === 'venue'));
  const community = group(rows.filter((r) => r.placement_type !== 'venue'));
  const taps = floorTaps(tapRows);

  return {
    venue,
    community,
    taps,
    totals: { scans: venue.scans + community.scans, taps: taps.total },
  };
}
