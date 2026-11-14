/**
 * Worker-suite CI slices are cut by measured time (2026-11-14).
 *
 * The T0 `worker-d1-schema i/N` slices run `npm test -- --shard=i/N`. vitest's
 * own sharding splits by file COUNT; spec times run from 0.4 s to 63 s, so the
 * slices of one run ranged from 3.4 to 5.9 min and the slowest set T0's end.
 * workers/oursharedevents/vitest.sequencer.mjs now plans the slices from the
 * per-file CI times in vitest-shard-durations.json (vitest-shard-plan.mjs).
 *
 * What this holds:
 *   1. The plan is a partition: every spec in exactly one slice of 1..N, the
 *      same slice whatever order vitest lists the specs in. The qr-decode-matrix
 *      invariant checks the workflow asks for 1/N..N/N; this is the other half,
 *      that 1/N..N/N then covers every spec once.
 *   2. On the committed times and the slice count CI uses, the slowest planned
 *      slice is within 0.5 min of the mean, for each project. vitest's own
 *      count split fails the same bar (born red on real data).
 *   3. The times still cover the suite (a spec added since the last refresh gets
 *      its project's median), and the parser that builds them reads real logs.
 *   4. The sequencer is what `npm test` runs.
 */

const { readFileSync, readdirSync } = require('fs');
const { createHash } = require('crypto');
const { join, relative } = require('path');
const { pathToFileURL } = require('url');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WORKER = join(ROOT, 'workers', 'oursharedevents');
const BAR_MS = 30_000; // slowest slice at most 0.5 min above the mean
const load = (p) => import(pathToFileURL(p).href);

function specFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.spec.ts')) out.push(relative(WORKER, p).split('\\').join('/'));
    }
  };
  walk(join(WORKER, 'tests'));
  return out.sort();
}

function ciSliceCount() {
  const wf = yaml.load(
    readFileSync(join(ROOT, '.github/workflows/oursharedevents-ci.yml'), 'utf8')
  );
  const counts = new Set();
  for (const job of Object.values(wf.jobs || {})) {
    for (const entry of (job.strategy && job.strategy.matrix && job.strategy.matrix.include) ||
      []) {
      const m =
        entry.section === 'worker-d1-schema' && /--shard=\d+\/(\d+)/.exec(String(entry.command));
      if (m) counts.add(Number(m[1]));
    }
  }
  return [...counts];
}

/** max − mean of a list of slice loads, in ms */
const imbalance = (loads) => Math.max(...loads) - loads.reduce((a, b) => a + b, 0) / loads.length;

