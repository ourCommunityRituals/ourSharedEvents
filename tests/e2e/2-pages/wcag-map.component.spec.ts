/**
 * The attendee map against WCAG 2.0, 2.1 and 2.2, levels A and AA (owner,
 * 2026-11-18: "a full accessibility audit … WCAG 2.0 and 2.2", then "playwright
 * automation test mutation tests dedicated to the WCAG 2.0 and 2.2
 * Accessibility standards … for on call and future mandatory execution").
 *
 * The page is the landing as the Worker renders it over the street map
 * (tests/e2e/helpers/render-landing-map.ts): the whole map, one area zoomed in,
 * and an open place panel, at 320 (400% zoom), 375 (phone), 820 (tablet) and
 * 1280 px, light and dark, as loaded, zoomed in twice by its + button, and after
 * "Show where I am". Phone first: the phone widths run every state.
 *
 * Mandatory: listed in the T0 Gate (component) step of oursharedevents-ci.yml,
 * a required check on every PR. On call: `npm run test:wcag` anywhere, or the
 * "WCAG audit" workflow (Run workflow) on any branch.
 *
 * The checks live in tests/e2e/helpers/wcag.ts. The "mutation" describe at the
 * end injects one fault per check into the real page and requires that check to
 * report it, every run, so a check that cannot fail fails the build.
 *
 * Born red (2026-11-18, before the fixes in the same change):
 *   - axe `label` (4.1.2, critical) at every width: the folded filter radios
 *     and the Filters checkbox were in the tab order with their labels hidden;
 *     the focus walk found the same three stops with nothing on screen (2.4.7).
 *   - axe `label-content-name-mismatch` (2.5.3, serious): "Open event" was named
 *     "Open <event> public page" (OSE-2070).
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { ORIGIN, renderLanding, uiCss } from '../helpers/render-landing-map';
import { axeWcag, focusWalk, pageLanguage, reflow, targetSize, textSpacing } from '../helpers/wcag';

const BLUE_ISLAND = latLngToCell(41.6573, -87.6806, 7);
const BEVERLY = latLngToCell(41.7135, -87.6812, 7);
const AREA = `/?area=${BLUE_ISLAND}`;

type Row = Record<string, unknown>;
function ev(n: number, over: Row): Row {
  const d = new Date(Date.now() + (2 + n) * 86_400_000).toISOString().slice(0, 10);
  return {
    id: `evt_w${String(n).padStart(2, '0')}`,
    slug: `wcag-${n}`,
    title: `Trivia Night ${n}`,
    status: 'active',
    is_published: 1,
    timezone: 'America/Chicago',
    location: 'Rock Island Public House',
    where_address: '13328 Olde Western Ave, Blue Island, IL 60406',
    template_id: 'bar_night',
    event_type_id: 'etr-ent-trivia',
    cover_image_url: null,
    start_date: d,
    end_date: d,
    starts_at: `${d}T23:00:00Z`,
    ...over,
  };
}
/** Six events in each of two areas, so the landing leads with a map of two areas. */
const rows = (): Row[] =>
  [BLUE_ISLAND, BEVERLY].flatMap((cell, a) => {
    const [lat, lon] = cellToLatLng(cell);
    return [1, 2, 3, 4, 5, 6].map((n) =>
      ev(a * 6 + n, { lat, lon, h3_res7: cell, place_kind: 'business' })
    );
  });

/** Serve the page and /ui.css over https (location needs a secure page); abort anything else. */
async function open(page: Page, path: string): Promise<void> {
  const origin = ORIGIN.replace(/^http:/, 'https:');
  const [p, hash] = path.split('#') as [string, string | undefined];
  const html = await renderLanding(p, rows());
  const css = await uiCss();
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort();
    if (u.pathname === '/ui.css')
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    if (u.pathname === '/')
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    return route.fulfill({ status: 404, body: '' });
  });
  const res = await page.goto(`${origin}${p}${hash ? `#${hash}` : ''}`, { waitUntil: 'load' });
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('amap-streets')).toHaveCount(1);
}

type Step = 'load' | 'zoomed' | 'located';
async function context(
  browser: Browser,
  width: number,
  height: number,
  scheme: 'light' | 'dark',
  step: Step
) {
  const [lat, lon] = cellToLatLng(BLUE_ISLAND);
  return browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    ...(step === 'located'
      ? {
          geolocation: { latitude: lat + 0.004, longitude: lon + 0.004 },
          permissions: ['geolocation'],
        }
      : {}),
  });
}
async function reach(page: Page, step: Step): Promise<void> {
  if (step === 'zoomed') {
    await page.getByTestId('amap-in').click();
    await page.getByTestId('amap-in').click();
  }
  if (step === 'located') await expect(page.getByTestId('amap-you')).toHaveCount(1);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
}

