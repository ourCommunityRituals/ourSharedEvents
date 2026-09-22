/**
 * Scan raw-row prune — the prune-raw half of the ingest pipeline
 * (lib/scan-raw-prune.ts, OSE-1091).
 *
 * The pipeline is ingest → aggregate-in → prune-raw. Stages 1 and 2 shipped
 * (scan-buffer.ts, aggregateScanBuckets); this covers stage 3.
 *
 * What these prove, in the order that matters:
 *   - OFF BY DEFAULT. An unset knob deletes nothing, however old the rows —
 *     so this does not silently overturn the Q3-ratified "no table-level
 *     windowing" decision.
 *   - LOSSLESS BY CONSTRUCTION. A raw row is pruned only once its value is
 *     provably extracted: the event must already have a `scan_aggregates` row
 *     (interlock 1) and the pepper must be set so the return-signal half ran
 *     (interlock 2). Either missing → nothing is deleted.
 *   - THE COUNT SURVIVES. `scan_placement_events` is never touched, so scan
 *     counts and the delete-activity guard are unaffected by a prune. This is
 *     the property that makes pruning the WHO side safe at all.
 *   - The window floor keeps a prune clear of the 26h materialization ceiling.
 *   - One never-who audit row per run; wired into scheduled().
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src/index';
import type { RouterEnv } from '../src/router';
import {
  runScanRawPrune,
  resolveScanRawPruneDays,
  MIN_PRUNE_DAYS,
  type ScanRawPruneEnv,
} from '../src/lib/scan-raw-prune';
import { aggregateScanBuckets } from '../src/lib/shared-report';

const EVENT_ID = 'ose-raw-prune-event';
/** A second event that deliberately never gets an aggregate row. */
const UNAGG_EVENT_ID = 'ose-raw-prune-unaggregated';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
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

const OLD = '2020-01-01T00:00:00.000Z';
const FRESH = new Date().toISOString();
const PEPPER = 'test-pepper-not-a-real-secret';

