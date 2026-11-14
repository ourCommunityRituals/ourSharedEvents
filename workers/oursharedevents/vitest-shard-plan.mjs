// vitest-shard-plan.mjs — split the worker suite into CI slices by measured time.
//
// vitest's own `--shard=i/N` hashes each spec path and cuts the sorted list into
// N runs of equal FILE COUNT. Spec times range from 0.4 s to 63 s, so equal
// counts gave slices from 3.4 to 5.9 min in one run, and the slowest slice set
// the end of T0 (the PR critical path).
//
// This module plans the slices from the measured per-file times committed in
// vitest-shard-durations.json (refresh: node scripts/vitest-shard-durations.mjs).
// It is pure (node builtins only) so the root test suite can hold it without the
// worker's dependencies; vitest.sequencer.mjs plugs it into vitest.
//
// Plan, per vitest project, independently:
//   - weight = the file's measured time; a file with no measurement (a new spec)
//     gets the median of its project, so it still lands somewhere sensible;
//   - longest-processing-time first: heaviest file to the lightest slice, ties
//     to the slice with fewer files, then the lower index.
// Projects are planned apart because they run apart: the `workers` pool runs one
// file at a time (maxWorkers: 1, OSE-696), so a slice lasts about as long as the
// sum of its workers files; `node` files run in parallel beside it and only add
// CPU pressure, which is spread evenly too.
//
// Every spec gets exactly one slice in 1..count, whatever order the specs come
// in, so `--shard=1/N` .. `--shard=N/N` still cover the suite exactly once (the
// contract tests/e2e/0-architecture/qr-decode-matrix.invariant.spec.ts holds).

export const DURATIONS_FILE = 'vitest-shard-durations.json';
const DEFAULT_MS = 1000;

function median(values) {
  if (values.length === 0) return DEFAULT_MS;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Measured time of each spec, in ms (unmeasured specs get their project's median). */
export function specWeights(specs, durations) {
  const projects = (durations && durations.projects) || {};
  const fallback = new Map();
  return specs.map(({ project, file }) => {
    const known = projects[project] || {};
    if (!fallback.has(project)) fallback.set(project, median(Object.values(known)));
    const ms = Object.prototype.hasOwnProperty.call(known, file)
      ? known[file]
      : fallback.get(project);
    return Math.max(1, Number(ms) || DEFAULT_MS);
  });
}

/**
 * @param {{project: string, file: string}[]} specs  file = path from the worker root, posix
 * @param {number} count  number of slices
 * @param {object} durations  the parsed vitest-shard-durations.json
 * @returns {number[]} the 1-based slice of each spec, in input order
 */
export function planShards(specs, count, durations) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`slice count must be a positive integer, got ${count}`);
  const weights = specWeights(specs, durations);
  const out = new Array(specs.length);
  const byProject = new Map();
  specs.forEach((spec, i) => {
    if (!byProject.has(spec.project)) byProject.set(spec.project, []);
    byProject.get(spec.project).push(i);
  });
  for (const project of [...byProject.keys()].sort()) {
    const order = byProject
      .get(project)
      .sort(
        (a, b) =>
          weights[b] - weights[a] ||
          (specs[a].file < specs[b].file ? -1 : specs[a].file > specs[b].file ? 1 : 0)
      );
    const loads = new Array(count).fill(0);
    const files = new Array(count).fill(0);
    for (const i of order) {
      let best = 0;
      for (let k = 1; k < count; k++) {
        if (loads[k] < loads[best] || (loads[k] === loads[best] && files[k] < files[best]))
          best = k;
      }
      loads[best] += weights[i];
      files[best] += 1;
      out[i] = best + 1;
    }
  }
  return out;
}

/** Planned load (ms) of each slice for one project: index 0 is slice 1. */
export function sliceLoads(specs, plan, count, durations, project) {
  const weights = specWeights(specs, durations);
  const loads = new Array(count).fill(0);
  specs.forEach((spec, i) => {
    if (spec.project === project) loads[plan[i] - 1] += weights[i];
  });
  return loads;
}
