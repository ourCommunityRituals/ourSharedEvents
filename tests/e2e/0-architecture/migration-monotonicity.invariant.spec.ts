/**
 * INVARIANT 19: Migration Monotonicity
 *
 * Brain Invariant #19 (migration_monotonicity):
 *   - status: live (structural gate is the enforcement mechanism)
 *   - group: infrastructure_ci
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * Every D1 migration file must follow the NNNN_*.sql naming convention and
 * must carry a unique, monotonically increasing prefix number. A duplicate
 * migration number causes two files to sort to the same apply position in
 * `wrangler d1 migrations apply` — the second file either overwrites or is
 * silently skipped depending on wrangler version, corrupting the schema
 * state for every environment that has already applied the first file.
 * A non-monotonic sequence (e.g., 0040 followed by 0038) causes a similar
 * apply-order failure: wrangler applies migrations in alphabetical order by
 * filename, so a lower-numbered file added after a higher-numbered one is
 * never applied on databases that have already run the higher-numbered file.
 *
 * No migration may DROP a load-bearing table. The listed tables are the
 * primary data stores for all OSE functionality: events (the core entity),
 * sponsors (the commercial layer), scan_aggregates / anon_id_returns / poster_
 * deployments (the NCR intelligence pipeline), corridors + event_series
 * (the geo-grouping and trend axes), and campaigns (the enterprise comparison
 * layer). A DROP TABLE on any of these in a migration is catastrophic — it
 * would wipe all production rows with no schema-level protection and no
 * application-layer warning. If a table truly needs to be dropped (end-of-life
 * feature removal), the table must first be removed from this spec's
 * LOAD_BEARING_TABLES list AND a YAML enrichment_history entry must be added
 * to document the architectural decision — both changes visible in the same
 * PR diff.
 *
 * What this spec locks:
 *   (a) All migration files in the migrations/ directory match NNNN_*.sql
 *       (4-digit zero-padded prefix) — wrangler's canonical naming convention
 *   (b) No two migration files share the same 4-digit prefix number — prevents
 *       non-deterministic apply order across environments
 *   (c) Migration prefix numbers are strictly increasing when files are sorted
 *       alphabetically — ensures the intended apply order matches the file sort
 *   (d) No migration contains a DROP TABLE on a load-bearing table — prevents
 *       accidental or adversarial data wipe via a schema migration
 *
 * Pattern reference: slug-permanence.invariant.spec.ts (same L0 structural
 * approach reading migration files via node:fs and asserting SQL shape).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'migrations');

/**
 * Load-bearing tables. A DROP TABLE on any of these is prohibited.
 * To remove a table from this list, add an enrichment_history entry to
 * architectural-invariants.yaml and remove it here in the same PR.
 */
const LOAD_BEARING_TABLES = [
  'events',
  'sponsors',
  'campaigns',
  'scan_aggregates',
  'anon_id_returns',
  'poster_deployments',
  'corridors',
  'event_series',
];

test.describe('Invariant 19: Migration Monotonicity — structural schema integrity lock', () => {
  test('OSE-INV19 | migrations | naming | all .sql files match the NNNN_*.sql wrangler convention', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(
      sqlFiles.length,
      'migrations/ must contain at least one .sql file — empty migrations directory is suspicious'
    ).toBeGreaterThan(0);

    for (const file of sqlFiles) {
      expect(
        file,
        `${file} does not match NNNN_*.sql — ` +
          'all migration files must have a 4-digit zero-padded numeric prefix ' +
          'for wrangler to detect and apply them in the correct order'
      ).toMatch(/^\d{4}_.*\.sql$/);
    }
  });

  test('OSE-INV19 | migrations | uniqueness | no two migration files share the same prefix number', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && /^\d{4}_/.test(f))
      .sort();

    const byPrefix = new Map<string, string[]>();
    for (const file of sqlFiles) {
      const prefix = file.slice(0, 4);
      const existing = byPrefix.get(prefix) ?? [];
      existing.push(file);
      byPrefix.set(prefix, existing);
    }

    for (const [prefix, files] of byPrefix) {
      expect(
        files.length,
        `prefix ${prefix} is shared by multiple migration files: [${files.join(', ')}] — ` +
          'duplicate prefix numbers cause non-deterministic apply order: ' +
          'wrangler may apply the wrong file or silently skip one'
      ).toBe(1);
    }
  });

  test('OSE-INV19 | migrations | order | migration numbers are strictly increasing when sorted', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && /^\d{4}_/.test(f))
      .sort();

    let prevNum = -1;
    let prevFile = '(none)';
    for (const file of sqlFiles) {
      const num = parseInt(file.slice(0, 4), 10);
      expect(
        num,
        `${file} (number ${num}) is ≤ previous file ${prevFile} (number ${prevNum}) — ` +
          'migration numbers must be strictly increasing in sort order; ' +
          'a lower-numbered file added after a higher-numbered one is never applied ' +
          'on databases that have already applied the higher number'
      ).toBeGreaterThan(prevNum);
      prevNum = num;
      prevFile = file;
    }
  });

  test('OSE-INV19 | migrations | safety | no migration drops a load-bearing table', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of sqlFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      for (const table of LOAD_BEARING_TABLES) {
        const hasDropTable = new RegExp(
          `DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?\\s+${table}\\b`,
          'i'
        ).test(sql);
        expect(
          hasDropTable,
          `${file} contains DROP TABLE ${table} — ` +
            `${table} is a load-bearing table listed in migration-monotonicity.invariant.spec.ts; ` +
            'dropping it in a migration would wipe all production data for that table with no recovery. ' +
            'To remove a load-bearing table intentionally: (1) remove it from LOAD_BEARING_TABLES in ' +
            'this spec, (2) add a brain enrichment_history entry documenting the architectural decision, ' +
            'both in the same PR diff so the change is visible and reviewable.'
        ).toBe(false);
      }
    }
  });
});
