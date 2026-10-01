/**
 * ADR-021 (OSE-906): production is strictly read-only for every test suite.
 *
 * No suite seeds, mutates or probes-with-writes against production. The
 * post-deploy tier asserts health, schema version and public GET shapes only.
 * Suites that write (red-team T5, the T6 finale, staging E2E) call
 * assertNotProduction() at config load so pointing them at production fails
 * before a single request is sent.
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

module.exports = { PRODUCTION_HOSTS, isProductionUrl, assertNotProduction };
