/**
 * PII utilities — SHA-256 hashing and AES-GCM encryption for email storage.
 *
 * All crypto via crypto.subtle — zero dependencies, Workers-native.
 *
 * Ciphertext format: `{ENCRYPTION_VERSION}:{base64(iv + ciphertext)}`
 * The version prefix enables key rotation without schema changes:
 *   - v1: PBKDF2/SHA-256 100k iterations, AES-GCM-256, salt = oursharedevents-forms-v1
 *   - v2+ (future): change salt, increment ENCRYPTION_VERSION, decrypt() handles both
 *
 * COPPA/HIPAA readiness notes:
 *   - Consent: callers record consent_given_at; extend to consent_type for COPPA age-gating
 *   - TTL:     callers set retention_expires_at; OSE-203 cron enforces deletion
 *   - Key rotation: version prefix enables re-encrypt-on-read without schema migration
 *   - Audit: pii_audit_log table already exists for HIPAA access logging
 */

// ─── Version ────────────────────────────────────────────────────────────────────

/** Ciphertext version tag. Current active encryption version. */
export const ENCRYPTION_VERSION = 'v1';

// ─── Versioned key map (OSE-579) ────────────────────────────────────────────────
//
// FORMS_ENCRYPTION_KEY may be either:
//   • A plain string (legacy / v1 only): "my-secret-key"
//   • A JSON version map:               '{"v1":"oldkey","v2":"newkey"}'
//
// When using the JSON form, encryptEmail picks the highest numbered version.
// decryptEmail reads the version prefix from the ciphertext and looks up the
// matching raw key. Rotation: add "v2":"<newkey>" to the map, re-encrypt all
// existing records with reencrypt-pii.ts, then remove "v1" from the map.

function parseKeyMap(formsEncKey: string): Record<string, string> {
  // Stryker disable next-line ConditionalExpression: equivalent mutant — with a
  // falsy key, the guard ({}) and the fall-through ({v1:''}) both end at the same
  // "No encryption/decryption key" throw downstream; no observable difference.
  if (!formsEncKey) return {};
  try {
    const parsed: unknown = JSON.parse(formsEncKey);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // fall through — treat as raw v1 key
  }
  return { [ENCRYPTION_VERSION]: formsEncKey };
}

function activeVersion(keyMap: Record<string, string>): string {
  const versions = Object.keys(keyMap)
    .filter((k) => /^v\d+$/.test(k))
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  return versions[versions.length - 1] ?? ENCRYPTION_VERSION;
}

// ─── Hashing ────────────────────────────────────────────────────────────────────

/**
 * OSE-712 (BLOCKER) — preflight guard: assert FORMS_HASH_PEPPER is provisioned.
 *
 * Throws loudly when the pepper is unset (undefined / '' — both falsy). Call
 * this on any path where a MISSING pepper would silently corrupt a hash lookup
 * — most critically GDPR Art.17 / CCPA §1798.105 erasure, where a mismatched
 * hash matches zero rows and would otherwise report a success that never
 * happened. A loud throw converts a silent data-protection failure into a
 * visible, auditable error.
 */
export function assertPepperConfigured(pepper?: string): asserts pepper is string {
  if (!pepper) {
    // Stryker disable StringLiteral: the THROW is the behavioural contract (tested
    // in pii-crypto.spec.ts); the exact operator-guidance wording is not a contract
    // a test should pin, so blanking a message segment is an equivalent mutant.
    throw new Error(
      'FORMS_HASH_PEPPER is not configured. Email hashing requires the pepper to ' +
        'be provisioned; a missing pepper would silently produce a non-matching ' +
        'hash and cause GDPR/CCPA erasure lookups to no-op while reporting success. ' +
        'Set the FORMS_HASH_PEPPER secret (wrangler secret put FORMS_HASH_PEPPER).'
    );
    // Stryker restore StringLiteral
  }
}

/** Options for {@link hashEmail}. */
export interface HashEmailOptions {
  /**
   * When true, a missing/empty FORMS_HASH_PEPPER throws instead of silently
   * falling back to bare SHA-256. Use on read/lookup/erase paths where a
   * hash mismatch would silently no-op (GDPR/CCPA erasure). OSE-712.
   */
  requirePepper?: boolean;
}

/**
 * HMAC-SHA256 hash of normalized email, keyed with FORMS_HASH_PEPPER.
 * Returns 64-char hex string. Falls back to bare SHA-256 when no pepper is
 * provided (backward-compatible for local dev / tests that don't set the
 * secret — production MUST configure FORMS_HASH_PEPPER, verified by CI gate).
 *
 * OSE-598 (rank-9 finding): bare SHA-256 is rainbow-table-precomputable for
 * common email addresses. HMAC-SHA256 binds the hash to the secret pepper so
 * a stolen DB dump is useless without the key.
 *
 * OSE-712 (BLOCKER): pass `{ requirePepper: true }` on erase/lookup paths so a
 * missing pepper FAILS LOUDLY rather than silently degrading to bare SHA-256.
 * The silent fallback produces a hash that cannot match rows written WITH a
 * pepper, so a GDPR/CCPA erasure would delete zero rows yet return ok:true —
 * an erasure that never happened, reported as success.
 */
