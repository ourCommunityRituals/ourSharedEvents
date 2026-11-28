/**
 * The icon slider on the landing (OSE-2207; owner, 2026-11-22: "visual
 * categories slider option by icon", one component for the whole application),
 * against WCAG 2.0, 2.1 and 2.2, levels A and AA, and against what it is for.
 *
 * The page is the landing as the Worker renders it over a synthetic street map
 * (tests/e2e/helpers/render-landing-map.ts), with every one of the 15 event
 * categories present, so on a phone the row is wider than the screen and the
 * arrows show. Phone first: 320 px (400% zoom), 375 px, then 820 and 1280 px,
 * light and dark.
 *
 *   - axe (every WCAG A/AA rule), 2.5.8 target size, 3.1.1 language, 1.4.10
 *     reflow at 320 px, 1.4.12 text spacing;
 *   - each item is at least 44 px and its name at least 16 px; the icons differ;
 *   - a tap on an item shows only that category's cards; All brings them back;
 *   - the arrows show only when the row is wider than the screen, step it along,
 *     and are disabled at each end; a swipe (a scroll) works with no script;
 *   - by keyboard: the radios take arrow keys, the chosen label scrolls into view
 *     and has a 3 px ring (2.1.1, 2.4.7, 2.4.11), and the track is a stop of its own;
 *   - right to left, the row starts at the right and "more" goes left;
 *   - the slider asks for nothing and keeps nothing (no request, cookie, storage).
 *
 * The "mutation" block injects one fault per check into the real page and
 * requires that check to report it.
 *
 * Mandatory in the T0 Gate (component) step and in the "WCAG audit" workflow;
 * on call with `npm run test:wcag`.
 *
 * Born red (2026-11-22, Chromium): run before the track was given tabindex=0,
 * axe reported scrollable-region-focusable (2.1.1) at every width; with the
 * tick (::before) removed from the chosen item, the tap test's "not by colour
 * alone" check failed; with the script's end test exact to 1 px, the snap left
 * the row 2 px off its start and "Show earlier choices" stayed enabled there.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { ORIGIN, fakeCatalogDb, renderLanding, uiCss } from '../helpers/render-landing-map';
import {
  axeWcag,
  focusWalk,
  pageLanguage,
  reflow,
  settleTransitions,
  targetSize,
  textSpacing,
} from '../helpers/wcag';

const TARGET_PX = 44;
const BLUE_ISLAND = latLngToCell(41.6573, -87.6806, 7);
const BEVERLY = latLngToCell(41.7135, -87.6812, 7);

const CATS: [string, string, number][] = [
  ['REC', 'Sports & Recreation', 10],
  ['SOC', 'Social & Community Dining', 20],
  ['ENT', 'Entertainment & Trivia', 30],
  ['PER', 'Performing Arts & Open Mic', 40],
  ['ART', 'Arts, Culture & Live Music', 50],
  ['TAB', 'Tabletop & Board Games', 60],
  ['MKT', 'Neighborhood Markets', 70],
  ['BIZ', 'Business & Networking', 80],
  ['FND', 'Fundraisers', 90],
  ['VOL', 'Volunteer & Mutual Aid', 100],
  ['CIV', 'Civic & Neighborhood', 110],
  ['GAR', 'Gardening & Outdoor', 120],
  ['FIT', 'Fitness & Running', 130],
  ['LIT', 'Literary & Book Clubs', 140],
  ['FAI', 'Faith Community', 150],
];
const typeId = (code: string) => `etr-${code.toLowerCase()}-one`;
const DB = fakeCatalogDb(
  CATS.map(([category_code, display_name, display_order]) => ({
    category_code,
    display_name,
    display_order,
  })),
  CATS.map(([code, name]) => ({
    id: typeId(code),
    uec_code: `${code}-ONE-001`,
    name: `${name} night`,
    category_code: code,
  }))
);

type Row = Record<string, unknown>;
/** One event per category, alternating between two areas, so the map has two. */
function rows(): Row[] {
  return CATS.map(([code], i) => {
    const cell = i % 2 ? BEVERLY : BLUE_ISLAND;
    const [lat, lon] = cellToLatLng(cell);
    const d = new Date(Date.now() + (2 + i) * 86_400_000).toISOString().slice(0, 10);
    return {
      id: `evt_s${String(i + 1).padStart(2, '0')}`,
      slug: `slider-${i + 1}`,
      title: `Slider Event ${i + 1}`,
      status: 'active',
      is_published: 1,
      timezone: 'America/Chicago',
      location: 'Rock Island Public House',
      where_address: '13328 Olde Western Ave, Blue Island, IL 60406',
      template_id: 'bar_night',
      event_type_id: typeId(code),
      cover_image_url: null,
      start_date: d,
      end_date: d,
      starts_at: `${d}T23:00:00Z`,
      lat,
      lon,
      h3_res7: cell,
      place_kind: 'business',
    };
  });
}