const PAGES = [
  ['whole map', '/'],
  ['one area', AREA],
  ['a place panel', `${AREA}#amap-dot-1`],
] as const;

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [320, 375, 820, 1280]) {
    const phone = width < 600;
    for (const [what, path] of PAGES) {
      for (const step of ['load', 'zoomed', 'located'] as const) {
        if (step !== 'load' && !phone) continue;
        test(`${what}, ${width} px, ${scheme}, ${step}: no WCAG 2.0/2.1/2.2 A or AA failure`, async ({
          browser,
        }) => {
          const ctx = await context(browser, width, 812, scheme, step);
          const page = await ctx.newPage();
          await open(page, path);
          await reach(page, step);
          expect(await axeWcag(page), 'axe, every WCAG A/AA rule').toEqual([]);
          expect(await targetSize(page), '2.5.8 Target Size (Minimum)').toEqual([]);
          expect(await pageLanguage(page), '3.1.1 Language of Page').toEqual([]);
          if (width === 320) expect(await reflow(page), '1.4.10 Reflow').toEqual([]);
          await ctx.close();
        });
      }
    }
  }
}

for (const [label, width, height] of [
  ['phone, 1.4.10 at 400%', 320, 640],
  ['phone on its side, 1.3.4 Orientation', 812, 375],
  ['1.4.4 Resize Text, 200% of 1280', 640, 400],
] as const) {
  test(`${label}: 1.4.12 Text Spacing keeps every word, nothing scrolls sideways`, async ({
    browser,
  }) => {
    const ctx = await context(browser, width, height, 'light', 'load');
    const page = await ctx.newPage();
    await open(page, `${AREA}#amap-dot-1`);
    expect(await reflow(page), '1.4.10 Reflow').toEqual([]);
    expect(await textSpacing(page), '1.4.12 Text Spacing').toEqual([]);
    await ctx.close();
  });
}

for (const width of [375, 1280]) {
  for (const [what, path] of PAGES.slice(0, 2)) {
    test(`${what}, ${width} px: 2.1.1 every map control by keyboard, 2.4.7 focus visible, 2.4.11 never hidden`, async ({
      browser,
    }) => {
      const ctx = await context(browser, width, 812, 'light', 'load');
      const page = await ctx.newPage();
      await open(page, path);
      const { problems, stops } = await focusWalk(page);
      expect(problems, `stops: ${stops.join(', ')}`).toEqual([]);
      for (const id of ['amap-in', 'amap-me'])
        expect(stops, `${id} is reached by Tab`).toContain(id);
      await ctx.close();
    });
  }
}

test('2.5.7 Dragging Movements: zoom and every area are one tap away, no drag or pinch needed', async ({
  browser,
}) => {
  const ctx = await context(browser, 375, 812, 'light', 'load');
  const page = await ctx.newPage();
  await open(page, '/');
  const before = await page.getByTestId('amap-svg').getAttribute('viewBox');
  await page.getByTestId('amap-in').click();
  expect(await page.getByTestId('amap-svg').getAttribute('viewBox')).not.toBe(before);
  await page.getByTestId('amap-out').click();
  expect(await page.getByTestId('amap-svg').getAttribute('viewBox')).toBe(before);
  // Instead of dragging to an area: each area on the map is a link that opens it.
  const areas = page.getByTestId('amap-area-link');
  expect(await areas.count()).toBe(2);
  for (const h of await areas.evaluateAll((a) => a.map((x) => x.getAttribute('href') ?? '')))
    expect(h).toMatch(/[?&]area=[0-9a-f]{15}/);
  await ctx.close();
});

