/**
 * ADR-021 (OSE-906): production is read-only for every test suite.
 *
 * Every playwright*.config.* exports `guardProduction(__filename, defineConfig({...}))`.
 * At config load the guard collects every URL the suite may reach. If any is
 * production:
 *   - a config listed in PRODUCTION_SMOKE_SPECS (the T2 Smoke → Production job's
 *     configs) gets its discovery narrowed to its approved read-only specs;
 *   - every other config throws before a single request is sent.
 */

const path = require('path');
const { getBaseUrl } = require('./environments');
const { isProductionUrl } = require('./production-hosts');

/**
 * The only configs that may target production, and the only specs each may
 * discover when it does (paths relative to the config's testDir).
 */
const PRODUCTION_SMOKE_SPECS = {
  'playwright.e2e-smoke.config.ts': ['1-smoke/security-smoke.spec.js'],
  'playwright.smoke.config.ts': ['api-health.spec.ts', 'fail-fast-gates.spec.ts'],
};

/**
 * Env vars that specs read directly as their target URL, instead of the
 * config's baseURL. The gate re-derives this from the specs, so a spec that
 * starts reading a new *URL var fails CI until it is listed here.
 */
const TARGET_URL_ENV_VARS = ['BASE_URL', 'STAGING_URL', 'PLAYWRIGHT_BASE_URL'];

/**
 * Every target the suite may reach: the config's own base URLs, the env-var
 * targets, and what getBaseUrl() resolves to now (TEST_ENV, USE_PRODUCTION,
 * APP_URL: the same resolver the specs call).
 */
function targetUrls(config) {
  return [
    config.use?.baseURL,
    ...(config.projects ?? []).map((p) => p.use?.baseURL),
    ...TARGET_URL_ENV_VARS.map((k) => process.env[k]),
    getBaseUrl(),
  ];
}

/** Wrap a Playwright config so it cannot write to production. */
function guardProduction(configFile, config) {
  const name = path.basename(configFile);
  if (!targetUrls(config).some(isProductionUrl)) return config;
  const specs = PRODUCTION_SMOKE_SPECS[name];
  if (!specs) {
    throw new Error(
      `ADR-021: ${name} can write and must never target production. ` +
        'Production is read-only for tests; point it at staging.'
    );
  }
  return { ...config, testMatch: specs.map((rel) => `**/${rel}`) };
}

module.exports = { PRODUCTION_SMOKE_SPECS, TARGET_URL_ENV_VARS, guardProduction };