let HTML = '';
let CSS = '';
test.beforeAll(async () => {
  HTML = await renderLanding('/', rows(), { streets: true, env: { DB } });
  CSS = await uiCss();
});

/** Serve the page and /ui.css over https; abort and count anything else. */
async function open(page: Page, html = HTML): Promise<string[]> {
  const origin = ORIGIN.replace(/^http:/, 'https:');
  const asked: string[] = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    asked.push(u.href);
    if (u.origin !== origin) return route.abort();
    if (u.pathname === '/ui.css')
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: CSS });
    if (u.pathname === '/')
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    return route.fulfill({ status: 404, body: '' });
  });
  const res = await page.goto(`${origin}/`, { waitUntil: 'load' });
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('toggle-type')).toBeVisible();
  return asked;
}

async function ctx(browser: Browser, width: number, scheme: 'light' | 'dark' = 'light', js = true) {
  return browser.newContext({
    viewport: { width, height: 812 },
    colorScheme: scheme,
    javaScriptEnabled: js,
  });
}

const slider = (p: Page) => p.getByTestId('toggle-type');
const track = (p: Page) => slider(p).locator('.icon-slider-track');
const shownCards = (p: Page) =>
  p
    .locator('article.event-card')
    .evaluateAll((els) =>
      els
        .filter((e) => getComputedStyle(e).display !== 'none')
        .map((e) => String(e.getAttribute('class')))
    );
/** Show every card the pager holds back ("Click for more"), so filters are judged on all. */
async function allCards(p: Page) {
  const more = p.getByTestId('area-more');
  while (await more.isVisible()) await more.click();
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [320, 375, 820, 1280]) {
    test(`${width} px, ${scheme}: no WCAG 2.0/2.1/2.2 A or AA failure, with a category chosen`, async ({
      browser,
    }) => {
      const c = await ctx(browser, width, scheme);
      const page = await c.newPage();
      await open(page);
      expect(await axeWcag(page), 'axe, as loaded').toEqual([]);
      expect(await targetSize(page), '2.5.8 Target Size (Minimum)').toEqual([]);
      expect(await pageLanguage(page), '3.1.1 Language of Page').toEqual([]);
      if (width === 320) expect(await reflow(page), '1.4.10 Reflow').toEqual([]);
      await slider(page).getByText('Neighborhood Markets').click();
      await settleTransitions(page);
      expect(await axeWcag(page), 'axe, one category chosen').toEqual([]);
      await c.close();
    });
  }
}

test('320 px: 1.4.12 Text Spacing keeps every word and nothing scrolls sideways', async ({
  browser,
}) => {
  const c = await ctx(browser, 320);
  const page = await c.newPage();
  await open(page);
  // The map's numbered list is kept in the page but drawn 1 px wide on purpose
  // (owner, 2026-11-21: lib/map-list-style.ts), so it always reads as "cut off"
  // here; it is not this component and wcag-map.component.spec.ts judges the map.
  // Every other text on the page, the slider's included, must keep every word.
  const spacing = (await textSpacing(page)).filter((p) => !p.includes('amap-legend'));
  expect(spacing, '1.4.12 Text Spacing').toEqual([]);
  expect(await reflow(page), '1.4.10 Reflow').toEqual([]);
  await c.close();
});

for (const width of [320, 375, 1280]) {
  test(`${width} px: every item a 44 px target with 16 px text, its own icon, All first`, async ({
    browser,
  }) => {
    const c = await ctx(browser, width);
    const page = await c.newPage();
    await open(page);
    const items = slider(page).locator('.icon-slider-item');
    await expect(items).toHaveCount(CATS.length + 1);
    await expect(items.first()).toHaveText('All types');
    const facts = await items.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const t = e.querySelector('.icon-slider-text')!;
        return {
          w: r.width,
          h: r.height,
          font: parseFloat(getComputedStyle(t).fontSize),
          icon: e.querySelector('svg')!.innerHTML,
          iconW: e.querySelector('svg')!.getBoundingClientRect().width,
        };
      })
    );
    for (const f of facts) {
      expect(Math.round(f.h)).toBeGreaterThanOrEqual(TARGET_PX);
      expect(Math.round(f.w)).toBeGreaterThanOrEqual(TARGET_PX);
      expect(f.font).toBeGreaterThanOrEqual(16);
      expect(f.iconW).toBeGreaterThanOrEqual(30);
    }
    expect(new Set(facts.map((f) => f.icon)).size, 'one drawing per item').toBe(facts.length);
    await c.close();
  });
}

