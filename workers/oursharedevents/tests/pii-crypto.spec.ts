/**
 * OSE-1273 (G1 follow-on) — node-clean unit coverage for the PII-scrub crypto,
 * so StrykerJS mutation can run on src/lib/pii.ts off the workerd pool.
 *
 * pii.spec.ts covers the same functions but imports `cloudflare:test` (its L1
 * block asserts a D1 INSERT), so it binds the workers pool and Stryker (node
 * runner) can't use it. These L2 crypto tests use only crypto.subtle +
 * TextEncoder (node-available), so they run in the node project — the mutation
 * teeth for the covenant's PII guard (hashEmail / encryptEmail / decryptEmail).
 */

import { describe, test, expect } from 'vitest';
import {
  hashEmail,
  encryptEmail,
  decryptEmail,
  encryptText,
  decryptText,
  assertPepperConfigured,
  ENCRYPTION_VERSION,
} from '../src/lib/pii';

const KEY = 'test-encryption-key-0123456789';
const PEPPER = 'test-hash-pepper';

describe('OSE-1273 — hashEmail', () => {
  test('returns a 64-char lowercase hex string', async () => {
    const h = await hashEmail('test@example.com');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic (same input → same hash)', async () => {
    expect(await hashEmail('user@example.com')).toBe(await hashEmail('user@example.com'));
  });

  test('normalizes case and surrounding whitespace before hashing', async () => {
    const base = await hashEmail('user@example.com');
    expect(await hashEmail('USER@EXAMPLE.COM')).toBe(base);
    expect(await hashEmail('  User@Example.Com  ')).toBe(base);
  });

  test('distinct emails → distinct hashes', async () => {
    expect(await hashEmail('a@example.com')).not.toBe(await hashEmail('b@example.com'));
  });

  test('pepper changes the hash (HMAC-keyed, not bare SHA-256)', async () => {
    const bare = await hashEmail('user@example.com');
    const peppered = await hashEmail('user@example.com', PEPPER);
    expect(peppered).not.toBe(bare);
    expect(peppered).toMatch(/^[0-9a-f]{64}$/);
    // Different peppers → different hashes (the pepper is actually keyed in).
    expect(await hashEmail('user@example.com', 'other-pepper')).not.toBe(peppered);
  });

  test('requirePepper:true throws when pepper is missing; passes when present', async () => {
    await expect(hashEmail('user@example.com', undefined, { requirePepper: true })).rejects.toThrow(
      /FORMS_HASH_PEPPER/
    );
    await expect(hashEmail('user@example.com', PEPPER, { requirePepper: true })).resolves.toMatch(
      /^[0-9a-f]{64}$/
    );
  });
});

describe('OSE-1273 — assertPepperConfigured', () => {
  test('throws on undefined and empty string', () => {
    expect(() => assertPepperConfigured(undefined)).toThrow(/FORMS_HASH_PEPPER/);
    expect(() => assertPepperConfigured('')).toThrow(/FORMS_HASH_PEPPER/);
  });
  test('passes for a non-empty pepper', () => {
    expect(() => assertPepperConfigured('secret')).not.toThrow();
  });
});

describe('OSE-1273 — encryptEmail / decryptEmail', () => {
  test('round-trips to the normalized (lowercased, trimmed) email', async () => {
    const enc = await encryptEmail('  User@Example.Com  ', KEY);
    expect(await decryptEmail(enc, KEY)).toBe('user@example.com');
  });

  test('ciphertext carries the active version prefix', async () => {
    const enc = await encryptEmail('user@example.com', KEY);
    expect(enc.startsWith(`${ENCRYPTION_VERSION}:`)).toBe(true);
  });

  test('same plaintext encrypts to distinct ciphertexts (random IV)', async () => {
    const a = await encryptEmail('user@example.com', KEY);
    const b = await encryptEmail('user@example.com', KEY);
    expect(a).not.toBe(b);
    // …but both decrypt back to the same plaintext.
    expect(await decryptEmail(a, KEY)).toBe(await decryptEmail(b, KEY));
  });

  test('decrypt with the WRONG key throws (AES-GCM auth tag)', async () => {
    const enc = await encryptEmail('user@example.com', KEY);
    await expect(decryptEmail(enc, 'a-different-key')).rejects.toThrow();
  });

  test('tampered ciphertext throws (integrity)', async () => {
    const enc = await encryptEmail('user@example.com', KEY);
    const [ver, b64] = enc.split(':');
    // Tamper a decoded BYTE, not a base64 char. A base64 char right before the
    // padding contributes only partial bits, so flipping it can decode to the
    // same bytes for some random ciphertexts — a real tamper that GCM would
    // still accept — which made this test flake intermittently. Flipping a byte
    // of iv||ciphertext||tag always changes the plaintext bytes, so GCM auth
    // must reject every time.
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const tampered = `${ver}:${btoa(String.fromCharCode(...bytes))}`;
    await expect(decryptEmail(tampered, KEY)).rejects.toThrow();
  });
});

