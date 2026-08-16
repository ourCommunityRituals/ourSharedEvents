/**
 * CI cost collector (COST-302 / OSE-781).
 *
 * Collects per-job wall-clock durations for the `oursharedevents-ci` workflow
 * from the GitHub Actions API (via the `gh` CLI) and appends them to a committed
 * JSONL time-series at docs/monitoring/ci-cost-history.jsonl. That file is the
 * queryable "over time" history a future dashboard reads — CI wall-clock is the
 * dev-time cost line that complements the runtime OPERATION_COST metric
 * (COST-301).
 *
 * NEVER-WHO applies to developer identities too: records carry run/job timing
 * and the commit SHA + branch, but NO actor / committer login. Cost is a
 * property of a job, not of a person.
 *
 * Idempotent: records are keyed by `${runId}:${jobId}`, so re-running never
 * duplicates a line. Only COMPLETED runs are collected (durations are final).
 *
 * Usage:
 *   node scripts/ci-cost-collector.mjs [--history <path>] [--limit <n>] [--workflow <file>]
 *
 * The pure functions (computeDurationSec / jobsToRecords / mergeHistory) are
 * exported and unit-tested in tests/integration/ci-cost-collector.test.js; the
 * `gh`-driven main() only runs when the file is executed directly.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Whole seconds between two ISO timestamps, or null if either is missing or
 *  the pair is non-monotonic/unparseable. */
export function computeDurationSec(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const sec = Math.round((end - start) / 1000);
  return sec >= 0 ? sec : null;
}

/** The schema version stamped on every record. Bump only with a doc update. */
export const SCHEMA = 'ci-cost/v1';

/**
 * Turn one run's metadata + its jobs array into flat, identifier-free cost
 * records — one per completed, timeable job.
 *
 * @param {object} run  { databaseId, number, event, headBranch, headSha, workflowName }
 * @param {Array}  jobs [{ databaseId, name, conclusion, startedAt, completedAt }]
 */
export function jobsToRecords(run, jobs) {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .filter((j) => j && j.conclusion) // completed only
    .map((j) => ({
      schema: SCHEMA,
      runId: run.databaseId,
      runNumber: run.number,
      workflow: run.workflowName ?? 'oursharedevents-ci',
      event: run.event,
      headBranch: run.headBranch,
      headSha: typeof run.headSha === 'string' ? run.headSha.slice(0, 12) : run.headSha,
      jobId: j.databaseId,
      jobName: j.name,
      conclusion: j.conclusion,
      startedAt: j.startedAt,
      durationSec: computeDurationSec(j.startedAt, j.completedAt),
    }))
    .filter((r) => r.durationSec !== null);
}

/** Stable dedup key for a record. */
export function recordKey(r) {
  return `${r.runId}:${r.jobId}`;
}

/**
 * Merge new records into the existing JSONL lines, dropping duplicates (by
 * recordKey) and malformed existing lines. Existing order is preserved; new
 * records are appended. Returns an array of JSONL strings (no trailing newline).
 */
export function mergeHistory(existingLines, newRecords) {
  const seen = new Set();
  const out = [];
  for (const line of existingLines) {
    const trimmed = String(line).trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed history lines rather than propagate them
    }
    const key = recordKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(JSON.stringify(parsed));
  }
  for (const r of newRecords) {
    const key = recordKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(JSON.stringify(r));
  }
  return out;
}

// ── gh-driven collection (side effects; not run under test import) ────────────

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function parseArgs(argv) {
  const opts = {
    historyPath: 'docs/monitoring/ci-cost-history.jsonl',
    workflow: 'oursharedevents-ci.yml',
    limit: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--history') opts.historyPath = argv[++i];
    else if (argv[i] === '--workflow') opts.workflow = argv[++i];
    else if (argv[i] === '--limit') opts.limit = Number(argv[++i]) || opts.limit;
  }
  return opts;
}

export async function main(argv = process.argv.slice(2)) {
  const { historyPath, workflow, limit } = parseArgs(argv);

  const runs = JSON.parse(
    gh([
      'run',
      'list',
      '--workflow',
      workflow,
      '--status',
      'completed',
      '-L',
      String(limit),
      '--json',
      'databaseId,number,event,headBranch,headSha,workflowName',
    ])
  );

  const newRecords = [];
  for (const run of runs) {
    let jobs;
    try {
      jobs = JSON.parse(gh(['run', 'view', String(run.databaseId), '--json', 'jobs'])).jobs;
    } catch {
      continue; // a single unreadable run must not abort the whole collection
    }
    newRecords.push(...jobsToRecords(run, jobs));
  }

  const existingLines = existsSync(historyPath)
    ? readFileSync(historyPath, 'utf8').split('\n')
    : [];
  const merged = mergeHistory(existingLines, newRecords);
  const added = merged.length - existingLines.filter((l) => l.trim()).length;

  writeFileSync(historyPath, merged.join('\n') + (merged.length ? '\n' : ''), 'utf8');
  console.log(
    JSON.stringify({
      type: 'CI_COST_COLLECTED',
      runsScanned: runs.length,
      recordsInHistory: merged.length,
      recordsAdded: added,
    })
  );
}

// Only execute the collector when run directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`ci-cost-collector failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
