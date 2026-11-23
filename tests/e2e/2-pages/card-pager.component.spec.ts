/**
 * Every list of cards, five at a time, in a real browser (owner, 2026-11-22: "For
 * the listed card options fix, apply through the application where there is a
 * list of cards"; workers/oursharedevents/src/lib/card-pager.ts).
 *
 * The landing and /map are covered in landing-tabs.component.spec.ts. This spec
 * covers the other pages that show a list of cards, as the Worker renders them:
 * /events (upcoming and wrapped), the sponsor's home (placements, requests, the
 * events it could back) and a fair's stalls. On a phone, for the 55 to 75
 * audience the owner named:
 *
 *   - five cards show, then "Click for more" under them shows five more each tap,
 *     until the list ends and the button goes; focus moves to the first new card;
 *   - the button is a 44 px target and spans the list on a phone;
 *   - axe finds no WCAG 2.0/2.1/2.2 A or AA violation, light and dark, before and
 *     after a tap; nothing scrolls sideways at 320 px; every target meets 2.5.8;
 *   - with scripts off every card shows and there is no button;
 *   - the page asks for nothing but itself and its stylesheet, and writes no
 *     cookie and no storage.
 *
 * Mutation (the last describe): each check above is run once on a page with one
 * fault put in, and must fail on it.
 *
 * Born red (2026-11-22, Chromium, one fault at a time in card-pager.ts, each put
 * back): the cards never held back (the five test); a step of six (the five
 * test); focus left on the button (the focus test); the button's width rule
 * dropped (the phone-width test).
 *
 * It runs in the T0 `component` shard (playwright.component.config.ts), on
 * Chromium and WebKit. Every request goes to ORIGIN and is answered by the
 * routes; anything else is aborted and counted.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { ORIGIN, renderEvents, uiCss } from '../helpers/render-landing-map';
import { renderSponsorHome, renderStalls } from '../helpers/render-card-lists';
import { axeWcag, reflow, settleTransitions, targetSize } from '../helpers/wcag';

/** Touch target floor, in CSS px (AGENTS.md invariant 8). */
const TARGET_PX = 44;

type Row = Record<string, unknown>;

/** `up` upcoming and `wrapped` wrapped events, as the data provider hands them over. */
function eventRows(up: number, wrapped: number): Row[] {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const row = (i: number, d: number, past: boolean): Row => ({
    id: `evt_cp${past ? 'w' : 'u'}${String(i).padStart(2, '0')}`,
    slug: `pager-${past ? 'w' : 'u'}${i}`,
    title: `${past ? 'Wrapped' : 'Upcoming'} Night ${i + 1}`,
    status: past ? 'completed' : 'active',
    is_published: 1,
    start_date: day(d),
    end_date: day(d),
    location: 'Eagles Hall',
    brand_id: 'root',
  });
  return [
    ...Array.from({ length: up }, (_, i) => row(i, 3 + i, false)),
    ...Array.from({ length: wrapped }, (_, i) => row(i, -3 - i, true)),
  ];
}

interface Case {
  name: string;
  path: string;
  html: () => Promise<string>;
  /** The cards of the list under test. */
  cards: string;
  testid: string;
  total: number;
}

const CASES: Case[] = [
  {
    name: '/events, upcoming',
    path: '/events',
    html: () => renderEvents('/events', eventRows(12, 7)),
    cards: '#events article.event-card:not([data-phase="post_event"])',
    testid: 'events-more',
    total: 12,
  },
  {
    name: '/events, wrapped',
    path: '/events',
    html: () => renderEvents('/events', eventRows(12, 7)),
    cards: '#events article.event-card[data-phase="post_event"]',
    testid: 'events-wrapped-more',
    total: 7,
  },
  {
    name: 'sponsor home, placements',
    path: '/sponsor/home',
    html: () => renderSponsorHome(8, 6, 11),
    cards: '#sh-placements article.sh-card',
    testid: 'placement-more',
    total: 8,
  },
  {
    name: 'sponsor home, requests',
    path: '/sponsor/home',
    html: () => renderSponsorHome(8, 6, 11),
    cards: '#sh-requests article.sh-card',
    testid: 'request-more',
    total: 6,
  },
  {
    name: 'sponsor home, events it could back',
    path: '/sponsor/home',
    html: () => renderSponsorHome(8, 6, 11),
    cards: '#sh-discover article.sh-card',
    testid: 'discover-more',
    total: 11,
  },
  {
    name: 'stalls, food',
    path: '/events/fair_component/booths',
    html: () => renderStalls(13, 3),
    cards: '#booth-list-food li',
    testid: 'booth-list-more-food',
    total: 13,
  },
];

interface Seen {
  stray: string[];
}

async function open(page: Page, c: Case, extraCss = ''): Promise<Seen> {
  const html = await c.html();
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
    if (u.pathname === c.path)
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: extraCss ? html.replace('</head>', `<style>${extraCss}</style></head>`) : html,
      });
    // The page's own pictures (the default event picture): same origin, not ours to serve.
    return route.fulfill({ status: 404, body: '' });
  });
  const res = await page.goto(`${ORIGIN}${c.path}`, { waitUntil: 'load' });
  expect(res?.status()).toBe(200);
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