describe('DE-01 — encryptText / decryptText (non-normalizing, for names)', () => {
  test('round-trips VERBATIM: case and whitespace are preserved (unlike encryptEmail)', async () => {
    // The whole point of the DE-01 split: a human name keeps its exact form.
    const NAME = '  Àlïce   VAN-der Berg  ';
    const enc = await encryptText(NAME, KEY);
    expect(await decryptText(enc, KEY)).toBe(NAME);
  });

  test('does NOT lowercase/trim (contrast: encryptEmail normalizes)', async () => {
    const mixed = 'MixedCase Name';
    const encName = await encryptText(mixed, KEY);
    expect(await decryptText(encName, KEY)).toBe(mixed); // preserved

    // encryptEmail normalizes the same input to lowercase (documents the contrast).
    const encEmail = await encryptEmail(mixed, KEY);
    expect(await decryptEmail(encEmail, KEY)).toBe(mixed.toLowerCase());
  });

  test('carries the active version prefix and empty secret throws (shared primitive path)', async () => {
    const enc = await encryptText('Some Name', KEY);
    expect(enc.startsWith(`${ENCRYPTION_VERSION}:`)).toBe(true);
    await expect(encryptText('Some Name', '')).rejects.toThrow(/No encryption key/);
  });

  test('encryptEmail output is decryptable by decryptText (byte-compatible format)', async () => {
    // Proves encryptEmail is now just encryptText(normalized) — same ciphertext format.
    const enc = await encryptEmail('User@Example.Com', KEY);
    expect(await decryptText(enc, KEY)).toBe('user@example.com');
  });
});

describe('OSE-1273 — versioned key map (OSE-579 rotation)', () => {
  test('JSON key map encrypts under the HIGHEST version', async () => {
    const map = JSON.stringify({ v1: 'old-key', v2: 'new-key' });
    const enc = await encryptEmail('user@example.com', map);
    expect(enc.startsWith('v2:')).toBe(true);
    expect(await decryptEmail(enc, map)).toBe('user@example.com');
  });

  test('decrypt selects the key by the ciphertext version prefix (rotation-safe)', async () => {
    // Written under v1 (plain key) …
    const v1Cipher = await encryptEmail('user@example.com', 'old-key');
    expect(v1Cipher.startsWith('v1:')).toBe(true);
    // …still decryptable after v2 is added to the map.
    const rotated = JSON.stringify({ v1: 'old-key', v2: 'new-key' });
    expect(await decryptEmail(v1Cipher, rotated)).toBe('user@example.com');
  });

  test('decrypt throws when the ciphertext version has no key in the map', async () => {
    const enc = await encryptEmail('user@example.com', JSON.stringify({ v2: 'new-key' }));
    await expect(decryptEmail(enc, JSON.stringify({ v1: 'old-key' }))).rejects.toThrow(
      /No decryption key/
    );
  });
});

// ── Mutation-kill hardening (OSE-1273) ──
// These pin exact behaviours so a StrykerJS mutant can't survive silently.
describe('OSE-1273 — mutation-kill hardening for pii.ts', () => {
  test('bare hashEmail matches the known SHA-256 vector of the LOWERCASED email', async () => {
    // Kills toLowerCase→toUpperCase: case-insensitivity alone can't tell them
    // apart (both sides normalize the same way); a fixed vector can.
    const VECTOR = '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b'; // sha256("test@example.com")
    expect(await hashEmail('test@example.com')).toBe(VECTOR);
    expect(await hashEmail('TEST@EXAMPLE.COM')).toBe(VECTOR); // upper-cased input, lower-cased hash
  });

  test('empty secret has no key → encrypt throws (not silently encrypts)', async () => {
    // Kills the parseKeyMap empty-guard / activeVersion-fallback path that would
    // otherwise let an unconfigured key produce ciphertext.
    await expect(encryptEmail('user@example.com', '')).rejects.toThrow(/No encryption key/);
  });

  test('a JSON array or non-object secret is treated as a raw v1 key (not a key map)', async () => {
    // Kills the parseKeyMap object-shape guard (`&&`/`typeof`/`!Array.isArray`):
    // if any limb flipped, an array/number JSON would be misread as a key map and
    // the round-trip would break.
    for (const secret of ['[1,2,3]', '42']) {
      const enc = await encryptEmail('user@example.com', secret);
      expect(enc.startsWith('v1:')).toBe(true);
      expect(await decryptEmail(enc, secret)).toBe('user@example.com');
    }
  });

  test('active version is the numerically-highest, independent of key insertion order', async () => {
    // Kills the sort comparator mutants (`-`→`+`, dropping `.slice(1)`): with keys
    // inserted high-then-low, only a correct numeric descending pick lands on v10.
    const map = JSON.stringify({ v10: 'ten', v2: 'two' });
    const enc = await encryptEmail('user@example.com', map);
    expect(enc.startsWith('v10:')).toBe(true);
    expect(await decryptEmail(enc, map)).toBe('user@example.com');
  });

  test('a version-shaped-but-invalid key is excluded from active-version selection', async () => {
    // Kills the `/^v\d+$/` anchor mutants: 'v9extra' matches an unanchored regex
    // and would (wrongly) become the active version; anchored, only 'v1' qualifies.
    // 'v9extra' (trailing junk) kills the `$`-anchor drop; 'xv2' (leading junk)
    // kills the `^`-anchor drop — both must be excluded so only v1 stays active.
    for (const invalid of [
      { v1: 'one', v9extra: 'nope' },
      { v1: 'one', xv2: 'nope' },
    ]) {
      const map = JSON.stringify(invalid);
      const enc = await encryptEmail('user@example.com', map);
      expect(enc.startsWith('v1:')).toBe(true);
      expect(await decryptEmail(enc, map)).toBe('user@example.com');
    }
  });

  test('legacy UNVERSIONED ciphertext (no version prefix) decrypts via the default version', async () => {
    // Kills the version-parse mutants in decryptEmail (`colonIdx !== -1` → `+1`,
    // and the `? :` collapsing to always-true): strip the 'v1:' prefix and the
    // no-colon branch must fall back to ENCRYPTION_VERSION, not slice off a char.
    const enc = await encryptEmail('user@example.com', KEY); // 'v1:...'
    const unversioned = enc.slice(enc.indexOf(':') + 1); // legacy base64, no prefix
    expect(await decryptEmail(unversioned, KEY)).toBe('user@example.com');
  });
});

