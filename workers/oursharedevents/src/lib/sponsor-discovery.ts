// ─── Sponsor discovery — a sponsor asks to back an event ───────────────────────
//
// TRIANGLE screen map, next slice #2 ("Sponsor discovery: a sponsor browsing
// events they could back — the invite flow exists; a browse-and-ask flow does
// not"). The organizer → sponsor direction already works (add sponsor → mint
// /sponsor link → sponsor accepts). This is the sponsor → organizer direction.
//
// CONSENT (ADR-019, "silence ≠ consent", multi-sided explicit opt-in):
//   A request is a sponsor_placement row with
//     source = 'sponsor_request', sponsor_accepted = 1   ← the sponsor's yes
//     is_active = 0,  organizer_accepted = NULL           ← switched OFF
//   Every public resolver reads only `sp.is_active = 1` placements, so a
//   request renders NOWHERE until the organizer approves it — which sets
//   is_active = 1 and organizer_accepted = 1. Both corners have then said yes,
//   explicitly, on this one record. An organizer decline sets
//   organizer_accepted = 0 and leaves it off. The organizer-side
//   "COALESCE(organizer_accepted, 1)" permissiveness in ADR-019 exists because
//   the organizer CREATED those placements; a request is not organizer-created,
//   which is exactly why it is born switched off rather than relying on it.
//
// SCOPE (#9 tenant isolation): everything is keyed to the brand in the SIGNED
// sponsor-home claim. A sponsor sees and can ask for only its own brand's
// events — published (`is_published = 1`), active, and not over — which is
// exactly what /events already lists publicly. Nothing here is about
// attendees; tier never enters (Invariant #5).
//
// LIMITS: MAX_OPEN_REQUESTS waiting requests per sponsor at a time (a request
// is a message to a person, so it must not be spammable), and the endpoint is
// rate-limited at the router like the other public sponsor writes.

import { maybeTag } from './h3-tagging';

/** Waiting (organizer has not answered) requests one sponsor may hold at once. */
export const MAX_OPEN_REQUESTS = 5;

/** Events shown in "Events you could back". */
export const MAX_DISCOVERABLE = 20;

export const SPONSOR_REQUEST_SOURCE = 'sponsor_request';

export interface DiscoverableEvent {
  id: string;
  title: string;
  start_date: string | null;
  location: string | null;
  /** 1 when the event is in the sponsor's own corridor cell (H3 res-7). */
  near: number;
}

export interface SponsorRequestRow {
  placement_id: string;
  event_id: string;
  title: string;
  start_date: string | null;
  organizer_accepted: number | null;
}

