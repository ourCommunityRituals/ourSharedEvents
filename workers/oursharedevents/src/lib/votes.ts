/**
 * The vote tables' shared rules (OSE-2125, S2 of OSE-1193; OSE ADR-040).
 *
 * An anonymous vote is a counter on an object, never a row about a voter
 * (ADR-040 decision 1). Migration 0111 made the six tables. This module holds
 * what the routes that come later (S3, S4a, S5) must share, so each of them
 * cannot pick its own:
 *
 *   - VOTE_TABLES: the six table names. The gates read this list.
 *   - VOTABLE_KINDS: what an object may be. A song, a stall (decision 2), or an
 *     entry: whatever the organizer names, such as a painting, a float, a dish
 *     or a business's display (decision 12, OSE-2224). A
 *     team is never an object: it is the song's opaque `group_id`. There is no
 *     event-level object (decision 4): the set's one result is the event's vote.
 *     A person may be an object only as an opted-in presenter (Q9); no opt-in
 *     exists in OSE yet, so no kind for it exists either.
 *   - parseVotableLabel: a label is the name of a thing. What it may never hold
 *     is the off-limits list in lib/vote-off-limits.ts (ADR-040 decision 12,
 *     OSE-2225), today email- and phone-shaped text, the same shapes a booth
 *     name refuses. No label rule lives here.
 *   - The three markers, each an HMAC under its own server-only subkey:
 *       receipt             HMAC(K_receipt,     k ‖ object_id)
 *       participant marker  HMAC(K_participant, k ‖ set_id)
 *       team marker         HMAC(K_team,        k ‖ team_id)
 *     k is the per-event voter key (decision 6, built by S3b). It is stored
 *     nowhere, and no table holds it. Each subkey comes from
 *     ANON_ID_HASH_PEPPER by HKDF under its own label, never the scan key's
 *     (SCAN_NODE_KEY_CONTEXT), so a receipt never equals a participant marker,
 *     a team marker or a scan key, even for the same browser.
 *
 * A marker is 64 lowercase hex characters, no prefix. Migration 0111 accepts
 * nothing else in a marker column, so a cookie value (`anon_…`) or a scan key
 * (`snk1_…`) cannot be stored there.
 *
 * Gates: tests/vote-tables.spec.ts (workers pool) and
 * tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0).
 */

import { offLimitsRefusal, offLimitsRuleFor, type OffLimitsRuleId } from './vote-off-limits';

/** The six vote tables, all in DB (ADR-040 decision 1). Never in FORMS_DB. */
export const VOTE_TABLES = [
  'vote_sets',
  'votable_objects',
  'vote_tallies',
  'vote_receipts',
  'vote_participants',
  'vote_team_markers',
] as const;
export type VoteTable = (typeof VOTE_TABLES)[number];

/**
 * What an object may be (ADR-040 decisions 2 and 12). Kept in code, not in a
 * CHECK, so adding a kind needs no migration. `entry` is whatever the
 * organizer names; its label is the organizer's own words.
 */
export const VOTABLE_KINDS = ['song', 'stall', 'entry'] as const;
export type VotableKind = (typeof VOTABLE_KINDS)[number];

/** A set is played by its objects or by their teams, fixed at the first open. */
export const VOTE_PLAYED_BY = ['object', 'team'] as const;

/** The state of a set or an object. The one-way final flag is separate. */
export const VOTE_STATES = ['draft', 'open', 'closed'] as const;

/**
 * Why a set is void. A void set publishes nothing, and nothing un-voids it.
 * Today the one cause is a pepper rotation while the set is open (decision 6).
 */
export const VOTE_VOID_REASONS = ['pepper_epoch'] as const;

/**
 * A team is an opaque OSE id: `grp_` and 8 to 64 lowercase hex or `-`
 * characters (a UUID fits). Migration 0111 refuses anything else in
 * votable_objects.group_id and vote_team_markers.team_id, so a team or player
 * name cannot be stored (decision 2: OSE holds no name of any kind).
 */
const TEAM_ID = /^grp_[0-9a-f-]{8,64}$/;

/** True for a team id as the vote tables store it. */
export function isVoteTeamId(value: unknown): value is string {
  return typeof value === 'string' && TEAM_ID.test(value);
}

