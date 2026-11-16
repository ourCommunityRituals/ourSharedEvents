/**
 * The contrast of the text drawn on the street map, judged by measurement, at
 * the COMPONENT level (street-map CCR 2026-11-15, findings R27 and R38).
 *
 * axe cannot decide text drawn over the street layer: town names and dot numbers
 * come back "incomplete". On staging that was a failure once the street map was
 * binding, so `streetMapArchiveLoaded` could never be set on a green chain
 * (R27). The judge here decides it from the colours the browser resolved from
 * the tokens, in the theme on screen: the text against its halo, or against the
 * dot it sits on, or against every colour drawn under it
 * (scripts/ci/map-text-contrast.mjs has the rule; helpers/map-text-contrast.ts
 * reads the page). The same judge runs on staging in
 * tests/e2e/3-flows/map-place-panel.spec.ts (T4k).
 *
 * The page is the real landing handler over a synthetic archive
 * (helpers/render-landing-map.ts), as in street-map-sizes.component.spec.ts:
 * no Worker, no D1, no R2. The archive proves the styles, never what a real
 * tile holds. Staging has no archive yet, so this is the layer that sees text
 * over streets today.
 *
 * WHAT IT FOUND (2026-11-15, Chromium; the figures are in each test's
 * annotations on every run). Styles are not changed here: colours come from
 * packages/tokens and the choice is the owner's. Each finding is pinned below
 * (FINDINGS) by the exact kinds of text that fail, so a fix turns the test red
 * until the pin is taken out, and a new failure turns it red at once.
 *   1. The number on a pale dot (a place that is not a business) is under AA in
 *      both themes at every width: 2.10:1 light and 2.38:1 dark, where 4.5:1 is
 *      needed (3:1 from 18.7 px bold). It is `--on-accent` on `--accent` at 45%
 *      over the map (lib/map-zoom-style.ts, `.amap-blk .amap-dot`).
 *   2. On the landing map at 320 px the halo of the area numbers and town names
 *      is 0.93 px on screen, under the judge's 1 px floor, so it is not counted
 *      and they are judged against the map: 2.47 to 2.78:1 and 1.62 to 1.71:1.
 *      At 375 px the halo is 1.1 px and both pass. WCAG gives no figure for a
 *      halo's width; 1 px is this judge's own floor.
 * What passes: town names against their halo (5.5:1 or more), the number on a
 * solid dot (5.8:1 or more), area numbers against their halo (15:1).
 *
 * BORN RED. The "the judge fails" tests below are the standing proof: each
 * forces one fault into the live page (a town name in the road's colour, a halo
 * in the text's colour, a halo too thin, a number in its dot's colour, …) and
 * the judge must fail on that kind of text. Then the judge itself was faulted,
 * one fault at a time, this file run on Chromium, and the fault taken out:
 *   __BORN_RED__
 *
 * It runs in the T0 `component` shard (playwright.component.config.ts), on
 * Chromium and WebKit. Every request goes to ORIGIN and is answered by the
 * routes; anything else is aborted.
 */
import { test, expect, type Page } from '@playwright/test';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { ORIGIN, renderLanding, uiCss } from '../helpers/render-landing-map';
import { judgeMapTextOn, type MapTextJudged } from '../helpers/map-text-contrast';

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
    id: `evt_k${String(n).padStart(2, '0')}`,
    slug: `contrast-${n}`,
    title: `Contrast Event ${n}`,
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
 * The same shape as street-map-sizes.component.spec.ts: five places in one area
 * (two businesses, so two solid dots; three not, so three pale dots) and six
 * events in a second area, so the landing leads with its map of two areas.
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
type Scheme = 'light' | 'dark';

