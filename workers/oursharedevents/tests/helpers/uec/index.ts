/**
 * OSE-325 — UEC test helpers barrel export.
 *
 * Single import surface for all UEC test helpers. Use:
 *
 *   import {
 *     requestCanonicalQR,
 *     assertUECMapping,
 *     loadCanonicalUEC,
 *   } from './helpers/uec';
 *
 * Note: This barrel re-exports from sibling files. It does NOT export
 * fixture data (those live under tests/fixtures/uec/ and are imported
 * directly so test files declare their fixture dependencies explicitly).
 */

export { loadCanonicalUEC, type CanonicalUEC } from './loader';
export {
  requestCanonicalQR,
  requestQrWithoutCode,
  type RequestOptions,
  type UecResolveSuccess,
  type UecResolveRefusal,
} from './request';
export { assertUECMapping, assertRefusalResponse, assertScanHex } from './assertions';
