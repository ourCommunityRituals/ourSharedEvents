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
 * Two pages over streets, each at 320 and 375 px, light and dark, on Chromium
 * and WebKit:
 *   - the zoomed area (`/?area=`): every dot's target, every dot number, every
 *     town name, the whole hexagon on screen, no sideways scroll;
 *   - the landing's own map (`/`): every area number and every town name, no
 *     sideways scroll.
 * And the zoomed area twice on the whole frame: at 480 px, the narrowest screen
 * the narrow rule does not reach, and at a desktop width, so a rule written for
 * phones cannot pass by breaking the wide map.
 *
 * Born red (2026-11-15, Chromium and WebKit alike, one fault at a time, each put
 * back; 20 of 20 pass with none). "Zoomed" is the four zoomed-area tests (320
 * and 375 px, light and dark), "landing" the four landing-map tests, "wide" the
 * 480 px and desktop tests:
 *   - the `aspect-ratio` rule removed: zoomed, on the dot target (36.4 px at
 *     320 px, 43.6 px at 375 px);
 *   - `slice` removed from the svg: zoomed, on the same figures;
 *   - the narrow `.amap-dn` size removed: zoomed, on the dot number (10.5 px and
 *     12.6 px);
 *   - the narrow `.as-t,.amap-num` size removed: zoomed at 320 px (a town name,
 *     12.8 px) and all four landing (the area number, 12.1 px at 320 px; a town
 *     name, 12.3 px at 375 px). Zoomed at 375 px stays green: 15.4 px;
 *   - `DOT_HIT_R` 39 to 30: zoomed, on the dot target (35 px and 41.9 px);
 *   - the zoomed svg set 420 px wide: zoomed, on the sideways scroll;
 *   - `aspect-ratio:2/3`: zoomed, on the area's outline being cut;
 *   - the narrow rule at every width: both wide, on the frame (4 by 3);
 *   - `pointer-events:none` on `.amap-hit`: zoomed and both wide, on the tap
 *     21 px from a dot's centre;
 *   - the wide `.amap-dn` size back from 18 to 15 (map-zoom-style.ts): the
 *     480 px test alone, on the dot number (11 px). The 480 px test was added for
 *     this: no other test in this file saw that size.
 *
 * The landing's hexagon links (OSE-2084, 2026-11-15). Each hexagon on the
 * landing map is a link, and staging's ten were 29 by 28 px on a 320 px phone:
 * the nightly phone audit on staging was red on them from 2026-11-10, and no
 * check on a pull request drew more than two areas. So two more pages, each
 * from a phone to a desktop and at both sides of every width a rule starts at:
 *   - staging's ten areas: every hexagon is a link and a 44 px target (a phone
 *     draws the middle of the map in a square box);
 *   - the same with the staging fixture's area, eleven: too small on a phone in
 *     any box, so links from 760 px only, plain hexagons under it, and a 44 px
 *     "Zoom in" link for every area in the list at every width.
 * Born red (2026-11-15, Chromium, one fault at a time, each put back; 20 of 20
 * pass with none):
 *   - the source as it was on `main`: ten areas at 320, 375 and 479 px, on the
 *     link's width (29 px, 34.7 px);
 *   - the `data-tall` rule removed from the narrow style: the same three;
 *   - the linked copies not hidden first (map-link-style.ts): eleven areas at
 *     320, 375 and 759 px, on 22 hexagons on show;
 *   - every hexagon a link at every width: all five eleven-area tests.
 * A larger invisible target round a hexagon, as a dot has, was tried first and
 * failed here: a tap 21 px from one hexagon's centre opened the area next to it.
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

/**
 * Staging's ten areas on 2026-11-15, one event in each (OSE-2084). Side by side
 * they are drawn 62 by 60 units, and each hexagon is a link: 29 by 28 px on a
 * 320 px phone and 35 by 34 px at 375 px, on the whole frame. The nightly phone
 * audit on staging was red on them from 2026-11-10; no check on a pull request
 * drew more than two areas, so none saw it.
 */
