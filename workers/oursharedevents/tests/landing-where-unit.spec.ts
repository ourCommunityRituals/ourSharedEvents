/**
 * Landing "where are you?" (owner 2026-10-10): the zip table, the rough-box
 * decoder, and the limits on the landing page's one location script.
 *
 * The script is the only served file allowed to ask the browser for its
 * position (named reader in tests/poster-deployments-h3-tagging.spec.ts 8b).
 * These tests hold it to what the page says: pressed by the person (or already
 * allowed), phones only, a 5-character box sent in a form body, nothing stored.
 *
 * @born-red landing-where | method: each script-limit assertion was run against a
 *   planted fault (watchPosition, enableHighAccuracy true, a 6th character, a
 *   localStorage write, a fetch, auto-run without "granted") and went red | date: 2026-10-10
 * @born-red landing-zip-own-area | method: inZipOwnArea run with each fault planted:
 *   the old 8-ring test (return true inside the bound), the address zip ignored, a
 *   0.001-degree neighbour search, an unanchored address-zip pattern, the address
 *   zip trusted without its own bound, a zip read after any space ("Box 12345"),
 *   the old three-whitespace-run pattern (400 padded calls took 12.9 s); each
 *   turned a test red | date: 2026-11-05
 */
import { describe, test, expect } from 'vitest';
import { gridDistance, latLngToCell } from 'h3-js';
import LANDING_HTML from '../src/templates/landing.html';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';
import {
  findZipArea,
  nearestZipArea,
  nearCells,
  inZipOwnArea,
  addressZip,
  normalizeZip,
  roughBoxCenter,
  NEAR_RING_STEPS,
} from '../src/lib/zip-areas';
import { ZIP_AREA_COUNT, ZIP_AREAS, ZIP_AREA_RECORD } from '../src/lib/zip-areas-data';
import {
  readWhere,
  renderWhere,
  renderAreaHeading,
  renderNearEmpty,
} from '../src/lib/landing-where';

/** The landing page's one script, as served. */
const SCRIPT = (() => {
  const all = [...LANDING_HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)];
  expect(all.length).toBe(1);
  return all[0][1];
})();

/** The script's own box function, run as written. */
const scriptRoughBox = (() => {
  const body = SCRIPT.slice(SCRIPT.indexOf("var B = '"), SCRIPT.indexOf('function off()'));
  return new Function(`${body}; return roughBox;`)() as (lat: number, lon: number) => string;
})();

describe('zip table', () => {
  test('every record is fixed width and sorted, with the count it states', () => {
    const lines = ZIP_AREAS.split('\n').filter(Boolean);
    expect(lines.length).toBe(ZIP_AREA_COUNT);
    expect(ZIP_AREA_COUNT).toBeGreaterThan(30_000);
    for (const l of lines) expect(l).toMatch(/^\d{5}[+-]\d{2}\.\d{3}[+-]\d{3}\.\d{3}$/);
    expect(lines.every((l) => l.length === ZIP_AREA_RECORD)).toBe(true);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i - 1].slice(0, 5) < lines[i].slice(0, 5)).toBe(true);
    }
  });

  test('finds zips at the ends and in the middle; ZIP+4 and spaces are fine', () => {
    const lines = ZIP_AREAS.split('\n').filter(Boolean);
    for (const l of [lines[0], lines[lines.length - 1], lines[(lines.length / 2) | 0]]) {
      expect(findZipArea(l.slice(0, 5))?.zip).toBe(l.slice(0, 5));
    }
    const blueIsland = findZipArea('60406');
    expect(blueIsland?.lat).toBeCloseTo(41.655, 1);
    expect(blueIsland?.lon).toBeCloseTo(-87.68, 1);
    expect(findZipArea(' 60406-1234 ')?.zip).toBe('60406');
  });

  test('refuses what is not a 5-digit zip, and zips with no area', () => {
    for (const bad of ['', '6040', '604066', 'abcde', '60406-12', '41.6,-87.6', null, 60406]) {
      expect(normalizeZip(bad), String(bad)).toBeNull();
      expect(findZipArea(bad), String(bad)).toBeNull();
    }
    expect(findZipArea('00000')).toBeNull();
    expect(findZipArea('99999')).toBeNull();
  });

  test('nearest zip to a point, and nothing for a point far from the US', () => {
    expect(nearestZipArea(41.6571, -87.6798)?.zip).toBe('60406');
    expect(nearestZipArea(48.8566, 2.3522)).toBeNull(); // Paris
    expect(nearestZipArea(Number.NaN, 0)).toBeNull();
  });

  test('the outer bound is the zip cell and 8 rings of res-7 cells around it', () => {
    const area = findZipArea('60406')!;
    const cells = nearCells(area);
    expect(NEAR_RING_STEPS).toBe(8);
    expect(cells.size).toBe(1 + 3 * NEAR_RING_STEPS * (NEAR_RING_STEPS + 1));
    expect(cells.has(latLngToCell(area.lat, area.lon, CORRIDOR_RES))).toBe(true);
    // Eagles Hall is in; downtown Los Angeles is not.
    expect(cells.has(latLngToCell(41.6571, -87.6798, CORRIDOR_RES))).toBe(true);
    expect(cells.has(latLngToCell(34.05, -118.25, CORRIDOR_RES))).toBe(false);
  });
});

