/**
 * GET /api/v2/maps/venue-image?event=<id> — every cache miss is a billed
 * Google Static Maps load, so the route is (1) rate-limited at the router,
 * (2) keyed by a public event, never by free text, and (3) cached at the edge.
 *
 * Exercises the real request path (route()): the limit is a property of the
 * router, and the gate + cache are the handler behind it. Google is a stubbed
 * global `fetch`; the count of calls to it is the bill.
 *
 * @born-red method: each block run against the pre-fix route (unwrapped,
 * `?venue=` free text, browser cache only) and against single-guard reverts
 * of handlers/venue-image.ts | date: 2026-10-03
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { PUBLIC_READ_MAX } from '../src/lib/public-read-limit';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const KEY = 'test-maps-key-venue-image';

beforeAll(async () => {
  const stmts: string[] = JSON.parse((env as unknown as TestEnv).TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await env.DB.prepare(stmt).run();
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function seed(
  status: 'draft' | 'ready' | 'active' | 'archived',
  opts: { published?: 0 | 1; location?: string | null } = {}
): Promise<string> {
  const id = `evt_vimg_${crypto.randomUUID().replace(/-/g, '')}`;
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                         created_at, updated_at)
     VALUES (?, 'root', 'Venue image test', ?, ?, ?, ?, '2026-09-01 00:00:00', '2026-09-01 00:00:00')`
  )
    .bind(
      id,
      id,
      status,
      opts.published ?? 1,
      opts.location === undefined ? uniqueVenue() : opts.location
    )
    .run();
  return id;
}

const uniqueVenue = () => `Eagles Bowl ${crypto.randomUUID()}, Sawyer MI`;

/** Stub Google. The returned mock's call count is the number of billed loads. */
function stubGoogle(status = 200) {
  const f = vi.fn(
    async (_url: unknown) =>
      new Response(status === 200 ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : 'denied', {
        status,
        headers: { 'content-type': status === 200 ? 'image/png' : 'text/plain' },
      })
  );
  vi.stubGlobal('fetch', f);
  return f;
}

