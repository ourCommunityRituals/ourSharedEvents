import { readFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { MUTATION_GROUPS, groupFromEnv, orderSpecs, relatedSpecs } from './mutation-groups.mjs';
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

/**
 * The order the spec files run in, for every run of this project: the same for
 * the same mutated file, on every runner and in every run.
 *
 * Why not Vitest's own (2026-11-15). BaseSequencer runs the files that failed
 * last time first and then the longest first, from a results cache that each
 * Stryker test runner keeps, rewrites after every mutant and writes into the
 * sandbox all the runners share; a runner started later, as one is after every
 * mutant that never ends, starts from whatever was written last. A mutant's
 * run stops at its first failing test, so the order is what it costs, and it
 * was a different order for the same mutant from run to run. Watched locally
 * with the order logged: the first module-level mutant of street-map.ts in
 * each runner ran form-pages-language.spec.ts and toast-adoption.spec.ts, the
 * two longest, before street-map.spec.ts killed it, 78 seconds and about 340
 * tests; every one after it ran street-map.spec.ts first, because it had just
 * failed, and died in 10 to 600 ms.
 *
 * The order is orderSpecs (mutation-groups.mjs) for the file being mutated,
 * which Stryker's Vitest runner names in `related` for a mutant's run (all the
 * files of the run for its dry run). With no `related` (the runner's
 * `vitest.related` turned off) it is the order for the group's files. It
 * only moves files: every file Vitest hands over is handed back.
 */
export class MutantFirstSequencer extends BaseSequencer {
  private static readonly ranks = new Map<string, Map<string, number>>();

  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const root = this.ctx.config.root;
    const fromRoot = (path: string) => relative(root, path).split('\\').join('/');
    const related = this.ctx.config.related;
    const mutated = related?.length
      ? related.map(fromRoot)
      : GROUP
        ? [...MUTATION_GROUPS[GROUP]]
        : [];
    const key = `${root}|${mutated.join('|')}`;
    let rank = MutantFirstSequencer.ranks.get(key);
    if (!rank) {
      rank = new Map(orderSpecs(SPECS, mutated, root).map((spec, i) => [spec, i] as const));
      MutantFirstSequencer.ranks.set(key, rank);
    }
    const place = (file: TestSpecification) => rank.get(fromRoot(file.moduleId)) ?? SPECS.length;
    return [...files].sort(
      (a, b) =>
        place(a) - place(b) || (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0)
    );
  }
}

export default defineConfig({
  plugins: [htmlAsText],
  test: {
    name: 'main-mutation',
    environment: 'node',
    globals: true,
    include: SPECS,
    sequence: { sequencer: MutantFirstSequencer },
  },
});
