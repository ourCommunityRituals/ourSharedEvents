/**
 * OSE-712 [BLOCKER] — FORMS_HASH_PEPPER silent GDPR/CCPA erasure failure.
 *
 * hashEmail (src/lib/pii.ts, re-exported by src/lib/forms-db.ts) silently
 * falls back to bare SHA-256 when FORMS_HASH_PEPPER is undefined. If the
 * pepper is present at WRITE time but absent/rotated at READ time, GDPR
 * Art.17 / CCPA §1798.105 erasure lookups hash the target email into a
 * DIFFERENT value, match ZERO rows, and the handler returns ok:true —
 * erasure that never happened, reported as success.
 *
 * This spec proves the silent-failure round-trip, then asserts the fix:
 *   - hashEmail(email, undefined, { requirePepper: true }) throws loudly.
 *   - assertPepperConfigured(undefined) throws loudly (preflight).
 *   - assertPepperConfigured('secret') passes.
 */

import { describe, test, expect } from 'vitest';
import { hashEmail, assertPepperConfigured } from '../src/lib/forms-db';

const WRITE_PEPPER = 'test-forms-hash-pepper-do-not-use-in-prod';
const EMAIL = 'erase-me@example.com';

describe('OSE-712: pepper preflight — silent erasure no-op', () => {
  // @born-red OSE-712 | method: round-trip-silent-failure | date: 2026-08-11
  test('DEMONSTRATES the bug: pepper present at write, absent at erase → hashes silently diverge (no longer matches, no throw before fix)', async () => {
    // WRITE: email hashed with the configured pepper (what is stored).
    const storedHash = await hashEmail(EMAIL, WRITE_PEPPER);

    // ERASE with the pepper ABSENT (rotated/unprovisioned between write & read).
    // Before the fix this silently falls back to bare SHA-256 and produces a
    // DIFFERENT hash — the DELETE ... WHERE email_hash = ? matches zero rows,
    // yet the handler reports ok:true. That is the GDPR/CCPA erasure lie.
    const eraseHashSilent = await hashEmail(EMAIL, undefined);

    // The stored hash and the (silent) erase-lookup hash DIVERGE — erasure
    // would match zero rows. This documents the exact silent-failure vector.
    expect(eraseHashSilent).not.toBe(storedHash);
  });

  // @born-red OSE-712 | method: loud-failure-assertion | date: 2026-08-11
  test('FIX: hashEmail with requirePepper=true FAILS LOUDLY when pepper is missing', async () => {
    await expect(hashEmail(EMAIL, undefined, { requirePepper: true })).rejects.toThrow(
      /FORMS_HASH_PEPPER/
    );
    // Empty string is treated as unset (falsy) — must also throw.
    await expect(hashEmail(EMAIL, '', { requirePepper: true })).rejects.toThrow(
      /FORMS_HASH_PEPPER/
    );
  });

  // @born-red OSE-712 | method: preflight-assertion | date: 2026-08-11
  test('FIX: assertPepperConfigured throws on missing pepper, passes when set', () => {
    expect(() => assertPepperConfigured(undefined)).toThrow(/FORMS_HASH_PEPPER/);
    expect(() => assertPepperConfigured('')).toThrow(/FORMS_HASH_PEPPER/);
    expect(() => assertPepperConfigured(WRITE_PEPPER)).not.toThrow();
  });

  test('FIX: with the pepper PROVISIONED at erase time, requirePepper hash matches the stored hash (real erasure would delete)', async () => {
    const storedHash = await hashEmail(EMAIL, WRITE_PEPPER);
    const eraseHash = await hashEmail(EMAIL, WRITE_PEPPER, { requirePepper: true });
    expect(eraseHash).toBe(storedHash);
  });
});