test('375 px: a tap shows only that category, with a tick; All brings every card back', async ({
  browser,
}) => {
  const c = await ctx(browser, 375);
  const page = await c.newPage();
  await open(page);
  await allCards(page);
  expect(await shownCards(page)).toHaveLength(CATS.length);
  await slider(page).getByText('Literary & Book Clubs').click();
  await expect(page.locator('#cat-lit')).toBeChecked();
  const shown = await shownCards(page);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toContain('cat-lit');
  // Chosen is said by a tick as well as by colour (1.4.1).
  const tick = await slider(page)
    .locator('label[for="cat-lit"] .icon-slider-text')
    .evaluate((e) => getComputedStyle(e, '::before').content);
  expect(tick).toContain('✓');
  const unpicked = await slider(page)
    .locator('label[for="cat-rec"] .icon-slider-text')
    .evaluate((e) => getComputedStyle(e, '::before').content);
  expect(unpicked).toBe('none');
  await slider(page).getByText('All types').click();
  await allCards(page);
  expect(await shownCards(page)).toHaveLength(CATS.length);
  await c.close();
});

test('375 px: the arrows step the row along and stop at each end', async ({ browser }) => {
  const c = await ctx(browser, 375);
  const page = await c.newPage();
  await open(page);
  const prev = page.locator('[data-testid="toggle-type"] .icon-slider-arrow[data-step="-1"]');
  const next = page.locator('[data-testid="toggle-type"] .icon-slider-arrow[data-step="1"]');
  await expect(next).toBeVisible();
  await expect(prev).toBeDisabled();
  for (const b of [prev, next]) {
    const box = (await b.boundingBox())!;
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(TARGET_PX);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(TARGET_PX);
  }
  // At its end an arrow is hidden as well as disabled, so its name is read once it shows.
  await expect(prev).toBeHidden();
  await expect(next).toHaveAccessibleName('Show more choices');
  await next.click();
  await expect.poll(() => track(page).evaluate((t) => t.scrollLeft)).toBeGreaterThan(100);
  await expect(prev).toBeEnabled();
  await expect(prev).toHaveAccessibleName('Show earlier choices');
  for (let i = 0; i < 12 && (await next.isEnabled()); i++) {
    await next.click();
    await page.waitForTimeout(400);
  }
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(next).toBeEnabled();
  await c.close();
});

test('1280 px: the arrows show only when the row is wider than the screen', async ({ browser }) => {
  const c = await ctx(browser, 1280);
  const page = await c.newPage();
  await open(page);
  const wider = await track(page).evaluate((t) => t.scrollWidth > t.clientWidth + 1);
  await expect(
    page.locator('[data-testid="toggle-type"] .icon-slider-arrow[data-step="1"]')
  ).toBeVisible({ visible: wider });
  await c.close();
});

test('375 px, scripts off: the row still scrolls with a swipe, the items still filter, no arrows', async ({
  browser,
}) => {
  const c = await ctx(browser, 375, 'light', false);
  const page = await c.newPage();
  await open(page);
  await expect(
    page.locator('[data-testid="toggle-type"] .icon-slider-arrow[data-step="1"]')
  ).toBeHidden();
  await track(page).evaluate((t) => t.scrollBy({ left: 400 }));
  expect(await track(page).evaluate((t) => t.scrollLeft)).toBeGreaterThan(0);
  await slider(page).getByText('Faith Community').click();
  await expect(page.locator('#cat-fai')).toBeChecked();
  const shown = await shownCards(page);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toContain('cat-fai');
  await c.close();
});

for (const width of [375, 1280]) {
  test(`${width} px: by keyboard, arrow keys choose, the choice scrolls into view with a 3 px ring`, async ({
    browser,
  }) => {
    const c = await ctx(browser, width);
    const page = await c.newPage();
    await open(page);
    const { problems, stops } = await focusWalk(page);
    expect(problems, `stops: ${stops.join(', ')}`).toEqual([]);
    await page.locator('#type-all').focus();
    for (let i = 0; i < CATS.length; i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('#cat-fai')).toBeChecked();
    await expect(page.locator('#cat-fai')).toBeFocused();
    // The row glides to the choice. Let it arrive before stepping out and back,
    // so the Tab below does not land in the middle of that glide.
    const label = slider(page).locator('label[for="cat-fai"]');
    await expect(label).toBeInViewport({ ratio: 0.9 });
    // WebKit drops :focus-visible after a script focus() even when arrow keys
    // follow, so step out and back in by keyboard: Shift+Tab returns to the
    // chosen radio, as a keyboard user would come back to it.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#cat-fai')).toBeFocused();
    await expect(label).toBeInViewport({ ratio: 0.9 });
    const ring = await label.evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.outlineStyle, parseFloat(cs.outlineWidth)] as const;
    });
    expect(ring[0]).toBe('solid');
    expect(ring[1]).toBeGreaterThanOrEqual(3);
    // The track is a stop of its own (the labels take no focus), with a ring.
    await track(page).focus();
    const trackRing = await track(page).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(trackRing).toBe('solid');
    await c.close();
  });
}

