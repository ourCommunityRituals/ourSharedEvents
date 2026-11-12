#!/usr/bin/env node
/**
 * Mutation paths: the one list of files whose change needs a mutation run, and
 * the decision the mutation workflow makes from it.
 *
 * `.github/workflows/mutation-testing.yml` starts on every pull request and on
 * every push to `main`, with no `paths:` filter, so its two checks (`mutation`
 * and `mutation-ci-scripts`) always report and can be required on `main`. A
 * required check whose workflow does not start leaves the pull request waiting
 * on it for good. Each job runs this file first; when the change touches
 * nothing on the list, the job says so and passes without running Stryker.
 *
 * Fail closed. The only answer that skips the run is "the changed files were
 * read, and none of them is on the list". Everything else runs it: a changed
 * file on the list, an empty list, a list that could not be read, a checkout
 * that is not the one expected, an event other than pull_request or push (the
 * nightly schedule and workflow_dispatch always run), and any error in this
 * file. A required check that passes without looking is the failure this file
 * exists to avoid.
 *
 * This list used to be written twice in the workflow, as the `paths:` of
 * `pull_request` and of `push`. To add a mutate target, add its source and the
 * specs that kill its mutants here. tests/unit/ci/mutation-paths.test.js fails
 * when a file one of the Stryker configs mutates, or a file with a per-file
 * floor, is missing from the list; it cannot know which specs kill a file's
 * mutants, so those stay a matter of review.
 *
 * Usage (from the repository root, in a checkout with fetch-depth 2):
 *   GITHUB_EVENT_NAME=pull_request MUTATION_PR_HEAD_SHA=<sha> node scripts/ci/mutation-paths.mjs
 *   GITHUB_EVENT_NAME=push MUTATION_BEFORE_SHA=<sha> node scripts/ci/mutation-paths.mjs
 *   -> prints `run=true` or `run=false`, and appends it to $GITHUB_OUTPUT
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKER = 'workers/oursharedevents/';
const WORKFLOW = '.github/workflows/mutation-testing.yml';
const SELF = 'scripts/ci/mutation-paths.mjs';
const FLOOR_SCRIPT = 'scripts/ci/mutation-file-floor.mjs';
const WORKER_STRYKER_CONFIG = `${WORKER}stryker.conf.mjs`;
const MUTATION_GROUPS_FILE = `${WORKER}mutation-groups.mjs`;
const CI_SCRIPTS_STRYKER_CONFIG = 'stryker.ci-scripts.conf.mjs';
const LANGUAGE_STRYKER_CONFIG = `${WORKER}stryker.language.conf.mjs`;

/** Exact repository-relative paths. A change to any of them needs a mutation run. */
export const MUTATION_PATHS = Object.freeze([
  // The covenant guards (count floor, report depth, PII crypto, admin auth) and
  // the node specs that kill their mutants.
  'workers/oursharedevents/src/lib/count-floor.ts',
  'workers/oursharedevents/src/lib/report-depth.ts',
  'workers/oursharedevents/src/lib/pii.ts',
  'workers/oursharedevents/src/auth/admin.ts',
  'workers/oursharedevents/tests/count-floor.spec.ts',
  'workers/oursharedevents/tests/report-depth.spec.ts',
  'workers/oursharedevents/tests/pii-crypto.spec.ts',
  'workers/oursharedevents/tests/red-team/auth-jwks-verify.spec.ts',
  'workers/oursharedevents/tests/red-team/auth-guard-mutation.spec.ts',
  'workers/oursharedevents/tests/red-team/auth-jwt-verify-memo.spec.ts',
  'workers/oursharedevents/tests/red-team/ci-service-actor.spec.ts',
  'workers/oursharedevents/tests/admin-actor-memo.spec.ts',
  // OSE-1824: the landing's Type row by event-type category. Its sources (two
  // handler files are mutated only in a marker range, see rangeOf in
  // stryker.conf.mjs) and the node specs and goldens that kill its mutants.
  'workers/oursharedevents/src/lib/event-type-catalog.ts',
  'workers/oursharedevents/src/lib/event-type-catalog-read.ts',
  'workers/oursharedevents/src/lib/landing-area.ts',
  'workers/oursharedevents/src/handlers/pages.ts',
  'workers/oursharedevents/src/handlers/events.ts',
  'workers/oursharedevents/tests/landing-area.spec.ts',
  'workers/oursharedevents/tests/landing-category-scenarios.spec.ts',
  'workers/oursharedevents/tests/list-landing-language-golden.spec.ts',
  'workers/oursharedevents/tests/list-landing-spanish.spec.ts',
  'workers/oursharedevents/tests/helpers/list-landing-rows.ts',
  // Epic OSE-1880: the zoomed map. Its specs kill the zoom mutants in
  // landing-area.ts and the panel-link lines in the pages.ts range.
  'workers/oursharedevents/tests/map-zoom.spec.ts',
  'workers/oursharedevents/tests/map-place-links.spec.ts',
  // Epic OSE-1880: the map's own rules (dot placement, the tile archive reader,
  // the vector tile decoder) and the specs that kill their mutants. The
  // property spec holds the ?area= fat-finger rules for landing-area.ts.
  'workers/oursharedevents/src/lib/attendee-map.ts',
  'workers/oursharedevents/src/lib/mvt.ts',
  'workers/oursharedevents/src/lib/pmtiles.ts',
  // The street layer's loader in street-map.ts (two marker ranges, see rangeOf
  // in stryker.conf.mjs); the fixtures are the fake buckets its specs read.
  'workers/oursharedevents/src/lib/street-map.ts',
  'workers/oursharedevents/tests/helpers/street-map-fixtures.ts',
  'workers/oursharedevents/tests/attendee-map.spec.ts',
  'workers/oursharedevents/tests/mvt.spec.ts',
  'workers/oursharedevents/tests/pmtiles.spec.ts',
  'workers/oursharedevents/tests/street-map.spec.ts',
  'workers/oursharedevents/tests/street-map-landing.spec.ts',
  'workers/oursharedevents/tests/fat-finger.property.spec.ts',
  // OSE-1936: the header Language menu and the node specs that kill its mutants
  // (pages.ts and the list/landing specs are listed above).
  'workers/oursharedevents/src/lib/i18n/language-menu.ts',
  'workers/oursharedevents/tests/language-menu.spec.ts',
  'workers/oursharedevents/tests/language-menu-third-language.spec.ts',
  'workers/oursharedevents/tests/language-menu-close.spec.ts',
  'workers/oursharedevents/tests/language-layer-golden.spec.ts',
  // Polish (OSE-1957) and Arabic (epic OSE-1959): the language layer's files,
  // mutated in their own pass (stryker.language.conf.mjs, with the Vitest
  // project vitest.language-mutation.config.mts), and the node specs that kill
  // their mutants.
  'workers/oursharedevents/src/lib/i18n/languages.ts',
  'workers/oursharedevents/src/lib/i18n/bidi.ts',
  'workers/oursharedevents/src/lib/i18n/path-prefix.ts',
  'workers/oursharedevents/src/lib/i18n/template.ts',
  'workers/oursharedevents/src/lib/i18n/resolve-language.ts',
  'workers/oursharedevents/src/lib/i18n/language-switch.ts',
  'workers/oursharedevents/src/lib/i18n/catalog.ts',
  'workers/oursharedevents/src/lib/i18n/catalog-pl.ts',
  'workers/oursharedevents/src/lib/i18n/catalog-ar.ts',
  'workers/oursharedevents/tests/language-permutations.spec.ts',
  'workers/oursharedevents/tests/i18n-polish-arabic.spec.ts',
  'workers/oursharedevents/tests/i18n-catalog.spec.ts',
  'workers/oursharedevents/tests/i18n-path-prefix.spec.ts',
  'workers/oursharedevents/tests/i18n-resolve-language.spec.ts',
  'workers/oursharedevents/tests/i18n-layer-mutants.spec.ts',
  'workers/oursharedevents/tests/language-switch-single.spec.ts',
  'workers/oursharedevents/tests/template-js-escape.spec.ts',
  'workers/oursharedevents/tests/event-page-spanish.spec.ts',
  LANGUAGE_STRYKER_CONFIG,
  'workers/oursharedevents/vitest.language-mutation.config.mts',
  // OSE-1952: the event page's sponsor-art rule (a marker range of pages.ts,
  // listed above) and the node spec that kills its mutants.
  'workers/oursharedevents/tests/sponsor-thumb-render.spec.ts',
  // OSE-1850: the form pages on the language layer (marker ranges of
  // form-pages.ts and event-staleness.ts) and the node specs that kill them.
  'workers/oursharedevents/src/handlers/form-pages.ts',
  'workers/oursharedevents/src/lib/event-staleness.ts',
  'workers/oursharedevents/tests/form-pages-language.spec.ts',
  'workers/oursharedevents/tests/form-pages-language-golden.spec.ts',
  // OSE-1955: the rest of the sponsor thumbnails. The logo URL rules (a marker
  // range of sponsor-logo.ts), the logo proxy's pick (a marker range of
  // sponsors.ts) and the page's sponsor query (pages.ts, listed above), and the
  // node specs that kill their mutants, the SQLite stand-in for D1 included.
  'workers/oursharedevents/src/lib/sponsor-logo.ts',
  'workers/oursharedevents/src/handlers/sponsors.ts',
  'workers/oursharedevents/tests/sponsor-logo.spec.ts',
  'workers/oursharedevents/tests/sponsor-thumb-sql.spec.ts',
  'workers/oursharedevents/tests/helpers/sqlite-d1.ts',
  WORKER_STRYKER_CONFIG,
  // Which group each main-pass target runs in, and which specs each group runs.
  MUTATION_GROUPS_FILE,
  // OSE-1695: the CI security rules that keep secrets off branch pushes, their
  // tests and config.
  'scripts/ci/branch-push-secret-exposure.mjs',
  'scripts/ci/secret-echo-exposure.mjs',
  'tests/unit/ci/no-secret-on-branch-push.test.js',
  'tests/unit/ci/no-secret-echo.test.js',
  CI_SCRIPTS_STRYKER_CONFIG,
  'vitest.ci-scripts.config.mjs',
  // What the Worker run is built from: the node project, its spec list, the
  // main pass's own Vitest project (the node project less a listed few), the deps.
  'workers/oursharedevents/vitest.node.config.mts',
  'workers/oursharedevents/vitest.mutation.config.mts',
  'workers/oursharedevents/vitest.node-specs.mjs',
  'workers/oursharedevents/package.json',
  'workers/oursharedevents/package-lock.json',
  // The gate's own wiring: the per-file floor, the workflow and this rule.
  FLOOR_SCRIPT,
  WORKFLOW,
  SELF,
]);

