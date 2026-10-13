/**
 * INVARIANT 8: Bounded PII Retention — cron + TTL enforcement
 *
 * All opt-in PII has a finite TTL enforced by a daily lifecycle cron.
 * No PII has unbounded retention. This is the regulatory-liability
 * invariant: a new PII column added to the schema without wiring into
 * the cleanup loop silently over-retains data — a HIPAA/COPPA
 * exposure. The structural test catches that failure mode at code-
 * shape level so it cannot ship.
 *
 * Brain Invariant #8 (bounded_pii_retention):
 *   - status: partial (today — promote to live once this structural
 *     test ships + lifecycle workflow runs green on main)
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *   - companion behavioral test: workers/oursharedevents/tests/
 *     lifecycle.spec.ts (real D1 + worker.scheduled execution path —
 *     verifies the cron actually deletes/scrubs/audits)
 *
 * Pyramid coverage for this invariant:
 *   L0 STATIC (this file)             — code shape: cron exists, all PII tables
 *                                       covered, every phase writes audit log
 *   L1 IN-PROCESS INTEGRATION         — workers/oursharedevents/tests/
 *                                       lifecycle.spec.ts — real cron execution
 *                                       via worker.scheduled, verifies behavioral
 *                                       outcome on seeded D1
 *   T3/T4 NOT APPLICABLE              — cron runs once/day; not practical as a
 *                                       network-staging test loop. The L0+L1
 *                                       layers prove the mechanism without needing
 *                                       runtime staging cron observation.
 *
 * What this invariant catches:
 *   - Anyone removes a phase from the cron (e.g., deletes the email_signups
 *     DELETE) → CI fails (table-phase regex misses)
 *   - Anyone adds a new PII-bearing table to the schema without adding
 *     a phase here → developer is expected to ALSO update the table list
 *     in this test; CI failure is the "you forgot the cron wiring" signal
 *   - Anyone removes the pii_audit_log writes from a phase → CI fails
 *     (audit count assertion misses) → operators lose compliance evidence
 *   - Anyone removes the TTL column reference from a phase WHERE clause
 *     (would cause every row to be deleted regardless of expiry) → CI
 *     fails (the TTL column regex misses)
 *
 * Pattern reference: tier-equity.invariant.spec.ts and
 * deprecation-lock.invariant.spec.ts — structural assertions read
 * source files from disk via node:fs (Playwright runs with Node fs
 * access).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const INDEX_PATH = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'index.ts');
const LIFECYCLE_TEST_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'tests',
  'lifecycle.spec.ts'
);

/**
 * PII-bearing tables with their TTL column + cleanup mode.
 *
 * To add a new PII table to this list:
 *   1. Add a row here
 *   2. Add the matching phase to runFormDataLifecycle() in src/index.ts
 *   3. Add behavioral test coverage in workers/oursharedevents/tests/lifecycle.spec.ts
 *   4. CI will turn green when all three layers are aligned
 *
 * If only step 1 is done, this test fails — surfacing the missing cron wiring.
 * If steps 1+2 done without step 3, lifecycle.spec.ts coverage is incomplete
 * (not caught by THIS file, but is the next discipline gap).
 *
 * OSE-1246 — and if step 1 is FORGOTTEN, the completeness test below catches
 * it. That used to be the real hole: these instructions only bind someone who
 * has already decided to open this file. A table added to the schema and never
 * registered here left every test above green while the data over-retained.
 * The registry is still hand-maintained; it is no longer self-attesting.
 */
const PII_TABLES_DELETE = [
  { table: 'form_registrations', ttlColumn: 'expires_at' },
  { table: 'email_signups', ttlColumn: 'retention_expires_at' },
  // The landing-page email list, in FORMS_DB since OSE-1661 (phase 4): kept
  // 1 to 90 days from created_at (owner 2026-10-11).
  { table: 'subscribers', ttlColumn: 'created_at' },
] as const;

const PII_TABLES_SCRUB = [{ table: 'form_surveys', scrubFlag: 'pii_scrubbed' }] as const;

