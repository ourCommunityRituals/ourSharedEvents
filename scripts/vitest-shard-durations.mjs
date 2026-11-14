#!/usr/bin/env node
// scripts/vitest-shard-durations.mjs — refresh workers/oursharedevents/vitest-shard-durations.json
//
// The worker suite's CI slices (T0 Tests (worker-d1-schema i/N)) are cut by the
// per-file times in that file (workers/oursharedevents/vitest-shard-plan.mjs).
// This script measures them from real CI runs, which is what the slices are
// balanced for; a local run on a different machine would measure the wrong thing.
//
//   node scripts/vitest-shard-durations.mjs                 # last 4 green pushes to main
//   node scripts/vitest-shard-durations.mjs --latest 6
//   node scripts/vitest-shard-durations.mjs --runs 43580760430,43575607276
//   node scripts/vitest-shard-durations.mjs --logs-dir <dir>  # saved job logs, no network
//
// Needs the GitHub CLI (`gh`, read access) except with --logs-dir.
//
// What a file's time is:
//   - workers project: the pool runs ONE file at a time (maxWorkers: 1), so the
//     time from the previous workers file finishing (or the run starting) to this
//     one finishing is what the file costs the slice, import and setup included.
//     The reporter's own figure leaves import out, and import is ~40% of a slice.
//   - node project: files run in parallel beside the pool; the reporter's figure.
// Each file's value is the median over the runs read, rounded to 100 ms so a
// refresh does not churn every line.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'workers', 'oursharedevents', 'vitest-shard-durations.json');
const WORKFLOW = 'OurSharedEvents CI/CD';
const SLICE_JOB = /^T0 Tests \(worker-d1-schema \d+\/\d+\)$/;

// One reporter line per finished spec file, e.g.
//   2026-11-14T10:08:16.79Z  ✓  workers  tests/x.spec.ts (53 tests) 11903ms
const FILE_LINE =
  /^(\S+Z)\s+[✓×❯↓]\s+(node|workers)\s+(\S+\.spec\.ts)\s+\((\d+) tests?[^)]*\)\s+(?:\d+ skipped\s+)?(\d+)ms\s*$/;
// The ESC of an ANSI colour code, built so the source holds no control character.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const RUN_LINE = /^(\S+Z)\s+RUN\s+v\d/;

/** Per-file times from one slice's job log. A retried attempt replaces the earlier one. */
export function parseSliceLog(text) {
  const files = new Map();
  let start = null;
  let lastWorkers = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(ANSI, '');
    const run = RUN_LINE.exec(line);
    if (run) {
      start = Date.parse(run[1]);
      lastWorkers = null;
      continue;
    }
    const m = FILE_LINE.exec(line);
    if (!m || start === null) continue;
    const [, ts, project, file, , reported] = m;
    let ms = Number(reported);
    if (project === 'workers') {
      const at = Date.parse(ts);
      ms = at - (lastWorkers ?? start);
      lastWorkers = at;
    }
    files.set(`${project}\t${file}`, { project, file, ms });
  }
  return [...files.values()];
}

/** Median per file over several runs (each run = the parsed logs of all its slices). */
export function buildManifest(runs, runIds = []) {
  const values = new Map();
  for (const entries of runs) {
    for (const { project, file, ms } of entries) {
      const key = `${project}\t${file}`;
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(ms);
    }
  }
  const projects = {};
  for (const key of [...values.keys()].sort()) {
    const [project, file] = key.split('\t');
    const v = values.get(key).sort((a, b) => a - b);
    const med = v[Math.floor(v.length / 2)];
    (projects[project] ||= {})[file] = Math.max(100, Math.round(med / 100) * 100);
  }
  return {
    generatedBy: 'scripts/vitest-shard-durations.mjs',
    note: 'Median ms per spec file over the CI runs below; workers = serial pool time incl. import, node = reported time. Refresh with the script; read by workers/oursharedevents/vitest-shard-plan.mjs.',
    runs: runIds,
    projects,
  };
}

const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function runLogs(runId) {
  const { jobs } = JSON.parse(gh('run', 'view', String(runId), '--json', 'jobs'));
  const slices = jobs.filter((j) => SLICE_JOB.test(j.name));
  if (slices.length === 0) throw new Error(`run ${runId} has no worker-d1-schema slice jobs`);
  const bad = slices.filter((j) => j.conclusion !== 'success');
  if (bad.length)
    throw new Error(`run ${runId}: slice(s) not green: ${bad.map((j) => j.name).join(', ')}`);
  return slices.flatMap((j) =>
    parseSliceLog(gh('api', `repos/{owner}/{repo}/actions/jobs/${j.databaseId}/logs`))
  );
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  let manifest;
  if (arg('--logs-dir')) {
    const dir = arg('--logs-dir');
    const entries = readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => parseSliceLog(readFileSync(join(dir, f), 'utf8')));
    // Without run ids every log is its own sample; a file appears in one slice per run.
    manifest = buildManifest(entries.map((e) => e));
  } else {
    const ids = arg('--runs')
      ? arg('--runs')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : JSON.parse(
          gh(
            'run',
            'list',
            '--workflow',
            WORKFLOW,
            '--branch',
            'main',
            '--event',
            'push',
            '--status',
            'success',
            '--limit',
            String(Number(arg('--latest') || 4)),
            '--json',
            'databaseId'
          )
        ).map((r) => String(r.databaseId));
    if (ids.length === 0) throw new Error('no runs to read');
    manifest = buildManifest(ids.map(runLogs), ids.map(Number));
  }
  const counts = Object.entries(manifest.projects).map(
    ([p, f]) => `${p}: ${Object.keys(f).length}`
  );
  if (counts.length === 0) throw new Error('no spec timings found in the logs');
  writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${OUT} (${counts.join(', ')})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`vitest-shard-durations: ${err.message}`);
    process.exit(1);
  }
}
