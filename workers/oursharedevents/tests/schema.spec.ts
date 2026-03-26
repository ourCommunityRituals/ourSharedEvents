/**
 * Schema Verification Tests — runs in CI after every migration apply.
 *
 * Gates:
 *   1. All 7 tables exist post-migration
 *   2. PII firewall: scans table has no user_email, user_name, ip_address columns
 *   3. scan_aggregates is NOT writable via user-facing route handlers
 *   4. All expected indexes exist (11 custom indexes)
 *   5. Column counts match schema spec per table
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Constants ────────────────────────────────────────────────────────────────

const EXPECTED_TABLES = [
  'events',
  'sponsors',
  'poster_deployments',
  'scans',
  'checkins',
  'registrations',
  'scan_aggregates',
] as const;

const EXPECTED_INDEXES = [
  'idx_events_brand_status',
  'idx_events_slug',
  'idx_sponsors_event_id',
  'idx_poster_deployments_event_id',
  'idx_poster_deployments_qr_token',
  'idx_scans_event_bucket',
  'idx_scans_poster_deployment',
  'idx_checkins_event_id',
  'idx_registrations_event_id',
  'idx_registrations_source_placement',
  'idx_scan_aggregates_event_date',
] as const;

const EXPECTED_COLUMN_COUNTS: Record<string, number> = {
  events: 16,
  sponsors: 12,
  poster_deployments: 10,
  scans: 9,
  checkins: 7,
  registrations: 8,
  scan_aggregates: 9,
};

// ── Apply migrations before tests ────────────────────────────────────────────

beforeAll(async () => {
  const migrationsDir = join(__dirname, '..', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // Split on semicolons to handle multi-statement files
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      await env.DB.prepare(stmt).run();
    }
  }
});

// ── Gate 1: Table existence ──────────────────────────────────────────────────

describe('Gate 1: Table existence', () => {
  test('all 7 tables exist post-migration', async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    EXPECTED_TABLES.forEach((t) => expect(names).toContain(t));
  });

  test('each table returns 0 rows (empty, not missing)', async () => {
    for (const table of EXPECTED_TABLES) {
      const result = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM ${table}`
      ).first<{ cnt: number }>();
      expect(result?.cnt).toBe(0);
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
    // scan_bucket is allowed; exact_timestamp / scanned_at are not
    expect(cols).not.toContain('exact_timestamp');
    expect(cols).not.toContain('scanned_at');
    expect(cols).toContain('scan_bucket');
  });

  test('no route handler INSERTs PII columns into scans', () => {
    const srcDir = join(__dirname, '..', 'src');
    const tsFiles = findTsFiles(srcDir);

    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf8');
      // If the file references INSERT INTO scans, it must not include PII column names
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
    const srcDir = join(__dirname, '..', 'src');
    const tsFiles = findTsFiles(srcDir);

    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf8');
      // No route handler should INSERT into scan_aggregates
      // (only the scheduled worker is allowed to write)
      expect(content).not.toMatch(/INSERT\s+.*scan_aggregates/i);
    }
  });
});

// ── Gate 5: Index verification ───────────────────────────────────────────────

describe('Gate 5: Index verification', () => {
  test('all 11 custom indexes exist', async () => {
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).all();

    const names = indexes.results.map((r: Record<string, unknown>) => r.name);
    expect(names.length).toBe(11);
    EXPECTED_INDEXES.forEach((idx) => expect(names).toContain(idx));
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findTsFiles(fullPath));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist yet
  }
  return results;
}
