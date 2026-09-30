/**
 * OSE-1420 — evidence required to take an event live.
 *
 * `qr_verified = 1` used to be an admin assertion: verify-qr checked only that
 * the READY → ACTIVE transition was legal, then wrote the flag. "QR verified"
 * promised a proof it never performed. This module is the proof, shared by
 * BOTH doors into `active` (verify-qr, and PUT status — including the
 * archived → active "Go live again" edge) so neither door can be the one that
 * forgot to ask.
 *
 * What counts as evidence: the event has a QR that resolves to it.
 *   - a `shortlinks` row (the digital poster's QR; OSE-240 mints one at
 *     creation, so an event WITHOUT one had its shortlink generation fail and
 *     its links 404 — exactly the event that must not be published), or
 *   - an active `poster_deployments` row (a physical poster with a scan token).
 *
 * Scans are REPORTED, not required: a scan needs a live event to land on a
 * form, so demanding one before go-live would deadlock the honest path. The
 * count is in the receipt so an organiser (and the SharedReport) can see
 * whether the poster has actually been scanned. Requiring an organiser
 * test-scan is a product call tracked as a follow-up on OSE-1420.
 *
 * Fail-closed: a count that cannot be read is 0, never "assume present".
 */

export interface GoLiveEvidence {
  /** Minted shortlinks for this event (digital poster QR). */
  shortlinks: number;
  /** Active physical poster deployments (scan tokens) for this event. */
  active_deployments: number;
  /** Physical scans recorded against this event's posters (informational). */
  scans: number;
}

export const GO_LIVE_DENIAL_CODE = 'NO_QR_EVIDENCE' as const;

async function countRows(db: D1Database, sql: string, eventId: string): Promise<number> {
  try {
    const row = await db.prepare(sql).bind(eventId).first<{ cnt: number }>();
    const n = row?.cnt;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function collectGoLiveEvidence(
  db: D1Database,
  eventId: string
): Promise<GoLiveEvidence> {
  const [shortlinks, activeDeployments, scans] = await Promise.all([
    countRows(db, 'SELECT COUNT(*) AS cnt FROM shortlinks WHERE event_id = ?', eventId),
    countRows(
      db,
      'SELECT COUNT(*) AS cnt FROM poster_deployments WHERE event_id = ? AND is_active = 1',
      eventId
    ),
    countRows(db, 'SELECT COUNT(*) AS cnt FROM scan_placement_events WHERE event_id = ?', eventId),
  ]);
  return { shortlinks, active_deployments: activeDeployments, scans };
}

/** True when at least one QR resolves to the event. */
export function hasGoLiveEvidence(evidence: GoLiveEvidence): boolean {
  return evidence.shortlinks > 0 || evidence.active_deployments > 0;
}

/**
 * The 409 body both doors return when evidence is missing. Same envelope shape
 * as INVALID_TRANSITION (ok/code/from/to) so the admin UI reads one shape; the
 * `error` is written for the organiser, not the log.
 */
export function goLiveDenial(from: string, evidence: GoLiveEvidence) {
  return {
    ok: false as const,
    code: GO_LIVE_DENIAL_CODE,
    from,
    to: 'active' as const,
    evidence,
    error:
      'This event has no working QR yet — no share link and no placed poster. ' +
      'Generate its share link or place a poster, then publish.',
  };
}
