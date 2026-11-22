/**
 * A dead link says something, on staging (OSE-2164).
 *
 * Replaces tests/playwright/flow-shortlink-resolver.spec.ts (OSE-312), which no
 * workflow ran and which still said the /s/ 404 must be JSON for everyone. The
 * 404 contract is now:
 *
 *   - a browser (Accept: text/html) reads a branded 404 with one button to
 *     /events; a script keeps the JSON; both carry `Vary: Accept` and `no-store`
 *   - a malformed and an unknown code answer the same page (no oracle): the
 *     same bytes from the Worker, compared without what the staging edge adds
 *   - on /es the event 404 reads Spanish and its button goes to /es/events
 *   - none of it sets a cookie
 *
 * HTTP only (no browser). The worker layer proves the same cases against the
 * handlers (workers/oursharedevents/tests/dead-link-words.spec.ts); this proves
 * them through the deployed Worker and its edge. A request from a runner must be
 * answered by the Worker: a Cloudflare challenge fails the run by name instead
 * of passing on the edge's page. The phone user agent and X-OCR-CI are the
 * pair the Bruno pages collection sends (bruno/ose-pages/lib/edge.js).
 *
 * No skip: nothing here needs a credential or a fixture.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
const EDGE_TOKEN = process.env.OCR_CI_EDGE_TOKEN || '';
const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PAGE = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

interface Seen {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function seen(
  request: import('@playwright/test').APIRequestContext,
  path: string,
  headers: Record<string, string> = {}
): Promise<Seen> {
  const h: Record<string, string> = { 'User-Agent': PHONE_UA, ...headers };
  if (EDGE_TOKEN) h['X-OCR-CI'] = EDGE_TOKEN;
  const res = await request.fetch(`${BASE_URL}${path}`, {
    headers: h,
    maxRedirects: 0,
    timeout: 30_000,
  });
  const out = { status: res.status(), headers: res.headers(), body: await res.text() };
  if (out.headers['cf-mitigated']) {
    throw new Error(
      `Cloudflare (${out.headers['cf-mitigated']}) answered GET ${path}, not the Worker`
    );
  }
  return out;
}

/**
 * The page as the Worker sent it. On staging the edge adds a script for its
 * JavaScript check to an HTML page (it names `window.__CF$cv$params` and holds
 * the request's Ray ID, the time and a nonce), and nonce attributes are new per
 * read, so two reads of one address are never equal byte for byte. Those two
 * are taken out; everything else is compared. The Bruno check does the same
 * (bruno/ose-pages folder 17; tests/integration/bruno-dead-link-same-page.test.js),
 * and the Worker's own /s/ page never names __CF$cv$params
 * (workers/oursharedevents/tests/dead-link-words.spec.ts).
 *
 * This only shapes two copies for a comparison in a test; nothing it returns
 * is served or rendered. Each edge script is cut out by position: from the
 * `<script` that opens it to the `</script>` that closes it. A marker with no
 * script around it is left in place, so the comparison still sees it.
 */
const EDGE_MARK = 'window.__CF$cv$params';
const workerPage = (h: string): string => {
  let page = h;
  let from = 0;
  for (;;) {
    const mark = page.indexOf(EDGE_MARK, from);
    if (mark < 0) break;
    const open = page.lastIndexOf('<script', mark);
    const close = page.indexOf('</script>', mark);
    // Not inside a script (or the script never closes): keep it, look further on.
    if (open < 0 || close < 0 || page.lastIndexOf('</script>', mark) > open) {
      from = mark + EDGE_MARK.length;
      continue;
    }
    page = page.slice(0, open) + page.slice(close + '</script>'.length);
    from = open;
  }
  return page.split(/nonce="[^"]*"/).join('');
};

const lang = (html: string) => /<html lang="([a-z]+)"/.exec(html)?.[1];
const button = (html: string) => /data-testid="error-cta" href="([^"]*)">([^<]*)</.exec(html);

test.describe('OSE-2164 | /s/ | a dead short link', () => {
  test('a browser reads a 404 page with one button to /events, no cookie, no-store, Vary: Accept', async ({
    request,
  }) => {
    const r = await seen(request, '/s/zzzz', { Accept: PAGE });
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.headers['vary'] ?? '').toMatch(/accept/i);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(lang(r.body)).toBe('en');
    expect(button(r.body)?.slice(1)).toEqual(['/events', 'See events near you']);
    expect(r.body.match(/<h1\b/g)?.length).toBe(1);
  });

  test('a script keeps the JSON', async ({ request }) => {
    const r = await seen(request, '/s/zzzz', { Accept: 'application/json' });
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toContain('application/json');
    expect(r.headers['vary'] ?? '').toMatch(/accept/i);
    expect(JSON.parse(r.body)).toEqual({ ok: false, code: 'NOT_FOUND', error: 'Link not found' });
  });

  test('a malformed and an unknown code answer the same Worker page (no oracle)', async ({
    request,
  }) => {
    for (const accept of [PAGE, 'application/json']) {
      const unknown = await seen(request, '/s/zzzz99', { Accept: accept });
      for (const bad of ['a!b2c3', 'abc12345', 'x']) {
        const r = await seen(request, `/s/${encodeURIComponent(bad)}`, { Accept: accept });
        expect(r.status, bad).toBe(unknown.status);
        expect(workerPage(r.body), bad).toBe(workerPage(unknown.body));
      }
    }
  });
});

test.describe('OSE-2164 | /es | the event 404 keeps the reader’s language', () => {
  test('/es/events/<no such id> reads Spanish and its button goes to /es/events', async ({
    request,
  }) => {
    const r = await seen(request, '/es/events/no-such-event-2164', { Accept: PAGE });
    expect(r.status).toBe(404);
    expect(lang(r.body)).toBe('es');
    expect(button(r.body)?.[1]).toBe('/es/events');
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  test('the bare address stays English with its /events button', async ({ request }) => {
    const r = await seen(request, '/events/no-such-event-2164', { Accept: PAGE });
    expect(r.status).toBe(404);
    expect(lang(r.body)).toBe('en');
    expect(button(r.body)?.[1]).toBe('/events');
  });
});
