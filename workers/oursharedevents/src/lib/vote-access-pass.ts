/**
 * The Access Pass (OSE ADR-040 decision 13; owner, 2026-11-26; the proposal in
 * OCR-docs PR #200): a small, capped, logged way for someone who cannot be in
 * the room to vote in the Room Pick.
 *
 * FROM THE VOTER'S SIDE FIRST. A voter asks the host any way they like and
 * never gives a reason. Nothing here asks for one, stores one, or has a place
 * to type one: the table (migration 0123) has no name, note, reason or
 * recipient column. The pass opens the same voter page as the room's code,
 * with the same buttons, and the vote is a normal Room Pick vote with the same
 * weight. The word is "Access Pass".
 *
 * A PASS IS A TOKEN, NOT A PERSON.
 *   - The token is 256 random bits (base64url, 43 characters). It is shown to
 *     the host once, inside a link whose token rides in the fragment
 *     (`/access#<token>`), so it is in no request line, no Referer and no
 *     request log. It is never stored.
 *   - The row keeps `lookup` = HMAC(K_access_lookup, token), under a
 *     server-only subkey of ANON_ID_HASH_PEPPER with its own HKDF label. A copy
 *     of the database cannot vote, and cannot test a guessed token offline.
 *   - The voter key is HMAC(K_access_voter, token ‖ event_id)
 *     (lib/vote-pass.ts, accessVoterKey): the same token is always the same
 *     voter at that event. Sharing a pass gives no extra votes.
 *
 * THE CAP COUNTS EVERY PASS EVER GIVEN FOR THE SET, revoked ones included
 * (red-team finding RT-AP-03). A vote cast with a pass stays after a revoke
 * (a receipt has no side and is not linked to the pass), so a cap on live
 * passes alone would let a host give, vote, revoke and give again without end.
 * At most ACCESS_PASS_CAP for a set, checked inside the INSERT, so two gives
 * at once cannot both slip under it. The cap is a platform constant: no host,
 * skin, sponsor or tier setting reads or writes it.
 *
 * WHY 4. The smallest secret margin T is 5 (decision 7), so passes alone can
 * never make a winner out of a tie. They can help a close lead across, the
 * same as four people walking in.
 *
 * WHO. Only an event admin of the brand: every route is under
 * /api/v2/admin/events/:id, so guardAdminObjectScope proves the brand and the
 * admin write guard checks the write. A sponsor has no admin route. Each give
 * and revoke is in the admin audit log with the admin's identity and the hour,
 * never the recipient.
 *
 * NEVER PUBLISHED. No public answer carries a count of passes, and a pass's
 * vote is not marked anywhere: not in the tally, the receipt, the participant
 * marker or the result. The admin's own list shows the host the passes they
 * gave (they know that already), never whether one was used.
 *
 * AT FINAL every row of the set is deleted (deleteAccessPassesOfFinalSet),
 * with the receipts.
 */

import { EVENT_LIVE } from './event-live';
import { mintAccessVotePass } from './vote-pass';
import { votingEnabled, type VotingSwitchEnv } from './voting-switch';

/** At most this many passes, ever, per vote set. Below the smallest margin T = 5. */
export const ACCESS_PASS_CAP = 4;

/** HKDF `info` for the stored lookup. Its own; never imported from another file. */
const ACCESS_LOOKUP_LABEL = 'ose:vote:access-lookup:v1';
const HKDF_SALT = new TextEncoder().encode('oursharedevents:vote-access');

/** A token: 32 random bytes, base64url, no padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ACCESS_ID = /^vap_[0-9a-f]{32}$/;

/** The page that redeems a pass. The token rides in its fragment only. */
export const ACCESS_PAGE_PATH = '/access';

export type AccessFail = { ok: false; status: number; code: string; error: string };
export type AccessResult<T> = { ok: true; value: T } | AccessFail;

const fail = (status: number, code: string, error: string): AccessFail => ({
  ok: false,
  status,
  code,
  error,
});

export const ACCESS_NO_SET = fail(404, 'VOTE_SET_NOT_FOUND', 'This event has no vote set');
export const ACCESS_CAP_REACHED = fail(
  409,
  'ACCESS_PASS_LIMIT',
  `A vote can have at most ${ACCESS_PASS_CAP} Access Passes`
);
export const ACCESS_SET_DONE = fail(
  409,
  'VOTE_SET_FINAL',
  'This vote is over; no Access Pass can be given for it'
);
export const ACCESS_NOT_FOUND = fail(404, 'ACCESS_PASS_NOT_FOUND', 'Access Pass not found');