async function seedEvent(id: string): Promise<void> {
  const exists = await db().prepare('SELECT id FROM events WHERE id = ?').bind(id).first();
  if (exists) return;
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
       VALUES (?, 'ose-raw-prune', 'Prune Event', ?, 'active', ?, ?)`
    )
    .bind(id, `slug-${id}`, FRESH, FRESH)
    .run();
}

/**
 * A raw return row.
 *
 * `scan_bucket` is DERIVED from `created_at` rather than fixed, because that is
 * how the real write path builds it (`scanBucket()` in `handlers/qr-scan.ts`
 * formats the same instant the row is written). Pinning every row to one
 * literal bucket would put rows years apart in the same hour, which cannot
 * happen in production and would misrepresent the bucket-atomicity rule.
 */
async function seedRawReturn(id: string, createdAt: string, eventId = EVENT_ID): Promise<void> {
  const bucket = `${createdAt.slice(0, 13)}:00`;
  await db()
    .prepare(
      `INSERT INTO scan_node_returns (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
       VALUES (?, ?, 'anon-raw-test', 'ua-hash', 'US', ?, ?)`
    )
    .bind(id, eventId, bucket, createdAt)
    .run();
}

async function seedPlacementEvent(id: string, eventId = EVENT_ID): Promise<void> {
  // poster_deployment_id is NOT NULL with an FK, so the deployment must exist.
  const deploymentId = `pd-${eventId}`;
  await db()
    .prepare(
      `INSERT OR IGNORE INTO poster_deployments (id, event_id, qr_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(deploymentId, eventId, `qrt_${deploymentId}`, FRESH, FRESH)
    .run();
  await db()
    .prepare(
      `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket, created_at)
       VALUES (?, ?, ?, '2020-01-01T00:00', ?)`
    )
    .bind(id, eventId, deploymentId, OLD)
    .run();
}

/** Stand in for a completed aggregate-in pass (interlock 1). */
async function seedAggregate(eventId = EVENT_ID): Promise<void> {
  await db()
    .prepare(
      `INSERT OR REPLACE INTO scan_aggregates
         (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
       VALUES (?, ?, '2020-01-01', 0, 5, 3, ?)`
    )
    .bind(`agg_${eventId}`, eventId, FRESH)
    .run();
}

async function rawCount(eventId = EVENT_ID): Promise<number> {
  const row = await db()
    .prepare('SELECT COUNT(*) AS c FROM scan_node_returns WHERE event_id = ?')
    .bind(eventId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function placementCount(eventId = EVENT_ID): Promise<number> {
  const row = await db()
    .prepare('SELECT COUNT(*) AS c FROM scan_placement_events WHERE event_id = ?')
    .bind(eventId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

beforeAll(async () => {
  await applyMigrations();
  await seedEvent(EVENT_ID);
  await seedEvent(UNAGG_EVENT_ID);
});

beforeEach(async () => {
  for (const id of [EVENT_ID, UNAGG_EVENT_ID]) {
    await db().prepare('DELETE FROM scan_node_returns WHERE event_id = ?').bind(id).run();
    await db().prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(id).run();
    await db().prepare('DELETE FROM scan_aggregates WHERE event_id = ?').bind(id).run();
  }
  await db().prepare("DELETE FROM admin_audit_log WHERE action = 'SCAN_RAW_PRUNE'").run();
});

/**
 * `pepper` is an explicit options field rather than a defaulted positional:
 * passing `undefined` to a defaulted parameter re-applies the default in JS,
 * which would silently turn the "missing pepper" cases into "pepper present"
 * and make interlock 2 untestable.
 */
const pruneEnv = (days?: string, opts: { pepper?: string } = { pepper: PEPPER }): ScanRawPruneEnv =>
  ({
    DB: db(),
    SCAN_RAW_PRUNE_DAYS: days,
    ANON_ID_HASH_PEPPER: opts.pepper,
  }) as ScanRawPruneEnv;

describe('resolveScanRawPruneDays', () => {
  test('unset / blank → off (0)', () => {
    expect(resolveScanRawPruneDays(undefined)).toBe(0);
    expect(resolveScanRawPruneDays('')).toBe(0);
    expect(resolveScanRawPruneDays('   ')).toBe(0);
  });

  test('0, negative, junk → off (0)', () => {
    expect(resolveScanRawPruneDays('0')).toBe(0);
    expect(resolveScanRawPruneDays('-7')).toBe(0);
    expect(resolveScanRawPruneDays('never')).toBe(0);
  });

  test('a value below the floor is RAISED to it, never silently disabled', () => {
    expect(resolveScanRawPruneDays('1')).toBe(MIN_PRUNE_DAYS);
  });

  test('a positive value at or above the floor is honoured', () => {
    expect(resolveScanRawPruneDays('30')).toBe(30);
  });

  test('the floor clears the 26h materialization ceiling', () => {
    // A prune must never race materializeAnonIdReturns, which may read an
    // event's raw rows until 26h after end_date.
    expect(MIN_PRUNE_DAYS * 24).toBeGreaterThan(26);
  });
});

describe('runScanRawPrune — off by default', () => {
  test('unset knob deletes nothing, however old the rows', async () => {
    await seedAggregate();
    await seedRawReturn('raw-untouched', OLD);

    const r = await runScanRawPrune(pruneEnv());
    expect(r.enabled).toBe(false);
    expect(r.rowsPruned).toBe(0);
    expect(await rawCount()).toBe(1);
  });
});

describe('runScanRawPrune — interlocks', () => {
  test('interlock 1: no scan_aggregates row → nothing is pruned', async () => {
    // The aggregate-in half never ran for THIS event, so its raw rows still
    // hold the only copy of their signal. Age alone must not be enough.
    //
    // A neighbouring event IS aggregated and IS pruned in the same sweep. That
    // matters: without it, `scan_aggregates` would be empty and the EXISTS
    // clause would be false for trivial reasons, so this test would pass even
    // against a defeated interlock. The pairing forces the guard to correlate
    // per event rather than merely observe that some aggregate exists.
    await seedAggregate(EVENT_ID);
    await seedRawReturn('raw-aggregated', OLD, EVENT_ID);
    await seedRawReturn('raw-unagg', OLD, UNAGG_EVENT_ID);

    const r = await runScanRawPrune(pruneEnv('30'));

    expect(r.rowsPruned).toBe(1);
    expect(await rawCount(EVENT_ID), 'the aggregated event is pruned').toBe(0);
    expect(await rawCount(UNAGG_EVENT_ID), 'the un-aggregated event is spared').toBe(1);
  });

  test('interlock 2: missing pepper blocks the sweep entirely', async () => {
    // Without the pepper, materializeAnonIdReturns no-ops, so anon_id_returns
    // was never populated — pruning here would destroy un-extracted signal.
    await seedAggregate();
    await seedRawReturn('raw-no-pepper', OLD);

    const r = await runScanRawPrune(pruneEnv('30', {}));
    expect(r.blockedOnPepper).toBe(true);
    expect(r.rowsPruned).toBe(0);
    expect(await rawCount()).toBe(1);
  });

  test('a blank pepper is treated as unset', async () => {
    await seedAggregate();
    await seedRawReturn('raw-blank-pepper', OLD);

    const r = await runScanRawPrune(pruneEnv('30', { pepper: '   ' }));
    expect(r.blockedOnPepper).toBe(true);
    expect(await rawCount()).toBe(1);
  });

  test('both interlocks satisfied → old raw rows are pruned, fresh ones survive', async () => {
    await seedAggregate();
    await seedRawReturn('raw-old', OLD);
    await seedRawReturn('raw-fresh', FRESH);

    const r = await runScanRawPrune(pruneEnv('30'));
    expect(r.enabled).toBe(true);
    expect(r.blockedOnPepper).toBe(false);
    expect(r.rowsPruned).toBe(1);
    expect(await rawCount()).toBe(1);
  });
});

describe('runScanRawPrune — the count of record survives', () => {
  test('scan_placement_events is NEVER pruned, even when its twin row is', async () => {
    // This is the property that makes pruning the WHO side safe: the WHERE side
    // is the scan gauge (handlers/event-stats.ts) and the delete-activity guard
    // (handleDeleteEvent). A prune must leave it exactly as it found it.
    await seedAggregate();
    await seedRawReturn('raw-twin', OLD);
    await seedPlacementEvent('spe-twin');

    const r = await runScanRawPrune(pruneEnv('30'));
    expect(r.rowsPruned).toBe(1);
    expect(await rawCount()).toBe(0);
    expect(await placementCount(), 'the WHERE side must survive the prune').toBe(1);
  });

  test('static: the prune statement never names scan_placement_events', () => {
    const sources = JSON.parse(
      (env as unknown as Record<string, string>).TEST_SOURCE_FILES_JSON
    ) as Record<string, string>;
    const entry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('lib/scan-raw-prune.ts')
    );
    expect(entry, 'scan-raw-prune.ts must be in the source map').toBeDefined();

    const deletes = entry![1].match(/DELETE FROM [\s\S]*?(?=`)/g) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    for (const stmt of deletes) {
      expect(stmt).not.toMatch(/scan_placement_events/);
    }
  });
});

describe('runScanRawPrune — audit', () => {
  test('writes exactly one never-who audit row per run', async () => {
    await seedAggregate();
    await seedRawReturn('raw-audited', OLD);

    await runScanRawPrune(pruneEnv('30'));

    const rows = await db()
      .prepare(
        "SELECT details, actor, outcome FROM admin_audit_log WHERE action = 'SCAN_RAW_PRUNE'"
      )
      .all<{ details: string; actor: string; outcome: string }>();
    expect(rows.results?.length).toBe(1);

    const row = rows.results![0];
    expect(row.actor).toBe('system:lifecycle');
    expect(row.outcome).toBe('success');
    expect(JSON.parse(row.details)).toMatchObject({ rowsPruned: 1, days: 30 });
    // never-who: the anon id seeded above must appear nowhere in the audit row.
    expect(JSON.stringify(row)).not.toContain('anon-raw-test');
  });

  test('the disabled path is still audited, so a no-op is visible', async () => {
    await runScanRawPrune(pruneEnv());
    const row = await db()
      .prepare("SELECT details FROM admin_audit_log WHERE action = 'SCAN_RAW_PRUNE'")
      .first<{ details: string }>();
    expect(JSON.parse(row!.details)).toMatchObject({ enabled: false, rowsPruned: 0 });
  });
});

describe('OSE-1091 — aggregate-in → prune-raw composes end to end', () => {
  const PIPE_EVENT = 'ose-raw-prune-pipeline';

  test('the real rollup extracts the numbers, then the prune removes the raw rows', async () => {
    // The whole point of the ticket, exercised against the ACTUAL aggregation
    // function rather than a hand-seeded aggregate row: after both stages, the
    // counts are intact and the raw pseudonymous ids are gone.
    await seedEvent(PIPE_EVENT);
    // aggregateScanBuckets only considers events started within 90 days.
    await db()
      .prepare("UPDATE events SET start_date = datetime('now','-3 days') WHERE id = ?")
      .bind(PIPE_EVENT)
      .run();
    await db().prepare('DELETE FROM scan_node_returns WHERE event_id = ?').bind(PIPE_EVENT).run();
    await db().prepare('DELETE FROM scan_aggregates WHERE event_id = ?').bind(PIPE_EVENT).run();

    // Three scans in one hour bucket from two distinct visitors.
    const bucket = '2026-09-01T10:00';
    for (const [id, anon] of [
      ['pipe-1', 'anon-alpha'],
      ['pipe-2', 'anon-alpha'],
      ['pipe-3', 'anon-beta'],
    ]) {
      await db()
        .prepare(
          `INSERT INTO scan_node_returns (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
           VALUES (?, ?, ?, 'ua', 'US', ?, ?)`
        )
        .bind(id, PIPE_EVENT, anon, bucket, OLD)
        .run();
    }

    // Stage 2 — the real rollup.
    await aggregateScanBuckets({ DB: db(), ANON_ID_HASH_PEPPER: PEPPER });
    const agg = await db()
      .prepare('SELECT total_scans, distinct_agent_hashes FROM scan_aggregates WHERE event_id = ?')
      .bind(PIPE_EVENT)
      .first<{ total_scans: number; distinct_agent_hashes: number }>();
    expect(agg?.total_scans).toBe(3);
    expect(agg?.distinct_agent_hashes).toBe(2);

    // Stage 3 — the prune.
    const r = await runScanRawPrune(pruneEnv('30'));
    expect(r.rowsPruned).toBeGreaterThanOrEqual(3);
    expect(await rawCount(PIPE_EVENT)).toBe(0);

    // The extracted numbers are untouched by the prune.
    const after = await db()
      .prepare('SELECT total_scans, distinct_agent_hashes FROM scan_aggregates WHERE event_id = ?')
      .bind(PIPE_EVENT)
      .first<{ total_scans: number; distinct_agent_hashes: number }>();
    expect(after?.total_scans).toBe(3);
    expect(after?.distinct_agent_hashes).toBe(2);

    // And the raw pseudonymous ids are genuinely gone from the table.
    const leaked = await db()
      .prepare(
        "SELECT COUNT(*) AS c FROM scan_node_returns WHERE anonymous_id IN ('anon-alpha','anon-beta')"
      )
      .first<{ c: number }>();
    expect(leaked?.c ?? 0).toBe(0);
  });
});

describe('OSE-1091 — a prune must never make an aggregate undercount', () => {
  const STRADDLE_EVENT = 'ose-raw-prune-straddle';
  const BUCKET = '2026-09-01T10:00';

  async function aggregateCounts() {
    return db()
      .prepare('SELECT total_scans, distinct_agent_hashes FROM scan_aggregates WHERE event_id = ?')
      .bind(STRADDLE_EVENT)
      .first<{ total_scans: number; distinct_agent_hashes: number }>();
  }

  test('a bucket straddling the cutoff is pruned all-or-nothing, never partially', async () => {
    // THE HAZARD. `aggregateScanBuckets` re-reads raw rows for every event
    // started in the last 90 days, recomputes each hour bucket, and writes it
    // back with INSERT OR REPLACE.
    //
    //   - Prune an ENTIRE bucket → it vanishes from the query, no REPLACE
    //     fires, and the stored aggregate survives. Safe.
    //   - Prune only PART of a bucket → the recomputed count is lower and
    //     REPLACES the correct one. A silent undercount.
    //
    // Partial buckets are not exotic: the cutoff is a moving instant and the
    // cron runs hourly, so it lands mid-bucket routinely. This test builds that
    // exact straddle — one row either side of a 30-day cutoff, in ONE bucket.
    await seedEvent(STRADDLE_EVENT);
    await db()
      .prepare("UPDATE events SET start_date = datetime('now','-10 days') WHERE id = ?")
      .bind(STRADDLE_EVENT)
      .run();
    await db()
      .prepare('DELETE FROM scan_node_returns WHERE event_id = ?')
      .bind(STRADDLE_EVENT)
      .run();
    await db().prepare('DELETE FROM scan_aggregates WHERE event_id = ?').bind(STRADDLE_EVENT).run();

    for (const [id, anon, age] of [
      ['straddle-old', 'anon-one', '-40 days'],
      ['straddle-new', 'anon-two', '-1 days'],
    ]) {
      await db()
        .prepare(
          `INSERT INTO scan_node_returns (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
           VALUES (?, ?, ?, 'ua', 'US', ?, datetime('now', ?))`
        )
        .bind(id, STRADDLE_EVENT, anon, BUCKET, age)
        .run();
    }

    const aggEnv = { DB: db(), ANON_ID_HASH_PEPPER: PEPPER };
    await aggregateScanBuckets(aggEnv);
    expect(await aggregateCounts()).toMatchObject({ total_scans: 2, distinct_agent_hashes: 2 });

    // 30-day cutoff falls between the two rows.
    await runScanRawPrune(pruneEnv('30'));

    // The next cron tick re-aggregates. If the prune had split the bucket, this
    // is where the aggregate would be silently rewritten downward.
    await aggregateScanBuckets(aggEnv);

    expect(
      await aggregateCounts(),
      'the aggregate must not be rewritten downward by a partial prune'
    ).toMatchObject({ total_scans: 2, distinct_agent_hashes: 2 });
  });

  test('once the whole bucket is past the cutoff, it prunes and the aggregate still stands', async () => {
    // The complement: bucket-atomicity must not mean "never prunes". With both
    // rows past the cutoff the bucket leaves cleanly, and because the bucket is
    // then absent from the rollup query, no REPLACE fires and the stored
    // aggregate keeps the counts it already extracted.
    await seedEvent(STRADDLE_EVENT);
    await db()
      .prepare("UPDATE events SET start_date = datetime('now','-10 days') WHERE id = ?")
      .bind(STRADDLE_EVENT)
      .run();
    await db()
      .prepare('DELETE FROM scan_node_returns WHERE event_id = ?')
      .bind(STRADDLE_EVENT)
      .run();
    await db().prepare('DELETE FROM scan_aggregates WHERE event_id = ?').bind(STRADDLE_EVENT).run();

    for (const [id, anon] of [
      ['whole-a', 'anon-one'],
      ['whole-b', 'anon-two'],
    ]) {
      await db()
        .prepare(
          `INSERT INTO scan_node_returns (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
           VALUES (?, ?, ?, 'ua', 'US', ?, datetime('now', '-40 days'))`
        )
        .bind(id, STRADDLE_EVENT, anon, BUCKET)
        .run();
    }

    const aggEnv = { DB: db(), ANON_ID_HASH_PEPPER: PEPPER };
    await aggregateScanBuckets(aggEnv);
    expect(await aggregateCounts()).toMatchObject({ total_scans: 2, distinct_agent_hashes: 2 });

    const r = await runScanRawPrune(pruneEnv('30'));
    expect(r.rowsPruned).toBe(2);
    expect(await rawCount(STRADDLE_EVENT)).toBe(0);

    await aggregateScanBuckets(aggEnv);
    expect(await aggregateCounts()).toMatchObject({ total_scans: 2, distinct_agent_hashes: 2 });
  });
});

describe('runScanRawPrune — shipped configuration', () => {
  test('wrangler.toml keeps the prune DISABLED — QR scans are kept indefinitely', () => {
    // RULING (2026-09-22): QR scan data is part of the event's permanent
    // historical record and has no expiry. That is the opposite posture from
    // FORMS_DB (opt-in PII, bounded) and subscribers (365d). This test is the
    // guard on that decision: if someone enables the sweep, they have to change
    // this line and this expectation together, deliberately.
    const toml = (env as unknown as Record<string, string>).TEST_WRANGLER_TOML;
    const match = toml.match(/^SCAN_RAW_PRUNE_DAYS\s*=\s*"(\d+)"/m);
    expect(match, 'SCAN_RAW_PRUNE_DAYS must be present as visible config').not.toBeNull();
    expect(parseInt(match![1], 10), 'scan retention is indefinite by ruling').toBe(0);
  });

  test('the shipped config resolves to a disabled sweep', () => {
    const toml = (env as unknown as Record<string, string>).TEST_WRANGLER_TOML;
    const configured = toml.match(/^SCAN_RAW_PRUNE_DAYS\s*=\s*"(\d+)"/m)![1];
    expect(resolveScanRawPruneDays(configured)).toBe(0);
  });
});

describe('runScanRawPrune — cron wiring', () => {
  test('the scheduled() handler runs the prune', async () => {
    const ctx = createExecutionContext();
    await worker.scheduled!(
      { cron: '0 * * * *', scheduledTime: Date.now(), noRetry: () => {} } as ScheduledEvent,
      env as unknown as RouterEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);

    const row = await db()
      .prepare("SELECT COUNT(*) AS c FROM admin_audit_log WHERE action = 'SCAN_RAW_PRUNE'")
      .first<{ c: number }>();
    expect(row?.c ?? 0).toBeGreaterThan(0);
  });
});
