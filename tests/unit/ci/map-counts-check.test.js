/**
 * The map's staging layer, held together (epic OSE-1880; OSE-1886, OSE-1891, OSE-1896).
 *
 * Three things state the same numbers and the same spec list, and nothing else
 * would notice if one drifted:
 *   - bruno/fixtures/map-zoom-area-seed.sql sets the tap and share-open counts;
 *   - scripts/ci/map-counts-check.mjs reads them back from D1 after the map was used;
 *   - the workflow and scripts/ci/run-local-vetting.sh seed, run the two map specs,
 *     check the counts and unpublish, in that order.
 * These tests pin the script's pure rules and that wiring.
 *
 * BORN RED (2026-11-14): one fault at a time in the file named, this file run, the
 * fault taken out. Every one of the 20 tests failed under at least one fault:
 *   scripts/ci/map-counts-check.mjs
 *     `!==` -> `!=`, and the null-row guard removed (one fault each)
 *                                  -> "unknown is never green…"
 *     `!==` -> `===`              -> "numbers where the seed put them…", "one tap
 *                                    more…", "a share open, a daily tap row and a
 *                                    scan…", "unknown is never green…"
 *     the filter never matches     -> the last three of those
 *     firstRow reads only output that starts with the JSON
 *                                  -> "the row is found in wrangler output…"
 *     firstRow gives `{}` for no row -> "output with no result row reads as null"
 *     no flag means `--local`      -> "CI reads staging remotely…"
 *     the query starts with an UPDATE -> "the query is one read-only statement…"
 *     `mzChk1` left out of CODES   -> "every code the script reads is in the seed…"
 *   bruno/fixtures/map-zoom-area-seed.sql
 *     mzTix1 seeded with 4 taps    -> "taps per event…", "every code holds 5 taps or more…"
 *     map-zoom-b with 6 share opens -> "share opens are the seeded sum and rows"
 *     the off-poster code renamed  -> "the seed was parsed…", "taps per event…"
 *   bruno/fixtures/map-zoom-area-reset.sql
 *     a DELETE added               -> "the reset only unpublishes…"
 *     the file missing             -> "the files the wiring names exist", "the reset only unpublishes…"
 *   Bruno "taps after" expecting 41 -> "the Bruno folder and the browser spec state the same tap totals"
 *   .github/workflows/oursharedevents-ci.yml
 *     the T4k reset without `always()`, the T4k step without the layout spec, the
 *     T4k seed step renamed away (one fault each)
 *                                  -> "T4 surfaces: seed, then the two map specs…"
 *     the T2 count check with `continue-on-error`, the T2 seed step renamed away
 *                                  -> "T2 pages: seed before the Bruno run…"
 *   scripts/ci/run-local-vetting.sh: the behaviour spec dropped
 *                                  -> "local vetting seeds the same fixture…"
 *   playwright.e2e-smoke.config.ts: map-tv set to 1600 px
 *                                  -> "the layout spec has one project per device profile…"
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let m;
beforeAll(async () => {
  m = await import('../../../scripts/ci/map-counts-check.mjs');
});

const SEED = 'bruno/fixtures/map-zoom-area-seed.sql';
const RESET = 'bruno/fixtures/map-zoom-area-reset.sql';
const SPECS = [
  'tests/e2e/3-flows/map-place-panel.spec.ts',
  'tests/e2e/2-pages/map-place-panel-layout.spec.ts',
];

describe('map-counts-check: pure rules', () => {
  test('numbers where the seed put them are no difference', () => {
    expect(m.differences({ ...m.EXPECTED })).toEqual([]);
  });

  test('one tap more on map-zoom-a is named', () => {
    expect(m.differences({ ...m.EXPECTED, taps_a: 43 })).toEqual(['taps_a: expected 42, read 43']);
  });

  test('a share open, a daily tap row and a scan are each named', () => {
    const moved = { ...m.EXPECTED, share_opens: 11, share_open_rows: 3, tap_days: 1, scans: 1 };
    expect(m.differences(moved)).toEqual([
      'tap_days: expected 0, read 1',
      'share_opens: expected 10, read 11',
      'share_open_rows: expected 2, read 3',
      'scans: expected 0, read 1',
    ]);
  });

  test('unknown is never green: no row, a missing number, a number as text', () => {
    expect(m.differences(null)).toEqual(['no result row was read']);
    const missing = { ...m.EXPECTED };
    delete missing.scans;
    expect(m.differences(missing)).toEqual(['scans: expected 0, read null']);
    expect(m.differences({ ...m.EXPECTED, taps_a: '42' })).toEqual([
      'taps_a: expected 42, read "42"',
    ]);
  });

  test('the row is found in wrangler output, with or without a notice before it', () => {
    const json = JSON.stringify([{ results: [{ ...m.EXPECTED }], success: true, meta: {} }]);
    expect(m.firstRow(json)).toEqual(m.EXPECTED);
    expect(m.firstRow(`notice [wrangler] update available\n${json}\n`)).toEqual(m.EXPECTED);
  });

  test('output with no result row reads as null', () => {
    expect(m.firstRow('')).toBeNull();
    expect(m.firstRow('[]')).toBeNull();
    expect(m.firstRow('[{"results":[],"success":true}]')).toBeNull();
    expect(m.firstRow('{"error":{"text":"no such table"}}')).toBeNull();
    expect(m.firstRow('not json [at all')).toBeNull();
  });

  test('CI reads staging remotely; --local reads a local D1; a stray --persist-to is refused', () => {
    const remote = m.wranglerArgs([]);
    expect(remote.slice(0, 7)).toEqual([
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--env',
      'staging',
      '--remote',
    ]);
    expect(remote).not.toContain('--local');
    expect(remote.slice(-3)).toEqual(['--json', '--command', m.SQL]);
    expect(m.wranglerArgs(['--local', '--persist-to', '/tmp/x']).slice(4, 7)).toEqual([
      '--local',
      '--persist-to',
      '/tmp/x',
    ]);
    expect(m.wranglerArgs(['--local'])).toContain('--local');
    expect(m.wranglerArgs(['--persist-to', '/tmp/x'])).toBeNull();
    expect(m.wranglerArgs(['--local', '--persist-to'])).toBeNull();
  });

  test('the query is one read-only statement over the count tables', () => {
    expect(m.SQL).not.toContain(';');
    expect(m.SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i);
    for (const table of [
      'shortlinks',
      'shortlink_click_daily',
      'share_opens_daily',
      'scan_placement_events',
    ]) {
      expect(m.SQL).toContain(`FROM ${table} `);
    }
    for (const key of Object.keys(m.EXPECTED)) expect(m.SQL).toContain(` AS ${key}`);
  });
});

describe('map-counts-check: the numbers are the fixture’s', () => {
  const seed = read(SEED);
  // ('mzTix1', 'map-zoom-a', 'tickets', 'https://…', 4, 7)
  const links = [...seed.matchAll(/\('(mz\w{4})',\s*'(map-zoom-[a-j])',[^)]*?,\s*(\d+)\)/g)].map(
    (x) => ({ code: x[1], event: x[2], clicks: Number(x[3]) })
  );
  const opens = [
    ...seed.matchAll(/\('(map-zoom-[a-j])', 'event', 'pre_event', '\d{4}-\d\d-\d\d', (\d+)\)/g),
  ].map((x) => ({ event: x[1], opens: Number(x[2]) }));
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

  test('the seed was parsed (8 codes, 2 share-open rows)', () => {
    expect(links.map((l) => l.code).sort()).toEqual(
      ['mzChk1', 'mzDon1', 'mzHtp1', 'mzOff1', 'mzPub1', 'mzReg1', 'mzTix1', 'mzTix2'].sort()
    );
    expect(opens.length).toBe(2);
  });

  test('taps per event are the seeded sums', () => {
    expect(
      sum(
        links.filter((l) => l.event === 'map-zoom-a'),
        (l) => l.clicks
      )
    ).toBe(m.EXPECTED.taps_a);
    expect(
      sum(
        links.filter((l) => l.event === 'map-zoom-b'),
        (l) => l.clicks
      )
    ).toBe(m.EXPECTED.taps_b);
  });

  test('every code holds 5 taps or more, so the organizer’s floored read is exact', () => {
    expect(links.filter((l) => l.clicks < 5)).toEqual([]);
  });

  test('share opens are the seeded sum and rows', () => {
    expect(sum(opens, (o) => o.opens)).toBe(m.EXPECTED.share_opens);
    expect(opens.length).toBe(m.EXPECTED.share_open_rows);
  });

  test('every code the script reads is in the seed, and the seed clears their daily rows', () => {
    for (const l of links) {
      expect(m.SQL).toContain(`'${l.code}'`);
      expect(seed).toMatch(new RegExp(`DELETE FROM shortlink_click_daily[\\s\\S]*'${l.code}'`));
    }
  });

  test('the Bruno folder and the browser spec state the same tap totals', () => {
    const folder = 'bruno/ose-pages/16. Landing Map Zoom (OSE-1886 OSE-1891 OSE-1896)';
    for (const name of fs
      .readdirSync(path.join(ROOT, folder))
      .filter((n) => /taps (before|after)/.test(n))) {
      expect(read(`${folder}/${name}`)).toContain(
        `expect(clicks.count).to.equal(${m.EXPECTED.taps_a});`
      );
    }
    expect(read(SPECS[0])).toContain(
      `expect(before).toEqual({ a: ${m.EXPECTED.taps_a}, b: ${m.EXPECTED.taps_b} });`
    );
  });

  test('the reset only unpublishes the ten fixture events', () => {
    const reset = read(RESET).replace(/^--.*$/gm, '');
    expect(reset.match(/\b(UPDATE|DELETE|INSERT)\b/g)).toEqual(['UPDATE']);
    expect(reset).toContain('SET is_published = 0');
    expect([...reset.matchAll(/'(map-zoom-[a-j])'/g)].map((x) => x[1]).sort()).toEqual(
      [...'abcdefghij'].map((x) => `map-zoom-${x}`)
    );
  });
});

describe('map staging layer: CI wiring', () => {
  const wf = yaml.load(read('.github/workflows/oursharedevents-ci.yml'));
  const index = (steps, name) => steps.findIndex((s) => s && s.name === name);
  const SEED_RUN = `d1-seed-staging.mjs DB ../../${SEED}`;
  const RESET_RUN = `d1-seed-staging.mjs DB ../../${RESET}`;
  const CHECK_RUN = 'node ../../scripts/ci/map-counts-check.mjs';

  test('the files the wiring names exist', () => {
    for (const p of [SEED, RESET, ...SPECS, 'scripts/ci/map-counts-check.mjs']) {
      expect(fs.existsSync(path.join(ROOT, p)), p).toBe(true);
    }
  });

  test('T4 surfaces: seed, then the two map specs through the guard, then the count check, then the reset', () => {
    const steps = wf.jobs['functional-staging-sub'].steps;
    const seed = index(steps, 'T4k-seed: map zoom area fixture (OSE-1880)');
    const run = index(steps, 'T4k: Map Zoom, Place Panel and Map Links');
    const check = index(steps, 'T4k-check: map counts unchanged (OSE-1896)');
    const reset = index(steps, 'T4k-reset: unpublish the map zoom area fixture');
    expect(seed).toBeGreaterThan(-1);
    expect([seed, run, check, reset]).toEqual([seed, seed + 1, seed + 2, seed + 3]);
    for (const i of [seed, run, check]) expect(steps[i].if).toBe("matrix.section == 'surfaces'");
    expect(steps[seed].run).toContain(SEED_RUN);
    expect(steps[run].run).toContain('scripts/pw-guarded.sh');
    expect(steps[run].run).toContain('--config=playwright.e2e-smoke.config.ts');
    for (const spec of SPECS) expect(steps[run].run).toContain(spec);
    expect(steps[check].run.trim()).toBe(CHECK_RUN);
    expect(steps[reset].run).toContain(RESET_RUN);
    // Pass or fail, the fixture leaves the public lists.
    expect(steps[reset].if).toBe("always() && matrix.section == 'surfaces'");
    // A red map step must be red: no step of the four may be allowed to fail.
    for (const i of [seed, run, check, reset]) {
      expect(steps[i]['continue-on-error']).toBeUndefined();
    }
  });

  test('T2 pages: seed before the Bruno run, count check after it, reset pass or fail', () => {
    const steps = wf.jobs['contract-staging-sub'].steps;
    const seed = index(steps, 'Seed map zoom area fixture (OSE-1880)');
    const bruno = index(steps, 'Bruno contract section');
    const check = index(steps, 'Map counts unchanged after the Pages run (OSE-1896)');
    const reset = index(steps, 'Unpublish map zoom area fixture');
    expect(seed).toBeGreaterThan(-1);
    expect(seed).toBeLessThan(bruno);
    expect(check).toBe(bruno + 1);
    expect(reset).toBe(check + 1);
    expect(steps[seed].if).toBe("matrix.section == 'pages'");
    expect(steps[seed].run).toContain(SEED_RUN);
    expect(steps[check].if).toBe("matrix.section == 'pages'");
    expect(steps[check].run.trim()).toBe(CHECK_RUN);
    expect(steps[reset].if).toBe("always() && matrix.section == 'pages'");
    expect(steps[reset].run).toContain(RESET_RUN);
    for (const i of [seed, check, reset]) expect(steps[i]['continue-on-error']).toBeUndefined();
  });

  test('local vetting seeds the same fixture, runs the same two specs and checks the counts', () => {
    const sh = read('scripts/ci/run-local-vetting.sh');
    expect(sh).toContain(`seed ${SEED}`);
    for (const spec of SPECS) expect(sh).toContain(spec);
    expect(sh).toContain('map-counts-check.mjs --local --persist-to "$PERSIST_DIR"');
    // The specs run before the count check, or the check would prove nothing about them.
    expect(sh.indexOf(SPECS[0])).toBeLessThan(sh.indexOf('map-counts-check.mjs --local'));
    expect(sh.indexOf('bru_section pages')).toBeLessThan(
      sh.indexOf('map-counts-check.mjs --local')
    );
  });

  test('the layout spec has one project per device profile, and only it runs on them', () => {
    const cfg = read('playwright.e2e-smoke.config.ts');
    for (const [name, width] of [
      ['map-phone', 375],
      ['map-tablet', 768],
      ['map-desktop', 1280],
      ['map-tv', 1920],
    ]) {
      expect(cfg).toMatch(new RegExp(`name: '${name}', width: ${width},`));
    }
    expect(cfg).toContain('testMatch: MAP_LAYOUT');
    expect(cfg).toContain('testIgnore: MAP_LAYOUT');
    expect(cfg).toContain('map-place-panel-layout');
    // The layout spec names the same four projects it expects to run on.
    const layout = read(SPECS[1]);
    for (const name of ['map-phone', 'map-tablet', 'map-desktop', 'map-tv']) {
      expect(layout).toContain(`'${name}'`);
    }
  });
});
