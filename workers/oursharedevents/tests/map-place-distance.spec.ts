/**
 * Zoomed in on one area, "where am I" is measured to each PLACE's res-9 cell,
 * not to the area (OSE-2198; owner, 2026-11-19: "this is how you get accurate
 * measurements and distance from current location to event distance").
 *
 * A res-7 area is about 2.4 km across and a res-9 cell about 0.35 km, so a
 * distance worked out to the area's centre can be a mile off the place. On the
 * zoomed map each dot carries its own res-9 cell's centre (lib/attendee-map.ts,
 * pinned per cell by tests/map-georef-cell-only.spec.ts), and the map's script
 * (lib/map-pan-script.ts) measures to it: the place's panel says how far it is,
 * the event cards below the map say how far their place is and are put nearest
 * first, and the status line names the nearest place. An event with no place on
 * the map is measured to the area's centre and says "about".
 *
 * And what may never happen (invariants 3 and 4; the owner's ruling of
 * 2026-11-16, "zip finds, tap places"): no cell is made from the phone's
 * position, and nothing about it is sent, stored, logged or written into the
 * page. The map script's own request and storage pins are in
 * tests/map-pan.spec.ts and stay as they were.
 *
 * The page is the landing's zoomed area as the Worker renders it
 * (renderLandingArea, over a street layer), run in jsdom with the real script.
 * jsdom draws nothing, so the two SVG calls the script needs to place things on
 * screen are stood in for; no distance depends on them. The same behaviour in a
 * real browser is tests/e2e/2-pages/street-map-pan.component.spec.ts.
 *
 * Node project: pure rendering and jsdom. Registered in vitest.node-specs.mjs.
 *
 * @born-red distance to the place, not the area (OSE-2198) | method: 9 faults
 *   put in one at a time, this file run, the source restored; each turned it
 *   red (10 in all): the dots measured to the area's data-ll; the dot's data-ll written
 *   from the area's cell; the fallback removed (a card with no place given the
 *   place words); the fallback's distance taken from the nearest place; the
 *   nearest-first sort of the cards left out; the panel's distance left off;
 *   the nearest place not named (the area named instead); the position written
 *   into the page as an attribute; a cell id made from the position and written
 *   into the page. And the name replaced as a string, so "$&" in a venue was
 *   rewritten | date: 2026-11-19
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { renderLandingArea, type LandingAreaItem } from '../src/lib/landing-area';
import { PAN_SCRIPT } from '../src/lib/map-pan-script';
import { AREA_TABS_SCRIPT } from '../src/lib/area-tabs-script';
import { cellsKey } from '../src/lib/street-map';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

// The staging fixture's area and places (bruno/fixtures/map-zoom-area-seed.sql),
// north to south: place 1 a business, place 2 two events on one block, place 3.
const AREA = '872664405ffffff';
const P1: [number, number] = [41.621, -87.8555];
const P2: [number, number] = [41.6119, -87.8657];
const P3: [number, number] = [41.6061, -87.8483];
const block = (p: [number, number]) => latLngToCell(p[0], p[1], 9);

function row(
  id: string,
  at: [number, number] | null,
  venue: string,
  day: number,
  kind = 'address'
): LandingAreaItem {
  return {
    id,
    name: `Event ${id}`,
    startDateISO: inDays(day),
    phase: 'pre_event',
    location: venue,
    h3_res7: AREA,
    place_kind: kind,
    ...(at ? { lat: at[0], lon: at[1] } : {}),
  } as LandingAreaItem;
}

/** Soonest first on the page: e-none, e3, e1, e2a, e2b. */
function rows(venue1 = 'Zoom Check Lanes'): LandingAreaItem[] {
  return [
    row('e1', P1, venue1, 5, 'business'),
    row('e2a', P2, 'A hall', 6),
    row('e2b', [P2[0] + 0.0002, P2[1] + 0.0002], 'A hall', 7),
    row('e3', P3, 'A cafe', 3),
    // In the area, with no point: no place on the map, a card all the same.
    row('e-none', null, 'Somewhere nearby', 2),
  ];
}

const layer = {
  cellsKey: cellsKey([AREA]),
  svg: '<g class="amap-s" data-testid="amap-streets"></g>',
  drawn: { highway: 1, major: 0, minor: 0, water: 0, rivers: 0 },
} as never;

function zoomedPage(lang: 'en' | 'es' = 'en', venue1?: string): string {
  return renderLandingArea(rows(venue1), {
    now: NOW,
    lang,
    streets: layer,
    zoom: { cell: AREA, backHref: '/' },
  }).html;
}

interface Opened {
  doc: Document;
  win: Window;
  asked: string[];
  locate: () => void;
}