/** vitest's BaseSequencer.shard: sha1 of the root-relative path, sorted, equal-count chunks. */
function countSplit(specs, count) {
  const size = Math.ceil(specs.length / count);
  const order = specs
    .map((s, i) => ({ i, h: createHash('sha1').update(`/${s.file}`).digest('hex') }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  const plan = new Array(specs.length);
  order.forEach(({ i }, k) => (plan[i] = Math.floor(k / size) + 1));
  return plan;
}

describe('worker-suite slices are cut by measured time', () => {
  let plan;
  let shardDurations;
  let durations;
  let specs;
  beforeAll(async () => {
    plan = await load(join(WORKER, 'vitest-shard-plan.mjs'));
    shardDurations = await load(join(ROOT, 'scripts', 'vitest-shard-durations.mjs'));
    const { NODE_SPECS } = await load(join(WORKER, 'vitest.node-specs.mjs'));
    durations = JSON.parse(readFileSync(join(WORKER, plan.DURATIONS_FILE), 'utf8'));
    const node = new Set(NODE_SPECS);
    specs = specFiles()
      .filter((f) => f !== 'tests/a11y-axe.spec.ts') // its own config, in neither project
      .map((file) => ({ project: node.has(file) ? 'node' : 'workers', file }));
  });

  test('the walk found the suite in both projects', () => {
    expect(specs.filter((s) => s.project === 'workers').length).toBeGreaterThan(200);
    expect(specs.filter((s) => s.project === 'node').length).toBeGreaterThan(100);
  });

  test('every spec lands in exactly one slice of 1..N, whatever the input order', () => {
    for (const n of [2, 3, 5, 7]) {
      const p = plan.planShards(specs, n, durations);
      expect(p).toHaveLength(specs.length);
      for (const s of p) expect(Number.isInteger(s) && s >= 1 && s <= n).toBe(true);
      for (let k = 1; k <= n; k++) expect(p.filter((s) => s === k).length).toBeGreaterThan(0);
      const reversed = [...specs].reverse();
      const pr = plan.planShards(reversed, n, durations);
      const bySpec = new Map(reversed.map((s, i) => [`${s.project}:${s.file}`, pr[i]]));
      specs.forEach((s, i) => expect(bySpec.get(`${s.project}:${s.file}`)).toBe(p[i]));
    }
    expect(() => plan.planShards(specs, 0, durations)).toThrow();
  });

  test('an unmeasured spec weighs its project median, a measured one its time', () => {
    const d = {
      projects: {
        workers: { 'tests/a.spec.ts': 1000, 'tests/b.spec.ts': 5000, 'tests/c.spec.ts': 9000 },
      },
    };
    expect(
      plan.specWeights(
        [
          { project: 'workers', file: 'tests/c.spec.ts' },
          { project: 'workers', file: 'tests/new.spec.ts' },
        ],
        d
      )
    ).toEqual([9000, 5000]);
  });

  test('the CI slice count has one value, and the committed times balance it within 0.5 min', () => {
    const counts = ciSliceCount();
    expect(counts, 'every worker-d1-schema slice must use the same N').toHaveLength(1);
    const [n] = counts;
    const p = plan.planShards(specs, n, durations);
    for (const project of ['workers', 'node']) {
      const loads = plan.sliceLoads(specs, p, n, durations, project);
      expect(
        imbalance(loads),
        `${project}: planned slices ${loads.map((l) => (l / 60000).toFixed(2)).join(' / ')} min`
      ).toBeLessThanOrEqual(BAR_MS);
    }
  });

  test('born red: vitest’s own equal-count split of the same suite fails that bar', () => {
    const [n] = ciSliceCount();
    const loads = plan.sliceLoads(specs, countSplit(specs, n), n, durations, 'workers');
    expect(imbalance(loads)).toBeGreaterThan(BAR_MS);
  });

  test('the committed times cover the suite and are sane', () => {
    expect(Object.keys(durations.projects).sort()).toEqual(['node', 'workers']);
    for (const files of Object.values(durations.projects)) {
      for (const ms of Object.values(files)) expect(Number.isInteger(ms) && ms > 0).toBe(true);
    }
    const measured = specs.filter((s) =>
      Object.prototype.hasOwnProperty.call(durations.projects[s.project], s.file)
    ).length;
    expect(
      measured / specs.length,
      'over 15% of specs have no CI time: run `node scripts/vitest-shard-durations.mjs` and commit the file'
    ).toBeGreaterThanOrEqual(0.85);
  });

  test('the log parser times workers files by the serial gap and node files by the reporter', () => {
    const log = [
      '2026-11-14T10:00:00.000Z  RUN  v4.1.12 /w',
      '2026-11-14T10:00:10.000Z  \x1b[32m✓\x1b[39m  workers  tests/a.spec.ts (3 tests) 4000ms',
      '2026-11-14T10:00:11.000Z  ✓  node  tests/n.spec.ts (2 tests) 700ms',
      '2026-11-14T10:00:25.000Z  ✓  workers  tests/b.spec.ts (1 test | 1 skipped) 900ms',
      // a retried attempt starts again and replaces the first
      '2026-11-14T10:01:00.000Z  RUN  v4.1.12 /w',
      '2026-11-14T10:01:08.000Z  ✓  workers  tests/a.spec.ts (3 tests) 3000ms',
    ].join('\n');
    const got = shardDurations.parseSliceLog(log);
    const by = Object.fromEntries(got.map((e) => [`${e.project}:${e.file}`, e.ms]));
    expect(by).toEqual({
      'workers:tests/a.spec.ts': 8000,
      'node:tests/n.spec.ts': 700,
      'workers:tests/b.spec.ts': 15000,
    });
    const m = shardDurations.buildManifest(
      [
        [{ project: 'workers', file: 'tests/a.spec.ts', ms: 8040 }],
        [{ project: 'workers', file: 'tests/a.spec.ts', ms: 2000 }],
        [{ project: 'workers', file: 'tests/a.spec.ts', ms: 9000 }],
      ],
      [1, 2, 3]
    );
    expect(m.projects.workers['tests/a.spec.ts']).toBe(8000); // median, to 100 ms
    expect(m.runs).toEqual([1, 2, 3]);
  });

  test('`npm test` runs the time-balanced sequencer', () => {
    const config = readFileSync(join(WORKER, 'vitest.config.mts'), 'utf8');
    const sequencer = readFileSync(join(WORKER, 'vitest.sequencer.mjs'), 'utf8');
    const pkg = JSON.parse(readFileSync(join(WORKER, 'package.json'), 'utf8'));
    const wired = (cfg, seq) =>
      /import\s+(\w+)\s+from\s+'\.\/vitest\.sequencer\.mjs'/.test(cfg) &&
      new RegExp(
        `sequence:\\s*\\{\\s*sequencer:\\s*${(/import\s+(\w+)\s+from\s+'\.\/vitest\.sequencer\.mjs'/.exec(cfg) || [])[1]}\\b`
      ).test(cfg) &&
      /extends BaseSequencer/.test(seq) &&
      /async shard\(/.test(seq) &&
      /planShards\(/.test(seq);
    expect(pkg.scripts.test).toBe('vitest run');
    expect(wired(config, sequencer)).toBe(true);
    // born red: each loosening is seen
    expect(wired(config.replace(/sequence:[^\n]*\n/, ''), sequencer)).toBe(false);
    expect(wired(config.replace('./vitest.sequencer.mjs', './other.mjs'), sequencer)).toBe(false);
    expect(wired(config, sequencer.replace('async shard(', 'async sort2('))).toBe(false);
  });
});
