// @ts-check
//
// The main mutation pass, split into groups that CI runs side by side
// (.github/workflows/mutation-testing.yml, one job per group). Run alone, the
// pass took 17 to 25 minutes and the job's limit cut it off (PR 1189). The
// groups are cut by cost, measured from the CI report of 2026-11-11 (run
// 43052131567, test runs per file):
//
//   map      attendee-map.ts                                      33%
//   landing  the landing's Type row: landing-area.ts, the event-  30%
//            type catalog and its read, the events.ts range
//   guards   the privacy and auth guards: admin.ts, count-floor.ts, 18%
//            pii.ts, report-depth.ts, retention-windows.ts
//   render   the street map and the page renderers: mvt.ts,        19%
//            pmtiles.ts, street-map.ts, every pages.ts range, the
//            Language menu, the sponsor art and logo rules
//
//   forms    the form pages on the language layer (PR 1192):     own job
//            form-pages.ts and event-staleness.ts
//
// forms is a group of its own because of what it costs. Added to map, the
// cheapest group, it took map from about 3 to 9 minutes locally (2026-11-12:
// 207 mutants in form-pages.ts, 19 of them timeouts, each waiting out its
// limit), which would have made the whole stage half as slow again.
//
// The language layer is the fifth job (stryker.language.conf.mjs), as before.
//
// RULES (each enforced below, so a mistake fails the run, never a quiet gap):
//   - Every target in stryker.conf.mjs belongs to exactly one group. A target
//     in no group would not be mutated in CI; a file in two groups would be
//     scored in two reports, which mutation-file-floor.mjs refuses.
//   - A file is one group, all its ranges together (pages.ts has five).
//
// TESTS PER GROUP (less work, the same kills). A mutant can only be killed by
// a spec that loads the mutated file, directly or through its imports. So each
// group runs only the specs whose import graph reaches one of its files
// (relatedSpecs). Static mutants, which Stryker cannot pin to a test and so
// reruns against every spec in the project, get the most from this. The scan
// adds an edge for anything that looks like an import, comments included, so
// it can only keep extra specs, never drop a related one. If it ever missed
// one, the mutants that spec killed would show as survived and fail the
// per-file floor: a red run, not a hollow one.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, normalize, resolve } from 'node:path';
import process from 'node:process';

/** Group name -> the source files it mutates (paths as Stryker reports them). */
export const MUTATION_GROUPS = Object.freeze({
  map: Object.freeze(['src/lib/attendee-map.ts']),
  landing: Object.freeze([
    'src/lib/landing-area.ts',
    'src/lib/event-type-catalog.ts',
    'src/lib/event-type-catalog-read.ts',
    'src/handlers/events.ts',
  ]),
  guards: Object.freeze([
    'src/auth/admin.ts',
    'src/lib/count-floor.ts',
    'src/lib/pii.ts',
    'src/lib/report-depth.ts',
    'src/lib/retention-windows.ts',
  ]),
  render: Object.freeze([
    'src/lib/mvt.ts',
    'src/lib/pmtiles.ts',
    'src/lib/street-map.ts',
    'src/handlers/pages.ts',
    'src/lib/i18n/language-menu.ts',
    'src/lib/sponsor-logo.ts',
    'src/handlers/sponsors.ts',
  ]),
  forms: Object.freeze(['src/handlers/form-pages.ts', 'src/lib/event-staleness.ts']),
});

/** The file a mutate entry names: `src/x.ts` or a range `src/x.ts:10-20`. */
export function targetFile(entry) {
  return String(entry).replace(/:\d+-\d+$/, '');
}

/**
 * The mutate entries for one group, after checking every entry belongs to
 * exactly one group. Throws on an unknown group, an entry in no group, a file
 * in two groups, or a group file with no entry (a group that mutates nothing
 * would pass with no work done).
 */
export function mutateForGroup(mutate, group, groups = MUTATION_GROUPS) {
  const owner = new Map();
  for (const [name, files] of Object.entries(groups)) {
    for (const file of files) {
      if (owner.has(file)) {
        throw new Error(`mutation-groups: ${file} is in groups ${owner.get(file)} and ${name}`);
      }
      owner.set(file, name);
    }
  }
  const entryFiles = new Set(mutate.map(targetFile));
  for (const file of entryFiles) {
    if (!owner.has(file)) {
      throw new Error(
        `mutation-groups: ${file} is mutated but in no group (add it to MUTATION_GROUPS)`
      );
    }
  }
  for (const file of owner.keys()) {
    if (!entryFiles.has(file)) {
      throw new Error(`mutation-groups: ${file} is in group ${owner.get(file)} but not mutated`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(groups, group)) {
    throw new Error(
      `mutation-groups: no group "${group}" (groups: ${Object.keys(groups).join(', ')})`
    );
  }
  return mutate.filter((e) => owner.get(targetFile(e)) === group);
}

// Anything that looks like a module reference: `from '…'`, `import '…'`,
// `import('…')`, `require('…')`, `vi.mock('…')`. Over-matching only adds specs.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual)\s*\(\s*)['"]([^'"]+)['"]/g;
const SUFFIXES = ['', '.ts', '.mts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];

/** Resolve a relative specifier from `fromFile` to a file on disk, or null. */
function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base];
  // TypeScript sources often import `./x.js` meaning `./x.ts`.
  if (/\.(m?js)$/.test(base))
    candidates.push(base.replace(/\.(m?js)$/, (m) => (m === '.mjs' ? '.mts' : '.ts')));
  for (const c of candidates) {
    for (const s of SUFFIXES) {
      const p = c + s;
      if (existsSync(p) && !p.endsWith('/') && /\.(m?[jt]sx?)$/.test(p)) return p;
    }
  }
  return null;
}

/**
 * The specs (paths relative to `root`) whose import graph reaches any of
 * `files`. Pure static scan; follows relative imports only (packages cannot
 * import this Worker's source).
 */
export function relatedSpecs(specs, files, root) {
  const targets = new Set(files.map((f) => normalize(resolve(root, f))));
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  const reaches = (file, stack) => {
    if (targets.has(file)) return true;
    if (memo.has(file)) return /** @type {boolean} */ (memo.get(file));
    if (stack.has(file)) return false; // a cycle: decided by the outer frame
    stack.add(file);
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      text = '';
    }
    let hit = false;
    for (const m of text.matchAll(SPECIFIER)) {
      const next = resolveSpecifier(file, m[1]);
      if (next && reaches(normalize(next), stack)) {
        hit = true;
        break;
      }
    }
    stack.delete(file);
    // A miss inside a cycle is not final for the files above it; only cache hits
    // and misses decided with an empty stack.
    if (hit || stack.size === 0) memo.set(file, hit);
    return hit;
  };
  return specs.filter((s) => reaches(normalize(resolve(root, s)), new Set()));
}

/** The fifth CI job: the language pass, which has its own config. */
export const LANGUAGE_GROUP = 'language';

/**
 * The main-pass group named by MUTATION_GROUP, or null for a full run (unset,
 * or the language job, whose own config does the narrowing). An unknown name
 * throws: a typo must not quietly fall back to some other set of targets.
 */
export function groupFromEnv(env = process.env, groups = MUTATION_GROUPS) {
  const g = env.MUTATION_GROUP;
  if (g === undefined || g === '' || g === LANGUAGE_GROUP) return null;
  if (!Object.prototype.hasOwnProperty.call(groups, g)) {
    throw new Error(
      `mutation-groups: MUTATION_GROUP="${g}" is not a group (groups: ${Object.keys(groups).join(', ')}, ${LANGUAGE_GROUP})`
    );
  }
  return g;
}
