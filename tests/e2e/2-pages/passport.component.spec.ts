/**
 * Stamp passport in a real browser (owner, 2026-11-28: a walk, market or fair
 * whose stops each stamp a card kept on the visitor's own phone;
 * workers/oursharedevents/src/lib/passport.ts).
 *
 * The stop pages and the list as the Worker renders them, on a phone:
 *
 *   - a stop's page opened with #stamp saves that stop, says so, shows the
 *     count, and takes #stamp off the address;
 *   - the same page without #stamp (a reload, a shared link) saves nothing;
 *   - every stop stamped: the list says the card is complete and marks each stop;
 *   - "Clear my stamps" empties this phone's card and hides the marks;
 *   - a stop number put into storage by hand that is not a stop is ignored;
 *   - the page asks for nothing but itself and its stylesheet, writes no cookie
 *     and no session storage, and keeps one local storage key;
 *   - with scripts off it says how to keep stamps and shows no count;
 *   - the clear button is a 44 px target; axe finds no WCAG A or AA violation,
 *     light and dark; nothing scrolls sideways at 320 px; 2.5.8 holds.
 *
 * Mutation (the last describe): the stamp check is run on a page whose script
 * stamps without #stamp, and must fail on it.
 *
 * Born red (2026-11-28, Chromium, one fault at a time in passport.ts, each put
 * back): the #stamp check dropped (the reload test); history.replaceState taken
 * out (the stamp test); the clear handler left empty (the clear test).
 *
 * It runs in the T0 `component` shard (playwright.component.config.ts), on
 * Chromium and WebKit. Every request goes to ORIGIN and is answered by the
 * routes; anything else is aborted and counted.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { ORIGIN, uiCss } from '../helpers/render-landing-map';
import {
  PASSPORT_WALK,
  renderPassportList,
  renderPassportStop,
} from '../helpers/render-card-lists';
import { axeWcag, reflow, settleTransitions, targetSize } from '../helpers/wcag';

/** Touch target floor, in CSS px (AGENTS.md invariant 8). */
const TARGET_PX = 44;
const KEY = `ose-passport:${PASSPORT_WALK.id}`;
const LIST = `/events/${PASSPORT_WALK.id}/booths`;
const stopPath = (n: string) => `${LIST}/${n}`;

interface Seen {
  stray: string[];
}

/** Serve the walk's pages; `mutate` changes each page's HTML before it is served. */
async function serve(page: Page, mutate: (html: string) => string = (h) => h): Promise<Seen> {
  const css = await uiCss();
  const seen: Seen = { stray: [] };
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) {
      seen.stray.push(u.href);
      return route.abort();
    }
    if (u.pathname === '/ui.css')
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    let html: string | null = null;
    if (u.pathname === LIST) html = await renderPassportList();
    for (const n of PASSPORT_WALK.stops)
      if (u.pathname === stopPath(n)) html = await renderPassportStop(n);
    if (html !== null)
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: mutate(html),
      });
    return route.fulfill({ status: 404, body: '' });
  });
  return seen;
}

async function phone(
  browser: Browser,
  opts: { width?: number; scheme?: 'light' | 'dark'; js?: boolean } = {}
) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 390, height: 844 },
    colorScheme: opts.scheme ?? 'light',
    javaScriptEnabled: opts.js ?? true,
  });
  return { ctx, page: await ctx.newPage() };
}

async function go(page: Page, path: string): Promise<void> {
  const res = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'load' });
  expect(res?.status()).toBe(200);
}

const stored = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as string[], KEY);

test('a stop with #stamp saves it, says so, shows the count and takes #stamp off', async ({
  browser,
}) => {
  const { ctx, page } = await phone(browser);
  const seen = await serve(page);
  await go(page, `${stopPath('2')}#stamp`);
  await expect(page.getByTestId('passport-status')).toHaveText('Stamp saved for this stop.');
  await expect(page.getByTestId('passport-count')).toHaveText('You have 1 of 3 stamps.');
  expect(new URL(page.url()).hash).toBe('');
  expect(await stored(page)).toEqual(['2']);
  expect(seen.stray).toEqual([]);
  const writes = await page.evaluate(() => [
    document.cookie,
    sessionStorage.length,
    Object.keys(localStorage),
  ]);
  expect(writes).toEqual(['', 0, [KEY]]);
  await ctx.close();
});

