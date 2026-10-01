/**
 * ADR-021 (OSE-906): production is strictly read-only for every test suite.
 *
 * No suite seeds, mutates or probes-with-writes against production. The
 * post-deploy tier asserts health, schema version and public GET shapes only.
 * Every Playwright config except the two production-smoke ones calls
 * refuseProductionTargets() at config load, so pointing a suite that can write
 * at production fails before a single request is sent.
 */

const PRODUCTION_HOSTS = new Set(['oursharedevents.com', 'www.oursharedevents.com']);

/** True when `url` targets the production host (any scheme, port or path). */
function isProductionUrl(url) {
  if (!url) return false;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return PRODUCTION_HOSTS.has(host.toLowerCase().replace(/\.$/, ''));
}

/** Throw when a writing suite is pointed at production. */
function assertNotProduction(url, suite) {
  if (isProductionUrl(url)) {
    throw new Error(
      `ADR-021: ${suite} writes and must never target production (BASE_URL=${url}). ` +
        'Production is read-only for tests; point it at staging.'
    );
  }
}

/**
 * Refuse at config load when any URL a suite may target is production: the
 * config's own base plus BASE_URL and STAGING_URL, because many specs read those
 * env vars directly instead of the config's baseURL.
 */
function refuseProductionTargets(suite, ...urls) {
  for (const url of [...urls, process.env.BASE_URL, process.env.STAGING_URL]) {
    assertNotProduction(url, suite);
  }
}

/**
 * The only Playwright configs allowed to target production, and the only specs
 * each may discover when it does (paths relative to the config's testDir). These
 * are the T2 Smoke → Production job's specs. When either config targets
 * production, productionTestMatch() narrows its discovery to this list, so no
 * invocation (CI or local, any CLI filter) can pick up a spec that writes.
 * Every other playwright*.config.* calls refuseProductionTargets().
 */
const PRODUCTION_SMOKE_SPECS = {
  'playwright.e2e-smoke.config.ts': ['1-smoke/security-smoke.spec.js'],
  'playwright.smoke.config.ts': ['api-health.spec.ts', 'fail-fast-gates.spec.ts'],
};
const PRODUCTION_READ_ONLY_CONFIGS = Object.keys(PRODUCTION_SMOKE_SPECS);

/**
 * For a production-smoke config: undefined when no target is production (normal
 * discovery), else testMatch regexes matching only that config's approved specs.
 */
function productionTestMatch(config, ...urls) {
  const specs = PRODUCTION_SMOKE_SPECS[config];
  if (!specs) throw new Error(`ADR-021: ${config} is not a production-smoke config`);
  const targets = [...urls, process.env.BASE_URL, process.env.STAGING_URL];
  if (!targets.some(isProductionUrl)) return undefined;
  return specs.map(
    (rel) =>
      new RegExp(
        '[\\\\/]' +
          rel
            .split('/')
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('[\\\\/]') +
          '$'
      )
  );
}

module.exports = {
  PRODUCTION_HOSTS,
  PRODUCTION_READ_ONLY_CONFIGS,
  PRODUCTION_SMOKE_SPECS,
  isProductionUrl,
  productionTestMatch,
  assertNotProduction,
  refuseProductionTargets,
};