// ─── Derived-key reuse (staging T2 latency, 2026-09-30) ─────────────────────
//
// decryptText used to run PBKDF2 (100,000 iterations) for EVERY row it
// decrypted. The admin registrations list decrypts every attendee name for an
// event, so its cost grew with each registration — on staging it reached
// 16.3 s (T2 Contract, "GET Registrations", budget 9 s). The derived AES key is
// a pure function of (key material, version) and is non-extractable, so one
// derivation per isolate is enough.
describe('derived AES key is reused, not re-derived per row', () => {
  function countDerivations() {
    const subtle = crypto.subtle;
    const original = subtle.deriveKey.bind(subtle);
    let calls = 0;
    subtle.deriveKey = ((...args: Parameters<SubtleCrypto['deriveKey']>) => {
      calls++;
      return original(...args);
    }) as SubtleCrypto['deriveKey'];
    return {
      get calls() {
        return calls;
      },
      restore() {
        subtle.deriveKey = original;
      },
    };
  }

  test('decrypting 25 rows under one key derives that key once', async () => {
    const secret = `reuse-key-${Math.random()}`;
    const cipher = await Promise.all(
      Array.from({ length: 25 }, (_, i) => encryptText(`Attendee ${i}`, secret))
    );
    const spy = countDerivations();
    try {
      const plain = await Promise.all(cipher.map((c) => decryptText(c, secret)));
      expect(plain[24]).toBe('Attendee 24');
      expect(spy.calls, 'PBKDF2 ran once per row').toBeLessThanOrEqual(1);
    } finally {
      spy.restore();
    }
  });

  test('a failed derivation is not cached: the next call derives again and succeeds', async () => {
    const secret = `evict-${Math.random()}`;
    const subtle = crypto.subtle;
    const original = subtle.deriveKey.bind(subtle);
    subtle.deriveKey = (() =>
      Promise.reject(new Error('transient derive failure'))) as SubtleCrypto['deriveKey'];
    try {
      await expect(encryptText('x', secret)).rejects.toThrow('transient derive failure');
    } finally {
      subtle.deriveKey = original;
    }
    // Let the eviction handler run before the retry.
    await new Promise((r) => setTimeout(r, 0));
    const c = await encryptText('after failure', secret);
    expect(await decryptText(c, secret)).toBe('after failure');
  });

  test('different key material or version still derives its own key (no cross-talk)', async () => {
    const a = `iso-a-${Math.random()}`;
    const b = `iso-b-${Math.random()}`;
    const ca = await encryptText('from A', a);
    const cb = await encryptText('from B', b);
    expect(await decryptText(ca, a)).toBe('from A');
    expect(await decryptText(cb, b)).toBe('from B');
    await expect(decryptText(ca, b)).rejects.toThrow();

    const rotated = JSON.stringify({ v1: a, v2: b });
    const c2 = await encryptText('rotated', rotated);
    expect(c2.startsWith('v2:')).toBe(true);
    expect(await decryptText(c2, rotated)).toBe('rotated');
    expect(await decryptText(ca, rotated)).toBe('from A');
  });
});
