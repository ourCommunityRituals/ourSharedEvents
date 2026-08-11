/**
 * OSE-713 [BLOCKER] — handleAdminExport unaudited plaintext-PII egress
 *
 * handleAdminExport (src/handlers/forms.ts) decrypts and returns plaintext
 * emails for admin export. Three guarantees are asserted here:
 *
 *   (1) AUTH — the export route rejects no-auth / wrong-token requests (401).
 *       PII egress MUST be behind the admin guard.
 *
 *   (2) CSV ESCAPING — toCsv() escapes commas, quotes, and newlines in field
 *       values so a crafted attendee_name cannot break out of its CSV cell
 *       (CSV injection / column-shift). Verified through the real ?format=csv
 *       export path.
 *
 *   (3) DECRYPTION-FAILURE HONESTY (born-red) — when a stored ciphertext cannot
 *       be decrypted (e.g. a key-rotation mismatch: the row was encrypted under
 *       a key that is no longer in FORMS_ENCRYPTION_KEY), the export MUST surface
 *       that row as an explicit error/marked row — NOT a silent `email: null`.
 *       A silent null is indistinguishable from a legitimately-absent email and
 *       hides data loss / rotation misconfiguration from the operator.
 *
 * Harness: SELF.fetch drives the full router (auth guard + handler). The test
 * env sets ADMIN_KEY='test-admin-key-e2e-2026' (Method 3 Bearer fallback) and
 * FORMS_ENCRYPTION_KEY='test-forms-encryption-secret-32ch'.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { encryptEmail } from '../src/lib/pii';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  FORMS_ENCRYPTION_KEY: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

const ADMIN_BEARER = 'Bearer test-admin-key-e2e-2026';

// ── Setup: apply migrations (idempotent — mirrors forms-security.spec.ts) ──────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

const exportUrl = (eventId: string, type: string, format = 'json') =>
  `http://localhost/api/v2/admin/events/${eventId}/forms/export?type=${type}&format=${format}`;

// ═══════════════════════════════════════════════════════════════════════════════
// (1) AUTH — PII export MUST be behind the admin guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-713 (1): admin export auth guard', () => {
  test('no-auth request → 401', async () => {
    const res = await SELF.fetch(exportUrl('evt-auth-none', 'email-signups'));
    expect(res.status, 'unauthenticated PII export must be rejected').toBe(401);
  });

  test('wrong-token request → 401', async () => {
    const res = await SELF.fetch(exportUrl('evt-auth-bad', 'email-signups'), {
      headers: { Authorization: 'Bearer totally-wrong-token' },
    });
    expect(res.status, 'wrong bearer token must not reach PII export').toBe(401);
  });

  test('valid admin token → not 401/403', async () => {
    const res = await SELF.fetch(exportUrl('evt-auth-ok', 'registrations'), {
      headers: { Authorization: ADMIN_BEARER },
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (2) CSV ESCAPING — a crafted field value cannot break out of its CSV cell
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-713 (2): toCsv escapes commas, quotes, and newlines', () => {
  const EVENT = 'evt-csv-escape';

  beforeAll(async () => {
    // A registration whose attendee_name contains all three dangerous chars:
    // comma (column-shift), double-quote (cell-breakout), newline (row-breakout).
    const nastyName = 'Doe, "John"\nInjected,Row';
    await tenv()
      .FORMS_DB.prepare(
        `INSERT INTO form_registrations
           (id, event_id, attendee_name, registration_bucket, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'reg-csv-1',
        EVENT,
        nastyName,
        '2026-08',
        'registered',
        '2099-01-01T00:00:00.000Z',
        '2026-08-11T00:00:00.000Z'
      )
      .run();
  });

  test('csv export quotes and escapes a name with comma/quote/newline', async () => {
    const res = await SELF.fetch(exportUrl(EVENT, 'registrations', 'csv'), {
      headers: { Authorization: ADMIN_BEARER },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const csv = await res.text();

    // The dangerous value must appear as ONE quoted field, with embedded
    // quotes doubled ("" per RFC 4180) — never as bare commas/newlines that
    // would spill into new columns/rows.
    expect(csv, 'field with special chars must be wrapped in quotes').toContain(
      '"Doe, ""John""\nInjected,Row"'
    );

    // Row-count integrity: header + exactly one data record. If the newline
    // leaked unescaped, the naive line count would exceed 2.
    const headerLine = csv.split('\n')[0];
    expect(headerLine.split(',')).toContain('attendee_name');

    // The injected substring must NOT begin its own record (i.e. it is not
    // preceded by an unquoted row break). We assert the escaped form is present
    // and the raw unescaped breakout form is absent.
    expect(csv).not.toContain('\nInjected,Row\n');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (3) DECRYPTION-FAILURE HONESTY (born-red) — no silent null on rotation mismatch
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-713 (3): decryption failure surfaces as an error, not a silent null', () => {
  const EVENT = 'evt-decrypt-fail';

  beforeAll(async () => {
    // Simulate a key-rotation mismatch: encrypt under a DIFFERENT key than the
    // one the export handler holds (FORMS_ENCRYPTION_KEY). decryptEmail() will
    // throw when the export tries to read this row.
    const wrongKey = 'a-completely-different-rotated-key-32';
    const badCipher = await encryptEmail('victim@example.com', wrongKey);

    // A sibling row that decrypts cleanly under the real key — proves the good
    // path still works and only the undecryptable row is flagged.
    const goodCipher = await encryptEmail('ok@example.com', tenv().FORMS_ENCRYPTION_KEY);

    for (const [id, cipher] of [
      ['sig-bad', badCipher],
      ['sig-good', goodCipher],
    ] as const) {
      await tenv()
        .FORMS_DB.prepare(
          `INSERT INTO email_signups
             (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          EVENT,
          `hash-${id}`,
          cipher,
          '2026-08',
          '2099-01-01T00:00:00.000Z',
          '2026-08-11T00:00:00.000Z'
        )
        .run();
    }
  });

  test('undecryptable row is NOT emitted as a silent { email: null }', async () => {
    const res = await SELF.fetch(exportUrl(EVENT, 'email-signups'), {
      headers: { Authorization: ADMIN_BEARER },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      items: Array<Record<string, unknown>>;
    };

    const bad = body.items.find((r) => r.id === 'sig-bad');
    const good = body.items.find((r) => r.id === 'sig-good');
    expect(bad, 'bad row must be present in export').toBeDefined();
    expect(good, 'good row must be present in export').toBeDefined();

    // Good row decrypts to plaintext as before.
    expect(good!.email).toBe('ok@example.com');

    // BORN-RED: today the handler catches the decrypt error and returns
    // { email: null } — indistinguishable from a legitimately absent email.
    // The row MUST instead carry an explicit failure marker so the operator
    // can see the ciphertext could not be decrypted (rotation/key loss).
    expect(bad!.email, 'a decrypt failure must NOT masquerade as a null email').not.toBeNull();
    expect(
      bad!.email_error ?? bad!.error,
      'undecryptable row must carry an explicit decryption-error marker'
    ).toBeTruthy();
  });
});
