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

/**
 * Run one case's script the way Bruno does: its `test()` calls are collected,
 * a throwing one is a failure, and `console.log` lines are kept.
 */
function run(which, { body, flag, status = 200 }) {
  const out = { passed: [], failed: [], logs: [] };
  const res = { getStatus: () => status, getBody: () => body, getHeader: () => undefined };
  const bru = { getEnvVar: (name) => (name === 'streetMapArchiveLoaded' ? flag : undefined) };
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
const notRun = (r) => r.logs.filter((l) => l.startsWith('NOT RUN'));

// ── pages in each state, in the markup lib/attendee-map.ts and lib/street-map.ts write ──

/** Path data of `n` commands: one M, then L. */
const cmds = (n) => 'M0 0' + 'L9 9'.repeat(Math.max(0, n - 1));
const path = (cls, n, close = '') => (n > 0 ? `<path class="${cls}" d="${cmds(n)}${close}"/>` : '');

/** The street layer with this many path commands per class. */
const layer = ({ water = 0, rivers = 0, minor = 0, major = 0, highway = 0 } = {}) =>
  '<g class="amap-s" aria-hidden="true" data-testid="amap-streets" data-z="12">' +
  '<rect class="as-l" width="600" height="360"/>' +
  path('as-w', water, 'Z') +
  path('as-v', rivers) +
  path('as-r as-1', minor) +
  path('as-r as-2', major) +
  path('as-r as-3', highway) +
  '<text class="as-t" x="300" y="180" text-anchor="middle">Mokena</text></g>';

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

/** GET /api/v2/map/areas?cells=872664570ffffff&around=1 */
function areasAnswer(streets) {
  const points = '1,1 2,2 3,3 4,4 5,5 6,6';
  return {
    ok: true,
    status: 200,
    frame: { projection: 'web-mercator', w: 600, h: 360, scale: 1, x0: 0, y0: 0 },
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
    expect(notRun(r)).toHaveLength(1);
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
    expect(notRun(off)).toHaveLength(1);
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
    expect(notRun(off)).toHaveLength(1);
    const on = run('landing', { body, flag: 'true' });
    expect(on.failed).toEqual([BINDING]);
  });

  test('the landing draws no map, flag false: a named test passes and NOT RUN is printed', () => {
    const r = run('landing', { body: landingPage({ map: false }), flag: 'false' });
    expect(r.passed).toContain(LANDING_NO_MAP);
    expect(r.failed).toEqual([]);
    expect(notRun(r)).toHaveLength(1);
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
    expect(notRun(off)).toHaveLength(1);
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

  test('every case that asserts on the street layer reads the flag and prints NOT RUN by name', () => {
    for (const which of STREET_CASES) {
      const text = scriptOf(which);
      expect(text).toContain("bru.getEnvVar('streetMapArchiveLoaded')");
      expect(text).toMatch(/console\.log\('NOT RUN \(street-map archive not loaded/);
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

  test('the axe scan sets apart only text drawn on the map, and only until the flag is true', () => {
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
    // On the map: contrast only, and only inside the drawing.
    expect(sort).toContain("n.rule === 'color-contrast' && n.selector !== null");
    // Any other rule axe could not decide stays a failure, streets or not.
    expect(sort).toContain(
      'const undecided = nodes.filter((n) => !contrast(n)).map((n) => n.name);'
    );
    expect(sort).toContain(
      'undecided.push(...left.filter((_, i) => !leftDrawn[i]).map((n) => n.name));'
    );
    expect(sort).toContain('return { undecided, onTheMap };');
    expect(spec).toContain('.closest(\'[data-testid="amap-svg"]\') != null');
    const scan = spec.slice(
      spec.indexOf("test.describe('Zoomed map: accessibility in both themes")
    );
    expect(scan).toMatch(/expect\(\s*undecided,[\s\S]*?\)\.toEqual\(\[\]\);/);
    expect(scan).toMatch(
      /if \(onTheMap\.length > 0\) \{[\s\S]*?expect\(\s*STREETS_LOADED,[\s\S]*?\)\.toBe\(false\);/
    );
    expect(scan).toContain('::warning title=T4k street map text contrast NOT DECIDED::');
  });

  test('the workflow passes the flag to no one', () => {
    // A copy in an --env-var or a step's env could say something the file does not.
    const wf = read('.github', 'workflows', 'oursharedevents-ci.yml');
    expect(wf).not.toMatch(/streetMapArchiveLoaded|STREET_MAP_ARCHIVE_LOADED|STREETS_LOADED/);
  });
});
