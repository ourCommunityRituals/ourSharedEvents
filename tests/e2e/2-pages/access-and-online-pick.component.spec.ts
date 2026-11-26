/**
 * The Access Pass page and the Online Pick page in a real browser (OSE ADR-040
 * decision 13). Both pages are the Worker's own render
 * (tests/e2e/helpers/render-vote-page.ts); this spec answers their requests
 * and records every request they make. Phone first, WCAG 2.0, 2.1 and 2.2 at
 * levels A and AA, as for the voter page.
 *
 * Case ids map to the owner's private security review.
 *
 * Mandatory: listed in the T0 Gate (component) step of oursharedevents-ci.yml
 * beside voter-page.component.spec.ts.
 *
 * @born-red decision 13 | method: injected-fault, each removed after: the
 *   access script's replaceState removed (the refused case red: the token
 *   stays in the bar), the token sent in the POST's query string (RT-AP-13
 *   red), the crowd page
 *   posting to the room route (the channel case red) | date: 2026-11-26
 */
import { test, expect, type Browser, type Page, type Request } from '@playwright/test';
import { renderAccess, renderVote, voteUiCss, VOTE_ORIGIN } from '../helpers/render-vote-page';
import { axeWcag, pageLanguage, reflow, targetSize, textSpacing } from '../helpers/wcag';

const EVENT = 'evt_vote_demo';
const TOKEN = 'A'.repeat(20) + 'b'.repeat(20) + '_-9'; // 43 characters, the token's shape
const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const ROOM_ACCESS_PASS = `vp1.${b64url({ e: EVENT, a: 'vap_' + '0'.repeat(32) })}.c2lnbmF0dXJl`;
const CROWD_PASS = `vc1.${b64url({ e: EVENT })}.c2lnbmF0dXJl`;
const SONGS = [
  { id: 'vob_song_one', kind: 'song', label: 'Bring It On Home' },
  { id: 'vob_song_two', kind: 'song', label: 'Dancing in the Street' },
];

interface Seen {
  requests: {
    url: string;
    method: string;
    body: string | null;
    cookie: string | null;
    referer: string | null;
  }[];
}

async function phone(browser: Browser, width = 375, scheme: 'light' | 'dark' = 'light') {
  const ctx = await browser.newContext({ viewport: { width, height: 812 }, colorScheme: scheme });
  return { ctx, page: await ctx.newPage() };
}

/** Serve both pages; the redeem answer is `redeem`, and votes are answered ok. */
async function serve(page: Page, redeem: { status: number; body: unknown }): Promise<Seen> {
  const access = await renderAccess();
  const room = await renderVote(EVENT);
  const crowd = await renderVote(EVENT, { channel: 'crowd' });
  const css = await voteUiCss();
  const seen: Seen = { requests: [] };
  await page.route('**/*', async (route) => {
    const req: Request = route.request();
    const u = new URL(req.url());
    if (u.origin !== VOTE_ORIGIN) return route.abort();
    const h = await req.allHeaders();
    seen.requests.push({
      url: req.url(),
      method: req.method(),
      body: req.postData(),
      cookie: h['cookie'] ?? null,
      referer: h['referer'] ?? null,
    });
    const html = (body: string) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    if (u.pathname === '/ui.css')
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    if (u.pathname === '/access') return html(access.html);
    if (u.pathname === `/events/${EVENT}/vote`) return html(room);
    if (u.pathname === `/events/${EVENT}/online-pick`) return html(crowd);
    if (u.pathname === '/api/v2/vote/access' && req.method() === 'POST')
      return route.fulfill({
        status: redeem.status,
        contentType: 'application/json',
        body: JSON.stringify(redeem.body),
      });
    if (u.pathname === `/api/v2/vote/${EVENT}/objects`)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ objects: SONGS }),
      });
    if (u.pathname.startsWith(`/api/v2/vote/${EVENT}`) && req.method() === 'POST')
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    return route.fulfill({ status: 404, body: '' });
  });
  return seen;
}

