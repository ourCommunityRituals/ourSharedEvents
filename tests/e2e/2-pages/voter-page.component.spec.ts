/**
 * The voter page in a real browser (OSE-2129, S4b of OSE-1193; OSE ADR-040
 * decisions 5, 6 and 9): what the phone does with the pass, the buttons, the
 * page's states, and WCAG 2.0, 2.1 and 2.2 at levels A and AA (owner,
 * 2026-11-18: every new page joins the WCAG suite).
 *
 * The page is the Worker's own render (tests/e2e/helpers/render-vote-page.ts).
 * This spec answers its two requests, the open-objects read and the vote, and
 * records every request the page makes. Phone first: 320 and 375 px run every
 * state.
 *
 * Mandatory: listed in the T0 Gate (component) step of oursharedevents-ci.yml
 * beside wcag-map.component.spec.ts, and in `npm run test:wcag`.
 *
 * Each behaviour case names, in brackets, the fault it was seen failing on
 * first (each removed after):
 * @born-red OSE-2129 | method: injected-fault, each removed after: replaceState
 *   removed (fragment case red), the pass saved to sessionStorage (storage case
 *   red), the pass in the vote's query string and credentials 'include' (request
 *   case red), the thanks line carrying a count (thanks case red) | date: 2026-11-19
 */
import { test, expect, type Browser, type Page, type Request } from '@playwright/test';
import {
  renderVote,
  voteUiCss,
  VOTE_ORIGIN,
  type VotePageOptions,
} from '../helpers/render-vote-page';
import { axeWcag, focusWalk, pageLanguage, reflow, targetSize, textSpacing } from '../helpers/wcag';

const EVENT = 'evt_vote_demo';
const PAGE = `/events/${EVENT}/vote`;
const PASS = 'vp1.eyJlIjoiZXZ0X3ZvdGVfZGVtbyJ9.c2lnbmF0dXJlLXN0YW5kLWlu';

const SONGS = [
  { id: 'vob_song_one', kind: 'song', label: 'Bring It On Home' },
  { id: 'vob_song_two', kind: 'song', label: 'Dancing in the Street' },
];

interface Stub {
  /** The open-objects answers, in order; the last one repeats. A number is a status. */
  objects: (typeof SONGS | number)[];
  /** The vote answer: status and body. */
  vote?: { status: number; body: Record<string, unknown> };
}

interface Seen {
  requests: { url: string; method: string; body: string | null; cookie: string | null }[];
}

async function open(
  page: Page,
  stub: Stub,
  opts: VotePageOptions & { hash?: string } = {}
): Promise<Seen> {
  const html = await renderVote(EVENT, opts);
  const css = await voteUiCss();
  const seen: Seen = { requests: [] };
  let objectCalls = 0;
  await page.route('**/*', async (route) => {
    const req: Request = route.request();
    const u = new URL(req.url());
    if (u.origin !== VOTE_ORIGIN) return route.abort();
    seen.requests.push({
      url: req.url(),
      method: req.method(),
      body: req.postData(),
      cookie: (await req.allHeaders())['cookie'] ?? null,
    });
    if (u.pathname === '/ui.css')
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    if (u.pathname === PAGE)
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (u.pathname === `/api/v2/vote/${EVENT}/objects`) {
      const answer = stub.objects[Math.min(objectCalls++, stub.objects.length - 1)];
      if (typeof answer === 'number')
        return route.fulfill({ status: answer, contentType: 'application/json', body: '{}' });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ objects: answer }),
      });
    }
    if (u.pathname === `/api/v2/vote/${EVENT}` && req.method() === 'POST') {
      const v = stub.vote ?? { status: 200, body: { ok: true } };
      return route.fulfill({
        status: v.status,
        contentType: 'application/json',
        body: JSON.stringify(v.body),
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const hash = opts.hash === undefined ? `#t=${PASS}` : opts.hash;
  const res = await page.goto(`${VOTE_ORIGIN}${PAGE}${hash}`, { waitUntil: 'load' });
  expect(res?.status()).toBe(200);
  return seen;
}

/** Record every write to a storage API or the cookie, from before the page's script runs. */
async function watchStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: string[] };
    w.__writes = [];
    const note = (what: string) => w.__writes.push(what);
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      note(`storage ${k}`);
      return set.call(this, k, v);
    };
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    Object.defineProperty(Document.prototype, 'cookie', {
      get() {
        return desc.get!.call(this);
      },
      set(v: string) {
        note(`cookie ${v}`);
        desc.set!.call(this, v);
      },
    });
    const idb = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((name: string, version?: number) => {
      note(`indexedDB ${name}`);
      return idb(name, version);
    }) as typeof indexedDB.open;
  });
}

