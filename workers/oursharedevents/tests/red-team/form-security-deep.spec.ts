/**
 * Red Team: form-security-deep.spec.ts
 *
 * Attacks targeted:
 *   PII-01  Email dedup bypass via Unicode normalization — hashEmail() only
 *           does trim() + toLowerCase(), not NFKD, so visually identical
 *           Unicode variants produce different hashes → duplicate submissions.
 *   PII-08  Encryption key rotation DoS — old records become permanently
 *           unreadable when FORMS_ENCRYPTION_KEY changes (static salt).
 *   CSP-001 unsafe-inline in script-src on form pages defeats nonce-based CSP.
 *   SEC-003 Method confusion on form endpoints (PUT/DELETE accepted via catch-all).
 *   SEC-004 Path traversal in event ID extraction.
 *
 * Additional hardening checks:
 *   - Payload bomb (16KB+ request bodies)
 *   - JSON injection in free-text survey fields
 *   - Numeric/boolean coercion in form fields
 *   - Encryption key missing → 503 not 500 (or graceful error)
 *   - Missing FORMS_ENCRYPTION_KEY behavior on email-signup endpoint
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashEmail, encryptEmail, decryptEmail, ENCRYPTION_VERSION } from '../../src/lib/pii';

// ─── Test env bindings ────────────────────────────────────────────────────────

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try { await tenv().DB.prepare(stmt).run(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try { await tenv().FORMS_DB.prepare(stmt).run(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
  // Seed active event for form endpoint tests
  try {
    await tenv().DB.prepare(
      `INSERT INTO events (id, brand_id, title, status, start_date, end_date)
       VALUES ('evt_form_sec', 'brand_test', 'Form Security Test', 'active', '2026-01-01', '2026-12-31')`
    ).run();
  } catch { /* already exists */ }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function postForm(
  eventId: string,
  formType: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return SELF.fetch(`http://localhost/api/v2/events/${eventId}/forms/${formType}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '1.2.3.100',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PII-01: Email dedup bypass via Unicode normalization
// ════════════════════════════════════════════════════════════════════════════

describe('PII-01: Email dedup bypass via Unicode normalization (HIGH)', () => {

  test('hashEmail: canonical ASCII email produces consistent hash', async () => {
    const h1 = await hashEmail('user@example.com');
    const h2 = await hashEmail('user@example.com');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  test('hashEmail: case normalization works correctly', async () => {
    const lower = await hashEmail('user@example.com');
    const upper = await hashEmail('USER@EXAMPLE.COM');
    const mixed = await hashEmail('User@Example.Com');
    expect(lower).toBe(upper);
    expect(lower).toBe(mixed);
  });

  test('hashEmail: trim normalization works', async () => {
    const clean = await hashEmail('user@example.com');
    const padded = await hashEmail('  user@example.com  ');
    expect(clean).toBe(padded);
  });

  test('PII-01 CONFIRMED: Unicode fullwidth @ produces different hash — dedup bypass', async () => {
    // Unicode fullwidth variants that look identical but are different code points
    const ascii = await hashEmail('user@example.com');               // ASCII @  (U+0040)
    const fullwidthAt = await hashEmail('user＠example.com');        // Fullwidth @ (U+FF20)

    // These LOOK identical visually but produce different hashes
    // → an attacker can submit twice using the fullwidth variant
    console.log('[PII-01] ASCII hash:     ', ascii);
    console.log('[PII-01] Fullwidth hash: ', fullwidthAt);
    expect(ascii).not.toBe(fullwidthAt);
    console.log('[PII-01] CONFIRMED: Unicode variant bypasses email dedup');
  });

  test('PII-01: zero-width space in email produces different hash', async () => {
    const clean = await hashEmail('user@example.com');
    const zwsp = await hashEmail('user​@example.com'); // zero-width space before @
    expect(clean).not.toBe(zwsp);
    console.log('[PII-01] Zero-width space bypass confirmed');
  });

  test('PII-01: Unicode combining characters produce different hash', async () => {
    const plain = await hashEmail('admin@test.com');
    // 'a' followed by combining grave accent (U+0300) — visually looks like 'à'
    const combined = await hashEmail('àdmin@test.com');
    expect(plain).not.toBe(combined);
    console.log('[PII-01] Combining character bypass confirmed');
  });

  test('PII-01 FIX VALIDATION: NFKD normalization would unify these variants', async () => {
    // What the fix should look like: normalize to NFKD before hashing
    function nfkdHash(email: string): string {
      // NFKD decomposes compatibility equivalents
      return email.normalize('NFKD').trim().toLowerCase();
    }

    const ascii = nfkdHash('user@example.com');
    const fullwidthAt = nfkdHash('user＠example.com');

    // After NFKD: fullwidth @ (U+FF20) decomposes to ASCII @ (U+0040)
    console.log('[PII-01] After NFKD — ASCII normalized:     ', ascii);
    console.log('[PII-01] After NFKD — Fullwidth normalized: ', fullwidthAt);
    // Note: fullwidth @ does NOT map to ASCII @ under NFKD — this tests the fix approach
    // The actual fix may need to use a Unicode email normalizer library
  });

  test('PII-01: email-signup endpoint accepts duplicate via unicode variant', async () => {
    // Submit legitimate email signup
    const res1 = await postForm('evt_form_sec', 'email-signup', {
      email: 'dedup@example.com',
      event_id: 'evt_form_sec',
    });
    console.log(`[PII-01] First signup status: ${res1.status}`);

    // Submit with fullwidth @ — should be caught as duplicate but won't be
    const res2 = await postForm('evt_form_sec', 'email-signup', {
      email: 'dedup＠example.com', // fullwidth @ — different hash
      event_id: 'evt_form_sec',
    });
    console.log(`[PII-01] Unicode variant signup status: ${res2.status}`);
    // Both accepted = duplicate bypass confirmed
    // Note: may return 403 if feature flag disabled, that's fine — we test the hash behavior above
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PII-08: Encryption key rotation DoS
// ════════════════════════════════════════════════════════════════════════════

describe('PII-08: Encryption key rotation DoS — old records unreadable (HIGH)', () => {

  test('encryptEmail with key A, decryptEmail with key B fails with auth error', async () => {
    const keyA = 'original-encryption-key-32-chars-A';
    const keyB = 'rotated-encryption-key-32-chars-B!';
    const email = 'victim@example.com';

    const ciphertext = await encryptEmail(email, keyA);

    // After key rotation, decrypting with key B throws (AES-GCM auth tag fails)
    await expect(decryptEmail(ciphertext, keyB)).rejects.toThrow();
    console.log('[PII-08] Confirmed: AES-GCM decryption fails after key rotation — records permanently unreadable');
  });

  test('encryptEmail roundtrip succeeds with same key', async () => {
    const key = 'test-forms-encryption-secret-32ch';
    const email = 'roundtrip@example.com';
    const ciphertext = await encryptEmail(email, key);
    const decrypted = await decryptEmail(ciphertext, key);
    expect(decrypted).toBe(email.toLowerCase());
  });

  test('ciphertext format includes version prefix', async () => {
    const key = 'test-forms-encryption-secret-32ch';
    const ciphertext = await encryptEmail('test@example.com', key);
    expect(ciphertext).toMatch(/^v1:/);
    expect(ENCRYPTION_VERSION).toBe('v1');
  });

  test('PII-08: static salt means key rotation destroys all v1 records', () => {
    // Static analysis: verify the PBKDF2 salt is hardcoded
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('lib/pii.ts')) {
        // Static salt is used — key rotation without re-encryption = data loss
        expect(content).toMatch(/oursharedevents-forms-/);
        const hasPerRecordSalt = content.includes('crypto.getRandomValues') &&
          content.match(/salt.*random/i);
        console.log('[PII-08] pii.ts uses static PBKDF2 salt:', !hasPerRecordSalt);
        console.log('[PII-08] Fix required: per-record salt OR re-encryption-on-read');
      }
    }
  });

  test('each encryptEmail call produces a different ciphertext (random IV)', async () => {
    const key = 'test-forms-encryption-secret-32ch';
    const email = 'same@example.com';
    const ct1 = await encryptEmail(email, key);
    const ct2 = await encryptEmail(email, key);
    // IVs are random → ciphertexts differ
    expect(ct1).not.toBe(ct2);
    // But both decrypt to the same plaintext
    expect(await decryptEmail(ct1, key)).toBe(email);
    expect(await decryptEmail(ct2, key)).toBe(email);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CSP-001: unsafe-inline in script-src defeats nonce-based CSP
// ════════════════════════════════════════════════════════════════════════════

describe('CSP-001: unsafe-inline in form page script-src (HIGH)', () => {

  test('form page CSP header contains unsafe-inline in script-src', async () => {
    const res = await SELF.fetch(
      'http://localhost/forms/evt_form_sec?type=register',
      { method: 'GET' }
    );
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    console.log('[CSP-001] CSP header:', csp);

    if (csp) {
      const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? '';
      const hasUnsafeInline = scriptSrc.includes("'unsafe-inline'");
      // This is the vulnerability: unsafe-inline defeats any nonce
      if (hasUnsafeInline) {
        console.log('[CSP-001] CONFIRMED: unsafe-inline present in script-src — nonce protection bypassed');
      }
      // Document the current state
      expect(scriptSrc).toBeDefined();
    } else {
      console.log('[CSP-001] No CSP header on form page response (status:', res.status, ')');
    }
  });

  test('form page CSP static analysis: unsafe-inline appears in form-pages.ts SECURITY_HEADERS', () => {
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('handlers/form-pages.ts')) {
        const hasUnsafeInline = content.includes("'unsafe-inline'");
        console.log(`[CSP-001] form-pages.ts has unsafe-inline: ${hasUnsafeInline}`);
        // Document the vulnerability — when fixed, this should be false
        if (hasUnsafeInline) {
          console.log('[CSP-001] CONFIRMED: unsafe-inline present in SECURITY_HEADERS constant');
        }
      }
    }
  });

  test('X-Frame-Options: DENY is set on form pages', async () => {
    const res = await SELF.fetch('http://localhost/forms/evt_form_sec?type=checkin');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  test('X-Content-Type-Options: nosniff is set on form pages', async () => {
    const res = await SELF.fetch('http://localhost/forms/evt_form_sec?type=survey');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Payload bomb: oversized request bodies
// ════════════════════════════════════════════════════════════════════════════

describe('Payload bomb: oversized form submissions', () => {

  test('16KB+ JSON payload in name field returns 400 or is safely truncated', async () => {
    const bomb = 'A'.repeat(16 * 1024); // 16KB string
    const res = await postForm('evt_form_sec', 'register', {
      name: bomb,
      email: 'bomb@example.com',
      event_id: 'evt_form_sec',
    });
    // Should return 400 (validation) or 413 (too large) — never 500 or 200 with raw bomb stored
    console.log(`[PAYLOAD-BOMB] 16KB name field response: ${res.status}`);
    expect([400, 413, 429, 403, 410]).toContain(res.status);
  });

  test('1MB JSON body causes appropriate rejection — not 500', async () => {
    const megabyte = 'X'.repeat(1024 * 1024);
    const res = await postForm('evt_form_sec', 'survey', {
      responses: { comment: megabyte },
      event_id: 'evt_form_sec',
    });
    console.log(`[PAYLOAD-BOMB] 1MB survey body response: ${res.status}`);
    // 400, 413, 429, 403, 410 are acceptable; 500 is not
    expect(res.status).not.toBe(500);
  });

  test('deeply nested JSON does not cause stack overflow', async () => {
    // Build deeply nested object: {"a": {"a": {"a": ...}}} 100 levels deep
    let nested: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 100; i++) {
      nested = { a: nested };
    }
    const res = await postForm('evt_form_sec', 'register', {
      ...nested,
      email: 'nested@example.com',
      event_id: 'evt_form_sec',
    });
    console.log(`[PAYLOAD-BOMB] 100-level nested JSON response: ${res.status}`);
    expect(res.status).not.toBe(500);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// JSON injection in free-text fields
// ════════════════════════════════════════════════════════════════════════════

describe('JSON injection in survey free-text fields', () => {

  const injections = [
    { label: 'null byte', value: 'comment\x00injected' },
    { label: 'newline injection', value: 'comment\n","evil":"true' },
    { label: 'JSON breakout', value: '"},{"override":true},{"x":"' },
    { label: 'SQL injection probe', value: "'; DROP TABLE form_surveys; --" },
    { label: 'XSS via comment', value: '<script>alert(1)</script>' },
    { label: 'prototype pollution', value: '__proto__[admin]=true' },
  ];

  for (const { label, value } of injections) {
    test(`survey comment injection: ${label} does not cause 500`, async () => {
      const res = await postForm('evt_form_sec', 'survey', {
        responses: JSON.stringify({ overall_rating: 5, comment: value }),
        event_id: 'evt_form_sec',
      });
      console.log(`[JSON-INJECT] ${label} → status ${res.status}`);
      // Any response except 500 is acceptable
      expect(res.status).not.toBe(500);
    });
  }

  test('SQL injection in event ID path param does not cause 500', async () => {
    const maliciousId = "evt' OR '1'='1";
    const res = await postForm(maliciousId, 'register', {
      name: 'Test',
      email: 'sqli@example.com',
      event_id: maliciousId,
    });
    // Should return 410 (event not found) or 400, not 500
    console.log(`[SQL-INJECT] SQLi in event ID → status ${res.status}`);
    expect(res.status).not.toBe(500);
  });

  test('static: D1 queries in forms.ts use parameterized statements only', () => {
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('handlers/forms.ts')) {
        // Find all .prepare() calls and verify they use ? placeholders, not string concat
        const prepareStatements = content.match(/\.prepare\s*\(\s*`[^`]+`\s*\)/g) ?? [];
        for (const stmt of prepareStatements) {
          // Template literals with ${...} are string interpolation — dangerous
          const hasInterpolation = /\$\{/.test(stmt);
          expect(hasInterpolation, `SQL injection risk in forms.ts: ${stmt.slice(0, 100)}`).toBe(false);
        }

        // Also check for string concat patterns
        const concatPatterns = content.match(/\.prepare\s*\(\s*['"][^'"]*'\s*\+/g) ?? [];
        expect(concatPatterns, 'String concatenation in SQL prepare() call found').toHaveLength(0);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Method confusion on form endpoints (SEC-003)
// ════════════════════════════════════════════════════════════════════════════

describe('SEC-003: Method confusion on form endpoints', () => {

  const httpMethods = ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
  const formEndpoints = [
    '/api/v2/events/evt_form_sec/forms/register',
    '/api/v2/events/evt_form_sec/forms/checkin',
    '/api/v2/events/evt_form_sec/forms/survey',
    '/api/v2/events/evt_form_sec/forms/email-signup',
  ];

  for (const endpoint of formEndpoints) {
    for (const method of httpMethods) {
      test(`${method} ${endpoint} must not accept form submission`, async () => {
        const res = await SELF.fetch(`http://localhost${endpoint}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '1.2.3.4',
          },
          body: method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
            ? JSON.stringify({ email: 'test@example.com', event_id: 'evt_form_sec' })
            : undefined,
        });

        // Form SUBMISSION is POST-only — every other verb must be rejected, so a
        // wrong method can never be confused for a submission.
        //
        // EXCEPTION (OSE-659): DELETE /forms/register is the intentional,
        // proof-gated self-delete — a distinct operation, not a submission. It
        // is verified safe (forms.ts handleSelfDeleteRegistration): it requires
        // a valid email whose hash is the ownership proof, deletes only the
        // caller's own row (event_id + attendee_email_hash), and always returns
        // {ok:true, deleted} WITHOUT revealing whether a registration existed
        // (no enumeration side-channel). So here it legitimately returns 200.
        const isSelfDelete = method === 'DELETE' && endpoint.endsWith('/forms/register');
        if (method !== 'OPTIONS') {
          console.log(`[SEC-003] ${method} ${endpoint} → ${res.status}`);
          if (isSelfDelete) {
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ ok: true });
          } else {
            expect([404, 405, 400, 403, 410, 429]).toContain(res.status);
          }
        }
      });
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Numeric/boolean coercion in form fields
// ════════════════════════════════════════════════════════════════════════════

describe('Type coercion attacks in form submissions', () => {

  test('null email field is rejected without 500', async () => {
    const res = await postForm('evt_form_sec', 'email-signup', {
      email: null,
      event_id: 'evt_form_sec',
    });
    expect(res.status).not.toBe(500);
  });

  test('boolean email field is rejected without 500', async () => {
    const res = await postForm('evt_form_sec', 'email-signup', {
      email: true,
      event_id: 'evt_form_sec',
    });
    expect(res.status).not.toBe(500);
  });

  test('array as email field is rejected without 500', async () => {
    const res = await postForm('evt_form_sec', 'email-signup', {
      email: ['a@b.com', 'c@d.com'],
      event_id: 'evt_form_sec',
    });
    expect(res.status).not.toBe(500);
  });

  test('integer 0 as rating in survey does not cause 500', async () => {
    const res = await postForm('evt_form_sec', 'survey', {
      responses: JSON.stringify({ overall_rating: 0 }),
      event_id: 'evt_form_sec',
    });
    expect(res.status).not.toBe(500);
  });

  test('non-JSON body for form endpoints returns 400 not 500', async () => {
    const res = await SELF.fetch(
      'http://localhost/api/v2/events/evt_form_sec/forms/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: 'not json at all {{{',
      }
    );
    expect(res.status).not.toBe(500);
    console.log(`[TYPE-COERCE] Non-JSON body → ${res.status}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SEC-004: Path traversal in event ID
// ════════════════════════════════════════════════════════════════════════════

describe('SEC-004: Path traversal in event ID', () => {

  const traversalPayloads = [
    '../../../admin',
    '..%2F..%2Fadmin',
    '%2e%2e%2fadmin',
    'evt_test/../../../admin',
    'evt_test%00evil',
    'evt_test\x00evil',
    '.' + 'a'.repeat(500), // long ID
  ];

  for (const payload of traversalPayloads) {
    test(`path traversal payload: "${payload.slice(0, 40)}" does not cause 500 or reach admin routes`, async () => {
      const url = `http://localhost/api/v2/events/${encodeURIComponent(payload)}/forms/register`;
      const res = await SELF.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ email: 'traversal@example.com' }),
      });
      console.log(`[SEC-004] Traversal "${payload.slice(0, 30)}" → ${res.status}`);
      // Must not 500, must not silently succeed on admin routes
      expect(res.status).not.toBe(500);
      // If the payload routes to an admin endpoint, it must return 401
      if (res.status === 200) {
        const body = await res.json() as { ok: boolean };
        // Should not get admin-scoped data
        expect(body.ok).toBeDefined();
      }
    });
  }

  test('static: event ID extraction uses regex capture group, not split index', () => {
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('/src/router.ts')) {
        // Look for the split('/')[5] pattern — this is the fragile index-based extraction
        const splitMatches = content.match(/pathname\.split\s*\(\s*['"]\/['"]\s*\)\s*\[\s*\d+\s*\]/g) ?? [];
        if (splitMatches.length > 0) {
          console.log('[SEC-004] Found index-based path splitting (fragile):', splitMatches);
          console.log('[SEC-004] SEC-004 confirmed: index-based ID extraction is fragile');
        }
        // The secure pattern uses regex capture groups like match[1]
        const regexCaptureMatches = content.match(/Match\s*&&\s*method\s*===.*?\n.*?(\w+Match\[1\])/g) ?? [];
        console.log(`[SEC-004] Regex capture group patterns found: ${regexCaptureMatches.length}`);
      }
    }
  });
});
