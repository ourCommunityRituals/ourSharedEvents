// @ts-check
//
// The language layer's mutation pass: Polish (OSE-1957) and Arabic, the first
// right-to-left language (epic OSE-1959, story OSE-1970; owner 2026-11-10:
// "mutation executions through the all permutations").
//
// Mutated: the language list and its chosen values, the direction map, the
// address prefix, header negotiation, the `{{lang}}` / `{{dir}}` slots, the
// footer switch, the `<bdi>` rule, and the catalog's lookup functions. The
// catalog text itself (catalog.ts above the range, catalog-pl.ts,
// catalog-ar.ts) is data: every value is pinned by the completeness,
// slot-parity and no-English checks, not by mutants.
//
// Why a second config and not more targets in stryker.conf.mjs: these files
// are imported by most of the Worker, so under the full node project each
// mutant in a hot function or a module-level map reran thousands of
// unrelated specs, and the mutation job went past 35 minutes (PR 1175). Here
// the tests are the specs written to kill these mutants
// (vitest.language-mutation.config.mts): the generated 800-cell permutation
// set, the language specs and the goldens. Same thresholds, same per-file
// floors (scripts/ci/mutation-file-floor.mjs reads both reports).
//
// Run: `npm run test:mutation:language`. CI runs it after `npm run
// test:mutation` in the `mutation` job of .github/workflows/mutation-testing.yml.

import base, { rangeOf } from './stryker.conf.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  vitest: { configFile: 'vitest.language-mutation.config.mts' },
  mutate: [
    'src/lib/i18n/languages.ts',
    'src/lib/i18n/bidi.ts',
    'src/lib/i18n/path-prefix.ts',
    'src/lib/i18n/template.ts',
    'src/lib/i18n/resolve-language.ts',
    'src/lib/i18n/language-switch.ts',
    rangeOf('src/lib/i18n/catalog.ts', 'export const CATALOG', 'export { DEFAULT_LANG }'),
  ],
  htmlReporter: { fileName: 'reports/mutation-language/index.html' },
  jsonReporter: { fileName: 'reports/mutation-language/mutation.json' },
};
