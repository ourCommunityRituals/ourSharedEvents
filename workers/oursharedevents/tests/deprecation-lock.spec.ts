/**
 * OSE-584 — Deprecation lock: close conformance gap on #10 (deprecation_lock)
 *
 * Invariant #10 claims deprecated columns and tables are never dropped before
 * their lock period expires. Any new DROP COLUMN or DROP TABLE that appears
 * outside the approved whitelist fails CI.
 *
 * TL-048: Deprecated column dropped too early
 *
 * Approach: maintain an explicit whitelist of approved DROPs. Any DROP not on
 * the list (new, unapproved DROP) fails CI immediately. Operators must add to
 * the whitelist with an explicit justification comment to proceed.
 *
 * Approved DROP whitelist (with rationale):
 *   0009_drop_form_tables_from_main_db.sql — form tables moved to FORMS_DB (architectural split, not deprecation)
 *   0018_fix_sponsor_tier_default.sql      — table recreation pattern (sponsors_old is an intermediate artifact)
 *   0028_subscribers_replace_ip_address_with_ip_hash.sql — PII reduction: ip_address → ip_hash (SEC-1.x)
 *   0046_density_tables_drop_corridor_fk.sql — BE-24b: removes FK constraint on corridor_id from
 *     corridor_density_baseline and corridor_density_snapshots so H3 res7 cell strings can serve
 *     as corridor identifiers without requiring rows in the corridors table. Data loss is acceptable
 *     because both tables are populated only by the nightly cron and will be repopulated on next run.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// ─── Approved DROP whitelist ──────────────────────────────────────────────────
// Each entry is a substring that must appear in the migration file path.
// Any DROP COLUMN / DROP TABLE outside these files fails CI.
// To add a new approved DROP: add the migration filename here + rationale above.

const APPROVED_DROP_MIGRATIONS = [
  '0009_drop_form_tables_from_main_db',    // architectural: form tables moved to FORMS_DB
  '0018_fix_sponsor_tier_default',          // table recreation: sponsors_old is temporary artifact
  '0028_subscribers_replace_ip_address',    // PII reduction: ip_address → ip_hash
  '0046_density_tables_drop_corridor_fk',  // BE-24b: FK removal — h3_res7 as corridor identifier
] as const;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function isApproved(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return APPROVED_DROP_MIGRATIONS.some((approved) => normalized.includes(approved));
}

describe('OSE-584 — TL-048: No unapproved DROP COLUMN or DROP TABLE in migrations', () => {
  // @born-red TL-048 | method: design-time-negative-assertion | date: 2026-08-03
  test('every DROP COLUMN / DROP TABLE is in the approved whitelist', () => {
    const sources = loadSources();
    const violations: string[] = [];

    for (const [path, src] of Object.entries(sources)) {
      const normalized = normalizePath(path);
      // Only inspect migration files
      if (!normalized.includes('/migrations/') && !normalized.includes('\\migrations\\')) continue;

      const hasDropColumn = /DROP\s+COLUMN/i.test(src);
      const hasDropTable = /DROP\s+TABLE/i.test(src);

      if ((hasDropColumn || hasDropTable) && !isApproved(path)) {
        const dropType = [
          hasDropColumn ? 'DROP COLUMN' : null,
          hasDropTable ? 'DROP TABLE' : null,
        ].filter(Boolean).join(', ');
        violations.push(`${normalized} [${dropType}] — NOT in approved whitelist`);
      }
    }

    expect(
      violations,
      [
        'Unapproved DROP operations found. To approve a DROP:',
        '  1. Add the migration to APPROVED_DROP_MIGRATIONS in deprecation-lock.spec.ts',
        '  2. Document the rationale in the comment block at the top of this file',
        '  3. Verify the column was marked deprecated at least 2 migration cycles earlier',
        '',
        'Violations:',
        ...violations.map((v) => `  ${v}`),
      ].join('\n')
    ).toHaveLength(0);
  });

  // @born-red TL-048 | method: design-time-negative-assertion | date: 2026-08-03
  test('approved DROPs in whitelist actually exist in the codebase (whitelist is not stale)', () => {
    const sources = loadSources();
    const migrationPaths = Object.keys(sources).filter((p) =>
      normalizePath(p).includes('/migrations/') || normalizePath(p).includes('\\migrations\\')
    );

    for (const approved of APPROVED_DROP_MIGRATIONS) {
      const found = migrationPaths.some((p) => normalizePath(p).includes(approved));
      expect(
        found,
        `Whitelisted migration "${approved}" does not exist — remove stale whitelist entry`
      ).toBe(true);
    }
  });

  test('no migration drops admin_audit_log (append-only invariant)', () => {
    const sources = loadSources();
    const violations: string[] = [];

    for (const [path, src] of Object.entries(sources)) {
      const normalized = normalizePath(path);
      if (!normalized.includes('migrations')) continue;
      if (/DROP.*admin_audit_log/i.test(src)) {
        violations.push(normalized);
      }
    }

    expect(
      violations,
      `These migrations DROP admin_audit_log (audit log must be append-only): ${violations.join(', ')}`
    ).toHaveLength(0);
  });

  test('OSE-584 evidence', () => {
    const report = {
      story: 'OSE-584',
      threats_covered: ['TL-048'],
      invariant: 10,
      approved_drops: APPROVED_DROP_MIGRATIONS.length,
      date: '2026-08-03',
    };
    console.log(`[OSE-584-EVIDENCE] ${JSON.stringify(report)}`);
    expect(report.approved_drops).toBe(4);
  });
});

function loadSources(): Record<string, string> {
  return JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
}
