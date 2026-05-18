/**
 * OSE-325 — UEC canonical loader helpers.
 *
 * `loadCanonicalUEC()` is the parameterized-test entry point. Returns
 * the typed CODES array (and version + verticals) for tests that want
 * to sweep across every canonical code without hardcoding.
 *
 * Usage:
 *
 *   const { codes, version, verticals } = loadCanonicalUEC();
 *   for (const code of codes) {
 *     test(`${code.id} resolves`, () => { ... });
 *   }
 *
 * Source: OSE consumed copy (src/lib/uec/uec-codes.ts), which the OSE-323
 * drift check keeps byte-equivalent with brain canonical. Loading from
 * the consumed copy means tests don't need brain checkout to run.
 */

import { CODES, VERSION, VERTICALS, type UECCode } from '../../../src/lib/uec';

export interface CanonicalUEC {
  codes: ReadonlyArray<UECCode>;
  version: string;
  verticals: ReadonlyArray<string>;
}

/**
 * Load the canonical UEC artifact for parameterized testing. Returns
 * the typed shape backed by the OSE consumed copy.
 *
 * Stable across UEC version bumps: v1.2 codes flow through automatically.
 */
export function loadCanonicalUEC(): CanonicalUEC {
  return {
    codes: CODES,
    version: VERSION,
    verticals: VERTICALS,
  };
}
