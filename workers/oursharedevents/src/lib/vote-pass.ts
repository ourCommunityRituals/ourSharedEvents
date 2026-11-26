/**
 * The vote pass: what `/q` hands the voter page instead of a cookie
 * (OSE-2133, S3b of OSE-1193; OSE ADR-040 decision 6).
 *
 * WHY. The owner reversed D3 on 2026-11-18: no new reader of `ose_anon` ("Once
 * there is a seam, it's a way in"). Every cookie read stays inside `/q`. So
 * `/q` turns the cookie into a pass, and the vote route (S4a) checks the pass,
 * never a cookie. AGENTS.md invariant 4 is unchanged.
 *
 * THE VOTER KEY.
 *   k = HMAC(K_voter, len(cookie) ‖ cookie ‖ event_id)
 *   - len is the cookie's UTF-8 byte length as 4 bytes, big-endian, so no two
 *     (cookie, event) pairs give the same message: `anon_ab` at `cdef` and
 *     `anon_abc` at `def` differ.
 *   - The event id is in the message, so one cookie at two events gives two
 *     unrelated keys. k is 64 lowercase hex characters, the shape the receipt
 *     and marker functions in lib/votes.ts take. It is stored nowhere.
 *
 * THE PASS. `{event_id, expiry, pepper_epoch, k}`, encoded as
 *   `vp1.` + base64url(JSON) + `.` + base64url(HMAC(K_pass, `vp1.` + base64url(JSON)))
 *   - It is signed, not encrypted: whoever holds the pass can read k. That is
 *     the forwarded-pass risk the owner accepted (Q12, decision 9). k alone
 *     makes no receipt: the receipt key is a separate server-only subkey.
 *   - It lasts 30 minutes (Q12). A re-scan in the same browser mints a new pass
 *     with a new expiry and the same k, so the same receipts.
 *   - It rides only in the redirect's fragment (`/events/:id/vote#t=…`). A
 *     browser never sends a fragment to a server, so it is in no query string,
 *     no Referer and no request log. No log line names the pass, k or the
 *     redirect's Location (handlers/qr-scan.ts; gate:
 *     tests/e2e/0-architecture/votes-never-who.invariant.spec.ts).
 *
 * THE KEYS. Both come from `ANON_ID_HASH_PEPPER` by HKDF, each under its own
 * label, declared in this file and nowhere else. Neither is the scan key's
 * label (lib/scan-node-key.ts) or a marker's (lib/votes.ts): the S2 review
 * found that importing another file's `*_CONTEXT` constant here would not be
 * caught by the label count, so the T0 gate refuses any `*_CONTEXT` import into
 * this file, and tests/vote-pass.spec.ts derives k under every other label and
 * finds no match. The pepper differs in each environment, so the keys do too.
 * No new secret.
 *
 * WHEN A PASS IS MINTED (all must hold, else none is, and the visitor gets
 * today's redirect):
 *   - the URL asks for one (`/q/<token>?type=vote`);
 *   - the scan was stored, or was a duplicate of one stored (the caller says);
 *   - the voting switch is on (votingEnabled, lib/voting-switch.ts, S3c);
 *   - the pepper is set (no unkeyed fallback);
 *   - in one statement (voteCodeMayMint, lib/vote-sets.ts): the scanned
 *     placement is the event's own vote code, in use (OSE-2140, S3d; owner,
 *     2026-11-18), the event's vote set is open and not final, and the event
 *     is live, Published and on its dates (OSE-2142, S3e). An ordinary poster
 *     code of the event with `?type=vote` mints nothing: its token can be
 *     reached from a shared event-page link, through `&deployment=` and the
 *     public poster bundle (the S3b security review, F1). The vote code's own
 *     token is in no public answer (lib/vote-code.ts).
 */

import { pepperEpoch } from './anon-id-hash';
import { votingEnabled, type VotingSwitchEnv } from './voting-switch';
import { voteCodeMayMint } from './vote-sets';

/**
 * The `?type=` a vote code carries on its `/q` URL (decision 6, Q6). It asks
 * for a pass; only the event's vote code can be given one (OSE-2140).
 */
export const VOTE_CODE_TYPE = 'vote';

/** How long a pass lasts (Q12). A re-scan renews it. */
export const VOTE_PASS_TTL_SECONDS = 30 * 60;

