/**
 * The top menu of the landing and of the map's own address, measured in a real
 * browser (owner, 2026-11-17; part of OSE-1990, testing ticket OSE-2111).
 *
 * The menu holds two links, Events and Map. Beside the name they do not fit a
 * phone, so the header lets the menu wrap onto a row of its own under the name.
 * What only a browser can show is here, at phone, tablet and desktop widths and
 * in each of the four languages:
 *   - the name stays whole, on one line
 *   - each link's words stay on one line, and the two links share one row
 *   - the menu never sits over the name: under it on a small phone, beside it
 *     from tablet width up
 *   - nothing pushes the page sideways
 *   - each link is a 44 px target, inside the screen
 *   - the menu's words line up with the edge the rest of the header keeps
 *   - the row mirrors in Arabic
 *   - on /map the Map link is the heavier of the two, and says it is this page;
 *     on the landing the two links are drawn alike
 *
 * This is the component layer: the T0 `component` shard, against the local
 * Worker that playwright.component.config.ts starts, on Chromium and WebKit.
 * That Worker has no events, which does not matter here: the header is the same
 * page shell. The markup and the mark are proved in the workers pool
 * (workers/oursharedevents/tests/map-page.spec.ts). Staging has the Bruno cases
 * (bruno/ose-pages/1. Landing - Public) and the browser walk in T4i
 * (tests/e2e/3-flows/language-path-prefix.spec.ts).
 *
 * Nothing here is a pixel taken from one machine: the fonts of a runner are not
 * the fonts of a phone. Every check is a relation between boxes on the page.
 */
import { test, expect, type Page } from '@playwright/test';

const LANGS = [
  { lang: 'en', prefix: '', dir: 'ltr', events: 'Events', map: 'Map' },
  { lang: 'es', prefix: '/es', dir: 'ltr', events: 'Eventos', map: 'Mapa' },
  { lang: 'pl', prefix: '/pl', dir: 'ltr', events: 'Wydarzenia', map: 'Mapa' },
  { lang: 'ar', prefix: '/ar', dir: 'rtl', events: 'الفعاليات', map: 'الخريطة' },
] as const;

/** Small phones first, then the widths where the menu has room beside the name. */
const SCREENS = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const;

/** WCAG 2.5.5 and the org floor (brain #14). */
const MIN_TARGET_PX = 44;
/** From this width up every language's menu fits beside the name. */
const ROOM_BESIDE_THE_NAME_PX = 768;
/** At this width no language's menu fits beside the name. */
const NO_ROOM_BESIDE_THE_NAME_PX = 320;

interface Measured {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  /** How many lines the element's words are drawn on. */
  lines: number;
  /** Where the words themselves start and end, inside the element's padding. */
  wordsLeft: number;
  wordsRight: number;
  weight: number;
  color: string;
  current: string | null;
  words: string;
}
interface Header {
  dir: string;
  scrollWidth: number;
  clientWidth: number;
  /** The header's content edges: its box less its padding. */
  edgeLeft: number;
  edgeRight: number;
  logo: Measured;
  logoName: Measured;
  events: Measured;
  map: Measured;
}

async function measure(page: Page): Promise<Header> {
  return page.evaluate(() => {
    const one = (testid: string) => {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      if (!el) throw new Error(`no element with data-testid="${testid}"`);
      const b = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      // One box per run of text; boxes on one line share a top.
      const tops = new Set(Array.from(range.getClientRects(), (r) => Math.round(r.top)));
      const words = range.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: b.left,
        top: b.top,
        right: b.right,
        bottom: b.bottom,
        width: b.width,
        height: b.height,
        lines: tops.size,
        wordsLeft: words.left,
        wordsRight: words.right,
        weight: Number(style.fontWeight),
        color: style.color,
        current: el.getAttribute('aria-current'),
        words: (el.textContent ?? '').trim(),
      };
    };
    const header = document.querySelector('[data-testid="landing-header"]');
    if (!header) throw new Error('no element with data-testid="landing-header"');
    const box = header.getBoundingClientRect();
    const pad = getComputedStyle(header);
    return {
      dir: document.documentElement.dir,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      edgeLeft: box.left + parseFloat(pad.paddingLeft),
      edgeRight: box.right - parseFloat(pad.paddingRight),
      logo: one('landing-logo'),
      logoName: one('landing-logo-name'),
      events: one('nav-events'),
      map: one('nav-map'),
    };
  });
}