test('the same page without #stamp (a reload or a shared link) saves nothing', async ({
  browser,
}) => {
  const { ctx, page } = await phone(browser);
  await serve(page);
  await go(page, stopPath('3'));
  await expect(page.getByTestId('passport-count')).toHaveText('You have 0 of 3 stamps.');
  await expect(page.getByTestId('passport-status')).toHaveText(
    "Scan this stop's code to collect its stamp."
  );
  expect(await stored(page)).toEqual([]);
  await ctx.close();
});

test('every stop stamped: the list says complete and marks each stop; clear empties it', async ({
  browser,
}) => {
  const { ctx, page } = await phone(browser);
  const seen = await serve(page);
  for (const n of PASSPORT_WALK.stops) await go(page, `${stopPath(n)}#stamp`);
  await go(page, LIST);
  const card = page.getByTestId('passport');
  await expect(page.getByTestId('passport-count')).toHaveText(
    'Card complete! Show this screen at the prize table.'
  );
  await expect(card).toHaveAttribute('data-passport-done', 'yes');
  const marks = page.getByTestId('passport-mark');
  await expect(marks).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(marks.nth(i)).toHaveText('Stamped');

  await page.getByTestId('passport-clear').click();
  await expect(page.getByTestId('passport-count')).toHaveText('You have 0 of 3 stamps.');
  for (let i = 0; i < 3; i++) await expect(marks.nth(i)).toBeHidden();
  await expect(page.getByTestId('passport-clear')).toBeHidden();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  expect(seen.stray).toEqual([]);
  await ctx.close();
});

test('a stop number put into storage by hand that is not a stop is ignored', async ({
  browser,
}) => {
  const { ctx, page } = await phone(browser);
  await serve(page);
  await go(page, LIST);
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify(['1', '99', '<b>'])), KEY);
  await go(page, LIST);
  await expect(page.getByTestId('passport-count')).toHaveText('You have 1 of 3 stamps.');
  await ctx.close();
});

test('with scripts off it says how to keep stamps and shows no count', async ({ browser }) => {
  const { ctx, page } = await phone(browser, { js: false });
  await serve(page);
  await go(page, `${stopPath('1')}#stamp`);
  await expect(page.getByTestId('passport-noscript')).toBeVisible();
  await expect(page.getByTestId('passport-count')).toBeHidden();
  await ctx.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: no WCAG A or AA violation on a stop and the list; 44 px clear; 320 px; 2.5.8`, async ({
    browser,
  }) => {
    const { ctx, page } = await phone(browser, { scheme });
    await serve(page);
    await go(page, `${stopPath('1')}#stamp`);
    await settleTransitions(page);
    expect(await axeWcag(page)).toEqual([]);
    expect(await targetSize(page)).toEqual([]);
    const clear = (await page.getByTestId('passport-clear').boundingBox())!;
    expect(clear.height).toBeGreaterThanOrEqual(TARGET_PX);
    await go(page, LIST);
    await settleTransitions(page);
    expect(await axeWcag(page)).toEqual([]);
    expect(await targetSize(page)).toEqual([]);
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await reflow(page)).toEqual([]);
    await ctx.close();
  });
}

// ── mutation: the stamp check must catch a script that stamps without #stamp ──
test.describe('mutation: the checks fail on a fault', () => {
  test('a script that stamps without #stamp is caught', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await serve(page, (html) => html.replace("window.location.hash === '#stamp'", 'true'));
    await go(page, stopPath('3'));
    // The real check (the reload test) expects nothing saved; the fault saves.
    expect(await stored(page)).toEqual(['3']);
    await ctx.close();
  });
});
