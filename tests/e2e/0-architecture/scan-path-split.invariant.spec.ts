/**
 * INVARIANT: Split Scan Path (doctrine rule 6)
 *
 * "A path is not something we decline to show, it is something we cannot
 *  compute. No durable row carries both a session-derived value and a
 *  placement id."
 *
 * The shipped `scans` table violated this by carrying poster_deployment_id
 * (a placement id) AND anonymous_id / user_agent_hash (session-derived) in one
 * row, with an index (idx_scans_anonymous) making the forbidden correlation a
 * single seek. OSE-798 split it into `scan_placement_events` (placement only)
 * and `scan_node_returns` (session only) so the correlation is not merely
 * declined — it is structurally impossible. This L0 static gate keeps it that
 * way: it fails if any CREATE TABLE in the main-DB migrations reintroduces both
 * a placement id and a session-derived column in the same table.
 *
 * Pyramid coverage:
 *   L0 STATIC (this file) — schema shape: no table couples placement + session.
 *   L1 IN-PROCESS         — migration-smoke.spec.ts (DB_TABLES: scans dropped,
 *                           scan_placement_events + scan_node_returns present);
 *                           qr-scan.spec.ts (dual-write); poster-attribution +
 *                           shared-report-materialize specs (readers moved).
 *
 * What it catches: a future migration that adds `poster_deployment_id` to
 * `scan_node_returns`, or `anonymous_id`/`user_agent_hash` to
 * `scan_placement_events`, or recreates a combined `scans`-style table →
 * CI fails before merge. Unblocks OSE-563 (the anti-logging proof cannot be
 * written against a schema that couples WHO and WHERE).
 *
 * Pattern reference: aggregate-only.invariant.spec.ts / pii-retention.invariant.spec.ts
 * (readFileSync L0 structural approach using Playwright with Node fs access).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'migrations');

// A placement id ties a row to a physical location/poster.
const PLACEMENT_COLUMNS = ['poster_deployment_id'];
// Session-derived values identify or fingerprint the person/agent behind a scan.
const SESSION_COLUMNS = ['anonymous_id', 'user_agent_hash'];

/** Concatenate every migration SQL file (schema is the sum of all migrations). */
function allMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
}

/**
 * Extract each `CREATE TABLE <name> ( ... )` body from a SQL blob.
 * Returns [{ name, body }] where body is the column-definition text.
 */
function createTableBlocks(sql: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    blocks.push({ name: m[1], body: m[2] });
  }
  return blocks;
}

test.describe('Invariant: Split Scan Path — no table couples placement + session (OSE-798, rule 6)', () => {
  test('OSE-798 | privacy | schema | no CREATE TABLE carries both a placement id and a session-derived column', () => {
    const sql = allMigrationSql();
    // The invariant is about the FINAL (live) schema, so a historical CREATE
    // TABLE for a table that a later migration DROPs (e.g. the old `scans` table,
    // created in 0004, dropped in 0062) does not count — it no longer exists.
    const dropped = new Set<string>();
    const dropRe = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
    let dm: RegExpExecArray | null;
    while ((dm = dropRe.exec(sql)) !== null) dropped.add(dm[1].toLowerCase());

    const blocks = createTableBlocks(sql).filter((b) => !dropped.has(b.name.toLowerCase()));
    expect(
      blocks.length,
      'expected to parse live CREATE TABLE blocks from migrations'
    ).toBeGreaterThan(0);

    for (const { name, body } of blocks) {
      const hasPlacement = PLACEMENT_COLUMNS.some((c) => new RegExp(`\\b${c}\\b`).test(body));
      const sessionCol = SESSION_COLUMNS.find((c) => new RegExp(`\\b${c}\\b`).test(body));
      expect(
        hasPlacement && sessionCol !== undefined,
        `Table \`${name}\` declares a placement id AND a session-derived column ` +
          `(\`${sessionCol}\`) in the same row — doctrine rule 6 forbids coupling WHO ` +
          `with WHERE. Split the columns across two tables (see OSE-798: ` +
          `scan_placement_events vs scan_node_returns).`
      ).toBe(false);
    }
  });

  test('OSE-798 | privacy | schema | the combined `scans` table is retired (dropped)', () => {
    const sql = allMigrationSql();
    // scans was created in 0004 and must be dropped by the split migration.
    expect(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?scans["'`]?/i.test(sql),
      'the combined `scans` table must be dropped by the scan-path split migration ' +
        '(0062) — leaving it in place preserves the placement↔session coupling'
    ).toBe(true);
    // The correlating index must be gone too.
    expect(
      /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?idx_scans_anonymous/i.test(sql),
      'idx_scans_anonymous (the single-seek WHO↔WHERE correlation index) must be dropped'
    ).toBe(true);
  });

  test('OSE-798 | schema | the two split tables exist', () => {
    const sql = allMigrationSql();
    const names = createTableBlocks(sql).map((b) => b.name);
    expect(names, 'scan_placement_events (placement side) must exist').toContain(
      'scan_placement_events'
    );
    expect(names, 'scan_node_returns (session side) must exist').toContain('scan_node_returns');
  });
});
