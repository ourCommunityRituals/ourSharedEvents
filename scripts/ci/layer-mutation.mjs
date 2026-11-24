#!/usr/bin/env node
/**
 * Mutation testing at the integration and end-to-end layers.
 *
 * The test pyramid has a mutation run at each layer:
 *   unit          workers/oursharedevents/stryker.conf.mjs (eight groups) and
 *                 stryker.ci-scripts.conf.mjs: Stryker on the guards, judged by
 *                 the node-project specs (.github/workflows/mutation-testing.yml)
 *   integration   this file, layer "integration": the Worker's own specs in the
 *                 Workers runtime with a real D1 (vitest.workers.config.mts)
 *   end to end    this file, layer "e2e": the Playwright journeys against a
 *                 local `wrangler dev` (playwright.mobile.config.ts)
 *
 * Stryker switches its mutants on inside the test process. The workers-pool
 * specs run the Worker inside workerd, and the journeys drive a separate
 * `wrangler dev`, so Stryker can judge neither. Here the mutants are written by
 * hand in mutation/layer-mutants.json, each one small fault in a rule the
 * product promises (never who, only how many; two-sided sponsor consent; same-
 * origin admin writes; the public allowlist). For each mutant this script
 * writes the fault into the source, runs the specs named in its `kill` list at
 * its layer, and puts the source back.
 *
 * FAIL CLOSED. A mutant is killed only when the specs ran and at least one test
 * failed (on every try, for Playwright). A run where no test ran, a suite that
 * could not load, or a report that cannot be read is an error, not a kill.
 * Before any mutant, each layer's specs run on the unchanged source and must
 * all pass, or every mutant would read as killed.
 *
 * This is a test rig in the job's own container, not staging: the faults never
 * leave the runner (AGENTS.md: staging changes only through CI after a merge).
 * The end-to-end layer deletes workers/oursharedevents/.wrangler/state before
 * each run, so every run starts on a fresh local D1.
 *
 * Usage (repository root):
 *   node scripts/ci/layer-mutation.mjs [--layer integration|e2e] [--only <id>,<id>]
 *   node scripts/ci/layer-mutation.mjs --check     (validate the catalog only)
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CATALOG = 'mutation/layer-mutants.json';
export const REPORT_DIR = 'reports/mutation-layers';
export const WORKER_DIR = 'workers/oursharedevents';
export const LAYERS = {
  integration: { specPattern: /^workers\/oursharedevents\/tests\/[^/]+\.spec\.ts$/ },
  e2e: { specPattern: /^tests\/playwright\/[^/]+\.spec\.ts$/ },
};

/** Occurrences of `needle` in `haystack` (non-overlapping). */
export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

/**
 * Problems with a catalog, as strings; empty when it is sound.
 * `read(path)` returns a file's text or null when it does not exist;
 * `isNodeSpec(path)` says whether a worker spec runs in the node project
 * (vitest.node-specs.mjs), where it would not run in the Workers runtime.
 */
