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
 */
import { describe, test, expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import LANDING_HTML from '../src/templates/landing.html';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';
import {
  findZipArea,
  nearestZipArea,
  nearCells,
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

  test('"near" is the zip cell and 8 rings of res-7 cells around it', () => {
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
    // next to Blue Island); the 10-mile ring around either covers both.
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
