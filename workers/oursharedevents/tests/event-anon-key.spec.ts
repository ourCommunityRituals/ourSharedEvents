/**
 * The per-event keyed id the forms database stores in place of the raw
 * `ose_anon` cookie value (`src/lib/event-anon-key.ts`).
 *
 * Properties, each one a reason the id exists:
 *   - same cookie + same event  -> same id (check-in can recognise a phone)
 *   - same cookie + other event -> different id (no join across events)
 *   - it is never the raw value, and never a value the scan side stores
 *   - it is keyed by FORMS_HASH_PEPPER, but separated from the email hash that
 *     uses the same secret
 *   - no secret -> it throws; there is no unkeyed fallback
 *
 * Format: `UNIT | <what> | <assertion>`.
 */

import { describe, test, expect } from 'vitest';
import {
  eventAnonKey,
  isEventAnonKey,
  EVENT_ANON_KEY_PREFIX,
  EVENT_ANON_KEY_CONTEXT,
} from '../src/lib/event-anon-key';
import { hashEmail } from '../src/lib/pii';
import { hashAnonIdForReturns } from '../src/lib/anon-id-hash';

const PEPPER = 'unit-test-forms-hash-pepper-0123456789';
const OTHER_PEPPER = 'unit-test-forms-hash-pepper-abcdefghij';
const COOKIE = 'anon_3f0c1d2e-aaaa-4bbb-8ccc-0123456789ab';
const OTHER_COOKIE = 'anon_9a8b7c6d-dddd-4eee-8fff-ba9876543210';

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

describe('eventAnonKey', () => {
  test('UNIT | same cookie, same event, called twice | the id is identical', async () => {
    const a = await eventAnonKey(COOKIE, 'evt-one', PEPPER);
    const b = await eventAnonKey(COOKIE, 'evt-one', PEPPER);
    expect(a).toBe(b);
  });

  test('UNIT | same cookie, two events | the ids differ', async () => {
    const one = await eventAnonKey(COOKIE, 'evt-one', PEPPER);
    const two = await eventAnonKey(COOKIE, 'evt-two', PEPPER);
    expect(one).not.toBe(two);
  });

  test('UNIT | two cookies, same event | the ids differ', async () => {
    const a = await eventAnonKey(COOKIE, 'evt-one', PEPPER);
    const b = await eventAnonKey(OTHER_COOKIE, 'evt-one', PEPPER);
    expect(a).not.toBe(b);
  });

  test('UNIT | shape | prefix + 64 hex characters, and it does not contain the cookie value or the event id', async () => {
    const id = await eventAnonKey(COOKIE, 'evt-one', PEPPER);
    expect(id).toMatch(new RegExp(`^${EVENT_ANON_KEY_PREFIX}[0-9a-f]{64}$`));
    expect(id).not.toContain(COOKIE);
    expect(id).not.toContain(COOKIE.slice('anon_'.length));
    expect(id).not.toContain('evt-one');
    // A keyed id can never be read back as an ose_anon cookie value.
    expect(id.startsWith('anon_')).toBe(false);
  });

  test('UNIT | a different secret | gives a different id (the id is keyed, not a plain hash)', async () => {
    const a = await eventAnonKey(COOKIE, 'evt-one', PEPPER);
    const b = await eventAnonKey(COOKIE, 'evt-one', OTHER_PEPPER);
    expect(a).not.toBe(b);

    // Not a plain SHA-256 of anything an attacker could assemble without the secret.
    const digest = async (s: string) =>
      hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    for (const guess of [
      COOKIE,
      `${COOKIE}evt-one`,
      `evt-one${COOKIE}`,
      `${COOKIE}|evt-one`,
      `evt-one|${COOKIE}`,
      JSON.stringify(['evt-one', COOKIE]),
    ]) {
      expect(a).not.toBe(`${EVENT_ANON_KEY_PREFIX}${await digest(guess)}`);
    }
  });

  test('UNIT | the event id and the cookie value cannot be shifted into each other | ("ab","c") and ("a","bc") give different ids', async () => {
    const a = await eventAnonKey('anon_c', 'ab', PEPPER);
    const b = await eventAnonKey('anon_bc', 'a', PEPPER);
    const c = await eventAnonKey('c', 'abanon_', PEPPER);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  test('UNIT | same secret as the email hash | the id is not an HMAC of the pepper over any message built from the inputs', async () => {
    const id = await eventAnonKey(COOKIE, 'evt-one', PEPPER);
    const body = id.slice(EVENT_ANON_KEY_PREFIX.length);
    // hashEmail is HMAC-SHA256(pepper, lowercased-trimmed text). The cookie value
    // and these joins are already lowercase, so hashEmail is that HMAC exactly.
    for (const message of [
      COOKIE,
      `${COOKIE}evt-one`,
      `evt-one${COOKIE}`,
      `evt-one|${COOKIE}`,
      `${EVENT_ANON_KEY_CONTEXT}${COOKIE}`,
      `${EVENT_ANON_KEY_CONTEXT}|evt-one|${COOKIE}`,
      JSON.stringify(['evt-one', COOKIE]),
    ]) {
      expect(body).not.toBe(await hashEmail(message, PEPPER, { requirePepper: true }));
    }
  });

  test('UNIT | against the scan side | the id is neither the raw value nor the returns hash of it', async () => {
    const id = await eventAnonKey(COOKIE, 'evt-one', PEPPER);
    expect(id).not.toBe(COOKIE);
    // anon_id_returns stores a peppered hash of the cookie value; even with the
    // same secret text on both sides the two values must not meet.
    const returnsHash = await hashAnonIdForReturns(COOKIE, PEPPER);
    expect(returnsHash).toBeTruthy();
    expect(id).not.toContain(returnsHash!);
  });

  test('UNIT | secret missing or empty | it throws and returns nothing (no unkeyed fallback)', async () => {
    await expect(eventAnonKey(COOKIE, 'evt-one', undefined)).rejects.toThrow(/FORMS_HASH_PEPPER/);
    await expect(eventAnonKey(COOKIE, 'evt-one', '')).rejects.toThrow(/FORMS_HASH_PEPPER/);
  });

  test('UNIT | cookie value or event id missing | it throws rather than key an empty input', async () => {
    await expect(eventAnonKey('', 'evt-one', PEPPER)).rejects.toThrow();
    await expect(eventAnonKey(COOKIE, '', PEPPER)).rejects.toThrow();
  });
});

describe('isEventAnonKey', () => {
  test('UNIT | a keyed id | true', async () => {
    expect(isEventAnonKey(await eventAnonKey(COOKIE, 'evt-one', PEPPER))).toBe(true);
  });

  test('UNIT | a raw cookie value, a returns hash, empty, null | false', async () => {
    expect(isEventAnonKey(COOKIE)).toBe(false);
    expect(isEventAnonKey((await hashAnonIdForReturns(COOKIE, PEPPER))!)).toBe(false);
    expect(isEventAnonKey('')).toBe(false);
    expect(isEventAnonKey(null)).toBe(false);
    expect(isEventAnonKey(undefined)).toBe(false);
    expect(isEventAnonKey(`${EVENT_ANON_KEY_PREFIX}not-hex`)).toBe(false);
  });
});
