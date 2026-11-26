/**
 * The map's zoom, scale bar and you-are-here mark (lib/map-pan-script.ts;
 * owner, 2026-11-18, who chose "a small script on the map only").
 *
 * What the server sends: the script once, only with a street map, the buttons
 * hidden until it runs, the words in the page's language, and the frame the
 * script needs. And what the script may never do: ask for anything, store
 * anything, or send the visitor's position anywhere (invariant 3). How it
 * behaves in a browser is the Playwright spec tests/playwright/map-pan.spec.ts.
 *
 * Node project: pure rendering and the script's text. Registered in
 * vitest.node-specs.mjs.
 */
// @born-red the map's zoom script | method: faults put in one at a time, this file run, the source restored; each turned it red: the script sent with no street map; the buttons not hidden; a fetch() added to the script; navigator.sendBeacon added; localStorage.setItem added; the position put in location.hash; the Spanish words left in English; the frame attributes dropped; a second copy of the script on the zoomed area; the distance rows' data-area left off | date: 2026-11-18
// @born-red the zoomed words (OSE-2198) | method: the zoomed control block sent without its two words (panControls called without zoomed), this file run (red), restored | date: 2026-11-19
import { describe, expect, it } from 'vitest';
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { renderAttendeeMap } from '../src/lib/attendee-map';
import { PAN_SCRIPT } from '../src/lib/map-pan-script';
import { TIP_SCRIPT } from '../src/lib/map-tip-script';
import { PAN_STYLE } from '../src/lib/map-pan-style';
import { LABEL_STYLE } from '../src/lib/map-label-style';
import { cellsKey } from '../src/lib/street-map';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const A7 = latLngToCell(41.6565, -87.681, 7);
const B7 = gridDisk(A7, 1).find((c) => c !== A7)!;
const ev = (i: number, cell: string, extra: Record<string, unknown> = {}) => ({
  id: `e${i}`,
  name: `Event ${i}`,
  startDateISO: new Date(NOW + (1 + (i % 20)) * 86_400_000).toISOString(),
  phase: 'pre_event',
  h3_res7: cell,
  location: 'Somewhere, Blue Island, IL 60406',
  ...extra,
});
const items = Array.from({ length: 12 }, (_, i) => ev(i, i % 2 ? A7 : B7));
const layer = (cells: string[]) => ({
  cellsKey: cellsKey(cells),
  svg: '<g class="amap-s" data-testid="amap-streets"></g>',
  drawn: { highway: 1, major: 0, minor: 0, water: 0, rivers: 0 },
});
const gate = { count: 12, min: 10 };
const withStreets = (lang: 'en' | 'es' = 'en') =>
  renderAttendeeMap(items, {
    now: NOW,
    area: gate,
    lang,
    streets: layer([A7, B7].sort()) as never,
    zoomHref: (c) => `/?area=${c}`,
  }).html;