// ─── OSE-1246 — the registry above must COVER the schema ─────────────────────
//
// The two lists are hand-maintained, and their own instructions say "to add a
// new PII table: 1. Add a row here". That is backwards as a guarantee: the gate
// only fires if someone remembers step 1. Add a table to the schema and never
// touch this file, and every test above stays green while the data over-retains
// — which is the exact failure this invariant's header names as "the
// regulatory-liability invariant".
//
// The test below derives the PII tables FROM THE MIGRATIONS and asserts the
// registry covers them. The per-table tests above keep doing what they do well
// (asserting each phase is correctly SHAPED — a DELETE without its TTL WHERE
// clause is data loss, not over-retention); this one asserts the registry is
// COMPLETE. Shape and completeness are different properties and need different
// tests.
//
// At the time of writing the registry was complete. Nothing was broken. What
// was missing was the ability to notice if it stopped being.

const FORMS_MIGRATIONS = join(REPO_ROOT, 'workers', 'oursharedevents', 'migrations-forms');

/**
 * Column-name fragments that mean a row is about a person.
 *
 * Matched as substrings because this schema prefixes: the columns are
 * `attendee_name` and `attendee_email_hash`, not `name` and `email`. An
 * anchored match finds neither, which is how a first draft of this test passed
 * while detecting nothing at all.
 *
 * `_hash` and `_encrypted` variants are deliberately included. A hashed email
 * is pseudonymous rather than anonymous — it still identifies a person given
 * the input space, and it is still governed by a retention promise.
 */
const IDENTITY_FRAGMENTS =
  /(email|phone|first_name|last_name|full_name|_name|attendee|ip_address|address)/i;

/**
 * A TTL or scrub column is a table SAYING it expects to be expired. If one
 * exists and no lifecycle phase does, the schema is making a promise the cron
 * does not keep.
 */
const TTL_FRAGMENTS = /(expires_at|retention_|_ttl|scrub)/i;

/**
 * Tables that carry identity-shaped columns but must NOT be expired, with the
 * reason. Deleting from here would destroy something load-bearing.
 *
 * Empty today. It exists so that the honest answer to a future finding is a
 * documented exemption rather than deleting the assertion.
 */
const RETENTION_EXEMPT: Record<string, string> = {};

/** table -> column names, from CREATE TABLE bodies AND later ALTER ADD COLUMNs. */
function formsSchemaColumns(): Map<string, string[]> {
  const byTable = new Map<string, string[]>();
  const add = (table: string, col: string) => {
    const list = byTable.get(table) ?? [];
    list.push(col);
    byTable.set(table, list);
  };

  for (const file of readdirSync(FORMS_MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(FORMS_MIGRATIONS, file), 'utf8');

    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      const table = m[1]!;
      if (!byTable.has(table)) byTable.set(table, []);
      for (const line of m[2]!.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('--')) continue;
        const col = t.split(/\s+/)[0]!.replace(/[(),]/g, '');
        if (col) add(table, col);
      }
    }

    // Columns are added by ALTER in this schema (anonymous_id, consent_given_at,
    // consent_type all arrived that way), and "a NEW PII column added to the
    // schema" is the failure mode this invariant names. A CREATE-only scan
    // would miss the very path the drift travels on.
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi)) {
      add(m[1]!, m[2]!);
    }
  }
  return byTable;
}

