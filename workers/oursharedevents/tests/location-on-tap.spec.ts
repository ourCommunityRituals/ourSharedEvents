/**
 * The position is read only when the person asks for it, even where the browser
 * already allows location (OSE-2198 Part C; owner, 2026-11-19: "the user need
 * to tap and save purposely by choice").
 *
 * Two scripts read the phone's position, and both are run here on the
 * landing's own markup (renderLandingArea over a street layer, so the page
 * carries both), in jsdom, with the browser saying location is already
 * `granted`:
 *   - the map's script (lib/map-pan-script.ts) reads it on the tap of "Show
 *     where I am" and at no other time; where the permission is `denied` its
 *     button is hidden;
 *   - the landing's "Near me" (lib/area-tabs-script.ts) reads it when the
 *     person chooses a distance and at no other time.
 * Nothing is saved: the static half of this rule (no storage, no cookie, no
 * request, in either script) is the T0 invariant
 * tests/e2e/0-architecture/location-on-tap.invariant.spec.ts.
 *
 * jsdom lays nothing out, so the two SVG calls the map's script needs to place
 * things on screen are stood in for.
 *
 * Node project: pure rendering and jsdom. Registered in vitest.node-specs.mjs.
 *
 * @born-red the position is read only on a tap (OSE-2198 Part C) | method: the
 *   `granted` read on load put back in lib/map-pan-script.ts (red: the map read
 *   it before the tap); the `denied` hiding removed (red); a read on load added
 *   to lib/area-tabs-script.ts (red); each put back | date: 2026-11-19
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { renderLandingArea, type LandingAreaItem } from '../src/lib/landing-area';
import { cellsKey } from '../src/lib/street-map';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();
const A = latLngToCell(41.6573, -87.6806, 7);
const B = latLngToCell(41.7135, -87.6812, 7);

function rows(): LandingAreaItem[] {
  return [A, A, A, B, B].map((cell, i) => ({
    id: `e${i}`,
    name: `Event ${i}`,
    startDateISO: inDays(2 + i),
    phase: 'pre_event',
    location: 'Somewhere, Blue Island, IL 60406',
    h3_res7: cell,
  })) as LandingAreaItem[];
}

/** The landing with its map over a street layer: both scripts are on it. */
function landing(): string {
  const first = renderLandingArea(rows(), { now: NOW, areaLatched: true });
  return renderLandingArea(rows(), {
    now: NOW,
    areaLatched: true,
    streets: {
      cellsKey: cellsKey(first.mapCells!),
      svg: '<g class="amap-s" data-testid="amap-streets"></g>',
      drawn: { highway: 1, major: 0, minor: 0, water: 0, rivers: 0 },
    } as never,
    zoomHref: (c) => `/?area=${c}`,
  }).html;
}

/** The page in jsdom, scripts run, the browser saying location is `state`. */
async function open(state: 'granted' | 'denied' | 'prompt') {
  const reads = { n: 0 };
  const at = cellToLatLng(A);
  const dom = new JSDOM(`<!doctype html><html lang="en"><body>${landing()}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => m };
      const proto = win.SVGElement.prototype as unknown as Record<string, unknown>;
      proto.getScreenCTM = () => m;
      proto.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) });
      Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(ok: (p: unknown) => void) {
            reads.n += 1;
            ok({ coords: { latitude: at[0], longitude: at[1] } });
          },
        },
      });
      Object.defineProperty(win.navigator, 'permissions', {
        configurable: true,
        value: { query: () => Promise.resolve({ state }) },
      });
    },
  });
  // Let the permission answer and a frame or two go by, as a page load does.
  await new Promise((r) => setTimeout(r, 50));
  const doc = dom.window.document;
  return { doc, win: dom.window, reads };
}

describe('the position is read only when the person asks (OSE-2198 Part C)', () => {
  it('both scripts are on the page, and the map offers its button', async () => {
    const { doc } = await open('prompt');
    expect(doc.querySelector('[data-testid="amap-me"]')).not.toBe(null);
    expect(doc.querySelectorAll('input[name="near"]').length).toBeGreaterThan(1);
  });

  it('with location already allowed, nothing is read on load: no mark, no distance, no line', async () => {
    const { doc, reads } = await open('granted');
    expect(reads.n).toBe(0);
    expect(doc.querySelector('[data-testid="amap-you"]')).toBe(null);
    expect(doc.querySelectorAll('[data-testid="amap-dist"]')).toHaveLength(0);
    expect(doc.querySelector('[data-testid="amap-you-status"]')!.textContent).toBe('');
    expect((doc.querySelector('[data-testid="amap-me"]') as HTMLButtonElement).hidden).toBe(false);
  });

  it('the tap on "Show where I am" reads it once, and then the map shows where they are', async () => {
    const { doc, reads } = await open('granted');
    (doc.querySelector('[data-testid="amap-me"]') as HTMLButtonElement).click();
    expect(reads.n).toBe(1);
    expect(doc.querySelectorAll('[data-testid="amap-dist"]').length).toBeGreaterThan(0);
    expect(doc.querySelector('[data-testid="amap-you-status"]')!.textContent).toContain(
      'The nearest area'
    );
  });

  it('where location is refused, the button is hidden and nothing is read', async () => {
    const { doc, reads } = await open('denied');
    expect((doc.querySelector('[data-testid="amap-me"]') as HTMLButtonElement).hidden).toBe(true);
    expect(reads.n).toBe(0);
  });

  it('"Near me" reads it only when a distance is chosen, even where location is allowed', async () => {
    const { doc, win, reads } = await open('granted');
    expect(reads.n).toBe(0);
    (doc.querySelector('#tab-near') as HTMLButtonElement | null)?.click();
    expect(reads.n).toBe(0);
    const r = doc.getElementById('near-5') as HTMLInputElement;
    r.checked = true;
    r.dispatchEvent(new win.Event('change', { bubbles: true }));
    expect(reads.n).toBe(1);
  });
});