describe('the map script | what the page carries', () => {
  it('with a street map: one zoom script (and the tooltip script), the buttons hidden until it runs, their styles', () => {
    const html = withStreets();
    expect(html.split(PAN_SCRIPT).length - 1).toBe(1);
    // The map's tooltip (lib/map-tip-script.ts, owner 2026-11-25) is the other one.
    expect(html.split(TIP_SCRIPT).length - 1).toBe(1);
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html).toContain('<figure class="amap" data-testid="amap" data-pan>');
    expect(html).toMatch(/<div class="amap-ctl" data-testid="amap-ctl" hidden /);
    expect(html).toContain(LABEL_STYLE);
    expect(html).toContain(PAN_STYLE);
    for (const z of ['in', 'out', 'reset', 'me']) {
      expect(html).toContain(
        `<button type="button" class="btn btn-secondary" data-z="${z}" data-testid="amap-${z}"`
      );
    }
    expect(html).toContain('aria-label="Zoom in">+</button>');
    expect(html).toContain('aria-label="Zoom out">&minus;</button>');
    expect(html).toContain('<p aria-live="polite" data-testid="amap-you-status"></p>');
  });

  it('with no street map: no zoom script, no buttons, no frame, as before', () => {
    const html = renderAttendeeMap(items, { now: NOW, area: gate }).html;
    // Only the tooltip's script (lib/map-tip-script.ts): the hexagons still name themselves.
    expect(html.split(TIP_SCRIPT).join('')).not.toContain('<script');
    expect(html).not.toContain(PAN_SCRIPT);
    expect(html).not.toContain('amap-ctl');
    expect(html).not.toContain('data-pan');
    expect(html).not.toContain('data-x0');
    expect(html).not.toContain('data-ll');
    // Nor on the zoomed area, which with no street map is the list of places.
    const zoomed = renderAttendeeMap([], {
      now: NOW,
      zoom: {
        cell: A7,
        backHref: '/',
        events: [
          { ...ev(1, A7), h3_res9: latLngToCell(41.6565, -87.681, 9), classes: [] },
        ] as never,
      },
    }).html;
    expect(zoomed).toContain('data-testid="amap-no-tiles"');
    expect(zoomed).not.toContain('<script');
    expect(zoomed).not.toContain('amap-ctl');
  });

  it('the frame the script projects with, and each area middle and name, from the cell ids alone', () => {
    const html = withStreets();
    expect(html).toMatch(
      /data-x0="0\.\d{9}" data-y0="0\.\d{9}" data-scale="\d+\.\d{3}" data-mpu="\d+\.\d{3}"/
    );
    for (const cell of [A7, B7]) {
      const ll = cellToLatLng(cell)
        .map((v) => v.toFixed(5))
        .join(',');
      expect(html).toContain(`data-cell="${cell}"`);
      expect(html).toContain(`data-ll="${ll}" data-name="Blue Island"`);
      expect(html).toMatch(
        new RegExp(`<li value="\\d" data-testid="amap-legend-area" data-area="${cell}">`)
      );
    }
    // A metre a unit is about right for a map of two areas near Chicago.
    const mpu = Number(/data-mpu="([0-9.]+)"/.exec(html)![1]);
    expect(mpu).toBeGreaterThan(5);
    expect(mpu).toBeLessThan(200);
  });

  it('the words the script writes are in the page language', () => {
    const es = withStreets('es');
    expect(es).toContain('data-from="a {d} mi de ti"');
    expect(es).toContain('aria-label="Acercar">+</button>');
    expect(es).toContain('Ver todo el mapa</button>');
    expect(es).toContain('Mostrar dónde estoy</button>');
  });

  it('the zoomed area carries the script once too, and its outline says where it is', () => {
    const html = renderAttendeeMap([], {
      now: NOW,
      streets: layer([A7]) as never,
      zoom: {
        cell: A7,
        backHref: '/',
        events: [
          { ...ev(1, A7), h3_res9: latLngToCell(41.6565, -87.681, 9), classes: [] },
        ] as never,
      },
    }).html;
    expect(html.split(PAN_SCRIPT).length - 1).toBe(1);
    expect(html).toMatch(
      /data-testid="amap-zone" data-cell="[0-9a-f]{15}" data-ll="[-0-9.,]+" data-name="[^"]+"/
    );
  });
});

