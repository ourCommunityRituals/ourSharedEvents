/**
 * OSE-489 — Venue/event H3 columns (S-6.1.1)
 *
 * 8 integration tests covering the full create → store → read cycle for
 * h3_res9 / h3_res7 cell tags, plus the backfill endpoint.
 *
 * Ground truth: Eagles Hall, Blue Island IL
 *   lat=41.6571, lon=-87.6798 → h3_res9='89266454447ffff', h3_res7='872664544ffffff'
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose489-h3-test';

const EAGLES = { lat: 41.6571, lon: -87.6798 };
const EAGLES_RES9 = '89266454447ffff';
const EAGLES_RES7 = '872664544ffffff';

// Rock Island Public House — same corridor (res7), different node (res9)
const RIPH = { lat: 41.6565, lon: -87.681 };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await (tenv.DB as D1Database).prepare(stmt).run();
    } catch (e: unknown) {
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

async function postEvent(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify(body),
  });
}

async function getEventRow(id: string): Promise<Record<string, unknown> | null> {
  const tenv = env as unknown as TestEnv;
  return (tenv.DB as D1Database)
    .prepare('SELECT id, lat, lon, h3_res9, h3_res7 FROM events WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
}

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  await (tenv.DB as D1Database).prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

describe('OSE-489: venue H3 column wiring', () => {
  test('1. CREATE with Eagles Hall lat/lon stores canonical H3 cells', async () => {
    const res = await postEvent({
      title: 'OSE-489 Eagles Hall Test',
      brand_id: BRAND,
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id?: string };
    expect(body.ok).toBe(true);

    const row = await getEventRow(body.id!);
    expect(row?.h3_res9).toBe(EAGLES_RES9);
    expect(row?.h3_res7).toBe(EAGLES_RES7);
  });

  test('2. CREATE without lat/lon stores null H3 cells', async () => {
    const res = await postEvent({ title: 'OSE-489 No-Geo Test', brand_id: BRAND });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id?: string };

    const row = await getEventRow(body.id!);
    expect(row?.lat).toBeNull();
    expect(row?.lon).toBeNull();
    expect(row?.h3_res9).toBeNull();
    expect(row?.h3_res7).toBeNull();
  });

  test('3. CREATE with only lat (missing lon) stores null H3 cells', async () => {
    const res = await postEvent({
      title: 'OSE-489 Partial-Geo Test',
      brand_id: BRAND,
      lat: EAGLES.lat,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id?: string };

    const row = await getEventRow(body.id!);
    expect(row?.h3_res9).toBeNull();
    expect(row?.h3_res7).toBeNull();
  });

  test('4. GET /api/v2/events/:id response includes h3_res9 and h3_res7', async () => {
    // Create an event with Eagles Hall coords
    const createRes = await postEvent({
      title: 'OSE-489 GET Test',
      brand_id: BRAND,
      status: 'active',
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    const createBody = (await createRes.json()) as { id?: string };

    const getRes = await SELF.fetch(`https://t.test/api/v2/events/${createBody.id}`, {
      headers: { ...ADMIN_HEADERS },
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { ok: boolean; item?: Record<string, unknown> };
    expect(getBody.ok).toBe(true);
    expect(getBody.item?.h3_res9).toBe(EAGLES_RES9);
    expect(getBody.item?.h3_res7).toBe(EAGLES_RES7);
  });

  test('5. UPDATE lat/lon recomputes H3 cells (Eagles Hall → RIPH)', async () => {
    // Start with Eagles Hall
    const createRes = await postEvent({
      title: 'OSE-489 Update Geo Test',
      brand_id: BRAND,
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    const { id } = (await createRes.json()) as { id: string };

    // Update to Rock Island Public House coords
    const updateRes = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ lat: RIPH.lat, lon: RIPH.lon }),
    });
    expect(updateRes.status).toBe(200);

    const row = await getEventRow(id);
    expect(row?.lat).toBeCloseTo(RIPH.lat, 4);
    expect(row?.lon).toBeCloseTo(RIPH.lon, 4);
    // RIPH is in the same corridor (res7) but a different node (res9)
    expect(row?.h3_res9).not.toBe(EAGLES_RES9);
    expect(row?.h3_res7).toBe(EAGLES_RES7); // same ~5km corridor
  });

  test('6. UPDATE non-geo fields leaves H3 cells unchanged', async () => {
    const createRes = await postEvent({
      title: 'OSE-489 H3 Preserve Test',
      brand_id: BRAND,
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    const { id } = (await createRes.json()) as { id: string };

    // Update only the title — H3 must remain
    const updateRes = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title: 'OSE-489 H3 Preserve Test (renamed)' }),
    });
    expect(updateRes.status).toBe(200);

    const row = await getEventRow(id);
    expect(row?.h3_res9).toBe(EAGLES_RES9);
    expect(row?.h3_res7).toBe(EAGLES_RES7);
  });

  test('7. Backfill endpoint computes H3 for existing events with lat/lon but no H3', async () => {
    const tenv = env as unknown as TestEnv;
    const db = tenv.DB as D1Database;

    // Insert a bare event row with lat/lon but no H3 (simulating pre-OSE-489 data)
    const bareId = `evt_ose489-backfill-${Date.now()}`;
    await db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, lat, lon, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .bind(bareId, BRAND, 'Backfill Test', 'backfill-test-489', 'draft', EAGLES.lat, EAGLES.lon)
      .run();

    // Confirm h3_res9 is NULL before backfill
    const before = await getEventRow(bareId);
    expect(before?.h3_res9).toBeNull();

    // Run the backfill endpoint
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/backfill-h3-cells', {
      method: 'POST',
      headers: { ...ADMIN_HEADERS },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; updated: number };
    expect(body.ok).toBe(true);
    expect(body.updated).toBeGreaterThanOrEqual(1);

    // Confirm H3 is now populated
    const after = await getEventRow(bareId);
    expect(after?.h3_res9).toBe(EAGLES_RES9);
    expect(after?.h3_res7).toBe(EAGLES_RES7);
  });

  test('8. Backfill endpoint skips events without lat/lon', async () => {
    const tenv = env as unknown as TestEnv;
    const db = tenv.DB as D1Database;

    // Insert event with no coords
    const noGeoId = `evt_ose489-no-geo-${Date.now()}`;
    await db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .bind(noGeoId, BRAND, 'No Geo Event', 'no-geo-489', 'draft')
      .run();

    const res = await SELF.fetch('https://t.test/api/v2/admin/events/backfill-h3-cells', {
      method: 'POST',
      headers: { ...ADMIN_HEADERS },
    });
    expect(res.status).toBe(200);

    const after = await getEventRow(noGeoId);
    expect(after?.h3_res9).toBeNull();
    expect(after?.h3_res7).toBeNull();
  });
});