/** HKDF `info` for the voter key. Its own; never imported from another file. */
const VOTER_KEY_LABEL = 'ose:vote:voter-key:v1';
/** HKDF `info` for the pass seal. Its own; never imported from another file. */
const PASS_SEAL_LABEL = 'ose:vote:pass-seal:v1';
/**
 * HKDF `info` for an Access Pass's voter key (ADR-040 decision 13): k comes from
 * the pass token, not a cookie, under its own label, so an Access Pass key can
 * never equal a room key made from a cookie, even for the same bytes.
 */
const ACCESS_VOTER_KEY_LABEL = 'ose:vote:access-voter-key:v1';
/**
 * HKDF `info` for the Online Pick's voter key and its pass seal (decision 13).
 * The Online Pick is a separate channel: its key and its seal are its own, so a
 * crowd pass never opens as a room pass and a crowd key never equals a room
 * key. Cryptographic separation on top of the separate tables.
 */
const CROWD_VOTER_KEY_LABEL = 'ose:vote:crowd-voter-key:v1';
const CROWD_SEAL_LABEL = 'ose:vote:crowd-pass-seal:v1';

/** Fixed, public HKDF salt (RFC 5869 allows a non-secret salt). */
const HKDF_SALT = new TextEncoder().encode('oursharedevents:vote-pass');

const PASS_PREFIX = 'vp1.';
/** The Online Pick's pass. Another prefix and another seal: never a room pass. */
const CROWD_PREFIX = 'vc1.';

/** An Access Pass id, as vote_access_passes stores it (migration 0124). */
const ACCESS_ID = /^vap_[0-9a-f]{32}$/;
/** The only keys a pass's JSON may carry; anything more is not one of ours. */
const WIRE_KEYS: ReadonlySet<string> = new Set(['e', 'x', 'p', 'k', 'a']);

interface Channel {
  prefix: string;
  seal: string;
}
const ROOM: Channel = { prefix: PASS_PREFIX, seal: PASS_SEAL_LABEL };
const CROWD: Channel = { prefix: CROWD_PREFIX, seal: CROWD_SEAL_LABEL };
/** A pass longer than this is not one of ours; refuse before any crypto. */
const PASS_MAX_LENGTH = 512;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

// One derivation per isolate per pepper and label; the CryptoKey is
// non-extractable. A failed derivation is evicted, never cached.
type Usage = 'sign' | 'verify';
const subKeys = new Map<string, Promise<CryptoKey>>();

function subKeyFor(pepper: string, label: string, usages: Usage[]): Promise<CryptoKey> {
  const id = `${label}\u0000${pepper}`;
  let key = subKeys.get(id);
  if (!key) {
    key = deriveSubKey(pepper, label, usages);
    subKeys.set(id, key);
    key.catch(() => subKeys.delete(id));
  }
  return key;
}

async function deriveSubKey(pepper: string, label: string, usages: Usage[]): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(label) },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    usages
  );
}

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

function b64urlEncodeBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeBytes(s: string): Uint8Array | null {
  if (!B64URL.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * The message k is the HMAC of: the cookie's UTF-8 byte length (4 bytes,
 * big-endian), the cookie, then the event id.
 */
export function voterKeyMessage(cookie: string, eventId: string): Uint8Array {
  const enc = new TextEncoder();
  const c = enc.encode(cookie);
  const e = enc.encode(eventId);
  const out = new Uint8Array(4 + c.length + e.length);
  new DataView(out.buffer).setUint32(0, c.length, false);
  out.set(c, 4);
  out.set(e, 4 + c.length);
  return out;
}

/**
 * The per-event voter key k. Null when the pepper is missing, or the cookie or
 * event id is empty: no k is made then, and no fallback value either.
 */
export async function voterKey(
  pepper: string | undefined,
  cookie: string,
  eventId: string
): Promise<string | null> {
  return keyUnder(VOTER_KEY_LABEL, pepper, cookie, eventId);
}

async function keyUnder(
  label: string,
  pepper: string | undefined,
  secret: string,
  eventId: string
): Promise<string | null> {
  if (!pepper || !secret || !eventId) return null;
  const key = await subKeyFor(pepper, label, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, voterKeyMessage(secret, eventId)));
}

