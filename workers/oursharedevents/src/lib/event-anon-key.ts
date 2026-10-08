/**
 * Per-event keyed id — what FORMS_DB stores in place of the raw `ose_anon`
 * cookie value.
 *
 * WHY. The scan path stores the cookie value in the main DB
 * (`scan_node_returns.anonymous_id`). The forms path used to store the same raw
 * value beside named form data, so anyone able to read both databases could
 * join a named registration to that browser's scan history. Owner decision
 * 2026-10-07: keep an id in FORMS_DB, but make it a keyed hash of the anonymous
 * id AND the event id.
 *
 * WHAT IT GIVES.
 *   - It equals no value in the main DB, and cannot be turned back into one
 *     without the secret.
 *   - It differs from event to event, so forms rows cannot be joined across
 *     events either.
 *   - It is stable inside one event, so check-in can still tell that a tap
 *     came from the same phone.
 *
 * KEY. No new secret: the key is derived from `FORMS_HASH_PEPPER`, the secret
 * the forms path already requires for email hashing. Domain separation is by
 * key, not by message: HKDF-SHA256 turns the pepper into a sub-key bound to
 * `EVENT_ANON_KEY_CONTEXT`, and that sub-key (never the pepper itself) signs
 * the message. `hashEmail` is HMAC(pepper, email); no email, whatever its
 * text, can therefore produce one of these ids, and no id here is an email
 * hash.
 *
 * FAIL CLOSED. A missing pepper throws (`assertPepperConfigured`). There is no
 * unkeyed fallback and callers must never store the raw id instead — the form
 * handlers answer 503 CONFIG_ERROR, as they already do for the email hash.
 *
 * Rotating `FORMS_HASH_PEPPER` changes every id: a phone that checked in before
 * the rotation reads as a new phone after it. Email hashes break on the same
 * rotation, so it is already a planned, announced operation.
 */

import { assertPepperConfigured } from './pii';

/** Marks a stored value as a per-event keyed id (version 1). Never `anon_`. */
export const EVENT_ANON_KEY_PREFIX = 'evk1_';

/** HKDF `info` — names this one use of FORMS_HASH_PEPPER. Change = new ids. */
export const EVENT_ANON_KEY_CONTEXT = 'ose:forms:event-anon-key:v1';

/** Fixed, public HKDF salt (RFC 5869 allows a non-secret salt). */
const HKDF_SALT = new TextEncoder().encode('oursharedevents:forms-db');

const KEYED_ID_RE = new RegExp(`^${EVENT_ANON_KEY_PREFIX}[0-9a-f]{64}$`);

// One derivation per isolate per pepper. The CryptoKey is non-extractable, so
// holding it adds no exposure beyond the env secret the isolate already has.
// A failed derivation is evicted, never cached (same policy as lib/pii.ts).
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
      info: new TextEncoder().encode(EVENT_ANON_KEY_CONTEXT),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  );
}

/**
 * The id FORMS_DB stores for this browser at this event.
 *
 * @param anonId  the `ose_anon` cookie value (`anon_<uuid>`) — never stored
 * @param eventId the event the form belongs to
 * @param pepper  `env.FORMS_HASH_PEPPER`; missing or empty throws
 * @returns `evk1_` + 64 hex characters
 */
export async function eventAnonKey(
  anonId: string,
  eventId: string,
  pepper?: string
): Promise<string> {
  assertPepperConfigured(pepper);
  if (!anonId || !eventId) {
    throw new Error('eventAnonKey needs both an anonymous id and an event id');
  }
  const key = await subKeyFor(pepper);
  // A JSON array is an unambiguous encoding of the pair: no choice of event id
  // and anonymous id can produce the bytes of a different pair.
  const message = new TextEncoder().encode(JSON.stringify([eventId, anonId]));
  const sig = await crypto.subtle.sign('HMAC', key, message);
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${EVENT_ANON_KEY_PREFIX}${hex}`;
}

/** True for a value produced by {@link eventAnonKey}; false for anything else. */
export function isEventAnonKey(value: unknown): value is string {
  return typeof value === 'string' && KEYED_ID_RE.test(value);
}