describe('the map script | exact markup (mutation run of 2026-11-18)', () => {
  it('the control block, word for word: the words the script writes, the buttons, the scale, the hint', () => {
    const ctl = /<div class="amap-ctl".*?<\/div>/s.exec(withStreets())![0];
    expect(ctl).toBe(
      '<div class="amap-ctl" data-testid="amap-ctl" hidden data-from="{d} mi from you" data-miles="{d} mi" data-you="You are here: the ringed dot." data-outside="You are outside this map." data-nearest="The nearest area, {name}, is about {d} mi away." data-locating="Finding you on the map…" data-off="Location is off, so the map cannot show where you are.">' +
        '<button type="button" class="btn btn-secondary" data-z="in" data-testid="amap-in" aria-label="Zoom in">+</button>' +
        '<button type="button" class="btn btn-secondary" data-z="out" data-testid="amap-out" aria-label="Zoom out">&minus;</button>' +
        '<button type="button" class="btn btn-secondary" data-z="reset" data-testid="amap-reset">Show the whole map</button>' +
        '<button type="button" class="btn btn-secondary" data-z="me" data-testid="amap-me">Show where I am</button>' +
        '<span class="amap-scale" role="img" aria-label="Map scale" data-testid="amap-scale"><span class="amap-bar"></span><span data-testid="amap-scale-text"></span></span>' +
        '<p data-testid="amap-hint">Pinch, or tap + and −, to zoom. Once zoomed in, drag with one finger to move the map.</p>' +
        '<p aria-live="polite" data-testid="amap-you-status"></p></div>'
    );
  });

  it('zoomed in, the control block also carries the words for a place and for "about" (OSE-2198); the landing map does not', () => {
    const one = [{ ...ev(1, A7), lat: 41.6565, lon: -87.681, classes: [] }] as never;
    const zoomedCtl = (lang: 'en' | 'es') =>
      /<div class="amap-ctl"[^>]*>/.exec(
        renderAttendeeMap([], {
          now: NOW,
          lang,
          streets: layer([A7]) as never,
          zoom: { cell: A7, backHref: '/', events: one },
        }).html
      )![0];
    expect(zoomedCtl('en')).toContain(
      ' data-off="Location is off, so the map cannot show where you are." data-near-place="Nearest: {name}, {d} mi away." data-from-about="about {d} mi from you">'
    );
    expect(zoomedCtl('es')).toContain(
      ' data-near-place="Lo más cercano: {name}, a {d} mi." data-from-about="a unas {d} mi de ti">'
    );
    expect(withStreets()).not.toContain('data-near-place');
    expect(withStreets()).not.toContain('data-from-about');
  });

  it('the frame, to the digit: the scale bar is worked out from the middle of the drawing', () => {
    expect(withStreets()).toContain(
      'data-x0="0.256292904" data-y0="0.372367587" data-scale="2021540.288" data-mpu="14.809"'
    );
  });

  it('the zoomed area: the figure carries data-pan only with a street map, and nothing follows the panels without one', () => {
    const one = [
      { ...ev(1, A7), h3_res9: latLngToCell(41.6565, -87.681, 9), classes: [] },
    ] as never;
    const bare = renderAttendeeMap([], {
      now: NOW,
      zoom: { cell: A7, backHref: '/', events: one },
    }).html;
    expect(bare).toContain(`<figure class="amap" data-testid="amap" data-zoom="${A7}">`);
    expect(bare).toMatch(
      /data-testid="amap-no-tiles" role="status"><p>.*?<\/p><\/div>\s*<span id="amap-places"/
    );
    expect(bare.endsWith('</section></div>')).toBe(true);
    const drawn = renderAttendeeMap([], {
      now: NOW,
      streets: layer([A7]) as never,
      zoom: { cell: A7, backHref: '/', events: one },
    }).html;
    expect(drawn).toContain(`<figure class="amap" data-testid="amap" data-zoom="${A7}" data-pan>`);
    expect(drawn).toMatch(/<\/svg><div class="amap-ctl"/);
    expect(drawn.endsWith(PAN_SCRIPT + TIP_SCRIPT)).toBe(true);
  });
});

describe('the map script | never who, never where', () => {
  it('asks for nothing: no request of any kind', () => {
    for (const bad of [
      'fetch(',
      'XMLHttpRequest',
      'sendBeacon',
      'WebSocket',
      'EventSource',
      'new Image',
      'import(',
      'http',
      '.src',
      'action',
      'submit(',
    ]) {
      // The SVG namespace is a name, not an address anything is asked of.
      expect(PAN_SCRIPT.replace("'http://www.w3.org/2000/svg'", ''), bad).not.toContain(bad);
    }
  });

  it('keeps nothing and sends the position nowhere', () => {
    for (const bad of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'cookie',
      'location.',
      'history.',
      'postMessage',
      'console.',
      'watchPosition',
    ]) {
      expect(PAN_SCRIPT, bad).not.toContain(bad);
    }
    // The position is read in one place, and only on the tap, even where
    // location is already allowed (owner 2026-11-19, OSE-2198 Part C): `find`
    // is defined once and handed to the click listener, and named nowhere else.
    expect(PAN_SCRIPT.match(/getCurrentPosition/g)).toHaveLength(1);
    expect(PAN_SCRIPT.match(/\bfind\b/g)).toHaveLength(2);
    expect(PAN_SCRIPT).toContain('function find() {');
    expect(PAN_SCRIPT).toContain("me.addEventListener('click', find);");
    expect(PAN_SCRIPT).not.toContain('granted');
  });

  it('writes words into the page as text, never as markup', () => {
    expect(PAN_SCRIPT).not.toContain('innerHTML');
    expect(PAN_SCRIPT).not.toContain('outerHTML');
    expect(PAN_SCRIPT).not.toContain('insertAdjacentHTML');
    expect(PAN_SCRIPT).not.toContain('document.write');
    expect(PAN_SCRIPT).not.toMatch(/\beval\b|new Function/);
  });

  it('is one script element with nothing after it, so the page gives it its nonce', () => {
    expect(PAN_SCRIPT.startsWith('<script>')).toBe(true);
    expect(PAN_SCRIPT.endsWith('</script>')).toBe(true);
    expect(PAN_SCRIPT.slice(8, -9)).not.toContain('</script');
  });
});