export function checkCatalog(catalog, read, isNodeSpec = () => false) {
  const problems = [];
  if (!catalog || typeof catalog !== 'object') return ['the catalog is not an object'];
  const mutants = catalog.mutants;
  if (!Array.isArray(mutants) || mutants.length === 0) return ['the catalog lists no mutants'];
  const seen = new Set();
  for (const m of mutants) {
    const id = m?.id;
    const where = `mutant ${JSON.stringify(id)}`;
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) problems.push(`${where}: id must be lowercase words joined by hyphens`);
    if (seen.has(id)) problems.push(`${where}: the id is used twice`);
    seen.add(id);
    const layer = LAYERS[m?.layer];
    if (!layer) problems.push(`${where}: layer must be one of ${Object.keys(LAYERS).join(', ')}`);
    for (const key of ['rule', 'file', 'find', 'replace']) {
      if (typeof m?.[key] !== 'string' || (key !== 'replace' && !m[key])) problems.push(`${where}: no ${key}`);
    }
    if (m?.find === m?.replace) problems.push(`${where}: replace is the same as find, so nothing is mutated`);
    if (!Array.isArray(m?.kill) || m.kill.length === 0) problems.push(`${where}: no spec in kill`);
    for (const spec of Array.isArray(m?.kill) ? m.kill : []) {
      if (read(spec) === null) problems.push(`${where}: kill spec ${spec} does not exist`);
      else if (layer && !layer.specPattern.test(spec)) problems.push(`${where}: kill spec ${spec} is not a ${m.layer} spec`);
      else if (m.layer === 'integration' && isNodeSpec(spec)) problems.push(`${where}: kill spec ${spec} runs in the node project, not the Workers runtime`);
    }
    if (typeof m?.file === 'string' && m.file) {
      const text = read(m.file);
      if (text === null) problems.push(`${where}: ${m.file} does not exist`);
      else if (typeof m.find === 'string' && m.find) {
        const n = countOccurrences(text, m.find);
        if (n !== 1) problems.push(`${where}: find occurs ${n} times in ${m.file}, not once (the source moved; update the mutant)`);
      }
    }
  }
  return problems;
}

/** The source with the mutant's fault written in. Throws unless `find` occurs once. */
export function applyMutant(text, mutant) {
  const n = countOccurrences(text, mutant.find);
  if (n !== 1) throw new Error(`mutant ${mutant.id}: find occurs ${n} times in ${mutant.file}, not once`);
  return text.replace(mutant.find, () => mutant.replace);
}

/**
 * What a Playwright JSON report says about one run: `killed` when a test failed
 * on every try, `passed` when tests ran and none failed (flaky ones included),
 * `error` when no test ran or the report is missing.
 */
export function verdictFromPlaywright(report) {
  const stats = report?.stats;
  if (!stats || typeof stats !== 'object') return { verdict: 'error', reason: 'no stats in the Playwright report' };
  const expected = Number(stats.expected) || 0;
  const unexpected = Number(stats.unexpected) || 0;
  const flaky = Number(stats.flaky) || 0;
  if (Array.isArray(report.errors) && report.errors.length && expected + unexpected + flaky === 0) {
    return { verdict: 'error', reason: `Playwright stopped before any test: ${String(report.errors[0]?.message ?? '').split('\n')[0]}` };
  }
  if (unexpected > 0) return { verdict: 'killed', reason: `${unexpected} test(s) failed` };
  if (expected + flaky === 0) return { verdict: 'error', reason: 'no test ran' };
  return { verdict: 'passed', reason: `${expected + flaky} test(s) passed${flaky ? `, ${flaky} after a retry` : ''}` };
}

/**
 * What a Vitest JSON report says about one run. A suite that failed to load
 * (numFailedTestSuites with no failed test) is an error, not a kill: the fault
 * broke the build, which says nothing about whether a test would catch it.
 */
export function verdictFromVitest(report) {
  if (!report || typeof report !== 'object' || typeof report.numTotalTests !== 'number') {
    return { verdict: 'error', reason: 'no Vitest report' };
  }
  const failed = Number(report.numFailedTests) || 0;
  const passed = Number(report.numPassedTests) || 0;
  const brokenSuites = Number(report.numFailedTestSuites) || 0;
  if (failed > 0) return { verdict: 'killed', reason: `${failed} test(s) failed` };
  if (brokenSuites > 0) return { verdict: 'error', reason: `${brokenSuites} spec file(s) failed to load` };
  if (passed === 0) return { verdict: 'error', reason: 'no test ran' };
  return { verdict: 'passed', reason: `${passed} test(s) passed` };
}

/** The gate over every mutant's result: failures as strings, empty when all were killed. */
export function gateFailures(results) {
  return results
    .filter((r) => r.verdict !== 'killed')
    .map((r) =>
      r.verdict === 'passed'
        ? `${r.id} SURVIVED (${r.layer}): ${r.rule} The specs ${r.kill.join(', ')} passed with this fault in ${r.file}.`
        : `${r.id} ERROR (${r.layer}): ${r.reason}. An error is not a kill.`,
    );
}

