/**
 * OSE-2164 — a dead link says something, in the reader's language.
 *
 * /s/ is what a printed QR encodes. A person holding a wrong or taken-down code
 * used to read raw JSON. Now a browser (Accept: text/html) reads a branded 404
 * with one button to the events list; a script keeps the JSON. The page is the
 * same for a malformed and an unknown code (no oracle), the 429 is the same for
 * a right and a wrong code, and nothing sets a cookie. On /es the event 404,
 * the "has ended" page and the bad-code page read Spanish and the button goes
 * to /es/events.
 *
 * Headers are compared with the CSP nonce removed: the nonce is random on every
 * response and says nothing about the code.
 *
 * @born-red 2026-11-19 | method: each assertion failed on the pre-change handlers
 * (JSON for a browser, English on /es); the oracle cases fail when one branch's
 * page differs from the other's (the injected faults are in the PR body).
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { createShortlink } from '../src/lib/shortlinks';
import { SHORTLINK_GUESS_MAX } from '../src/handlers/shortlink-resolve';
import { CATALOG } from '../src/lib/i18n/catalog';
import { PERSON_UA } from './helpers/person-agent';

const ORIGIN = 'https://t.test';
const E = env as unknown as {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
};
const PAGE = { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'User-Agent': PERSON_UA };

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      if (m.includes('no such column')) continue;
      throw e;
    }
  }
});

let n = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${n++}`.replace(/[^a-zA-Z0-9_-]/g, '');
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function seed(status: 'draft' | 'ready' | 'archived', listed: boolean) {
  const id = uid(`dead-${status}`);
  const title = `Dead link ${id}`;
  await E.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, location,
                         h3_res7, listed_from, qr_verified, created_at, updated_at)
     VALUES (?, 'root', ?, ?, ?, 0, ?, ?, '872664544ffffff', ?, 0, datetime('now'), datetime('now'))`
  )
    .bind(
      id,
      title,
      id,
      status,
      inDays(5),
      `Eagles Bowl ${id}, Sawyer MI`,
      listed ? new Date(Date.now() - 86_400_000).toISOString() : null
    )
    .run();
  return { id, title };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', headers });

/** Every header, lower-cased and sorted, with the per-response CSP nonce taken out. */
function sameHeaders(res: Response): string {
  return [...res.headers.entries()]
    .map(([k, v]) => `${k}: ${v.replace(/nonce-[A-Za-z0-9+/=_-]+/g, 'nonce-X')}`)
    .sort()
    .join('\n');
}

const lang = (html: string) => /<html lang="([a-z]+)"/.exec(html)?.[1];
const cta = (html: string) => /data-testid="error-cta" href="([^"]*)">([^<]*)</.exec(html);