const normalize = (file) => String(file).trim().replace(/\\/g, '/');

/** The changed files that are on the list. */
export function mutationPathHits(files, paths = MUTATION_PATHS) {
  const listed = new Set(paths);
  return files.map(normalize).filter((p) => listed.has(p));
}

/**
 * Does this event need a mutation run?
 *
 * @param {{eventName?: string, files?: unknown, error?: unknown}} [input]
 *   `files` are the changed paths; `error` is what reading them threw, if anything.
 * @returns {{run: boolean, reason: string}} `run` is false in exactly one case:
 *   a pull_request or push whose changed files were read and are all off the list.
 */
export function decideMutationRun({ eventName, files, error } = {}, paths = MUTATION_PATHS) {
  if (eventName !== 'pull_request' && eventName !== 'push') {
    return { run: true, reason: `event "${eventName}" always runs the mutation tests` };
  }
  if (error) {
    // One line: git's own message follows the command on a second line.
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .trim();
    return {
      run: true,
      reason: `the changed files could not be read, so the mutation tests run (${message})`,
    };
  }
  const changed = Array.isArray(files) ? files.map(normalize).filter(Boolean) : [];
  if (!changed.length) {
    return {
      run: true,
      reason:
        'the changed-file list is empty, which is treated as not read, so the mutation tests run',
    };
  }
  const hits = mutationPathHits(changed, paths);
  if (hits.length) {
    const shown = hits.slice(0, 5).join(', ');
    const more = hits.length > 5 ? ` and ${hits.length - 5} more` : '';
    return { run: true, reason: `changed files on the mutation path list: ${shown}${more}` };
  }
  return {
    run: false,
    reason: `none of the ${changed.length} changed file(s) is on the mutation path list (${SELF})`,
  };
}

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * The changed files of this event, read from the checkout. Throws when they
 * cannot be read or the checkout is not the one expected; the caller turns that
 * into "run".
 *
 * pull_request: the checkout is GitHub's merge commit of the pull request into
 * its base, so the change under review is that commit against its first parent
 * (needs fetch-depth 2). The commit must have two parents and the second must be
 * the pull request's head; a checkout of anything else would make `HEAD^1` the
 * commit before, and the diff only the last commit.
 *
 * push: the commit before the push against HEAD. With fetch-depth 2 that is
 * there for a squash merge or a merge commit; when it is not, git fails.
 *
 * `--no-renames` lists a moved file under both names, so moving a file off the
 * list still counts as changing it.
 */
