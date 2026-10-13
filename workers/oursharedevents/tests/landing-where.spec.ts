/**
 * Landing "where are you?" over HTTP (owner 2026-10-10).
 *
 *   GET /?zip=NNNNN   lists only events within about 10 miles of the zip, results first.
 *   POST /near g=...  a phone's 5-character box → 303 to /?zip= of the nearest zip.
 *   The landing alone may ask for location (Permissions-Policy geolocation=(self)).
 *
 * Limits on the page script itself: tests/landing-where-unit.spec.ts.
 *
 * @born-red landing-where | method: filter removed (far event listed), /near reading
 *   ?g= from the address, /near answering 200 with a body, landing policy left at
 *   geolocation=() — each turned its test red | date: 2026-10-10
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { latLngToCell } from 'h3-js';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const NEAR = 'where-near-blue-island';
const FAR = 'where-far-los-angeles';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function seed(id: string, title: string, lat: number, lon: number): Promise<void> {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, timezone, lat, lon, h3_res7, created_at, updated_at)
       VALUES (?, 'root', ?, ?, 'active', 1, 'A hall', ?, 'America/Chicago', ?, ?, ?,
               datetime('now'), datetime('now'))`
    )
    .bind(id, title, id, inDays(4), lat, lon, latLngToCell(lat, lon, CORRIDOR_RES))
    .run();
}

const page = async (path: string) => {
  const res = await SELF.fetch(`https://t.test${path}`);
  return { res, body: await res.text() };
};

const near = (body: string, contentType = 'application/x-www-form-urlencoded') =>
  SELF.fetch('https://t.test/near', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': contentType },
    body,
  });

beforeAll(async () => {
  await applyMigrations();
  await seed(NEAR, 'Where Test Blue Island Night', 41.6571, -87.6798);
  await seed(FAR, 'Where Test Los Angeles Night', 34.0522, -118.2437);
});

describe('GET / with a zip', () => {
  test('lists the event near the zip and not the far one', async () => {
    const { res, body } = await page('/?zip=60406');
    expect(res.status).toBe(200);
    expect(body).toContain('Where Test Blue Island Night');
    expect(body).not.toContain('Where Test Los Angeles Night');
    expect(body).toMatch(/data-testid="area-heading">Near 60406 /);
    expect(body).toContain('value="60406"');
  });

  test('a far zip lists the far event only', async () => {
    const { body } = await page('/?zip=90012');
    expect(body).toContain('Where Test Los Angeles Night');
    expect(body).not.toContain('Where Test Blue Island Night');
  });

  test('a zip with nothing near says so and points to all events', async () => {
    const { body } = await page('/?zip=99501'); // Anchorage
    expect(body).toContain('data-testid="area-empty-near"');
    expect(body).toContain('Nothing near 99501 yet.');
    expect(body).not.toContain('Where Test');
  });

  test('results come before the organizer buttons', async () => {
    const { body } = await page('/?zip=60406');
    expect(body.indexOf('data-testid="landing-area"')).toBeLessThan(
      body.indexOf('data-testid="landing-doors"')
    );
  });

  test('no zip lists everything, as before; an unknown zip says so and lists everything', async () => {
    for (const path of ['/', '/?zip=99999']) {
      const { body } = await page(path);
      expect(body, path).toContain('Where Test Blue Island Night');
      expect(body, path).toContain('Where Test Los Angeles Night');
    }
    expect((await page('/?zip=99999')).body).toContain("We couldn't find zip 99999.");
    expect((await page('/')).body).toMatch(/data-testid="area-heading">Coming up</);
  });

  test('the zip box is on every landing answer, first after the heading', async () => {
    const { body } = await page('/');
    const h1 = body.indexOf('data-testid="landing-h1"');
    const form = body.indexOf('data-testid="where-form"');
    expect(h1).toBeGreaterThan(0);
    expect(form).toBeGreaterThan(h1);
    expect(form).toBeLessThan(body.indexOf('data-testid="landing-doors"'));
    expect(form).toBeLessThan(body.indexOf('data-testid="landing-area"'));
  });

  test('sets no cookie', async () => {
    const { res } = await page('/?zip=60406');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('POST /near', () => {
  test('a box near Blue Island goes to a zip whose area holds the near event', async () => {
    const res = await near('g=dp3su');
    expect(res.status).toBe(303);
    const to = res.headers.get('Location') ?? '';
    expect(to).toMatch(/^\/\?zip=\d{5}$/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const { body } = await page(to);
    expect(body).toContain('Where Test Blue Island Night');
  });

  test('a box outside the US goes to the zip box with a note', async () => {
    const res = await near('g=u09tv'); // Paris
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/?nozip=1');
    expect((await page('/?nozip=1')).body).toContain("couldn't find a US zip where you are");
  });

  test('refuses anything that is not exactly a 5-character box', async () => {
    for (const body of ['', 'g=', 'g=dp3s', 'g=dp3sux', 'g=41.6571,-87.6798', 'lat=41&lon=-87']) {
      const res = await near(body);
      expect(res.status, body).toBe(400);
      expect(res.headers.get('Location'), body).toBeNull();
    }
  });

  test('never reads the box from the address, and needs a form body', async () => {
    const viaQuery = await SELF.fetch('https://t.test/near?g=dp3su', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(viaQuery.status).toBe(400);
    expect((await near('{"g":"dp3su"}', 'application/json')).status).toBe(400);
  });

  test('GET /near goes back to the landing page', async () => {
    const res = await SELF.fetch('https://t.test/near?g=dp3su', { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
  });
});

describe('who may ask for location', () => {
  test('the landing page may, for itself only; other pages may not', async () => {
    const landing = (await page('/')).res.headers.get('Permissions-Policy') ?? '';
    expect(landing).toContain('geolocation=(self)');
    expect(landing).toContain('camera=()');
    expect(landing).toContain('microphone=()');
    for (const path of ['/events', `/events/${NEAR}`]) {
      const p = (await page(path)).res.headers.get('Permissions-Policy') ?? '';
      expect(p, path).toContain('geolocation=()');
    }
  });
});
