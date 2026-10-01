/**
 * ADR-021 (OSE-906): production is read-only for every test suite.
 *
 * Locks the decision so it cannot drift:
 *   1. T2 Smoke → Production runs exactly the approved specs, and the API smoke
 *      specs make no write call.
 *   2. Every Playwright config exports guardProduction(__filename, config), and
 *      the guard refuses (or, for the two smoke configs, narrows) whenever any
 *      target is production: config base URLs, the env vars specs read, or
 *      getBaseUrl() (TEST_ENV / USE_PRODUCTION / APP_URL).
 *   3. security-smoke.spec.js: createEvent refuses on production, and every
 *      block that writes skips there.
 *   4. Every Bruno collection refuses writes to production before sending.
 *
 * Run: npx vitest run tests/integration/production-read-only.test.js
 */

const { existsSync, readdirSync, readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');
const {
  PRODUCTION_SMOKE_SPECS,
  TARGET_URL_ENV_VARS,
  guardProduction,
} = require('../../config/production-read-only');
const { isProductionUrl } = require('../../config/production-hosts');

const ROOT = join(__dirname, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const listFiles = (dir) =>
  readdirSync(join(ROOT, dir), { recursive: true }).map((rel) => `${dir}/${rel}`);

const PROD = 'https://oursharedevents.com';
const STG = 'https://stg.oursharedevents.com';
const WRITE_CALL =
  /\b(?:request|page\.request|context\.request|api)\.(post|put|patch|delete)\(|method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/;

const workflow = yaml.load(read('.github/workflows/oursharedevents-ci.yml'));
const prodJob = workflow.jobs['smoke-production'];
const prodJobRuns = prodJob.steps.map((s) => String(s.run ?? '')).join('\n');
const SECURITY_SMOKE = read('tests/e2e/1-smoke/security-smoke.spec.js');

/** Run fn with exactly these target env vars set (all others cleared). */
function withEnv(vars, fn) {
  const keys = [...TARGET_URL_ENV_VARS, 'APP_URL', 'TEST_ENV', 'USE_PRODUCTION'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  keys.forEach((k) => delete process.env[k]);
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    keys.forEach((k) =>
      saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
    );
  }
}

describe('ADR-021: production is read-only for tests (OSE-906)', () => {
  test('T2 Smoke → Production runs exactly the approved specs, through the approved configs', () => {
    const approved = Object.entries(PRODUCTION_SMOKE_SPECS).flatMap(([cfg, specs]) => {
      const testDir = read(cfg).match(/testDir:\s*['"]\.\/(.+?)['"]/)[1];
      return specs.map((s) => `${testDir}/${s}`);
    });
    const ran = [...new Set(prodJobRuns.match(/\btests\/\S+\.spec\.[jt]s\b/g))];
    expect(ran.sort()).toEqual(approved.sort());
    const configs = [...new Set([...prodJobRuns.matchAll(/--config=(\S+)/g)].map((m) => m[1]))];
    expect(configs.sort()).toEqual(Object.keys(PRODUCTION_SMOKE_SPECS).sort());
  });

  test('the API smoke specs on the production job make no write call', () => {
    for (const spec of prodJobRuns.match(/\btests\/api\/\S+\.spec\.ts\b/g)) {
      expect(read(spec), spec).not.toMatch(WRITE_CALL);
    }
  });

  test('every Playwright config exports guardProduction(__filename, config)', () => {
    const configs = readdirSync(ROOT).filter((f) =>
      /^playwright\..*config\.(ts|js|mjs|cjs)$/.test(f)
    );
    expect(configs.length).toBeGreaterThan(Object.keys(PRODUCTION_SMOKE_SPECS).length);
    for (const cfg of configs) {
      expect(read(cfg), cfg).toMatch(
        /^(export default|module\.exports =) guardProduction\(__filename, config\);$/m
      );
    }
  });

  // [name, config file, config, env vars, expected: 'allow' | 'refuse' | narrowed globs]
  const SMOKE = 'playwright.smoke.config.ts';
  const OTHER = 'playwright.e2e.config.ts';
  const SMOKE_GLOBS = PRODUCTION_SMOKE_SPECS[SMOKE].map((s) => `**/${s}`);
  test.each([
    ['staging is allowed', OTHER, { use: { baseURL: STG } }, {}, 'allow'],
    ['local is allowed', OTHER, { use: { baseURL: 'http://127.0.0.1:8787' } }, {}, 'allow'],
    ['config base = production', OTHER, { use: { baseURL: PROD } }, {}, 'refuse'],
    [
      'a project base = production',
      OTHER,
      { projects: [{ use: { baseURL: PROD } }] },
      {},
      'refuse',
    ],
    ['BASE_URL = production', OTHER, {}, { BASE_URL: PROD }, 'refuse'],
    ['STAGING_URL = production', OTHER, {}, { STAGING_URL: `${PROD}:443/` }, 'refuse'],
    [
      'PLAYWRIGHT_BASE_URL = www',
      OTHER,
      {},
      { PLAYWRIGHT_BASE_URL: 'https://WWW.oursharedevents.com.' },
      'refuse',
    ],
    [
      'userinfo cannot hide production',
      OTHER,
      {},
      { BASE_URL: 'https://u:p@oursharedevents.com/' },
      'refuse',
    ],
    ['TEST_ENV=production', OTHER, {}, { TEST_ENV: 'production' }, 'refuse'],
    ['USE_PRODUCTION=true', OTHER, {}, { USE_PRODUCTION: 'true' }, 'refuse'],
    ['APP_URL = production', OTHER, {}, { APP_URL: PROD }, 'refuse'],
    ['TEST_ENV=staging', OTHER, {}, { TEST_ENV: 'staging' }, 'allow'],
    ['lookalike host is not production', OTHER, {}, { BASE_URL: `${PROD}.evil.example` }, 'allow'],
    ['smoke config on staging', SMOKE, { use: { baseURL: STG } }, {}, 'allow'],
    ['smoke config on production narrows', SMOKE, {}, { USE_PRODUCTION: 'true' }, SMOKE_GLOBS],
  ])('%s', (_name, file, config, env, expected) => {
    withEnv(env, () => {
      const run = () => guardProduction(`/repo/${file}`, config);
      if (expected === 'refuse') return expect(run).toThrow(/ADR-021/);
      if (expected === 'allow') return expect(run()).toBe(config);
      expect(run().testMatch).toEqual(expected);
    });
  });

  test('every *URL env var a spec reads as its target is one the guard checks', () => {
    // Derived from the specs: a spec that starts reading a new *URL var fails
    // here until the var is added to TARGET_URL_ENV_VARS.
    const NOT_TARGETS = new Set(['GOOGLE_SCRIPT_URL']); // retired GAS endpoint, not an OSE host
    const found = new Set();
    for (const rel of listFiles('tests').filter((f) => /\.(ts|js|mjs|cjs)$/.test(f))) {
      for (const m of read(rel).matchAll(/process\.env\.([A-Z_]*URL[A-Z_]*)/g)) found.add(m[1]);
    }
    expect(found.has('BASE_URL')).toBe(true);
    for (const name of found) {
      if (!NOT_TARGETS.has(name)) expect(TARGET_URL_ENV_VARS, name).toContain(name);
    }
  });

  test('security-smoke: production is the shared host rule; createEvent refuses before it posts', () => {
    expect(SECURITY_SMOKE).toMatch(/const IS_PRODUCTION = isProductionUrl\(BASE_URL\);/);
    const fn = SECURITY_SMOKE.slice(SECURITY_SMOKE.indexOf('async function createEvent('));
    const guard = fn.indexOf('if (IS_PRODUCTION)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf('request.post('));
    expect(fn.slice(guard, fn.indexOf('request.post('))).toMatch(/throw new Error\(/);
  });

  test('security-smoke: every top-level block that writes is createEvent, cleanup, or skips on production', () => {
    const blocks = SECURITY_SMOKE.split(
      /(?=^(?:test\.describe\(|test\.afterAll\(|async function |function ))/m
    );
    // A block writes when it calls the HTTP write API directly or a helper that does.
    const writes = (b) => WRITE_CALL.test(b) || /\b(createOk|createEvent|leakedRows)\(/.test(b);
    for (const block of blocks.filter(writes)) {
      const ok =
        // The write helpers themselves (createEvent refuses on production)…
        /^async function (createEvent|createOk|leakedRows)\(/.test(block) ||
        block.startsWith('test.afterAll(') ||
        // …and every describe that uses them skips there.
        (block.startsWith('test.describe(') && /test\.skip\(IS_PRODUCTION,/.test(block));
      expect(ok, block.split('\n')[0]).toBe(true);
    }
  });

  test('every Bruno collection refuses writes to production before sending', () => {
    const collections = readdirSync(join(ROOT, 'bruno'))
      .map((d) => `bruno/${d}/opencollection.yml`)
      .filter((p) => existsSync(join(ROOT, p)));
    expect(collections.length).toBeGreaterThanOrEqual(3);
    for (const rel of collections) {
      const pre = (yaml.load(read(rel)).request?.scripts ?? []).find(
        (s) => s.type === 'before-request'
      );
      expect(pre?.code, rel).toMatch(/ADR-021/);
      // Run the collection's own script with a fake bru/req: a write to
      // production throws (Bruno then never sends it); reads and staging pass.
      const run = (baseUrl, method) =>
        new Function('bru', 'req', pre.code)(
          { getEnvVar: (k) => (k === 'baseUrl' ? baseUrl : ''), setVar() {}, getVar() {} },
          {
            getUrl: () => '{{baseUrl}}/api/x',
            getMethod: () => method,
            getHeader() {},
            setHeader() {},
          }
        );
      expect(() => run(PROD, 'POST'), rel).toThrow(/ADR-021/);
      expect(() => run('https://www.oursharedevents.com:443', 'DELETE'), rel).toThrow(/ADR-021/);
      expect(() => run('https://user@oursharedevents.com/', 'PUT'), rel).toThrow(/ADR-021/);
      expect(() => run(PROD, 'GET'), rel).not.toThrow();
      expect(() => run(STG, 'POST'), rel).not.toThrow();
      expect(() => run(`${PROD}.evil.example`, 'POST'), rel).not.toThrow();
    }
  });

  test.each([
    [PROD, true],
    ['https://www.oursharedevents.com/', true],
    ['https://OURSHAREDEVENTS.COM.:443/admin', true],
    ['https://u:p@oursharedevents.com', true],
    [STG, false],
    [`${PROD}.evil.example`, false],
    ['http://localhost:8787', false],
    [undefined, false],
    ['not a url', false],
  ])('isProductionUrl(%s) is %s', (url, expected) => {
    expect(isProductionUrl(url)).toBe(expected);
  });
});
