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
 *   4. Writing suites (red-team T5/T6) refuse a production BASE_URL at config load.
 *
 * Run: npx vitest run tests/integration/production-read-only.test.js
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');
const { isProductionUrl, assertNotProduction } = require('../../config/production-read-only');

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

  test('writing suites refuse a production BASE_URL at config load', () => {
    expect(read('playwright.red-team.config.ts')).toMatch(
      /assertNotProduction\(process\.env\.BASE_URL,/
    );
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