async function phone(browser: Browser, width = 375, scheme: 'light' | 'dark' = 'light') {
  const ctx = await browser.newContext({ viewport: { width, height: 812 }, colorScheme: scheme });
  return { ctx, page: await ctx.newPage() };
}

test.describe('the pass stays in memory', () => {
  test('the address bar has no fragment once the page has loaded [replaceState removed]', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    await open(page, { objects: [SONGS] });
    expect(page.url()).toBe(`${VOTE_ORIGIN}${PAGE}`);
    expect(await page.evaluate(() => location.hash)).toBe('');
    await ctx.close();
  });

  test('no storage API and no cookie is written, through a whole vote [pass saved to storage]', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    await watchStorage(page);
    await open(page, { objects: [SONGS] });
    await page.getByTestId('vote-up').first().click();
    await expect(page.getByTestId('vote-done')).toHaveCount(1);
    expect(
      await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes)
    ).toEqual([]);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    await ctx.close();
  });

  test('no request carries the pass in its address, and none sends a cookie [pass in the query]', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    await ctx.addCookies([{ name: 'ose_anon', value: 'anon_test', url: VOTE_ORIGIN }]);
    const seen = await open(page, { objects: [SONGS] });
    await page.getByTestId('vote-down').nth(1).click();
    await expect(page.getByTestId('vote-done')).toHaveCount(1);
    for (const r of seen.requests) expect(r.url).not.toContain(PASS);
    const api = seen.requests.filter((r) => r.url.includes('/api/v2/vote/'));
    expect(api.length).toBeGreaterThanOrEqual(2);
    for (const r of api) expect(r.cookie, `${r.method} ${r.url} sent a cookie`).toBeNull();
    const post = api.find((r) => r.method === 'POST')!;
    expect(JSON.parse(post.body!)).toEqual({
      object_id: 'vob_song_two',
      side: 'down',
      pass: PASS,
    });
    await ctx.close();
  });
});