/**
 * An Access Pass's voter key (decision 13): k = HMAC(K_access_voter, len(token)
 * ‖ token ‖ event_id). The same token always gives the same k at one event, so
 * a forwarded or shared Access Pass is still one voter: sharing gains nothing.
 */
export async function accessVoterKey(
  pepper: string | undefined,
  token: string,
  eventId: string
): Promise<string | null> {
  return keyUnder(ACCESS_VOTER_KEY_LABEL, pepper, token, eventId);
}

/** The Online Pick's voter key: the room's shape, under the crowd's own label. */
export async function crowdVoterKey(
  pepper: string | undefined,
  cookie: string,
  eventId: string
): Promise<string | null> {
  return keyUnder(CROWD_VOTER_KEY_LABEL, pepper, cookie, eventId);
}

/** What a pass carries. */
export interface VotePassClaims {
  event_id: string;
  /** Unix seconds; the pass is good while now is before it. */
  expires_at: number;
  pepper_epoch: string;
  k: string;
  /**
   * Set only on a pass redeemed from an Access Pass: its id, so the vote route
   * can refuse a revoked pass at once. It never reaches a table or a log, and
   * the vote is counted exactly like any other (decision 13: the same weight).
   */
  access_id?: string;
}

interface WirePass {
  e: string;
  x: number;
  p: string;
  k: string;
  a?: string;
}

/**
 * Mint a pass for one browser at one event. Null when the pepper is missing:
 * a pass is never made without the keyed path.
 */
export async function mintVotePass(
  pepper: string | undefined,
  cookie: string,
  eventId: string,
  nowMs: number
): Promise<string | null> {
  return sealPass(ROOM, pepper, await voterKey(pepper, cookie, eventId), eventId, nowMs);
}

/**
 * Mint a room pass from an Access Pass (decision 13). The caller has checked
 * the Access Pass (lib/vote-access-pass.ts). The pass is a room pass: the same
 * page, the same route, the same weight. It carries the Access Pass id only so
 * a revoke stops it before it runs out.
 */
export async function mintAccessVotePass(
  pepper: string | undefined,
  token: string,
  eventId: string,
  accessId: string,
  nowMs: number
): Promise<string | null> {
  if (!ACCESS_ID.test(accessId)) return null;
  return sealPass(
    ROOM,
    pepper,
    await accessVoterKey(pepper, token, eventId),
    eventId,
    nowMs,
    accessId
  );
}

/** Mint an Online Pick pass: the crowd's own key and seal, never a room pass. */
export async function mintCrowdPass(
  pepper: string | undefined,
  cookie: string,
  eventId: string,
  nowMs: number
): Promise<string | null> {
  return sealPass(CROWD, pepper, await crowdVoterKey(pepper, cookie, eventId), eventId, nowMs);
}

async function sealPass(
  ch: Channel,
  pepper: string | undefined,
  k: string | null,
  eventId: string,
  nowMs: number,
  accessId?: string
): Promise<string | null> {
  const epoch = await pepperEpoch(pepper);
  if (!pepper || !epoch || !k) return null;
  const wire: WirePass = {
    e: eventId,
    x: Math.floor(nowMs / 1000) + VOTE_PASS_TTL_SECONDS,
    p: epoch,
    k,
  };
  if (accessId) wire.a = accessId;
  const body = ch.prefix + b64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(wire)));
  const seal = await subKeyFor(pepper, ch.seal, ['sign', 'verify']);
  const mac = await crypto.subtle.sign('HMAC', seal, new TextEncoder().encode(body));
  return `${body}.${b64urlEncodeBytes(new Uint8Array(mac))}`;
}

/**
 * Read a pass back: its seal (checked in constant time by WebCrypto's verify),
 * its shape, its expiry, the current pepper epoch and its event. Null for
 * anything else. `eventId` is required, so no caller can accept a pass minted
 * for another event (security review F5). Each part must be in its one
 * canonical base64url spelling, so one pass has one string (review F9).
 *
 * The vote route (S4a) also compares the epoch with the set's own; that needs
 * the set and is S4a's.
 */
export async function openVotePass(
  pepper: string | undefined,
  pass: unknown,
  nowMs: number,
  eventId: string
): Promise<VotePassClaims | null> {
  return openPass(ROOM, pepper, pass, nowMs, eventId);
}

