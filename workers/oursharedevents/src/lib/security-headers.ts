/**
 * Cross-cutting HTTP hardening headers (OSE-1186 G2, 2026-09-09).
 *
 * The DAST baseline (OWASP ZAP, `.github/workflows/dast-zap-baseline.yml`)
 * flagged every public surface for a missing `Permissions-Policy` and the
 * Cross-Origin isolation trio (`10063`, `90004`). Those headers are
 * content-type-agnostic and belong on every response, so they are defined
 * ONCE here and spread into each surface — rather than copied into the eight
 * places that already hand-roll a header block, where they would drift.
 *
 * What is deliberately NOT centralised: `Content-Security-Policy` and
 * `X-Frame-Options`. Those vary intentionally per surface (form/privacy pages
 * use `frame-ancestors 'none'` + `X-Frame-Options: DENY`; the public pages use
 * `SAMEORIGIN`; the sponsor-logo asset route uses `default-src 'none'`), so
 * each surface keeps its own — homogenising them would weaken the stricter
 * ones. Centralise the shared contract, respect the local intent.
 */

// Powerful device APIs the app never uses are denied outright; `interest-cohort`
// opts out of FLoC/Topics. One answer for every surface.
export const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

/**
 * Cross-origin isolation. The Worker is entirely same-origin (CSP
 * `default-src 'self'`; images are `'self'` + `data:`) with no cross-origin
 * embeds, so `require-corp` is safe: same-origin subresources load without a
 * CORP grant, and there is nothing cross-origin to block.
 */
export const CROSS_ORIGIN_ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/**
 * The full cross-cutting hardening set. Spread this into every surface's header
 * block; the DAST gates on its presence (ZAP rules 10063/90004 → FAIL).
 */
export const HARDENING_HEADERS: Readonly<Record<string, string>> = {
  'Permissions-Policy': PERMISSIONS_POLICY,
  ...CROSS_ORIGIN_ISOLATION_HEADERS,
};
