/**
 * scripts/ci/warm-playwright-browser.mjs and the job that calls it.
 *
 * On 2026-10-08 (PR #885, run 37795716364) T0 Gate (component) failed with no
 * code at fault. WebKit had been downloaded 45 seconds earlier. The first
 * WebKit test on each of the two workers ended with `Test timeout of 30000ms
 * exceeded while setting up "page"`: the browser had started, and the first
 * page it was asked for never opened. The next two WebKit browsers, started
 * 4 seconds later, opened a page and passed, as did all 78 later WebKit tests.
 *
 * Starting the browser is not on the test's 30 second limit (Playwright's
 * `browser` fixture has its own), so a longer launch limit changes nothing.
 * Opening the page is, so the first page is opened before the tests, once,
 * by this script.
 *
 * Hermetic: a stub stands in for Playwright (PW_WARM_MODULE), so no browser
 * starts. The real WebKit on a real runner is proven by the job itself, which
 * prints how long the first page took.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const SCRIPT_REL = 'scripts/ci/warm-playwright-browser.mjs';
const SCRIPT = join(ROOT, SCRIPT_REL);

// The stub records each call. `newPage` is where the real failure sat, so that
// is the call the stub can hold open, either once (STUB_MARK) or every time.
const STUB = `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const say = (m) => appendFileSync(process.env.STUB_LOG, m + '\\n');
const never = () => new Promise(() => setInterval(() => {}, 1000));
const mode = process.env.STUB_MODE || 'ok';
const page = {
  setContent: async () => say('setContent'),
  screenshot: async () => say('screenshot'),
  goto: async (url) => say('goto ' + url),
};
const browser = {
  newPage: async () => {
    say('newPage');
    if (mode === 'page-never-opens') return never();
    if (mode === 'first-page-hangs' && !existsSync(process.env.STUB_MARK)) {
      writeFileSync(process.env.STUB_MARK, '');
      return never();
    }
    return page;
  },
  close: async () => say('close'),
};
const type = (name) => ({
  launch: async () => {
    say('launch ' + name);
    if (mode === 'launch-fails') throw new Error('Host system is missing dependencies to run browsers.');
    return browser;
  },
});
export const chromium = type('chromium');
export const webkit = type('webkit');
`;

let dir, log;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-warm-'));
  log = join(dir, 'calls.log');
  writeFileSync(join(dir, 'stub-playwright.mjs'), STUB);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args = ['webkit'], env = {}) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PW_WARM_MODULE: join(dir, 'stub-playwright.mjs'),
      PW_WARM_ATTEMPT_SECONDS: '1 10',
      STUB_LOG: log,
      STUB_MARK: join(dir, 'first-page-was-asked-for'),
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n') : [];
  return { code: res.status, out: `${res.stdout}${res.stderr}`, calls, ms: Date.now() - started };
}

// Each case starts node once per attempt and may wait out a real limit.
describe('warm-playwright-browser.mjs', { timeout: 60_000 }, () => {
  test('starts the browser, opens a page, draws it and closes', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(['launch webkit', 'newPage', 'setContent', 'screenshot', 'close']);
    expect(r.out).toMatch(/webkit opened a blank page in \d+(\.\d)?s \(attempt 1 of 2\)/);
  });

  test('never loads a page of the app, so it cannot stand in for a test', () => {
    const r = run();
    expect(r.calls.filter((c) => c.startsWith('goto'))).toEqual([]);
    expect(readFileSync(SCRIPT, 'utf-8')).not.toMatch(/\.goto\(|baseURL|127\.0\.0\.1|localhost/);
  });

  test('a first page that never opens is stopped at its limit and the next attempt passes', () => {
    const r = run(undefined, { STUB_MODE: 'first-page-hangs' });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      'launch webkit',
      'newPage',
      'launch webkit',
      'newPage',
      'setContent',
      'screenshot',
      'close',
    ]);
    expect(r.out).toContain('::warning::webkit did not open a blank page in 1s (attempt 1 of 2).');
    expect(r.out).toMatch(/webkit opened a blank page in \d+(\.\d)?s \(attempt 2 of 2\)/);
  });

  test('a page that never opens fails the step and says no test ran', () => {
    const r = run(undefined, { STUB_MODE: 'page-never-opens', PW_WARM_ATTEMPT_SECONDS: '1 1' });
    expect(r.code).toBe(1);
    expect(r.calls.filter((c) => c === 'newPage')).toHaveLength(2);
    expect(r.out).toContain('::error title=Browser did not open a page::');
    expect(r.out).toContain('No test ran');
    expect(r.out).not.toContain('opened a blank page in');
    // Two attempts of 1 second each: the limit is what ended them.
    expect(r.ms).toBeLessThan(6_000);
  });

  test('a browser that cannot start is tried again, then reported with its own error', () => {
    const r = run(undefined, { STUB_MODE: 'launch-fails' });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual(['launch webkit', 'launch webkit']);
    expect(r.out).toContain('Host system is missing dependencies to run browsers.');
    expect(r.out).toContain('::error title=Browser did not open a page::');
  });

  test('each browser named is warmed, in the order given', () => {
    const r = run(['chromium', 'webkit']);
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => c.startsWith('launch'))).toEqual([
      'launch chromium',
      'launch webkit',
    ]);
  });

  test('no browser, an unknown browser or a bad limit is a usage error', () => {
    for (const r of [
      run([]),
      run(['safari']),
      run(undefined, { PW_WARM_ATTEMPT_SECONDS: '0' }),
      run(undefined, { PW_WARM_ATTEMPT_SECONDS: 'soon' }),
    ]) {
      expect(r.code).toBe(2);
      expect(r.calls).toEqual([]);
    }
  });
});

// ─── The job that failed on 2026-10-08 warms WebKit before its tests ─────────
describe('T0 Gate (component) opens a WebKit page before the tests', () => {
  const steps = yaml.load(
    readFileSync(join(ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'), 'utf-8')
  ).jobs.gate.steps;
  const component = steps.find(
    (s) => s && s.name === 'Component: viewport specs vs local worker'
  ).run;

  test('after the install and before the tests, in the same step', () => {
    const install = component.indexOf(
      'bash scripts/ci/install-playwright-browsers.sh chromium webkit\n'
    );
    const warm = component.indexOf(`node ${SCRIPT_REL} webkit\n`);
    const tests = component.indexOf('scripts/pw-guarded.sh');
    expect(install).toBeGreaterThanOrEqual(0);
    expect(warm).toBeGreaterThan(install);
    expect(tests).toBeGreaterThan(warm);
  });

  test('nothing lets the step carry on after a failed warm-up', () => {
    expect(component).not.toMatch(/warm-playwright-browser\.mjs[^\n]*(\|\||;|&)/);
    expect(steps.find((s) => s && s.run === component)['continue-on-error']).toBeUndefined();
  });

  // The warm-up is the fix. A retry or a longer test limit would also turn the
  // job green, and would hide a page of the app that hangs.
  test('the component config keeps no retries and a 30 second test limit', () => {
    const cfg = readFileSync(join(ROOT, 'playwright.component.config.ts'), 'utf-8');
    expect(cfg).toMatch(/^ {2}retries: 0,/m);
    expect(cfg).toMatch(/^ {2}timeout: 30_000,/m);
    expect(cfg).not.toMatch(/retries: [1-9]/);
  });
});
