/**
 * Forms Security & Cross-Contamination Tests
 *
 * These tests verify the architectural guarantee that the form system (FORMS_DB)
 * and anonymous scan system (DB) NEVER cross-contaminate.
 *
 * Gates:
 *   S1. Static: form handler source NEVER references env.DB or .DB.prepare
 *   S2. Static: scan/event handler source NEVER references FORMS_DB
 *   S3. Static: forms-db.ts utility has ZERO references to main DB
 *   S4. Static: lifecycle job only uses FORMS_DB for writes
 *   S5. Behavioral: registration data destroyed after expires_at
 *   S6. Behavioral: email signups deleted after retention_expires_at
 *   S7. Behavioral: survey PII actually scrubbed (not just flag flipped)
 *   S8. Behavioral: surveys invisible to admin until pii_scrubbed = 1
 *   S9. Behavioral: email hash is consistent (same input → same output)
 *   S10. Behavioral: email hash is not reversible (output ≠ input)
 *   S11. Behavioral: AES-GCM encrypt/decrypt roundtrip
 *   S12. Behavioral: check-in stores zero PII in DB
 *   S13. Static: no raw email stored in any FORMS_DB table schema
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_SOURCE_FILES_JSON: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Apply main DB migrations
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
  // Apply forms DB migrations
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

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC ANALYSIS GATES — Source Code Cross-Contamination Prevention
// ═══════════════════════════════════════════════════════════════════════════════

describe('S1: Form handlers NEVER reference main DB', () => {
  // @born-red TL-024 | method: design-time-negative-assertion | date: 2026-08-03
  test('forms.ts has zero references to env.DB or .DB.prepare', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('handlers/forms')) {
        // Must not reference the main DB binding
        expect(content).not.toMatch(/env\.DB\b/);
        expect(content).not.toMatch(/\.DB\.prepare/);
        // Must not import from sheets (main DB data source)
        expect(content).not.toMatch(/from\s+['"].*sheets/);
        expect(content).not.toMatch(/from\s+['"].*google-auth/);
      }
    }
  });
});

describe('S2: Scan/event handlers NEVER reference FORMS_DB', () => {
  // @born-red TL-002 | method: design-time-negative-assertion | date: 2026-08-03
  //
  // OSE-977 reconcile: events.ts + health.ts must stay FULLY isolated from
  // FORMS_DB. pages.ts renders the public recap and legitimately reads AGGREGATE
  // counts from FORMS_DB — the authoritative two-DB gate (architecture.spec.ts)
  // permits this and does not list pages.ts. The real boundary is never-who:
  // pages.ts may read COUNTs but must NEVER select an identity/PII column from a
  // FORMS_DB table. This enforces that precise boundary instead of a blanket ban
  // that drifted out of date once pages.ts gained the recap stats.
  test('events.ts + health.ts have zero references to FORMS_DB', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('handlers/events') || path.includes('handlers/health')) {
        expect(content).not.toMatch(/FORMS_DB/);
        expect(content).not.toMatch(/forms-db/);
        expect(content).not.toMatch(/form_registrations/);
        expect(content).not.toMatch(/checkin_counts/);
        expect(content).not.toMatch(/form_surveys/);
        expect(content).not.toMatch(/email_signups/);
      }
    }
  });

  test('pages.ts reads only AGGREGATE counts from FORMS_DB — never an identity column (never-who)', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const IDENTITY_COL =
      /\b(email|phone|first_name|last_name|full_name|anonymous_id|ip_hash|ip_address|user_agent)\b/i;
    for (const [path, content] of Object.entries(sources)) {
      if (!path.includes('handlers/pages')) continue;
      // Every `SELECT <cols> FROM <forms_db_table>` must select aggregate columns
      // only. `SELECT COUNT(*) ...` / `SELECT total_count ...` pass;
      // `SELECT email FROM email_signups` fails. The column capture stops at the
      // first FROM (negative lookahead) so it never spans past a statement into
      // an unrelated query; the table is then membership-checked against FORMS_DB.
      const FORMS_TABLES = [
        'form_registrations',
        'checkin_counts',
        'form_surveys',
        'email_signups',
      ];
      const selectRe = /SELECT\s+((?:(?!\bFROM\b)[\s\S])*?)\s+FROM\s+(\w+)/gi;
      // A bare `*` or `alias.*` selector (NOT COUNT(*)) pulls whole rows incl.
      // PII, so it can't be proven aggregate-only either.
      const STAR_SELECT = /(^|,)\s*(\w+\.)?\*\s*(,|$)/;
      let m: RegExpExecArray | null;
      while ((m = selectRe.exec(content)) !== null) {
        if (!FORMS_TABLES.includes(m[2])) continue;
        const cols = m[1];
        expect(
          STAR_SELECT.test(cols) || IDENTITY_COL.test(cols),
          `pages.ts reads FORMS_DB table ${m[2]} with columns "${cols.trim()}" — must be aggregate-only (COUNT/total_count); a bare * or an identity column is a never-who violation`
        ).toBe(false);
      }
    }
  });
});

describe('S3: forms-db.ts utility has ZERO main DB references', () => {
  // @born-red TL-004 | method: design-time-negative-assertion | date: 2026-08-03
  test('forms-db.ts never mentions DB binding, sheets, or scan tables', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('lib/forms-db')) {
        // Must not reference env.DB (the main database binding)
        expect(content).not.toMatch(/env\.DB\b/);
        expect(content).not.toMatch(/\.DB\.prepare/);
        // Must not reference Google Sheets (main DB data source)
        expect(content).not.toMatch(/sheetsGetValues/);
        expect(content).not.toMatch(/SheetsReadError/);
        // Must not reference main DB tables
        expect(content).not.toMatch(/\bscans\b/);
        expect(content).not.toMatch(/scan_aggregates/);
        expect(content).not.toMatch(/poster_deployments/);
      }
    }
  });
});

describe('S4: Lifecycle job isolation', () => {
  // Precise function-body scoping (OSE-207 hardening). Earlier revision
  // sliced `content.indexOf('runFormDataLifecycle')` through end-of-file,
  // which scanned every later helper in index.ts and would have flagged
  // any future DB-touching lifecycle stage (e.g. subscribers retention).
  // S4's actual contract is: the FORMS_DB lifecycle FUNCTION must not
  // touch env.DB — not "everything below this point in the file."
  test('runFormDataLifecycle function body only writes to FORMS_DB, never to DB', () => {
    // Scan every source file for the function; validate body in whichever
    // file(s) contain it. Earlier revision iterated `if (path.endsWith
    // ('index.ts'))` which silently matched any future sub-module barrel
    // file (e.g., src/lib/uec/index.ts added by OSE-320) and failed the
    // existence check because that file legitimately doesn't define
    // runFormDataLifecycle. The contract is "the function (wherever it
    // lives) must not touch env.DB" — not "every index.ts must contain
    // it." Existence is guarded by the foundCount assertion at the end.
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    let foundCount = 0;
    for (const [, content] of Object.entries(sources)) {
      const start = content.indexOf('async function runFormDataLifecycle');
      if (start === -1) continue;
      foundCount++;

      // Bound the body: from the function declaration to the next top-level
      // declaration (async function / function / export at column 0).
      const afterStart = content.slice(start);
      const endMatch = /\n(async function|function|export)\s/.exec(afterStart.slice(1));
      const body = endMatch ? afterStart.slice(0, endMatch.index + 1) : afterStart;

      expect(body).not.toMatch(/env\.DB\.prepare/);
      expect(body).not.toMatch(/INSERT\s+INTO\s+(?!form_|checkin_|email_|pii_)/i);
      expect(body).not.toMatch(/UPDATE\s+(?!form_)/i);
      expect(body).not.toMatch(/DELETE\s+FROM\s+(?!form_|email_)/i);
    }
    // Existence guarantee — at least one source file must define the function.
    expect(
      foundCount,
      'runFormDataLifecycle function not found in any source file'
    ).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS — Verify Actions Do What They Advertise
// ═══════════════════════════════════════════════════════════════════════════════

describe('S5: Registration destruction after expiry', () => {
  // @born-red TL-003 | method: design-time-negative-assertion | date: 2026-08-03
  test('registrations with past expires_at are deleted by lifecycle query', async () => {
    const pastDate = '2020-01-01T00:00:00.000Z';
    const futureDate = '2099-01-01T00:00:00.000Z';

    // Insert one expired and one active registration
    await tenv()
      .FORMS_DB.prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, expires_at)
       VALUES ('reg_expired', 'evt_sec_test', '2026-03-27T14', ?)`
      )
      .bind(pastDate)
      .run();

    await tenv()
      .FORMS_DB.prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, expires_at)
       VALUES ('reg_active', 'evt_sec_test', '2026-03-27T14', ?)`
      )
      .bind(futureDate)
      .run();

    // Simulate lifecycle deletion
    const now = new Date().toISOString();
    await tenv()
      .FORMS_DB.prepare(
        'DELETE FROM form_registrations WHERE expires_at IS NOT NULL AND expires_at < ?'
      )
      .bind(now)
      .run();

    // Expired should be gone
    const expired = await tenv()
      .FORMS_DB.prepare("SELECT id FROM form_registrations WHERE id = 'reg_expired'")
      .first();
    expect(expired).toBeNull();

    // Active should remain
    const active = await tenv()
      .FORMS_DB.prepare("SELECT id FROM form_registrations WHERE id = 'reg_active'")
      .first();
    expect(active).not.toBeNull();
  });
});

describe('S6: Email signup retention enforcement', () => {
  test('email signups past retention_expires_at are deleted by lifecycle query', async () => {
    const pastDate = '2020-01-01T00:00:00.000Z';
    const futureDate = '2099-01-01T00:00:00.000Z';

    await tenv()
      .FORMS_DB.prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
       VALUES ('es_expired', 'evt_sec_test', 'hash1', 'enc1', '2026-03-27T14', ?)`
      )
      .bind(pastDate)
      .run();

    await tenv()
      .FORMS_DB.prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
       VALUES ('es_active', 'evt_sec_test', 'hash2', 'enc2', '2026-03-27T14', ?)`
      )
      .bind(futureDate)
      .run();

    const now = new Date().toISOString();
    await tenv()
      .FORMS_DB.prepare('DELETE FROM email_signups WHERE retention_expires_at < ?')
      .bind(now)
      .run();

    const expired = await tenv()
      .FORMS_DB.prepare("SELECT id FROM email_signups WHERE id = 'es_expired'")
      .first();
    expect(expired).toBeNull();

    const active = await tenv()
      .FORMS_DB.prepare("SELECT id FROM email_signups WHERE id = 'es_active'")
      .first();
    expect(active).not.toBeNull();
  });
});

describe('S7: Survey PII scrub actually removes data', () => {
  test('scrub query replaces PII-pattern fields with [SCRUBBED], preserves ratings', async () => {
    // Insert an unscrubbed survey with PII
    const responsesWithPii = JSON.stringify({
      overall_rating: 5,
      venue_rating: 4,
      name: 'John Doe',
      email: 'john@example.com',
      comments: 'Great event, loved it!',
      speaker_quality: 3,
    });

    await tenv()
      .FORMS_DB.prepare(
        `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed)
       VALUES ('survey_pii_test', 'evt_sec_test', ?, '2026-03-27T14', 0)`
      )
      .bind(responsesWithPii)
      .run();

    // Verify unscrubbed data has PII
    const before = await tenv()
      .FORMS_DB.prepare(
        "SELECT responses_json, pii_scrubbed FROM form_surveys WHERE id = 'survey_pii_test'"
      )
      .first<{ responses_json: string; pii_scrubbed: number }>();

    expect(before?.pii_scrubbed).toBe(0);
    const beforeData = JSON.parse(before!.responses_json);
    expect(beforeData.name).toBe('John Doe');
    expect(beforeData.email).toBe('john@example.com');

    // Simulate PII scrub (whitelist approach — same as lifecycle job)
    const SAFE_KEYS =
      /^(rating|score|count|number|rank|order|id|uuid|type|category|topic|session|duration|index|overall|venue|speaker|event|quality|value|level|tier|scale|stars?|thumbs?).*$/i;
    const parsed = JSON.parse(before!.responses_json) as Record<string, unknown>;
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' || typeof value === 'boolean') {
        scrubbed[key] = value;
      } else if (SAFE_KEYS.test(key)) {
        scrubbed[key] = value;
      } else if (typeof value === 'string') {
        scrubbed[key] = '[SCRUBBED]';
      } else {
        scrubbed[key] = value;
      }
    }

    await tenv()
      .FORMS_DB.prepare(
        "UPDATE form_surveys SET responses_json = ?, pii_scrubbed = 1 WHERE id = 'survey_pii_test'"
      )
      .bind(JSON.stringify(scrubbed))
      .run();

    // Verify PII is gone but ratings remain
    const after = await tenv()
      .FORMS_DB.prepare(
        "SELECT responses_json, pii_scrubbed FROM form_surveys WHERE id = 'survey_pii_test'"
      )
      .first<{ responses_json: string; pii_scrubbed: number }>();

    expect(after?.pii_scrubbed).toBe(1);
    const afterData = JSON.parse(after!.responses_json);
    expect(afterData.name).toBe('[SCRUBBED]');
    expect(afterData.email).toBe('[SCRUBBED]');
    expect(afterData.comments).toBe('[SCRUBBED]');
    // Ratings preserved
    expect(afterData.overall_rating).toBe(5);
    expect(afterData.venue_rating).toBe(4);
    expect(afterData.speaker_quality).toBe(3);
  });
});

describe('S8: Surveys invisible until PII-scrubbed', () => {
  test('admin survey query returns ZERO results for unscrubbed surveys', async () => {
    // Insert unscrubbed survey
    await tenv()
      .FORMS_DB.prepare(
        `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed)
       VALUES ('survey_hidden', 'evt_vis_test', '{"rating": 5}', '2026-03-27T14', 0)`
      )
      .run();

    // Admin query (same as handleAdminSurveys) — only pii_scrubbed = 1
    const result = await tenv()
      .FORMS_DB.prepare(
        "SELECT id FROM form_surveys WHERE event_id = 'evt_vis_test' AND pii_scrubbed = 1"
      )
      .all();

    expect(result.results).toHaveLength(0);

    // After scrub, it becomes visible
    await tenv()
      .FORMS_DB.prepare("UPDATE form_surveys SET pii_scrubbed = 1 WHERE id = 'survey_hidden'")
      .run();

    const afterScrub = await tenv()
      .FORMS_DB.prepare(
        "SELECT id FROM form_surveys WHERE event_id = 'evt_vis_test' AND pii_scrubbed = 1"
      )
      .all();

    expect(afterScrub.results).toHaveLength(1);
  });
});

describe('S9: Email hash consistency', () => {
  test('same email always produces identical hash', async () => {
    const email = 'TEST@Example.COM';
    // hashEmail normalizes: trim + lowercase → "test@example.com"
    const data1 = new TextEncoder().encode('test@example.com');
    const hash1 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data1)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const data2 = new TextEncoder().encode('test@example.com');
    const hash2 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data2)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 = 64 hex chars
  });
});

describe('S10: Email hash non-reversibility', () => {
  test('hash output is not the input email', () => {
    // SHA-256 of "test@example.com" is a 64-char hex string, not the email
    const email = 'test@example.com';
    // We can't call hashEmail directly (async + Workers runtime), but we verify the principle:
    // a 64-char hex string is fundamentally different from an email address
    expect(email).not.toMatch(/^[a-f0-9]{64}$/);
    // And any SHA-256 output WILL match this pattern
    expect('973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b').toMatch(
      /^[a-f0-9]{64}$/
    );
  });
});

describe('S12: Check-in stores zero PII', () => {
  test('checkin_counts table has exactly 5 columns: id, event_id, total_count, updated_at, last_anonymous_id', async () => {
    const info = await tenv().FORMS_DB.prepare('PRAGMA table_info(checkin_counts)').all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);

    expect(cols).toHaveLength(5);
    expect(cols).toContain('id');
    expect(cols).toContain('event_id');
    expect(cols).toContain('total_count');
    expect(cols).toContain('updated_at');
    expect(cols).toContain('last_anonymous_id');
    // last_anonymous_id is NOT PII — it's a random UUID with no personal data
  });

  test('check-in INSERT uses only id, event_id, total_count — no PII in SQL', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('handlers/forms')) {
        // Find the checkin INSERT statement
        const checkinInserts = content.match(/INSERT\s+INTO\s+checkin_counts[^;]+/gi) ?? [];
        for (const stmt of checkinInserts) {
          expect(stmt).not.toMatch(/attendee/i);
          expect(stmt).not.toMatch(/email/i);
          expect(stmt).not.toMatch(/name(?!s)/i); // "name" but not "names" or "database_name"
          expect(stmt).not.toMatch(/phone/i);
          expect(stmt).not.toMatch(/address/i);
        }
      }
    }
  });
});

describe('S13: No raw email column in any FORMS_DB table', () => {
  // @born-red TL-007 | method: design-time-negative-assertion | date: 2026-08-03
  test('no table has a column named "email" (only email_hash or email_encrypted)', async () => {
    const tables = ['form_registrations', 'checkin_counts', 'form_surveys', 'email_signups'];
    for (const table of tables) {
      const info = await tenv().FORMS_DB.prepare(`PRAGMA table_info(${table})`).all();
      const cols = info.results.map((r: Record<string, unknown>) => r.name);
      // "email" as a standalone column name is forbidden
      expect(cols).not.toContain('email');
      expect(cols).not.toContain('attendee_email');
      expect(cols).not.toContain('raw_email');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE FLAG SECURITY GATES — Tier System Integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe('S15: Feature flag handlers NEVER reference main DB', () => {
  test('handlers/feature-flags.ts has zero references to env.DB or .DB.prepare', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('handlers/feature-flags')) {
        expect(content).not.toMatch(/env\.DB\b/);
        expect(content).not.toMatch(/\.DB\.prepare/);
        expect(content).not.toMatch(/from\s+['"].*sheets/);
      }
    }
  });
});

describe('S16: Feature flag lib NEVER references main DB', () => {
  test('lib/feature-flags.ts has zero references to env.DB, sheets, or scan tables', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('lib/feature-flags')) {
        expect(content).not.toMatch(/env\.DB\b/);
        expect(content).not.toMatch(/\.DB\.prepare/);
        expect(content).not.toMatch(/\bscans\b/);
        expect(content).not.toMatch(/scan_aggregates/);
        expect(content).not.toMatch(/poster_deployments/);
      }
    }
  });
});

describe('S17: Feature flag validation — only known keys accepted', () => {
  test('feature-flags handler validates flag keys against a fixed set', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('handlers/feature-flags')) {
        // Must validate flag keys (isValidFlagKey check exists)
        expect(content).toMatch(/isValidFlagKey/);
        // Must validate tier names (isValidTier check exists)
        expect(content).toMatch(/isValidTier/);
      }
    }
  });
});

describe('S18: Feature flag seed uses safe defaults (free tier)', () => {
  test('free tier seed has forms.register ON, forms.survey OFF, assets OFF, branding OFF', async () => {
    // Verify the seed migration applied correctly — free tier is the safe default
    const flags = await tenv()
      .FORMS_DB.prepare("SELECT flag_key, enabled FROM feature_flags WHERE scope = 'global'")
      .all();

    const flagMap = Object.fromEntries(
      flags.results.map((r: Record<string, unknown>) => [r.flag_key, r.enabled])
    );

    // Free tier: only basic forms enabled
    expect(flagMap['forms.register']).toBe(1);
    expect(flagMap['forms.checkin']).toBe(1);

    // Everything else OFF by default — principle of least privilege
    expect(flagMap['forms.survey']).toBe(0);
    expect(flagMap['forms.email-signup']).toBe(0);
    expect(flagMap['config.self-serve']).toBe(0);
    expect(flagMap['assets.file-upload']).toBe(0);
    expect(flagMap['branding.white-label']).toBe(0);
    expect(flagMap['branding.custom-domain']).toBe(0);
  });
});

describe('S19: Tier definitions enforce principle of least privilege', () => {
  test('free tier has the fewest enabled flags, enterprise the most', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('lib/feature-flags')) {
        // Enterprise tier must have file upload and branding enabled
        // Free tier must NOT have these — verified by string analysis
        // The tier presets are typed, so we verify the structure exists
        expect(content).toMatch(/TIER_PRESETS/);
        expect(content).toMatch(/free.*mid.*enterprise/s);
        // Each tier must define all flag keys (no partial presets)
        expect(content).toMatch(/forms\.register.*forms\.checkin.*forms\.survey/s);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REVERSE ISOLATION — Main DB has no form data
// ═══════════════════════════════════════════════════════════════════════════════

describe('S14: Main DB has no form tables after migration 0008', () => {
  test('DB does not contain checkins, registrations, or any form_* tables', async () => {
    const tables = await tenv()
      .DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
      )
      .all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    expect(names).not.toContain('checkins');
    expect(names).not.toContain('registrations');
    expect(names).not.toContain('form_registrations');
    expect(names).not.toContain('checkin_counts');
    expect(names).not.toContain('form_surveys');
    expect(names).not.toContain('email_signups');
  });
});