const STAGING_AREAS = [
  '87266452bffffff',
  '872664544ffffff',
  '872664cdcffffff',
  '872664574ffffff',
  '872664cdaffffff',
  '872664529ffffff',
  '872664572ffffff',
  '87266450cffffff',
  '87266450dffffff',
  '872664cd8ffffff',
];
function tenAreas(): Row[] {
  return STAGING_AREAS.map((cell, i) => {
    const [lat, lon] = cellToLatLng(cell);
    return ev(i + 1, { lat, lon, h3_res7: cell, place_kind: 'business' });
  });
}

/** Serve the rendered page and /ui.css from ORIGIN; abort everything else. */
async function open(page: Page, path: string, data: Row[] = rows()): Promise<void> {
  const html = await renderLanding(path, data);
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
  /**
   * Every hexagon that is a link: the link's box on screen, as the phone audit
   * reads it, and whether a tap on it opens this area and not its neighbour.
   */
  areas: { n: string; width: number; height: number; inside: boolean; tappable: boolean }[];
  /** Hexagons on show, links or not. */
  cells: number;
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
    // On show: a link the width has switched off (map-link-style.ts) has no box.
    const drawn = (el: Element) => el.getBoundingClientRect().width > 0;
    const areas = [...svg.querySelectorAll<SVGAElement>('[data-testid="amap-area-link"]')]
      .filter(drawn)
      .map((a) => {
        const r = a.getBoundingClientRect();
        const cell = a.querySelector('.amap-cell')!.getBoundingClientRect();
        const cx = cell.left + cell.width / 2;
        const cy = cell.top + cell.height / 2;
        // Its centre and 15 px to four sides: each tap must open this area, not
        // the one next to it. (A hexagon is narrower between two edges than its
        // box, so the dots' 21 px reach is not asked of it.)
        const reach = 15;
        const tappable = [
          [cx, cy],
          [cx - reach, cy],
          [cx + reach, cy],
          [cx, cy - reach],
          [cx, cy + reach],
        ].every(([x, y]) => document.elementFromPoint(x!, y!)?.closest('a') === a);
        return {
          n: a.querySelector('.amap-num')?.firstChild?.textContent ?? '',
          width: r.width,
          height: r.height,
          inside: within(cell),
          tappable,
        };
      });
    const zone = svg.querySelector('[data-testid="amap-zone"]');
    return {
      map: { width: box.width, height: box.height },
      scale,
      texts,
      dots,
      areas,
      cells: [...svg.querySelectorAll('.amap-cell')].filter(drawn).length,
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
      `area link ${span(m.areas.map((a) => Math.min(a.width, a.height)))}; ` +
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
      // Both hexagons are links here, so both are held to the touch floor.
      expect(m.areas.length, 'both hexagons are links').toBe(2);
      for (const a of m.areas) {
        expect(round(Math.min(a.width, a.height)), `area ${a.n}: link`).toBeGreaterThanOrEqual(
          TARGET_PX
        );
        expect(a.inside, `area ${a.n}: its whole hexagon is on the map`).toBe(true);
        expect(
          a.tappable,
          `area ${a.n}: a tap at its centre or 15 px from it opens this area`
        ).toBe(true);
      }
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

/**
 * The landing with staging's ten areas (OSE-2084): every hexagon is a link, so
 * every one is a 44 px target, from the narrowest phone to a desktop. 479 and
 * 480 px are either side of the narrow rule: the taller box ends there, and the
 * whole frame, where a hexagon is smallest for its screen, begins.
 */
const TEN_AREA_SCREENS = [
  { name: '320 px', width: 320, height: 568, tall: true },
  { name: "375 px, the phone audit's screen", width: 375, height: 812, tall: true },
  { name: '479 px, the last width of the narrow rule', width: 479, height: 800, tall: true },
  { name: '480 px, where the whole frame is back', width: 480, height: 800, tall: false },
  { name: 'desktop, 1280 px', width: 1280, height: 800, tall: false },
];

for (const screen of TEN_AREA_SCREENS) {
  test(`landing map, ten areas, ${screen.name}: every hexagon link is a 44 px target`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await open(page, '/', tenAreas());
    await page.getByTestId('amap-svg').scrollIntoViewIfNeeded();
    const m = await measure(page);
    record(`landing map, ten areas, ${screen.width} px`, m);

    expect(m.sideways, 'the page does not scroll sideways').toBe(false);
    expect(m.cells, 'ten hexagons').toBe(10);
    expect(m.areas.length, 'every hexagon is a link').toBe(10);
    for (const a of m.areas) {
      expect(round(a.width), `area ${a.n}: link width`).toBeGreaterThanOrEqual(TARGET_PX);
      expect(round(a.height), `area ${a.n}: link height`).toBeGreaterThanOrEqual(TARGET_PX);
      expect(a.inside, `area ${a.n}: its whole hexagon is on the map`).toBe(true);
      expect(a.tappable, `area ${a.n}: a tap at its centre or 15 px from it opens this area`).toBe(
        true
      );
    }
    // A phone draws the middle of the map in a square box; from 480 px it is 600 by 360.
    expect(round(m.map.width / m.map.height), 'the shape of the map').toBe(
      screen.tall ? 1 : round(600 / 360)
    );
    // The list under the map keeps a 44 px link to every area.
    const zooms = await page
      .getByTestId('amap-zoom')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(zooms.length, 'a "Zoom in" link for every area').toBe(10);
    for (const h of zooms) expect(round(h), '"Zoom in" height').toBeGreaterThanOrEqual(TARGET_PX);
    const numbers = m.texts.filter((t) => t.kind === 'area number');
    expect(numbers.length, 'ten numbered areas').toBe(10);
    for (const t of numbers) {
      expect(round(t.px), `area number "${t.text}"`).toBeGreaterThanOrEqual(TEXT_PX);
    }
  });
}

/**
 * Staging while its map fixture is loaded: the ten areas and the fixture's own
 * (bruno/fixtures/map-zoom-area-seed.sql). Eleven areas are drawn 45 by 44
 * units: 21 px on a 320 px phone and 52 px on the widest map. A hexagon is a
 * link only where it is 44 px, so here from 760 px (map-link-style.ts, step 3).
 * Under that the hexagons are plain and the list's "Zoom in" links are the way
 * in. tests/e2e/3-flows/map-place-panel.spec.ts taps one of these hexagons on
 * staging, on a desktop.
 */
function elevenAreas(): Row[] {
  return [...STAGING_AREAS, '872664405ffffff'].map((cell, i) => {
    const [lat, lon] = cellToLatLng(cell);
    return ev(i + 1, { lat, lon, h3_res7: cell, place_kind: 'business' });
  });
}
const ELEVEN_AREA_SCREENS = [
  { name: '320 px', width: 320, height: 568, links: false },
  { name: "375 px, the phone audit's screen", width: 375, height: 812, links: false },
  { name: '759 px, the last width without links', width: 759, height: 900, links: false },
  { name: '760 px, the first width with links', width: 760, height: 900, links: true },
  { name: 'desktop, 1280 px', width: 1280, height: 800, links: true },
];

for (const screen of ELEVEN_AREA_SCREENS) {
  const what = screen.links ? 'every hexagon is a 44 px link' : 'no hexagon is a link';
  test(`landing map, eleven areas, ${screen.name}: ${what}`, async ({ page }) => {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await open(page, '/', elevenAreas());
    await page.getByTestId('amap-svg').scrollIntoViewIfNeeded();
    const m = await measure(page);
    record(`landing map, eleven areas, ${screen.width} px`, m);

    expect(m.sideways, 'the page does not scroll sideways').toBe(false);
    // Each hexagon is in the page twice, as a link and plain: one of the two shows.
    expect(m.cells, 'eleven hexagons on show').toBe(11);
    expect(round(m.map.width / m.map.height), 'the map keeps its whole frame').toBe(
      round(600 / 360)
    );
    expect(m.areas.length, 'hexagon links on show').toBe(screen.links ? 11 : 0);
    for (const a of m.areas) {
      expect(round(a.width), `area ${a.n}: link width`).toBeGreaterThanOrEqual(TARGET_PX);
      expect(round(a.height), `area ${a.n}: link height`).toBeGreaterThanOrEqual(TARGET_PX);
      expect(a.inside, `area ${a.n}: its whole hexagon is on the map`).toBe(true);
      expect(a.tappable, `area ${a.n}: a tap at its centre or 15 px from it opens this area`).toBe(
        true
      );
    }
    // A link that is not on show takes no tap: the hexagon's middle is not a link.
    const linkAtMiddle = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.amap-cell')].find(
        (el) => el.getBoundingClientRect().width > 0
      )!;
      const r = cell.getBoundingClientRect();
      return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('a');
    });
    expect(linkAtMiddle, 'a tap on a hexagon opens an area').toBe(screen.links);
    // "Tap a hexagon" is said only where a hexagon is a link.
    await expect(page.getByTestId('amap-tap')).toBeVisible({ visible: screen.links });
    // The list under the map keeps a 44 px link to every area, on every screen.
    const zooms = await page
      .getByTestId('amap-zoom')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(zooms.length, 'a "Zoom in" link for every area').toBe(11);
    for (const h of zooms) expect(round(h), '"Zoom in" height').toBeGreaterThanOrEqual(TARGET_PX);
    const numbers = m.texts.filter((t) => t.kind === 'area number' && t.shown);
    expect(numbers.length, 'eleven numbered areas on show').toBe(11);
    for (const t of numbers) {
      expect(round(t.px), `area number "${t.text}"`).toBeGreaterThanOrEqual(TEXT_PX);
    }
  });
}