export function readChangedFiles({ eventName, before, prHeadSha } = {}, git = runGit) {
  let base;
  if (eventName === 'pull_request') {
    if (!SHA.test(String(prHeadSha || ''))) {
      throw new Error('the pull request head sha is missing from the event');
    }
    const [, ...parents] = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length !== 2) {
      throw new Error(`HEAD is not a merge commit (it has ${parents.length} parent(s))`);
    }
    if (parents[1] !== prHeadSha) {
      throw new Error(`HEAD does not merge the pull request head ${prHeadSha}`);
    }
    base = 'HEAD^1';
  } else if (eventName === 'push') {
    if (!SHA.test(String(before || '')) || /^0+$/.test(before)) {
      throw new Error(`the push has no usable before sha ("${before ?? ''}")`);
    }
    base = before;
  } else {
    throw new Error(`event "${eventName}" has no changed files to read`);
  }
  return git(['diff', '--no-renames', '--name-only', '-z', base, 'HEAD'])
    .split('\0')
    .filter(Boolean);
}

const PATTERN = /[*?{}[\]!]/;

/**
 * Files the mutation configs name that the list lacks, one line each; empty
 * when the list covers them. A Stryker `mutate` entry is a file, or a file with
 * a `:start-end` line range; a glob or a negation is reported, because this
 * cannot say which files it covers.
 *
 * @param {{workerConfig: any, languageConfig: any, ciScriptsConfig: any, floors: Record<string, number>}} inputs
 *   the default exports of the three Stryker configs and FLOORS of mutation-file-floor.mjs.
 *   Each config is required: one left out reads as a config with no mutate targets.
 */