function readOrNull(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) } });
  return res.status ?? 1;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function runLayer(layer, specs, label) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = resolve(REPORT_DIR, `${label}.${layer}.json`);
  rmSync(out, { force: true });
  if (layer === 'integration') {
    const rel = specs.map((s) => s.slice(WORKER_DIR.length + 1));
    sh('npx', ['vitest', 'run', '--config', 'vitest.workers.config.mts', ...rel, '--reporter=json', `--outputFile=${out}`], {
      cwd: WORKER_DIR,
    });
    return verdictFromVitest(readJson(out));
  }
  rmSync(join(WORKER_DIR, '.wrangler/state'), { recursive: true, force: true });
  sh('npx', ['playwright', 'test', '-c', 'playwright.mobile.config.ts', ...specs, '--project=mobile-chromium', '--retries=1', '--reporter=json'], {
    env: { CI: process.env.CI || '1', PLAYWRIGHT_JSON_OUTPUT_NAME: out },
  });
  return verdictFromPlaywright(readJson(out));
}

function summaryTable(results) {
  const rows = results.map(
    (r) => `| ${r.id} | ${r.layer} | ${r.verdict === 'killed' ? 'killed' : `**${r.verdict === 'passed' ? 'survived' : 'error'}**`} | ${r.rule} | ${r.reason} |`,
  );
  return ['### Integration and end-to-end mutation', '', '| Mutant | Layer | Result | Rule | Detail |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const catalogPath = arg('--catalog') ?? DEFAULT_CATALOG;
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const { NODE_SPECS } = await import(pathToFileURL(resolve(WORKER_DIR, 'vitest.node-specs.mjs')).href);
  const nodeSpecs = new Set(NODE_SPECS.map((s) => `${WORKER_DIR}/${s.replace(/^\.\//, '')}`));
  const problems = checkCatalog(catalog, readOrNull, (s) => nodeSpecs.has(s));
  if (problems.length) {
    for (const p of problems) console.error(`::error title=Layer mutant catalog::${p}`);
    return 1;
  }
  if (argv.includes('--check')) {
    console.log(`${catalogPath}: ${catalog.mutants.length} mutants, all sound.`);
    return 0;
  }
  const only = arg('--only')?.split(',');
  const layerArg = arg('--layer');
  const mutants = catalog.mutants.filter((m) => (!only || only.includes(m.id)) && (!layerArg || m.layer === layerArg));
  if (!mutants.length) {
    console.error('::error::no mutant matches --only / --layer');
    return 1;
  }

  const baselines = {};
  for (const layer of [...new Set(mutants.map((m) => m.layer))]) {
    const specs = [...new Set(mutants.filter((m) => m.layer === layer).flatMap((m) => m.kill))];
    console.log(`\n== Baseline (${layer}): ${specs.join(', ')} on the unchanged source`);
    baselines[layer] = runLayer(layer, specs, 'baseline');
    if (baselines[layer].verdict !== 'passed') {
      console.error(`::error title=Layer mutation baseline::the ${layer} specs must pass on the unchanged source before any mutant is judged (${baselines[layer].verdict}: ${baselines[layer].reason}).`);
      return 1;
    }
  }

  const results = [];
  for (const m of mutants) {
    const original = readFileSync(m.file, 'utf8');
    console.log(`\n== Mutant ${m.id} (${m.layer}): ${m.file}`);
    let outcome;
    try {
      writeFileSync(m.file, applyMutant(original, m));
      outcome = runLayer(m.layer, m.kill, m.id);
    } finally {
      writeFileSync(m.file, original);
    }
    results.push({ ...m, ...outcome });
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'summary.json'), JSON.stringify({ baselines, results }, null, 2));
  const table = summaryTable(results);
  console.log(`\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);

  const failures = gateFailures(results);
  for (const f of failures) console.error(`::error title=Layer mutation::${f}`);
  console.log(`\n${results.length - failures.length} of ${results.length} mutants killed.`);
  return failures.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    }
  );
}
