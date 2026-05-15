/**
 * OSE-272 — SharedReport data pipeline static-invariant gates
 *
 * Defends the anonymity contract documented in
 * docs/features/SHARED-REPORT-DATA-PIPELINE.md across the schema and the
 * supporting library code. CI runs these on every PR.
 *
 * Gate inventory (from the design doc — gates 3 and 4 land in Sessions 3-4
 * when the materialization handler + BigQuery export ship):
 *
 *   Gate 1 (this file) — No FORMS_DB reads in any SharedReport
 *                        pipeline file (preserves ADR-001 isolation).
 *   Gate 2 (this file) — No raw anon_id storage. The new migrations
 *                        must define anon_id_hash columns and MUST NOT
 *                        define a column literally named `anon_id` in
 *                        any pipeline table.
 *
 * The lower-numbered gates (architecture.spec.ts, pii-invariant.spec.ts)
 * already defend the global rules. This file is the pipeline-specific
 * supplement — it asserts the SharedReport-pipeline-scoped subset of
 * those rules in one place so future contributors looking at the
 * pipeline can find its invariants without grepping.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// The set of pipeline-related migration files Gate 2 inspects.
// Add new files here as the pipeline grows.
const PIPELINE_MIGRATIONS = [
  '0031_create_anon_id_returns.sql',
  '0032_create_corridor_density_baseline.sql',
  '0033_create_event_series.sql',
  '0034_events_add_series_id.sql',
];

// The set of pipeline-related lib files Gate 1 inspects (Session 2 has
// only the hash lib; Session 3 will add the materialize handler).
const PIPELINE_LIB_FILES = ['src/lib/anon-id-hash.ts'];

function loadSource(relPath: string): string | null {
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const entry = Object.entries(sources).find(([p]) => p.replace(/\\/g, '/').endsWith(relPath));
  return entry ? entry[1] : null;
}

function loadMigrationByName(name: string): string | null {
  // The vitest config flattens all migrations into TEST_MIGRATION_STATEMENTS
  // as a JSON array of executed-statement strings. Match by filename via
  // the source-files map, which includes the .sql files too.
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith(`migrations/${name}`)
  );
  return entry ? entry[1] : null;
}

// ─── Gate 1 — no FORMS_DB reads in SharedReport pipeline source files ───────

describe('OSE-272 Gate 1: no FORMS_DB reads in pipeline source files', () => {
  test('src/lib/anon-id-hash.ts does not reference env.FORMS_DB', () => {
    const src = loadSource('src/lib/anon-id-hash.ts');
    expect(src, 'anon-id-hash.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/env\.FORMS_DB/);
    expect(src!).not.toMatch(/FORMS_DB\b/);
  });

  // Drift-guard — when Sessions 3-5 add materialize handler, BigQuery
  // exporter, and read API, register them here so this gate covers them.
  test('PIPELINE_LIB_FILES list is honest about what exists in src/', () => {
    for (const f of PIPELINE_LIB_FILES) {
      const src = loadSource(f);
      expect(src, `${f} expected to exist`).not.toBeNull();
    }
  });
});

// ─── Gate 2 — no raw anon_id columns in pipeline migration tables ───────────

describe('OSE-272 Gate 2: no raw anon_id columns in pipeline migrations', () => {
  // The anonymity contract: only anon_id_hash (peppered SHA-256, 32 hex) is
  // stored. A column literally named `anon_id` would defeat the entire moat.
  // This regex is intentionally narrow: matches `anon_id` as a column name
  // followed by a TYPE keyword. It must NOT match `anon_id_hash`.
  const RAW_ANON_ID_COLUMN = /\banon_id\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i;

  test('migration 0031 (anon_id_returns) stores anon_id_hash only, never raw anon_id', () => {
    const src = loadMigrationByName('0031_create_anon_id_returns.sql');
    expect(src, '0031 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    // Positive: anon_id_hash must be present
    expect(src!).toMatch(/anon_id_hash\s+TEXT\s+NOT\s+NULL/i);
    // Negative: no raw anon_id column
    expect(src!).not.toMatch(RAW_ANON_ID_COLUMN);
  });

  // SQL TYPE-followed regex catches column definitions like `anon_id TEXT NOT NULL`
  // but NOT free-text references to "anon_id" in comments (which is legal — comments
  // explaining the design are not violations).
  const COL_ANON_ID = /\banon_id\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i;
  const COL_IP_HASH = /\bip_hash\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i;
  const COL_EMAIL = /\bemail\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i;

  test('migration 0032 (corridor_density_baseline) has no per-attendee columns at all', () => {
    const src = loadMigrationByName('0032_create_corridor_density_baseline.sql');
    expect(src, '0032 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    // Corridor baseline is purely aggregate — no anon_id, no anon_id_hash,
    // no ip, no email. Just corridor + dow + hour + counts.
    expect(src!).not.toMatch(COL_ANON_ID);
    // Aggregates only — no per-attendee hash columns either
    expect(src!).not.toMatch(/\banon_id_hash\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i);
    expect(src!).not.toMatch(COL_IP_HASH);
    expect(src!).not.toMatch(COL_EMAIL);
  });

  test('migration 0033 (event_series) has no per-attendee columns', () => {
    const src = loadMigrationByName('0033_create_event_series.sql');
    expect(src, '0033 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    // event_series is metadata about a recurring pattern, not attendee data.
    expect(src!).not.toMatch(COL_ANON_ID);
    expect(src!).not.toMatch(COL_IP_HASH);
    expect(src!).not.toMatch(COL_EMAIL);
  });

  test('migration 0034 (events.series_id) only adds the series FK column', () => {
    const src = loadMigrationByName('0034_events_add_series_id.sql');
    expect(src, '0034 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).toMatch(/ALTER TABLE events ADD COLUMN series_id/i);
    // Sanity: doesn't sneak in any attendee-identity columns
    expect(src!).not.toMatch(COL_ANON_ID);
    expect(src!).not.toMatch(COL_IP_HASH);
  });

  test('drift-guard: PIPELINE_MIGRATIONS list covers every 003x_*.sql in migrations/', () => {
    // When future pipeline migrations land (0035+), add them to
    // PIPELINE_MIGRATIONS so Gate 2 keeps covering the full set.
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const found = new Set<string>();
    for (const [path] of Object.entries(sources)) {
      const normalized = path.replace(/\\/g, '/');
      const m = normalized.match(/migrations\/(003[1-9]_[\w-]+\.sql)$/);
      if (m) found.add(m[1]);
    }
    // Only check files that exist; PIPELINE_MIGRATIONS may legitimately
    // be a subset until later sessions add migrations.
    const declared = new Set(PIPELINE_MIGRATIONS);
    for (const name of found) {
      expect(
        declared.has(name),
        `Migration ${name} exists but is not registered in PIPELINE_MIGRATIONS — Gate 2 won't cover it`
      ).toBe(true);
    }
  });
});

// ─── Schema verification — tables exist with the expected columns ───────────

describe('OSE-272 Session 2: pipeline tables created with correct shape', () => {
  test('anon_id_returns table exists with anon_id_hash + venue_id PK', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    // Apply migrations
    const stmts: string[] = JSON.parse(tenv2.TEST_MIGRATION_STATEMENTS);
    for (const stmt of stmts) {
      try {
        await tenv2.DB.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
    const cols = await tenv2.DB.prepare(`PRAGMA table_info(anon_id_returns)`).all();
    const colNames = (cols.results as Array<{ name: string }>).map((c) => c.name).sort();
    expect(colNames).toContain('anon_id_hash');
    expect(colNames).toContain('venue_id');
    expect(colNames).toContain('first_seen_at');
    expect(colNames).toContain('last_seen_at');
    expect(colNames).toContain('visit_count');
    expect(colNames).toContain('computed_at');
    // CRITICAL: must NOT contain raw anon_id
    expect(colNames).not.toContain('anon_id');
  });

  test('corridor_density_baseline table exists with expected aggregate columns', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    const cols = await tenv2.DB.prepare(`PRAGMA table_info(corridor_density_baseline)`).all();
    const colNames = (cols.results as Array<{ name: string }>).map((c) => c.name).sort();
    expect(colNames).toContain('corridor_id');
    expect(colNames).toContain('bucket_dow');
    expect(colNames).toContain('bucket_hour');
    expect(colNames).toContain('window_30d_count');
    expect(colNames).toContain('window_90d_count');
    // CRITICAL: no attendee-identity columns
    expect(colNames).not.toContain('anon_id');
    expect(colNames).not.toContain('anon_id_hash');
    expect(colNames).not.toContain('ip_hash');
  });

  test('event_series table exists with 3-state lifecycle (Q2 hybrid)', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    const cols = await tenv2.DB.prepare(`PRAGMA table_info(event_series)`).all();
    const colNames = (cols.results as Array<{ name: string }>).map((c) => c.name).sort();
    expect(colNames).toContain('id');
    expect(colNames).toContain('venue_id');
    expect(colNames).toContain('series_name');
    expect(colNames).toContain('state');
    expect(colNames).toContain('detected_at');
    expect(colNames).toContain('confirmed_at');
    expect(colNames).toContain('rejected_reason');
  });

  test('event_series.state enforces pending|confirmed|rejected via CHECK', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    // Q2 hybrid lifecycle — the CHECK constraint must reject any other value
    await expect(
      tenv2.DB.prepare(
        `INSERT INTO event_series (id, venue_id, series_name, state) VALUES (?, ?, ?, ?)`
      )
        .bind('test-bad-state', 'evt-test', 'Bogus', 'archived')
        .run()
    ).rejects.toThrow();
  });

  test('event_series accepts the three valid lifecycle states', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    // First insert a venue event for the FK
    await tenv2.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, ?)`
    )
      .bind('evt-series-venue', 'test-brand', 'Series Venue', 'series-venue', 'active')
      .run();
    for (const state of ['pending', 'confirmed', 'rejected'] as const) {
      await expect(
        tenv2.DB.prepare(
          `INSERT INTO event_series (id, venue_id, series_name, state) VALUES (?, ?, ?, ?)`
        )
          .bind(`series-${state}`, 'evt-series-venue', `Test ${state}`, state)
          .run()
      ).resolves.toBeDefined();
    }
  });

  test('events.series_id column added by migration 0034 (TEXT, nullable, FK)', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    const cols = await tenv2.DB.prepare(`PRAGMA table_info(events)`).all();
    const colNames = (cols.results as Array<{ name: string }>).map((c) => c.name);
    expect(colNames).toContain('series_id');
  });
});

// ─── Anon-id-hash lib unit tests ────────────────────────────────────────────

describe('OSE-272 hashAnonIdForReturns — anonymity-preserving hash function', () => {
  test('returns null when pepper is undefined (graceful no-signal mode)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    expect(await hashAnonIdForReturns('anon_abc', undefined)).toBeNull();
  });

  test('returns null when pepper is empty string', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    expect(await hashAnonIdForReturns('anon_abc', '')).toBeNull();
  });

  test('returns a 32-char hex string when pepper is set', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const hash = await hashAnonIdForReturns('anon_abc123', 'test-pepper-rotate-me');
    expect(hash).not.toBeNull();
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });

  test('same input + same pepper produces same hash (determinism)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const a = await hashAnonIdForReturns('anon_xyz', 'pepper');
    const b = await hashAnonIdForReturns('anon_xyz', 'pepper');
    expect(a).toBe(b);
  });

  test('same input + different pepper produces different hash (blast-radius isolation)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const a = await hashAnonIdForReturns('anon_xyz', 'pepper-A');
    const b = await hashAnonIdForReturns('anon_xyz', 'pepper-B');
    expect(a).not.toBe(b);
  });

  test('different inputs + same pepper produce different hashes (no collision on canonical IDs)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const a = await hashAnonIdForReturns('anon_aaa', 'pepper');
    const b = await hashAnonIdForReturns('anon_bbb', 'pepper');
    expect(a).not.toBe(b);
  });

  test('hash does NOT contain the raw anon_id substring (one-way property)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const anonId = 'anon_someuniqueidentifier';
    const hash = await hashAnonIdForReturns(anonId, 'pepper');
    expect(hash).not.toBeNull();
    expect(hash!.toLowerCase()).not.toContain('someuniqueidentifier');
  });
});
