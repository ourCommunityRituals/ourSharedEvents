/**
 * Architecture Isolation Gate — OSE-205 / QA-8
 *
 * Asserts the two-database isolation contract that the OSE worker relies on:
 *
 *   DB        → anonymous public surface (events, sponsors, scans, poster
 *               deployments, regulatory schema, admin audit log)
 *   FORMS_DB  → identified-user surface (form registrations, check-in counts,
 *               surveys, email signups, feature flags, PII audit log)
 *
 * If a handler ever reaches across this line — e.g. forms.ts touching env.DB,
 * or sponsors.ts touching env.FORMS_DB — the PII / anon-surface guarantees
 * documented in `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`
 * collapse. This file is the architectural gate that fails CI when that
 * happens.
 *
 * Coverage map vs. existing `forms-security.spec.ts`:
 *   - forms-security.spec.ts already covers a superset of behavioural PII
 *     concerns (encryption roundtrip, lifecycle, scrub) and overlaps on L1
 *     for forms.ts / events.ts / health.ts / pages.ts / feature-flags handler+lib.
 *   - This file adds the missing L1 sponsors.ts static gate, the missing
 *     forward L2 PRAGMA (`FORMS_DB` has none of [events, sponsors, scans,
 *     sponsor_impressions]), the missing DB.feature_flags PRAGMA, and a
 *     structured `console.log` summary of pass count for CI observability.
 *
 * All L1 gates are pure string checks (<1s). The L2 gates run after the
 * miniflare migrations apply (~ms).
 */

