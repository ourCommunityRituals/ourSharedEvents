/**
 * One canonical address per indexable page (lib/canonical).
 *
 * Event pages (pre, live, recap), /events, / and /privacy each carry exactly one
 * `<link rel="canonical">` with an absolute URL, built from a fixed path: a query
 * string, a trailing-slash-free alias or the www host never changes it. Production
 * always names https://oursharedevents.com. The admin preview carries none.
 *
 * Born-red: remove injectCanonical from a handler and that page's test goes red;
 * make canonicalOrigin read the request in production and the www test does.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  CANONICAL_PATH,
  PRODUCTION_ORIGIN,
  canonicalLinkTag,
  canonicalOrigin,
  injectCanonical,
} from '../src/lib/canonical';
import { handlePublicPage, handleLandingPage, handlePublicEventPage } from '../src/handlers/pages';
import { handlePrivacyPage } from '../src/handlers/privacy';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
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

/** A live, listed event whose phase is picked by its dates. */
async function seedEvent(id: string, start: string, end: string | null, status = 'active') {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, end_date, qr_verified, created_at, updated_at)
         VALUES (?, 'root', ?, ?, ?, 1, 'Eagles Hall', ?, ?, 1, datetime('now'), datetime('now'))`
    )
    .bind(id, `Canon ${id}`, id, status, start, end)
    .run();
}

const canonicals = (htmlText: string): string[] =>
  [...htmlText.matchAll(/<link[^>]+rel="canonical"[^>]*>/gi)].map((m) => m[0]);

const hrefOf = (tag: string): string => /href="([^"]*)"/.exec(tag)?.[1] ?? '';

const get = (host: string, path: string) =>
  SELF.fetch(`https://${host}${path}`, { headers: { Accept: 'text/html' } });

describe('canonical | the helper', () => {
  test('production names one origin whatever host or request asked', () => {
    const www = new Request('https://www.oursharedevents.com/events');
    expect(canonicalOrigin(www, { WORKER_ENV: 'production' })).toBe(PRODUCTION_ORIGIN);
    expect(canonicalOrigin(undefined, { WORKER_ENV: 'production' })).toBe(PRODUCTION_ORIGIN);
  });

  test('other environments name the host they were asked on; no request means none', () => {
    const stg = new Request('https://stg.oursharedevents.com/events?x=1');
    expect(canonicalOrigin(stg, { WORKER_ENV: 'staging' })).toBe('https://stg.oursharedevents.com');
    expect(canonicalOrigin(undefined, { WORKER_ENV: 'staging' })).toBeNull();
    expect(canonicalOrigin(undefined, undefined)).toBeNull();
  });

  test('the tag is escaped and absolute', () => {
    expect(canonicalLinkTag('https://a.test', '/events')).toBe(
      '<link rel="canonical" href="https://a.test/events" />'
    );
    expect(canonicalLinkTag('https://a.test', '/x"><script>')).not.toContain('<script>');
  });

  test('injects once before </head>, never twice, and leaves a head-less string alone', () => {
    const req = new Request('https://stg.oursharedevents.com/events');
    const once = injectCanonical(
      '<html><head><title>t</title></head><body/></html>',
      req,
      {},
      '/events'
    );
    expect(canonicals(once)).toHaveLength(1);
    expect(once.indexOf('rel="canonical"')).toBeLessThan(once.indexOf('</head>'));
    expect(canonicals(injectCanonical(once, req, {}, '/events'))).toHaveLength(1);
    expect(injectCanonical('no head here', req, {}, '/events')).toBe('no head here');
    expect(injectCanonical('<head></head>', undefined, {}, '/events')).toBe('<head></head>');
  });
});

