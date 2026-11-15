/**
 * The street map's dots and its text, measured on screen, at the COMPONENT level
 * (street-map CCR 2026-11-15, findings R24 and R38).
 *
 * The map is one SVG drawn 600 units wide and scaled to the page, so everything
 * in it shrinks with the screen. Two things on it have a floor that is counted
 * in screen pixels, not map units:
 *   - a dot's touch target: 44 px (AGENTS.md invariant 8);
 *   - text: 13 px (the design system's floor: "nothing below 13px").
 * Both were under their floor on a small phone, and neither is live on staging:
 * dots and town names are drawn only over a street layer, and staging has no
 * street-map archive. So this is the layer that can see them.
 *
 * The page is the real landing handler over a synthetic archive
 * (tests/e2e/helpers/render-landing-map.ts), served to a real browser from page
 * routes: no Worker, no D1, no R2. The archive proves sizes and layout only.
 *
 * Two pages, each at 320 and 375 px, light and dark, on Chromium and WebKit:
 *   - the zoomed area (`/?area=`): every dot's target, every dot number, every
 *     town name, the whole hexagon on screen, no sideways scroll;
 *   - the landing's own map (`/`): every area number and every town name, no
 *     sideways scroll.
 * And once at a desktop width, so a rule written for phones cannot pass by
 * breaking the wide map.
 *
 * It runs in the T0 `component` shard (playwright.component.config.ts). That
 * config starts a local Worker for the other specs of the shard; this one never
 * asks it for anything: every request goes to ORIGIN and is answered by the
 * routes, and anything else is aborted.
 */
import { test, expect, type Page } from '@playwright/test';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { ORIGIN, renderLanding, uiCss } from '../helpers/render-landing-map';

/** Touch target floor, in CSS px (AGENTS.md invariant 8). */
const TARGET_PX = 44;
/** Text floor, in CSS px (design system README: "nothing below 13px"). */
const TEXT_PX = 13;

const BLUE_ISLAND = latLngToCell(41.6573, -87.6806, 7);
const BEVERLY = latLngToCell(41.7135, -87.6812, 7);

type Row = Record<string, unknown>;

/** A date `days` from today, as the events table holds it. */
function dayFrom(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function ev(n: number, over: Row): Row {
  const d = dayFrom(2 + n);
  return {
    id: `evt_c${String(n).padStart(2, '0')}`,
    slug: `component-${n}`,
    title: `Component Event ${n}`,
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

/**
 * Five places in one area, far enough apart to stay five dots: the area's
 * centre and four points round it. Two are businesses (solid dots); three are
 * not (pale dots). And six events in a second area, so the landing leads with
 * its map and draws two numbered areas.
 */
function rows(): Row[] {
  const [lat, lon] = cellToLatLng(BLUE_ISLAND);
  const at = (dLat: number, dLon: number, place_kind: string) => ({
    lat: lat + dLat,
    lon: lon + dLon,
    h3_res7: BLUE_ISLAND,
    place_kind,
  });
  const [bLat, bLon] = cellToLatLng(BEVERLY);
  const beverly = { lat: bLat, lon: bLon, h3_res7: BEVERLY, place_kind: 'business' };
  return [
    ev(1, at(0, 0, 'business')),
    ev(2, at(0.007, 0, 'address')),
    ev(3, at(-0.007, 0, 'address')),
    ev(4, at(0, 0.01, 'business')),
    ev(5, at(0, -0.01, 'address')),
    ev(6, at(0, 0, 'business')),
    ...[7, 8, 9, 10, 11, 12].map((n) => ev(n, beverly)),
  ];
}

const ZOOMED = `/?area=${BLUE_ISLAND}`;

/** Serve the rendered page and /ui.css from ORIGIN; abort everything else. */
async function open(page: Page, path: string): Promise<void> {
  const html = await renderLanding(path, rows());
  const css = await uiCss();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/' || url.pathname === '') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    if (url.pathname === '/ui.css') {
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const res = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'load' });
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('amap-streets')).toHaveCount(1);
  // /ui.css really applied: the tokens are defined on the page.
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  );
  expect(accent, '--accent from /ui.css').not.toBe('');
}

