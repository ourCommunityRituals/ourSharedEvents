/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own Bruno cases, specs and workflow */
/**
 * The staging street-map cases, run here against pages built for each state.
 *
 * Street-map CCR 2026-11-15, two findings:
 *   R21  Staging cases required the "street map is not here" note on an area the
 *        archive covers, and read no flag. Loading the archive would have turned
 *        T2 and T4 red on correct behaviour, for every branch. The CCR named two
 *        (the folder 16 list case, and one line of the T4k spec). Run against a
 *        local Worker with a street layer, the load reddened more: the folder 16
 *        link sweep and the T4k link walk (the map credit's two links), and the
 *        four T4k axe scans (contrast axe cannot decide once streets are drawn).
 *   R17  The three street cases took any path as "streets". A layer of 8,999
 *        points of water and one point of road passed.
 *
 * This file is the mock layer of those cases. It takes each case's own
 * after-response script out of its YAML file and runs it, with Bruno's `res`,
 * `bru`, `test` and `expect` (the chai Bruno ships), against a page in each state
 * and with the flag "false" and "true". The staging layer is the cases themselves
 * in T2, and tests/e2e/3-flows/map-place-panel.spec.ts in T4k.
 *
 * The rule the cases hold: the zoomed area is one of two whole pages, the note
 * with no drawing, or the dot map over a street layer of real roads. While
 * `streetMapArchiveLoaded` is "false" either page passes (so the load itself
 * turns nothing red); once it is "true" a page with no street layer fails.
 *
 * BORN RED (2026-11-15). Every "fails" test below feeds a fault to the real
 * script. Then the scripts, the spec and the helper were faulted, one at a time,
 * this file run, and the fault taken out. What is written is what was seen:
 *   C1  landing: the road test back to any path, `as-(w|v|r as-[123])`
 *         -> landing "water alone", "the measured wrong layer", "minor roads
 *            alone", "49 commands", and "the three cases share one floor"
 *   C2  area: ROAD_FLOOR set to 1
 *         -> area "the measured wrong layer", "49 commands", and "share one floor"
 *   C3  API: roadCommands counts every path, water too
 *         -> API "the measured wrong layer", and "share one floor"
 *   C4  folder 16: the flag never binds (`if (false)`)
 *         -> "flag true, no street layer: fails by name"
 *   C5  folder 16: the note assertion removed from the no-street test
 *         -> "flag false, neither note nor drawing: fails"
 *   C6  folder 16: the case as it was on main (requires the note, reads no flag)
 *         -> 12 tests, "the load day" among them
 *   C7  folder 16: the "no note" line removed from the street-layer test
 *         -> "a street layer and the note together: fails"
 *   C8  landing: the no-map branch back to a bare console.log
 *         -> both "the landing draws no map" tests, and "every state prints"
 *   C9  link sweep: the credit links known with no streets too
 *         -> "the credit links on a page with no street layer: fails"
 *   C10 link sweep: the case as it was on main
 *         -> 4 tests, "the load day" among them
 *   C11 link sweep: the credit matched by host, not by address
 *         -> "with streets, any other outside link still fails"
 *   F1  flag module: any value is taken        -> '"true" and "false" are read'
 *   W1  workflow: `--env-var "streetMapArchiveLoaded=true"` on the Pages run
 *         -> "the workflow passes the flag to no one"
 *   H1  helper: the flag read from process.env -> "the Playwright helper reads the flag"
 *   H2  spec: the bare note assertion put back
 *   H3  helper: the flag no longer stops a page with no streets
 *   H4  helper: the note is not looked for
 *         -> each: "the spec reads the drawing through the helper"
 *   H5  spec: the credit links expected on every page -> "the link walk expects"
 *   H6  spec: text on the map never fails, whatever the flag
 *   H7  spec: a failure found with the street layer hidden is dropped
 *   H8  spec: with streets, nothing undecided ever fails (first run: NOTHING
 *       failed; three lines of sortUndecided were then pinned below)
 *         -> each: "the axe scan sets apart only text drawn on the map"
 *   (H6 to H8 as the spec was until 2026-11-16, when "axe cannot decide" on the
 *   map stopped being the verdict. The same test now holds the lines below.)
 *
 * The map's text judged by measurement (2026-11-16, R27). The spec was faulted,
 * one fault at a time, this file run, and the fault taken out:
 *   K1  spec: a failure of the judge never binds (the flag is not asked)
 *   K2  spec: the judge is not called
 *   K3  spec: a text the judge does not know is not looked for
 *   K4  spec: the number of dot numbers read is not held to the places
 *   K5  spec: a node in the drawing with no text in it is handed to the judge
 *   K5b spec: such a node no longer stays undecided
 *   K6  spec: with no street layer, text set apart as "on the map" is let through
 *   K7  spec: the warning says nothing of what failed
 *   K8  spec: every node of the drawing is taken to hold text
 *         -> each: "the axe scan sets apart only text drawn on the map, and a
 *            measured judge decides it"
 *
 * The right place (2026-11-16, R17): the area-map case holds the layer to a
 * named town of the area (streetMapTownAnchor). Faulted the same way:
 *   A1  api: the distance is not asked (any place for the name passes)
 *   A2  api: ANCHOR_UNITS 30 to 300
 *   A3  api: any town name passes (the name is not compared)
 *   A4  api: with the flag "true" an empty anchor is let through
 *   A5  api: the anchor is not held to the frame
 *   A6  api: longitude projected with the sign turned
 *   A7  api: the anchor-empty NOT RUN test asserts nothing
 *         -> __A__
 *
 * These read the spec's source. What the judge does in a browser is seen in
 * tests/e2e/2-pages/street-map-contrast.component.spec.ts; no run of the spec
 * has judged a text on staging, where no street is drawn yet.
 *
 * The switch (R20), added 2026-11-15 and faulted the same way:
 *   S1  API: the off assertion (streets null) removed
 *         -> api "off, and the Worker drew a street layer all the same"
 *   S2  landing: the off assertions (no layer, no credit) removed
 *         -> landing "off, and the Worker drew ..." and "off, and the credit shown"
 *   S3  both: any word taken for the copy (the oneOf line removed)
 *         -> both "the copy missing or mistyped"
 *   S4  API: the test name always says on -> api "the test name says off", and S1's test
 *   S5  landing: the copy not read (always "on") -> 6 tests, "both cases read the copy" among them
 *   S6  workflow: `--env-var "streetMapSwitch=on"` on the Pages run
 *         -> "the workflow passes the copy to no one"
 *
 * NOT RUN as a test name (2026-11-15). The cases printed NOT RUN with console.log,
 * which no report keeps: the JUnit file and the check built from it hold test
 * names only. It is now a test of the same words, and it passes only while the
 * flag is exactly "false". Faulted the same way:
 *   N0  all four cases as they were on main (console.log)
 *         -> 17 tests: each case's "flag false" test, the five "passes under the
 *            name" tests, the five "flag missing or mistyped" tests, "no Pages
 *            case prints NOT RUN with console.log" and "names NOT RUN in a test"
 *   N1  api: the NOT RUN test back to a console.log
 *         -> 5 tests, all the API case's, the last two of N0 among them
 *   N2  area: the NOT RUN test asserts nothing (an empty body)
 *         -> "area, flag missing or mistyped: the NOT RUN test fails by name" alone:
 *            a NOT RUN test that cannot fail is caught by that test only
 *   N3  zoom16: the NOT RUN test also runs when the flag is "true"
 *         -> "flag true, no street layer: fails by name", and zoom16's "flag
 *            missing or mistyped" and "flag true: no NOT RUN test"
 *   N4  landing: the no-map NOT RUN test dropped
 *         -> the three tests of the landing that draws no map
 *
 * The H tests only read the Playwright source. What it does was seen in Chromium
 * against a local Worker (wrangler dev, local D1 with the two fixtures, a
 * synthetic archive in local R2), in three states: no archive, streets, and a
 * water-only layer. That record is the BORN RED 2026-11-15 block in
 * tests/e2e/3-flows/map-place-panel.spec.ts.
 */
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');
const chai = require('chai');

