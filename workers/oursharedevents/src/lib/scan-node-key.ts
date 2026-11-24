/**
 * Keyed scan id — what `scan_node_returns.anonymous_id` stored in place of the
 * raw `ose_anon` cookie value (OSE-1659).
 *
 * OSE-2214 (owner, 2026-11-23: count the code, never the person). A scan now
 * stores no id at all (scan-buffer.ts), the returns job is retired and
 * migration 0119 cleared every stored id. The key's one live use is the vote
 * code's one-hour duplicate marker (qr-scan.ts), which never reaches D1 (without
 * the pepper that marker falls back to the cookie value, in KV for an hour). The
 * history below is kept for the readers it describes.
 *
 * WHY. The scan path used to store the cookie value itself, next to a user-agent
 * hash, an hour bucket and the event id. Anyone holding a copy of the main DB
 * and one browser's cookie could then list every scan that browser made, and
 * the cookie value is the one thing the visitor's browser sends us on every
 * request. Never-who is the one hard invariant (OCR VISION, invariant 1).
 *
 * WHAT THE COLUMN WAS FOR (until OSE-2214). Three readers, all inside OSE:
 *   - `aggregateScanBuckets` counts distinct browsers per event-hour
 *     (`COUNT(DISTINCT COALESCE(anonymous_id, user_agent_hash))`);
 *   - `materializeAnonIdReturns` (retired, OSE-2214) hashed each distinct value into
 *     `anon_id_returns`, which counted the same browser coming back to
 *     ANOTHER event;
 *   - erasure (`handlers/data-subject.ts`) deletes a known browser's rows.
 * Returns span events, so a per-event key (the FORMS_DB `evk1_` pattern) would
 * break the second reader. This key is the same for one browser at every
 * event, and is all those readers need: none of them reads the cookie value.
 *
 * WHAT IT GIVES.
 *   - It equals no value in any other table: not the cookie, not a FORMS_DB
 *     `evk1_` id (other secret, other message), not an `anon_id_returns` hash
 *     (that is a further hash of this key).
 *   - It cannot be turned back into the cookie value, and cannot be computed
 *     from a cookie value, without `ANON_ID_HASH_PEPPER`.
 *
 * KEY. No new secret: HKDF-SHA256 turns `ANON_ID_HASH_PEPPER` (the returns
 * pepper, OSE-272 Q1: kept apart from the forms and IP peppers) into a sub-key
 * bound to `SCAN_NODE_KEY_CONTEXT`, and that sub-key signs the cookie value.
 *
 * NO PEPPER. `scanNodeKey` returns null, and the scan is stored with no id: the
 * scan still counts, the distinct count falls back to the user-agent hash, and
 * returns were skipped (as the retired `materializeAnonIdReturns` did without the
 * pepper). The raw value is never written as a fallback.
 *
 * Rotating `ANON_ID_HASH_PEPPER` changes every key, so a browser seen before the
 * rotation reads as a new one after it. Returns already reset on rotation
 * (`pepperEpoch`, migration 0091), so this adds no new break.
 */

/** Marks a stored value as a keyed scan id (version 1). Never `anon_` or `evk1_`. */
export const SCAN_NODE_KEY_PREFIX = 'snk1_';

/** HKDF `info` — names this one use of ANON_ID_HASH_PEPPER. Change = new keys. */
export const SCAN_NODE_KEY_CONTEXT = 'ose:scan:node-key:v1';

/** Fixed, public HKDF salt (RFC 5869 allows a non-secret salt). */
const HKDF_SALT = new TextEncoder().encode('oursharedevents:scan-node-returns');

const SCAN_NODE_KEY_RE = new RegExp(`^${SCAN_NODE_KEY_PREFIX}[0-9a-f]{64}$`);

// One derivation per isolate per pepper; the CryptoKey is non-extractable. A
// failed derivation is evicted, never cached (same policy as lib/event-anon-key.ts).
const subKeys = new Map<string, Promise<CryptoKey>>();

function subKeyFor(pepper: string): Promise<CryptoKey> {
  let key = subKeys.get(pepper);
  if (!key) {
    key = deriveSubKey(pepper);
    subKeys.set(pepper, key);
    key.catch(() => subKeys.delete(pepper));
  }
  return key;
}

async function deriveSubKey(pepper: string): Promise<CryptoKey> {
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
      info: new TextEncoder().encode(SCAN_NODE_KEY_CONTEXT),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  );
}

/**
 * The id `scan_node_returns` stores for this browser.
 *
 * @param anonId the `ose_anon` cookie value (`anon_<uuid>`) — never stored
 * @param pepper `env.ANON_ID_HASH_PEPPER`
 * @returns `snk1_` + 64 hex characters, or null when the pepper is missing
 */
export async function scanNodeKey(
  anonId: string,
  pepper: string | undefined
): Promise<string | null> {
  if (!pepper || !anonId) return null;
  const key = await subKeyFor(pepper);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(anonId));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${SCAN_NODE_KEY_PREFIX}${hex}`;
}

/** True for a value produced by {@link scanNodeKey}; false for anything else. */
export function isScanNodeKey(value: unknown): value is string {
  return typeof value === 'string' && SCAN_NODE_KEY_RE.test(value);
}