/** "Today somewhere" — same floor as the admin "Soonest first" list. */
function floorDate(now: Date): string {
  return new Date(now.getTime() - 12 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The shared predicate for "an event this sponsor may ask to back": same brand
 * as the claim, listed, active, dated today-or-later, and no placement of any
 * kind (offered, requested, declined) already linking this sponsor to it.
 * Used by BOTH the list and the request write, so the button can never offer
 * an event the write would refuse, or the reverse. The brand clause is written
 * literally in each query (`e.brand_id = ? AND ${DISCOVERABLE_REST}`) so the
 * Invariant #9 structural gate can see it.
 */
const DISCOVERABLE_REST = `e.is_published = 1
          AND e.status = 'active'
          AND e.start_date IS NOT NULL AND e.start_date >= ?
          AND NOT EXISTS (
            SELECT 1 FROM sponsor_placement px
             WHERE px.event_id = e.id AND px.sponsor_business_id = ?
          )`;

export async function readDiscoverableEvents(
  db: D1Database,
  sponsor: { id: string; brand_id: string; h3_res7: string | null },
  now: Date = new Date()
): Promise<DiscoverableEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.title, e.start_date, e.location,
              CASE WHEN ? IS NOT NULL AND e.h3_res7 = ? THEN 1 ELSE 0 END AS near
         FROM events e
        WHERE e.brand_id = ? AND ${DISCOVERABLE_REST}
        ORDER BY e.start_date ASC, e.id ASC
        LIMIT ?`
    )
    .bind(
      sponsor.h3_res7,
      sponsor.h3_res7,
      sponsor.brand_id,
      floorDate(now),
      sponsor.id,
      MAX_DISCOVERABLE
    )
    .all<DiscoverableEvent>();
  return results ?? [];
}

export async function readSponsorRequests(
  db: D1Database,
  sponsor: { id: string; brand_id: string }
): Promise<SponsorRequestRow[]> {
  const { results } = await db
    .prepare(
      `SELECT sp.id AS placement_id, sp.event_id, e.title, e.start_date, sp.organizer_accepted
         FROM sponsor_placement sp
         JOIN events e ON e.id = sp.event_id
        WHERE sp.sponsor_business_id = ? AND e.brand_id = ?
          AND sp.source = ? AND sp.is_active = 0
        ORDER BY sp.created_at DESC
        LIMIT 50`
    )
    .bind(sponsor.id, sponsor.brand_id, SPONSOR_REQUEST_SOURCE)
    .all<SponsorRequestRow>();
  return results ?? [];
}

export type RequestOutcome =
  | { ok: true; placement_id: string; event_id: string }
  | { ok: false; code: 'NOT_DISCOVERABLE' | 'TOO_MANY_OPEN' | 'ALREADY_LINKED' };

/**
 * Record a sponsor's request to back an event. The caller has already verified
 * the sponsor-home token and loaded the (active, in-brand) sponsor row.
 */
export async function createSponsorRequest(
  db: D1Database,
  sponsor: {
    id: string;
    brand_id: string;
    tier: string | null;
    lat: number | null;
    lon: number | null;
  },
  eventId: string,
  placementId: string,
  now: Date = new Date()
): Promise<RequestOutcome> {
  const open = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM sponsor_placement
        WHERE sponsor_business_id = ? AND source = ? AND is_active = 0
          AND organizer_accepted IS NULL`
    )
    .bind(sponsor.id, SPONSOR_REQUEST_SOURCE)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS) return { ok: false, code: 'TOO_MANY_OPEN' };

  const ev = await db
    .prepare(
      `SELECT e.id, e.h3_res7 FROM events e WHERE e.id = ? AND e.brand_id = ? AND ${DISCOVERABLE_REST}`
    )
    .bind(eventId, sponsor.brand_id, floorDate(now), sponsor.id)
    .first<{ id: string; h3_res7: string | null }>();
  if (!ev) return { ok: false, code: 'NOT_DISCOVERABLE' };

  const sponsorCell =
    typeof sponsor.lat === 'number' && typeof sponsor.lon === 'number'
      ? (maybeTag(sponsor.lat, sponsor.lon)?.h3_res7 ?? null)
      : null;
  const local = sponsorCell !== null && sponsorCell === ev.h3_res7 ? 1 : 0;
  const stamp = now.toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO sponsor_placement
           (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
            is_active, organizer_accepted, sponsor_accepted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, 0, NULL, 1, ?, ?)`
      )
      .bind(
        placementId,
        sponsor.id,
        ev.id,
        sponsor.tier || 'standard',
        SPONSOR_REQUEST_SOURCE,
        local,
        stamp,
        stamp
      )
      .run();
  } catch (err) {
    // UNIQUE(sponsor_business_id, event_id): a concurrent request won the race.
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      return { ok: false, code: 'ALREADY_LINKED' };
    }
    throw err;
  }
  return { ok: true, placement_id: placementId, event_id: ev.id };
}

export type OrganizerAnswer =
  | { ok: true; event_id: string; approved: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_ANSWERED' };

/**
 * The organizer's answer to a waiting request. `brandIds` is the caller's
 * resolved admin scope (null = unscoped operator); a request outside it is
 * NOT_FOUND, never FORBIDDEN (no enumeration oracle).
 */
export async function answerSponsorRequest(
  db: D1Database,
  placementId: string,
  approve: boolean,
  brandIds: readonly string[] | null
): Promise<OrganizerAnswer> {
  const scopeSql = brandIds ? ` AND e.brand_id IN (${brandIds.map(() => '?').join(', ')})` : '';
  const row = await db
    .prepare(
      `SELECT sp.id, sp.event_id, sp.is_active, sp.organizer_accepted
         FROM sponsor_placement sp JOIN events e ON e.id = sp.event_id
        WHERE sp.id = ? AND sp.source = ?${scopeSql}`
    )
    .bind(placementId, SPONSOR_REQUEST_SOURCE, ...(brandIds ?? []))
    .first<{
      id: string;
      event_id: string;
      is_active: number;
      organizer_accepted: number | null;
    }>();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.organizer_accepted !== null || Number(row.is_active) !== 0) {
    return { ok: false, code: 'ALREADY_ANSWERED' };
  }
  const res = await db
    .prepare(
      `UPDATE sponsor_placement
          SET organizer_accepted = ?, is_active = ?, updated_at = datetime('now')
        WHERE id = ? AND source = ? AND is_active = 0 AND organizer_accepted IS NULL`
    )
    .bind(approve ? 1 : 0, approve ? 1 : 0, placementId, SPONSOR_REQUEST_SOURCE)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return { ok: false, code: 'ALREADY_ANSWERED' };
  return { ok: true, event_id: row.event_id, approved: approve };
}
