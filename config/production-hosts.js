/**
 * The one rule for "is this URL production?" (oursharedevents.com, www.).
 * Used by config/environments.js, config/feature-flags.js and the ADR-021 guard
 * (config/production-read-only.js), so the host list lives in one place.
 */

const PRODUCTION_HOSTS = new Set(['oursharedevents.com', 'www.oursharedevents.com']);

/** True when `url` targets production (any scheme, port, path, case, userinfo or trailing dot). */
function isProductionUrl(url) {
  if (!url) return false;
  try {
    return PRODUCTION_HOSTS.has(new URL(url).hostname.toLowerCase().replace(/\.$/, ''));
  } catch {
    return false;
  }
}

module.exports = { PRODUCTION_HOSTS, isProductionUrl };
