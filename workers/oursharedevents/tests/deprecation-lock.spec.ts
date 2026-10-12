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
 *   0062_split_scan_path.sql — OSE-798 A1: DROP TABLE scans (doctrine rule 6 — the combined table
 *     coupled a placement id with session-derived columns). scans = 0 rows in every environment, so
 *     no data loss; replaced by scan_placement_events + scan_node_returns.
 *   0067_split_sponsor_placement.sql — OSE-799 A2: DROP TABLE sponsors (doctrine rule 7 — a sponsor
 *     was a child of one night, no durable identity) + recreate sponsor_event_types/sponsor_areas/
 *     sponsor_displays to repoint their sponsor_id FK from sponsors → sponsor_business (SQLite
 *     cannot ALTER a FK). All tables = 0 rows in every environment, so no data loss; identity moves
 *     to sponsor_business, creative to sponsor_asset, per-event attachment to sponsor_placement.
 *   0071_subscribers_encrypt_email.sql — A-5 data-at-rest doctrine: DROP TABLE subscribers to
 *     recreate it without the plaintext `email` column (SQLite cannot drop a UNIQUE column in
 *     place), replacing it with email_encrypted (AES-GCM) + email_hash (peppered, UNIQUE/dedup).
 *     0 rows in every environment (pre-deploy), so no data loss.
 *   0102_rename_sponsor_impressions_to_sponsor_displays.sql — OSE-931 (PO 2026-08-20): DROP TABLE
 *     sponsor_impressions as the last step of a table REBUILD under its honest name, sponsor_displays
 *     (SQLite cannot change a column default). Every row is copied first, with the stored value
 *     'impression' mapped to 'display'; the three indexes are recreated under the new name.
 *   0098_drop_subscribers_from_anonymous_db.sql — OSE-1661 (owner 2026-10-11): DROP TABLE
 *     subscribers from the anonymous DB. Forms migration 0017 creates the same table in FORMS_DB and
 *     every reader and writer moved with it. Production held 0 rows and staging 1 test row
 *     (2026-10-11); a migration cannot copy rows between databases.
 *   0081_sponsor_tier_and_compact_logo.sql — OSE-1316/1317: DROP TABLE sponsor_asset as the last
 *     step of a table REBUILD that widens its format CHECK with 'logo_compact' (the sidebar logo —
 *     SQLite cannot alter a CHECK in place). Every row is copied into sponsor_asset_new first, then
 *     the new table is renamed back, so no data is lost. Nothing references sponsor_asset by FK.
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
  '0009_drop_form_tables_from_main_db', // architectural: form tables moved to FORMS_DB
  '0018_fix_sponsor_tier_default', // table recreation: sponsors_old is temporary artifact
  '0028_subscribers_replace_ip_address', // PII reduction: ip_address → ip_hash
  '0046_density_tables_drop_corridor_fk', // BE-24b: FK removal — h3_res7 as corridor identifier
  '0062_split_scan_path', // OSE-798 A1: DROP TABLE scans (0 rows) — doctrine rule 6 uncoupling
  '0067_split_sponsor_placement', // OSE-799 A2: DROP TABLE sponsors + recreate sponsor_event_types/areas/impressions (FK repoint to sponsor_business); all 0 rows — doctrine rule 7
  '0071_subscribers_encrypt_email', // A-5: DROP TABLE subscribers to drop plaintext email (0 rows) — encrypt+hash rebuild
  '0081_sponsor_tier_and_compact_logo', // OSE-1316/1317: sponsor_asset rebuild (rows copied first) to widen the format CHECK with logo_compact
  '0102_rename_sponsor_impressions_to_sponsor_displays', // OSE-931: table rebuild under its honest name; rows copied first
  '0098_drop_subscribers_from_anonymous_db', // OSE-1661: DROP TABLE subscribers from DB (prod 0 rows); forms 0017 recreates it in FORMS_DB
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
        const dropType = [hasDropColumn ? 'DROP COLUMN' : null, hasDropTable ? 'DROP TABLE' : null]
          .filter(Boolean)
          .join(', ');
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
    const migrationPaths = Object.keys(sources).filter(
      (p) =>
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
    expect(report.approved_drops).toBe(10); // +0098 (OSE-1661) +0102 (OSE-931)
  });
});

function loadSources(): Record<string, string> {
  return JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
}