describe('OSE-2164 | /s/<dead code> | a browser reads a page, a script reads JSON', () => {
  test('a browser gets an HTML 404 with one button to /events, no cookie, no-store, Vary: Accept', async () => {
    const res = await get('/s/zzzz', PAGE);
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Vary') ?? '').toMatch(/\bAccept\b/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const html = await res.text();
    expect(lang(html)).toBe('en');
    expect(html.match(/<h1\b/g)?.length, 'one h1').toBe(1);
    expect(html).toContain('data-testid="error-cta"');
    expect(cta(html)?.slice(1)).toEqual(['/events', 'See events near you']);
    expect(html.match(/data-testid="error-cta"/g)?.length, 'one primary button').toBe(1);
  });

  test('a script (no Accept, or */*) keeps the JSON, with Vary: Accept and no-store', async () => {
    for (const headers of [{}, { Accept: '*/*' }, { Accept: 'application/json' }]) {
      const res = await get('/s/zzzz', headers);
      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      expect(res.headers.get('Vary') ?? '').toMatch(/\bAccept\b/);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toEqual({ ok: false, code: 'NOT_FOUND', error: 'Link not found' });
    }
  });

  test('malformed and unknown codes give the same bytes and the same headers (no oracle)', async () => {
    const shapes = ['zzzzzz', 'a!b2c3', 'abc12345', 'x', '<<<malformed>>>'];
    for (const accept of [PAGE, { Accept: '*/*' }]) {
      const unknown = await get('/s/zzzz99', accept);
      const unknownBody = await unknown.text();
      // The staging checks (Bruno pages folder 17 and tests/e2e/3-flows/dead-links.spec.ts)
      // take out a script naming __CF$cv$params, and every nonce value, before they compare,
      // because the edge adds them per read. That is safe only while the Worker's own page
      // carries neither, so nothing the Worker writes is left out of the comparison.
      expect(unknownBody, 'the Worker writes no __CF$cv$params').not.toContain('__CF$cv$params');
      expect(unknownBody, 'the Worker writes no nonce attribute').not.toContain('nonce=');
      for (const bad of shapes) {
        const res = await get(`/s/${encodeURIComponent(bad)}`, accept);
        expect(res.status, bad).toBe(unknown.status);
        expect(await res.text(), `${bad}: body`).toBe(unknownBody);
        expect(sameHeaders(res), `${bad}: headers`).toBe(sameHeaders(unknown));
      }
    }
  });

  test('a Spanish browser reads Spanish and the button goes to /es/events', async () => {
    const res = await get('/s/zzzz', { ...PAGE, 'Accept-Language': 'es-MX,es;q=0.9' });
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(lang(html)).toBe('es');
    expect(cta(html)?.slice(1)).toEqual(['/es/events', 'Ver eventos cerca de ti']);
    expect(res.headers.get('Vary') ?? '').toMatch(/Accept-Language/);
    // ...and that page is the same for a malformed and an unknown code too.
    const other = await get('/s/!!', { ...PAGE, 'Accept-Language': 'es-MX,es;q=0.9' });
    expect(await other.text()).toBe(html);
  });
});

describe('OSE-2164 | /s/ past the guess limit | the 429 is the same for a right and a wrong code', () => {
  const from = (ip: string, accept: Record<string, string>) => ({
    redirect: 'manual' as const,
    headers: { 'CF-Connecting-IP': ip, ...accept },
  });
  const wrong = (i: number) => `zzzz${String(i % 100).padStart(2, '0')}`;

  async function newCode(): Promise<string> {
    const { id } = await seed('draft', false);
    return (await createShortlink(E, id)).code;
  }

  test.each([
    ['a browser', PAGE, 'text/html'],
    ['a script', { Accept: '*/*', 'User-Agent': PERSON_UA }, 'application/json'],
  ])(
    '%s: 429, Retry-After 60, no-store, identical for a right and a wrong code',
    async (_n, accept, type) => {
      const code = await newCode();
      const ip = `198.51.100.${accept === PAGE ? 80 : 81}`;
      for (let i = 0; i < SHORTLINK_GUESS_MAX; i++) {
        expect((await SELF.fetch(`${ORIGIN}/s/${wrong(i)}`, from(ip, accept))).status).toBe(404);
      }
      const bad = await SELF.fetch(`${ORIGIN}/s/${wrong(SHORTLINK_GUESS_MAX)}`, from(ip, accept));
      const right = await SELF.fetch(`${ORIGIN}/s/${code}`, from(ip, accept));
      for (const res of [bad, right]) {
        expect(res.status).toBe(429);
        expect(res.headers.get('Content-Type')).toContain(type);
        expect(res.headers.get('Retry-After')).toBe('60');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(res.headers.get('Set-Cookie')).toBeNull();
      }
      expect(await right.text()).toBe(await bad.text());
      expect(sameHeaders(right)).toBe(sameHeaders(bad));
    }
  );
});