/** The page in jsdom, scripts run, standing at `at`; "Show where I am" is tapped by locate(). */
function open(html: string, at: [number, number]): Opened {
  const asked: string[] = [];
  const dom = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      // jsdom lays nothing out: an identity matrix stands in for the drawing's
      // place on screen, which only the zoom, the mark and the scale bar use.
      const m = {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse() {
          return m;
        },
      };
      const proto = win.SVGElement.prototype as unknown as Record<string, unknown>;
      proto.getScreenCTM = () => m;
      proto.createSVGPoint = () => ({
        x: 0,
        y: 0,
        matrixTransform(this: { x: number; y: number }) {
          return { x: this.x, y: this.y };
        },
      });
      Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(ok: (p: unknown) => void) {
            ok({ coords: { latitude: at[0], longitude: at[1] } });
          },
        },
      });
      // Anything that could carry the position off the page is counted.
      const w = win as unknown as Record<string, unknown>;
      w.fetch = (u: unknown) => {
        asked.push(`fetch ${String(u)}`);
        return Promise.reject(new Error('no'));
      };
      (win.navigator as unknown as Record<string, unknown>).sendBeacon = (u: unknown) => {
        asked.push(`beacon ${String(u)}`);
        return false;
      };
      const open = win.XMLHttpRequest.prototype.open;
      win.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...a: unknown[]) {
        asked.push(`xhr ${String(a[1])}`);
        return (open as (...x: unknown[]) => void).apply(this, a);
      };
    },
  });
  const doc = dom.window.document;
  const locate = () => doc.querySelector<HTMLButtonElement>('[data-testid="amap-me"]')!.click();
  return { doc, win: dom.window as unknown as Window, asked, locate };
}

