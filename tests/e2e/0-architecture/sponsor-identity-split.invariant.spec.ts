/**
 * INVARIANT: Split Sponsor Identity (doctrine rule 7)
 *
 * "A sponsor is not part of a night. Nights borrow sponsors." The shipped `sponsors`
 * table made a sponsor a CHILD of one event (event_id FK), so a sponsor doing 13 nights
 * was 13 unrelated rows with no persistent identity — the learning loop could not be
 * computed even in principle. OSE-799 (A2) splits it into three tables:
 *   • sponsor_business   — durable identity (0065)
 *   • sponsor_asset      — durable creative, one row per format (0066)
 *   • sponsor_placement  — the per-event attachment / the join (0067)
 *
 * This L0 static gate locks the doctrine + the #25 covenant into the schema shape:
 *   1. The combined `sponsors` table is retired (dropped).
 *   2. The three split tables exist.
 *   3. sponsor_placement.locality_band is declared NOT NULL — it REPLACES sponsors.is_local
 *      and is geo-derived at attachment (never client-set), so every active placement
 *      carries a locality band. This is the DoD red-capable object: a placement that could
 *      hold a NULL locality_band would break the #25 local-floor allocation silently.
 *   4. sponsor_placement carries NO purchasable-slot column (placement_formats / size /
 *      slot / position) — Invariant #25 (sponsor_share_covenant, LIVE): money buys
 *      frequency-share and report depth only, never size/slot/position/is_local.
 *
 * What it catches: a future migration that reintroduces a combined sponsor table, makes
 * locality_band nullable, or adds a purchasable placement/slot column → CI fails before
 * merge. Unblocks the exchange model (a sponsor identity that persists across events).
 *
 * Pattern reference: scan-path-split.invariant.spec.ts (readFileSync L0 structural approach).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'migrations');

/** Concatenate every migration SQL file (schema is the sum of all migrations). */
function allMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
}

/** Extract the `CREATE TABLE <name> ( ... )` body for one table from a SQL blob. */
function createTableBody(sql: string, table: string): string | null {
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["'\`]?${table}["'\`]?\\s*\\(([\\s\\S]*?)\\);`,
    'i'
  );
  const m = sql.match(re);
  return m ? m[1] : null;
}

test.describe('Invariant: Split Sponsor Identity — identity / creative / attachment (OSE-799, rule 7)', () => {
  test('OSE-799 | sponsor | schema | the combined `sponsors` table is retired (dropped)', () => {
    const sql = allMigrationSql();
    expect(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?sponsors["'`]?/i.test(sql),
      'the combined `sponsors` table (identity coupled to one event) must be dropped by the ' +
        'sponsor-identity split (0065) — leaving it keeps a sponsor a child of a night (rule 7)'
    ).toBe(true);
  });

  test('OSE-799 | sponsor | schema | the three split tables exist', () => {
    const sql = allMigrationSql();
    for (const t of ['sponsor_business', 'sponsor_asset', 'sponsor_placement']) {
      expect(createTableBody(sql, t), `${t} must exist (CREATE TABLE)`).not.toBeNull();
    }
  });

  test('OSE-799 | sponsor | privacy | locality_band is NOT NULL on sponsor_placement (replaces is_local)', () => {
    const sql = allMigrationSql();
    const body = createTableBody(sql, 'sponsor_placement');
    expect(body, 'sponsor_placement must exist').not.toBeNull();
    // The locality_band column line must declare NOT NULL — every active placement carries
    // a band, so the #25 local-floor allocation can never read a NULL.
    const line = (body ?? '').split(',').find((c) => /\blocality_band\b/.test(c)) ?? '';
    expect(
      /\blocality_band\b/.test(line) && /NOT\s+NULL/i.test(line),
      'sponsor_placement.locality_band must be declared NOT NULL — a nullable locality band ' +
        'would break the #25 local-floor allocation silently (doctrine: geo-derived, never null)'
    ).toBe(true);
  });

  test('OSE-799 | sponsor | #25 | sponsor_placement carries NO purchasable slot/size/position column', () => {
    const sql = allMigrationSql();
    const body = (createTableBody(sql, 'sponsor_placement') ?? '').toLowerCase();
    // Invariant #25: money buys frequency-share + report depth only — never a named slot.
    for (const banned of ['placement_formats', 'slot', 'size', 'position']) {
      expect(
        new RegExp(`\\b${banned}\\b`).test(body),
        `sponsor_placement must not declare a \`${banned}\` column — Invariant #25 forbids ` +
          `buying size/slot/position. Frequency-share is the only purchasable dimension.`
      ).toBe(false);
    }
  });
});