export async function hashEmail(
  email: string,
  pepper?: string,
  options?: HashEmailOptions
): Promise<string> {
  if (options?.requirePepper) {
    assertPepperConfigured(pepper);
  }

  const normalized = email.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);

  if (pepper) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      // Stryker disable next-line BooleanLiteral: extractable=false is a security
      // property (the key can't be exported), not output-observable — a functional
      // hash/roundtrip test cannot distinguish false from true.
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, data);
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback (no pepper configured): bare SHA-256, same as legacy behaviour
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── AES-GCM Encryption ────────────────────────────────────────────────────────

async function deriveKey(secret: string, version: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`oursharedevents-forms-${version}`),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    // Stryker disable next-line BooleanLiteral: extractable=false is a security
    // property (derived key can't be exported), not output-observable — an
    // encrypt/decrypt roundtrip cannot distinguish false from true.
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt arbitrary plaintext with AES-GCM. Returns
 * `{version}:{base64(iv + ciphertext)}` using the active key version.
 *
 * IMPORTANT: this does NOT normalize the input — the caller decides. Use it for
 * data where case/whitespace is significant (e.g. a human name — DE-01 /
 * Anonymous Contract A-5). `encryptEmail` wraps this and normalizes the email
 * first so email ciphertext behaviour is unchanged.
 *
 * `secret` may be a plain string (legacy v1) or a JSON key map
 * `{"v1":"oldkey","v2":"newkey"}` — active version is the highest numbered key.
 */
export async function encryptText(plaintext: string, secret: string): Promise<string> {
  const keyMap = parseKeyMap(secret);
  const version = activeVersion(keyMap);
  const rawKey = keyMap[version];
  // Stryker disable next-line StringLiteral: message wording is not a contract; the
  // throw itself is tested (empty-secret → No encryption key). ConditionalExpression
  // on this line stays live (killed by that test).
  if (!rawKey) throw new Error(`No encryption key found for version ${version}`);

  const key = await deriveKey(rawKey, version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return `${version}:${btoa(String.fromCharCode(...combined))}`;
}

/**
 * Decrypt AES-GCM ciphertext to its original plaintext (no normalization).
 * Accepts versioned format (`v1:base64`) and legacy unversioned base64.
 *
 * `secret` may be a plain string (legacy v1) or a JSON key map — the version
 * prefix in the ciphertext selects which key to use.
 */
export async function decryptText(encrypted: string, secret: string): Promise<string> {
  const colonIdx = encrypted.indexOf(':');
  const version = colonIdx !== -1 ? encrypted.slice(0, colonIdx) : ENCRYPTION_VERSION;
  // Stryker disable next-line ConditionalExpression,UnaryOperator: equivalent —
  // when colonIdx === -1, `slice(colonIdx + 1)` = `slice(0)` = the whole string =
  // the else branch, so `true ?` and `!== +1` are indistinguishable for every real
  // ciphertext (the only distinguishing input, colonIdx === 1, is an impossible
  // single-char-version format). The version line above IS killed (unversioned test).
  const payload = colonIdx !== -1 ? encrypted.slice(colonIdx + 1) : encrypted;

  const keyMap = parseKeyMap(secret);
  const rawKey = keyMap[version];
  if (!rawKey) throw new Error(`No decryption key found for ciphertext version ${version}`);

  const key = await deriveKey(rawKey, version);
  const combined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/**
 * Encrypt email with AES-GCM.
 * Returns `{version}:{base64(iv + ciphertext)}` using the active key version.
 *
 * Email is normalized (`.trim().toLowerCase()`) before encryption so ciphertext
 * matches the peppered-hash normalization — this is intentional for email and is
 * byte-for-byte identical to the pre-refactor behaviour. For non-email PII where
 * case/whitespace must be preserved, use {@link encryptText} directly.
 *
 * `secret` may be a plain string (legacy v1) or a JSON key map
 * `{"v1":"oldkey","v2":"newkey"}` — active version is the highest numbered key.
 */
export function encryptEmail(email: string, secret: string): Promise<string> {
  return encryptText(email.trim().toLowerCase(), secret);
}

/**
 * Decrypt email from AES-GCM ciphertext.
 * Accepts versioned format (`v1:base64`) and legacy unversioned base64.
 *
 * `secret` may be a plain string (legacy v1) or a JSON key map — the version
 * prefix in the ciphertext selects which key to use.
 */
export function decryptEmail(encrypted: string, secret: string): Promise<string> {
  return decryptText(encrypted, secret);
}
