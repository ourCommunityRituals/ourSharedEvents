/**
 * Scan/report return-signal retention (lib/scan-returns-retention.ts, OSE-1351).
 *
 * Behavioural coverage against miniflare D1:
 *   - off by default: unset SCAN_RETURNS_RETENTION_DAYS never deletes anything
 *   - 0 / negative / junk also turn the sweep off
 *   - once configured, scan_node_returns rows older than the window are deleted
 *     (keyed off created_at)
 *   - once configured, anon_id_returns rows older than the window are deleted
 *     (keyed off last_seen_at, NOT first_seen_at — a still-returning pseudonym
 *     never ages out)
 *   - rows inside the window are left alone in both tables
 *   - one admin_audit_log row per run, never-who (no anon_id/hash logged)
 *   - the job is wired into the scheduled() cron alongside the other lifecycles
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src/index';
import type { RouterEnv } from '../src/router';
import {
  runScanReturnsRetention,
  resolveScanReturnsRetentionDays,
  type ScanReturnsRetentionEnv,
} from '../src/lib/scan-returns-retention';

const EVENT_ID = 'ose-scan-retention-venue';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  FORMS_DB: D1Database;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const [db, key] of [
    [tenv.DB, 'TEST_MIGRATION_STATEMENTS'],
    [tenv.FORMS_DB, 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    const stmts: string[] = JSON.parse((tenv as unknown as Record<string, string>)[key]);
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
  }
}

const db = () => (env as unknown as TestEnv).DB;

const OLD = '2020-01-01T00:00:00.000Z'; // far past any window
const FRESH = new Date().toISOString(); // inside any window

async function seedEvent(): Promise<void> {
  const exists = await db().prepare('SELECT id FROM events WHERE id = ?').bind(EVENT_ID).first();
  if (exists) return;
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
       VALUES (?, 'ose-scan-retention', 'Retention Venue', 'scan-retention-venue', 'active', ?, ?)`
    )
    .bind(EVENT_ID, FRESH, FRESH)
    .run();
}

async function seedScanNodeReturn(id: string, createdAt: string): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO scan_node_returns (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
       VALUES (?, ?, 'anon-test', 'ua-hash-test', 'US', 'bucket-1', ?)`
    )
    .bind(id, EVENT_ID, createdAt)
    .run();
}

async function seedAnonIdReturn(
  hash: string,
  firstSeenAt: string,
  lastSeenAt: string
): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO anon_id_returns (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count)
       VALUES (?, ?, ?, ?, 2)`
    )
    .bind(hash, EVENT_ID, firstSeenAt, lastSeenAt)
    .run();
}

async function scanNodeReturnCount(): Promise<number> {
  const row = await db()
    .prepare('SELECT COUNT(*) AS c FROM scan_node_returns WHERE event_id = ?')
    .bind(EVENT_ID)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function anonIdReturnCount(): Promise<number> {
  const row = await db()
    .prepare('SELECT COUNT(*) AS c FROM anon_id_returns WHERE venue_id = ?')
    .bind(EVENT_ID)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

beforeAll(async () => {
  await applyMigrations();
  await seedEvent();
});

beforeEach(async () => {
  await db().prepare('DELETE FROM scan_node_returns WHERE event_id = ?').bind(EVENT_ID).run();
  await db().prepare('DELETE FROM anon_id_returns WHERE venue_id = ?').bind(EVENT_ID).run();
  await db().prepare("DELETE FROM admin_audit_log WHERE action = 'SCAN_RETURNS_RETENTION'").run();
});

describe('resolveScanReturnsRetentionDays', () => {
  test('unset / blank → off (0) — Q3-ratified default stays uncapped', () => {
    expect(resolveScanReturnsRetentionDays(undefined)).toBe(0);
    expect(resolveScanReturnsRetentionDays('')).toBe(0);
    expect(resolveScanReturnsRetentionDays('  ')).toBe(0);
  });
  test('0, negative, junk → off (0)', () => {
    expect(resolveScanReturnsRetentionDays('0')).toBe(0);
    expect(resolveScanReturnsRetentionDays('-5')).toBe(0);
    expect(resolveScanReturnsRetentionDays('forever')).toBe(0);
  });
  test('a positive integer is honoured', () => {
    expect(resolveScanReturnsRetentionDays('30')).toBe(30);
  });
});

describe('runScanReturnsRetention', () => {
  const retentionEnv = (days?: string): ScanReturnsRetentionEnv => ({
    DB: db(),
    SCAN_RETURNS_RETENTION_DAYS: days,
  });

  test('unset knob: neither table is touched, even for very old rows', async () => {
    await seedScanNodeReturn('snr-untouched', OLD);
    await seedAnonIdReturn('hash-untouched', OLD, OLD);
    const r = await runScanReturnsRetention(retentionEnv());
    expect(r.enabled).toBe(false);
    expect(await scanNodeReturnCount()).toBe(1);
    expect(await anonIdReturnCount()).toBe(1);
  });

  test('scan_node_returns rows older than the window are deleted; fresh ones survive', async () => {
    await seedScanNodeReturn('snr-old', OLD);
    await seedScanNodeReturn('snr-fresh', FRESH);
    const r = await runScanReturnsRetention(retentionEnv('30'));
    expect(r.enabled).toBe(true);
    expect(r.scanReturnsDeleted).toBe(1);
    expect(await scanNodeReturnCount()).toBe(1);
  });

  test('anon_id_returns is keyed off last_seen_at, not first_seen_at', async () => {
    // first seen long ago, but still returning recently → must survive.
    await seedAnonIdReturn('hash-still-returning', OLD, FRESH);
    // first seen recently is impossible in practice but exercises the boundary:
    // an old last_seen_at alone is enough to age a row out.
    await seedAnonIdReturn('hash-gone-quiet', OLD, OLD);
    const r = await runScanReturnsRetention(retentionEnv('30'));
    expect(r.anonIdReturnsDeleted).toBe(1);
    expect(await anonIdReturnCount()).toBe(1);
  });

  test('SCAN_RETURNS_RETENTION_DAYS=0 turns the sweep off and says so in the audit log', async () => {
    await seedScanNodeReturn('snr-off', OLD);
    const r = await runScanReturnsRetention(retentionEnv('0'));
    expect(r.enabled).toBe(false);
    expect(await scanNodeReturnCount()).toBe(1);
    const audit = await db()
      .prepare(
        "SELECT details FROM admin_audit_log WHERE action = 'SCAN_RETURNS_RETENTION' ORDER BY rowid DESC LIMIT 1"
      )
      .first<{ details: string }>();
    expect(JSON.parse(audit!.details).outcomeRaw).toBe('noop');
  });

  test('one audit row per run, never-who: only aggregate counts are logged', async () => {
    await seedScanNodeReturn('snr-audit', OLD);
    await seedAnonIdReturn('hash-audit', OLD, OLD);
    await runScanReturnsRetention(retentionEnv('30'));
    const rows = await db()
      .prepare(
        "SELECT actor, outcome, details FROM admin_audit_log WHERE action = 'SCAN_RETURNS_RETENTION'"
      )
      .all<{ actor: string; outcome: string; details: string }>();
    expect(rows.results?.length).toBe(1);
    const row = rows.results![0];
    expect(row.actor).toBe('system:lifecycle');
    expect(row.outcome).toBe('success');
    const details = JSON.parse(row.details);
    expect(details.scanReturnsDeleted).toBe(1);
    expect(details.anonIdReturnsDeleted).toBe(1);
    expect(details.days).toBe(30);
    // never-who: no raw hash or row id shows up in the audit payload — only
    // the aggregate count fields (which happen to be named *AnonIdReturns*).
    expect(JSON.stringify(details)).not.toMatch(/hash-audit|snr-audit/i);
  });

  test('the window is configurable: a 1-day window catches a 2-day-old row', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    await seedScanNodeReturn('snr-2d', twoDaysAgo);
    expect((await runScanReturnsRetention(retentionEnv('30'))).scanReturnsDeleted).toBe(0);
    expect(await scanNodeReturnCount()).toBe(1);
    expect((await runScanReturnsRetention(retentionEnv('1'))).scanReturnsDeleted).toBe(1);
    expect(await scanNodeReturnCount()).toBe(0);
  });
});

describe('scheduled() wiring', () => {
  test('the daily cron runs the sweep alongside the other lifecycle jobs', async () => {
    await seedScanNodeReturn('snr-cron', OLD);
    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: '0 3 * * *', noRetry: () => {} },
      { ...(env as unknown as RouterEnv), SCAN_RETURNS_RETENTION_DAYS: '30' },
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(await scanNodeReturnCount()).toBe(0);
  });
});
