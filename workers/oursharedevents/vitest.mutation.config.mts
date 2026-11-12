import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { MUTATION_GROUPS, groupFromEnv, relatedSpecs } from './mutation-groups.mjs';
import { NODE_SPECS } from './vitest.node-specs.mjs';
import { LANGUAGE_MUTATION_SPECS } from './vitest.language-mutation.config.mts';

// The Vitest project for the main mutation pass (stryker.conf.mjs): the node
// project's specs, less the ones listed in MAIN_PASS_SKIPS below.
//
// Why a project of its own (2026-11-11): language-permutations.spec.ts renders
// its 20 pages in a beforeAll, outside any test. Stryker counts code run there
// as covered by no test, so every mutant on the render path (landing-area.ts,
// attendee-map.ts, count-floor.ts, language-menu.ts, the pages.ts ranges) was
// "static" and reran all 3,177 node tests, the spec's own 1,600 among them.
// Static mutants went from 419 to 974 and the main pass from about 12 minutes
// to about 24, so the job's 25-minute limit cut off the language pass after it.
// The per-file scores were the same with and without the spec (CI reports of
// 2026-11-10 22:29 and 2026-11-11 13:19), so it killed no mutant here that
// another spec did not.
//
// A skipped spec still runs in the node project on every PR, and in the
// language pass (stryker.language.conf.mjs), which mutates the files it was
// written for. Leaving a spec out can only lose kills, so this pass is never
// easier than the full node project: a mutant only that spec killed would
// show here as survived and fail the floor, not pass quietly.
//
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

/** Node specs the main mutation pass does not rerun, each with its reason above. */
export const MAIN_PASS_SKIPS = ['tests/language-permutations.spec.ts'];

// A skip that is not a node spec, or not in the language pass, is a mistake:
// the first skips nothing, the second leaves a spec out of every mutation pass.
for (const spec of MAIN_PASS_SKIPS) {
  if (!NODE_SPECS.includes(spec)) {
    throw new Error(`vitest.mutation.config: ${spec} is not in vitest.node-specs.mjs`);
  }
  if (!LANGUAGE_MUTATION_SPECS.includes(spec)) {
    throw new Error(`vitest.mutation.config: ${spec} is in no mutation pass`);
  }
}

export const MAIN_MUTATION_SPECS = NODE_SPECS.filter((s) => !MAIN_PASS_SKIPS.includes(s));

// In a grouped CI run (MUTATION_GROUP, mutation-groups.mjs) only the specs whose
// imports reach one of the group's files: no other spec can kill its mutants.
// Static mutants rerun every spec in this project, so this is where most of the
// group's time goes. A group no spec reaches is a mistake, not an empty pass.
const HERE = dirname(fileURLToPath(import.meta.url));
const GROUP = groupFromEnv();
const SPECS = GROUP
  ? relatedSpecs(MAIN_MUTATION_SPECS, [...MUTATION_GROUPS[GROUP]], HERE)
  : MAIN_MUTATION_SPECS;
if (!SPECS.length) {
  throw new Error(`vitest.mutation.config: no spec reaches mutation group ${GROUP}`);
}

export default defineConfig({
  plugins: [htmlAsText],
  test: {
    name: 'main-mutation',
    environment: 'node',
    globals: true,
    include: SPECS,
  },
});
