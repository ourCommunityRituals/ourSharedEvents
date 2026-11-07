/**
 * Search by place name first, then by zip (owner 2026-11-06).
 *
 * The landing page is the front door, and most people think of a town, not a
 * zip. So the search box takes a town or city name first and a zip second. One
 * name can be many places ("Springfield" is in 24 states): the search answers
 * with every match, labelled by town and state, for the person to choose from.
 * It never errors and never picks one silently.
 *
 * Covers: the town table (lib/place-names-data.ts), the name lookup
 * (lib/place-search.ts), the event test for a set of places, and the landing's
 * `?where=` reader and renderers (lib/landing-where.ts). Over HTTP:
 * tests/landing-where.spec.ts. Structural lock:
 * tests/e2e/0-architecture/place-name-search.invariant.spec.ts.
 *
 * @born-red place-name-search | method: each test run first against the code
 *   before the change (no place-search module, no ?where= reader: every test
 *   red), then against planted faults: findPlaces returning only the first
 *   match, the state suffix ignored, the owner's list not joined, placeKey
 *   without the saint/st fold, inZipsOwnArea without the nearest-zip bound,
 *   readWhere taking matches[0] for a many-match name; each turned a test red |
 *   date: 2026-11-06
 */
import { describe, test, expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';
import { PLACE_NAMES, PLACE_NAME_COUNT } from '../src/lib/place-names-data';
import { findPlaces, inPlaceMatches, placeKey, type PlaceMatch } from '../src/lib/place-search';
import { findZipArea, inZipOwnArea, inZipsOwnArea, type PlacedEvent } from '../src/lib/zip-areas';
import {
  readWhere,
  renderWhere,
  renderAreaHeading,
  renderPlaceEmpty,
} from '../src/lib/landing-where';

const at = (lat: number, lon: number, address: string | null = null): PlacedEvent => ({
  h3_res7: latLngToCell(lat, lon, CORRIDOR_RES),
  h3_res9: latLngToCell(lat, lon, 9),
  where_address: address,
});

const labels = (m: readonly PlaceMatch[]) => m.map((p) => p.label);

describe('town table', () => {
  const lines = PLACE_NAMES.split('\n').filter(Boolean);

  test('one line per town and state, with the count it states', () => {
    expect(lines.length).toBe(PLACE_NAME_COUNT);
    expect(PLACE_NAME_COUNT).toBeGreaterThan(25_000);
    for (const l of lines) expect(l).toMatch(/^[^|]{1,60}\|[A-Z]{2}\|\d{5}( \d{5})*$/);
  });

  test("is sorted by the Worker's own placeKey, then state, with no repeats", () => {
    const keyOf = (l: string) => `${placeKey(l.slice(0, l.indexOf('|')))}\u0000${l.split('|')[1]}`;
    for (let i = 1; i < lines.length; i++) {
      expect(keyOf(lines[i - 1]) < keyOf(lines[i]), `${lines[i - 1]} / ${lines[i]}`).toBe(true);
    }
  });
});

describe('placeKey', () => {
  test('folds case, dots, apostrophes, hyphens, accents and saint/mount/fort', () => {
    expect(placeKey('St. Louis')).toBe('st louis');
    expect(placeKey('Saint Louis')).toBe('st louis');
    expect(placeKey('Mount Prospect')).toBe(placeKey('Mt Prospect'));
    expect(placeKey('Fort Wayne')).toBe(placeKey('Ft. Wayne'));
    expect(placeKey('Española')).toBe('espanola');
    expect(placeKey('Winston-Salem')).toBe('winston salem');
    expect(placeKey("O'Fallon")).toBe('ofallon');
    expect(placeKey('  OAK   lawn ')).toBe('oak lawn');
  });
});

describe('findPlaces: one name, many places', () => {
  test('"Springfield" answers with every Springfield, labelled by town and state', () => {
    const m = findPlaces('Springfield');
    expect(m.length).toBeGreaterThanOrEqual(20);
    expect(labels(m)).toEqual(
      expect.arrayContaining([
        'Springfield, IL',
        'Springfield, MA',
        'Springfield, MO',
        'Springfield, OH',
      ])
    );
    // One choice per state, in state order, each with its zips.
    const states = m.map((p) => p.state);
    expect(new Set(states).size).toBe(states.length);
    expect([...states].sort()).toEqual(states);
    for (const p of m) {
      expect(p.name).toBe('Springfield');
      expect(p.label).toBe(`Springfield, ${p.state}`);
      expect(p.zips.length).toBeGreaterThan(0);
    }
    expect(m.find((p) => p.state === 'IL')?.zips).toContain('62701');
  });

  test('case and spaces do not matter', () => {
    expect(labels(findPlaces('  sPRINGFIELD '))).toEqual(labels(findPlaces('Springfield')));
  });

  test('a state narrows it to one: comma or not, code or name', () => {
    for (const q of [
      'Springfield, IL',
      'Springfield IL',
      'springfield, il',
      'Springfield Illinois',
      'Springfield, Illinois',
    ]) {
      expect(labels(findPlaces(q)), q).toEqual(['Springfield, IL']);
    }
    expect(labels(findPlaces('Washington DC'))).toEqual(['Washington, DC']);
    expect(labels(findPlaces('Charleston, West Virginia'))).toEqual(['Charleston, WV']);
    expect(findPlaces('Springfield, ZZ')).toEqual([]);
    expect(findPlaces('Springfield, AZ')).toEqual([]);
  });

  test('a name in one state is one place', () => {
    const m = findPlaces('Oak Lawn');
    expect(labels(m)).toEqual(['Oak Lawn, IL']);
    // The owner's zips for Oak Lawn (place-names.ts) are part of it.
    expect(m[0].zips).toEqual(
      expect.arrayContaining(['60453', '60454', '60455', '60457', '60458'])
    );
  });

  test("the owner's neighbourhoods join the national list", () => {
    const beverly = findPlaces('Beverly');
    expect(beverly.length).toBeGreaterThanOrEqual(8);
    const il = beverly.find((p) => p.state === 'IL');
    expect(il?.label).toBe('Beverly, IL');
    expect([...(il?.zips ?? [])].sort()).toEqual(['60620', '60643', '60655']);
    expect(labels(beverly)).toEqual(expect.arrayContaining(['Beverly, MA', 'Beverly, NJ']));
    expect(labels(findPlaces('Mt. Greenwood'))).toEqual(['Mount Greenwood, IL']);
    expect(labels(findPlaces('Auburn Gresham, IL'))).toEqual(['Auburn Gresham, IL']);
  });

  test('saint and st are the same name', () => {
    expect(labels(findPlaces('St. Louis'))).toContain('Saint Louis, MO');
    expect(labels(findPlaces('st louis mo'))).toEqual(['Saint Louis, MO']);
  });

  test('a two-state city lists both', () => {
    expect(labels(findPlaces('Kansas City'))).toEqual(
      expect.arrayContaining(['Kansas City, KS', 'Kansas City, MO'])
    );
  });

  test('only a whole name is a place; zips, coordinates and junk are not', () => {
    for (const q of [
      '',
      '   ',
      'Springf',
      'Oak Law',
      '60453',
      '41.6571,-87.6798',
      '41.6571 -87.6798',
      'Nowhereville',
      'x'.repeat(200),
    ]) {
      expect(findPlaces(q), q).toEqual([]);
    }
    expect(findPlaces(undefined)).toEqual([]);
    expect(findPlaces(42)).toEqual([]);
  });
});

describe('inPlaceMatches: the events of a set of places', () => {
  const springfieldIL = at(39.7817, -89.6501);
  const springfieldMA = at(42.1015, -72.5898);
  const chicago = at(41.8781, -87.6298);
  const oakLawnPoBox = at(41.711, -87.758, '1 Main St, Oak Lawn, IL 60454');

  test('every Springfield lists the events of all of them, and nothing else', () => {
    const inAny = inPlaceMatches(findPlaces('Springfield'));
    expect(inAny(springfieldIL)).toBe(true);
    expect(inAny(springfieldMA)).toBe(true);
    expect(inAny(chicago)).toBe(false);
  });

  test('one Springfield lists only its own', () => {
    const inIL = inPlaceMatches(findPlaces('Springfield, IL'));
    expect(inIL(springfieldIL)).toBe(true);
    expect(inIL(springfieldMA)).toBe(false);
  });

  test('a zip with no Census area still matches by the address', () => {
    expect(findZipArea('60454')).toBeNull();
    expect(inPlaceMatches(findPlaces('Oak Lawn'))(oakLawnPoBox)).toBe(true);
  });

  test('no matches lists nothing', () => {
    expect(inPlaceMatches([])(springfieldIL)).toBe(false);
  });
});

describe('inZipsOwnArea: many zips at once, same answer as one at a time', () => {
  test('agrees with inZipOwnArea for each zip of a city, over a grid of events', () => {
    const zips = ['60453', '60455', '60457', '60458', '60805', '60655', '60643'];
    const areas = zips.map((z) => findZipArea(z)!).filter(Boolean);
    const together = inZipsOwnArea(areas);
    const apart = areas.map((a) => inZipOwnArea(a));
    for (let lat = 41.66; lat <= 41.74; lat += 0.008) {
      for (let lon = -87.8; lon <= -87.66; lon += 0.008) {
        const e = at(lat, lon);
        expect(together(e), `${lat},${lon}`).toBe(apart.some((t) => t(e)));
      }
    }
  });

  test('agrees across a set that spans towns far apart', () => {
    const areas = ['62701', '62704', '01103', '60453'].map((z) => findZipArea(z)!);
    const together = inZipsOwnArea(areas);
    const apart = areas.map((a) => inZipOwnArea(a));
    for (const [lat, lon] of [
      [39.7817, -89.6501],
      [39.75, -89.7],
      [42.1015, -72.5898],
      [41.711, -87.758],
      [41.8781, -87.6298],
      [40.7128, -74.006],
    ]) {
      const e = at(lat, lon);
      expect(together(e), `${lat},${lon}`).toBe(apart.some((t) => t(e)));
    }
  });

  test('no zips: no event', () => {
    expect(inZipsOwnArea([])(at(41.7, -87.7))).toBe(false);
  });
});

describe('the landing reads ?where=: name first, then zip', () => {
  const where = (q: string) => readWhere(new URL(`https://t.test/${q}`));

  test('a many-place name is a choice, never an error or a silent pick', () => {
    const s = where('?where=Springfield');
    expect(s.kind).toBe('choose');
    if (s.kind !== 'choose') return;
    expect(s.typed).toBe('Springfield');
    expect(s.matches.length).toBeGreaterThanOrEqual(20);
  });

  test('a one-place name is that place', () => {
    expect(where('?where=Oak%20Lawn')).toMatchObject({
      kind: 'place',
      place: { label: 'Oak Lawn, IL' },
    });
    expect(where('?where=Springfield%2C%20IL')).toMatchObject({
      kind: 'place',
      place: { label: 'Springfield, IL' },
    });
  });

  test('a zip is still a zip, typed in the same box', () => {
    expect(where('?where=60406')).toMatchObject({ kind: 'zip', area: { zip: '60406' } });
    expect(where('?where=99999')).toMatchObject({ kind: 'unknown-zip', typed: '99999' });
  });

  test('an unknown name says so; coordinates are never read', () => {
    expect(where('?where=Nowhereville')).toMatchObject({
      kind: 'unknown-place',
      typed: 'Nowhereville',
    });
    expect(where('?where=' + encodeURIComponent('41.6571,-87.6798')).kind).toBe('unknown-place');
  });

  test('the whole value is looked up; only the echo is cut to fit the box', () => {
    // A long value must not become a place by losing its tail: "Oak Lawn", 52
    // spaces and a digit is over 60 characters and has a digit, so no place.
    const long = 'Oak Lawn' + ' '.repeat(52) + '1';
    const s = where('?where=' + encodeURIComponent(long));
    expect(s.kind).toBe('unknown-place');
    if (s.kind !== 'unknown-place') return;
    expect(s.typed.length).toBeLessThanOrEqual(60);
    expect(where('?where=' + encodeURIComponent('Oak Lawn' + 'x'.repeat(60))).kind).toBe(
      'unknown-place'
    );
  });

  test('where wins over zip; an empty where falls back to zip, as /near sends', () => {
    expect(where('?where=Oak%20Lawn&zip=60406').kind).toBe('place');
    expect(where('?where=&zip=60406')).toMatchObject({ kind: 'zip', area: { zip: '60406' } });
    expect(where('?where=').kind).toBe('none');
  });

  test('the box asks for a town first, and takes a zip too', () => {
    const html = renderWhere(where(''));
    expect(html).toMatch(/<form class="where-form" method="get" action="\/" role="search"/);
    expect(html).toMatch(/name="where"/);
    expect(html).toMatch(/<label for="where-input" class="where-label">Town or zip code<\/label>/);
    expect(html).toMatch(/autocomplete="address-level2"/);
    expect(html).not.toMatch(/inputmode="numeric"/);
    expect(html).not.toMatch(/pattern=/);
    expect(html).toContain('href="https://www.geonames.org/"');
  });

  test('the choice lists every match as a link that narrows to it', () => {
    const s = where('?where=Springfield');
    const html = renderWhere(s);
    const n = s.kind === 'choose' ? s.matches.length : 0;
    expect(html).toContain('data-testid="where-choices"');
    expect(html.match(/data-testid="where-choice"/g)?.length).toBe(n);
    expect(html).toContain(`${n} places are called Springfield. Pick yours:`);
    expect(html).toContain('href="/?where=Springfield%2C%20IL"');
    expect(html).toContain('>Springfield, IL</a>');
    expect(html).not.toMatch(/where-msg/);
    expect(html).toContain('value="Springfield"');
  });

  test('a place keeps its name in the box; an unknown name says what to try', () => {
    expect(renderWhere(where('?where=Oak%20Lawn'))).toContain('value="Oak Lawn, IL"');
    expect(renderWhere(where('?where=Nowhereville'))).toMatch(
      /We couldn't find a place called Nowhereville\. Check the spelling, or type a zip code\./
    );
  });

  test('a typed name is escaped wherever it is shown', () => {
    const s = where('?where=' + encodeURIComponent('"><script>x</script>'));
    const html = renderWhere(s) + renderAreaHeading(s);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('heading and empty state name the place or the name', () => {
    expect(renderAreaHeading(where('?where=Oak%20Lawn'))).toMatch(/^Near Oak Lawn, IL /);
    expect(renderAreaHeading(where('?where=Springfield'))).toMatch(
      /^In every place called Springfield /
    );
    expect(renderAreaHeading(where('?where=Springfield'))).toContain('href="/?change=1"');
    expect(renderPlaceEmpty('Oak Lawn, IL')).toMatch(/Nothing in Oak Lawn, IL yet/);
  });
});