const ROOT = join(__dirname, '..', '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const PAGES = ['bruno', 'ose-pages'];
const CASE = {
  landing: [...PAGES, '1. Landing - Public', 'GET - (landing) - draws streets under the map.yml'],
  area: [
    ...PAGES,
    '1. Landing - Public',
    'GET - (landing) area 872664570ffffff - one area over its streets.yml',
  ],
  api: [
    ...PAGES,
    '15. Public Area Map (OSE-2039)',
    'OSE-2039 - map areas - frame, hexagons and streets.yml',
  ],
  zoom16: [
    ...PAGES,
    '16. Landing Map Zoom (OSE-1886 OSE-1891 OSE-1896)',
    'OSE-1891 - GET area (seeded) - zoomed list, a panel per place, dots only over streets.yml',
  ],
  sweep16: [
    ...PAGES,
    '16. Landing Map Zoom (OSE-1886 OSE-1891 OSE-1896)',
    'OSE-1896 - GET area (seeded) - no map link reaches tracking or check-in.yml',
  ],
};
/** The cases that assert on the street layer itself, and so read the flag. */
const STREET_CASES = ['landing', 'area', 'api', 'zoom16'];
const scriptOf = (which) =>
  yaml.load(read(...CASE[which])).runtime.scripts.find((s) => s.type === 'after-response').code;

// Test names, as the cases print them.
const ROADS =
  'The street layer holds roads: 50 path commands or more of highway or major road (water alone fails)';
const BINDING = 'The street layer is drawn (streetMapArchiveLoaded is true for this environment)';
const Z16_STREETS =
  'With a street layer: the area and a dot per place are drawn over it, and no "not here" note';
const Z16_LIST =
  'With no street layer: says the street map is not here (amap-no-tiles) and draws no dot map';
const AREA_DOT = 'The dot is drawn over the street layer of that area';
const AREA_LIST = 'Without streets the places are a list: no dot, no bare hexagon, no credit';
const LANDING_SOFT = 'Without streets the map is hexagons only, with no OpenStreetMap credit';
const LANDING_NO_MAP =
  'The landing draws no map, and so no street layer and no OpenStreetMap credit';
const LANDING_MAP_BINDING =
  'The landing draws its map, so its streets can be checked (streetMapArchiveLoaded is true for this environment)';
const API_SOFT = 'Without streets the answer is still the hexagons, and streets is null';
// What was not checked, by case. The words are the ones the cases printed with
// console.log before; each is now the name of a test.
const NOT_LOADED =
  'NOT RUN (street-map archive not loaded on this environment: streetMapArchiveLoaded is not true): ';
const NOT_RUN = {
  landing:
    NOT_LOADED + 'street layer under the hexagons, OpenStreetMap credit, no third-party host',
  landingNoMap:
    'NOT RUN (the landing draws no map: fewer than 10 events on this environment): street layer under the hexagons',
  area: NOT_LOADED + 'dots over the street layer, OpenStreetMap credit',
  api: NOT_LOADED + 'street layer paths, CSS, OpenStreetMap credit, no third-party host',
  zoom16: NOT_LOADED + 'the area and a dot per place over the street layer',
};

/**
 * Run one case's script the way Bruno does: its `test()` calls are collected,
 * a throwing one is a failure, and `console.log` lines are kept.
 */
function run(which, opts) {
  const { body, flag, status = 200 } = opts;
  const sw = 'sw' in opts ? opts.sw : 'on';
  const out = { passed: [], failed: [], logs: [] };
  const res = { getStatus: () => status, getBody: () => body, getHeader: () => undefined };
  // `sw` is streetMapSwitch, the copy of staging's STREET_MAP. "on" unless a
  // test says otherwise: the pages built below are what a Worker set to draw
  // answers with.
  // The town that holds the area-map case to its place. Set unless a test says
  // otherwise: the answers built below draw MOKENA where it is.
  const anchor = 'anchor' in opts ? opts.anchor : ANCHOR;
  const vars = { streetMapArchiveLoaded: flag, streetMapSwitch: sw, streetMapTownAnchor: anchor };
  const bru = { getEnvVar: (name) => vars[name] };
  const test = (name, fn) => {
    try {
      fn();
      out.passed.push(name);
    } catch (err) {
      out.failed.push(name);
      out.logs.push(`FAILED ${name}: ${err.message}`);
    }
  };
  const log = { log: (...a) => out.logs.push(a.join(' ')) };
  // The text run here is the case's own script, read from this repository: the
  // same text `bru run` executes in T2. Nothing from outside the checkout reaches it.
  new Function('res', 'bru', 'test', 'expect', 'console', scriptOf(which))(
    res,
    bru,
    test,
    chai.expect,
    log
  );
  return out;
}
/** The NOT RUN tests that passed: what the run says, by name, it did not check. */
const notRun = (r) => r.passed.filter((n) => n.startsWith('NOT RUN'));
/** Every test name that says NOT RUN, passed or failed. */
const notRunNamed = (r) => r.passed.concat(r.failed).filter((n) => n.includes('NOT RUN'));
/** A NOT RUN line that was only printed: no report keeps it. */
const notRunPrinted = (r) =>
  r.logs.filter((l) => l.includes('NOT RUN') && !l.startsWith('FAILED '));

// ── pages in each state, in the markup lib/attendee-map.ts and lib/street-map.ts write ──

/** Path data of `n` commands: one M, then L. */
const cmds = (n) => 'M0 0' + 'L9 9'.repeat(Math.max(0, n - 1));
const path = (cls, n, close = '') => (n > 0 ? `<path class="${cls}" d="${cmds(n)}${close}"/>` : '');

/** The street layer with this many path commands per class. */
const layer = ({
  water = 0,
  rivers = 0,
  minor = 0,
  major = 0,
  highway = 0,
  town = 'Mokena',
  at = [300, 180],
} = {}) =>
  '<g class="amap-s" aria-hidden="true" data-testid="amap-streets" data-z="12">' +
  '<rect class="as-l" width="600" height="360"/>' +
  path('as-w', water, 'Z') +
  path('as-v', rivers) +
  path('as-r as-1', minor) +
  path('as-r as-2', major) +
  path('as-r as-3', highway) +
  `<text class="as-t" x="${at[0]}" y="${at[1]}" text-anchor="middle">${town}</text></g>`;

const GOOD = layer({ water: 300, minor: 900, major: 40, highway: 30 });
const WATER_ONLY = layer({ water: 8999 });
/** The frame the CCR measured (19 areas over Manhattan): 8,999 of water, 1 of road. */
const MEASURED_WRONG = layer({ water: 8999, major: 1 });
const MINOR_ONLY = layer({ water: 100, minor: 2000 });

const CREDIT =
  '<p class="amap-credit" data-testid="amap-credit">© <a href="https://www.openstreetmap.org/copyright/en">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a></p>';
const NOTE =
  '<div class="map-placeholder" data-testid="amap-no-tiles" role="status"><p>The street map is not here yet.</p></div>';
const dot = (n) =>
  `<a href="#amap-dot-${n}" class="amap-f amap-d${n}" data-testid="amap-dot" data-exact="1" data-count="1"><title>Place ${n}</title><circle class="amap-dot" cx="10.0" cy="10.0" r="14"/></a>`;

/**
 * The zoomed landing: `streets` is a layer or '', `dots` how many dots are drawn.
 * `credit` puts the credit on a page with no streets, and `extra` is more markup
 * inside the zoomed part; both are faults.
 */
function zoomPage(
  cell,
  { streets = '', note = false, dots = 0, zone = Boolean(streets), credit = false, extra = '' } = {}
) {
  const svg =
    streets || dots || zone
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360" role="group" aria-labelledby="amap-caption" data-testid="amap-svg">' +
        streets +
        (zone
          ? `<polygon class="amap-zone" points="1.0,1.0 2.0,2.0" data-testid="amap-zone" data-cell="${cell}"/>`
          : '') +
        Array.from({ length: dots }, (_, i) => dot(i + 1)).join('') +
        '</svg>'
      : '';
  const rows = [1, 2, 3]
    .map(
      (n) =>
        `<li value="${n}" data-testid="amap-legend-dot"><a class="amap-zoom" href="#amap-dot-${n}" data-testid="amap-place-link">Place ${n}</a>: Zip Own Area Check (Mount Greenwood)</li>`
    )
    .join('');
  return (
    '<html lang="en"><body><h1>Events near you</h1>' +
    `<div class="amap-wrap" data-testid="amap-wrap"><figure class="amap" data-testid="amap" data-zoom="${cell}">` +
    '<p><a class="amap-back" href="/" data-testid="amap-back">All areas</a></p>' +
    svg +
    (note ? NOTE : '') +
    `<ol class="amap-legend" id="amap-places" data-testid="amap-legend">${rows}</ol>` +
    '<figcaption id="amap-caption" data-testid="amap-caption">3 events</figcaption>' +
    (streets || credit ? CREDIT : '') +
    extra +
    '</figure></div><script data-testid="share-script"></script></body></html>'
  );
}

/** The landing with its hexagon map (or, with `map: false`, its list only). */
function landingPage({ streets = '', map = true } = {}) {
  const svg = map
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360" role="img" aria-labelledby="amap-caption" data-testid="amap-svg">' +
      streets +
      '<a href="/?area=872664570ffffff" data-testid="amap-area-link"><polygon data-testid="amap-area" data-cell="872664570ffffff" points="1,1 2,2"/></a></svg>'
    : '';
  return `<html lang="en"><body><h1>Events near you</h1><figure class="amap" data-testid="amap">${svg}</figure>${streets ? CREDIT : ''}</body></html>`;
}

/** Latitude and longitude to Web Mercator world units (lib/street-map.ts, toWorld). */
const toWorld = (lat, lng) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};
/** A town, its point, and the anchor line that names it. */
const MOKENA = { name: 'Mokena', lat: 41.5261, lng: -87.8892 };
const anchorLine = (town) => `${town.name}|${town.lat}|${town.lng}`;
const ANCHOR = anchorLine(MOKENA);
/** A frame about 9 km wide that puts `town` at (x, y). */
const frameWith = (town, x = 300, y = 180) => {
  const scale = 4_000_000;
  const [wx, wy] = toWorld(town.lat, town.lng);
  return {
    projection: 'web-mercator',
    w: 600,
    h: 360,
    scale,
    x0: wx - x / scale,
    y0: wy - y / scale,
  };
};

