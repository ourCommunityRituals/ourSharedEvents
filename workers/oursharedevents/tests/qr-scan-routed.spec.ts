/**
 * OSE-939 — Scan-path routed twin (Option 3: the in-process SELF.fetch proof).
 *
 * WHY THIS EXISTS (distinct from qr-scan.spec.ts):
 *   qr-scan.spec.ts calls handleQrScan() DIRECTLY — it proves the handler writes
 *   the A2 split rows. It does NOT prove the routed request path. The OSE-939
 *   staging dry-run failed at exactly that seam: a real browser passed the CF
 *   managed challenge but was "redirected to `/` without replaying the deep
 *   link", so the handler never ran for a valid+active token and no scan wrote.
 *
 *   That symptom is invisible to a direct-handler test. This spec drives
 *   `GET /q/<qr_token>` through the worker's own fetch entrypoint (SELF.fetch →
 *   src/index.ts → router → handleQrScan) so router dispatch + deep-link replay
 *   are under test. It is the runnable L1 proof the OSE-939 DoD says to keep
 *   "regardless" of the founder-lane WAF skip — the WAF exemption unblocks the
 *   NETWORK E2E (OSE-554); this proves the app-level scan path in-process.
 *
 * DoD asserted here (no CF edge, so no managed challenge in the way):
 *   - Routed `/q/<valid active token>` 302-redirects to `/forms/<eventId>`
 *     (the deep-link IS replayed) — NOT to `/`.
 *   - Exactly one scan_placement_events row (WHERE) AND one scan_node_returns
 *     row (WHO) land for the event.
 *   - Routed `/q/<unknown token>` 302s to `/` and writes nothing — confirming
 *     that a `/` landing is the bad-token path only, so a `/` landing for a
 *     GOOD token (the staging symptom) localizes to the edge, not the app.
 *
 * Format: `OSE-939 | INTEGRATION | <description> | <assertion>`.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

const TEST_EVENT_ID = 'test-evt-qr-routed';
const TEST_DEPLOYMENT_ID = 'test-pd-qr-routed-001';
const VALID_QR_TOKEN = 'qrt_routed_scan_token_939abc';
const UNKNOWN_QR_TOKEN = 'qrt_routed_unknown_token_939xyz';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15';

async function applyMigrations(): Promise<void> {
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
}

async function seedEventAndDeployment(db: D1Database): Promise<void> {
  // Parent first — FK-ON isolates (constraints.spec sets PRAGMA foreign_keys=ON,
  // which can bleed across a file's isolate). See seed-ordering gotcha.
  await db
    .prepare(
      `INSERT OR REPLACE INTO events
         (id, brand_id, title, slug, status, start_date, created_at, updated_at)
       VALUES (?, 'brand-test', 'QR Routed Test Event', ?, 'active', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(TEST_EVENT_ID, TEST_EVENT_ID)
    .run();

  await db
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments
         (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'Routed Test Poster', 1, datetime('now'))`
    )
    .bind(TEST_DEPLOYMENT_ID, TEST_EVENT_ID, VALID_QR_TOKEN)
    .run();
}

async function countPlacementRows(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM scan_placement_events WHERE event_id = ?`)
    .bind(TEST_EVENT_ID)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function countNodeReturnRows(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM scan_node_returns WHERE event_id = ?`)
    .bind(TEST_EVENT_ID)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

beforeAll(async () => {
  await applyMigrations();
  await seedEventAndDeployment(tenv().DB);
});

beforeEach(async () => {
  await tenv()
    .DB.prepare(`DELETE FROM scan_placement_events WHERE event_id = ?`)
    .bind(TEST_EVENT_ID)
    .run();
  await tenv()
    .DB.prepare(`DELETE FROM scan_node_returns WHERE event_id = ?`)
    .bind(TEST_EVENT_ID)
    .run();
});

describe('OSE-939: routed scan path — GET /q/<token> via SELF.fetch', () => {
  test('OSE-939 | INTEGRATION | valid active token | routed request replays deep link → 302 /forms/<eventId>, not /', async () => {
    const res = await SELF.fetch(
      `https://t.test/q/${encodeURIComponent(VALID_QR_TOKEN)}?type=register`,
      {
        headers: { 'User-Agent': IPHONE_UA },
        redirect: 'manual',
      }
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    // The staging symptom was a `/` landing for a good token — assert we did NOT
    // land on `/`, and that the deep link to the form page IS replayed.
    expect(
      location,
      'good token must not fall back to `/` — that was the OSE-939 symptom'
    ).not.toBe('/');
    expect(location).toContain(`/forms/${TEST_EVENT_ID}`);
    expect(location).toContain('type=register');
    expect(location).toContain(`deployment=${TEST_DEPLOYMENT_ID}`);
  });

  test('OSE-939 | INTEGRATION | valid active token | both A2 split rows land (WHERE + WHO)', async () => {
    const res = await SELF.fetch(`https://t.test/q/${encodeURIComponent(VALID_QR_TOKEN)}`, {
      headers: { 'User-Agent': IPHONE_UA },
      redirect: 'manual',
    });
    expect(res.status).toBe(302);

    // The core M1 transaction: one placement event (WHERE) + one node return (WHO).
    expect(await countPlacementRows(tenv().DB), 'exactly one scan_placement_events row').toBe(1);
    expect(await countNodeReturnRows(tenv().DB), 'exactly one scan_node_returns row').toBe(1);
  });

  test('OSE-939 | INTEGRATION | node return row | carries anonymous_id, no placement id column exists', async () => {
    await SELF.fetch(`https://t.test/q/${encodeURIComponent(VALID_QR_TOKEN)}`, {
      headers: { 'User-Agent': IPHONE_UA },
      redirect: 'manual',
    });

    const row = await tenv()
      .DB.prepare(
        `SELECT anonymous_id, scan_bucket FROM scan_node_returns WHERE event_id = ? LIMIT 1`
      )
      .bind(TEST_EVENT_ID)
      .first<{ anonymous_id: string; scan_bucket: string }>();

    expect(row).not.toBeNull();
    expect(row!.anonymous_id).toMatch(/^anon_/);
    // Privacy invariant survives the routed path: hour-granularity bucket only.
    expect(row!.scan_bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
  });

  test('OSE-939 | INTEGRATION | unknown token | routed request 302s to `/` and writes nothing', async () => {
    const res = await SELF.fetch(`https://t.test/q/${encodeURIComponent(UNKNOWN_QR_TOKEN)}`, {
      headers: { 'User-Agent': IPHONE_UA },
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    // `/` is the bad-token landing — this is what makes a `/` landing for a GOOD
    // token (test above) provably an edge problem, not app routing.
    expect(res.headers.get('Location')).toBe('/');
    expect(await countPlacementRows(tenv().DB)).toBe(0);
    expect(await countNodeReturnRows(tenv().DB)).toBe(0);
  });
});
