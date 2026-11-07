/**
 * data_class on event create (migration 0052): a row is labelled at write time.
 *
 * The nightly staging lifecycle job (scripts/lifecycle/) creates one test event
 * through the real admin API and labels it 'synthetic', so the dashboards leave
 * it out by default. Only automation (a key actor, or the CI service actor) may
 * set that label; a signed-in person's event is always 'production'. 'demo' is
 * the mock-data class and is never written by this handler.
 *
 * @born-red method: injected fault | date: 2026-11-07 | verified: with the INSERT
 *   binding 'production' in place of the parsed value, "a key actor labels its
 *   event synthetic" went red (stored production); with the actor check removed,
 *   "a signed-in person cannot" went red (201, stored synthetic); with the value
 *   check removed, "demo is refused" went red. All green with the handler as is.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleCreateEvent, handleAdminListEvents, type EventsEnv } from '../src/handlers/events';
import { BRANDS, seedBrandFixture, routerEnv } from './helpers/brand-matrix';

const A = BRANDS[0]!;
const eventsEnv = routerEnv as unknown as EventsEnv;
const KEY = 'test-admin-key-e2e-2026';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function asKey(body: unknown): Request {
  return new Request('https://ose.test/api/v2/admin/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function asPerson(email: string, body: unknown): Request {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email,
    iat: now - 10,
    exp: now + 3600,
  })}.sig`;
  return new Request('https://ose.test/api/v2/admin/events', {
    method: 'POST',
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function storedClass(id: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT data_class FROM events WHERE id = ?')
    .bind(id)
    .first<{ data_class: string }>();
  return row ? row.data_class : null;
}

async function countTitled(title: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE title = ?')
    .bind(title)
    .first<{ n: number }>();
  return row ? row.n : 0;
}

beforeAll(async () => {
  await seedBrandFixture();
});

describe('event create: data_class', () => {
  test('a key actor labels its event synthetic, and the answer says so', async () => {
    const res = await handleCreateEvent(
      asKey({ brand_id: 'root', title: 'dc synthetic by key', data_class: 'synthetic' }),
      eventsEnv
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; data_class: string };
    expect(body.data_class).toBe('synthetic');
    expect(await storedClass(body.id)).toBe('synthetic');
  });

  test('the admin list says each event’s data_class, so automation can read its label back', async () => {
    const res = await handleCreateEvent(
      asKey({ brand_id: 'root', title: 'dc listed by key', data_class: 'synthetic' }),
      eventsEnv
    );
    const { id } = (await res.json()) as { id: string };
    const list = await handleAdminListEvents(
      new Request('https://ose.test/api/v2/admin/events?mine=1&limit=100', {
        headers: { Authorization: `Bearer ${KEY}` },
      }),
      eventsEnv
    );
    const body = (await list.json()) as { items: Array<{ id: string; data_class: string }> };
    expect(body.items.find((e) => e.id === id)?.data_class).toBe('synthetic');
  });

  test('with no data_class an event is production', async () => {
    const res = await handleCreateEvent(
      asKey({ brand_id: 'root', title: 'dc default by key' }),
      eventsEnv
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; data_class: string };
    expect(body.data_class).toBe('production');
    expect(await storedClass(body.id)).toBe('production');
  });

  test('null is the default too', async () => {
    const res = await handleCreateEvent(
      asKey({ brand_id: 'root', title: 'dc null by key', data_class: null }),
      eventsEnv
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(await storedClass(body.id)).toBe('production');
  });

  test('a signed-in person cannot label an event synthetic, and nothing is written', async () => {
    const title = 'dc synthetic by person';
    const res = await handleCreateEvent(
      asPerson(A.ownerEmail, { brand_id: A.brandId, title, data_class: 'synthetic' }),
      eventsEnv
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('DATA_CLASS_FORBIDDEN');
    expect(await countTitled(title)).toBe(0);
  });

  test('a signed-in person may say production, which is what they get anyway', async () => {
    const res = await handleCreateEvent(
      asPerson(A.ownerEmail, {
        brand_id: A.brandId,
        title: 'dc production by person',
        data_class: 'production',
      }),
      eventsEnv
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(await storedClass(body.id)).toBe('production');
  });

  for (const bad of ['demo', 'SYNTHETIC', '', 1, true, { v: 'synthetic' }]) {
    test(`${JSON.stringify(bad)} is refused before anything is written`, async () => {
      const title = `dc bad ${JSON.stringify(bad)}`;
      const res = await handleCreateEvent(
        asKey({ brand_id: 'root', title, data_class: bad }),
        eventsEnv
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('INVALID_DATA_CLASS');
      expect(await countTitled(title)).toBe(0);
    });
  }
});
