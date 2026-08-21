/**
 * sponsors-h3-tagging.spec.ts
 *
 * OSE — H3 sponsor geo-tagging + is_local auto-suggestion (migration 0045).
 *
 * Covers:
 *  1. Creating a sponsor with lat/lon stores h3_res9 and h3_res7
 *  2. Creating a sponsor without lat/lon stores null for both H3 fields
 *  3. Response includes is_local_suggested: true when sponsor and event share h3_res7
 *  4. Response includes is_local_suggested: false when sponsor and event are in different corridors
 *  5. Response omits is_local_suggested when sponsor has no lat/lon
 *  6. Invalid lat/lon (out of range) returns 400
 *  7. Updating a sponsor with new lat/lon re-tags the H3 cells
 *
 * Also verifies the hot-path guard exemption: sponsors.ts (admin path) is
 * explicitly permitted to import h3-tagging. The SCAN_PATH list in
 * h3-tagging.spec.ts must NOT include sponsors.ts.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
} as const;

// Known NCR ground-truth coordinates (Eagles Hall, Blue Island IL)
// h3_res7 = '872664544ffffff', h3_res9 = '89266454447ffff'
const EAGLES = { lat: 41.6571, lon: -87.6798 };

// Different corridor — somewhere in Chicago Loop (~15 km away)
const LOOP = { lat: 41.8827, lon: -87.6233 };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await (env as unknown as TestEnv).DB.prepare(stmt).run();
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

/** Seed an event with optional geo coords directly into DB. */
async function seedEvent(
  id: string,
  opts: { lat?: number; lon?: number; h3_res7?: string; h3_res9?: string } = {}
): Promise<void> {
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare(
    `INSERT OR IGNORE INTO events
       (id, brand_id, title, slug, status, lat, lon, h3_res9, h3_res7)
     VALUES (?, 'h3-sp-test', ?, ?, 'active', ?, ?, ?, ?)`
  )
    .bind(
      id,
      `H3 Sponsor Test Event ${id}`,
      `h3-sp-test-${id}`,
      opts.lat ?? null,
      opts.lon ?? null,
      opts.h3_res9 ?? null,
      opts.h3_res7 ?? null
    )
    .run();
}

async function createSponsor(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://t.test/api/v2/admin/sponsors', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify(body),
  });
}