/** GET /api/v2/map/areas?cells=872664570ffffff&around=1 */
function areasAnswer(streets) {
  const points = '1,1 2,2 3,3 4,4 5,5 6,6';
  return {
    ok: true,
    status: 200,
    // Mokena is at the middle of the frame, where `layer()` names it.
    frame: frameWith(MOKENA),
    areas: [{ cell: '872664570ffffff', n: 1, points, centre: [3, 3] }],
    around: Array.from({ length: 6 }, (_, i) => ({ cell: `87266457${i + 1}ffffff`, points })),
    streets: streets
      ? { svg: streets, css: '.as-r{stroke:var(--border-strong)}', credit: { html: CREDIT } }
      : null,
  };
}

const Z16 = '872664405ffffff';
const MG = '872664570ffffff';

describe('the zoomed seeded area reads the flag (folder 16, R21)', () => {
  const page = (opts) => zoomPage(Z16, opts);

  test('flag false, the note and no drawing: passes, and says what did not run', () => {
    const r = run('zoom16', { body: page({ note: true }), flag: 'false' });
    expect(r.passed).toContain(Z16_LIST);
    expect(r.failed).not.toContain(Z16_LIST);
    expect(r.passed.concat(r.failed)).not.toContain(BINDING);
    expect(notRun(r)).toEqual([NOT_RUN.zoom16]);
  });

  test('the load day: flag still false, the dot map over streets passes', () => {
    const r = run('zoom16', { body: page({ streets: GOOD, dots: 3 }), flag: 'false' });
    expect(r.passed).toContain(Z16_STREETS);
    expect(r.failed.filter((n) => [Z16_STREETS, Z16_LIST, BINDING].includes(n))).toEqual([]);
    expect(notRun(r)).toEqual([]);
  });

  test('flag true, the dot map over streets: passes', () => {
    const r = run('zoom16', { body: page({ streets: GOOD, dots: 3 }), flag: 'true' });
    expect(r.passed).toContain(Z16_STREETS);
    expect(r.passed.concat(r.failed)).not.toContain(Z16_LIST);
  });

  test('flag true, no street layer: fails by name', () => {
    const r = run('zoom16', { body: page({ note: true }), flag: 'true' });
    expect(r.failed).toContain(BINDING);
    expect(notRun(r)).toEqual([]);
  });

  test('flag false, neither note nor drawing: fails', () => {
    const r = run('zoom16', { body: page({}), flag: 'false' });
    expect(r.failed).toContain(Z16_LIST);
  });

  test('a street layer and the note together: fails', () => {
    const r = run('zoom16', { body: page({ streets: GOOD, dots: 3, note: true }), flag: 'true' });
    expect(r.failed).toContain(Z16_STREETS);
  });

  test('a street layer with no dot, or a dot short: fails', () => {
    for (const dots of [0, 2]) {
      const r = run('zoom16', { body: page({ streets: GOOD, dots }), flag: 'true' });
      expect(r.failed).toContain(Z16_STREETS);
    }
  });

  test('a street layer with no outline of the area: fails', () => {
    const r = run('zoom16', { body: page({ streets: GOOD, dots: 3, zone: false }), flag: 'true' });
    expect(r.failed).toContain(Z16_STREETS);
  });

  test('dots drawn with no street layer under them: fails', () => {
    const r = run('zoom16', { body: page({ dots: 3, zone: true, note: true }), flag: 'false' });
    expect(r.failed).toContain(Z16_LIST);
  });
});