test.describe('Invariant 8: Bounded PII Retention — cron mechanism', () => {
  test('OSE-INV8 | infra | cron | scheduled() handler exists in src/index.ts', () => {
    expect(existsSync(INDEX_PATH), 'workers/oursharedevents/src/index.ts must exist').toBe(true);
    const src = readFileSync(INDEX_PATH, 'utf8');
    // Worker scheduled() handler — invoked by Cloudflare cron trigger.
    // Removing this disconnects the cron from any work; all PII becomes
    // permanent. The structural assertion locks the handler's presence.
    expect(src, 'async scheduled() handler must exist on the worker export').toMatch(
      /\basync\s+scheduled\s*\(/
    );
  });

  test('OSE-INV8 | infra | cron | runFormDataLifecycle is defined and invoked from scheduled()', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    expect(src, 'runFormDataLifecycle function must be defined — it is the cron body').toMatch(
      /\basync\s+function\s+runFormDataLifecycle\s*\(/
    );
    expect(
      src,
      'scheduled() must invoke runFormDataLifecycle — without this call, cron does nothing'
    ).toMatch(/runFormDataLifecycle\s*\(/);
  });

  for (const t of PII_TABLES_DELETE) {
    test(`OSE-INV8 | infra | phase | DELETE phase exists for ${t.table} keyed on ${t.ttlColumn}`, () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // The phase MUST DELETE FROM <table> AND filter by the TTL column.
      // A DELETE without the WHERE on the TTL column would wipe ALL rows
      // (data loss); a phase missing entirely would over-retain (regulatory
      // liability). Either failure mode is caught by this regex.
      const phaseRegex = new RegExp(
        `DELETE\\s+FROM\\s+${t.table}\\s+WHERE[^;]*${t.ttlColumn}`,
        'i'
      );
      expect(
        src,
        `cron must DELETE expired rows from ${t.table} WHERE ${t.ttlColumn} — missing phase = silent over-retention of PII = HIPAA/COPPA liability`
      ).toMatch(phaseRegex);
    });
  }

  for (const t of PII_TABLES_SCRUB) {
    test(`OSE-INV8 | infra | phase | SCRUB phase exists for ${t.table} (sets ${t.scrubFlag}=1)`, () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // Scrub-in-place phase: SELECT unscrubbed rows, scrub PII from fields,
      // mark scrubbed=1 so the row isn't re-processed. Two halves: SELECT
      // and UPDATE. If the UPDATE half is removed, the SELECT runs every
      // cron cycle and the same rows are re-scrubbed forever (idempotent
      // but wasteful — and if scrubSurveyPii() has a bug, every cycle
      // re-corrupts already-scrubbed rows).
      expect(
        src,
        `cron must SELECT FROM ${t.table} for unscrubbed rows (${t.scrubFlag} = 0)`
      ).toMatch(
        new RegExp(`SELECT[^;]+FROM\\s+${t.table}\\s+WHERE[^;]*${t.scrubFlag}\\s*=\\s*0`, 'i')
      );
      expect(src, `cron must UPDATE ${t.table} SET ${t.scrubFlag} = 1 after scrubbing`).toMatch(
        new RegExp(`UPDATE\\s+${t.table}\\s+SET[^;]*${t.scrubFlag}\\s*=\\s*1`, 'i')
      );
    });
  }

  test('OSE-INV8 | infra | audit | pii_audit_log writes happen for every phase (success AND error paths)', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    // Each of 3 phases has a try/catch with an audit write in BOTH the
    // try (records_affected = count, errors = 0) and the catch (errors = 1).
    // That's 6 logPiiAudit() calls in runFormDataLifecycle. Anything less
    // means a phase is silently failing to log compliance evidence.
    const auditCalls = (src.match(/logPiiAudit\s*\(/g) ?? []).length;
    expect(
      auditCalls,
      'logPiiAudit() must be called for every phase in both success AND error paths — fewer calls = compliance audit gap on failure'
    ).toBeGreaterThanOrEqual(6);
    // The helper itself must exist (writes the actual INSERT).
    expect(src, 'logPiiAudit helper must be defined — it writes the audit row').toMatch(
      /\bfunction\s+logPiiAudit\s*\(/
    );
    expect(
      src,
      'logPiiAudit must INSERT into pii_audit_log table — wrong table name = silent audit loss'
    ).toMatch(/INSERT\s+INTO\s+pii_audit_log/i);
  });

  test('OSE-INV8 | infra | safety | each phase wraps in try/catch so one failure cannot abort the others', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    // Per the cron header comment: "A failure in one phase does NOT abort
    // the others." Implementation = each phase in its own try/catch.
    // If someone "simplifies" to one big try around all phases, a Phase 1
    // failure would silently skip Phase 2 + Phase 3, leaving surveys
    // unscrubbed and email_signups un-deleted — over-retention by accident.
    // Conservative assertion: at least 3 try blocks inside runFormDataLifecycle.
    const lifecycleBody = src.match(/async\s+function\s+runFormDataLifecycle[\s\S]*?^\}/m);
    expect(
      lifecycleBody,
      'runFormDataLifecycle body must be locatable for try/catch structural check'
    ).not.toBeNull();
    const tryCount = (lifecycleBody![0].match(/\btry\s*\{/g) ?? []).length;
    expect(
      tryCount,
      'runFormDataLifecycle must have ≥ 3 try blocks (one per phase) — fewer = one phase fail can abort the rest'
    ).toBeGreaterThanOrEqual(3);
  });

  test('OSE-INV8 | infra | observability | LIFECYCLE_COMPLETE structured log emitted at end of run', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    // SRE relies on this log line to know the cron ran. If the
    // LIFECYCLE_COMPLETE marker is removed, dashboards lose the success
    // signal and a stuck cron becomes invisible.
    expect(
      src,
      'runFormDataLifecycle must emit a LIFECYCLE_COMPLETE log line on success — without it, the cron going silently absent is undetectable'
    ).toMatch(/LIFECYCLE_COMPLETE/);
  });

  // OSE-1246 — completeness, derived from the schema rather than declared.
  test('OSE-INV8 | infra | registry | EVERY PII-bearing forms table has a lifecycle phase', () => {
    const registered = new Set<string>([
      ...PII_TABLES_DELETE.map((t) => t.table),
      ...PII_TABLES_SCRUB.map((t) => t.table),
    ]);

    const columns = formsSchemaColumns();
    expect(
      columns.size,
      'no tables parsed from migrations-forms — the parser is broken'
    ).toBeGreaterThan(0);

    const unwired: string[] = [];
    for (const [table, cols] of columns) {
      const identity = cols.filter((c) => IDENTITY_FRAGMENTS.test(c));
      const ttl = cols.filter((c) => TTL_FRAGMENTS.test(c));
      if (identity.length === 0 && ttl.length === 0) continue;
      if (registered.has(table)) continue;
      if (RETENTION_EXEMPT[table]) continue;
      unwired.push(
        `${table} — identity columns [${identity.join(', ')}], ttl columns [${ttl.join(', ')}]`
      );
    }

    expect(
      unwired,
      'A forms table carries person-shaped or TTL columns and has no lifecycle phase. ' +
        'Wire it into runFormDataLifecycle() and add it to PII_TABLES_DELETE/SCRUB above, ' +
        'or add it to RETENTION_EXEMPT with the reason it must not be expired. ' +
        'Missing wiring = silent over-retention of PII.\n' +
        unwired.join('\n')
    ).toEqual([]);
  });

  test('OSE-INV8 | infra | registry | the detector actually detects — negative control', () => {
    // A completeness check that finds nothing is indistinguishable from a
    // completeness check that looks at nothing. The first draft of the detector
    // anchored its identity regex to line start and matched ZERO columns in a
    // schema full of them, while passing. This asserts the parser sees the
    // tables it is supposed to see.
    const columns = formsSchemaColumns();
    for (const table of ['form_registrations', 'email_signups', 'form_surveys']) {
      expect(columns.has(table), `parser did not find ${table}`).toBe(true);
    }
    const reg = columns.get('form_registrations')!;
    expect(
      reg.some((c) => IDENTITY_FRAGMENTS.test(c)),
      'identity columns not detected'
    ).toBe(true);
    expect(
      reg.some((c) => TTL_FRAGMENTS.test(c)),
      'ttl column not detected'
    ).toBe(true);
    // And that it reads ALTER-added columns, the path the drift travels on.
    expect(reg, 'ALTER TABLE ADD COLUMN not parsed').toContain('anonymous_id');
  });

  test('OSE-INV8 | infra | companion | L1 lifecycle behavioral test exists', () => {
    // The structural test (this file) locks code shape; the L1 test locks
    // actual behavior via worker.scheduled() execution against seeded D1.
    // Both layers are part of the bounded_pii_retention pyramid.
    expect(
      existsSync(LIFECYCLE_TEST_PATH),
      'workers/oursharedevents/tests/lifecycle.spec.ts must exist — it is the L1 behavioral pair for this invariant'
    ).toBe(true);
    const lifecycle = readFileSync(LIFECYCLE_TEST_PATH, 'utf8');
    // L1 test must cover all 3 phases + audit logging.
    expect(lifecycle, 'L1 test must exercise the form_registrations phase').toMatch(
      /form_registrations/
    );
    expect(lifecycle, 'L1 test must exercise the form_surveys scrub phase').toMatch(/form_surveys/);
    expect(lifecycle, 'L1 test must exercise the email_signups phase').toMatch(/email_signups/);
    expect(lifecycle, 'L1 test must verify pii_audit_log entries').toMatch(/pii_audit_log/);
  });
});