test.describe('Access Pass page', () => {
  test('RT-AP-13: the token leaves the address bar, goes only in a POST body, and never in a URL, cookie or Referer [replaceState removed]', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    const seen = await serve(page, {
      status: 200,
      body: { ok: true, event_id: EVENT, pass: ROOM_ACCESS_PASS },
    });
    await page.goto(`${VOTE_ORIGIN}/access#${TOKEN}`, { waitUntil: 'load' });
    await page.waitForURL(`${VOTE_ORIGIN}/events/${EVENT}/vote`);
    const posts = seen.requests.filter((r) => r.url.endsWith('/api/v2/vote/access'));
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].body ?? '{}')).toEqual({ token: TOKEN });
    for (const r of seen.requests) {
      expect(r.url, 'no request line carries the token').not.toContain(TOKEN);
      expect(r.cookie, 'no cookie is sent').toBeNull();
      expect(r.referer ?? '', 'no Referer carries the token').not.toContain(TOKEN);
    }
    // The voter page took the pass out of the bar, and says it is an Access Pass.
    expect(page.url()).toBe(`${VOTE_ORIGIN}/events/${EVENT}/vote`);
    await expect(page.getByTestId('vote-access-line')).toBeVisible();
    await expect(page.getByTestId('vote-object')).toHaveCount(2);
    await ctx.close();
  });

  test('a refused token gets one plain sentence and the page stays put', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await serve(page, { status: 403, body: { ok: false, code: 'ACCESS_PASS_INVALID' } });
    await page.goto(`${VOTE_ORIGIN}/access#${TOKEN}`, { waitUntil: 'load' });
    await expect(page.getByTestId('access-status')).toContainText("isn't working right now");
    expect(page.url()).toBe(`${VOTE_ORIGIN}/access`);
    await ctx.close();
  });

  test('a badly shaped token is never sent', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    const seen = await serve(page, {
      status: 200,
      body: { ok: true, event_id: EVENT, pass: ROOM_ACCESS_PASS },
    });
    await page.goto(`${VOTE_ORIGIN}/access#not-a-token`, { waitUntil: 'load' });
    await expect(page.getByTestId('access-status')).toContainText("isn't working right now");
    expect(seen.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    await ctx.close();
  });

  test('a redeem answer that is not a clean event id and pass is not followed', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    await serve(page, {
      status: 200,
      body: { ok: true, event_id: '../admin', pass: ROOM_ACCESS_PASS },
    });
    await page.goto(`${VOTE_ORIGIN}/access#${TOKEN}`, { waitUntil: 'load' });
    await expect(page.getByTestId('access-status')).toContainText("isn't working right now");
    expect(page.url()).toBe(`${VOTE_ORIGIN}/access`);
    await ctx.close();
  });

  test('the page sends a script nonce in its CSP, and its HTML holds no token', async () => {
    const { html, headers } = await renderAccess();
    expect(headers['content-security-policy'] ?? '').toMatch(/script-src[^;]*'nonce-/);
    expect(html).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });
});

test.describe('Online Pick page', () => {
  test('RT-OP-07: it votes on the crowd route only, says it can be gamed, and never shows the Access Pass line [posts to the room route]', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    const seen = await serve(page, { status: 403, body: {} });
    await page.goto(`${VOTE_ORIGIN}/events/${EVENT}/online-pick#t=${CROWD_PASS}`, {
      waitUntil: 'load',
    });
    expect(page.url()).toBe(`${VOTE_ORIGIN}/events/${EVENT}/online-pick`);
    await expect(page.locator('h1')).toHaveText('Online Pick');
    await expect(page.getByTestId('vote-crowd-note')).toContainText('can be gamed');
    await expect(page.getByTestId('vote-access-line')).toHaveCount(0);
    await page.getByTestId('vote-up').first().click();
    await expect(page.getByTestId('vote-done')).toHaveCount(1);
    const votes = seen.requests.filter((r) => r.method === 'POST');
    expect(votes.map((r) => new URL(r.url).pathname)).toEqual([`/api/v2/vote/${EVENT}/crowd`]);
    expect(JSON.parse(votes[0].body ?? '{}').pass).toBe(CROWD_PASS);
    await ctx.close();
  });
});

const STATES: [string, string][] = [
  ['access page, refused', `/access#bad`],
  ['room page with an Access Pass', `/events/${EVENT}/vote#t=${ROOM_ACCESS_PASS}`],
  ['Online Pick page', `/events/${EVENT}/online-pick#t=${CROWD_PASS}`],
];

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [320, 375]) {
    for (const [what, path] of STATES) {
      test(`${what}, ${width} px, ${scheme}: no WCAG 2.0/2.1/2.2 A or AA failure`, async ({
        browser,
      }) => {
        const { ctx, page } = await phone(browser, width, scheme);
        await serve(page, { status: 403, body: {} });
        await page.goto(`${VOTE_ORIGIN}${path}`, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle');
        expect(await axeWcag(page), 'axe, every WCAG A/AA rule').toEqual([]);
        expect(await targetSize(page), '2.5.8 Target Size (Minimum)').toEqual([]);
        expect(await pageLanguage(page), '3.1.1 Language of Page').toEqual([]);
        if (width === 320) {
          expect(await reflow(page), '1.4.10 Reflow').toEqual([]);
          expect(await textSpacing(page), '1.4.12 Text Spacing').toEqual([]);
        }
        await ctx.close();
      });
    }
  }
}
