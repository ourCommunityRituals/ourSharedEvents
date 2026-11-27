/**
 * The room's own vote code (OSE-2140, S3d of OSE-1193; OSE ADR-040 decision 6;
 * owner decision, 2026-11-18).
 *
 * WHY. S3b (OSE-2133) let `?type=vote` on ANY poster code of the event mint a
 * vote pass. Its security review (F1) found that wider than the risk the owner
 * accepted ("someone photographs the room's code"): a poster code's token can
 * be reached from a shared event-page link, through `&deployment=` and the
 * public poster bundle. So the room screen gets a code of its own.
 *
 * THE SHAPE. A vote code is a `poster_deployments` row marked `is_vote_code = 1`
 * (migration 0113), with a token of its own, made here and nowhere else. It is
 * a placement like any other, so `/q` records its scan and counts it once per
 * hour exactly as it does a poster's, and the vote pass keeps needing a stored
 * scan (decision 6). That is the smaller safe shape: a token kept on the vote
 * set instead would need a second scan path, or a placement anyway, to store
 * the scan the pass stands on.
 *
 * WHERE ITS TOKEN GOES. To the admin only: the Voting card shows the code's URL
 * and its QR (GET /api/v2/admin/events/:id/votables, `code`), and the host puts
 * it on the room screen. It is in no public answer:
 *   - the public poster bundle never resolves a vote code from `&deployment=`
 *     (handlers/poster-bundle.ts), so it answers as for no placement;
 *   - the admin poster list leaves it out (handlers/poster-deployments.ts), so
 *     it is never printed as a poster placement by mistake;
 *   - the event page reads no token at all.
 * The OSE display (the TV page and display-config) carries no vote word at all
 * (ADR-040 decision 7), so it does not show the code either. The room screen
 * is the admin vote screen (handlers/vote-screen.ts), signed in, which fetches
 * a freshly stamped URL on every reload. A copy of the URL taken anywhere else
 * (the Voting card, a print, a screenshot, another app) stops minting passes
 * within two minutes.
 *
 * IT ROTATES (2026-11-26). The URL shown carries a stamp for the current
 * minute (lib/vote-code-window.ts); `/q` mints a pass only for a fresh stamp.
 * The token itself stays the same all night, so the scan count per placement
 * is unchanged. The vote screen reloads every VOTE_SCREEN_RELOAD_SECONDS,
 * hidden or not, well inside the stamp's life.
 *
 * ONE PER EVENT. A partial unique index allows one vote code in use per event.
 * Making one when one is in use returns that one. A host who fears the code
 * was photographed replaces it from the Voting card (replaceVoteCode, POST
 * .../votables/code/replace): the old one is retired (is_active = 0, so its row
 * and scans stay and `/q` resolves it to nothing) and a new token is made, in
 * one batch. A retired vote code is never brought back: the placement edit
 * refuses `is_active` and `is_vote_code` on it (handlers/poster-deployments.ts).
 *
 * NO NUMBER. Nothing here reads a scan or a vote.
 */

import { generateQrCode } from './qr';
import { VOTE_CODE_TYPE } from './vote-pass';
import { voteCodeStamp } from './vote-code-window';

/**
 * What a view needs to stamp the URL for this minute (lib/vote-code-window.ts).
 * With no pepper the URL has no stamp, and `/q` mints no pass from it.
 */
export interface VoteCodeClock {
  pepper?: string;
  nowMs: number;
}

/** What the admin sees of the vote code: its placement id, its URL and a QR of it. */
export interface VoteCodeView {
  id: string;
  url: string;
  qr: string;
}

interface VoteCodeRow {
  id: string;
  qr_token: string;
}

/** The label a vote code's placement carries in the admin and in exports of placements. */
export const VOTE_CODE_LABEL = 'Vote code (room screen)';

/**
 * The URL a vote code's QR encodes: the placement's `/q` path, asking for a
 * pass, with this minute's stamp when there is one. Without the stamp `/q`
 * mints no pass (the rotating code, lib/vote-code-window.ts).
 */