describe('the link sweep of the zoomed area knows the map credit, with streets only (folder 16, R21)', () => {
  const SWEEP =
    'Every link is a place on this page, an event page, a register form or an https site (with streets: or the map credit)';
  const sweep = (opts) => run('sweep16', { body: zoomPage(Z16, opts), flag: 'false' });

  test('no streets and no credit: passes', () => {
    expect(sweep({ note: true }).passed).toContain(SWEEP);
  });

  test('the load day: streets and their two credit links pass', () => {
    expect(sweep({ streets: GOOD, dots: 3 }).passed).toContain(SWEEP);
  });

  test('the credit links on a page with no street layer: fails', () => {
    expect(sweep({ note: true, credit: true }).failed).toContain(SWEEP);
  });

  test('with streets, any other outside link still fails', () => {
    for (const href of [
      'https://tile.openstreetmap.org/1/2/3.png',
      'https://www.openstreetmap.org/copyright/pl',
      'https://protomaps.com/pricing',
      '/s/mzPub1',
    ]) {
      const r = sweep({ streets: GOOD, dots: 3, extra: `<a href="${href}">x</a>` });
      expect(r.failed, href).toContain(SWEEP);
    }
  });
});

describe('the street cases need roads, not any path (R17)', () => {
  const bodies = {
    landing: (streets) => landingPage({ streets }),
    area: (streets) => zoomPage(MG, { streets, dots: 1 }),
    api: (streets) => areasAnswer(streets),
  };

  for (const which of ['landing', 'area', 'api']) {
    describe(`${which} case`, () => {
      const roads = (streets, flag = 'true') => run(which, { body: bodies[which](streets), flag });

      test('highways and major roads over the floor: passes, in both states of the flag', () => {
        for (const flag of ['false', 'true']) {
          const r = roads(GOOD, flag);
          expect(r.passed).toContain(ROADS);
          expect(r.failed).toEqual([]);
          expect(notRun(r)).toEqual([]);
        }
      });

      test('water alone: fails', () => {
        expect(roads(WATER_ONLY).failed).toContain(ROADS);
      });

      test('the measured wrong layer (8,999 of water, 1 of road): fails', () => {
        expect(roads(MEASURED_WRONG).failed).toContain(ROADS);
        // And with the flag still "false": a wrong map is wrong before it is binding.
        expect(roads(MEASURED_WRONG, 'false').failed).toContain(ROADS);
      });

      test('minor roads alone: fails', () => {
        expect(roads(MINOR_ONLY).failed).toContain(ROADS);
      });

      test('49 commands of highway and major road fail, 50 pass', () => {
        expect(roads(layer({ major: 20, highway: 29 })).failed).toContain(ROADS);
        expect(roads(layer({ major: 20, highway: 30 })).passed).toContain(ROADS);
        expect(roads(layer({ highway: 50 })).passed).toContain(ROADS);
        expect(roads(layer({ major: 50 })).passed).toContain(ROADS);
      });
    });
  }

  test('the three cases share one floor and one count', () => {
    const count =
      /const ROAD_FLOOR = 50;\n\s*const roadCommands = function \(layer\) \{[\s\S]*?\n\s*\};/;
    const texts = ['landing', 'area', 'api'].map((w) => scriptOf(w).match(count)?.[0]);
    expect(texts[0]).toBeTruthy();
    expect(texts[0]).toContain('/<path class="as-r as-[23]" d="[^"]*"/g');
    expect(texts[1].replace(/\s+/g, ' ')).toBe(texts[0].replace(/\s+/g, ' '));
    expect(texts[2].replace(/\s+/g, ' ')).toBe(texts[0].replace(/\s+/g, ' '));
    for (const w of ['landing', 'area', 'api']) {
      expect(scriptOf(w)).not.toContain('as-(w|v|r as-[123])');
    }
  });
});

describe('no streets: a named test prints in both states of the flag', () => {
  test('area case: the list page passes with the flag false and fails by name with it true', () => {
    const body = zoomPage(MG, { note: true });
    const off = run('area', { body, flag: 'false' });
    expect(off.passed).toContain(AREA_LIST);
    expect(off.failed).toEqual([]);
    expect(notRun(off)).toEqual([NOT_RUN.area]);
    const on = run('area', { body, flag: 'true' });
    expect(on.failed).toEqual([BINDING]);
    expect(notRun(on)).toEqual([]);
  });

  test('area case: with streets the dot test runs and the note must be gone', () => {
    const ok = run('area', { body: zoomPage(MG, { streets: GOOD, dots: 1 }), flag: 'false' });
    expect(ok.passed).toEqual(expect.arrayContaining([AREA_DOT, ROADS]));
    const half = run('area', {
      body: zoomPage(MG, { streets: GOOD, dots: 1, note: true }),
      flag: 'false',
    });
    expect(half.failed).toContain(AREA_DOT);
  });

  test('landing case: hexagons only passes with the flag false and fails by name with it true', () => {
    const body = landingPage({});
    const off = run('landing', { body, flag: 'false' });
    expect(off.passed).toContain(LANDING_SOFT);
    expect(off.failed).toEqual([]);
    expect(notRun(off)).toEqual([NOT_RUN.landing]);
    const on = run('landing', { body, flag: 'true' });
    expect(on.failed).toEqual([BINDING]);
  });

  test('the landing draws no map, flag false: a named test passes and a NOT RUN test says so', () => {
    const r = run('landing', { body: landingPage({ map: false }), flag: 'false' });
    expect(r.passed).toContain(LANDING_NO_MAP);
    expect(r.failed).toEqual([]);
    expect(notRun(r)).toEqual([NOT_RUN.landingNoMap]);
  });

  test('the landing draws no map, flag true: fails by name, not a printed line', () => {
    const r = run('landing', { body: landingPage({ map: false }), flag: 'true' });
    expect(r.failed).toEqual([LANDING_MAP_BINDING]);
    expect(notRun(r)).toEqual([]);
  });

  test('API case: streets null passes with the flag false and fails by name with it true', () => {
    const off = run('api', { body: areasAnswer(''), flag: 'false' });
    expect(off.passed).toContain(API_SOFT);
    expect(off.failed).toEqual([]);
    expect(notRun(off)).toEqual([NOT_RUN.api]);
    const on = run('api', { body: areasAnswer(''), flag: 'true' });
    expect(on.failed).toEqual([BINDING]);
  });

  test('every state of every case prints a street-map test name', () => {
    const named = [
      ROADS,
      BINDING,
      Z16_STREETS,
      Z16_LIST,
      AREA_DOT,
      AREA_LIST,
      LANDING_SOFT,
      LANDING_NO_MAP,
      LANDING_MAP_BINDING,
      API_SOFT,
    ];
    const states = [
      ['zoom16', zoomPage(Z16, { note: true })],
      ['zoom16', zoomPage(Z16, { streets: GOOD, dots: 3 })],
      ['area', zoomPage(MG, { note: true })],
      ['area', zoomPage(MG, { streets: GOOD, dots: 1 })],
      ['landing', landingPage({})],
      ['landing', landingPage({ streets: GOOD })],
      ['landing', landingPage({ map: false })],
      ['api', areasAnswer('')],
      ['api', areasAnswer(GOOD)],
    ];
    for (const [which, body] of states) {
      for (const flag of ['false', 'true']) {
        const r = run(which, { body, flag });
        const printed = r.passed.concat(r.failed).filter((n) => named.includes(n));
        expect(printed.length, `${which}, flag ${flag}`).toBeGreaterThan(0);
      }
    }
  });
});