/** Serve the rendered page and /ui.css from ORIGIN, in this theme; abort everything else. */
async function open(page: Page, path: string, scheme: Scheme, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 812 });
  await page.emulateMedia({ colorScheme: scheme });
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
  // The theme asked for is the theme on screen, or "both themes" is one theme twice.
  const bg = await page.evaluate(() => {
    const seen = [document.body, document.documentElement]
      .map((el) => getComputedStyle(el).backgroundColor)
      .find((c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
    return seen ?? '';
  });
  const [r, g, b] = (bg.match(/\d+/g) ?? []).map(Number);
  expect((r ?? 0) + (g ?? 0) + (b ?? 0) > 382 ? 'light' : 'dark', `page background ${bg}`).toBe(
    scheme
  );
  await page.getByTestId('amap-svg').scrollIntoViewIfNeeded();
}

/**
 * Put a style fault on the live page. The page's own style blocks are in its
 * body, so the fault goes after them, at the end of the body: a block in the
 * head would lose to them and change nothing.
 */
async function addFault(page: Page, css: string): Promise<void> {
  await page.evaluate((text) => {
    const style = document.createElement('style');
    style.textContent = text;
    document.body.appendChild(style);
  }, css);
}

/** Every verdict into the report, so a pass says how much room it had. */
function record(where: string, judged: MapTextJudged): void {
  for (const line of judged.summary) {
    test.info().annotations.push({ type: 'map-text-contrast', description: `${where}: ${line}` });
  }
}

const count = (judged: MapTextJudged, kind: string) =>
  judged.texts.filter((t) => t.kind === kind).length;

/**
 * What the judge finds on the shipped styles, by page and width: the kinds of
 * text under their ratio. Exact: a kind that starts to pass, or a new kind that
 * fails, turns the test red. The figures and the reason are at the head of this
 * file; nothing here excuses a failure on staging (T4k has no such list).
 */
const FINDINGS = {
  zoomed: () => ['pale dot number'],
  landing: (width: number) => (width < 343 ? ['area number', 'town name'] : []),
};

const WIDTHS = [320, 375, 1280];
const THEMES: Scheme[] = ['light', 'dark'];

for (const width of WIDTHS) {
  for (const scheme of THEMES) {
    const where = `${width} px, ${scheme}`;

    test(`zoomed area, ${where}: town names and solid dot numbers reach AA; the pale dot's number is the one finding`, async ({
      page,
    }) => {
      await open(page, ZOOMED, scheme, width);
      const judged = await judgeMapTextOn(page);
      record(`zoomed area, ${where}`, judged);

      expect(count(judged, 'other'), 'no text on the map this judge does not know').toBe(0);
      expect(count(judged, 'town name'), 'at least one town name is drawn').toBeGreaterThan(0);
      expect(count(judged, 'dot number'), 'the two businesses are two solid dots').toBe(2);
      expect(count(judged, 'pale dot number'), 'the three other places are three pale dots').toBe(
        3
      );
      expect(judged.lines.length, 'every text on screen has a verdict').toBe(judged.texts.length);

      expect(judged.failedKinds, judged.failures.join('\n')).toEqual(FINDINGS.zoomed());
      // The finding is every pale dot, not one of them by chance.
      expect(judged.failures.length, judged.failures.join('\n')).toBe(3);
      console.log(
        `::warning title=Map text contrast, a known finding::zoomed area, ${where}: ${judged.failures[0]}`
      );
    });

    test(`landing map, ${where}: area numbers and town names reach AA where their halo is 1 px or more`, async ({
      page,
    }) => {
      await open(page, '/', scheme, width);
      const judged = await judgeMapTextOn(page);
      record(`landing map, ${where}`, judged);

      expect(count(judged, 'other'), 'no text on the map this judge does not know').toBe(0);
      expect(count(judged, 'area number'), 'two numbered areas').toBe(2);
      expect(count(judged, 'town name'), 'at least one town name is drawn').toBeGreaterThan(0);

      expect(judged.failedKinds, judged.failures.join('\n')).toEqual(FINDINGS.landing(width));
      if (judged.failures.length > 0) {
        // Under the floor, and for that reason only: the same text passes at 375 px.
        for (const line of judged.failures) expect(line).toContain('under the 1 px floor');
        console.log(
          `::warning title=Map text contrast, a known finding::landing map, ${where}: ${judged.failures[0]}`
        );
      }
    });
  }
}

/**
 * The judge can fail. Each case forces one fault into the live page, in both
 * themes, and names the kind of text that must then be under its ratio. Tokens
 * only, as the page's own styles are.
 */
const FAULTS: {
  name: string;
  path: string;
  css: string;
  fails: string;
  /** A part of the failing line, when the reason matters. */
  says?: string;
}[] = [
  {
    name: 'a town name in the road colour, with no halo',
    path: ZOOMED,
    css: '.as-t{fill:var(--border-strong);stroke:none}',
    fails: 'town name',
    says: '1.00:1 against the edge of a highway',
  },
  {
    name: 'a town name in the road colour, halo kept',
    path: ZOOMED,
    css: '.as-t{fill:var(--border-strong)}',
    fails: 'town name',
    says: 'against its halo',
  },
  {
    name: "a town name's halo in the text's own colour",
    path: ZOOMED,
    css: '.as-t{stroke:var(--text-muted)}',
    fails: 'town name',
    says: 'against its halo',
  },
  {
    name: "a town name's halo too thin to count",
    path: ZOOMED,
    css: '.as-t{stroke-width:1}',
    fails: 'town name',
    says: 'under the 1 px floor',
  },
  {
    name: "a town name's stroke painted over its fill, so it is no halo",
    path: ZOOMED,
    css: '.as-t{paint-order:normal}',
    fails: 'town name',
    says: 'against the edge of a highway',
  },
  {
    name: 'the street layer drawn faint, town names with it',
    path: ZOOMED,
    css: '[data-testid="amap-streets"]{opacity:.3}',
    fails: 'town name',
  },
  {
    name: "a solid dot's number in the dot's colour",
    path: ZOOMED,
    css: '.amap-dn{fill:var(--accent)}',
    fails: 'dot number',
    says: '1.00:1 against its dot',
  },
  {
    name: 'every dot drawn pale',
    path: ZOOMED,
    css: '.amap-dot{fill-opacity:.2}',
    fails: 'dot number',
    says: 'its dot at 20% over',
  },
  {
    name: "an area number in the page's colour",
    path: '/',
    css: '.amap-num{fill:var(--bg)}',
    fails: 'area number',
    says: '1.00:1 against its halo',
  },
  {
    name: 'an area number with no halo',
    path: '/',
    css: '.amap-num{stroke:none}',
    fails: 'area number',
    says: 'against the edge of a hexagon',
  },
];

for (const fault of FAULTS) {
  for (const scheme of THEMES) {
    test(`the judge fails: ${fault.name} (${scheme})`, async ({ page }) => {
      await open(page, fault.path, scheme, 375);
      // Sound before the fault: this kind of text passes on the shipped styles.
      const before = await judgeMapTextOn(page);
      expect(before.failedKinds, 'before the fault').not.toContain(fault.fails);
      await addFault(page, fault.css);
      const after = await judgeMapTextOn(page);
      expect(after.failedKinds, after.lines.join('\n')).toContain(fault.fails);
      const lines = after.failures.filter((l) => l.includes(`: ${fault.fails} "`));
      expect(lines.length, 'the failing lines name that kind').toBeGreaterThan(0);
      if (fault.says) {
        for (const line of lines) expect(line).toContain(fault.says);
      }
    });
  }
}

test('the judge refuses a paint it cannot read: a town name filled with a pattern throws by name', async ({
  page,
}) => {
  await open(page, ZOOMED, 'light', 375);
  await addFault(page, '.as-t{fill:url(#no-such-pattern)}');
  await expect(judgeMapTextOn(page)).rejects.toThrow(/is not a plain colour/);
});

test('a text on the map the judge does not know is counted, never passed over', async ({
  page,
}) => {
  await open(page, ZOOMED, 'light', 375);
  await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="amap-svg"]')!;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', '300');
    t.setAttribute('y', '180');
    t.textContent = 'a label nobody listed';
    svg.appendChild(t);
  });
  const judged = await judgeMapTextOn(page);
  expect(count(judged, 'other')).toBe(1);
  // It is judged like any other text: against the map, as it has no halo.
  expect(judged.lines.some((l) => l.includes('other "a label nobody listed"'))).toBe(true);
});