describe('OSE-2164 | /es error pages | the reader keeps their language', () => {
  test('/es/events/<no such id>: lang es, Spanish words, button to /es/events', async () => {
    const res = await get('/es/events/no-such-event-2164');
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(lang(html)).toBe('es');
    expect(html).toContain('No encontramos ese evento');
    expect(html).toContain('Error 404');
    expect(cta(html)?.slice(1)).toEqual(['/es/events', 'Ver próximos eventos']);
    expect(html).not.toContain('Browse upcoming events');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  test('a draft reads the same Spanish 404 as an id with no row (draft and unknown are one page)', async () => {
    const draft = await seed('draft', false);
    const a = await get(`/es/events/${draft.id}`);
    const b = await get('/es/events/no-such-event-2164');
    expect(a.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
    expect(sameHeaders(a)).toBe(sameHeaders(b));
  });

  test('a ready event reads the same Spanish 404 as a draft', async () => {
    const draft = await seed('draft', false);
    const ready = await seed('ready', false);
    const a = await get(`/es/events/${draft.id}`);
    const b = await get(`/es/events/${ready.id}`);
    expect(b.status).toBe(404);
    expect(await b.text()).toBe(await a.text());
    expect(sameHeaders(b)).toBe(sameHeaders(a));
  });

  test('on a bare address the button follows the page language, like the brand link', async () => {
    const res = await get('/events/no-such-event-2164', { 'Accept-Language': 'es' });
    const html = await res.text();
    expect(cta(html)?.[1]).toBe('/es/events');
    expect(html).toContain('data-testid="error-brand"');
  });

  test('the bare English 404 is unchanged in its words and keeps its /events button', async () => {
    const res = await get('/events/no-such-event-2164');
    const html = await res.text();
    expect(lang(html)).toBe('en');
    expect(html).toContain('We couldn&#39;t find that event');
    expect(html).toContain('Error 404');
    expect(cta(html)?.slice(1)).toEqual(['/events', 'Browse upcoming events']);
  });

  test('a bare address follows Accept-Language, and says so in Vary', async () => {
    const res = await get('/events/no-such-event-2164', { 'Accept-Language': 'es' });
    expect(lang(await res.text())).toBe('es');
    expect(res.headers.get('Vary') ?? '').toMatch(/Accept-Language/);
    const prefixed = await get('/es/events/no-such-event-2164');
    expect(prefixed.headers.get('Vary') ?? '').not.toMatch(/Accept-Language/);
  });

  test('/es/events/<ended event>: the "has ended" page (410) reads Spanish', async () => {
    const ended = await seed('archived', true);
    const res = await get(`/es/events/${ended.id}`);
    const html = await res.text();
    expect(res.status).toBe(410);
    expect(lang(html)).toBe('es');
    expect(html).toContain(`${ended.title} ha terminado`);
    expect(cta(html)?.slice(1)).toEqual(['/es/events', 'Ver próximos eventos']);
    expect(html).not.toContain('has ended');
  });

  test('/es/e/<bad code>: the bad-code page reads Spanish; /e/<bad code> stays English', async () => {
    const es = await get('/es/e/ZZZZ22');
    const esHtml = await es.text();
    expect(es.status).toBe(404);
    expect(lang(esHtml)).toBe('es');
    expect(esHtml).toContain('Ese código no coincide con ningún evento');
    expect(cta(esHtml)?.slice(1)).toEqual(['/es/events', 'Ver próximos eventos']);
    const en = await get('/e/ZZZZ22');
    const enHtml = await en.text();
    expect(lang(enHtml)).toBe('en');
    expect(enHtml).toContain('That code didn&#39;t match an event');
    expect(cta(enHtml)?.slice(1)).toEqual(['/events', 'Browse upcoming events']);
  });
});

describe('OSE-2164 | the new words | every finished language carries them', () => {
  const keys = Object.keys(CATALOG.en).filter((k) => k.startsWith('err.'));
  test('there are err.* keys, and es, pl and ar each have all of them', () => {
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const l of ['es', 'pl', 'ar'] as const) {
      const missing = keys.filter((k) => !(k in CATALOG[l]));
      expect(missing, l).toEqual([]);
    }
  });
});