// AGENTS.md: a Bruno run counts only if its test() names print. A console.log
// line is in the step's log and nowhere else: not in the JUnit file, not in the
// check built from it, not in the job summary. So what a case did not check is
// the name of a test.
describe('NOT RUN is the name of a test, not a printed line', () => {
  // Every state in which a case leaves its street assertions out.
  const STATES = [
    ['landing', NOT_RUN.landing, landingPage({})],
    ['landing', NOT_RUN.landingNoMap, landingPage({ map: false })],
    ['area', NOT_RUN.area, zoomPage(MG, { note: true })],
    ['api', NOT_RUN.api, areasAnswer('')],
    ['zoom16', NOT_RUN.zoom16, zoomPage(Z16, { note: true })],
  ];
  // The street-map tests of a case that failed. The folder 16 case asserts on
  // the whole zoomed page (panels, cards, Share), which the pages built here do
  // not carry, so its other tests are left out of the count.
  const STREET_TESTS = [
    ROADS,
    BINDING,
    Z16_STREETS,
    Z16_LIST,
    AREA_DOT,
    AREA_LIST,
    LANDING_SOFT,
    LANDING_NO_MAP,
    LANDING_MAP_BINDING,
    API_SOFT,
  ];
  const streetFails = (r) =>
    r.failed.filter((n) => STREET_TESTS.includes(n) || n.includes('NOT RUN'));
  // The same cases with streets drawn: nothing is left out.
  const DRAWN = [
    ['landing', landingPage({ streets: GOOD })],
    ['area', zoomPage(MG, { streets: GOOD, dots: 1 })],
    ['api', areasAnswer(GOOD)],
    ['zoom16', zoomPage(Z16, { streets: GOOD, dots: 3 })],
  ];

  test.each(STATES)('%s, flag "false": passes under the name "%s"', (which, name, body) => {
    const r = run(which, { body, flag: 'false' });
    expect(notRunNamed(r)).toEqual([name]);
    expect(r.passed).toContain(name);
    expect(streetFails(r)).toEqual([]);
    expect(notRunPrinted(r)).toEqual([]);
  });

  test.each(STATES)(
    '%s, flag missing or mistyped: the NOT RUN test fails by name ("%s")',
    (which, name, body) => {
      // Not "true", so the case takes it for "not loaded". It may not pass for that.
      for (const flag of [undefined, '', 'False', 'FALSE', 'no', 'true ', '0']) {
        const r = run(which, { body, flag });
        expect(streetFails(r), String(flag)).toEqual([name]);
        expect(notRun(r), String(flag)).toEqual([]);
      }
    }
  );

  test.each(STATES)(
    '%s, flag "true": no NOT RUN test, the case fails by name (%s is not said)',
    (which, _name, body) => {
      const r = run(which, { body, flag: 'true' });
      expect(notRunNamed(r)).toEqual([]);
      expect(notRunPrinted(r)).toEqual([]);
      expect(streetFails(r)).toHaveLength(1);
      expect([BINDING, LANDING_MAP_BINDING]).toContain(streetFails(r)[0]);
    }
  );

  test.each(DRAWN)(
    '%s, streets drawn: no NOT RUN test in either state of the flag',
    (which, body) => {
      for (const flag of ['false', 'true']) {
        const r = run(which, { body, flag });
        expect(notRunNamed(r), flag).toEqual([]);
        expect(notRunPrinted(r), flag).toEqual([]);
        expect(streetFails(r), flag).toEqual([]);
      }
    }
  );

  test('the five names are five different lines, each naming what was left out', () => {
    const names = Object.values(NOT_RUN);
    expect(new Set(names).size).toBe(5);
    for (const n of names) expect(n).toMatch(/^NOT RUN \([^)]+\): \S/);
  });

  test('no Pages case prints NOT RUN with console.log', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of readdirSync(join(ROOT, ...dir), { withFileTypes: true })) {
        if (e.isDirectory()) walk([...dir, e.name]);
        else if (
          e.name.endsWith('.yml') &&
          /console\.\w+\([^\n]*NOT RUN/.test(read(...dir, e.name))
        ) {
          offenders.push([...dir, e.name].join('/'));
        }
      }
    };
    walk(PAGES);
    expect(offenders).toEqual([]);
  });
});

