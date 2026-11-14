/**
 * OSE-2039 — GET /api/v2/map/areas through the router, in the workers pool.
 *
 * The handler's own rules are in map-areas.spec.ts (node). These pin what only
 * the route can show: it is public, it is limited like every public read, it
 * answers reads only, and it sets no cookie. The pool binds no MAP_TILES bucket,
 * so every answer here is the fail-soft one: hexagons, `streets: null`.
 */
// @born-red rate-limited at the route | method: `publicReadLimited('map-areas', handleMapAreas)(request, env)` replaced by `handleMapAreas(request, env)` in router.ts; "it is rate-limited like other public reads" failed (200, not 429) | date: 2026-11-14
// @born-red reads only | method: the method check removed from the route; "a write is not answered" failed (POST got 200) | date: 2026-11-14
// @born-red no cookie | method: a Set-Cookie header added to the handler's answer; "no cookie is set" failed | date: 2026-11-14
import { describe, test, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { latLngToCell } from 'h3-js';
import { PUBLIC_READ_MAX } from '../src/lib/public-read-limit';
import { EDGE_WINDOW_SECONDS } from '../src/lib/edge-rate-limit';
import { rateLimitKvKey } from '../src/lib/rate-limit';

interface TestEnv {
  RATE_LIMIT_KV: KVNamespace;
  RATE_LIMIT_KEY_PEPPER?: string;
}
const tenv = (): TestEnv => env as unknown as TestEnv;

const ORIGIN = 'https://t.test';
const CELL = latLngToCell(41.6573, -87.68, 7);
const url = (query: string): string => `${ORIGIN}/api/v2/map/areas${query}`;

describe('GET /api/v2/map/areas | the route', () => {
  test('a reader with no credential gets the hexagons, and no streets without an archive', async () => {
    const res = await SELF.fetch(url(`?cells=${CELL}&around=1`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type') ?? '').toContain('application/json');
    const body = (await res.json()) as {
      ok: boolean;
      frame: { projection: string; w: number; h: number };
      areas: { cell: string; n: number; points: string }[];
      around: unknown[];
      streets: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.frame).toMatchObject({ projection: 'web-mercator', w: 600, h: 360 });
    expect(body.areas).toHaveLength(1);
    expect(body.areas[0]).toMatchObject({ cell: CELL, n: 1 });
    expect(body.around).toHaveLength(6);
    expect(body.streets).toBeNull();
  });

  test('a coordinate-shaped parameter is refused with a 400', async () => {
    for (const q of ['?lat=41.69&lon=-87.67', `?cells=${CELL}&LNG=-87.67`]) {
      const res = await SELF.fetch(url(q));
      expect(res.status, q).toBe(400);
      expect(((await res.json()) as { code: string }).code, q).toBe('COORDINATES_NOT_ACCEPTED');
    }
  });

  test('a finer cell is refused with a 400', async () => {
    const res = await SELF.fetch(url(`?cells=${latLngToCell(41.6573, -87.68, 9)}`));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CELL_RESOLUTION');
  });

  test('no cookie is set, with or without one sent', async () => {
    const plain = await SELF.fetch(url(`?cells=${CELL}`));
    expect(plain.headers.get('Set-Cookie')).toBeNull();
    const withCookie = await SELF.fetch(url(`?cells=${CELL}`), {
      headers: { Cookie: 'ose_anon=abc123' },
    });
    expect(withCookie.status).toBe(200);
    expect(withCookie.headers.get('Set-Cookie')).toBeNull();
    const refused = await SELF.fetch(url('?lat=1'));
    expect(refused.headers.get('Set-Cookie')).toBeNull();
  });

  test('a write is not answered', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await SELF.fetch(url(`?cells=${CELL}`), { method });
      expect(res.status, method).not.toBe(200);
      await res.arrayBuffer();
    }
  });

  test('it is rate-limited like other public reads, per caller', async () => {
    const ip = '203.0.113.221';
    const headers = { 'CF-Connecting-IP': ip };
    expect((await SELF.fetch(url(`?cells=${CELL}`), { headers })).status).toBe(200);
    // Spend the rest of this caller's minute.
    const key = await rateLimitKvKey(`publicread:map-areas:${ip}`, tenv().RATE_LIMIT_KEY_PEPPER);
    await tenv().RATE_LIMIT_KV.put(
      key,
      JSON.stringify({ count: PUBLIC_READ_MAX, resetAt: Date.now() + 60_000, max: PUBLIC_READ_MAX })
    );
    const limited = await SELF.fetch(url(`?cells=${CELL}`), { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe(String(EDGE_WINDOW_SECONDS));
    // A request that would be refused is limited the same way: the limit comes first.
    expect((await SELF.fetch(url('?lat=1'), { headers })).status).toBe(429);
    // Another caller is unaffected.
    const other = await SELF.fetch(url(`?cells=${CELL}`), {
      headers: { 'CF-Connecting-IP': '203.0.113.222' },
    });
    expect(other.status).toBe(200);
  });
});