/** The layout rules that hold on every page, at every width, in every language. */
function expectMenuFits(m: Header, where: string, rtl: boolean, width: number): void {
  expect(m.scrollWidth, `${where}: nothing pushes the page sideways`).toBeLessThanOrEqual(
    m.clientWidth
  );
  // The name on one line; the translated tagline sits under it (owner 2026-11-28).
  expect(m.logoName.lines, `${where}: the name is whole, on one line`).toBe(1);
  expect(m.events.lines, `${where}: "${m.events.words}" is on one line`).toBe(1);
  expect(m.map.lines, `${where}: "${m.map.words}" is on one line`).toBe(1);

  for (const link of [m.events, m.map]) {
    expect(link.height, `${where}: "${link.words}" is tall enough to tap`).toBeGreaterThanOrEqual(
      MIN_TARGET_PX
    );
    expect(link.width, `${where}: "${link.words}" is wide enough to tap`).toBeGreaterThanOrEqual(
      MIN_TARGET_PX
    );
    expect(link.left, `${where}: "${link.words}" starts on the screen`).toBeGreaterThanOrEqual(0);
    expect(link.right, `${where}: "${link.words}" ends on the screen`).toBeLessThanOrEqual(
      m.clientWidth
    );
  }

  expect(
    Math.abs(m.events.top - m.map.top),
    `${where}: the two links share one row`
  ).toBeLessThanOrEqual(1);

  // Events is read first: on the left, or on the right in a right-to-left page.
  if (rtl) {
    expect(m.events.left, `${where}: Events is read before Map`).toBeGreaterThanOrEqual(
      m.map.right - 1
    );
  } else {
    expect(m.events.right, `${where}: Events is read before Map`).toBeLessThanOrEqual(
      m.map.left + 1
    );
  }

  // The menu is under the name or beside it, never over it.
  const under = m.events.top >= m.logo.bottom - 1;
  const beside = rtl
    ? Math.max(m.events.right, m.map.right) <= m.logo.left + 1
    : Math.min(m.events.left, m.map.left) >= m.logo.right - 1;
  expect(under || beside, `${where}: the menu is not drawn over the name`).toBe(true);
  if (width >= ROOM_BESIDE_THE_NAME_PX) {
    expect(beside && !under, `${where}: with room, the menu is beside the name`).toBe(true);
  }
  if (width <= NO_ROOM_BESIDE_THE_NAME_PX) {
    expect(under, `${where}: on a small phone the menu is under the name`).toBe(true);
  }

  // The menu's words keep the header's own edge: where the row starts when the
  // menu is under the name, where the row ends when it is beside it.
  if (under) {
    const starts = rtl ? m.events.wordsRight : m.events.wordsLeft;
    const edge = rtl ? m.edgeRight : m.edgeLeft;
    expect(
      Math.abs(starts - edge),
      `${where}: under the name, the menu's words start at the header's edge`
    ).toBeLessThanOrEqual(1);
  } else {
    const ends = rtl ? m.map.wordsLeft : m.map.wordsRight;
    const edge = rtl ? m.edgeLeft : m.edgeRight;
    expect(
      Math.abs(ends - edge),
      `${where}: beside the name, the menu's words end at the header's edge`
    ).toBeLessThanOrEqual(1);
  }
}

test.describe('the landing top menu: Events and Map, on a phone and wider', () => {
  for (const l of LANGS) {
    test(`${l.prefix}/map (${l.lang}): the menu fits at every width, and Map is the page being read`, async ({
      page,
    }) => {
      const path = `${l.prefix}/map`;
      const res = await page.goto(path, { waitUntil: 'load' });
      expect(res?.status(), `${path} is served`).toBe(200);

      for (const screen of SCREENS) {
        await page.setViewportSize(screen);
        const m = await measure(page);
        const where = `${path} at ${screen.width} px`;
        expect(m.dir, `${where}: the page direction`).toBe(l.dir);
        expect(m.events.words, where).toBe(l.events);
        expect(m.map.words, where).toBe(l.map);
        expectMenuFits(m, where, l.dir === 'rtl', screen.width);

        // Which page this is, to a screen reader and to the eye, and not by
        // colour alone.
        expect(m.map.current, `${where}: Map says it is this page`).toBe('page');
        expect(m.events.current, `${where}: Events does not`).toBeNull();
        expect(m.map.weight, `${where}: Map is drawn heavy`).toBeGreaterThanOrEqual(700);
        expect(m.events.weight, `${where}: Events is drawn lighter than Map`).toBeLessThan(
          m.map.weight
        );
        expect(
          m.map.color,
          `${where}: Map is in the text colour, Events in the quieter one`
        ).not.toBe(m.events.color);
      }
    });

    test(`${l.prefix}/ (${l.lang}): the menu fits at every width, and neither link is marked`, async ({
      page,
    }) => {
      const path = `${l.prefix}/`;
      const res = await page.goto(path, { waitUntil: 'load' });
      expect(res?.status(), `${path} is served`).toBe(200);

      for (const screen of SCREENS) {
        await page.setViewportSize(screen);
        const m = await measure(page);
        const where = `${path} at ${screen.width} px`;
        expect(m.dir, `${where}: the page direction`).toBe(l.dir);
        expectMenuFits(m, where, l.dir === 'rtl', screen.width);

        expect(m.events.current, `${where}: Events is not marked`).toBeNull();
        expect(m.map.current, `${where}: Map is not marked`).toBeNull();
        expect(m.map.weight, `${where}: the two links are drawn alike`).toBe(m.events.weight);
        expect(m.map.color, `${where}: the two links are drawn alike`).toBe(m.events.color);
      }
    });
  }

  // The local Worker has no events, so the page has no list and map switch to
  // read here. That /map opens on its map view is proved where there are
  // events: the workers pool, and staging (Bruno and T4i).
  test('on a phone, a tap on Map opens /map with Map marked, and the name leads back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/', { waitUntil: 'load' });
    await page.locator('[data-testid="nav-map"]').click();
    await page.waitForURL((url) => url.pathname === '/map');
    await expect(page.locator('html')).toHaveAttribute('data-surface', 'ose-landing');
    await expect(page.locator('[data-testid="nav-map"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('h1')).toHaveCount(1);

    await page.locator('[data-testid="landing-logo"]').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.locator('[data-testid="nav-map"]')).not.toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