/** How many of the list's cards a person can see. */
const showing = (page: Page, sel: string) =>
  page.evaluate(
    (s) =>
      [...document.querySelectorAll<HTMLElement>(s)].filter(
        (c) => getComputedStyle(c).display !== 'none'
      ).length,
    sel
  );

for (const c of CASES) {
  test.describe(c.name, () => {
    test('five, then five more a tap, focus on the first new card, the button gone at the end', async ({
      browser,
    }) => {
      const { ctx, page } = await phone(browser);
      const seen = await open(page, c);
      const more = page.getByTestId(c.testid);
      const status = page.getByTestId(`${c.testid}-status`);
      expect(await showing(page, c.cards)).toBe(5);
      await expect(more).toBeVisible();
      await expect(more).toHaveText('Click for more');
      let n = 5;
      while (n < c.total) {
        await more.click();
        const first = n;
        n = Math.min(n + 5, c.total);
        expect(await showing(page, c.cards)).toBe(n);
        const inFirstNew = await page.evaluate(
          ({ s, i }) => {
            const card = document.querySelectorAll(s)[i];
            const f = document.activeElement;
            return !!card && !!f && (card === f || card.contains(f));
          },
          { s: c.cards, i: first }
        );
        expect(inFirstNew, `focus on card ${first + 1}`).toBe(true);
      }
      await expect(more).toBeHidden();
      if (!c.testid.startsWith('booth')) {
        await expect(status).toHaveText(new RegExp(`${c.total} of ${c.total}`));
      }
      expect(seen.stray).toEqual([]);
      const writes = await page.evaluate(() => [
        document.cookie,
        localStorage.length,
        sessionStorage.length,
      ]);
      expect(writes).toEqual(['', 0, 0]);
      await ctx.close();
    });

    test(`the button is a ${TARGET_PX} px target and spans the list on a phone`, async ({
      browser,
    }) => {
      const { ctx, page } = await phone(browser);
      await open(page, c);
      const box = (await page.getByTestId(c.testid).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(TARGET_PX);
      const list = (await page.locator(c.cards).first().boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(list.width - 2);
      await ctx.close();
    });

    test('with scripts off every card shows and there is no button', async ({ browser }) => {
      const { ctx, page } = await phone(browser, { js: false });
      await open(page, c);
      expect(await showing(page, c.cards)).toBe(c.total);
      await expect(page.getByTestId(c.testid)).toBeHidden();
      await ctx.close();
    });

    for (const scheme of ['light', 'dark'] as const) {
      test(`${scheme}: no WCAG A or AA violation before and after a tap; 320 px reflow; 2.5.8`, async ({
        browser,
      }) => {
        const { ctx, page } = await phone(browser, { scheme });
        await open(page, c);
        await settleTransitions(page);
        expect(await axeWcag(page)).toEqual([]);
        expect(await targetSize(page)).toEqual([]);
        await page.getByTestId(c.testid).click();
        await settleTransitions(page);
        expect(await axeWcag(page)).toEqual([]);
        await page.setViewportSize({ width: 320, height: 844 });
        expect(await reflow(page)).toEqual([]);
        await ctx.close();
      });
    }
  });
}

// ── mutation: each check must catch a fault put into the real page ──────────
test.describe('mutation: the checks fail on a fault', () => {
  const c = CASES[0]!;

  test('the 44 px check catches a short button', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await open(
      page,
      c,
      '.card-more .btn{min-height:0!important;height:24px!important;padding:0!important}'
    );
    const box = (await page.getByTestId(c.testid).boundingBox())!;
    expect(box.height).toBeLessThan(TARGET_PX);
    await ctx.close();
  });

  test('the phone-width check catches a narrow button', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await open(page, c, '.card-more .btn{width:6rem!important}');
    const box = (await page.getByTestId(c.testid).boundingBox())!;
    const list = (await page.locator(c.cards).first().boundingBox())!;
    expect(box.width).toBeLessThan(list.width - 2);
    await ctx.close();
  });

  test('the five check catches a list that is not held back', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await open(page, c, 'html body [data-paged-out]{display:flex!important}');
    expect(await showing(page, c.cards)).toBeGreaterThan(5);
    await ctx.close();
  });

  test('axe catches a button with too little contrast (color-contrast)', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await open(page, c, '.card-more .btn{color:#bbb!important;background:#fff!important}');
    await settleTransitions(page);
    expect((await axeWcag(page)).join(' ')).toMatch(/color-contrast/);
    await ctx.close();
  });

  test('1.4.10 catches a button wider than 320 px', async ({ browser }) => {
    const { ctx, page } = await phone(browser, { width: 320 });
    await open(page, c, '.card-more .btn{min-width:600px!important}');
    expect(await reflow(page)).not.toEqual([]);
    await ctx.close();
  });
});
