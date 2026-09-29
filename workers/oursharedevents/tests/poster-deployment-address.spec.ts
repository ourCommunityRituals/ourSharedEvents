/**
 * OSE-1357 (part 1) — a poster is placed by its ADDRESS, and every row the admin
 * card shows is read from the API response, never re-derived in the browser.
 *
 * API half (this file, workers pool): the deployment stores the address the
 * organizer typed (or the geocoder's formatted form of it); the list response
 * carries that address, the target the poster's code points at, and the
 * event's own venue/address for the form placeholder. The target is asserted
 * against what /q/ ACTUALLY redirects to, so the two can never drift.
 * UI half: tests/poster-deployment-address-ui.spec.ts (node + jsdom).
 *
 * @born-red OSE-1357 | method: spec written before the change and run against
 *   origin/main (no address column, no target_url / event_address in the list
 *   response) — red; green after | date: 2026-09-29
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
} as const;

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const EVT = 'evt-pdaddr-1357';
const EVT_LOC_ONLY = 'evt-pdaddr-1357-loc';

interface ListItem {
  id: string;
  qr_token: string;
  address: string | null;
  scan_url: string;
  qr_data_uri: string;
  target_url: string;
  target_label: string;
}

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function create(eventId: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}/poster-deployments`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify(body),
  });
}

async function list(
  eventId: string
): Promise<{ ok: boolean; items: ListItem[]; event_address: string | null }> {
  const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}/poster-deployments`, {
    headers: ADMIN_HEADERS,
  });
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  await applyMigrations();
  await tenv().DB.prepare("DELETE FROM events WHERE brand_id = 'pd-addr-1357'").run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, where_address)
       VALUES (?, 'pd-addr-1357', 'Harbor County Bocce', 'pd-addr-1357', 'active', ?, ?)`
    )
    .bind(EVT, 'Sawyer, MI', 'Harbor Country Park, 12 Red Arrow Hwy, Sawyer, MI')
    .run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location)
       VALUES (?, 'pd-addr-1357', 'Location Only', 'pd-addr-1357-loc', 'active', ?)`
    )
    .bind(EVT_LOC_ONLY, 'Three Oaks Village Hall')
    .run();
});

describe('OSE-1357 | poster deployment is placed by address', () => {
  test('create stores the address alongside the coordinates it was geocoded to', async () => {
    const res = await create(EVT, {
      placement_label: 'Front door',
      address: '12 Red Arrow Hwy, Sawyer, MI 49125, USA',
      latitude: 41.8837,
      longitude: -86.5925,
    });
    expect(res.status).toBe(201);
    const { id, h3_res9 } = (await res.json()) as { id: string; h3_res9: string | null };
    expect(h3_res9).toMatch(/^[0-9a-f]{15}$/); // server still tags the cell

    const row = await tenv()
      .DB.prepare('SELECT address FROM poster_deployments WHERE id = ?')
      .bind(id)
      .first<{ address: string | null }>();
    expect(row?.address).toBe('12 Red Arrow Hwy, Sawyer, MI 49125, USA');
  });

  test('an address with no coordinates still saves (geocoder unavailable never blocks)', async () => {
    const res = await create(EVT, { placement_label: 'Library board', address: 'Sawyer library' });
    expect(res.status).toBe(201);
    const { id, h3_res9 } = (await res.json()) as { id: string; h3_res9: string | null };
    expect(h3_res9).toBeNull();
    const item = (await list(EVT)).items.find((i) => i.id === id);
    expect(item?.address).toBe('Sawyer library');
  });

  test('a non-string / oversized address is not stored as-is', async () => {
    const r1 = await create(EVT, { placement_label: 'Odd', address: { x: 1 } });
    expect(r1.status).toBe(201);
    const { id: id1 } = (await r1.json()) as { id: string };
    const r2 = await create(EVT, { placement_label: 'Long', address: 'a'.repeat(900) });
    const { id: id2 } = (await r2.json()) as { id: string };
    const items = (await list(EVT)).items;
    expect(items.find((i) => i.id === id1)?.address).toBeNull();
    expect(items.find((i) => i.id === id2)?.address?.length).toBe(300);
  });

  test('list carries the event venue/address for the form placeholder', async () => {
    expect((await list(EVT)).event_address).toBe(
      'Harbor Country Park, 12 Red Arrow Hwy, Sawyer, MI'
    );
    // Falls back to the event's location when no where_address is set.
    expect((await list(EVT_LOC_ONLY)).event_address).toBe('Three Oaks Village Hall');
  });

  test('each row names the target its code points at — exactly where /q/ redirects', async () => {
    const { items } = await list(EVT);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.scan_url).toBe(`https://t.test/q/${item.qr_token}`);
      expect(item.target_label).toBe('Event page');
      const scan = await SELF.fetch(item.scan_url, { redirect: 'manual' });
      expect(scan.status).toBe(302);
      expect(item.target_url).toBe(scan.headers.get('Location'));
    }
  });

  test('update can correct the address', async () => {
    const res = await create(EVT, { placement_label: 'Fix me', address: 'wrong' });
    const { id } = (await res.json()) as { id: string };
    const put = await SELF.fetch(`https://t.test/api/v2/admin/poster-deployments/${id}`, {
      method: 'PUT',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ address: 'Right Place, Sawyer, MI' }),
    });
    expect(put.status).toBe(200);
    const get = await SELF.fetch(`https://t.test/api/v2/admin/poster-deployments/${id}`, {
      headers: ADMIN_HEADERS,
    });
    const body = (await get.json()) as { item: { address: string } };
    expect(body.item.address).toBe('Right Place, Sawyer, MI');
  });
});