test.describe('the page states', () => {
  test('with no pass, the page says to scan the code again and lists nothing', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    const seen = await open(page, { objects: [SONGS] }, { hash: '' });
    await expect(page.getByTestId('vote-scan-again')).toBeVisible();
    await expect(page.getByTestId('vote-scan-again')).toHaveText(
      'Scan the code on the screen again.'
    );
    await expect(page.getByTestId('vote-object')).toHaveCount(0);
    expect(seen.requests.filter((r) => r.url.includes('/api/'))).toEqual([]);
    await ctx.close();
  });

  test('a pass that has run out turns into the scan-again words on the first vote', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    await open(page, {
      objects: [SONGS],
      vote: { status: 403, body: { ok: false, code: 'VOTE_PASS_INVALID' } },
    });
    await page.getByTestId('vote-up').first().click();
    await expect(page.getByTestId('vote-scan-again')).toBeVisible();
    await expect(page.getByTestId('vote-object')).toHaveCount(0);
    await ctx.close();
  });

  test('a vote shows the same thanks, with no number, and that song takes no second vote [count shown]', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    await open(page, { objects: [SONGS] });
    await expect(page.getByTestId('vote-object')).toHaveCount(2);
    await page.getByTestId('vote-up').first().click();
    const first = page.getByTestId('vote-object').first();
    await expect(first.getByTestId('vote-done')).toHaveText('Thanks. Your vote is in.');
    await expect(first.getByRole('button')).toHaveCount(0);
    const main = (await page.locator('main').innerText()).replace(/\d{1,2}:\d{2}|June 6/g, '');
    expect(main).not.toMatch(/\d/);
    await ctx.close();
  });

  test('nothing open says so, and a song opened later appears without reloading (a reopen)', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    await open(page, { objects: [[], SONGS] });
    await expect(page.getByTestId('vote-status')).toHaveText(
      'Nothing is open for a vote right now. This page checks again by itself.'
    );
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByTestId('vote-object')).toHaveCount(2);
    await ctx.close();
  });

  test('a song closed under the voter says so', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await open(page, {
      objects: [SONGS, [SONGS[1]!]],
      vote: { status: 409, body: { ok: false, code: 'VOTE_CLOSED' } },
    });
    await page.getByTestId('vote-up').first().click();
    await expect(page.getByTestId('vote-status')).toHaveText('Voting on that one has closed.');
    await expect(page.getByTestId('vote-object')).toHaveCount(1);
    await ctx.close();
  });

  test('switched off while the page is open, it says voting is not open', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await open(page, { objects: [404] });
    await expect(page.getByTestId('vote-status')).toHaveText('Voting is not open right now.');
    await expect(page.getByTestId('vote-object')).toHaveCount(0);
    await ctx.close();
  });

  test('rendered with the switch off, it calls nothing and says voting is not open', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    const seen = await open(page, { objects: [SONGS] }, { votingOn: false });
    await expect(page.getByTestId('vote-off')).toBeVisible();
    await expect(page.getByTestId('vote-scan-again')).toBeHidden();
    expect(seen.requests.filter((r) => r.url.includes('/api/'))).toEqual([]);
    expect(page.url()).toBe(`${VOTE_ORIGIN}${PAGE}`);
    await ctx.close();
  });

  test('after final, the result shows, and no scan-again words without a pass', async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser);
    await open(
      page,
      { objects: [[]] },
      { hash: '', result: { outcome: 'winner', kind: 'object', label: 'Bring It On Home' } }
    );
    await expect(page.getByTestId('vote-result-words')).toHaveText('Bring It On Home');
    await expect(page.getByTestId('vote-scan-again')).toBeHidden();
    await ctx.close();
  });
});

const STATES: [string, Stub, VotePageOptions & { hash?: string }, (p: Page) => Promise<void>][] = [
  [
    'songs open',
    { objects: [SONGS] },
    {},
    async (p) => {
      await expect(p.getByTestId('vote-object')).toHaveCount(2);
    },
  ],
  [
    'after a vote, house rule open',
    { objects: [SONGS] },
    {},
    async (p) => {
      await p.getByTestId('vote-up').first().click();
      await expect(p.getByTestId('vote-done')).toHaveCount(1);
      await p.locator('[data-testid="vote-house-rule"] summary').click();
    },
  ],
  [
    'no pass, too close to call',
    { objects: [[]] },
    { hash: '', result: { outcome: 'too_close' } },
    async (p) => {
      await expect(p.getByTestId('vote-result')).toBeVisible();
    },
  ],
];

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [320, 375, 820]) {
    for (const [what, stub, opts, reach] of STATES) {
      test(`${what}, ${width} px, ${scheme}: no WCAG 2.0/2.1/2.2 A or AA failure`, async ({
        browser,
      }) => {
        const { ctx, page } = await phone(browser, width, scheme);
        await open(page, stub, opts);
        await reach(page);
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

test('375 px: every vote button is reached by Tab, focus is visible and never hidden', async ({
  browser,
}) => {
  const { ctx, page } = await phone(browser);
  await open(page, { objects: [SONGS] });
  await expect(page.getByTestId('vote-object')).toHaveCount(2);
  const { problems, stops } = await focusWalk(page);
  expect(problems, `stops: ${stops.join(', ')}`).toEqual([]);
  expect(stops.filter((s) => s === 'vote-up').length).toBe(2);
  expect(stops.filter((s) => s === 'vote-down').length).toBe(2);
  await ctx.close();
});

test('every vote button is at least 48 px tall on a phone', async ({ browser }) => {
  const { ctx, page } = await phone(browser, 320);
  await open(page, { objects: [SONGS] });
  const heights = await page
    .locator('[data-testid="vote-up"], [data-testid="vote-down"]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.length).toBe(4);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(48);
  await ctx.close();
});
