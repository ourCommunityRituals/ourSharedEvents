/**
 * ADR-021 (OSE-906): production is strictly read-only for every test suite.
 *
 * Locks the decision so it cannot drift:
 *   1. The T2 Smoke → Production job runs only the allowlisted specs. A new spec
 *      on that job has to be added here, in review, after its writes are checked.
 *   2. The two API smoke specs contain no write call at all.
 *   3. security-smoke.spec.js: every describe that writes skips on production,
 *      createEvent refuses on production, and production detection is the shared
 *      isProductionUrl() helper, so the URL the job passes is caught.
 *   4. Every Playwright config except the two production-smoke ones refuses a
 *      production target at config load.
 *
 * Run: npx vitest run tests/integration/production-read-only.test.js
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');
const { readdirSync } = require('fs');
const {
  isProductionUrl,
  assertNotProduction,
  refuseProductionTargets,
  productionTestMatch,
  PRODUCTION_READ_ONLY_CONFIGS,
  PRODUCTION_SMOKE_SPECS,
} = require('../../config/production-read-only');

const ROOT = join(__dirname, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const PROD_SMOKE_SPECS = [
  'tests/e2e/1-smoke/security-smoke.spec.js',
  'tests/api/smoke/api-health.spec.ts',
  'tests/api/smoke/fail-fast-gates.spec.ts',
];
const WRITE_CALL =
  /\b(?:request|page\.request|context\.request|api)\.(post|put|patch|delete)\(|method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/g;

const workflow = yaml.load(read('.github/workflows/oursharedevents-ci.yml'));
const job = workflow.jobs['smoke-production'];

describe('ADR-021: production is read-only for tests (OSE-906)', () => {
  test('T2 Smoke → Production runs only the allowlisted specs', () => {
    expect(job, 'smoke-production job exists').toBeTruthy();
    const specs = new Set();
    for (const step of job.steps) {
      for (const m of String(step.run ?? '').matchAll(/\btests\/\S+\.spec\.[jt]s\b/g))
        specs.add(m[0]);
    }
    expect([...specs].sort()).toEqual([...PROD_SMOKE_SPECS].sort());
  });

  test('the API smoke specs make no write calls', () => {
    for (const rel of PROD_SMOKE_SPECS.filter((p) => p.startsWith('tests/api/'))) {
      expect(read(rel).match(WRITE_CALL), rel).toBeNull();
    }
  });

  test("security-smoke's production check is the shared helper and matches the job's URL", () => {
    const src = read('tests/e2e/1-smoke/security-smoke.spec.js');
    expect(src).toMatch(/const IS_PRODUCTION = isProductionUrl\(BASE_URL\);/);
    expect(isProductionUrl(workflow.env.PROD_BASE_URL)).toBe(true);
  });

  test('security-smoke: createEvent refuses on production before it posts', () => {
    const src = read('tests/e2e/1-smoke/security-smoke.spec.js');
    const fn = src.slice(src.indexOf('async function createEvent('));
    const guard = fn.indexOf('if (IS_PRODUCTION)');
    const post = fn.indexOf('request.post(');
    expect(guard, 'IS_PRODUCTION guard in createEvent').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(post);
    expect(fn.slice(guard, post)).toMatch(/throw new Error\(/);
  });

  test('security-smoke: every describe that writes skips on production', () => {
    const src = read('tests/e2e/1-smoke/security-smoke.spec.js');
    const blocks = src.split(/(?=^test\.describe\()/m).slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const title = block.match(/test\.describe\((['"`])(.*?)\1/)?.[2];
      WRITE_CALL.lastIndex = 0;
      if (/\b(createOk|createEvent|leakedRows)\(/.test(block) || WRITE_CALL.test(block)) {
        expect(block, title).toMatch(/test\.skip\(IS_PRODUCTION,/);
      }
    }
  });

  test('security-smoke: the only write sites are createEvent, cleanup, and the rejected-key probe (all skipped on production)', () => {
    const src = read('tests/e2e/1-smoke/security-smoke.spec.js');
    const sites = [...src.matchAll(WRITE_CALL)].map((m) => {
      const before = src.slice(0, m.index);
      const fn = before.lastIndexOf('async function createEvent(');
      const after = before.lastIndexOf('test.afterAll(');
      const probe = before.lastIndexOf("test.describe('🔒 SECURITY: Admin key validation'");
      const latest = Math.max(fn, after, probe);
      if (latest === -1) return 'unknown';
      // The nearest enclosing marker must not have been closed by another top-level block.
      const between = src.slice(latest, m.index);
      if (
        /^(test\.describe|async function|function|test\.(beforeAll|afterAll))\b/m.test(
          between.slice(1)
        )
      ) {
        return 'unknown';
      }
      return latest === fn ? 'createEvent' : latest === after ? 'cleanup' : 'rejected-key-probe';
    });
    expect(sites.sort()).toEqual(['cleanup', 'createEvent', 'rejected-key-probe']);
    // The probe only ever sends keys that must be refused.
    const probe = src.slice(src.indexOf("test.describe('🔒 SECURITY: Admin key validation'"));
    expect(probe.slice(0, probe.indexOf('\n});'))).toMatch(/toBe\(401\)/);
  });

  test('the production-smoke configs can discover only the approved specs on production', () => {
    // One list: the helper's per-config specs, resolved against each testDir,
    // are exactly the specs the smoke-production job runs.
    const resolved = [];
    for (const [cfg, specs] of Object.entries(PRODUCTION_SMOKE_SPECS)) {
      const src = read(cfg);
      const testDir = src.match(/testDir:\s*['"]\.\/(.+?)['"]/)[1];
      resolved.push(...specs.map((s) => `${testDir}/${s}`));
      // Narrowed before export, and applied as testMatch.
      const call = src.indexOf(`productionTestMatch('${cfg}'`);
      const exp = src.search(/^export default/m);
      expect(call, `${cfg}: productionTestMatch call`).toBeGreaterThan(-1);
      expect(call, `${cfg}: before export`).toBeLessThan(exp);
      expect(src, cfg).toMatch(
        /\.\.\.\(PRODUCTION_ONLY \? \{ testMatch: PRODUCTION_ONLY \} : \{\}\)/
      );
    }
    expect(resolved.sort()).toEqual([...PROD_SMOKE_SPECS].sort());

    const saved = process.env.BASE_URL;
    try {
      delete process.env.BASE_URL;
      expect(
        productionTestMatch(PRODUCTION_READ_ONLY_CONFIGS[0], 'https://stg.oursharedevents.com')
      ).toBeUndefined();
      const m = productionTestMatch('playwright.smoke.config.ts', 'https://oursharedevents.com');
      const hits = (p) => m.some((r) => r.test(p));
      expect(hits('/r/tests/api/smoke/api-health.spec.ts')).toBe(true);
      expect(hits('C:\\r\\tests\\api\\smoke\\fail-fast-gates.spec.ts')).toBe(true);
      expect(hits('/r/tests/api/smoke/form-endpoints.spec.ts')).toBe(false);
      expect(hits('/r/tests/api/smoke/xapi-health.spec.ts')).toBe(false);
      expect(() => productionTestMatch('playwright.e2e.config.ts', 'x')).toThrow(/ADR-021/);
    } finally {
      if (saved === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = saved;
    }
  });

  test('every Playwright config outside the allowlist refuses production at load', () => {
    const configs = readdirSync(ROOT).filter((f) =>
      /^playwright\..*config\.(ts|js|mjs|cjs)$/.test(f)
    );
    expect(configs.length).toBeGreaterThan(PRODUCTION_READ_ONLY_CONFIGS.length);
    // The allowlist is exactly the configs the production smoke job runs.
    const prodJobConfigs = new Set();
    for (const step of job.steps) {
      for (const m of String(step.run ?? '').matchAll(/--config=(\S+)/g)) prodJobConfigs.add(m[1]);
    }
    expect([...prodJobConfigs].sort()).toEqual([...PRODUCTION_READ_ONLY_CONFIGS].sort());
    for (const cfg of configs) {
      const src = read(cfg);
      if (PRODUCTION_READ_ONLY_CONFIGS.includes(cfg)) continue;
      expect(src, cfg).toMatch(/\brefuseProductionTargets\(/);
      // Called before the config is exported, so it runs at load.
      const call = src.search(/^refuseProductionTargets\(/m);
      const exp = src.search(/^(export default|module\.exports)/m);
      expect(call, `${cfg}: refusal call`).toBeGreaterThan(-1);
      expect(call, `${cfg}: refusal before export`).toBeLessThan(exp);
    }
  });

  test('the refusal catches production in BASE_URL, STAGING_URL or the config base', () => {
    const saved = { BASE_URL: process.env.BASE_URL, STAGING_URL: process.env.STAGING_URL };
    try {
      delete process.env.BASE_URL;
      delete process.env.STAGING_URL;
      expect(() => refuseProductionTargets('t', 'https://stg.oursharedevents.com')).not.toThrow();
      expect(() => refuseProductionTargets('t', 'https://oursharedevents.com')).toThrow(/ADR-021/);
      process.env.BASE_URL = 'https://www.oursharedevents.com';
      expect(() => refuseProductionTargets('t')).toThrow(/ADR-021/);
      delete process.env.BASE_URL;
      process.env.STAGING_URL = 'https://oursharedevents.com:443/';
      expect(() => refuseProductionTargets('t')).toThrow(/ADR-021/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('isProductionUrl matches production hosts only', () => {
    for (const url of [
      'https://oursharedevents.com',
      'https://www.oursharedevents.com/',
      'https://OURSHAREDEVENTS.COM.:443/admin',
    ]) {
      expect(isProductionUrl(url), url).toBe(true);
      expect(() => assertNotProduction(url, 'test')).toThrow(/ADR-021/);
    }
    for (const url of [
      'https://stg.oursharedevents.com',
      'https://oursharedevents.com.evil.example',
      'http://localhost:8787',
      undefined,
      'not a url',
    ]) {
      expect(isProductionUrl(url), String(url)).toBe(false);
    }
  });
});
