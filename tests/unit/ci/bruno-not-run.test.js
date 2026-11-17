/* eslint-disable security/detect-non-literal-fs-filename -- a report written to a temp folder by this test, and the repo's own workflow */
/**
 * The NOT RUN names of a Bruno run, carried to the job summary
 * (scripts/ci/bruno-not-run.mjs).
 *
 * The report read here is written by Bruno's own JUnit reporter
 * (@usebruno/cli/src/reporters/junit.js, the code `bru run --reporter-junit`
 * runs), from results shaped as the runner hands them over. So the format this
 * reads is the format T2 writes, not a copy of it.
 *
 * BORN RED (2026-11-15). The module was faulted, one fault at a time, this file
 * run, and the fault taken out. What is written is what was seen:
 *   J1  any test name is taken (the prefix check removed)
 *         -> "are read from the report", "only a name that starts", "the summary
 *            counts them" and "prints the summary of the report it is given"
 *   J2  XML entities are not turned back
 *         -> "quotes, angle brackets and ampersands in a name come back as written"
 *   J3  the request is not tracked (every test gets the first request)
 *         -> "are read from the report" and "the summary counts them"
 *   J4  a failed NOT RUN test is listed like a passed one
 *         -> "a NOT RUN test that failed is marked"
 *   J5  workflow: the Summary step no longer runs the script
 *         -> "the T2 Summary step runs it on the section report"
 *   J6  a tag ends at the first `>`, quoted or not (how this module was first
 *       written; this file's first run caught it)
 *         -> "quotes, angle brackets and ampersands in a name come back as written"
 */
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const makeJUnitOutput = require('@usebruno/cli/src/reporters/junit.js');

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'bruno-not-run.mjs');

const NOT_LOADED =
  'NOT RUN (street-map archive not loaded on this environment: streetMapArchiveLoaded is not true): ';
const LANDING =
  NOT_LOADED + 'street layer under the hexagons, OpenStreetMap credit, no third-party host';
const ZOOM = NOT_LOADED + 'the area and a dot per place over the street layer';

/** One request's result, as Bruno's runner gives it to a reporter. */
const result = (name, tests) => ({
  name,
  path: `1. Landing - Public/${name}.yml`,
  test: { filename: `1. Landing - Public/${name}.yml` },
  runDuration: 0.25,
  request: { method: 'GET', url: 'https://stg.example.test/' },
  response: { status: 200 },
  assertionResults: [],
  testResults: tests.map(([description, status = 'pass']) => ({
    description,
    status,
    ...(status === 'fail' ? { error: 'expected "true " to equal "false"' } : {}),
  })),
});

let dir;
let mod;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ose-bruno-not-run-'));
  mod = await import('../../../scripts/ci/bruno-not-run.mjs');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The JUnit text Bruno writes for these results. */
async function junit(results, file = 'report.xml') {
  const out = join(dir, file);
  await makeJUnitOutput(results, out, { secretValues: [] });
  return readFileSync(out, 'utf8');
}

const RUN = [
  result('GET / (landing) - draws streets under the map', [
    ['Returns 200'],
    ['Without streets the map is hexagons only, with no OpenStreetMap credit'],
    [LANDING],
  ]),
  result('GET /events', [['Returns 200'], ['Says "not run" in its words, and is not one']]),
  result('OSE-1891 | GET /?area=872664405ffffff | zoomed list', [['Returns 200'], [ZOOM]]),
];

describe('the NOT RUN names of a Bruno run', () => {
  test('are read from the report Bruno writes, each with its request, in order', async () => {
    expect(mod.notRunTests(await junit(RUN))).toEqual([
      { request: 'GET / (landing) - draws streets under the map', name: LANDING, status: 'pass' },
      {
        request: 'OSE-1891 | GET /?area=872664405ffffff | zoomed list',
        name: ZOOM,
        status: 'pass',
      },
    ]);
  });

  test('only a name that starts "NOT RUN (" counts', async () => {
    const xml = await junit([
      result('r', [
        ['Returns 200'],
        ['The street assertions did NOT RUN (see above)'],
        ['not run (lower case)'],
        ['NOT RUN without a reason'],
      ]),
    ]);
    expect(mod.notRunTests(xml)).toEqual([]);
    expect(mod.notRunSummary(xml)).toBe('No test of this run is named NOT RUN.\n');
  });

  test('quotes, angle brackets and ampersands in a name come back as written', async () => {
    const name = 'NOT RUN (the flag is not "true" & the page drew <no> map): the dot\'s target';
    const xml = await junit([result('a "quoted" & <odd> request', [[name]])]);
    expect(xml).not.toContain(name); // the reporter escaped it
    expect(mod.notRunTests(xml)).toEqual([
      { request: 'a "quoted" & <odd> request', name, status: 'pass' },
    ]);
  });

  test('the summary counts them and names each with its request', async () => {
    const md = mod.notRunSummary(await junit(RUN));
    expect(md.split('\n')[0]).toBe('**NOT RUN: 2 tests of this run say what they did not check.**');
    expect(md).toContain(
      `- ${LANDING} (request \`GET / (landing) - draws streets under the map\`)`
    );
    expect(md).toContain(
      `- ${ZOOM} (request \`OSE-1891 | GET /?area=872664405ffffff | zoomed list\`)`
    );
    expect(md).not.toContain('Returns 200');
    const one = mod.notRunSummary(await junit([RUN[0]]));
    expect(one.split('\n')[0]).toBe('**NOT RUN: 1 test of this run say what they did not check.**');
  });

  test('a NOT RUN test that failed is marked, so it does not read as an allowed gap', async () => {
    const xml = await junit([result('r', [[LANDING, 'fail']])]);
    expect(mod.notRunTests(xml)).toEqual([{ request: 'r', name: LANDING, status: 'fail' }]);
    expect(mod.notRunSummary(xml)).toContain(`- **FAIL** ${LANDING} (request \`r\`)`);
  });
});

describe('the script, as the workflow runs it', () => {
  const run = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  test('prints the summary of the report it is given', async () => {
    await junit(RUN, 'bru-pages-junit.xml');
    const out = run(join(dir, 'bru-pages-junit.xml'));
    expect(out).toContain('**NOT RUN: 2 tests');
    expect(out).toContain(LANDING);
  });

  test('a missing report is said, and is not an error', () => {
    expect(run(join(dir, 'nothing-here.xml'))).toMatch(
      /^NOT RUN names could not be read: no JUnit report at `.*nothing-here\.xml`\.\n$/
    );
    expect(run()).toContain('no JUnit report at `(no path given)`');
  });

  test('the T2 Summary step runs it on the section report, into the job summary', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'), 'utf8');
    const job = wf.slice(
      wf.indexOf('  contract-staging-sub:'),
      wf.indexOf('\n  contract-staging:')
    );
    expect(job.length).toBeGreaterThan(1000);
    const summary = job.slice(job.lastIndexOf('      - name: Summary'));
    expect(summary).toContain('if: always()');
    expect(summary).toContain(
      'node scripts/ci/bruno-not-run.mjs ".test-results/${{ matrix.junit }}" >> $GITHUB_STEP_SUMMARY'
    );
    // The report it reads is the one the Bruno step writes.
    expect(job).toContain('--reporter-junit "$GITHUB_WORKSPACE/.test-results/${{ matrix.junit }}"');
  });
});