// Street-map CCR 2026-11-15, R17: 50 road commands are the streets of any town.
// The area-map case holds the layer to its place by a town: the environment
// names one inside the frame (streetMapTownAnchor, "Name|lat|lng"), and the
// layer must draw that name where that town is.
describe('the area-map case holds the street layer to its place (R17)', () => {
  const NOT_RUN_ANCHOR =
    'NOT RUN (no town is named for this area: streetMapTownAnchor is empty): the street layer is of this place, a named town drawn where that town is';
  const ANCHOR_NEEDED =
    'Right place: streetMapTownAnchor names a town of this area (streetMapArchiveLoaded is true for this environment)';
  const ANCHOR_SET = 'Right place: streetMapTownAnchor is "Name|lat|lng", a town inside this frame';
  const RIGHT_PLACE =
    'Right place: the town named in streetMapTownAnchor is drawn, where that town is (within 30 units)';
  const placeTests = (r) =>
    r.passed.concat(r.failed).filter((n) => n.startsWith('Right place') || n === NOT_RUN_ANCHOR);
  const api = (streets, opts = {}) =>
    run('api', { body: areasAnswer(streets), flag: 'true', ...opts });
  const roads = { water: 300, minor: 900, major: 40, highway: 30 };

  test('the town drawn where it is: passes, in both states of the flag', () => {
    for (const flag of ['false', 'true']) {
      const r = api(GOOD, { flag });
      expect(placeTests(r)).toEqual([ANCHOR_SET, RIGHT_PLACE]);
      expect(r.failed).toEqual([]);
    }
  });

  test('another town in its place (a file cut for another area): fails, and says which names were drawn', () => {
    const r = api(layer({ ...roads, town: 'Sawyer' }));
    expect(r.failed).toEqual([RIGHT_PLACE]);
    expect(r.logs.join('\n')).toContain('the street layer names Sawyer, and not Mokena');
    // The road count passed: by roads alone this layer is fine.
    expect(r.passed).toContain(ROADS);
    // And it is wrong before it is binding.
    expect(api(layer({ ...roads, town: 'Sawyer' }), { flag: 'false' }).failed).toEqual([
      RIGHT_PLACE,
    ]);
  });

  test('the town drawn out of place: 30 units passes, 31 fails, a tile away fails', () => {
    expect(api(layer({ ...roads, at: [330, 180] })).failed).toEqual([]);
    expect(api(layer({ ...roads, at: [300, 150] })).failed).toEqual([]);
    for (const at of [
      [331, 180],
      [300, 211],
      [322, 202],
      [556, 180],
      [44, 180],
    ]) {
      const r = api(layer({ ...roads, at }));
      expect(r.failed, String(at)).toEqual([RIGHT_PLACE]);
      expect(r.logs.join('\n'), String(at)).toMatch(
        /Mokena is drawn \d+ units from where it is \(300, 180\)/
      );
    }
  });

  test('no town name in the layer at all: fails', () => {
    const bare = GOOD.replace(/<text class="as-t"[^>]*>[^<]*<\/text>/, '');
    const r = api(bare);
    expect(r.failed).toEqual([RIGHT_PLACE]);
    expect(r.logs.join('\n')).toContain('the street layer names no town, and not Mokena');
  });

  test('the name is one of several, and may hold a quote or an ampersand', () => {
    const town = { name: "Coeur d'Alene & Co", lat: 47.6777, lng: -116.7805 };
    const streets = GOOD.replace(
      '</g>',
      '<text class="as-t" x="120" y="90" text-anchor="middle">Coeur d&#39;Alene &amp; Co</text></g>'
    );
    const body = { ...areasAnswer(streets), frame: frameWith(town, 120, 90) };
    const r = run('api', { body, flag: 'true', anchor: anchorLine(town) });
    expect(placeTests(r)).toEqual([ANCHOR_SET, RIGHT_PLACE]);
    expect(r.failed).toEqual([]);
  });

  test('anchor empty, flag "false": a NOT RUN test says the place is not checked, streets or none', () => {
    for (const streets of ['', GOOD, layer({ ...roads, town: 'Sawyer' })]) {
      const r = api(streets, { flag: 'false', anchor: '' });
      expect(placeTests(r)).toEqual([NOT_RUN_ANCHOR]);
      expect(r.passed).toContain(NOT_RUN_ANCHOR);
      expect(r.failed).toEqual([]);
    }
  });

  test('anchor empty, flag missing or mistyped: that NOT RUN test fails by name', () => {
    for (const flag of [undefined, '', 'False', 'no']) {
      const r = api(GOOD, { flag, anchor: '' });
      expect(r.failed, String(flag)).toEqual([NOT_RUN_ANCHOR]);
    }
  });

  test('anchor empty, flag "true": fails by name, and no NOT RUN test stands in for it', () => {
    for (const anchor of ['', undefined]) {
      const r = api(GOOD, { anchor });
      expect(placeTests(r)).toEqual([ANCHOR_NEEDED]);
      expect(r.failed).toEqual([ANCHOR_NEEDED]);
    }
  });

  test('an anchor that does not read as "Name|lat|lng": fails by name', () => {
    for (const anchor of [
      'Mokena',
      'Mokena|41.5261',
      'Mokena|north|west',
      '|41.5261|-87.8892',
      'Mokena|41.5261|-87.8892|extra',
      'Mokena, 41.5261, -87.8892',
    ]) {
      const r = api(GOOD, { anchor });
      expect(r.failed, anchor).toContain(ANCHOR_SET);
      expect(r.passed, anchor).not.toContain(RIGHT_PLACE);
    }
  });

  test('an anchor outside the frame (a town of another place): fails by name', () => {
    const sawyer = { name: 'Mokena', lat: 41.8853, lng: -86.5947 };
    const r = api(GOOD, { anchor: anchorLine(sawyer) });
    expect(r.failed).toContain(ANCHOR_SET);
    expect(r.logs.join('\n')).toContain('the town lies left or right of this frame');
  });

  test('anchor set, no street layer: the anchor is still read, and the street tests speak for the layer', () => {
    const off = api('', { flag: 'false' });
    expect(placeTests(off)).toEqual([ANCHOR_SET]);
    expect(off.failed).toEqual([]);
    expect(notRun(off)).toEqual([NOT_RUN.api]);
    const on = api('', { flag: 'true' });
    expect(on.failed).toEqual([BINDING]);
  });

  test('the staging environment file carries the anchor, and it is set by the time the flag is "true"', () => {
    const vars = yaml.load(read('bruno', 'ose-pages', 'environments', 'ose-staging.yml')).variables;
    const anchor = vars.find((v) => v.name === 'streetMapTownAnchor');
    expect(anchor, 'streetMapTownAnchor in ose-staging.yml').toBeTruthy();
    const loaded = vars.find((v) => v.name === 'streetMapArchiveLoaded').value;
    if (loaded === 'true') {
      expect(anchor.value).toMatch(/^[^|]{1,60}\|-?\d{1,2}(\.\d+)?\|-?\d{1,3}(\.\d+)?$/);
    } else {
      expect(anchor.value === '' || /^[^|]{1,60}\|-?\d/.test(anchor.value)).toBe(true);
    }
    expect(scriptOf('api')).toContain("bru.getEnvVar('streetMapTownAnchor')");
    // No second copy in the workflow.
    expect(read('.github', 'workflows', 'oursharedevents-ci.yml')).not.toMatch(
      /streetMapTownAnchor/
    );
  });
});

// The same case against the Worker's own drawing: a synthetic archive that
// names a town at a known point, read by lib/pmtiles.ts and drawn by
// lib/street-map.ts, framed as the route frames it (the area and its six
// neighbours). A test rig: it shows the check tells the right tiles from the
// wrong ones; what a real file names in this frame is for staging to show.
describe('the right place, through the reader and the drawer (synthetic archive)', () => {
  const RIGHT_PLACE =
    'Right place: the town named in streetMapTownAnchor is drawn, where that town is (within 30 units)';
  let street;
  let fx;
  let h3;
  let cells;
  let frame;
  let range;
  let town;
  beforeAll(async () => {
    street = await import('../../../workers/oursharedevents/src/lib/street-map.ts');
    fx = await import('../../../workers/oursharedevents/tests/helpers/street-map-fixtures.ts');
    h3 = await import('h3-js');
    cells = [MG, ...h3.gridDisk(MG, 1).filter((c) => c !== MG)];
    frame = street.frameForCells(cells);
    range = street.tilesFor(frame, 0, 15);
    // A town a quarter of the way into the frame: clear of the area's number.
    const wx = frame.x0 + 150 / frame.scale;
    const wy = frame.y0 + 90 / frame.scale;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI;
    town = { name: 'Oak Lawn', lat, lng: wx * 360 - 180 };
  });

  /** The `places` layer of tile (x, y): the town, if its point lies in that tile. */
  const placeIn = (name) => (x, y) => {
    const n = 2 ** range.z;
    const [wx, wy] = street.toWorld(town.lat, town.lng);
    const px = Math.round((wx * n - x) * 4096);
    const py = Math.round((wy * n - y) * 4096);
    if (px < 0 || px >= 4096 || py < 0 || py >= 4096) return [];
    return [
      {
        name: 'places',
        features: [
          { type: 1, props: { kind: 'locality', name, population_rank: 9 }, parts: [[[px, py]]] },
        ],
      },
    ];
  };

  /** The route's answer for this archive, as GET /api/v2/map/areas gives it. */
  async function answer(tiles) {
    const bytes = await fx.pmtilesArchive(tiles, { gzip: true });
    const built = await street.buildStreetLayer(fx.memSource(bytes), cells, 600, 360, [MG]);
    return {
      ...areasAnswer(built ? built.svg : ''),
      frame: {
        projection: 'web-mercator',
        w: frame.w,
        h: frame.h,
        scale: frame.scale,
        x0: frame.x0,
        y0: frame.y0,
      },
    };
  }
  const check = async (tiles) =>
    run('api', { body: await answer(tiles), flag: 'true', anchor: anchorLine(town) });

  test('the test projects as the Worker does', () => {
    const [x, y] = street.project(frame, town.lat, town.lng);
    expect(x).toBeCloseTo(150, 6);
    expect(y).toBeCloseTo(90, 6);
    expect(toWorld(town.lat, town.lng)[0]).toBeCloseTo(street.toWorld(town.lat, town.lng)[0], 12);
    expect(toWorld(town.lat, town.lng)[1]).toBeCloseTo(street.toWorld(town.lat, town.lng)[1], 12);
  });

  test('the right tiles: the town is drawn where it is, and the case passes', async () => {
    const r = await check(fx.tilesForCells(cells, placeIn('Oak Lawn')).tiles);
    expect(r.failed).toEqual([]);
    expect(r.passed).toEqual(expect.arrayContaining([ROADS, RIGHT_PLACE]));
  });

  test('tiles one step out of place: the roads still pass, the place fails', async () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
    ]) {
      const made = fx.tilesForCells(cells, placeIn('Oak Lawn')).tiles;
      // Every tile is filed one step along, and the gap that leaves is filled,
      // so the frame still has all its tiles: a street map, of the wrong ground.
      const moved = made.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
      const have = new Set(moved.map((t) => `${t.x}/${t.y}`));
      const filler = made
        .filter((t) => !have.has(`${t.x}/${t.y}`))
        .map((t) => ({
          ...t,
          data: fx.mvtTile([]),
        }));
      const empty = fx.tilesForCells(cells).tiles;
      const fill = filler.map((t) => ({
        ...t,
        data: empty.find((e) => e.x === t.x && e.y === t.y).data,
      }));
      const r = await check([...moved, ...fill]);
      expect(r.passed, `${dx},${dy}`).toContain(ROADS);
      expect(r.failed, `${dx},${dy}`).toEqual([RIGHT_PLACE]);
    }
  });

  test('a file cut for another place (the same roads, another town): the place fails by name', async () => {
    const r = await check(fx.tilesForCells(cells, placeIn('Sawyer')).tiles);
    expect(r.passed).toContain(ROADS);
    expect(r.failed).toEqual([RIGHT_PLACE]);
    expect(r.logs.join('\n')).toContain('the street layer names Sawyer, and not Oak Lawn');
  });

  test('tiles with roads and no town: the place fails', async () => {
    const r = await check(fx.tilesForCells(cells).tiles);
    expect(r.passed).toContain(ROADS);
    expect(r.failed).toEqual([RIGHT_PLACE]);
  });
});