interface Measured {
  /** The map's box on screen. */
  map: { width: number; height: number };
  /** Screen px to one map unit. */
  scale: number;
  /** Every text drawn on the map: what it is, what it says, its size on screen. */
  texts: { kind: string; text: string; px: number; shown: boolean }[];
  /** Every dot: its target's size on screen, and whether a tap near its edge lands on it. */
  dots: { n: string; width: number; height: number; inside: boolean; tappable: boolean }[];
  /** The area's outline, wholly on screen or not. */
  zoneInside: boolean | null;
  /** The page is wider than the screen. */
  sideways: boolean;
}

/** Everything the floors are about, read from the live page. */
async function measure(page: Page): Promise<Measured> {
  return page.evaluate((target) => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="amap-svg"]')!;
    const box = svg.getBoundingClientRect();
    const scale = svg.getScreenCTM()!.a;
    const within = (r: DOMRect) =>
      r.left >= box.left - 0.5 &&
      r.right <= box.right + 0.5 &&
      r.top >= box.top - 0.5 &&
      r.bottom <= box.bottom + 0.5;
    const kindOf = (el: Element) =>
      el.closest('.as-t')
        ? 'town name'
        : el.closest('.amap-dn')
          ? 'dot number'
          : el.closest('.amap-num')
            ? 'area number'
            : 'other';
    const texts = [...svg.querySelectorAll('text')].map((el) => {
      const r = el.getBoundingClientRect();
      const mid = [r.left + r.width / 2, r.top + r.height / 2] as const;
      return {
        kind: kindOf(el),
        text: (el.textContent ?? '').trim(),
        px: parseFloat(getComputedStyle(el).fontSize) * scale,
        // A name the frame cuts off is not read, so it is not held to the floor.
        shown: mid[0] > box.left && mid[0] < box.right && mid[1] > box.top && mid[1] < box.bottom,
      };
    });
    const dots = [...svg.querySelectorAll<SVGAElement>('[data-testid="amap-dot"]')].map((a) => {
      const hit = a.querySelector('.amap-hit')!.getBoundingClientRect();
      const cx = hit.left + hit.width / 2;
      const cy = hit.top + hit.height / 2;
      // Just inside the floor's edge, on four sides: the tap must reach this dot.
      const reach = target / 2 - 1;
      const tappable = [
        [cx - reach, cy],
        [cx + reach, cy],
        [cx, cy - reach],
        [cx, cy + reach],
      ].every(([x, y]) => document.elementFromPoint(x!, y!)?.closest('a') === a);
      return {
        n: a.querySelector('.amap-dn')?.textContent ?? '',
        width: hit.width,
        height: hit.height,
        inside: within(hit),
        tappable,
      };
    });
    const zone = svg.querySelector('[data-testid="amap-zone"]');
    return {
      map: { width: box.width, height: box.height },
      scale,
      texts,
      dots,
      zoneInside: zone ? within(zone.getBoundingClientRect()) : null,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  }, TARGET_PX);
}

const round = (n: number) => Math.round(n * 10) / 10;

/** One line for the report: what was measured, so a pass says how much room it had. */
function record(where: string, m: Measured): void {
  const by = (kind: string) => m.texts.filter((t) => t.kind === kind && t.shown).map((t) => t.px);
  const span = (v: number[]) => (v.length ? `${round(Math.min(...v))} px` : 'none');
  test.info().annotations.push({
    type: 'street-map-sizes',
    description:
      `${where}: map ${round(m.map.width)} x ${round(m.map.height)} px; ` +
      `dot target ${span(m.dots.map((d) => Math.min(d.width, d.height)))}; ` +
      `dot number ${span(by('dot number'))}; town name ${span(by('town name'))}; ` +
      `area number ${span(by('area number'))}`,
  });
}

