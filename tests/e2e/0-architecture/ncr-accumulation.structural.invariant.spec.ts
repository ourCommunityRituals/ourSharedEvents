/**
 * INVARIANT 4: NCR Data Accumulation — STRUCTURAL code-shape lock (L0)
 *
 * This is the PR-gating structural complement to ncr-accumulation.invariant.spec.ts.
 * That sibling is a live-worker (runtime) spec — it exercises a deployed worker
 * and therefore runs ONLY in T4 Functional, skipping on PRs. So invariant #4 was
 * `status: live` in the brain with NO PR-gating enforcement of the accumulation
 * pipeline's load-bearing shape. (OSE-1298 / F9.)
 *
 * This spec reads the source via node:fs and asserts the accumulation pipeline's
 * shape. It needs NO deployed worker, so it runs in the T0 Gate `invariants`
 * shard on every PR + push. It does NOT replace the runtime spec — it adds the
 * structural gate alongside it.
 *
 * Brain Invariant #4 (ncr_data_accumulation):
 *   - status: live · brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * What #4 guarantees (the shape asserted here):
 *   - poster_deployments carry lat/lng for geo-spatial mapping.
 *   - scan rows store a coarse hour BUCKET, never an exact timestamp (privacy).
 *   - scan_aggregates are pre-computed rollups WRITTEN BY THE SCHEDULED WORKER
 *     ONLY — no user-facing endpoint writes them.
 *   - scan data is PERMANENT (no PII ⇒ no TTL) — the compound asset.
 *   - sponsor_displays capture surface + placement for attribution.
 *
 * Source of truth (asserted here):
 *   - migrations/0003_create_poster_deployments.sql   (lat/lng atoms)
 *   - migrations/0004_create_scans.sql                 (scan_bucket, no exact time)
 *   - migrations/0006_create_scan_aggregates.sql       (rollup table, no TTL)
 *   - migrations/0022_create_sponsor_impressions.sql   (surface + placement)
 *   - src/handlers/qr-scan.ts                           (hour-bucketed scan write)
 *   - src/lib/shared-report.ts                          (aggregateScanBuckets writer)
 *   - src/handlers/sponsors.ts                          (impression/click write)
 *
 * Pattern reference: tenant-isolation.invariant.spec.ts (same readFileSync L0
 * structural approach).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_ROOT = join(REPO_ROOT, 'workers', 'oursharedevents');
const MIGRATIONS_DIR = join(WORKER_ROOT, 'migrations');
const SRC_DIR = join(WORKER_ROOT, 'src');
const QR_SCAN = join(SRC_DIR, 'handlers', 'qr-scan.ts');
const SHARED_REPORT = join(SRC_DIR, 'lib', 'shared-report.ts');
const SPONSORS = join(SRC_DIR, 'handlers', 'sponsors.ts');
const INDEX = join(SRC_DIR, 'index.ts');

/** Recursively collect every .ts file under a directory. */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test.describe('Invariant 4: NCR Data Accumulation — structural code-shape lock', () => {
  // ── Schema atoms ─────────────────────────────────────────────────────────────

  test('OSE-INV4 | schema | 0003 poster_deployments carry latitude + longitude', () => {
    const migration = join(MIGRATIONS_DIR, '0003_create_poster_deployments.sql');
    expect(existsSync(migration), '0003_create_poster_deployments.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // lat/lng on the deployment is the geo-spatial atom — without it a scan
    // cannot be placed on a map or rolled into a corridor.
    expect(sql, 'poster_deployments must carry latitude REAL').toMatch(/latitude\s+REAL/i);
    expect(sql, 'poster_deployments must carry longitude REAL').toMatch(/longitude\s+REAL/i);
  });

  test('OSE-INV4 | privacy | 0004 scans store scan_bucket, not an exact timestamp', () => {
    const migration = join(MIGRATIONS_DIR, '0004_create_scans.sql');
    expect(existsSync(migration), '0004_create_scans.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // scan_bucket (hour-granularity) is the privacy contract: scans are grouped
    // into time windows so an individual cannot be tracked to a moment.
    expect(
      sql,
      'scans must define scan_bucket TEXT NOT NULL — the privacy-by-schema time column'
    ).toMatch(/scan_bucket\s+TEXT\s+NOT\s+NULL/i);
    // No exact per-scan event time. created_at (row insert time) is the only
    // timestamp allowed; a `scanned_at`/`occurred_at` column would defeat the bucket.
    expect(
      sql,
      'scans must NOT store an exact scan time (scanned_at/occurred_at) — the hour bucket is the privacy floor'
    ).not.toMatch(/\b(scanned_at|occurred_at|scan_time|exact_time)\b/i);
  });

  test('OSE-INV4 | permanence | 0006 scan_aggregates declare NO TTL / expiry column', () => {
    const migration = join(MIGRATIONS_DIR, '0006_create_scan_aggregates.sql');
    expect(existsSync(migration), '0006_create_scan_aggregates.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    expect(sql, '0006 must create scan_aggregates').toMatch(/CREATE TABLE[^;]*scan_aggregates/i);
    // "No PII = no TTL": scan aggregates are the permanent compound asset. A
    // ttl/expires column would be the mechanism for deletion — its absence is
    // the invariant. (The daily lifecycle cron scrubs PII tables, never this one.)
    expect(
      sql,
      'scan_aggregates must NOT declare an expiry/TTL column — accumulation is permanent (the compound asset)'
    ).not.toMatch(/\b(expires_at|expiry|ttl|delete_after|purge_at)\b/i);
  });

  test('OSE-INV4 | permanence | 0087 scan_cell_aggregates: no TTL, no placement id, no session value', () => {
    // OSE-1459 / ADR-011: scans counted at the poster's own res9 cell. Same
    // permanence as scan_aggregates (no expiry column), and the place-side
    // half of doctrine rule 6 (OSE-798): a row that carries a place must carry
    // no session-derived value, and the cell is the place — no poster id.
    const migration = join(MIGRATIONS_DIR, '0087_scan_cell_aggregates.sql');
    expect(existsSync(migration), '0087_scan_cell_aggregates.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    const create = sql.match(/CREATE TABLE[^;]*scan_cell_aggregates[^;]*;/i)?.[0] ?? '';
    expect(create, '0087 must create scan_cell_aggregates').not.toBe('');
    expect(create, 'scan_cell_aggregates must NOT declare an expiry/TTL column').not.toMatch(
      /\b(expires_at|expiry|ttl|delete_after|purge_at)\b/i
    );
    expect(
      create,
      'scan_cell_aggregates must not store a placement id — the cell is the place'
    ).not.toMatch(/\b(poster_deployment_id|placement_id|qr_token)\b/i);
    expect(
      create,
      'scan_cell_aggregates must not carry a session-derived value (doctrine rule 6)'
    ).not.toMatch(
      /\b(anonymous_id|anon_id\w*|user_agent_hash|distinct_agent_hashes|country_code|top_country)\b/i
    );
  });

  test('OSE-INV4 | schema | 0022 sponsor_displays capture surface + placement', () => {
    const migration = join(MIGRATIONS_DIR, '0022_create_sponsor_impressions.sql');
    expect(existsSync(migration), '0022_create_sponsor_impressions.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // surface + placement are the attribution atoms — which surface showed the
    // sponsor, in which placement. Both NOT NULL so every impression is attributable.
    expect(sql, 'sponsor_displays must carry surface TEXT NOT NULL').toMatch(
      /surface\s+TEXT\s+NOT\s+NULL/i
    );
    expect(sql, 'sponsor_displays must carry placement TEXT NOT NULL').toMatch(
      /placement\s+TEXT\s+NOT\s+NULL/i
    );
  });

  // ── Scan write path — hour-bucketed, no exact time ───────────────────────────

  test('OSE-INV4 | privacy | scan ingestion buckets time to the hour, not the minute', () => {
    expect(existsSync(QR_SCAN), 'handlers/qr-scan.ts must exist').toBe(true);
    const src = readFileSync(QR_SCAN, 'utf8');
    // The scan write persists scan_bucket, not a raw timestamp.
    expect(src, 'scan ingestion must persist scan_bucket').toMatch(/scan_bucket/);
    // The bucket string ends at the hour (`:00`). Widening it to minute/second
    // granularity would make a scan re-identifiable to a moment — the whole
    // point of the bucket. This literal `:00` is the hour floor.
    expect(
      src,
      "the scan bucket must be hour-granularity — the template literal must pin minutes to ':00'"
    ).toMatch(/:00`/);
  });

  // ── Aggregation writer — scheduled-only, single write site ───────────────────

  test('OSE-INV4 | pipeline | aggregateScanBuckets rolls scans into scan_aggregates', () => {
    expect(existsSync(SHARED_REPORT), 'lib/shared-report.ts must exist').toBe(true);
    const src = readFileSync(SHARED_REPORT, 'utf8');
    expect(src, 'shared-report.ts must export aggregateScanBuckets — the rollup writer').toMatch(
      /export\s+async\s+function\s+aggregateScanBuckets\s*\(/
    );
    // The rollup is an upsert into scan_aggregates (idempotent re-materialization).
    expect(src, 'aggregateScanBuckets must write scan_aggregates via INSERT OR REPLACE').toMatch(
      /INSERT\s+OR\s+REPLACE\s+INTO\s+scan_aggregates/i
    );
  });

  test('OSE-INV4 | pipeline | scan_aggregates is WRITTEN by exactly one file — the aggregation lib', () => {
    // "WRITTEN BY SCHEDULED WORKER ONLY" (migration 0006). Enforced as a write-
    // site locality property: scan every .ts under src/ and assert the only file
    // that writes `INTO scan_aggregates` is the aggregation lib. A new writer in
    // a request handler — the way a user-facing endpoint would corrupt the
    // pre-computed rollup — fails here the day it is added.
    // Require the INSERT keyword — a prose comment mentioning "into
    // scan_aggregates" is not a write. Covers plain INSERT and INSERT OR REPLACE.
    const writers = walkTs(SRC_DIR)
      .filter((f) =>
        /INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+scan_aggregates/i.test(readFileSync(f, 'utf8'))
      )
      .map((f) => f.slice(SRC_DIR.length + 1).replace(/\\/g, '/'))
      .sort();
    expect(
      writers,
      'exactly one file may write scan_aggregates (the scheduled aggregation lib). ' +
        'A second writer — especially in handlers/ — means a user-facing path can ' +
        'mutate the rollup, breaking "written by scheduled worker only".\nfound: ' +
        writers.join(', ')
    ).toEqual(['lib/shared-report.ts']);
  });

  test('OSE-INV4 | pipeline | scan_cell_aggregates is WRITTEN by exactly one file — the aggregation lib', () => {
    // OSE-1459: the place-side rollup is held to the same rule as
    // scan_aggregates — written by the scheduled aggregation lib only.
    const writers = walkTs(SRC_DIR)
      .filter((f) =>
        /INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+scan_cell_aggregates/i.test(readFileSync(f, 'utf8'))
      )
      .map((f) => f.slice(SRC_DIR.length + 1).replace(/\\/g, '/'))
      .sort();
    expect(
      writers,
      'exactly one file may write scan_cell_aggregates (the scheduled aggregation lib).\nfound: ' +
        writers.join(', ')
    ).toEqual(['lib/shared-report.ts']);
  });

  test('OSE-INV4 | pipeline | the scheduled worker wires the materialization run', () => {
    expect(existsSync(INDEX), 'src/index.ts must exist').toBe(true);
    const src = readFileSync(INDEX, 'utf8');
    // The aggregation reaches D1 only through the scheduled() orchestrator. If
    // this call is dropped, aggregateScanBuckets becomes dead code and no rollup
    // is ever written — accumulation stops silently.
    expect(
      src,
      'index.ts scheduled() must invoke runSharedReportMaterialization — the only path that reaches aggregateScanBuckets'
    ).toMatch(/runSharedReportMaterialization\s*\(/);
  });

  // ── Impression/click write path — surface + placement attribution ────────────

  test('OSE-INV4 | attribution | impression/click writes name surface + placement', () => {
    expect(existsSync(SPONSORS), 'handlers/sponsors.ts must exist').toBe(true);
    const src = readFileSync(SPONSORS, 'utf8');
    // Every impression row carries surface + placement in its INSERT column list
    // — the NCR attribution atoms. Omitting them would still satisfy the NOT NULL
    // constraint only via defaults; naming them explicitly is the contract.
    expect(
      src,
      'sponsors.ts must INSERT INTO sponsor_displays naming surface + placement columns'
    ).toMatch(/INSERT\s+INTO\s+sponsor_displays\s*\([^)]*\bsurface\b[^)]*\bplacement\b/i);
  });
});
