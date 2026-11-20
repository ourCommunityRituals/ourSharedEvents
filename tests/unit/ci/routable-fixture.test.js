/**
 * OSE-2196 — the routable staging fixture is listed only for the T2 Pages run.
 *
 * bruno/fixtures/routable-seed.sql lists three synthetic events on staging
 * (rt-listed-pre, rt-listed-live, and rt-grace-pre in its publish grace) so
 * Bruno folder "17. Routable (OSE-2196)" can read their Directions. Staging is
 * one site with the owner's stock data (stock/totals.json), so they must come
 * off the list again after the run, pass or fail. This pins that wiring the way
 * tests/unit/ci/map-counts-check.test.js pins the map zoom fixture's.
 *
 * @born-red OSE-2196 (security review F-A) | method: each fault alone, this
 * file run, reverted: the reset step deleted; its `always()` removed; the reset
 * moved before the Bruno step; a DELETE added to the reset; one id dropped from
 * the reset; the seed step moved after the Bruno step | date: 2026-11-19
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SEED = 'bruno/fixtures/routable-seed.sql';
const RESET = 'bruno/fixtures/routable-reset.sql';
const LISTED = ['rt-grace-pre', 'rt-listed-live', 'rt-listed-pre'];

const sql = (p) =>
  read(p)
    .replace(/^--.*$/gm, '')
    .trim();

describe('routable fixture (OSE-2196): listed only for the run', () => {
  test('the seed lists exactly the three events the reset takes off', () => {
    const seed = sql(SEED);
    // One statement: an upsert (its ON CONFLICT … DO UPDATE is part of it).
    const heads = seed
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.split(/\s+/)[0].toUpperCase());
    expect(heads).toEqual(['INSERT']);
    expect(seed).not.toMatch(/\bDELETE\b/);
    // Every row the seed publishes (is_published 1) is one the reset names.
    const listed = [
      ...seed.matchAll(/\('(rt-[a-z-]+)', 'root', '[^']*', '[^']*',\s*'active', 1,/g),
    ].map((x) => x[1]);
    expect(listed.sort()).toEqual(LISTED);
  });

  test('the reset only unpublishes those three events', () => {
    const reset = sql(RESET);
    expect(reset.match(/\b(UPDATE|DELETE|INSERT)\b/g)).toEqual(['UPDATE']);
    expect(reset).toContain('SET is_published = 0');
    expect([...reset.matchAll(/'(rt-[a-z-]+)'/g)].map((x) => x[1]).sort()).toEqual(LISTED);
  });

  test('T2 pages: seed before the Bruno run, reset after it, pass or fail', () => {
    const wf = yaml.load(read('.github/workflows/oursharedevents-ci.yml'));
    const steps = wf.jobs['contract-staging-sub'].steps;
    const index = (name) => steps.findIndex((s) => s && s.name === name);
    const seed = index('Seed routable fixtures (OSE-2196)');
    const bruno = index('Bruno contract section');
    const reset = index('Unpublish routable fixture (OSE-2196)');
    expect(seed).toBeGreaterThan(-1);
    expect(bruno).toBeGreaterThan(seed);
    expect(reset).toBeGreaterThan(bruno);
    expect(steps[seed].if).toBe("matrix.section == 'pages'");
    expect(steps[seed].run).toContain(`d1-seed-staging.mjs DB ../../${SEED}`);
    expect(steps[reset].if).toBe("always() && matrix.section == 'pages'");
    expect(steps[reset].run).toContain(`d1-seed-staging.mjs DB ../../${RESET}`);
    for (const i of [seed, reset]) expect(steps[i]['continue-on-error']).toBeUndefined();
  });

  test('local vetting seeds it too, after the map zoom fixture (its off-map pair is in that area)', () => {
    const sh = read('scripts/ci/run-local-vetting.sh');
    const zoom = sh.indexOf('seed bruno/fixtures/map-zoom-area-seed.sql');
    const mine = sh.indexOf(`seed ${SEED}`);
    expect(zoom).toBeGreaterThan(-1);
    expect(mine).toBeGreaterThan(zoom);
  });
});