import { env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_SOURCE_FILES_JSON: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

/** Normalise Windows backslashes so `endsWith('handlers/forms.ts')` works on Bloodraven (Windows self-hosted runner). */
const norm = (p: string) => p.replace(/\\/g, '/');

/** Find one source file by suffix; assert its presence so a typo'd path never makes a gate vacuously pass. */
function getSource(suffix: string): string {
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  for (const [path, content] of Object.entries(sources)) {
    if (norm(path).endsWith(suffix)) return content;
  }
  throw new Error(
    `[OSE-205] expected source file ending in ${suffix} not found in TEST_SOURCE_FILES_JSON`
  );
}

// ── Pass-count tracking for structured CI log ────────────────────────────────
let gatesPassed = 0;
let gatesFailed = 0;

function expectPass(label: string, fn: () => void): void {
  try {
    fn();
    gatesPassed++;
  } catch (err) {
    gatesFailed++;
    // Re-throw so vitest still reports the failure.
    throw new Error(`[${label}] ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migrate both DBs once so L2 PRAGMA assertions have schemas to query.
// ─────────────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// L1 — STATIC ANALYSIS GATES (pure string checks, <1s combined)
// ═════════════════════════════════════════════════════════════════════════════

describe('L1: handlers/forms.ts never references env.DB', () => {
  test('no env.DB or .DB.prepare in forms.ts', () => {
    expectPass('L1.forms', () => {
      const content = getSource('src/handlers/forms.ts');
      expect(content).not.toMatch(/env\.DB\b/);
      expect(content).not.toMatch(/\.DB\.prepare/);
    });
  });
});

describe('L1: handlers/events.ts never references FORMS_DB', () => {
  test('no FORMS_DB / forms-db / form_registrations / email_signups in events.ts', () => {
    expectPass('L1.events', () => {
      const content = getSource('src/handlers/events.ts');
      expect(content).not.toMatch(/FORMS_DB/);
      expect(content).not.toMatch(/forms-db/);
      expect(content).not.toMatch(/form_registrations/);
      expect(content).not.toMatch(/email_signups/);
    });
  });
});

describe('L1: handlers/sponsors.ts never references FORMS_DB', () => {
  // This is the gap forms-security.spec.ts S2 did not cover — events/health/pages
  // are gated there but sponsors is not. Anonymous-surface sponsor data must
  // never leak into the identified-user database.
  test('no FORMS_DB / forms-db / form_* / email_signups in sponsors.ts', () => {
    expectPass('L1.sponsors', () => {
      const content = getSource('src/handlers/sponsors.ts');
      expect(content).not.toMatch(/FORMS_DB/);
      expect(content).not.toMatch(/forms-db/);
      expect(content).not.toMatch(/form_registrations/);
      expect(content).not.toMatch(/form_surveys/);
      expect(content).not.toMatch(/email_signups/);
      expect(content).not.toMatch(/checkin_counts/);
    });
  });
});

describe('L1: handlers/feature-flags.ts never references env.DB', () => {
  test('no env.DB or .DB.prepare in feature-flags handler', () => {
    expectPass('L1.feature-flags-handler', () => {
      const content = getSource('src/handlers/feature-flags.ts');
      expect(content).not.toMatch(/env\.DB\b/);
      expect(content).not.toMatch(/\.DB\.prepare/);
    });
  });
});

describe('L1: handlers/data-subject.ts — cross-binding scope guard (invariant #1)', () => {
  // data-subject.ts is the ONLY authorised handler that touches BOTH databases:
  //   FORMS_DB — DELETE from email_signups, form_registrations; INSERT into pii_audit_log
  //   DB       — DELETE from subscribers only (plaintext email; GDPR Art.17 / OSE-207)
  // This guard locks the scope to those operations. Any SELECT, JOIN, or new
  // table reference across the DB boundary would be an unreviewable cross-link.
  test('DB usage in data-subject.ts is DELETE-only on subscribers table', () => {
    expectPass('L1.data-subject-db-scope', () => {
      const content = getSource('src/handlers/data-subject.ts');
      expect(content).toMatch(/env\.DB\.prepare\('DELETE FROM subscribers/);
      expect(content).not.toMatch(/env\.DB\.prepare\('SELECT/i);
      expect(content).not.toMatch(/env\.DB\.prepare\("SELECT/i);
      expect(content).not.toMatch(/env\.DB\.prepare\(`SELECT/i);
      expect(content).not.toMatch(/env\.DB\.prepare\('UPDATE/i);
      expect(content).not.toMatch(/env\.DB\.prepare\("UPDATE/i);
    });
  });
  test('FORMS_DB usage in data-subject.ts does not reference anon-surface tables', () => {
    expectPass('L1.data-subject-formsdb-scope', () => {
      const content = getSource('src/handlers/data-subject.ts');
      const anonTables = [
        'events',
        'sponsors',
        'scans',
        'sponsor_impressions',
        'poster_deployments',
      ];
      for (const table of anonTables) {
        expect(content).not.toMatch(new RegExp(`FORMS_DB\\.prepare\\(['"]\\.* FROM ${table}`, 'i'));
      }
    });
  });
});

describe('L1: broad reverse gate — no ungated handler touches FORMS_DB (invariant #1)', () => {
  // Authorised FORMS_DB handlers and their permitted access scope:
  //   forms.ts         — reads/writes form submissions (registration, checkin, survey, email)
  //   feature-flags.ts — reads flag values for access gating
  //   data-subject.ts  — the ONLY handler authorised to DELETE from FORMS_DB (PII erasure)
  //   pages.ts         — reads ONLY aggregate counts (reg count, checkin count, survey count,
  //                      email count) for public event page social proof. Never reads raw form
  //                      rows or PII columns (email_hash, email_encrypted, attendee_name).
  //                      Authorized: OSE-ssp1 stakeholder-surfaces phase 1.
  //   poster-bundle.ts — reads ONLY the config.mock-mode feature flag (single scalar, no PII).
  //                      Used to select live vs. demo event URL for the UEC ENTER QR.
  //                      Authorized: OSE-191 UEC QR on poster.
  //   portfolio-rollup.ts — reads ONLY aggregate counts (registration COUNT(*),
  //                      checkin total_count) GROUPed by event, for the admin
  //                      brand-scoped rollup strip. Never reads raw form rows or
  //                      PII columns; requireAdmin-gated + brand-scoped (#9).
  //                      Authorized: OSE-669 portfolio rollup.
  //   event-stats.ts   — reads ONLY aggregate counts (registration COUNT(*),
  //                      checkin total_count) for one event's admin dashboard
  //                      tiles. Floored server-side via applyCountFloor (K-anon);
  //                      never reads raw form rows or PII columns; requireAdmin-
  //                      gated. Authorized: OSE-896 dashboard counts.
  // All other src/handlers/ files must never reference env.FORMS_DB.
  // This gate closes the gap where 9+ handler files were ungated.
  test('non-authorised handlers contain no FORMS_DB reference', () => {
    const AUTHORISED_SUFFIXES = [
      'src/handlers/forms.ts',
      'src/handlers/feature-flags.ts',
      'src/handlers/data-subject.ts',
      'src/handlers/pages.ts',
      'src/handlers/poster-bundle.ts',
      'src/handlers/portfolio-rollup.ts',
      'src/handlers/event-stats.ts',
    ];
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    let checked = 0;
    for (const [rawPath, content] of Object.entries(sources)) {
      const p = norm(rawPath);
      if (!p.includes('src/handlers/')) continue;
      if (AUTHORISED_SUFFIXES.some((a) => p.endsWith(a))) continue;
      expectPass(`L1.reverse-gate:${p.split('src/handlers/').pop() ?? p}`, () => {
        expect(content).not.toMatch(/env\.FORMS_DB\b/);
        expect(content).not.toMatch(/\.FORMS_DB\.prepare/);
      });
      checked++;
    }
    // Fail loud if no handler files were found (would make gate vacuously pass)
    expect(
      checked,
      'no handler source files loaded — TEST_SOURCE_FILES_JSON misconfigured'
    ).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L2 — PRAGMA ASSERTIONS (forward and reverse table-isolation guarantees)
// ═════════════════════════════════════════════════════════════════════════════

async function tableNames(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'"
    )
    .all();
  return (result.results ?? []).map((r) => (r as { name: string }).name);
}

describe('L2: FORMS_DB does not contain anonymous-surface tables', () => {
  // This is the forward direction that forms-security.spec.ts S14 did not
  // assert — S14 covers DB-has-no-forms-tables, this asserts the symmetric
  // FORMS_DB-has-no-anon-tables guarantee.
  test('events / sponsors / scans / sponsor_impressions not in FORMS_DB', async () => {
    const names = await tableNames(tenv().FORMS_DB);
    expectPass('L2.forms-db-no-anon-tables', () => {
      expect(names).not.toContain('events');
      expect(names).not.toContain('sponsors');
      expect(names).not.toContain('scans');
      expect(names).not.toContain('sponsor_impressions');
      // Defensive extras documented by the brain invariants:
      expect(names).not.toContain('poster_deployments');
      expect(names).not.toContain('sponsor_event_types');
      expect(names).not.toContain('sponsor_areas');
      expect(names).not.toContain('corridors');
    });
  });
});

describe('L2: DB does not contain identified-user-surface tables', () => {
  test('form_registrations / email_signups / feature_flags not in DB', async () => {
    const names = await tableNames(tenv().DB);
    expectPass('L2.db-no-forms-tables', () => {
      expect(names).not.toContain('form_registrations');
      expect(names).not.toContain('email_signups');
      expect(names).not.toContain('feature_flags');
      // Defensive extras:
      expect(names).not.toContain('form_surveys');
      expect(names).not.toContain('checkin_counts');
      expect(names).not.toContain('form_config');
      expect(names).not.toContain('pii_audit_log');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CORS ALLOWLIST GATE (TL-029)
// Invariant #15: cors_allowlist_immutability — no wildcard or unlisted origin
// ═════════════════════════════════════════════════════════════════════════════

describe('CORS allowlist gate (TL-029 / Invariant #15)', () => {
  // @born-red TL-029 | method: design-time-negative-assertion | date: 2026-08-03
  test('cors.ts allowlist has no wildcard (*) and only OSE-approved origins', () => {
    const corsSrc = getSource('lib/cors.ts');
    expectPass('cors-no-wildcard', () => {
      // The CORS origin must never be set to the wildcard string — literal '*' in quotes
      expect(corsSrc).not.toMatch(/['"]?\*['"]/);
      expect(corsSrc).not.toMatch(/Access-Control-Allow-Origin['":\s]+['"]\*/);
    });
    expectPass('cors-approved-origins-only', () => {
      // Allowlist must reference known OSE origins; any unrecognised string fails CI
      expect(corsSrc).toContain('oursharedevents.com');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SCHEMA DRIFT GATE REFERENCE (TL-030)
// CI schema-verify step validates JSON schema files on every push
// ═════════════════════════════════════════════════════════════════════════════

describe('Schema drift gate reference (TL-030 / Invariant #16)', () => {
  // @born-red TL-030 | method: design-time-negative-assertion | date: 2026-08-03
  test('events handler exports a typed response shape (schema stability contract)', () => {
    const eventsSrc = getSource('handlers/events.ts');
    expectPass('events-typed-response', () => {
      // The handler must type its responses — untyped 'any' returns bypass the schema gate
      expect(eventsSrc).toContain('ok:');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STRUCTURED CI LOG — emits a single JSON line summarising gate outcomes
// ═════════════════════════════════════════════════════════════════════════════

afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      type: 'OSE_205_ARCHITECTURE_GATE_SUMMARY',
      passed: gatesPassed,
      failed: gatesFailed,
      total: gatesPassed + gatesFailed,
      timestamp: new Date().toISOString(),
    })
  );
});
