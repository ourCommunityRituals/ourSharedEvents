/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own Bruno files */
/**
 * OSE-2137: the OSE-2095 stock count checks do not count the pages leg's fixtures.
 *
 * The staging T2 step runs the api leg and the pages leg side by side. The pages
 * leg publishes `zip-own-*` events (landing-zip-own-area-seed.sql) in 60655 and
 * Oak Lawn for a minute, then unpublishes them. The api leg's "stock" requests read
 * a count before and after and compare, so a fixture coming or going moved the
 * count (run 44271204791: expected '0' to deeply equal '1').
 *
 * This runs the real after-response script of each stock request against page
 * bodies with a stub of Bruno's res, bru, test and expect. It proves: a fixture
 * card coming or going leaves the pair green, and a real (non-fixture) card still
 * moves it and fails the pair.
 *
 * Born red: with the old count (`/data-event-id="/g`) put back in the four files,
 * the "fixture coming or going" cases fail; with the fixture filter widened to every
 * id, the "real event" cases fail.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const DIR = join(
  __dirname,
  '..',
  '..',
  'bruno',
  'ose-api',
  '21. The ZIP at the Where step (OSE-2095)'
);

const FILES = {
  zipBefore: 'OSE-2095 - stock - 5 the 60655 count before.yml',
  townBefore: 'OSE-2095 - stock - 6 the Oak Lawn count before.yml',
  zipAfter: 'OSE-2095 - stock - 60 the 60655 count is unchanged.yml',
  townAfter: 'OSE-2095 - stock - 61 the Oak Lawn count is unchanged.yml',
};

const card = (id) =>
  `<article class="event-card" data-testid="public-event-card" data-event-id="${id}" data-phase="x">`;
const page = (...ids) => `<main>${ids.map(card).join('\n')}</main>`;

function script(file) {
  const doc = yaml.load(readFileSync(join(DIR, file), 'utf8'));
  return doc.runtime.scripts.find((s) => s.type === 'after-response').code;
}

// Runs one request's script; returns the names of the tests that failed.
function run(file, body, vars) {
  const failed = [];
  const res = { getBody: () => body, getStatus: () => 200 };
  const bru = { setVar: (k, v) => (vars[k] = v), getVar: (k) => vars[k] };
  const expect = (actual) => ({
    to: {
      eql: (want) => {
        if (actual !== want) throw new Error(`expected '${actual}' to deeply equal '${want}'`);
      },
    },
  });
  const test = (name, fn) => {
    try {
      fn();
    } catch (e) {
      failed.push(`${name}: ${e.message}`);
    }
  };
  new Function('res', 'bru', 'test', 'expect', script(file))(res, bru, test, expect);
  return failed;
}

// One pair: a "before" read then an "after" read.
function pair(beforeFile, afterFile, beforeBody, afterBody) {
  const vars = {};
  const b = run(beforeFile, beforeBody, vars);
  const a = run(afterFile, afterBody, vars);
  return [...b, ...a];
}

describe.each([
  ['60655', FILES.zipBefore, FILES.zipAfter],
  ['Oak Lawn', FILES.townBefore, FILES.townAfter],
])('stock count pair for %s', (_label, before, after) => {
  test('a fixture coming, going or staying leaves the pair green', () => {
    expect(pair(before, after, page('zip-own-mount-greenwood'), page())).toEqual([]);
    expect(
      pair(before, after, page(), page('zip-own-oak-lawn', 'zip-own-mount-greenwood'))
    ).toEqual([]);
    expect(
      pair(before, after, page('zip-own-evergreen-park'), page('zip-own-evergreen-park'))
    ).toEqual([]);
  });

  test('stock events are still counted: the same stock cards stay green', () => {
    expect(
      pair(before, after, page('ev-1', 'ev-2'), page('ev-1', 'ev-2', 'zip-own-oak-lawn'))
    ).toEqual([]);
  });

  test('a real stock event appearing in the zip fails the pair (the empty-zip promise)', () => {
    const failed = pair(before, after, page('zip-own-mount-greenwood'), page('stock-event-9'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/expected '1' to deeply equal '0'/);
  });

  test('a real event going away fails the pair', () => {
    expect(pair(before, after, page('stock-event-9'), page())).toHaveLength(1);
  });

  test('an id that merely contains the prefix is a real event', () => {
    expect(pair(before, after, page(), page('my-zip-own-x'))).toHaveLength(1);
  });
});
