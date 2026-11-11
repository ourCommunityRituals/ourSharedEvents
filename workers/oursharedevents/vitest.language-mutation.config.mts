import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The Vitest project for the language layer's mutation pass
// (stryker.language.conf.mjs). Polish and Arabic, epic OSE-1959, story OSE-1970.
//
// Why a project of its own: the language layer's functions (msg, fmt, the
// template slots, the address prefix) run on every page render, and its maps
// are module-level constants. Under the full node project each such mutant
// reran thousands of unrelated specs, and the mutation job ran past 35 minutes.
// Here a mutant runs against the specs written to kill it: the generated
// 800-cell permutation set, the language specs and the byte-exact goldens. A
// mutant that only an unrelated spec would kill counts as survived here, so
// this pass is never easier than the full one.
//
// Every spec listed here is also in vitest.node-specs.mjs, so it still runs in
// the node project on every PR; this list only chooses what Stryker reruns.

// `.html` imports as raw text, the same loader as vitest.node.config.mts.
const htmlAsText = {
  name: 'ose-html-as-text',
  enforce: 'pre' as const,
  load(id: string) {
    const path = id.split('?')[0];
    if (path.endsWith('.html')) {
      return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`;
    }
    return null;
  },
};

export const LANGUAGE_MUTATION_SPECS = [
  'tests/language-permutations.spec.ts',
  'tests/i18n-polish-arabic.spec.ts',
  'tests/i18n-layer-mutants.spec.ts',
  'tests/i18n-catalog.spec.ts',
  'tests/i18n-path-prefix.spec.ts',
  'tests/i18n-resolve-language.spec.ts',
  'tests/language-switch-single.spec.ts',
  'tests/template-js-escape.spec.ts',
  'tests/language-menu.spec.ts',
  'tests/language-menu-third-language.spec.ts',
  'tests/language-menu-close.spec.ts',
  'tests/event-page-spanish.spec.ts',
  'tests/event-page-arabic-bidi.spec.ts',
  'tests/list-landing-spanish.spec.ts',
  'tests/language-layer-golden.spec.ts',
  'tests/list-landing-language-golden.spec.ts',
];

export default defineConfig({
  plugins: [htmlAsText],
  test: {
    name: 'language-mutation',
    environment: 'node',
    globals: true,
    include: LANGUAGE_MUTATION_SPECS,
  },
});