/** An event placed at a point, as the Worker tags it (res 7 and res 9). */
const at = (lat: number, lon: number, where_address?: string) => ({
  h3_res7: latLngToCell(lat, lon, CORRIDOR_RES),
  h3_res9: latLngToCell(lat, lon, 9),
  where_address,
});

// Points one ring from Mount Greenwood's (60655) cell, each inside its own
// town's Census zip boundary (stock/nodes.json polygons). The old 8-ring
// "near" listed all of them for 60655; even 1 ring lists them.
const OAK_LAWN = [41.698, -87.74] as const; // 60453
const EVERGREEN_PARK = [41.708, -87.706] as const; // 60805
const BEVERLY = [41.7, -87.683] as const; // 60643
const MOUNT_GREENWOOD = [41.681, -87.711] as const; // 60655
const EAGLES_HALL = [41.6571, -87.6798] as const; // 60406, Blue Island

describe("a zip's own area (owner 2026-11-05)", () => {
  test('the neighbours next to 60655 are within its old 8-ring "near", one ring out', () => {
    const near = nearCells(findZipArea('60655')!);
    const home = latLngToCell(41.695, -87.704, CORRIDOR_RES);
    for (const [lat, lon] of [OAK_LAWN, EVERGREEN_PARK, BEVERLY]) {
      const cell = latLngToCell(lat, lon, CORRIDOR_RES);
      expect(near.has(cell)).toBe(true);
      expect(gridDistance(home, cell)).toBe(1);
    }
  });

  test("60655 holds none of its neighbours' events, by address or by cell", () => {
    const mine = inZipOwnArea(findZipArea('60655')!);
    expect(mine(at(...OAK_LAWN, '9400 S Cicero Ave, Oak Lawn, IL 60453'))).toBe(false);
    expect(mine(at(...EVERGREEN_PARK, '3555 W 95th St, Evergreen Park, IL 60805'))).toBe(false);
    expect(mine(at(...BEVERLY, '10400 S Western Ave, Chicago, IL 60643'))).toBe(false);
    // No address: the nearest zip center decides, and it is the neighbour's.
    expect(mine(at(...OAK_LAWN))).toBe(false);
    expect(mine(at(...EVERGREEN_PARK))).toBe(false);
    expect(mine(at(...BEVERLY))).toBe(false);
    expect(mine(at(...EAGLES_HALL))).toBe(false);
    // Its own event shows, either way.
    expect(mine(at(...MOUNT_GREENWOOD, '3700 W 111th St, Chicago, IL 60655'))).toBe(true);
    expect(mine(at(...MOUNT_GREENWOOD))).toBe(true);
  });

  test('each neighbour keeps its own events', () => {
    for (const [zip, point] of [
      ['60453', OAK_LAWN],
      ['60805', EVERGREEN_PARK],
      ['60643', BEVERLY],
      ['60406', EAGLES_HALL],
    ] as const) {
      const mine = inZipOwnArea(findZipArea(zip)!);
      expect(mine(at(...point, `1 Main St, Town, IL ${zip}`)), zip).toBe(true);
      expect(mine(at(...point)), zip).toBe(true);
    }
  });

  test('an event shows for one zip at most', () => {
    const zips = ['60406', '60643', '60620', '60805', '60453', '60655', '60469', '60803'];
    const tests = zips.map((z) => inZipOwnArea(findZipArea(z)!));
    for (let lat = 41.64; lat <= 41.75; lat += 0.005) {
      for (let lon = -87.77; lon <= -87.64; lon += 0.005) {
        const e = at(lat, lon);
        expect(tests.filter((t) => t(e)).length, `${lat},${lon}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('the address zip wins over the nearest center, but not past the 8-ring bound', () => {
    // A point nearest 60655's center, whose venue says Oak Lawn: Oak Lawn's.
    const said = at(...MOUNT_GREENWOOD, '1 Main St, Oak Lawn, IL 60453');
    expect(inZipOwnArea(findZipArea('60655')!)(said)).toBe(false);
    expect(inZipOwnArea(findZipArea('60453')!)(said)).toBe(true);
    // A Los Angeles venue with a Chicago zip typed: not listed for that zip.
    expect(inZipOwnArea(findZipArea('60655')!)(at(34.05, -118.25, 'X, IL 60655'))).toBe(false);
    // A zip that is not a zip area (a PO-box-only zip) falls back to the center.
    expect(inZipOwnArea(findZipArea('60655')!)(at(...MOUNT_GREENWOOD, 'Box 1, IL 00000'))).toBe(
      true
    );
    // A typo'd zip from far away is ignored, not trusted: the event still shows
    // for its nearest zip instead of for no zip at all.
    const typo = at(...MOUNT_GREENWOOD, '3700 W 111th St, Chicago, CA 90012');
    expect(inZipOwnArea(findZipArea('60655')!)(typo)).toBe(true);
    expect(inZipOwnArea(findZipArea('90012')!)(typo)).toBe(false);
  });

  test('an event with no cell, or a cell that is not one, is in no zip', () => {
    const mine = inZipOwnArea(findZipArea('60655')!);
    expect(mine({ where_address: '3700 W 111th St, Chicago, IL 60655' })).toBe(false);
    expect(mine({ h3_res7: 'not-a-cell', where_address: 'IL 60655' })).toBe(false);
    expect(mine({ h3_res7: 42 })).toBe(false);
  });

  test('reads a zip only at the end of an address', () => {
    expect(addressZip('1234 W Example St, Town, IL 60453')).toBe('60453');
    expect(addressZip('1234 W Example St, Town, IL 60453-1234')).toBe('60453');
    expect(addressZip('1234 W Example St, Town, IL 60453, USA')).toBe('60453');
    expect(addressZip('60453')).toBe('60453');
    expect(addressZip('12345 S Pulaski Rd, Alsip, IL')).toBeNull();
    expect(addressZip('2427 Grove St')).toBeNull();
    expect(addressZip('Room 604531')).toBeNull();
    expect(addressZip('PO Box 12345')).toBeNull();
    expect(addressZip('Unit 60453')).toBeNull();
    expect(addressZip('Hwy 10 Exit 12345')).toBeNull();
    expect(addressZip('Oak Lawn, 60453')).toBe('60453');
    expect(addressZip('Oak Lawn, IL 60453.')).toBe('60453');
    expect(addressZip('Oak Lawn, IL 60453 USA')).toBe('60453');
  });

  test('a padded 500-character address costs no more than a short one', () => {
    const pads = [' ', '\t', ' ', ' \t'].map((p) => ' 12345' + p.repeat(494 / p.length) + 'x');
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) for (const a of pads) expect(addressZip(a)).toBeNull();
    // 400 calls; the old pattern took 12-38 ms for ONE such call.
    expect(performance.now() - t0).toBeLessThan(50);
    expect(addressZip(null)).toBeNull();
    expect(addressZip(60453)).toBeNull();
  });
});

describe('rough box', () => {
  test('the server decodes exactly a 5-character geohash, nothing finer or looser', () => {
    for (const bad of ['', 'dp3w', 'dp3wnx', 'DP3WN', 'dp3wa', 'dp3wi', '41.65', null, 12345]) {
      expect(roughBoxCenter(bad), String(bad)).toBeNull();
    }
    const c = roughBoxCenter('dp3su')!; // the box holding Eagles Hall, Blue Island
    expect(Math.abs(c.lat - 41.6571)).toBeLessThan(0.025);
    expect(Math.abs(c.lon - -87.6798)).toBeLessThan(0.025);
  });

  test('the page script makes 5 characters, and the server reads them back to the same area', () => {
    for (const [lat, lon] of [
      [41.6571, -87.6798],
      [40.7128, -74.006],
      [34.0522, -118.2437],
      [61.2181, -149.9003],
      [21.3069, -157.8583],
    ]) {
      const box = scriptRoughBox(lat, lon);
      expect(box).toMatch(/^[0-9b-hjkmnp-z]{5}$/);
      const c = roughBoxCenter(box)!;
      // A 5-character box is about 4.9 km by 4.9 km: its center is within ~3.5 km.
      expect(Math.abs(c.lat - lat)).toBeLessThan(0.025);
      expect(Math.abs(c.lon - lon)).toBeLessThan(0.025);
    }
    // The box is coarser than a zip, so its zip can be the neighbour (Posen,
    // next to Blue Island). The page then shows that zip's own area and names
    // the zip in its heading, so the person can type their own instead.
    expect(scriptRoughBox(41.6571, -87.6798)).toBe('dp3su');
    const near = roughBoxCenter('dp3su')!;
    const zip = nearestZipArea(near.lat, near.lon)!;
    expect(Math.abs(zip.lat - 41.6571) + Math.abs(zip.lon - -87.6798)).toBeLessThan(0.06);
    expect(nearCells(zip).has(latLngToCell(41.6571, -87.6798, CORRIDOR_RES))).toBe(true);
  });
});

describe('the landing location script keeps to what the page says', () => {
  test('asks once per press, never watches, never asks for high accuracy', () => {
    expect(SCRIPT.match(/getCurrentPosition/g)?.length).toBe(1);
    expect(SCRIPT).not.toMatch(/watchPosition/);
    expect(SCRIPT).toMatch(/enableHighAccuracy:\s*false/);
    expect(SCRIPT).not.toMatch(/enableHighAccuracy:\s*true/);
  });

  test('phones only, and on its own only when already allowed and nothing was asked for', () => {
    expect(SCRIPT).toMatch(/matchMedia\('\(pointer: coarse\)'\)\.matches\)\s*return/);
    expect(SCRIPT).toMatch(/if \(state === 'granted' && fresh\) find\(\)/);
    expect(SCRIPT).toMatch(/var fresh = location\.search === ''/);
    expect(SCRIPT).toMatch(/if \(state === 'denied'\) return/);
    expect(SCRIPT).toMatch(/btn\.addEventListener\('click', find\)/);
  });

  test('sends only the box, in a form body to /near; stores nothing, sends nothing else', () => {
    expect(SCRIPT).toMatch(/form\.elements\.g\.value = roughBox\(/);
    expect(SCRIPT).toMatch(/form\.submit\(\)/);
    expect(LANDING_HTML).toMatch(
      /<form id="near-form" method="post" action="\/near" hidden>\s*<input type="hidden" name="g" \/>\s*<\/form>/
    );
    for (const banned of [
      /localStorage/,
      /sessionStorage/,
      /indexedDB/,
      /document\.cookie/,
      /fetch\s*\(/,
      /sendBeacon/,
      /XMLHttpRequest/,
      /coords\.accuracy/,
      /history\./,
    ]) {
      expect(SCRIPT, String(banned)).not.toMatch(banned);
    }
    // The box loop stops at 5 characters.
    expect(SCRIPT).toMatch(/while \(h\.length < 5\)/);
  });

  test('the button starts hidden and the note says what is used', () => {
    expect(LANDING_HTML).toMatch(/data-testid="near-me" hidden>/);
    expect(LANDING_HTML).toContain('We use only your zip area, never your exact spot.');
  });
});

describe('where renderers', () => {
  const at = (q: string) => readWhere(new URL(`https://t.test/${q}`));

  test('reads ?zip= and ?nozip=1', () => {
    expect(at('').kind).toBe('none');
    expect(at('?zip=').kind).toBe('none');
    expect(at('?zip=60406')).toMatchObject({ kind: 'zip', area: { zip: '60406' } });
    expect(at('?zip=99999')).toMatchObject({ kind: 'unknown-zip', typed: '99999' });
    expect(at('?nozip=1').kind).toBe('no-us-zip');
    expect(readWhere(null).kind).toBe('none');
  });

  test('a typed value is escaped wherever it is shown', () => {
    const state = at('?zip=' + encodeURIComponent('"><script>x</script>'));
    expect(state.kind).toBe('unknown-zip');
    const html = renderWhere(state);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('value=""');
  });

  test('the zip box is a plain GET search with a 5-digit pattern', () => {
    const html = renderWhere(at('?zip=60406'));
    expect(html).toMatch(/<form class="where-form" method="get" action="\/" role="search"/);
    expect(html).toMatch(/name="zip"/);
    expect(html).toMatch(/inputmode="numeric"/);
    expect(html).toMatch(/autocomplete="postal-code"/);
    expect(html).toMatch(/value="60406"/);
    expect(html).not.toMatch(/where-msg/);
    expect(renderWhere(at('?zip=99999'))).toMatch(/We couldn't find zip 99999/);
    expect(renderWhere(at('?nozip=1'))).toMatch(/couldn't find a US zip where you are/);
  });

  test('heading and empty state name the zip, and Change does not re-run location', () => {
    expect(renderAreaHeading(at(''))).toBe('Coming up');
    const h = renderAreaHeading(at('?zip=60406'));
    expect(h).toMatch(/^Near 60406 /);
    expect(h).toContain('href="/?change=1"');
    expect(renderNearEmpty('60406')).toMatch(/Nothing near 60406 yet/);
  });
});
