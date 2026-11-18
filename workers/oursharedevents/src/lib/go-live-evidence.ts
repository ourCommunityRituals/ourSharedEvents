/**
 * OSE-1420: an event goes live only when one of its codes works.
 *
 * `qr_verified = 1` used to be written on an admin's say-so: verify-qr and PUT
 * status checked that the move was legal, then wrote the flag, and read no
 * code. This module is the read. Both doors a person can use to move an event
 * into `active` call `requireGoLiveEvidence` before they write:
 *   - verify-qr (ready → active), handlers/qr-verify.ts;
 *   - PUT status with `active` (ready → active, archived → active),
 *     handlers/events.ts.
 *
 * Evidence is at least one working code, by the one rule in
 * lib/code-validity.ts: a share link the resolver accepts, or a placed poster
 * that is switched on and whose token the scan route accepts. Event creation mints the share link, so an event
 * without one is the event whose link was never made, and whose printed QR
 * would open nothing.
 *
 * Three things this module is careful about (OSE-1426):
 *   - A row that fails the rule is not counted, however many there are.
 *   - A read that fails is not "no code". It is thrown to the caller as
 *     `unavailable`, answered 503 and logged; the organizer is never told
 *     their event has no code because the database did not answer.
 *   - Scans are not read and not returned. They did not decide anything, and
 *     a scan count is a count of people's actions (AGENTS.md invariant 2). The
 *     receipt counts links and posters, which are things, so it is exact.
 *
 * Not covered here: creating an event already live. Only automation can do
 * that (handleCreateEvent), and the link is minted after the row is written.
 */

import {
  isWorkingPoster,
  isWorkingShareLink,
  type PosterRow,
  type ShareLinkRow,
} from './code-validity';
import { errorLabel } from './error-label';

/** How many of the event's codes work. Counts of things, not of people. */
export interface GoLiveEvidence {
  /** Share links (`/s/:code`) that pass `isWorkingShareLink`. */
  shortlinks: number;
  /** Placed posters (`/q/:token`) that pass `isWorkingPoster`. */
  active_deployments: number;
}

export const NO_QR_EVIDENCE = 'NO_QR_EVIDENCE' as const;
export const EVIDENCE_UNAVAILABLE = 'EVIDENCE_UNAVAILABLE' as const;

/** Which door asked: `PUT /admin/events/:id` with `status`, or verify-qr. */
export type GoLiveDoor = 'put_status' | 'verify_qr';

/** The rows of one read, or a throw. A reply with no row list is a failed read. */
async function readRows<T>(db: D1Database, sql: string, eventId: string): Promise<T[]> {
  const reply = await db.prepare(sql).bind(eventId).all<T>();
  if (!reply || !Array.isArray(reply.results)) {
    throw new TypeError('evidence read returned no row list');
  }
  return reply.results;
}

/**
 * Read the event's codes and count the ones that work. Throws when either read
 * fails: the caller must not go on with half an answer.
 */
export async function collectGoLiveEvidence(
  db: D1Database,
  eventId: string
): Promise<GoLiveEvidence> {
  const [links, posters] = await Promise.all([
    readRows<ShareLinkRow>(
      db,
      'SELECT code, target_url FROM shortlinks WHERE event_id = ?',
      eventId
    ),
    readRows<PosterRow>(
      db,
      'SELECT qr_token, is_active FROM poster_deployments WHERE event_id = ?',
      eventId
    ),
  ]);
  return {
    shortlinks: links.filter(isWorkingShareLink).length,
    active_deployments: posters.filter(isWorkingPoster).length,
  };
}

/** True when at least one code works. */
export function hasGoLiveEvidence(evidence: GoLiveEvidence): boolean {
  return evidence.shortlinks > 0 || evidence.active_deployments > 0;
}

export type GoLiveDecision =
  | { outcome: 'allowed'; evidence: GoLiveEvidence }
  | { outcome: 'refused'; evidence: GoLiveEvidence }
  | { outcome: 'unavailable' };

/**
 * The one question both doors ask before they write `active`.
 *
 * `refused` and `unavailable` each write one structured line. Neither line
 * names the event, its title or the actor: the door and the move are enough to
 * count refusals, and the request's audit row holds the rest.
 */
export async function requireGoLiveEvidence(
  db: D1Database,
  eventId: string,
  door: GoLiveDoor,
  from: string
): Promise<GoLiveDecision> {
  let evidence: GoLiveEvidence;
  try {
    evidence = await collectGoLiveEvidence(db, eventId);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'goLiveEvidence',
        door,
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return { outcome: 'unavailable' };
  }
  if (hasGoLiveEvidence(evidence)) return { outcome: 'allowed', evidence };
  console.log(
    JSON.stringify({
      type: 'LIFECYCLE',
      event: 'go_live_refused',
      door,
      from,
      to: 'active',
    })
  );
  return { outcome: 'refused', evidence };
}

/** The 409 body both doors return when no code works. Written for the organizer. */
export function goLiveRefusal(from: string, evidence: GoLiveEvidence) {
  return {
    ok: false as const,
    code: NO_QR_EVIDENCE,
    from,
    to: 'active' as const,
    evidence,
    error:
      'This event has no working link or poster code yet, so it cannot go live. ' +
      'Open "Codes on the poster" to create its link, or place a poster, then try again.',
  };
}

/** The 503 body both doors return when the codes could not be read. */
export function evidenceUnavailable() {
  return {
    ok: false as const,
    code: EVIDENCE_UNAVAILABLE,
    error:
      "This event's links and posters could not be checked just now. " +
      'Nothing was changed. Try again in a moment.',
  };
}