describe('canonical | /events, / and /privacy', () => {
  test('/events: bare, whatever the query', async () => {
    for (const q of ['', '?when=week', '?q=bocce&utm_source=x', '?when=past&q=a%22b']) {
      const text = await (await get('stg.oursharedevents.com', `/events${q}`)).text();
      const tags = canonicals(text);
      expect(tags, q).toHaveLength(1);
      expect(hrefOf(tags[0]), q).toBe('https://stg.oursharedevents.com/events');
    }
  });

  test('/: names `/`, and so do the five other addresses that serve the landing page', async () => {
    for (const p of ['/', '/home', '/welcome', '/landing', '/about', '/info', '/?ref=x']) {
      const text = await (await get('stg.oursharedevents.com', p)).text();
      const tags = canonicals(text);
      expect(tags, p).toHaveLength(1);
      expect(hrefOf(tags[0]), p).toBe('https://stg.oursharedevents.com/');
    }
  });

  test('/privacy and /privacy-policy: both name /privacy', async () => {
    for (const p of ['/privacy', '/privacy-policy', '/privacy?phase=2']) {
      const text = await (await get('stg.oursharedevents.com', p)).text();
      const tags = canonicals(text);
      expect(tags, p).toHaveLength(1);
      expect(hrefOf(tags[0]), p).toBe('https://stg.oursharedevents.com/privacy');
    }
  });

  test('handlers called directly in production name the production origin', async () => {
    const prod = { WORKER_ENV: 'production' } as never;
    for (const [res, path] of [
      [
        await handlePublicPage(
          prod,
          null,
          new Request('https://www.oursharedevents.com/events?q=a')
        ),
        '/events',
      ],
      [
        await handleLandingPage(prod, null, new Request('https://www.oursharedevents.com/home')),
        '/',
      ],
      [handlePrivacyPage(new Request('https://www.oursharedevents.com/privacy'), prod), '/privacy'],
    ] as const) {
      const tags = canonicals(await res.text());
      expect(tags, path).toHaveLength(1);
      expect(hrefOf(tags[0]), path).toBe(`${PRODUCTION_ORIGIN}${path === '/' ? '/' : path}`);
    }
  });

  test('paths come from one table', () => {
    expect(CANONICAL_PATH).toEqual({ landing: '/', events: '/events', privacy: '/privacy' });
  });
});

describe('canonical | event pages', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedEvent('canon-pre', '2099-06-01', '2099-06-01');
    await seedEvent('canon-post', '2020-06-01', '2020-06-01');
  });

  test('pre-event page: one canonical, /events/:id, whatever the query', async () => {
    for (const q of ['', '?utm_source=x', '?lang=es&ref=share']) {
      const text = await (await get('stg.oursharedevents.com', `/events/canon-pre${q}`)).text();
      const tags = canonicals(text);
      expect(tags, q).toHaveLength(1);
      expect(hrefOf(tags[0]), q).toBe('https://stg.oursharedevents.com/events/canon-pre');
    }
  });

  test('live page: one canonical, /events/:id', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await seedEvent('canon-live', today, today);
    const res = await get('stg.oursharedevents.com', '/events/canon-live?x=1');
    const text = await res.text();
    expect(text, 'the seeded event is in its live phase').toContain(
      'data-testid="event-live-badge"'
    );
    const tags = canonicals(text);
    expect(tags).toHaveLength(1);
    expect(hrefOf(tags[0])).toBe('https://stg.oursharedevents.com/events/canon-live');
  });

  test('recap page: one canonical, /events/:id', async () => {
    const text = await (await get('stg.oursharedevents.com', '/events/canon-post?x=1')).text();
    const tags = canonicals(text);
    expect(tags).toHaveLength(1);
    expect(hrefOf(tags[0])).toBe('https://stg.oursharedevents.com/events/canon-post');
  });

  test('og:url and the canonical are the same address', async () => {
    const text = await (await get('stg.oursharedevents.com', '/events/canon-pre?x=1')).text();
    const og = /property="og:url" content="([^"]*)"/.exec(text)?.[1];
    expect(og).toBe(hrefOf(canonicals(text)[0]));
  });

  test('in production an event page names the production origin even when fetched via www', async () => {
    const res = await handlePublicEventPage(
      new Request('https://www.oursharedevents.com/events/canon-pre?utm_source=x'),
      { ...(env as unknown as object), WORKER_ENV: 'production' } as never,
      'canon-pre'
    );
    const text = await res.text();
    const tags = canonicals(text);
    expect(tags).toHaveLength(1);
    expect(hrefOf(tags[0])).toBe(`${PRODUCTION_ORIGIN}/events/canon-pre`);
    // The share link and og:url come from the same origin, so none says www.
    expect(/property="og:url" content="([^"]*)"/.exec(text)?.[1]).toBe(hrefOf(tags[0]));
    expect(text).not.toContain('www.oursharedevents.com');
  });

  test('an unknown event and a draft carry no canonical', async () => {
    await seedEvent('canon-draft', '2099-06-01', '2099-06-01', 'draft');
    for (const id of ['canon-no-such-event', 'canon-draft']) {
      const res = await get('stg.oursharedevents.com', `/events/${id}`);
      expect(res.status, id).toBe(404);
      expect(canonicals(await res.text()), id).toHaveLength(0);
    }
  });
});