// Street-map CCR 2026-11-15, R20: the Worker reads a switch (STREET_MAP), and
// the landing case and the API case say which way it is, in a test name, on
// every run. Off, they hold the Worker to it: no street layer, whatever the
// bucket holds.
describe('the landing and API cases say which way the switch is (R20)', () => {
  const SW_OFF =
    'Street-map switch: STREET_MAP is "off" for this environment, and no street layer is drawn';
  const SW_ON =
    'Street-map switch: STREET_MAP is "on" for this environment (streetMapArchiveLoaded says whether streets must be drawn)';
  const SW_UNSAID = 'Street-map switch: the environment file sets streetMapSwitch to "on" or "off"';
  const named = (r) => r.passed.concat(r.failed).filter((n) => n.startsWith('Street-map switch'));

  const PAGES_OF = {
    api: { none: areasAnswer(''), streets: areasAnswer(GOOD) },
    landing: { none: landingPage({}), streets: landingPage({ streets: GOOD }) },
  };

  describe.each(['api', 'landing'])('%s case', (which) => {
    const { none, streets } = PAGES_OF[which];

    test('off, and no street layer: passes, and the test name says off', () => {
      const r = run(which, { body: none, flag: 'false', sw: 'off' });
      expect(named(r)).toEqual([SW_OFF]);
      expect(r.passed).toContain(SW_OFF);
      expect(r.failed).toEqual([]);
    });

    test('off, and the Worker drew a street layer all the same: fails by name', () => {
      const r = run(which, { body: streets, flag: 'false', sw: 'off' });
      expect(r.failed).toEqual([SW_OFF]);
    });

    test('on: the test name says on, with streets and without', () => {
      for (const body of [none, streets]) {
        const r = run(which, { body, flag: 'false', sw: 'on' });
        expect(named(r)).toEqual([SW_ON]);
        expect(r.failed).toEqual([]);
      }
    });

    test('the copy missing or mistyped: fails by name, and never reads as on or off', () => {
      for (const sw of [undefined, '', 'ON', 'true', 'off ']) {
        const r = run(which, { body: none, flag: 'false', sw });
        expect(named(r), String(sw)).toEqual([SW_UNSAID]);
        expect(r.failed, String(sw)).toEqual([SW_UNSAID]);
      }
    });
  });

  test('off, and the landing draws no map at all: passes', () => {
    const r = run('landing', { body: landingPage({ map: false }), flag: 'false', sw: 'off' });
    expect(r.passed).toContain(SW_OFF);
    expect(r.failed).toEqual([]);
  });

  test('off, and the credit shown with no street layer: fails by name', () => {
    const body = landingPage({}).replace('</body>', `${CREDIT}</body>`);
    expect(run('landing', { body, flag: 'false', sw: 'off' }).failed).toContain(SW_OFF);
  });

  test('both cases read the copy, and the staging environment file carries it', () => {
    for (const which of ['api', 'landing']) {
      expect(scriptOf(which)).toContain("bru.getEnvVar('streetMapSwitch')");
    }
    const vars = yaml.load(read('bruno', 'ose-pages', 'environments', 'ose-staging.yml')).variables;
    expect(['on', 'off']).toContain(vars.find((v) => v.name === 'streetMapSwitch')?.value);
  });

  test('the workflow passes the copy to no one', () => {
    const wf = read('.github', 'workflows', 'oursharedevents-ci.yml');
    expect(wf).not.toMatch(/streetMapSwitch|STREET_MAP\b/);
  });
});