export function voteCodeUrl(origin: string, qrToken: string, stamp?: string): string {
  const base = `${origin}/q/${encodeURIComponent(qrToken)}?type=${VOTE_CODE_TYPE}`;
  return stamp ? `${base}&w=${encodeURIComponent(stamp)}` : base;
}

async function readRow(db: D1Database, eventId: string): Promise<VoteCodeRow | null> {
  return db
    .prepare(
      `SELECT id, qr_token FROM poster_deployments
        WHERE event_id = ? AND is_vote_code = 1 AND is_active = 1
        LIMIT 1`
    )
    .bind(eventId)
    .first<VoteCodeRow>();
}

async function view(
  origin: string,
  row: VoteCodeRow,
  clock?: VoteCodeClock
): Promise<VoteCodeView> {
  const stamp = clock?.pepper
    ? await voteCodeStamp(clock.pepper, row.qr_token, clock.nowMs)
    : undefined;
  const url = voteCodeUrl(origin, row.qr_token, stamp);
  let qr = '';
  try {
    // Level L: the stamped URL runs past the 122 bytes a level-M QR holds on
    // a host as long as staging's; L holds 154. The code is shown on a screen,
    // not printed, so the lower error correction costs nothing in practice.
    qr = generateQrCode(url, { errorCorrection: 'L', scale: 4 });
  } catch {
    qr = '';
  }
  return { id: row.id, url, qr };
}

/** The event's vote code in use, or null. */
export async function readVoteCode(
  db: D1Database,
  eventId: string,
  origin: string,
  clock?: VoteCodeClock
): Promise<VoteCodeView | null> {
  const row = await readRow(db, eventId);
  return row ? view(origin, row, clock) : null;
}

const hex = (bytes: number) => {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

/** The INSERT of a new vote code, made only when none is in use. */
function insertCode(db: D1Database, eventId: string, id: string): D1PreparedStatement {
  const now = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO poster_deployments
         (id, event_id, qr_token, placement_label, placement_type, is_vote_code, is_active, created_at, updated_at)
       SELECT ?, ?, ?, ?, 'venue', 1, 1, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM poster_deployments
                           WHERE event_id = ? AND is_vote_code = 1 AND is_active = 1)`
    )
    .bind(id, eventId, `qrt_${hex(16)}`, VOTE_CODE_LABEL, now, now, eventId);
}

/**
 * Make the event's vote code, or return the one in use. `made` is true only
 * when this call made it. The token has 128 random bits (a poster's has 64):
 * it is the one code that leads to a vote.
 */
export async function makeVoteCode(
  db: D1Database,
  eventId: string,
  origin: string,
  clock?: VoteCodeClock
): Promise<{ made: boolean; code: VoteCodeView }> {
  const existing = await readRow(db, eventId);
  if (existing) return { made: false, code: await view(origin, existing, clock) };
  const id = `pd_${hex(8)}`;
  try {
    await insertCode(db, eventId, id).run();
  } catch (err) {
    // Two makes at once: the index let one through. Return that one.
    if (!/UNIQUE constraint failed/i.test(String(err))) throw err;
  }
  const row = await readRow(db, eventId);
  if (!row) throw new Error('vote code not readable after insert');
  return { made: row.id === id, code: await view(origin, row, clock) };
}

/**
 * Replace the event's vote code: retire the one in use and make a new token,
 * in one batch (one transaction), so the event is never left with two codes or
 * none. With no code in use it simply makes one. A photographed code stops
 * working at once: `/q` resolves only placements in use.
 */
export async function replaceVoteCode(
  db: D1Database,
  eventId: string,
  origin: string,
  clock?: VoteCodeClock
): Promise<VoteCodeView> {
  const id = `pd_${hex(8)}`;
  await db.batch([
    db
      .prepare(
        `UPDATE poster_deployments SET is_active = 0, updated_at = ?
          WHERE event_id = ? AND is_vote_code = 1 AND is_active = 1`
      )
      .bind(new Date().toISOString(), eventId),
    insertCode(db, eventId, id),
  ]);
  const row = await readRow(db, eventId);
  if (!row || row.id !== id) throw new Error('vote code not replaced');
  return view(origin, row, clock);
}