test('right to left: the row starts at the right, and "more" goes left', async ({ browser }) => {
  const c = await ctx(browser, 375);
  const page = await c.newPage();
  await open(page, HTML.replace(/<html lang="en" dir="ltr"/, '<html lang="ar" dir="rtl"'));
  const first = await slider(page).locator('label[for="type-all"]').boundingBox();
  const second = await slider(page).locator('.icon-slider-item').nth(1).boundingBox();
  expect(first!.x).toBeGreaterThan(second!.x);
  await page.locator('[data-testid="toggle-type"] .icon-slider-arrow[data-step="1"]').click();
  await expect.poll(() => track(page).evaluate((t) => t.scrollLeft)).toBeLessThan(-100);
  await c.close();
});

test('the slider asks for nothing and keeps nothing', async ({ browser }) => {
  const c = await ctx(browser, 375);
  const page = await c.newPage();
  const asked = await open(page);
  const before = asked.length;
  await page.locator('[data-testid="toggle-type"] .icon-slider-arrow[data-step="1"]').click();
  await slider(page).getByText('Fundraisers').click();
  await page.locator('#cat-fnd').focus();
  await page.waitForTimeout(300);
  // The cards a filter brings into view may load the page's own default
  // thumbnail; nothing else may be asked for, and nothing carries the choice.
  const after = asked.slice(before);
  expect(after.filter((u) => !/\/event-default-thumb\.svg$/.test(u))).toEqual([]);
  for (const u of after) expect(u).not.toMatch(/cat-|type=|\?/);
  expect(await c.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(page.url()).not.toContain('cat-');
  await c.close();
});

// ── mutation: each check must catch a fault put into the real page ──────────
test.describe('mutation: every check fails on a fault', () => {
  async function fresh(browser: Browser, width = 375) {
    const c = await ctx(browser, width);
    const page = await c.newPage();
    await open(page);
    return { c, page };
  }

  test('axe catches an arrow with no name (4.1.2 button-name)', async ({ browser }) => {
    const { c, page } = await fresh(browser);
    await page
      .locator('[data-testid="toggle-type"] .icon-slider-arrow[data-step="1"]')
      .evaluate((b) => b.removeAttribute('aria-label'));
    const found = await axeWcag(page);
    expect(
      found.some((l) => l.startsWith('button-name ')),
      found.join('\n')
    ).toBe(true);
    await c.close();
  });

  test('axe catches a track that the keyboard cannot reach (2.1.1 scrollable-region-focusable)', async ({
    browser,
  }) => {
    const { c, page } = await fresh(browser);
    await track(page).evaluate((t) => t.removeAttribute('tabindex'));
    const found = await axeWcag(page);
    expect(
      found.some((l) => l.startsWith('scrollable-region-focusable ')),
      found.join('\n')
    ).toBe(true);
    await c.close();
  });

  test('axe catches a pale item name (1.4.3 color-contrast)', async ({ browser }) => {
    const { c, page } = await fresh(browser);
    await page.addStyleTag({
      content:
        '.icon-slider-item{color:rgb(205,205,205)!important;background:rgb(255,255,255)!important}',
    });
    const found = await axeWcag(page);
    expect(
      found.some((l) => l.startsWith('color-contrast') && l.includes('icon-slider')),
      found.join('\n')
    ).toBe(true);
    await c.close();
  });

  test('the target check catches an item shrunk under 24 px (2.5.8)', async ({ browser }) => {
    const { c, page } = await fresh(browser);
    await page.addStyleTag({
      content:
        '.icon-slider-item{width:18px!important;min-height:0!important;height:18px!important;padding:0!important;overflow:hidden;gap:0!important}.icon-slider-track{gap:0!important}',
    });
    expect((await targetSize(page)).length).toBeGreaterThan(0);
    await c.close();
  });

  test('the focus walk catches a ring taken off the chosen item (2.4.7)', async ({ browser }) => {
    const { c, page } = await fresh(browser);
    await page.addStyleTag({
      content:
        '.icon-slider label,.icon-slider-track{outline:none!important;box-shadow:none!important}',
    });
    const { problems } = await focusWalk(page);
    expect(problems.length).toBeGreaterThan(0);
    await c.close();
  });

  test('the reflow check catches a row that pushes the page sideways (1.4.10)', async ({
    browser,
  }) => {
    const { c, page } = await fresh(browser, 320);
    await page.addStyleTag({ content: '.icon-slider-track{overflow:visible!important}' });
    expect((await reflow(page)).length).toBeGreaterThan(0);
    await c.close();
  });
});
