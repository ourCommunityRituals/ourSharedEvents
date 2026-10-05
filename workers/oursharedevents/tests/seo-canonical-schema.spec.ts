/**
 * Technical-SEO gates for the public surfaces (audit 2026-10-05):
 *
 *   1. Every public event page (pre / live / post) and /events declare ONE
 *      canonical URL, with the query string stripped, so ?utm=, ?q= and the
 *      form-context params never become competing index entries.
 *   2. /schedule, /calendar, /agenda and /lineup were the /events page at four
 *      more addresses. Like /public (OSE-1520) they now 301 to /events and the
 *      query string rides along.
 *   3. An event page carries a <meta name="description"> (what_short, else the
 *      description column) and schema.org/Event JSON-LD built from the event's
 *      own public facts — and nothing about who attended.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

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
      )
        continue;
      throw e;
    }
  }
}

interface SeedOpts {
  id: string;
  title?: string;
  whatShort?: string | null;
  description?: string | null;
  location?: string;
  startOffsetDays?: number | null;
  endOffsetDays?: number | null;
}

async function seedEvent(o: SeedOpts): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const now = Date.now();
  const iso = (days: number | null | undefined) =>
    days == null ? null : new Date(now + days * 86400000).toISOString();
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(o.id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, start_date, end_date,
                         what_short, description, created_at, updated_at)
     VALUES (?, 'ose-seo-test', ?, ?, 'active', 1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(
      o.id,
      o.title ?? 'SEO Smoke Event',
      o.id,
      o.location ?? 'Eagles Bowl',
      iso(o.startOffsetDays === undefined ? 7 : o.startOffsetDays),
      iso(o.endOffsetDays === undefined ? 8 : o.endOffsetDays),
      o.whatShort === undefined ? 'A bocce rematch you can walk to.' : o.whatShort,
      o.description ?? null
    )
    .run();
}

const LD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
const canonicalOf = (html: string): string[] =>
  [...html.matchAll(/<link rel="canonical" href="([^"]*)"\s*\/?>/g)].map((m) => m[1]);

beforeAll(async () => {
  await applyMigrations();
});

describe('canonical URL', () => {
  const phases: [string, number, number][] = [
    ['pre-event', 7, 8],
    ['live', -1, 1],
    ['post-event', -8, -7],
  ];
  for (const [name, start, end] of phases) {
    test(`the ${name} event page declares exactly one canonical, without the query string`, async () => {
      const id = `evt_seo_canon_${name.replace('-', '_')}`;
      await seedEvent({ id, startOffsetDays: start, endOffsetDays: end });
      const res = await SELF.fetch(`https://t.test/events/${id}?utm_source=poster&type=register`);
      expect(res.status).toBe(200);
      expect(canonicalOf(await res.text())).toEqual([`https://t.test/events/${id}`]);
    });
  }

  test('/events declares itself canonical, even when filtered', async () => {
    for (const q of ['', '?q=bocce', '?when=past']) {
      const res = await SELF.fetch(`https://t.test/events${q}`);
      expect(res.status).toBe(200);
      expect(canonicalOf(await res.text())).toEqual(['https://t.test/events']);
    }
  });
});

describe('/events aliases', () => {
  for (const alias of ['/schedule', '/calendar', '/agenda', '/lineup']) {
    test(`${alias} is a 301 to /events and keeps the query string`, async () => {
      const res = await SELF.fetch(`https://t.test${alias}?q=bocce`, { redirect: 'manual' });
      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('https://t.test/events?q=bocce');
    });
  }

  test('HEAD on an alias redirects too', async () => {
    const res = await SELF.fetch('https://t.test/agenda', { method: 'HEAD', redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://t.test/events');
  });
});

describe('meta description', () => {
  test('uses what_short', async () => {
    const id = 'evt_seo_desc_short';
    await seedEvent({ id, whatShort: 'Round-robin, free entry.' });
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).toContain('<meta name="description" content="Round-robin, free entry." />');
  });

  test('falls back to the description column', async () => {
    const id = 'evt_seo_desc_fallback';
    await seedEvent({ id, whatShort: null, description: 'From the description column.' });
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).toContain('<meta name="description" content="From the description column." />');
  });
});

describe('schema.org/Event JSON-LD', () => {
  test('describes the event from its own public facts', async () => {
    const id = 'evt_seo_ld_basic';
    await seedEvent({ id, title: 'Bocce Rematch', location: 'Eagles Bowl' });
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const m = html.match(LD_RE);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Event');
    expect(ld.name).toBe('Bocce Rematch');
    expect(ld.url).toBe(`https://t.test/events/${id}`);
    expect(ld.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ld.eventStatus).toBe('https://schema.org/EventScheduled');
    // OSE-1201: the page never wears the banned word, so the optional
    // eventAttendanceMode property (and its URL) stays out of the JSON-LD.
    expect(html).not.toMatch(/attendance/i);
    expect(ld.location).toMatchObject({ '@type': 'Place', name: 'Eagles Bowl' });
    expect(ld.description).toBe('A bocce rematch you can walk to.');
  });

  test('a hostile title cannot close the script block', async () => {
    const id = 'evt_seo_ld_xss';
    const title = '</script><img src=x onerror=alert(1)> & "quoted"';
    await seedEvent({ id, title });
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const block = html.match(LD_RE)![1];
    expect(block).not.toContain('<');
    expect(JSON.parse(block).name).toBe(title);
  });

  test('is left out when the event has no start date (a start date is required)', async () => {
    const id = 'evt_seo_ld_nodate';
    await seedEvent({ id, startOffsetDays: null, endOffsetDays: null });
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).not.toContain('application/ld+json');
  });
});