/**
 * Read an Online Pick pass back. A room pass never opens here, and a crowd
 * pass never opens in openVotePass: another prefix and another seal. A crowd
 * pass never carries an Access Pass id.
 */
export async function openCrowdPass(
  pepper: string | undefined,
  pass: unknown,
  nowMs: number,
  eventId: string
): Promise<VotePassClaims | null> {
  const claims = await openPass(CROWD, pepper, pass, nowMs, eventId);
  return claims && !claims.access_id ? claims : null;
}

async function openPass(
  ch: Channel,
  pepper: string | undefined,
  pass: unknown,
  nowMs: number,
  eventId: string
): Promise<VotePassClaims | null> {
  if (!pepper || !eventId || typeof pass !== 'string' || pass.length > PASS_MAX_LENGTH) return null;
  if (!pass.startsWith(ch.prefix)) return null;
  const dot = pass.lastIndexOf('.');
  if (dot <= ch.prefix.length) return null;
  const body = pass.slice(0, dot);
  const mac = b64urlDecodeBytes(pass.slice(dot + 1));
  const json = b64urlDecodeBytes(body.slice(ch.prefix.length));
  if (!mac || !json || mac.length !== 32) return null;
  // One spelling only: atob ignores a last character's unused bits.
  if (b64urlEncodeBytes(mac) !== pass.slice(dot + 1)) return null;
  if (b64urlEncodeBytes(json) !== body.slice(ch.prefix.length)) return null;
  const seal = await subKeyFor(pepper, ch.seal, ['sign', 'verify']);
  const ok = await crypto.subtle.verify('HMAC', seal, mac, new TextEncoder().encode(body));
  if (!ok) return null;
  let wire: Partial<WirePass>;
  try {
    wire = JSON.parse(new TextDecoder().decode(json)) as Partial<WirePass>;
  } catch {
    return null;
  }
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) return null;
  // Exactly our keys: a pass with another field is not one we minted.
  if (Object.keys(wire).some((key) => !WIRE_KEYS.has(key))) return null;
  if (wire.a !== undefined && (typeof wire.a !== 'string' || !ACCESS_ID.test(wire.a))) return null;
  if (
    typeof wire.e !== 'string' ||
    !wire.e ||
    !Number.isInteger(wire.x) ||
    typeof wire.p !== 'string' ||
    !HEX16.test(wire.p) ||
    typeof wire.k !== 'string' ||
    !HEX64.test(wire.k)
  )
    return null;
  if (Math.floor(nowMs / 1000) >= (wire.x as number)) return null;
  if (wire.p !== (await pepperEpoch(pepper))) return null;
  if (wire.e !== eventId) return null;
  const claims: VotePassClaims = {
    event_id: wire.e,
    expires_at: wire.x as number,
    pepper_epoch: wire.p,
    k: wire.k,
  };
  if (wire.a) claims.access_id = wire.a;
  return claims;
}

export interface VotePassEnv extends VotingSwitchEnv {
  DB: D1Database;
  ANON_ID_HASH_PEPPER?: string;
}

/**
 * The pass `/q` hands out for a scan of the event's vote code that was stored
 * (or was a duplicate of one stored), or null. The caller decides the scan
 * part and names the placement it scanned; this checks the switch, the pepper,
 * then the code, the set and the event together, so with the switch off
 * nothing is read.
 */
export async function issueVotePass(
  env: VotePassEnv,
  cookie: string,
  eventId: string,
  deploymentId: string,
  nowMs: number
): Promise<string | null> {
  if (!votingEnabled(env)) return null;
  if (!env.ANON_ID_HASH_PEPPER) return null;
  if (!(await voteCodeMayMint(env.DB, eventId, deploymentId))) return null;
  return mintVotePass(env.ANON_ID_HASH_PEPPER, cookie, eventId, nowMs);
}

/**
 * Where a vote code with a stale stamp lands (CCR F7): the voter page with no
 * pass, which says "Scan the code on the screen again." (SCAN_AGAIN_WORDS).
 */
export function staleVotePageTarget(origin: string, eventId: string): string {
  return `${origin}/events/${encodeURIComponent(eventId)}/vote`;
}

/** Where a vote code lands with a pass: the voter page, the pass in the fragment only. */
export function votePageTarget(origin: string, eventId: string, pass: string): string {
  return `${origin}/events/${encodeURIComponent(eventId)}/vote#t=${pass}`;
}