// ── mutation: each check must catch a fault put into the real page ──────────
test.describe('mutation: every WCAG check fails on a fault', () => {
  async function fresh(browser: Browser, path = `${AREA}#amap-dot-1`, width = 375) {
    const ctx = await context(browser, width, 812, 'light', 'load');
    const page = await ctx.newPage();
    await open(page, path);
    return { ctx, page };
  }

  const AXE_FAULTS: [string, string, (d: Document) => void][] = [
    [
      '4.1.2 a button with no name',
      'button-name',
      (d) => {
        const b = d.querySelector('[data-testid="amap-in"]')!;
        b.textContent = '';
        b.removeAttribute('aria-label');
        b.removeAttribute('title');
      },
    ],
    [
      '2.5.3 a name that does not start with the words shown',
      'label-content-name-mismatch',
      (d) => {
        d.querySelector('[data-testid="amap-open"]')!.setAttribute(
          'aria-label',
          'Go to the public page'
        );
      },
    ],
    [
      '1.4.3 pale grey text on the page',
      'color-contrast',
      (d) => {
        const el = d.querySelector<HTMLElement>('[data-testid="amap-panel"] h2')!;
        el.style.setProperty('color', 'rgb(200, 200, 200)', 'important');
        el.style.setProperty('background', 'rgb(255, 255, 255)', 'important');
      },
    ],
    [
      '4.1.2 a radio whose label is hidden (the filters fold of 2026-11-18)',
      'label',
      (d) => {
        d.getElementById('filters-open')?.after(...d.querySelectorAll('[name="win"]'));
        d.querySelector<HTMLElement>('[data-testid="area-filters"]')!.style.display = 'none';
        for (const r of d.querySelectorAll<HTMLElement>('[name="win"]'))
          r.style.setProperty('display', 'inline', 'important');
      },
    ],
    [
      '1.1.1 an image with no text',
      'image-alt',
      (d) => {
        d.body.insertAdjacentHTML('beforeend', '<img src="/x.png" width="40" height="40">');
      },
    ],
    ['3.1.1 no page language', 'html-has-lang', (d) => d.documentElement.removeAttribute('lang')],
    [
      '2.4.2 no page title',
      'document-title',
      (d) => {
        d.title = '';
        d.querySelector('title')?.remove();
      },
    ],
  ];
  for (const [what, rule, fault] of AXE_FAULTS) {
    test(`axe catches ${what} (${rule})`, async ({ browser }) => {
      const { ctx, page } = await fresh(browser);
      await page.evaluate(`(${fault.toString()})(document)`);
      const found = await axeWcag(page);
      expect(
        found.some((l) => l.startsWith(`${rule} `)),
        found.join('\n')
      ).toBe(true);
      await ctx.close();
    });
  }

  test('2.5.8 catches a 16 px button touching another', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, AREA);
    // With the bar's 8 px gap a 16 px button would pass by the spacing
    // exception, as WCAG allows, so the fault takes the gap away too.
    await page.addStyleTag({
      content:
        '.amap-ctl{gap:0!important}.amap-ctl .btn{margin:0!important;min-width:0!important;min-height:0!important;width:16px!important;height:16px!important;padding:0!important}',
    });
    const found = await targetSize(page);
    expect(
      found.some((l) => l.startsWith('amap-in')),
      found.join('\n')
    ).toBe(true);
    await ctx.close();
  });

  test('1.4.10 catches a page wider than 320 px', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, AREA, 320);
    await page.evaluate(() =>
      document.body.insertAdjacentHTML('beforeend', '<div style="width:900px;height:4px"></div>')
    );
    expect(await reflow(page)).not.toEqual([]);
    await ctx.close();
  });

  test('1.4.12 catches text cut off by a fixed-height box', async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await page.addStyleTag({
      content:
        '[data-testid="amap-panel"] h2{height:1em!important;overflow:hidden!important;display:block}',
    });
    const found = await textSpacing(page);
    expect(
      found.some((l) => l.startsWith('text cut off')),
      found.join('\n')
    ).toBe(true);
    await ctx.close();
  });

  test('2.4.7 catches a focus ring taken away', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, AREA);
    await page.addStyleTag({
      content:
        '*,*:focus,*:focus-visible,*~label{outline:none!important;box-shadow:none!important}',
    });
    const { problems } = await focusWalk(page, 30);
    expect(
      problems.some((l) => l.startsWith('no visible focus')),
      problems.join('\n')
    ).toBe(true);
    await ctx.close();
  });

  test('2.4.7 catches focus on a control whose label is not on screen', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, AREA);
    await page.evaluate(() =>
      document
        .querySelector('[data-testid="amap-ctl"]')!
        .insertAdjacentHTML(
          'afterbegin',
          '<input type="checkbox" id="wcag-mut" class="toggle-radio"><label for="wcag-mut" style="display:none">x</label>'
        )
    );
    const { problems } = await focusWalk(page, 40);
    expect(
      problems.some((l) => l.startsWith('focus on something not on screen')),
      problems.join('\n')
    ).toBe(true);
    await ctx.close();
  });

  test('2.4.11 catches focus hidden under a fixed banner', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, AREA);
    await page.evaluate(() =>
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div style="position:fixed;inset:0;background:#fff;z-index:99"></div>'
      )
    );
    const { problems } = await focusWalk(page, 20);
    expect(
      problems.some((l) => l.startsWith('focus hidden under')),
      problems.join('\n')
    ).toBe(true);
    await ctx.close();
  });

  test('3.1.1 catches a made-up language tag', async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'english please'));
    expect(await pageLanguage(page)).not.toEqual([]);
    await ctx.close();
  });
});