/**
 * From 480 px the narrow rule is over and the whole frame is drawn again. 480 px
 * is the narrowest screen that gets the whole frame, so it is where the sizes the
 * other style blocks set (`.amap-dn` 18, `.as-t` 22) are smallest on screen.
 * 1280 px is a desktop, so a rule written for phones cannot pass by breaking the
 * wide map.
 */
const WIDE = [
  { name: '480 px, where the narrow rule ends', width: 480, height: 800 },
  { name: 'desktop, 1280 px', width: 1280, height: 800 },
];

for (const screen of WIDE) {
  test(`${screen.name}: the wide map keeps its whole frame, its targets and its text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await open(page, ZOOMED);
    await page.getByTestId('amap-svg').scrollIntoViewIfNeeded();
    const m = await measure(page);
    record(`zoomed area, ${screen.width} px`, m);
    expect(m.sideways, 'the page does not scroll sideways').toBe(false);
    // The whole 600 x 360 drawing: nothing is cut off a screen with room for it.
    expect(round(m.map.width / m.map.height), 'the frame is 600 by 360').toBe(round(600 / 360));
    expect(m.zoneInside, "the area's outline is wholly on screen").toBe(true);
    expect(m.dots.length, 'the five places are five dots').toBe(5);
    for (const d of m.dots) {
      expect(round(Math.min(d.width, d.height)), `dot ${d.n}: target`).toBeGreaterThanOrEqual(
        TARGET_PX
      );
      expect(d.inside, `dot ${d.n}: its whole target is on the map`).toBe(true);
      expect(d.tappable, `dot ${d.n}: a tap 21 px from its centre reaches it`).toBe(true);
    }
    const shown = m.texts.filter((x) => x.shown);
    expect(shown.filter((t) => t.kind === 'dot number').length, 'a number on every dot').toBe(5);
    for (const t of shown) {
      expect(round(t.px), `${t.kind} "${t.text}"`).toBeGreaterThanOrEqual(TEXT_PX);
    }
  });
}