describe('one place says whether the archive is loaded', () => {
  let flag;
  beforeAll(async () => {
    flag = await import('../../../scripts/ci/street-map-flag.mjs');
  });
  const env = (v) => `variables:\n  - name: streetMapArchiveLoaded\n    value: ${v}\n`;

  test('"true" and "false" are read; anything else throws', () => {
    expect(flag.parseStreetMapFlag(env('"true"'))).toBe(true);
    expect(flag.parseStreetMapFlag(env('"false"'))).toBe(false);
    expect(flag.parseStreetMapFlag(env('"false"').replace(/\n/g, '\r\n'))).toBe(false);
    for (const bad of ['""', '"yes"', 'true', '"TRUE"']) {
      expect(() => flag.parseStreetMapFlag(env(bad))).toThrow(/must set streetMapArchiveLoaded/);
    }
    expect(() => flag.parseStreetMapFlag('variables: []\n')).toThrow(/must set/);
  });

  test('the real file is read, and it is the file Bruno runs with', () => {
    expect(flag.STAGING_ENV_FILE).toBe('bruno/ose-pages/environments/ose-staging.yml');
    expect(typeof flag.streetMapArchiveLoaded(ROOT)).toBe('boolean');
    const vars = yaml.load(read(...flag.STAGING_ENV_FILE.split('/'))).variables;
    const value = vars.find((v) => v.name === flag.FLAG).value;
    expect(flag.streetMapArchiveLoaded(ROOT)).toBe(value === 'true');
    // The Pages run names that environment.
    const wf = read('.github', 'workflows', 'oursharedevents-ci.yml');
    expect(wf).toContain('npx bru run . -r --env ose-staging');
  });

  test('every case that asserts on the street layer reads the flag and names NOT RUN in a test', () => {
    for (const which of STREET_CASES) {
      const text = scriptOf(which);
      expect(text).toContain("bru.getEnvVar('streetMapArchiveLoaded')");
      expect(text).toContain(`test('${NOT_RUN[which]}', function () {`);
      expect(text).not.toMatch(/console\.\w+\([^\n]*NOT RUN/);
      expect(text).toContain(BINDING);
    }
  });

  test('no other Pages case requires the note on an area', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of readdirSync(join(ROOT, ...dir), { withFileTypes: true })) {
        if (e.isDirectory()) walk([...dir, e.name]);
        else if (e.name.endsWith('.yml')) {
          const text = read(...dir, e.name);
          const requires =
            /expect\(has\('amap-no-tiles'\)\)\.to\.equal\(true\)|to\.include\('data-testid="amap-no-tiles"'\)/.test(
              text
            );
          if (requires && !text.includes("bru.getEnvVar('streetMapArchiveLoaded')")) {
            offenders.push([...dir, e.name].join('/'));
          }
        }
      }
    };
    walk(PAGES);
    expect(offenders).toEqual([]);
  });

  test('the Playwright helper reads the flag from the same file', () => {
    const helper = read('tests', 'e2e', 'helpers', 'map-zoom-area.ts');
    expect(helper).toContain("from '../../../scripts/ci/street-map-flag.mjs'");
    expect(helper).toContain(
      "export const STREETS_LOADED: boolean = streetMapArchiveLoaded(resolve(__dirname, '../../..'));"
    );
    expect(helper).not.toMatch(/process\.env\.[A-Z_]*STREET/);
  });

  test('the spec reads the drawing through the helper', () => {
    const spec = read('tests', 'e2e', '3-flows', 'map-place-panel.spec.ts');
    expect(spec).toContain('const drawing = await expectZoomDrawing(page);');
    expect(spec).not.toContain("getByTestId('amap-no-tiles')");
    const helper = read('tests', 'e2e', 'helpers', 'map-zoom-area.ts');
    const body = helper.slice(
      helper.indexOf('export async function expectZoomDrawing'),
      helper.indexOf('export async function passStgEdge')
    );
    // No street layer: the flag must allow it, and the note must be there.
    expect(body).toMatch(/expect\(\s*STREETS_LOADED,[\s\S]*?\)\.toBe\(false\);/);
    expect(body).toContain("await expect(page.getByTestId('amap-no-tiles')).toBeVisible();");
    // A street layer: the drawing, the area, a dot per place, and no note.
    expect(body).toContain("await expect(page.getByTestId('amap-svg')).toBeVisible();");
    expect(body).toContain('[data-testid="amap-zone"][data-cell="${AREA}"]');
    expect(body).toContain(
      "await expect(page.getByTestId('amap-dot')).toHaveCount(PLACES.length);"
    );
    expect(body).toContain("await expect(page.getByTestId('amap-no-tiles')).toHaveCount(0);");
    expect(body).not.toMatch(/test\.skip|test\.fixme/);
  });

  test('the link walk expects the map credit with streets, and answers it without leaving', () => {
    const spec = read('tests', 'e2e', '3-flows', 'map-place-panel.spec.ts');
    expect(spec).toContain(
      "const CREDIT_LINKS = ['https://www.openstreetmap.org/copyright/en', 'https://protomaps.com'];"
    );
    expect(spec).toContain('...(streets ? CREDIT_LINKS : []),');
    // The two hosts are answered by the test, before the walk follows a link.
    const route = spec.indexOf(
      'await context.route(/^https:\\/\\/(www\\.openstreetmap\\.org|protomaps\\.com)(\\/|$)/'
    );
    expect(route).toBeGreaterThan(-1);
    expect(spec.indexOf('await visitor.goto(')).toBeGreaterThan(route);
  });

  test('the axe scan sets apart only text drawn on the map, and a measured judge decides it', () => {
    const spec = read('tests', 'e2e', '3-flows', 'map-place-panel.spec.ts');
    const sort = spec.slice(
      spec.indexOf('async function sortUndecided'),
      spec.indexOf("test.describe('Zoomed map: accessibility in both themes")
    );
    // No street layer: nothing is sorted, every undecided rule fails as before.
    expect(sort).toContain(
      'if (!streets || nodes.length === 0) return { undecided: nodes.map((n) => n.name), onTheMap: [] };'
    );
    // Beside the map: decided by a second scan with the street layer hidden.
    expect(sort).toContain('content: \'[data-testid="amap-streets"]{display:none!important}\'');
    expect(sort).toContain("...again.violations.map((v) => ({ v, said: 'fails' })),");
    expect(sort).toContain("...again.incomplete.map((v) => ({ v, said: 'is still undecided' })),");
    // On the map: contrast only, only inside the drawing, and only a node that
    // is a <text> or holds one, since text is all the judge reads.
    expect(sort).toContain("n.rule === 'color-contrast' && n.selector !== null");
    expect(sort).toContain(
      'const onTheMap = nodes.filter((n, i) => contrast(n) && drawn[i] && text[i]).map((n) => n.name);'
    );
    expect(spec).toContain(
      "return el.closest('text') != null || el.querySelector('text') != null;"
    );
    // Any other rule axe could not decide stays a failure, streets or not; and so
    // does a node of the drawing with no text in it.
    expect(sort).toContain('.filter((n, i) => !contrast(n) || (drawn[i] && !text[i]))');
    expect(sort).toContain(
      'undecided.push(...left.filter((_, i) => !leftDrawn[i]).map((n) => n.name));'
    );
    expect(sort).toContain('return { undecided, onTheMap };');
    expect(spec).toContain('.closest(\'[data-testid="amap-svg"]\') != null');
    const scan = spec.slice(
      spec.indexOf("test.describe('Zoomed map: accessibility in both themes")
    );
    expect(scan).toMatch(/expect\(\s*undecided,[\s\S]*?\)\.toEqual\(\[\]\);/);
    // No street layer: nothing may be set apart as text on the map.
    expect(scan).toMatch(
      /if \(\(await page\.getByTestId\('amap-streets'\)\.count\(\)\) === 0\) \{\s*expect\(onTheMap,[\s\S]*?\)\.toEqual\(\s*\[\]\s*\);\s*continue;\s*\}/
    );
    // Streets: every text of the drawing is judged by measurement, by the one
    // judge the component layer runs.
    expect(spec).toContain("import { judgeMapTextOn } from '../helpers/map-text-contrast';");
    expect(scan).toContain('const judged = await judgeMapTextOn(page);');
    // A text it does not know fails, whatever the flag.
    expect(scan).toMatch(
      /expect\(\s*judged\.texts\.filter\(\(t\) => t\.kind === 'other'\)\.map\(\(t\) => t\.text\),[\s\S]*?\)\.toEqual\(\[\]\);/
    );
    // It read a number for every dot, or it judged nothing.
    expect(scan).toMatch(
      /judged\.texts\.filter\(\(t\) => t\.kind === 'dot number' \|\| t\.kind === 'pale dot number'\)\s*\.length,[\s\S]*?\)\.toBe\(PLACES\.length\);/
    );
    // Under its ratio: reported while the flag is "false", a failure once it is "true".
    expect(scan).toMatch(
      /if \(judged\.failures\.length > 0\) \{[\s\S]*?expect\(\s*STREETS_LOADED,[\s\S]*?judged\.failures\.join\('\\n'\)[\s\S]*?\)\.toBe\(false\);/
    );
    expect(scan).toContain('::warning title=T4k street map text UNDER ITS CONTRAST RATIO::');
    expect(scan).toContain("`${[...mapTextUnderRatio].join(' | ')}. ` +");
    // "axe could not decide" is no longer a verdict on map text.
    expect(spec).not.toContain('NOT DECIDED');
    expect(spec).not.toContain('axe-map-text-not-decided');
  });

  test('the workflow passes the flag to no one', () => {
    // A copy in an --env-var or a step's env could say something the file does not.
    const wf = read('.github', 'workflows', 'oursharedevents-ci.yml');
    expect(wf).not.toMatch(/streetMapArchiveLoaded|STREET_MAP_ARCHIVE_LOADED|STREETS_LOADED/);
  });
});