/** The script's own sum, written out again here: miles along the ground. */
function miles(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const x = Math.sin(((b[0] - a[0]) * r) / 2);
  const y = Math.sin(((b[1] - a[1]) * r) / 2);
  const h = x * x + Math.cos(a[0] * r) * Math.cos(b[0] * r) * y * y;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const fmt = (d: number) => (d < 10 ? d.toFixed(1) : String(Math.round(d)));
const centre = (cell: string) => cellToLatLng(cell) as [number, number];

const panelDist = (doc: Document, n: number) =>
  doc
    .querySelector(`#amap-ph-${n}`)!
    .parentElement!.querySelector('[data-testid="amap-place-dist"]')?.textContent ?? null;
const card = (doc: Document, id: string) =>
  doc.querySelector(`.view-list article.event-card[data-event-id="${id}"]`)!;
const cardDist = (doc: Document, id: string) =>
  card(doc, id).querySelector('[data-testid="amap-card-dist"]')?.textContent ?? null;
const cardOrder = (doc: Document) =>
  [...doc.querySelectorAll('.view-list article.event-card')].map((c) =>
    c.getAttribute('data-event-id')
  );
const status = (doc: Document) => doc.querySelector('[data-testid="amap-you-status"]')!.textContent;

// Standing at the north-west edge of place 2's block, inside the area. The
// distances to the places and to the area's centre differ at the tenth of a
// mile the page shows, so a sum to the wrong point cannot pass.
const STAND: [number, number] = [41.6145, -87.868];

describe('zoomed in, the distance is to each place, not the area (OSE-2198)', () => {
  it('the standing point tells the place from the area at the precision shown', () => {
    expect(latLngToCell(STAND[0], STAND[1], 7)).toBe(AREA);
    for (const p of [P1, P2, P3]) {
      expect(fmt(miles(STAND, centre(block(p))))).not.toBe(fmt(miles(STAND, centre(AREA))));
    }
  });

  it("each place's panel says how far its res-9 cell's centre is", () => {
    const { doc, locate } = open(zoomedPage(), STAND);
    expect(panelDist(doc, 1)).toBe(null);
    locate();
    // Dots are numbered north to south: 1 is P1, 2 is P2, 3 is P3.
    for (const [n, p] of [
      [1, P1],
      [2, P2],
      [3, P3],
    ] as const) {
      expect(panelDist(doc, n), `place ${n}`).toBe(
        ` · ${fmt(miles(STAND, centre(block(p))))} mi from you`
      );
    }
  });

  it('the line read out names the nearest place and how far it is', () => {
    const { doc, locate } = open(zoomedPage(), STAND);
    locate();
    const d = fmt(miles(STAND, centre(block(P2))));
    expect(status(doc)).toBe(
      `You are here: the ringed dot. Nearest: Place 2 · A hall, ${d} mi away.`
    );
  });

  it('each card says how far its place is, and the cards are put nearest first', () => {
    const { doc, locate } = open(zoomedPage(), STAND);
    expect(cardOrder(doc)).toEqual(['e-none', 'e3', 'e1', 'e2a', 'e2b']);
    locate();
    const to = (p: [number, number]) => fmt(miles(STAND, centre(block(p))));
    expect(cardDist(doc, 'e1')).toBe(` · ${to(P1)} mi from you`);
    // e2b is on the same block as e2a: one place, one point.
    expect(cardDist(doc, 'e2a')).toBe(` · ${to(P2)} mi from you`);
    expect(cardDist(doc, 'e2b')).toBe(` · ${to(P2)} mi from you`);
    expect(cardDist(doc, 'e3')).toBe(` · ${to(P3)} mi from you`);
    // Nearest first by the place's distance; one place's events keep their order.
    const by = (id: string) => Number(card(doc, id).getAttribute('data-pd'));
    const order = cardOrder(doc);
    expect(order.map((id) => by(id!))).toEqual(
      [...order.map((id) => by(id!))].sort((a, b) => a - b)
    );
    expect(order.slice(0, 2)).toEqual(['e2a', 'e2b']);
  });

  it('an event with no place on the map is measured to the area and says "about"', () => {
    const { doc, locate } = open(zoomedPage(), STAND);
    locate();
    const area = miles(STAND, centre(AREA));
    expect(cardDist(doc, 'e-none')).toBe(` · about ${fmt(area)} mi from you`);
    expect(Number(card(doc, 'e-none').getAttribute('data-pd'))).toBeCloseTo(area, 3);
    // Every placed card says it plainly, without "about".
    for (const id of ['e1', 'e2a', 'e2b', 'e3']) expect(cardDist(doc, id)).not.toContain('about');
  });

  it('the words are in the page language', () => {
    const { doc, locate } = open(zoomedPage('es'), STAND);
    locate();
    expect(cardDist(doc, 'e-none')).toMatch(/^ · a unas \d+\.\d mi de ti$/);
    expect(panelDist(doc, 2)).toMatch(/^ · a \d+\.\d mi de ti$/);
    expect(status(doc)).toContain('Lo más cercano: Lugar 2 · A hall, a ');
  });

  it('a venue name is written as it is, "$&" and all', () => {
    // Stand at place 1's own block, so the business is the nearest place.
    const { doc, locate } = open(zoomedPage('en', "Bob's $& Co"), centre(block(P1)));
    locate();
    expect(status(doc)).toBe(
      "You are here: the ringed dot. Nearest: Place 1 · Bob's $& Co, 0.0 mi away."
    );
  });

  it('the landing map, not zoomed, still measures to its areas and leaves the cards alone', () => {
    const items = rows();
    const first = renderLandingArea(items, {
      now: NOW,
      latched: new Set([AREA]),
      areaLatched: true,
    });
    const html = renderLandingArea(items, {
      now: NOW,
      areaLatched: true,
      streets: { ...(layer as object), cellsKey: cellsKey(first.mapCells!) } as never,
      zoomHref: (c) => `/?area=${c}`,
    }).html;
    expect(html).toContain('data-testid="amap-legend-area"');
    const { doc, locate } = open(html, STAND);
    locate();
    expect(doc.querySelector('[data-testid="amap-dist"]')!.textContent).toBe(
      ` · ${fmt(miles(STAND, centre(AREA)))} mi from you`
    );
    expect(doc.querySelectorAll('[data-testid="amap-card-dist"]')).toHaveLength(0);
    expect(status(doc)).toContain('The nearest area');
  });
});

describe('no cell is made from the position, and it goes nowhere (invariants 3 and 4)', () => {
  const cells = (doc: Document) =>
    new Set(doc.documentElement.outerHTML.match(/[0-9a-f]{15}/g) ?? []);

  it('after "Show where I am" the page holds no new cell id and no trace of the position', () => {
    const at: [number, number] = [41.614537, -87.868123];
    const { doc, asked, locate } = open(zoomedPage(), at);
    const before = cells(doc);
    locate();
    expect(status(doc)).toContain('Nearest');
    expect(cells(doc)).toEqual(before);
    // Neither the position nor its own cell, at any resolution, is in the page.
    const page = doc.documentElement.outerHTML;
    // (Two decimals of a latitude are also the area's own, so a pair is looked
    // for there; from four decimals, either number alone.)
    for (const dp of [2, 3, 4, 5, 6]) {
      expect(page).not.toContain(`${at[0].toFixed(dp)},${at[1].toFixed(dp)}`);
      if (dp >= 4) {
        expect(page).not.toContain(at[0].toFixed(dp));
        expect(page).not.toContain(at[1].toFixed(dp));
      }
    }
    for (const res of [7, 8, 9, 10, 11, 12]) {
      const own = latLngToCell(at[0], at[1], res);
      // Its res-7 cell is the area itself, which the page named before; no finer.
      if (res > 7) expect(page).not.toContain(own);
    }
    expect(asked).toEqual([]);
  });

  it('neither script holds any H3 code: a cell is never made on the phone', () => {
    for (const [name, src] of [
      ['map', PAN_SCRIPT],
      ['tabs', AREA_TABS_SCRIPT],
    ] as const) {
      for (const banned of [
        /latLngToCell/i,
        /geoToH3/i,
        /\bh3/i,
        /resolution/i,
        /toString\(16\)/,
      ]) {
        expect(src, `${name}: ${banned}`).not.toMatch(banned);
      }
    }
    // The map script takes the position in one place, as two numbers it sums
    // with and draws the mark at: never kept anywhere but `here`.
    expect(PAN_SCRIPT.match(/coords\./g)).toHaveLength(2);
    expect(PAN_SCRIPT).toContain('located(p.coords.latitude, p.coords.longitude)');
    expect(PAN_SCRIPT.match(/\bhere\b/g)!.length).toBeLessThanOrEqual(5);
  });
});