const PHONES = [
  { name: '320 px', width: 320, height: 568 },
  { name: '375 px', width: 375, height: 812 },
];
const THEMES = ['light', 'dark'] as const;

for (const screen of PHONES) {
  for (const scheme of THEMES) {
    const where = `${screen.name}, ${scheme}`;

    test(`zoomed area, ${where}: every dot is a 44 px target and every text on the map is 13 px or more`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, ZOOMED);
      await page.getByTestId('amap-svg').scrollIntoViewIfNeeded();
      const m = await measure(page);
      record(`zoomed area, ${where}`, m);

      expect(m.sideways, 'the page does not scroll sideways').toBe(false);
      expect(m.zoneInside, "the area's outline is wholly on screen").toBe(true);
      expect(m.dots.length, 'the five places are five dots').toBe(5);
      for (const d of m.dots) {
        expect(round(d.width), `dot ${d.n}: target width`).toBeGreaterThanOrEqual(TARGET_PX);
        expect(round(d.height), `dot ${d.n}: target height`).toBeGreaterThanOrEqual(TARGET_PX);
        expect(d.inside, `dot ${d.n}: its whole target is on the map`).toBe(true);
        expect(d.tappable, `dot ${d.n}: a tap 21 px from its centre reaches it`).toBe(true);
      }
      const numbers = m.texts.filter((t) => t.kind === 'dot number');
      expect(numbers.length, 'a number on every dot').toBe(5);
      const names = m.texts.filter((t) => t.kind === 'town name' && t.shown);
      expect(names.length, 'at least one town name is drawn').toBeGreaterThan(0);
      for (const t of [...numbers, ...names]) {
        expect(round(t.px), `${t.kind} "${t.text}"`).toBeGreaterThanOrEqual(TEXT_PX);
      }
      expect(
        m.texts.filter((t) => t.kind === 'other'),
        'no text on the map this check does not know'
      ).toEqual([]);
    });

    test(`landing map, ${where}: every area number and town name is 13 px or more`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, '/');
      await page.getByTestId('amap-svg').scrollIntoViewIfNeeded();
      const m = await measure(page);
      record(`landing map, ${where}`, m);

      expect(m.sideways, 'the page does not scroll sideways').toBe(false);
      const numbers = m.texts.filter((t) => t.kind === 'area number');
      expect(numbers.length, 'two numbered areas').toBe(2);
      const names = m.texts.filter((t) => t.kind === 'town name' && t.shown);
      expect(names.length, 'at least one town name is drawn').toBeGreaterThan(0);
      for (const t of [...numbers, ...names]) {
        expect(round(t.px), `${t.kind} "${t.text}"`).toBeGreaterThanOrEqual(TEXT_PX);
      }
      expect(
        m.texts.filter((t) => t.kind === 'other'),
        'no text on the map this check does not know'
      ).toEqual([]);
    });
  }
}

test('desktop, 1280 px: the wide map keeps its whole frame, its targets and its text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, ZOOMED);
  const m = await measure(page);
  record('zoomed area, 1280 px', m);
  expect(m.sideways, 'the page does not scroll sideways').toBe(false);
  // The whole 600 x 360 drawing: nothing is cut off a screen with room for it.
  expect(round(m.map.width / m.map.height), 'the frame is 600 by 360').toBe(round(600 / 360));
  expect(m.dots.length).toBe(5);
  for (const d of m.dots) {
    expect(round(Math.min(d.width, d.height)), `dot ${d.n}: target`).toBeGreaterThanOrEqual(
      TARGET_PX
    );
    expect(d.tappable, `dot ${d.n}: a tap 21 px from its centre reaches it`).toBe(true);
  }
  for (const t of m.texts.filter((x) => x.shown)) {
    expect(round(t.px), `${t.kind} "${t.text}"`).toBeGreaterThanOrEqual(TEXT_PX);
  }
});
