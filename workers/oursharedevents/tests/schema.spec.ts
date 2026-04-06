/**
 * Schema Verification Tests — runs in CI after every migration apply.
 *
 * Gates:
 *   1. All 8 tables exist post-migration
 *   2. PII firewall: scans table has no user_email, user_name, ip_address columns
 *   3. scan_aggregates is NOT writable via user-facing route handlers
 *   4. All expected indexes exist (19 custom indexes)
 *   5. Column counts match schema spec per table
 *
 * Migration SQL and source files are injected at build time via vitest.config.ts
 * `define` constants (Workers runtime cannot use node:fs).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

// ── Test env bindings (injected via vitest.config.ts miniflare bindings) ─────
// Workers runtime cannot use node:fs — migration SQL and source files are
// read at config time and passed as string bindings.
interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string; // JSON array of SQL statements
  TEST_SOURCE_FILES_JSON: string;
  TEST_WRANGLER_TOML: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const EXPECTED_TABLES = [
  'corridors',
  'events',
  'node_hierarchy',
  'poster_deployments',
  'scan_aggregates',
  'scans',
  'sponsors',
  'subscribers',
] as const;

const EXPECTED_INDEXES = [
  // Original (migrations 0001-0007)
  'idx_events_brand_status',
  'idx_events_slug',
  'idx_sponsors_event_id',
  'idx_poster_deployments_event_id',
  'idx_poster_deployments_qr_token',
  'idx_scans_event_bucket',
  'idx_scans_poster_deployment',
  'idx_scan_aggregates_event_date',
  // NCR v2 hierarchy (migration 0010)
  'idx_node_hierarchy_brand_level',
  'idx_node_hierarchy_parent',
  'idx_corridors_brand',
  'idx_corridors_status',
  'idx_corridors_signal_class',
  // Corridor growth model (migration 0011)
  'idx_corridors_parent',
  'idx_corridors_growth_pattern',
  'idx_node_hierarchy_legal_tier',
  // Ring emergence support (migration 0012)
  'idx_corridors_directionality',
  'idx_corridors_temporal',
  'idx_node_hierarchy_ring_role',
] as const;

const EXPECTED_COLUMN_COUNTS: Record<string, number> = {
  events: 16,
  sponsors: 12,
  poster_deployments: 10,
  scans: 9,
  scan_aggregates: 9,
  subscribers: 5,
  node_hierarchy: 14,
  corridors: 22,
};

// ── Apply migrations before tests ────────────────────────────────────────────

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // ALTER TABLE ADD COLUMN is not idempotent in SQLite —
      // "duplicate column" on re-run means the column already exists, which is fine.
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
});

// ── Gate 1: Table existence ──────────────────────────────────────────────────

describe('Gate 1: Table existence', () => {
  test('all 8 tables exist post-migration', async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    EXPECTED_TABLES.forEach((t) => expect(names).toContain(t));
  });

  test('each table is queryable (not missing)', async () => {
    for (const table of EXPECTED_TABLES) {
      const result = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).first<{
        cnt: number;
      }>();
      expect(result?.cnt).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Gate 2: Column counts match schema spec ──────────────────────────────────

describe('Gate 2: Column counts', () => {
  for (const [table, expectedCount] of Object.entries(EXPECTED_COLUMN_COUNTS)) {
    test(`${table} has ${expectedCount} columns`, async () => {
      const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
      expect(info.results.length).toBe(expectedCount);
    });
  }
});

// ── Gate 3: PII firewall ─────────────────────────────────────────────────────

describe('Gate 3: PII firewall', () => {
  test('scans table has NO user_email or user_name column', async () => {
    const info = await env.DB.prepare('PRAGMA table_info(scans)').all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).not.toContain('user_email');
    expect(cols).not.toContain('user_name');
    expect(cols).not.toContain('ip_address');
  });

  test('scans table has NO exact timestamp column', async () => {
    const info = await env.DB.prepare('PRAGMA table_info(scans)').all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).not.toContain('exact_timestamp');
    expect(cols).not.toContain('scanned_at');
    expect(cols).toContain('scan_bucket');
  });

  test('no route handler INSERTs PII columns into scans', () => {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    for (const [, content] of Object.entries(sources)) {
      if (/INSERT\s+INTO\s+scans/i.test(content)) {
        expect(content).not.toMatch(/user_email/i);
        expect(content).not.toMatch(/user_name/i);
        expect(content).not.toMatch(/ip_address/i);
      }
    }
  });
});

// ── Gate 4: scan_aggregates write protection ─────────────────────────────────

describe('Gate 4: scan_aggregates write protection', () => {
  test('scan_aggregates is NOT writable via user-facing route handlers', () => {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    for (const [, content] of Object.entries(sources)) {
      expect(content).not.toMatch(/INSERT\s+.*scan_aggregates/i);
    }
  });
});

// ── Gate 5: Index verification ───────────────────────────────────────────────

describe('Gate 5: Index verification', () => {
  test('all 19 custom indexes exist', async () => {
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).all();

    const names = indexes.results.map((r: Record<string, unknown>) => r.name);
    expect(names.length).toBe(19);
    EXPECTED_INDEXES.forEach((idx) => expect(names).toContain(idx));
  });
});
