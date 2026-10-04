// ─── The map defaults to off; an organizer-added sponsor turns it on ───────────
//
// OSE-1560 (PO decisions, 2026-10-03). A new event is OFF the map. Nothing is
// listed publicly because someone did not decide: the default-on map was the
// risk (a home event listed by omission).
//
// The one exception, by design: when the ORGANIZER adds or approves a sponsor on
// the event, the map setting turns on, and only if the organizer has not chosen
// the map value themselves. A sponsor's own request never changes it.
//
// ── Where "has the organizer chosen?" lives ───────────────────────────────────
//
// A server-managed marker in `events.settings_json`: `mapDefault: true`.
//   - written when an event is created with no map choice;
//   - removed by any explicit map write (POST/PUT `is_published`), and by the flip;
//   - never client-writable (`validateSettingsPatch` rejects the key).
// It is a POSITIVE marker on purpose. Every event that existed before this
// change has no marker, so it reads as "the organizer's value", and an old
// explicit "off" can never be flipped by a later sponsor. A nullable "chosen"
// column would have read those rows as "not chosen". settings_json also needs no
// migration, so it cannot collide with another open PR's migration number.
//
// ── What the flip does, and does not do ───────────────────────────────────────
//
// It sets `is_published = 1`. It does NOT list the event: the publish grace
// window still applies (listedSql), because on a live event it starts a fresh
// window, exactly like the organizer turning the map on by hand. It writes no
// coordinate and reads none; mapping still needs the event's own cell.
//
// The flip is ONE conditional UPDATE, brand-bound through the sponsor row, so a
// concurrent explicit write (which removes the marker in its own UPDATE) wins and
// a mismatched-brand sponsor changes nothing. Removing the last sponsor does not
// turn the map back off (PO decision proposal, recorded on the ticket).

import { clearMapDefaultSql, mapStillDefaultSql } from './event-settings';
import { listedFromForPublish } from './publish-grace';
import { logAdminAction, type AuditLogEnv } from './audit-log';

/** The neutral heads-up copy the admin shows. The toast component is OSE-1564. */
export const MAP_OFF_NOTE = "This event isn't on the map. You can turn that on any time.";
export const MAP_ON_BY_SPONSOR_NOTE = 'This event is now on the map because it has a sponsor.';

/** Did the request carry an explicit map choice (a real boolean or 0/1)? */
export function explicitMapChoice(v: unknown): boolean | null {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  return null;
}

export interface MapState {
  on: boolean;
  /** True while the setting is still the default (the organizer has not chosen). */
  by_default: boolean;
  /** The heads-up to show, or null when there is nothing to say. */
  note: string | null;
}

/** The `map` block in the create / update response. */
export function mapState(on: boolean, byDefault: boolean): MapState {
  return { on, by_default: byDefault, note: byDefault && !on ? MAP_OFF_NOTE : null };
}

/** The `map` block in a placement response when the flip fired. */
export interface MapFlipNote {
  changed: true;
  on: true;
  reason: 'sponsor';
  note: string;
}

export const MAP_FLIP_NOTE: MapFlipNote = {
  changed: true,
  on: true,
  reason: 'sponsor',
  note: MAP_ON_BY_SPONSOR_NOTE,
};

/**
 * The flip, as one prepared statement (so a caller can put it in a batch right
 * after the placement write). It changes a row only when ALL hold:
 *   - the event is off and its map setting is still the default;
 *   - an active, organizer-accepted placement of `sponsorId` is on the event;
 *   - that sponsor and the event are in the same brand.
 * On a live event it starts a fresh grace window; otherwise listed_from is left.
 */
export function mapFlipStatement(
  db: D1Database,
  a: { eventId: string; sponsorId: string; graceMinutes: string | undefined; now?: Date }
): D1PreparedStatement {
  const now = a.now ?? new Date();
  return db
    .prepare(
      `UPDATE events
          SET is_published = 1,
              settings_json = ${clearMapDefaultSql()},
              listed_from = CASE WHEN status = 'active' THEN ? ELSE listed_from END,
              updated_at = ?
        WHERE id = ? AND is_published = 0 AND ${mapStillDefaultSql()}
          AND EXISTS (
            SELECT 1 FROM sponsor_placement sp
              JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
             WHERE sp.event_id = events.id AND sp.sponsor_business_id = ?
               AND sp.is_active = 1 AND COALESCE(sp.organizer_accepted, 1) = 1
               AND sb.brand_id = events.brand_id
          )`
    )
    .bind(listedFromForPublish(a.graceMinutes, now), now.toISOString(), a.eventId, a.sponsorId);
}

/** True when a flip statement's result says it changed a row. */
export function flipFired(result: { meta?: { changes?: number } } | undefined): boolean {
  return (result?.meta?.changes ?? 0) > 0;
}

/** Audit the flip. The row carries no coordinates, no place, no sponsor details. */
export async function auditMapFlip(
  env: AuditLogEnv,
  a: {
    actor: string | null;
    requestId: string;
    eventId: string;
    via: 'organizer_add' | 'request_approved';
    sponsorId: string;
  }
): Promise<void> {
  await logAdminAction(env, {
    action: 'MAP_ON_BY_SPONSOR',
    actor: a.actor,
    resource_type: 'event',
    resource_id: a.eventId,
    request_id: a.requestId,
    outcome: 'success',
    details: { via: a.via, sponsor_id: a.sponsorId, was_default: true },
  });
}