export function uncoveredMutationInputs(
  { workerConfig, languageConfig, ciScriptsConfig, floors } = {},
  paths = MUTATION_PATHS
) {
  const listed = new Set(paths);
  const findings = [];
  const need = (path, why) => {
    if (!listed.has(path)) findings.push(`${path} (${why}) is not in MUTATION_PATHS of ${SELF}`);
  };
  const needTargets = (config, configPath, prefix) => {
    const mutate = Array.isArray(config?.mutate) ? config.mutate : [];
    if (!mutate.length) findings.push(`${configPath} has no mutate targets that could be read`);
    for (const entry of mutate) {
      const file = String(entry).replace(/:\d+(:\d+)?-\d+(:\d+)?$/, '');
      if (PATTERN.test(file)) {
        findings.push(
          `${configPath} mutates the pattern "${entry}"; this check only knows files. List its files in ${SELF} and teach uncoveredMutationInputs the pattern`
        );
        continue;
      }
      need(`${prefix}${file}`, `a mutate target in ${configPath}`);
    }
    const vitestConfig = config?.vitest?.configFile;
    if (vitestConfig) need(`${prefix}${vitestConfig}`, `the Vitest config of ${configPath}`);
    need(configPath, 'a Stryker config');
  };

  needTargets(workerConfig, WORKER_STRYKER_CONFIG, WORKER);
  needTargets(languageConfig, LANGUAGE_STRYKER_CONFIG, WORKER);
  needTargets(ciScriptsConfig, CI_SCRIPTS_STRYKER_CONFIG, '');
  for (const file of Object.keys(floors || {})) {
    need(`${WORKER}${file}`, `a per-file floor in ${FLOOR_SCRIPT}`);
  }
  need(FLOOR_SCRIPT, 'the per-file floor');
  need(MUTATION_GROUPS_FILE, 'the group split of the main pass');
  need(WORKFLOW, 'the workflow');
  need(SELF, 'this rule');
  return findings;
}

function main() {
  let decision;
  try {
    const eventName = process.env.GITHUB_EVENT_NAME;
    let files;
    let error;
    if (eventName === 'pull_request' || eventName === 'push') {
      try {
        files = readChangedFiles({
          eventName,
          before: process.env.MUTATION_BEFORE_SHA,
          prHeadSha: process.env.MUTATION_PR_HEAD_SHA,
        });
      } catch (e) {
        error = e;
      }
    }
    decision = decideMutationRun({ eventName, files, error });
  } catch (e) {
    // Fail closed: a fault in this file must never read as "nothing to test".
    decision = {
      run: true,
      reason: `the decision itself failed, so the mutation tests run (${e})`,
    };
  }
  const line = `run=${decision.run === false ? 'false' : 'true'}`;
  const summary = decision.run
    ? `Mutation run needed: ${decision.reason}.`
    : `Mutation run not needed: ${decision.reason}. The steps below are skipped and this check passes without running Stryker. The nightly run and every change to a listed path still run it.`;
  console.log(summary);
  console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
