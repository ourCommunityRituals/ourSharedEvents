/**
 * Phone audit scope: the audit is a required check, so its job starts on every
 * pull request. This decides whether a given PR changes anything the audit
 * measures. Two ways to be wrong, and only one is safe: running when nothing
 * changed costs minutes; not running when a page changed lets a phone
 * regression merge behind a green required check.
 */

let auditIsInScope;

beforeAll(async () => {
  ({ auditIsInScope } = await import('../../../scripts/ci/phone-audit-scope.mjs'));
});

describe('a change the audit measures runs it', () => {
  test.each([
    ['a page template', 'workers/oursharedevents/src/templates/public.html'],
    ['a handler', 'workers/oursharedevents/src/handlers/pages.ts'],
    ['a lib the pages read', 'workers/oursharedevents/src/lib/event-list.ts'],
    ['a migration the local worker applies', 'workers/oursharedevents/migrations/0095_x.sql'],
    ['a forms migration', 'workers/oursharedevents/migrations-forms/0016_x.sql'],
    ['the worker config', 'workers/oursharedevents/wrangler.toml'],
    ['the worker lockfile', 'workers/oursharedevents/package-lock.json'],
    ['an audit spec', 'tests/playwright/mobile-workability.spec.ts'],
    ['an audit helper', 'tests/playwright/helpers/sponsor-home-seed.ts'],
    ['the audit config', 'playwright.mobile.config.ts'],
    ['the shared stylesheet pin', '.ocr-hub-ref'],
    ['the workflow itself', '.github/workflows/mobile-workability-audit.yml'],
    ['the root lockfile', 'package-lock.json'],
    ['this rule', 'scripts/ci/phone-audit-scope.mjs'],
  ])('%s', (_label, file) => {
    expect(auditIsInScope([file])).toBe(true);
  });

  test('one measured file among many unmeasured ones is enough', () => {
    expect(
      auditIsInScope([
        'README.md',
        'docs/a.md',
        'workers/oursharedevents/src/templates/poster.html',
      ])
    ).toBe(true);
  });
});

describe('a change the audit cannot see does not run it', () => {
  test.each([
    ['docs', 'docs/qa/MOBILE-WORKABILITY-BASELINE-2026-10-06.md'],
    ['the project brain', 'CLAUDE.md'],
    ['a worker unit test', 'workers/oursharedevents/tests/qr-roundtrip.spec.ts'],
    ['worker docs', 'workers/oursharedevents/docs/ops/TDD-RED-MAP.md'],
    ['another workflow', '.github/workflows/codeql.yml'],
    ['a staging-only spec', 'tests/e2e/3-flows/sponsor-journey.spec.ts'],
    ['a Bruno request', 'bruno/ose-api/01-health/health.bru'],
  ])('%s', (_label, file) => {
    expect(auditIsInScope([file])).toBe(false);
  });
});

describe('when the changed files are unknown, run', () => {
  test('an empty list means the list could not be read', () => {
    expect(auditIsInScope([])).toBe(true);
  });

  test('blank lines are not files', () => {
    expect(auditIsInScope(['', '  '])).toBe(true);
  });

  test('a Windows-style path still matches', () => {
    expect(auditIsInScope(['workers\\oursharedevents\\src\\templates\\landing.html'])).toBe(true);
  });
});
