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
// events — published (`is_published = 1`), active, not over, and opted in to
// sponsors (OSE-1900, `useSponsors`; the gate is in lib/sponsor-card.ts). Nothing here is about
// attendees; tier never enters (Invariant #5).
//
// LIMITS: MAX_OPEN_REQUESTS waiting requests per sponsor at a time (a request
// is a message to a person, so it must not be spammable), and the endpoint is
// rate-limited at the router like the other public sponsor writes.

import { maybeTag } from './h3-tagging';
import { toPublicEvent } from './public-event-projection';
import { listedSql } from './publish-grace';
import { flipFired, mapFlipStatement } from './map-default';
import { eventUsesSponsorsSql } from './sponsor-card';

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
 * as the claim, listed, active, dated today-or-later, opted in to sponsors
 * (OSE-1900: an event that did not choose sponsors is never offered and cannot
 * be asked), and no placement of any kind (offered, requested, declined)
 * already linking this sponsor to it.
 * Used by BOTH the list and the request write, so the button can never offer
 * an event the write would refuse, or the reverse. The brand clause is written
 * literally in each query (`e.brand_id = ? AND ${DISCOVERABLE_REST}`) so the
 * Invariant #9 structural gate can see it.
 */
const DISCOVERABLE_REST = `e.is_published = 1
          AND e.status = 'active' AND ${listedSql('e')}
          AND ${eventUsesSponsorsSql('e')}
          AND e.start_date IS NOT NULL AND e.start_date >= ?
          AND NOT EXISTS (
            SELECT 1 FROM sponsor_placement px
             WHERE px.event_id = e.id AND px.sponsor_business_id = ?
          )`;

/**
 * Every event field this module shows a sponsor passes through the public event
 * projection (lib/public-event-projection) first — the same allowlist as
 * `GET /api/v2/events` and the public event page. So a location-precision
 * policy that narrows what the public sees (OSE-1245, e.g. hiding a home
 * address) narrows the sponsor page with it, with no second place to change.
 * "Near you" is computed from the PROJECTED h3_res7: if the public projection
 * ever stops carrying the cell, the chip disappears rather than leaking it.
 */
export function toDiscoverable(
  row: Record<string, unknown>,
  sponsorCell: string | null
): DiscoverableEvent {
  const pub = toPublicEvent(row);
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  const cell = str(pub.h3_res7);
  return {
    id: String(pub.id ?? ''),
    title: str(pub.title) ?? 'Untitled event',
    start_date: str(pub.start_date),
    location: str(pub.location),
    near: sponsorCell !== null && cell !== null && cell === sponsorCell ? 1 : 0,
  };
}

