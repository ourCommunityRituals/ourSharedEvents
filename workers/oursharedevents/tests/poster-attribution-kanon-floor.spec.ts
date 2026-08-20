/**
 * OSE-711 — poster_attribution.scan_count must apply the K-anon floor.
 *
 * Release blocker (readiness audit 2026-08-11). Same class as OSE-683 but NOT
 * covered by it: the poster_attribution aggregate published `scan_count` RAW.
 * `HAVING scan_count > 0` in the builder query is a presence filter, not a
 * privacy floor — a poster deployment with 1–4 scans would emit its exact count
 * ALONGSIDE its h3_res9 geolocation, i.e. a location-correlated small-cohort
 * disclosure available at mid+ depth.
 *
 * The fix routes each poster row through applyCountFloor (the same uniform K=5
 * floor every other aggregate uses) and DROPS any deployment below the floor —
 * a suppressed-but-present row still discloses "a poster at this hex drew a
 * small crowd," which is exactly the leak, so sub-K deployments must not appear
 * at all. Deployments at or above the floor keep their exact count.
 *
 * Harness mirrors shared-report-kanon-floor.spec.ts (OSE-683): apply migrations
 * exactly once per isolate, seed poster_deployments + scans, build the report,
 * and assert on report.poster_attribution.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

// Migrations must apply EXACTLY ONCE per isolate (migration 0018 renames the
// sponsors table, which is not idempotent on re-apply — see the OSE-683 spec
// header for the full rationale). We only touch events/poster_deployments/scans
// here (now scan_placement_events after the OSE-798 split), but the guard keeps
// us consistent with the sibling spec's harness.
let migrated = false;
async function applyMigrations(): Promise<void> {
  if (migrated) return;
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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
  migrated = true;
}

async function clearTables(): Promise<void> {
  const db = tenv().DB;
  // Child rows first (FK order): scan_placement_events → poster_deployments → events.
  // OSE-798: poster_attribution counts the PLACEMENT side only, so this spec
  // seeds/clears scan_placement_events (never the session table).
  await db.prepare(`DELETE FROM scan_placement_events WHERE id LIKE 'spe-711-%'`).run();
  await db.prepare(`DELETE FROM poster_deployments WHERE id LIKE 'pd-711-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-711-%'`).run();
}

async function seedEvent(id: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', '2026-05-07T19:00:00Z',
               datetime('now'), datetime('now'))`
    )
    .bind(id, `Test ${id}`, id)
    .run();
}

/** Seed one poster deployment with a human label (surfaces as `location`). */
async function seedDeployment(id: string, eventId: string, label: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, location_desc)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, eventId, `qr-${id}`, label, label)
    .run();
}

/**
 * Seed exactly `n` placement scans for one deployment. COUNT(s.id) in the
 * builder query is the per-deployment scan_count the floor sees, so `n` is the
 * count under test. OSE-798: poster_attribution counts scan_placement_events
 * (the placement side); anonymous_id lives only on scan_node_returns and is not
 * needed for this floor test, so we seed the placement table only.
 */
async function seedScans(eventId: string, posterId: string, n: number): Promise<void> {
  const db = tenv().DB;
  for (let i = 0; i < n; i++) {
    await db
      .prepare(
        `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket, created_at)
         VALUES (?, ?, ?, '2026-W20', datetime('now'))`
      )
      .bind(`spe-711-${posterId}-${i}`, eventId, posterId)
      .run();
  }
}

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-711 — poster_attribution applies the uniform K-anon floor', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('the floor constant is K=5', () => {
    expect(CORRIDOR_MAP_MIN_COUNT).toBe(5);
  });

  test('a sub-K deployment is DROPPED from poster_attribution (3 scans must not appear)', async () => {
    const evt = 'test-evt-711-drop';
    await seedEvent(evt);
    await seedDeployment('pd-711-sub', evt, 'Corner of 3rd & Main');
    await seedScans(evt, 'pd-711-sub', 3); // below K → must be suppressed entirely

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = r.report.poster_attribution;
    // The sub-K deployment must not appear at all — neither its count nor its
    // location/h3 may be published for a 1–4 scan cohort.
    expect(rows.find((p) => p.poster_deployment_id === 'pd-711-sub')).toBeUndefined();
  });

  test('a deployment at/above K keeps its EXACT count (7 published)', async () => {
    const evt = 'test-evt-711-keep';
    await seedEvent(evt);
    await seedDeployment('pd-711-ok', evt, 'Library entrance');
    await seedScans(evt, 'pd-711-ok', 7); // clears K → exact count preserved

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = r.report.poster_attribution.find((p) => p.poster_deployment_id === 'pd-711-ok');
    expect(row).toBeDefined();
    expect(row!.scan_count).toBe(7);
  });

  test('mixed deployments: sub-K dropped, >=K kept, in the same report', async () => {
    const evt = 'test-evt-711-mixed';
    await seedEvent(evt);
    await seedDeployment('pd-711-big', evt, 'Main stage');
    await seedDeployment('pd-711-small', evt, 'Back alley');
    await seedScans(evt, 'pd-711-big', 9); // keep
    await seedScans(evt, 'pd-711-small', 4); // drop

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = r.report.poster_attribution;
    const big = rows.find((p) => p.poster_deployment_id === 'pd-711-big');
    const small = rows.find((p) => p.poster_deployment_id === 'pd-711-small');
    expect(big).toBeDefined();
    expect(big!.scan_count).toBe(9);
    expect(small).toBeUndefined();
    // Invariant: NO published poster row may carry a sub-K scan_count.
    for (const p of rows) {
      expect(p.scan_count).toBeGreaterThanOrEqual(CORRIDOR_MAP_MIN_COUNT);
    }
  });

  test('exactly-K boundary is inclusive (5 scans published, not suppressed)', async () => {
    const evt = 'test-evt-711-boundary';
    await seedEvent(evt);
    await seedDeployment('pd-711-edge', evt, 'Ticket booth');
    await seedScans(evt, 'pd-711-edge', CORRIDOR_MAP_MIN_COUNT); // exactly K

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = r.report.poster_attribution.find((p) => p.poster_deployment_id === 'pd-711-edge');
    expect(row).toBeDefined();
    expect(row!.scan_count).toBe(CORRIDOR_MAP_MIN_COUNT);
  });
});

describe('OSE-711 — aggregate-only invariant (static guard)', () => {
  // Belt-and-suspenders alongside the runtime coverage above: a future refactor
  // that returned the raw poster scan_count would trip here even if the seed
  // path regressed.
  function builderSrc(): string {
    const files = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const key = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').includes('lib/shared-report-builder')
    );
    expect(key, 'shared-report-builder.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    return files[key!]!;
  }

  test('poster_attribution routes scan_count through applyCountFloor', () => {
    const s = builderSrc();
    // The poster mapping must apply the uniform floor and filter suppressed rows,
    // and must NOT map `scan_count: r.scan_count` raw anywhere in the builder.
    expect(s).toContain('applyCountFloor(r.scan_count)');
    expect(s).toMatch(/\.filter\(\s*\(?x\)?\s*=>\s*!x\.floored\.suppressed\s*\)/);
    expect(s).not.toContain('scan_count: r.scan_count');
  });
});