export const VOTABLE_LABEL_MAX = 80;

/** HKDF `info` for each marker. Changing one makes new markers. */
export const VOTE_RECEIPT_CONTEXT = 'ose:vote:receipt:v1';
export const VOTE_PARTICIPANT_CONTEXT = 'ose:vote:participant:v1';
export const VOTE_TEAM_CONTEXT = 'ose:vote:team-marker:v1';

/** A refusal may name the off-limits rule that refused it (OSE-2225). */
export type Parsed<T> =
  { ok: true; value: T } | { ok: false; code: string; error: string; rule?: OffLimitsRuleId };

const bad = (code: string, error: string): { ok: false; code: string; error: string } => ({
  ok: false,
  code,
  error,
});

const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

/** Check an object's label. Returns the trimmed label, or why it is refused. */
export function parseVotableLabel(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') return bad('INVALID_LABEL', 'label must be text');
  if (CONTROL_CHAR.test(raw)) return bad('INVALID_LABEL', 'label has a character that is not text');
  const label = raw.trim().replace(/\s+/g, ' ');
  if (!label) return bad('INVALID_LABEL', 'label is required');
  if (label.length > VOTABLE_LABEL_MAX)
    return bad('INVALID_LABEL', `label must be ${VOTABLE_LABEL_MAX} characters or fewer`);
  const rule = offLimitsRuleFor(label);
  if (rule)
    return { ok: false, code: 'INVALID_LABEL', error: offLimitsRefusal(rule), rule: rule.id };
  return { ok: true, value: label };
}

/** True for a kind on {@link VOTABLE_KINDS}. */
export function isVotableKind(value: unknown): value is VotableKind {
  return typeof value === 'string' && (VOTABLE_KINDS as readonly string[]).includes(value);
}

const HEX64 = /^[0-9a-f]{64}$/;

/** True for a marker as the vote tables store it: 64 lowercase hex characters. */
export function isVoteMarker(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

/** Fixed, public HKDF salt (RFC 5869 allows a non-secret salt). */
const HKDF_SALT = new TextEncoder().encode('oursharedevents:vote-markers');

// One derivation per isolate per pepper and label; the CryptoKey is
// non-extractable. A failed derivation is evicted, never cached.
const subKeys = new Map<string, Promise<CryptoKey>>();

function subKeyFor(pepper: string, context: string): Promise<CryptoKey> {
  const id = `${context}\u0000${pepper}`;
  let key = subKeys.get(id);
  if (!key) {
    key = deriveSubKey(pepper, context);
    subKeys.set(id, key);
    key.catch(() => subKeys.delete(id));
  }
  return key;
}

async function deriveSubKey(pepper: string, context: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(context) },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  );
}

/**
 * HMAC(subkey, k ‖ id). k is a fixed 64 hex characters, so the join is
 * unambiguous. Null when the pepper is missing, k is not a key, or id is empty:
 * nothing is stored then, and no fallback value is made.
 */
async function marker(
  context: string,
  pepper: string | undefined,
  k: string,
  id: string
): Promise<string | null> {
  if (!pepper || !isVoteMarker(k) || typeof id !== 'string' || !id) return null;
  const key = await subKeyFor(pepper, context);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${k}${id}`));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The receipt for one object: one vote per browser per object. */
export function voteReceipt(
  pepper: string | undefined,
  k: string,
  objectId: string
): Promise<string | null> {
  return marker(VOTE_RECEIPT_CONTEXT, pepper, k, objectId);
}

/** The participant marker for one set: counts distinct voters, raw, for V. */
export function voteParticipantMarker(
  pepper: string | undefined,
  k: string,
  setId: string
): Promise<string | null> {
  return marker(VOTE_PARTICIPANT_CONTEXT, pepper, k, setId);
}

/**
 * The team marker for one team (Q16). Keyed by the team, never by the song, so
 * up votes on several of a team's songs give one marker, and the team's total
 * counts the voter once.
 */
export function voteTeamMarker(
  pepper: string | undefined,
  k: string,
  teamId: string
): Promise<string | null> {
  if (!isVoteTeamId(teamId)) return Promise.resolve(null);
  return marker(VOTE_TEAM_CONTEXT, pepper, k, teamId);
}