export async function readDiscoverableEvents(
  db: D1Database,
  sponsor: { id: string; brand_id: string; h3_res7: string | null },
  now: Date = new Date()
): Promise<DiscoverableEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.title, e.start_date, e.location, e.h3_res7
         FROM events e
        WHERE e.brand_id = ? AND ${DISCOVERABLE_REST}
        ORDER BY e.start_date ASC, e.id ASC
        LIMIT ?`
    )
    .bind(sponsor.brand_id, floorDate(now), sponsor.id, MAX_DISCOVERABLE)
    .all<Record<string, unknown>>();
  return (results ?? []).map((r) => toDiscoverable(r, sponsor.h3_res7));
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
          AND e.is_published = 1 AND e.status = 'active'
        ORDER BY sp.created_at DESC
        LIMIT 50`
    )
    .bind(sponsor.id, sponsor.brand_id, SPONSOR_REQUEST_SOURCE)
    .all<SponsorRequestRow>();
  // The event half of each row goes through the public projection too.
  return (results ?? []).map((r) => {
    const pub = toPublicEvent({ title: r.title, start_date: r.start_date });
    return {
      ...r,
      title: typeof pub.title === 'string' ? pub.title : 'Untitled event',
      start_date: typeof pub.start_date === 'string' ? pub.start_date : null,
    };
  });
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
          AND organizer_accepted IS NULL
          AND EXISTS (
              SELECT 1 FROM events le WHERE le.id = sponsor_placement.event_id
                 AND le.brand_id = ? AND le.is_published = 1 AND le.status = 'active' AND le.start_date >= ?
            )`
    )
    .bind(sponsor.id, SPONSOR_REQUEST_SOURCE, sponsor.brand_id, floorDate(now))
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
  let inserted = 0;
  try {
    // The cap is re-checked INSIDE the insert (INSERT … SELECT … WHERE count < cap)
    // so two concurrent asks cannot both pass the pre-check above and exceed it.
    // OSE-1900: the event's own yes is asked again in the same statement, so an
    // organizer turning sponsors off between the check above and this write
    // leaves no request on an event that no longer wants sponsors.
    const res = await db
      .prepare(
        `INSERT INTO sponsor_placement
           (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
            is_active, organizer_accepted, sponsor_accepted, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, 1, ?, 0, NULL, 1, ?, ?
          WHERE (SELECT COUNT(*) FROM sponsor_placement
                  WHERE sponsor_business_id = ? AND source = ? AND is_active = 0
                    AND organizer_accepted IS NULL
                    AND EXISTS (
              SELECT 1 FROM events le WHERE le.id = sponsor_placement.event_id
                 AND le.brand_id = ? AND le.is_published = 1 AND le.status = 'active' AND le.start_date >= ?
            )) < ?
            AND EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND ${eventUsesSponsorsSql('e')})`
      )
      .bind(
        placementId,
        sponsor.id,
        ev.id,
        // Same fallback as the organizer's attach ('primary' is a VALID_TIERS value).
        sponsor.tier || 'primary',
        SPONSOR_REQUEST_SOURCE,
        local,
        stamp,
        stamp,
        sponsor.id,
        SPONSOR_REQUEST_SOURCE,
        sponsor.brand_id,
        floorDate(now),
        MAX_OPEN_REQUESTS,
        ev.id
      )
      .run();
    inserted = res.meta?.changes ?? 0;
  } catch (err) {
    // UNIQUE(sponsor_business_id, event_id): a concurrent request won the race.
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      return { ok: false, code: 'ALREADY_LINKED' };
    }
    throw err;
  }
  if (inserted === 0) {
    // Nothing was written: either the cap was reached, or the event stopped
    // taking sponsors in between. The second answers like any event a sponsor
    // cannot ask, so the two refusals stay what they are everywhere else.
    const still = await db
      .prepare(`SELECT ${eventUsesSponsorsSql('e')} AS uses_sponsors FROM events e WHERE e.id = ?`)
      .bind(ev.id)
      .first<{ uses_sponsors: number | null }>();
    if (Number(still?.uses_sponsors) !== 1) return { ok: false, code: 'NOT_DISCOVERABLE' };
    return { ok: false, code: 'TOO_MANY_OPEN' };
  }
  return { ok: true, placement_id: placementId, event_id: ev.id };
}

export type OrganizerAnswer =
  | {
      ok: true;
      event_id: string;
      approved: boolean;
      sponsor_id: string;
      /** OSE-1560: this approval turned the event's default map on. */
      map_flipped: boolean;
    }
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
  brandIds: readonly string[] | null,
  graceMinutes?: string
): Promise<OrganizerAnswer> {
  const scopeSql = brandIds ? ` AND e.brand_id IN (${brandIds.map(() => '?').join(', ')})` : '';
  const row = await db
    .prepare(
      `SELECT sp.id, sp.event_id, sp.sponsor_business_id, sp.is_active, sp.organizer_accepted
         FROM sponsor_placement sp JOIN events e ON e.id = sp.event_id
        WHERE sp.id = ? AND sp.source = ?${scopeSql}`
    )
    .bind(placementId, SPONSOR_REQUEST_SOURCE, ...(brandIds ?? []))
    .first<{
      id: string;
      event_id: string;
      sponsor_business_id: string;
      is_active: number;
      organizer_accepted: number | null;
    }>();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  // Waiting → approve or decline. Declined → approve only (an organizer can
  // change their mind; the sponsor's yes is still on record). Approved → it is
  // an ordinary placement now; the sponsors card's Deactivate handles it.
  const waiting = row.organizer_accepted === null && Number(row.is_active) === 0;
  const declined = row.organizer_accepted === 0 && Number(row.is_active) === 0;
  if (!(waiting || (declined && approve))) return { ok: false, code: 'ALREADY_ANSWERED' };
  const res = await db
    .prepare(
      `UPDATE sponsor_placement
          SET organizer_accepted = ?, is_active = ?, updated_at = datetime('now')
        WHERE id = ? AND source = ? AND is_active = 0
          AND (organizer_accepted IS NULL OR (organizer_accepted = 0 AND ? = 1))`
    )
    .bind(approve ? 1 : 0, approve ? 1 : 0, placementId, SPONSOR_REQUEST_SOURCE, approve ? 1 : 0)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return { ok: false, code: 'ALREADY_ANSWERED' };
  // OSE-1560: the organizer approving a sponsor turns the default map on (lib/map-default.ts).
  // A decline never does, and the sponsor's own request never reaches here.
  let mapFlipped = false;
  if (approve) {
    const flip = await mapFlipStatement(db, {
      eventId: row.event_id,
      sponsorId: row.sponsor_business_id,
      graceMinutes,
    }).run();
    mapFlipped = flipFired(flip);
  }
  return {
    ok: true,
    event_id: row.event_id,
    approved: approve,
    sponsor_id: row.sponsor_business_id,
    map_flipped: mapFlipped,
  };
}