let lookupKey: { pepper: string; key: Promise<CryptoKey> } | null = null;

function lookupKeyFor(pepper: string): Promise<CryptoKey> {
  if (lookupKey && lookupKey.pepper === pepper) return lookupKey.key;
  const key = (async () => {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pepper),
      'HKDF',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: HKDF_SALT,
        info: new TextEncoder().encode(ACCESS_LOOKUP_LABEL),
      },
      material,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign']
    );
  })();
  lookupKey = { pepper, key };
  key.catch(() => {
    if (lookupKey?.key === key) lookupKey = null;
  });
  return key;
}

/** True for a token in the one shape a pass is given in. */
export function isAccessToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

/** True for an Access Pass id as the table stores it. */
export function isAccessPassId(value: unknown): value is string {
  return typeof value === 'string' && ACCESS_ID.test(value);
}

/** The stored lookup for a token. Null with no pepper or a token of the wrong shape. */
export async function accessLookup(
  pepper: string | undefined,
  token: string
): Promise<string | null> {
  if (!pepper || !isAccessToken(token)) return null;
  const sig = await crypto.subtle.sign(
    'HMAC',
    await lookupKeyFor(pepper),
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** The link a host sends. The token is in the fragment, never the path or query. */
export function accessPassUrl(origin: string, token: string): string {
  return `${origin}${ACCESS_PAGE_PATH}#${token}`;
}

/** What the host sees of a pass. Never a use, a vote or a recipient. */
export interface AccessPassView {
  id: string;
  revoked: boolean;
}

export interface AccessPassList {
  passes: AccessPassView[];
  /** How many more the host may give for this set. */
  remaining: number;
  cap: number;
}

/**
 * Give one pass for the event's vote set. In one INSERT: the set exists, is
 * not final and not void, and fewer than ACCESS_PASS_CAP passes were ever given
 * for it. A pass may be given while the set is in draft, so the voter has it
 * ready. Returns the id and the link, shown once.
 */
export async function giveAccessPass(
  db: D1Database,
  pepper: string | undefined,
  eventId: string,
  origin: string
): Promise<AccessResult<{ id: string; url: string }>> {
  if (!pepper)
    return fail(503, 'ACCESS_PASS_UNAVAILABLE', 'Access Passes are not available right now');
  const set = await db
    .prepare(`SELECT id, is_final, is_void FROM vote_sets WHERE event_id = ?`)
    .bind(eventId)
    .first<{ id: string; is_final: number; is_void: number }>();
  if (!set) return ACCESS_NO_SET;
  if (set.is_final === 1 || set.is_void === 1) return ACCESS_SET_DONE;
  const token = b64url(randomBytes(32));
  const lookup = await accessLookup(pepper, token);
  if (!lookup)
    return fail(503, 'ACCESS_PASS_UNAVAILABLE', 'Access Passes are not available right now');
  const id = `vap_${hex(randomBytes(16))}`;
  const res = await db
    .prepare(
      `INSERT INTO vote_access_passes (id, set_id, event_id, lookup)
       SELECT ?, s.id, s.event_id, ?
         FROM vote_sets s
        WHERE s.id = ? AND s.event_id = ? AND s.is_final = 0 AND s.is_void = 0
          AND (SELECT COUNT(*) FROM vote_access_passes a WHERE a.set_id = s.id) < ?`
    )
    .bind(id, lookup, set.id, eventId, ACCESS_PASS_CAP)
    .run();
  if ((res.meta?.changes ?? 0) !== 1) {
    const now = await db
      .prepare(`SELECT is_final, is_void FROM vote_sets WHERE id = ?`)
      .bind(set.id)
      .first<{ is_final: number; is_void: number }>();
    return now && (now.is_final === 1 || now.is_void === 1) ? ACCESS_SET_DONE : ACCESS_CAP_REACHED;
  }
  return { ok: true, value: { id, url: accessPassUrl(origin, token) } };
}

/** The passes given for the event's set, oldest first, and how many remain. */
export async function listAccessPasses(
  db: D1Database,
  eventId: string
): Promise<AccessResult<AccessPassList>> {
  const set = await db
    .prepare(`SELECT id FROM vote_sets WHERE event_id = ?`)
    .bind(eventId)
    .first<{ id: string }>();
  if (!set) return ACCESS_NO_SET;
  const rows = await db
    .prepare(
      `SELECT id, is_revoked FROM vote_access_passes
        WHERE set_id = ? AND event_id = ? ORDER BY created_at, id`
    )
    .bind(set.id, eventId)
    .all<{ id: string; is_revoked: number }>();
  const passes = (rows.results ?? []).map((r) => ({ id: r.id, revoked: r.is_revoked === 1 }));
  return {
    ok: true,
    value: {
      passes,
      remaining: Math.max(0, ACCESS_PASS_CAP - passes.length),
      cap: ACCESS_PASS_CAP,
    },
  };
}

/**
 * Revoke a pass: no new vote is taken from it, even from a pass page already
 * open (the vote route checks it). Votes already cast stay. One-way: nothing
 * un-revokes a pass, and a revoked pass still counts toward the cap.
 */
export async function revokeAccessPass(
  db: D1Database,
  eventId: string,
  passId: string
): Promise<AccessResult<AccessPassView>> {
  if (!isAccessPassId(passId)) return ACCESS_NOT_FOUND;
  const row = await db
    .prepare(`SELECT id FROM vote_access_passes WHERE id = ? AND event_id = ?`)
    .bind(passId, eventId)
    .first<{ id: string }>();
  if (!row) return ACCESS_NOT_FOUND;
  await db
    .prepare(`UPDATE vote_access_passes SET is_revoked = 1 WHERE id = ? AND event_id = ?`)
    .bind(passId, eventId)
    .run();
  return { ok: true, value: { id: passId, revoked: true } };
}

export interface AccessRedeemEnv extends VotingSwitchEnv {
  DB?: D1Database;
  ANON_ID_HASH_PEPPER?: string;
}

/**
 * Redeem a pass: the event and a fresh room pass, or null. All must hold, in
 * one statement: the token's lookup is a pass that is not revoked, its set is
 * open, not final and not void, and its event is live. Voting must be on and
 * the pepper set. Each redeem renews the pass, like a re-scan in the room, and
 * always gives the same voter key.
 */
export async function redeemAccessPass(
  env: AccessRedeemEnv,
  token: unknown,
  nowMs: number
): Promise<{ eventId: string; pass: string } | null> {
  if (!votingEnabled(env) || !env.DB || !env.ANON_ID_HASH_PEPPER) return null;
  if (!isAccessToken(token)) return null;
  const lookup = await accessLookup(env.ANON_ID_HASH_PEPPER, token);
  if (!lookup) return null;
  const row = await env.DB.prepare(
    `SELECT a.id AS id, a.event_id AS event_id
       FROM vote_access_passes a
       JOIN vote_sets s ON s.id = a.set_id AND s.event_id = a.event_id
      WHERE a.lookup = ? AND a.is_revoked = 0
        AND s.state = 'open' AND s.is_final = 0 AND s.is_void = 0`
  )
    .bind(lookup)
    .first<{ id: string; event_id: string }>();
  if (!row) return null;
  const live = await env.DB.prepare(`SELECT 1 AS hit WHERE ${EVENT_LIVE}`)
    .bind(row.event_id)
    .first();
  if (!live) return null;
  const pass = await mintAccessVotePass(
    env.ANON_ID_HASH_PEPPER,
    token,
    row.event_id,
    row.id,
    nowMs
  );
  return pass ? { eventId: row.event_id, pass } : null;
}

/**
 * May a pass redeemed from this Access Pass still vote? The vote route asks on
 * every vote that carries an Access Pass id, so a revoke stops it at once.
 */
export async function accessPassUsable(
  db: D1Database,
  eventId: string,
  accessId: string
): Promise<boolean> {
  if (!isAccessPassId(accessId)) return false;
  return !!(await db
    .prepare(
      `SELECT 1 AS hit FROM vote_access_passes WHERE id = ? AND event_id = ? AND is_revoked = 0`
    )
    .bind(accessId, eventId)
    .first());
}

/** At final: the set's passes go, with its receipts. Only once the set is final. */
export function deleteAccessPassesOfFinalSet(db: D1Database, setId: string): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM vote_access_passes
        WHERE set_id = ? AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 1)`
    )
    .bind(setId, setId);
}