async function get(
  query: string,
  opts: { ip?: string; extraEnv?: Record<string, unknown> } = {}
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test/api/v2/maps/venue-image${query}`, {
      headers: { 'CF-Connecting-IP': opts.ip ?? '203.0.113.20' },
    }),
    {
      ...(env as unknown as RouterEnv),
      GOOGLE_MAPS_API_KEY: KEY,
      ...opts.extraEnv,
    } as unknown as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('the route is rate-limited like every other public read', () => {
  test(`a caller past ${PUBLIC_READ_MAX} a minute gets a 429, and Google is never asked`, async () => {
    const google = stubGoogle();
    const store = new Map<string, string>();
    const RATE_LIMIT_KV = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
    } as unknown as KVNamespace;

    // This drains the per-minute count, so the burst limiter in front of it
    // (60 per 10 s, real clock) is left unbound and the clock is held: a slow
    // runner can then neither roll the minute nor let the burst window answer
    // for it (#863: drain the layer you assert on).
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const extraEnv = { RATE_LIMIT_KV, PUBLIC_READ_EDGE_LIMITER: undefined };

    let last = new Response('');
    for (let i = 1; i <= PUBLIC_READ_MAX + 1; i++) {
      // No params: the cheapest request the route answers. The limit sits in
      // front of the handler, so it still counts.
      last = await get('', { ip: '203.0.113.21', extraEnv });
      if (i === PUBLIC_READ_MAX)
        expect(last.status, `request ${i} is within the limit`).not.toBe(429);
      if (i <= PUBLIC_READ_MAX) await last.body?.cancel();
    }
    expect(last.status).toBe(429);
    expect(last.headers.get('Retry-After')).toBeTruthy();
    expect(google).not.toHaveBeenCalled();
  });
});

describe('only a public event can ask for a map', () => {
  test('free text is refused: ?venue= is a 400 and nothing is fetched', async () => {
    const google = stubGoogle();
    const res = await get(`?venue=${encodeURIComponent('1600 Amphitheatre Pkwy')}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_EVENT');
    expect(google).not.toHaveBeenCalled();
  });

  test('a malformed event id is a 400', async () => {
    const google = stubGoogle();
    const res = await get(`?event=${encodeURIComponent('not an id; DROP')}`);
    expect(res.status).toBe(400);
    await res.body?.cancel();
    expect(google).not.toHaveBeenCalled();
  });

  test('an unknown event is a 404 and nothing is fetched', async () => {
    const google = stubGoogle();
    const res = await get('?event=evt_vimg_does_not_exist');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
    expect(google).not.toHaveBeenCalled();
  });

  // PO decision 2026-10-07 (OSE-1643): a live event's page opens by link while
  // it is off the map, and that page shows this image. The third row here used
  // to be "a live but unpublished event" → 404; it is now served (next test).
  // Off the map still closes the route for every event that is not live.
  test.each([
    ['a draft', 'draft', 1],
    ['a ready event', 'ready', 1],
    ['a draft that is off the map', 'draft', 0],
    ['a ready event that is off the map', 'ready', 0],
    ['an archived event that is off the map', 'archived', 0],
  ] as const)('%s gets the same 404, and nothing is fetched', async (_label, status, published) => {
    const google = stubGoogle();
    const id = await seed(status, { published });
    const res = await get(`?event=${id}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
    expect(google).not.toHaveBeenCalled();
  });

  test('a live event that is off the map gets its image: its page opens by link and shows it', async () => {
    const google = stubGoogle();
    const id = await seed('active', { published: 0 });
    const res = await get(`?event=${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/png');
    await res.body?.cancel();
    expect(google).toHaveBeenCalledTimes(1);
  });

  test('a public event with no venue is a 404, not a Google request', async () => {
    const google = stubGoogle();
    const id = await seed('active', { location: null });
    const res = await get(`?event=${id}`);
    expect(res.status).toBe(404);
    await res.body?.cancel();
    expect(google).not.toHaveBeenCalled();
  });

  test('the venue sent to Google is the stored one, and the key never comes back', async () => {
    const google = stubGoogle();
    const venue = uniqueVenue();
    const id = await seed('active', { location: venue });
    const res = await get(`?event=${id}&venue=${encodeURIComponent('Somewhere Else')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const sent = new URL(String(google.mock.calls[0]![0]));
    expect(sent.searchParams.get('center')).toBe(venue);
    for (const [, value] of res.headers) expect(value).not.toContain(KEY);
    expect(new TextDecoder().decode(await res.arrayBuffer())).not.toContain(KEY);
  });
});

describe('a repeat view is served from the edge cache, not billed again', () => {
  test('the second request for an event makes no second upstream fetch', async () => {
    const google = stubGoogle();
    const id = await seed('active');

    const first = await get(`?event=${id}`);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    expect(google).toHaveBeenCalledTimes(1);

    // A different caller, so this is the shared edge cache and not a browser's.
    const second = await get(`?event=${id}`, { ip: '198.51.100.9' });
    expect(second.status).toBe(200);
    expect(second.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    );
    expect(google).toHaveBeenCalledTimes(1);
  });

  test('two events at one venue share one image, however the venue was typed', async () => {
    const google = stubGoogle();
    const venue = uniqueVenue();
    const a = await seed('active', { location: venue });
    const b = await seed('archived', { location: `  ${venue.toUpperCase()} ` });

    await (await get(`?event=${a}`)).arrayBuffer();
    const res = await get(`?event=${b}`);
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(google).toHaveBeenCalledTimes(1);
  });

  test('a Google failure is remembered briefly, so a failing venue is not retried per view', async () => {
    const google = stubGoogle(403);
    const id = await seed('active');

    const first = await get(`?event=${id}`);
    expect(first.status).toBe(502);
    await first.body?.cancel();
    const second = await get(`?event=${id}`);
    expect(second.status).toBe(502);
    await second.body?.cancel();
    expect(google).toHaveBeenCalledTimes(1);
  });
});