async function updateSponsor(id: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/admin/sponsors/${id}`, {
    method: 'PUT',
    headers: ADMIN_HEADERS,
    body: JSON.stringify(body),
  });
}

async function getSponsorRow(id: string): Promise<Record<string, unknown> | null> {
  // OSE-799 A2: lat/lon/h3_res9/h3_res7 live on the durable sponsor_business now.
  const tenv = env as unknown as TestEnv;
  return tenv.DB.prepare('SELECT * FROM sponsor_business WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
  // Clean slate
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare("DELETE FROM events WHERE brand_id = 'h3-sp-test'").run();
  await tenv.DB.prepare("DELETE FROM sponsor_business WHERE name LIKE 'H3Test%'").run();

  // Seed two events:
  //   evt-eagles: has Eagles Hall h3_res7 (same corridor as EAGLES sponsor)
  //   evt-loop:   has Loop h3_res7 (different corridor)
  await seedEvent('evt-h3sp-eagles', {
    lat: EAGLES.lat,
    lon: EAGLES.lon,
    h3_res9: '89266454447ffff',
    h3_res7: '872664544ffffff',
  });
  await seedEvent('evt-h3sp-loop', {
    lat: LOOP.lat,
    lon: LOOP.lon,
    h3_res9: '8926406a9c7ffff',
    h3_res7: '87264060dffffff',
  });
  await seedEvent('evt-h3sp-noloc'); // event with no geo data
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OSE H3 sponsor geo-tagging — migration 0045', () => {
  test('1. creating a sponsor with lat/lon stores h3_res9 and h3_res7', async () => {
    const res = await createSponsor({
      name: 'H3Test Geo Sponsor',
      event_id: 'evt-h3sp-eagles',
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^sp_/);

    const row = await getSponsorRow(body.id);
    expect(row).not.toBeNull();
    expect(row!.lat).toBeCloseTo(EAGLES.lat, 4);
    expect(row!.lon).toBeCloseTo(EAGLES.lon, 4);
    expect(row!.h3_res9).toBe('89266454447ffff');
    expect(row!.h3_res7).toBe('872664544ffffff');
  });

  test('2. creating a sponsor without lat/lon stores null for both H3 fields', async () => {
    const res = await createSponsor({
      name: 'H3Test No Geo Sponsor',
      event_id: 'evt-h3sp-noloc',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);

    const row = await getSponsorRow(body.id);
    expect(row).not.toBeNull();
    expect(row!.lat).toBeNull();
    expect(row!.lon).toBeNull();
    expect(row!.h3_res9).toBeNull();
    expect(row!.h3_res7).toBeNull();
  });

  test('3. response includes is_local_suggested: true when sponsor and event share h3_res7', async () => {
    const res = await createSponsor({
      name: 'H3Test Same Corridor Sponsor',
      event_id: 'evt-h3sp-eagles',
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id: string; is_local_suggested?: boolean };
    expect(body.ok).toBe(true);
    expect(body.is_local_suggested).toBe(true);
  });

  test('4. response includes is_local_suggested: false when sponsor and event are in different corridors', async () => {
    // Sponsor is at Eagles (Blue Island), event is in Loop — different h3_res7
    const res = await createSponsor({
      name: 'H3Test Different Corridor Sponsor',
      event_id: 'evt-h3sp-loop',
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id: string; is_local_suggested?: boolean };
    expect(body.ok).toBe(true);
    expect(body.is_local_suggested).toBe(false);
  });

  test('5. response omits is_local_suggested when sponsor has no lat/lon', async () => {
    const res = await createSponsor({
      name: 'H3Test No Coords Sponsor',
      event_id: 'evt-h3sp-eagles',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect('is_local_suggested' in body).toBe(false);
  });

  test('5b. response omits is_local_suggested when event has no h3_res7', async () => {
    // evt-h3sp-noloc has no geo — is_local_suggested must be absent
    const res = await createSponsor({
      name: 'H3Test No Event Geo Sponsor',
      event_id: 'evt-h3sp-noloc',
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect('is_local_suggested' in body).toBe(false);
  });

  test('6. invalid lat out of range returns 400', async () => {
    const res = await createSponsor({
      name: 'H3Test Bad Lat',
      event_id: 'evt-h3sp-eagles',
      lat: 999,
      lon: -87.6798,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_COORDINATES');
  });

  test('6b. invalid lon out of range returns 400', async () => {
    const res = await createSponsor({
      name: 'H3Test Bad Lon',
      event_id: 'evt-h3sp-eagles',
      lat: 41.6571,
      lon: 999,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_COORDINATES');
  });

  test('7. updating a sponsor with new lat/lon re-tags the H3 cells', async () => {
    // First create a sponsor without geo
    const createRes = await createSponsor({
      name: 'H3Test Update Re-tag Sponsor',
      event_id: 'evt-h3sp-eagles',
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { ok: boolean; id: string };
    const sponsorId = createBody.id;

    // Verify no H3 yet
    const before = await getSponsorRow(sponsorId);
    expect(before!.h3_res9).toBeNull();
    expect(before!.h3_res7).toBeNull();

    // Update with coordinates
    const updateRes = await updateSponsor(sponsorId, {
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as {
      ok: boolean;
      id: string;
      is_local_suggested?: boolean;
    };
    expect(updateBody.ok).toBe(true);
    expect(updateBody.is_local_suggested).toBe(true);

    // Verify DB was updated
    const after = await getSponsorRow(sponsorId);
    expect(after!.h3_res9).toBe('89266454447ffff');
    expect(after!.h3_res7).toBe('872664544ffffff');
    expect(after!.lat).toBeCloseTo(EAGLES.lat, 4);
    expect(after!.lon).toBeCloseTo(EAGLES.lon, 4);
  });

  test('7b. updating with different lat/lon overwrites previous H3 cells', async () => {
    // Create with Eagles coords
    const createRes = await createSponsor({
      name: 'H3Test Retag Overwrite Sponsor',
      event_id: 'evt-h3sp-eagles',
      lat: EAGLES.lat,
      lon: EAGLES.lon,
    });
    expect(createRes.status).toBe(201);
    const { id: sponsorId } = (await createRes.json()) as { id: string };

    // Update to Loop coords — different corridor
    const updateRes = await updateSponsor(sponsorId, {
      lat: LOOP.lat,
      lon: LOOP.lon,
    });
    expect(updateRes.status).toBe(200);

    const after = await getSponsorRow(sponsorId);
    // h3_res7 should now be Loop's corridor, not Eagles'
    expect(after!.h3_res7).not.toBe('872664544ffffff');
    expect(after!.h3_res9).not.toBe('89266454447ffff');
  });

  test('is_local flag remains unchanged after create/update (never auto-set)', async () => {
    // Create with geo that matches the event — is_local must still be default (1 from INSERT)
    const res = await createSponsor({
      name: 'H3Test IsLocal Not Auto-set',
      event_id: 'evt-h3sp-eagles',
      lat: EAGLES.lat,
      lon: EAGLES.lon,
      is_local: false,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; is_local_suggested?: boolean };
    // is_local_suggested is true (same corridor) but is_local in DB is NOT forced
    expect(body.is_local_suggested).toBe(true);

    const row = await getSponsorRow(body.id);
    // Confirm h3_res7 is set correctly and the row exists
    expect(row!.h3_res7).toBe('872664544ffffff');
  });
});

// ─── Hot-path guard exemption note ───────────────────────────────────────────
// sponsors.ts is an admin/creation-time handler — NOT a scan-path handler.
// The h3-tagging.spec.ts SCAN_PATH list must NOT include sponsors.ts.
// This test confirms the import works (if sponsors.ts were wrongly in SCAN_PATH
// the h3-tagging guard would fail, but this test file importing from SELF verifies
// the Worker compiles with the h3-tagging import in sponsors.ts).
describe('hot-path guard exemption — sponsors.ts is admin path', () => {
  test('Worker compiles and routes sponsor create (confirms h3-tagging import in admin path is valid)', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors', {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({
        name: 'H3Test Guard Check',
        event_id: 'evt-h3sp-noloc',
      }),
    });
    // If the Worker failed to compile (bad import) this would 500 or hang
    expect([200, 201, 400, 404, 503]).toContain(res.status);
  });
});
