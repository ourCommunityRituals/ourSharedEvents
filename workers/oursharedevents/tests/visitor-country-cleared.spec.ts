/**
 * OSE-1460 — the visitor's IP country is not held (PO decision 2026-10-01).
 *
 * Migration 0088 clears scan_node_returns.country_code and
 * scan_aggregates.top_country, and nothing writes them again: the scan path no
 * longer reads the country header (qr-scan.spec.ts) and the roll-up writes NULL.
 *
 * @born-red OSE-1460 | method: migration-clears-recorded-country | armed: 2026-10-01
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { aggregateScanBuckets } from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;

function statements(): string[] {
  return JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[];
}

beforeAll(async () => {
  for (const stmt of statements()) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date)
     VALUES ('evt-vcc', 'vcc', 'VCC', 'vcc', 'active', datetime('now'))`
  ).run();
});

const clears = (): string[] =>
  statements().filter((s) => /SET\s+(country_code|top_country)\s*=\s*NULL/i.test(s));

describe('OSE-1460 — migration 0088 clears the recorded visitor country', () => {
  test('both columns are cleared, and a re-run is a no-op', async () => {
    await tenv.DB.prepare(
      `INSERT INTO scan_node_returns (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
       VALUES ('snr-vcc-1', 'evt-vcc', 'anon-vcc', 'ua', 'US', '2026-09-30T18:00', datetime('now'))`
    ).run();
    await tenv.DB.prepare(
      `INSERT INTO scan_aggregates (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, top_country, computed_at)
       VALUES ('agg-vcc', 'evt-vcc', '2026-09-30', 18, 1, 1, 'US', datetime('now'))`
    ).run();

    expect(clears()).toHaveLength(2);
    for (let run = 0; run < 2; run++) {
      for (const s of clears()) await tenv.DB.prepare(s).run();
      const snr = await tenv.DB.prepare(
        `SELECT COUNT(*) AS n FROM scan_node_returns WHERE country_code IS NOT NULL`
      ).first<{ n: number }>();
      const agg = await tenv.DB.prepare(
        `SELECT COUNT(*) AS n FROM scan_aggregates WHERE top_country IS NOT NULL`
      ).first<{ n: number }>();
      expect(snr?.n).toBe(0);
      expect(agg?.n).toBe(0);
    }
  });

  test('the nightly roll-up writes top_country as NULL even if a country is present', async () => {
    await tenv.DB.prepare(
      `INSERT INTO scan_node_returns (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
       VALUES ('snr-vcc-2', 'evt-vcc', 'anon-vcc-2', 'ua2', 'CA', '2026-09-30T19:00', datetime('now'))`
    ).run();
    const r = await aggregateScanBuckets({ DB: tenv.DB } as never);
    expect(r.errors).toBe(0);
    const row = await tenv.DB.prepare(
      `SELECT COUNT(*) AS n FROM scan_aggregates WHERE event_id = 'evt-vcc' AND top_country IS NOT NULL`
    ).first<{ n: number }>();
    expect(row?.n).toBe(0);
    // A country written after 0088 ran (an older Worker in the deploy window)
    // is cleared by the roll-up itself.
    const snr = await tenv.DB.prepare(
      `SELECT country_code FROM scan_node_returns WHERE id = 'snr-vcc-2'`
    ).first<{ country_code: string | null }>();
    expect(snr?.country_code).toBeNull();
  });
});
