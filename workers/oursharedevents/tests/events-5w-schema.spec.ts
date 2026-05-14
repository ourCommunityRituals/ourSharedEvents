/**
 * OSE-236 / BE-22 — events 5W content + corridor_id schema invariant.
 *
 * Locks in the contract from migration 0029_events_5w_and_corridor.sql.
 * Every column added MUST be present after migrations apply, with the
 * declared type and the declared nullability. Any future migration that
 * drops or retypes one of these columns fails this gate.
 *
 * Why this is load-bearing for Pulse 1:
 *   - FEAT-03.2 (lifecycle public page) consumes what_short, who_host,
 *     why_purpose, how_details, where_address directly.
 *   - FEAT-03.3 (OG preview) renders these into share cards.
 *   - pool-contract.ts:65 declares corridor_id as a REQUIRED_TAG on every
 *     BigQuery write — this migration is what makes the column physically
 *     present so handlers can populate the tag from a real source.
 *
 * Related gates:
 *   - fk-type-invariant.spec.ts (PR #154) enforces that
 *     events.corridor_id and corridors.id share TEXT affinity.
 *   - pagination-shape-invariant.spec.ts (OSE-206), pii-invariant
 *     (OSE-207), architecture.spec.ts (OSE-205), form-validation-invariant
 *     (OSE-204) round out the 5-gate handler-surface floor.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const EXPECTED_COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'what_short', type: 'TEXT' },
  { name: 'who_host', type: 'TEXT' },
  { name: 'why_purpose', type: 'TEXT' },
  { name: 'how_details', type: 'TEXT' },
  { name: 'where_address', type: 'TEXT' },
  { name: 'corridor_id', type: 'TEXT' },
];

let columnsByName: Map<string, ColumnInfo>;

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Idempotent re-runs: tolerate duplicate-column / no-such-column /
      // already-exists from migrations being applied across spec files.
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
  const info = await tenv.DB.prepare(`PRAGMA table_info('events')`).all<ColumnInfo>();
  const rows = info.results ?? [];
  columnsByName = new Map(rows.map((r) => [r.name, r]));
});

describe('OSE-236: events 5W content + corridor_id schema invariant', () => {
  test.each(EXPECTED_COLUMNS)('column $name is present with type $type', ({ name, type }) => {
    const col = columnsByName.get(name);
    expect(col, `events.${name} missing after migrations applied`).toBeDefined();
    // SQLite stores the declared type verbatim. Compare uppercase to be
    // tolerant of declaration-style drift (TEXT vs text).
    expect(col!.type.toUpperCase()).toBe(type.toUpperCase());
  });

  test.each(EXPECTED_COLUMNS)('column $name is nullable (backward-compat)', ({ name }) => {
    const col = columnsByName.get(name);
    expect(col, `events.${name} missing`).toBeDefined();
    // notnull = 0 means the column is nullable. Existing staging events
    // (pre-migration) MUST be able to coexist with rows that populate
    // the new fields, so all 6 must be nullable.
    expect(col!.notnull, `events.${name} must be nullable`).toBe(0);
  });

  test('events.corridor_id type matches corridors.id (FK affinity)', async () => {
    const tenv = env as unknown as TestEnv;
    const corridorIdInfo = columnsByName.get('corridor_id');
    expect(corridorIdInfo, 'events.corridor_id missing').toBeDefined();

    const corridorsTableInfo = await tenv.DB.prepare(
      `PRAGMA table_info('corridors')`
    ).all<ColumnInfo>();
    const corridorsId = (corridorsTableInfo.results ?? []).find((r) => r.name === 'id');
    expect(corridorsId, 'corridors.id missing (migration 0010 not applied?)').toBeDefined();

    // Both sides MUST share the same affinity class for the FK to work
    // without SQLite type-coercion surprises. Type-affinity is enforced
    // separately by fk-type-invariant.spec.ts (PR #154); this is the
    // table-level corroboration.
    expect(
      corridorIdInfo!.type.toUpperCase(),
      `events.corridor_id type (${corridorIdInfo!.type}) must match corridors.id type (${corridorsId!.type})`
    ).toBe(corridorsId!.type.toUpperCase());
  });

  test('existing geo columns lat/lon still present (no rename regression)', () => {
    // Migration 0021 added events.lat / events.lon. OSE-236 explicitly
    // reuses them instead of adding venue_lat/venue_lng — a rename here
    // would silently break any handler or test already consuming the
    // geo data on staging events.
    const lat = columnsByName.get('lat');
    const lon = columnsByName.get('lon');
    expect(lat, 'events.lat missing — migration 0021 rolled back?').toBeDefined();
    expect(lon, 'events.lon missing — migration 0021 rolled back?').toBeDefined();
    expect(lat!.type.toUpperCase()).toBe('REAL');
    expect(lon!.type.toUpperCase()).toBe('REAL');
  });

  test('insertion of a 5W-populated event round-trips through the schema', async () => {
    // Behavioral corroboration on the new columns. If a handler ever
    // adds a CHECK or NOT NULL constraint that breaks the contract,
    // this insert fails fast.
    const tenv = env as unknown as TestEnv;
    const id = `evt_5w_smoke_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events
           (id, brand_id, title, slug, status,
            what_short, who_host, why_purpose, how_details, where_address,
            corridor_id, created_at, updated_at)
         VALUES
           (?, 'ose236', '5W smoke', 'ose236-smoke', 'active',
            'A test event', 'Test Host', 'Verify the schema', 'Free, bring nothing', '123 Test Ave',
            NULL, datetime('now'), datetime('now'))`
    )
      .bind(id)
      .run();

    const row = await tenv.DB.prepare(
      `SELECT what_short, who_host, why_purpose, how_details, where_address, corridor_id
         FROM events WHERE id = ?`
    )
      .bind(id)
      .first<Record<string, string | null>>();

    expect(row).not.toBeNull();
    expect(row!.what_short).toBe('A test event');
    expect(row!.who_host).toBe('Test Host');
    expect(row!.why_purpose).toBe('Verify the schema');
    expect(row!.how_details).toBe('Free, bring nothing');
    expect(row!.where_address).toBe('123 Test Ave');
    expect(row!.corridor_id).toBeNull();
  });
});
