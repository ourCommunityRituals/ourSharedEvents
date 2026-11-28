/**
 * The main mutation pass split into groups (workers/oursharedevents/mutation-groups.mjs).
 *
 * CI runs the main pass as four jobs side by side. Two ways a split can go
 * wrong quietly, and each is held here against a planted fault:
 *   1. a target in no group is never mutated in CI, and a file in two groups is
 *      scored twice: mutateForGroup refuses both, so the config fails to load;
 *   2. each group runs only the specs whose imports reach its files
 *      (relatedSpecs). A spec it wrongly leaves out loses its kills. The scan
 *      must follow every import form the Worker uses, through chains, `.js`
 *      written for `.ts`, index files and cycles.
 *
 * @born-red method: injected fault, one at a time in mutation-groups.mjs, each
 *   watched failing here and then reverted | date: 2026-11-12 | verified:
 *   - the "in no group" check removed -> "a target in no group" fails;
 *   - the duplicate-file check removed -> "a file in two groups" fails;
 *   - the "group file not mutated" check removed -> "a group file with no target" fails;
 *   - ranges not stripped (targetFile returns the entry) -> "a file's ranges" fails;
 *   - only direct imports followed (no recursion) -> "through a chain" fails;
 *   - the `.js` -> `.ts` rewrite removed -> "an import written as .js" fails;
 *   - `/index.ts` taken off the suffixes -> "a folder import" fails;
 *   - `import(` / `vi.mock(` / the `from` form dropped from the pattern -> its case fails;
 *   - a miss cached from inside an open cycle -> "a file judged inside an open
 *     cycle" fails (the first cycle case alone stayed green on this fault, so
 *     the second was written for it);
 *   - the unknown-name check in groupFromEnv removed -> "a typo" fails.
 *
 *   3. the order the specs run in (orderSpecs, and the sequencer that
 *      vitest.mutation.config.mts runs the main pass with). Left to Vitest it
 *      was the files that failed last first, then the longest, so the same
 *      mutant cost 1 test in one run and hundreds in another. An order can go
 *      wrong three ways: it is not the one meant, it differs from run to run,
 *      or it loses a spec, which would lose that spec's kills.
 *
 * @born-red method: injected fault, one at a time, each watched failing here
 *   and then reverted | date: 2026-11-15 | verified, in mutation-groups.mjs:
 *   - distance counted from 1 -> the three "distance is" cases fail;
 *   - only a file's first import followed -> "by the shortest way" fails;
 *   - only the first mutated file a target -> "the nearest of several" fails;
 *   - the named-spec rule dropped -> "the spec named for the file" fails;
 *   - the distance rule dropped -> "then the nearest specs" fails;
 *   - the path tiebreak dropped -> "does not depend on the order ... given" fails;
 *   and in vitest.mutation.config.mts:
 *   - `sequence` taken off the config -> "the main pass is wired to it" fails;
 *   - sort() answering with Vitest's own order -> "what failed or ran longest
 *     last time does not move it" fails, with three more;
 *   - the mutated file (`related`) ignored -> "a mutant of street-map.ts" fails;
 *   - a file the order does not know dropped -> "every file handed over" fails.
 */

const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
const { join, dirname } = require('path');
const { tmpdir } = require('os');

let G;
beforeAll(async () => {
  G = await import('../../../workers/oursharedevents/mutation-groups.mjs');
});

const groups = { a: ['src/a.ts', 'src/b.ts'], b: ['src/c.ts'] };

describe('every target in exactly one group', () => {
  test('control: each group gets its own targets, ranges with their file', () => {
    const mutate = ['src/a.ts', 'src/b.ts:10-20', 'src/b.ts:30-40', 'src/c.ts'];
    expect(G.mutateForGroup(mutate, 'a', groups)).toEqual([
      'src/a.ts',
      'src/b.ts:10-20',
      'src/b.ts:30-40',
    ]);
    expect(G.mutateForGroup(mutate, 'b', groups)).toEqual(['src/c.ts']);
  });

  test("a file's ranges are judged by the file", () => {
    expect(G.targetFile('src/b.ts:10-20')).toBe('src/b.ts');
    expect(G.targetFile('src/b.ts')).toBe('src/b.ts');
  });

  test('a target in no group', () => {
    expect(() =>
      G.mutateForGroup(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'], 'a', groups)
    ).toThrow(/src\/d\.ts is mutated but in no group/);
  });

  test('a file in two groups', () => {
    const twice = { a: ['src/a.ts', 'src/b.ts'], b: ['src/c.ts', 'src/a.ts'] };
    expect(() => G.mutateForGroup(['src/a.ts', 'src/b.ts', 'src/c.ts'], 'a', twice)).toThrow(
      /src\/a\.ts is in groups a and b/
    );
  });

  test('a group file with no target (a group that would pass doing nothing)', () => {
    expect(() => G.mutateForGroup(['src/a.ts', 'src/c.ts'], 'a', groups)).toThrow(
      /src\/b\.ts is in group a but not mutated/
    );
  });

  test('an unknown group', () => {
    expect(() => G.mutateForGroup(['src/a.ts', 'src/b.ts', 'src/c.ts'], 'z', groups)).toThrow(
      /no group "z"/
    );
  });

  test('the real config: every target is grouped, and the groups add up to the whole', async () => {
    const all = (await import('../../../workers/oursharedevents/stryker.conf.mjs')).default.mutate;
    const parts = Object.keys(G.MUTATION_GROUPS).flatMap((g) => G.mutateForGroup(all, g));
    expect([...parts].sort()).toEqual([...all].sort());
  });
});

describe('MUTATION_GROUP', () => {
  test('unset, empty or the language pass means a full main pass', () => {
    expect(G.groupFromEnv({})).toBeNull();
    expect(G.groupFromEnv({ MUTATION_GROUP: '' })).toBeNull();
    expect(G.groupFromEnv({ MUTATION_GROUP: G.LANGUAGE_GROUP })).toBeNull();
  });

  test('a group name is that group', () => {
    for (const g of Object.keys(G.MUTATION_GROUPS)) {
      expect(G.groupFromEnv({ MUTATION_GROUP: g })).toBe(g);
    }
  });

  test('a typo fails, never falls back to some other set of targets', () => {
    expect(() => G.groupFromEnv({ MUTATION_GROUP: 'maps' })).toThrow(/not a group/);
  });
});

describe('the specs a group runs: every spec whose imports reach its files', () => {
  let root;
  const put = (rel, text) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mutation-groups-'));
    put('src/target.ts', 'export const t = 1;\n');
    put('src/other.ts', 'export const o = 1;\n');
    put('src/mid.ts', "import { t } from './target';\nexport const m = t;\n");
    put('src/top.ts', "export { m } from './mid';\n");
    put('src/folder/index.ts', "import './../target';\n");
    put('src/cycle-a.ts', "import './cycle-b';\nimport './target';\n");
    put('src/cycle-b.ts', "import './cycle-a';\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const related = (specText) => {
    put('tests/x.spec.ts', specText);
    return G.relatedSpecs(['tests/x.spec.ts'], ['src/target.ts'], root).length === 1;
  };

  test.each([
    ['a direct import', "import { t } from '../src/target';"],
    ['through a chain and a re-export', "import { m } from '../src/top';"],
    ['an import written as .js', "import { t } from '../src/target.js';"],
    ['a folder import', "import '../src/folder';"],
    ['a dynamic import', "const m = await import('../src/mid');"],
    ['a vi.mock of the file', "vi.mock('../src/target', () => ({}));"],
    ['a cycle that reaches it', "import '../src/cycle-b';"],
  ])('%s', (_label, text) => {
    expect(related(text)).toBe(true);
  });

  test.each([
    ['a spec that imports only another file', "import { o } from '../src/other';"],
    ['a package import', "import { describe } from 'vitest';"],
    ['a spec that imports nothing', 'test("x", () => {});'],
  ])('%s is left out', (_label, text) => {
    expect(related(text)).toBe(false);
  });

  test('a cycle that never reaches it does not hide a later spec that does', () => {
    put('src/loop-a.ts', "import './loop-b';\n");
    put('src/loop-b.ts', "import './loop-a';\n");
    put('tests/a.spec.ts', "import '../src/loop-a';");
    put('tests/b.spec.ts', "import '../src/loop-b';\nimport '../src/mid';");
    expect(G.relatedSpecs(['tests/a.spec.ts', 'tests/b.spec.ts'], ['src/target.ts'], root)).toEqual(
      ['tests/b.spec.ts']
    );
  });

  test('a file judged inside an open cycle is not remembered as a miss', () => {
    // a.spec -> ring-a -> ring-b -> ring-a (open: no answer yet), so ring-b looks
    // like a miss; ring-a then reaches the target. ring-b does too, through ring-a,
    // so b.spec, which imports only ring-b, must be chosen.
    put('src/ring-a.ts', "import './ring-b';\nimport './target';\n");
    put('src/ring-b.ts', "import './ring-a';\n");
    put('tests/a.spec.ts', "import '../src/ring-a';");
    put('tests/b.spec.ts', "import '../src/ring-b';");
    expect(G.relatedSpecs(['tests/a.spec.ts', 'tests/b.spec.ts'], ['src/target.ts'], root)).toEqual(
      ['tests/a.spec.ts', 'tests/b.spec.ts']
    );
  });

  test('the real Worker: every group reaches some specs, and fewer than the whole pass', async () => {
    const { MAIN_MUTATION_SPECS } =
      await import('../../../workers/oursharedevents/vitest.mutation.config.mts').catch(() => ({
        MAIN_MUTATION_SPECS: null,
      }));
    const { NODE_SPECS } = await import('../../../workers/oursharedevents/vitest.node-specs.mjs');
    const specs = MAIN_MUTATION_SPECS || NODE_SPECS;
    const worker = join(__dirname, '..', '..', '..', 'workers', 'oursharedevents');
    for (const [g, files] of Object.entries(G.MUTATION_GROUPS)) {
      const chosen = G.relatedSpecs(specs, [...files], worker);
      expect(chosen.length, g).toBeGreaterThan(0);
      expect(chosen.length, g).toBeLessThan(specs.length);
    }
    // Reads the whole Worker's import graph once per group: seconds a group on
    // a loaded runner. With eleven groups (menu, 2026-11-28) it took 61 s in CI
    // on PR 1594 and 45 s locally, so 120 s leaves room for a twelfth.
  }, 120_000);
});

describe('the order the specs run in: decided by the mutated file, the same every run', () => {
  let root;
  const put = (rel, text) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mutation-order-'));
    put('src/lib/target.ts', 'export const t = 1;\n');
    put('src/lib/other.ts', 'export const o = 1;\n');
    put('src/mid.ts', "import { t } from './lib/target';\nexport const m = t;\n");
    put('src/top.ts', "export { m } from './mid';\n");
    put('tests/target.spec.ts', "import { m } from '../src/top';\n");
    put('tests/a-far.spec.ts', "import { m } from '../src/top';\n");
    put('tests/b-near.spec.ts', "import { t } from '../src/lib/target';\n");
    put('tests/c-mid.spec.ts', "import { m } from '../src/mid';\n");
    put('tests/d-near.spec.ts', "import { t } from '../src/lib/target';\n");
    put('tests/e-none.spec.ts', "import { o } from '../src/lib/other';\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const SPECS = [
    'tests/a-far.spec.ts',
    'tests/b-near.spec.ts',
    'tests/c-mid.spec.ts',
    'tests/d-near.spec.ts',
    'tests/e-none.spec.ts',
    'tests/target.spec.ts',
  ];

  test('distance is the number of imports between a spec and the file', () => {
    const d = G.importDistances(SPECS, ['src/lib/target.ts'], root);
    expect(Object.fromEntries(d)).toEqual({
      'tests/a-far.spec.ts': 3,
      'tests/b-near.spec.ts': 1,
      'tests/c-mid.spec.ts': 2,
      'tests/d-near.spec.ts': 1,
      'tests/e-none.spec.ts': Infinity,
      'tests/target.spec.ts': 3,
    });
  });

  test('distance is by the shortest way, whichever import is written first', () => {
    put('tests/two-ways.spec.ts', "import '../src/top';\nimport '../src/lib/target';\n");
    put('tests/two-ways-back.spec.ts', "import '../src/lib/target';\nimport '../src/top';\n");
    const d = G.importDistances(
      ['tests/two-ways.spec.ts', 'tests/two-ways-back.spec.ts'],
      ['src/lib/target.ts'],
      root
    );
    expect([...d.values()]).toEqual([1, 1]);
  });

  test('distance is to the nearest of several files', () => {
    const d = G.importDistances(
      ['tests/a-far.spec.ts', 'tests/e-none.spec.ts'],
      ['src/lib/target.ts', 'src/lib/other.ts'],
      root
    );
    expect([...d.values()]).toEqual([3, 1]);
  });

  test('the spec named for the file runs first, though others are nearer', () => {
    expect(G.orderSpecs(SPECS, ['src/lib/target.ts'], root)[0]).toBe('tests/target.spec.ts');
  });

  test('then the nearest specs, then by path; a spec that never reaches the file is last', () => {
    expect(G.orderSpecs(SPECS, ['src/lib/target.ts'], root)).toEqual([
      'tests/target.spec.ts',
      'tests/b-near.spec.ts',
      'tests/d-near.spec.ts',
      'tests/c-mid.spec.ts',
      'tests/a-far.spec.ts',
      'tests/e-none.spec.ts',
    ]);
  });

  test('the order does not depend on the order the specs were given in', () => {
    const forward = G.orderSpecs(SPECS, ['src/lib/target.ts'], root);
    const given = [...SPECS].reverse();
    expect(G.orderSpecs(given, ['src/lib/target.ts'], root)).toEqual(forward);
    expect(given).toEqual([...SPECS].reverse()); // the list given is not reordered
  });

  test('another mutated file is another order', () => {
    expect(G.orderSpecs(SPECS, ['src/lib/other.ts'], root)).toEqual([
      'tests/e-none.spec.ts',
      'tests/a-far.spec.ts',
      'tests/b-near.spec.ts',
      'tests/c-mid.spec.ts',
      'tests/d-near.spec.ts',
      'tests/target.spec.ts',
    ]);
  });

  test('every spec comes back once: order never leaves a spec out', () => {
    for (const files of [['src/lib/target.ts'], ['src/lib/other.ts'], ['src/nowhere.ts'], []]) {
      expect([...G.orderSpecs(SPECS, files, root)].sort()).toEqual([...SPECS].sort());
    }
  });

  describe('the sequencer the main pass runs with (vitest.mutation.config.mts)', () => {
    const worker = join(__dirname, '..', '..', '..', 'workers', 'oursharedevents')
      .split('\\')
      .join('/');
    let config;
    let Sequencer;
    let specs;
    beforeAll(async () => {
      const m = await import('../../../workers/oursharedevents/vitest.mutation.config.mts');
      config = m.default;
      Sequencer = m.MutantFirstSequencer;
      specs = m.MAIN_MUTATION_SPECS;
    }, 60_000);

    const file = (rel) => ({ moduleId: `${worker}/${rel}`, project: { name: 'main-mutation' } });
    const names = (files) => files.map((f) => f.moduleId.slice(worker.length + 1));
    // What Vitest's own order reads: a cache saying which file failed last and
    // how long each took. Here it says the longest spec failed, and is the longest.
    const cache = {
      getFileTestResults: (key) =>
        key.endsWith('form-pages-language.spec.ts')
          ? { failed: true, duration: 60_000 }
          : { failed: false, duration: 1 },
      getFileStats: () => ({ size: 1 }),
    };
    const sorted = (related, files) =>
      new Sequencer({ config: { root: worker, related }, cache }).sort(files).then(names);

    test('the main pass is wired to it', () => {
      expect(typeof Sequencer).toBe('function');
      expect(config.test.sequence.sequencer).toBe(Sequencer);
    });

    test('a mutant of street-map.ts runs street-map.spec.ts first, of mvt.ts mvt.spec.ts', async () => {
      const files = specs.map(file);
      expect((await sorted([`${worker}/src/lib/street-map.ts`], files))[0]).toBe(
        'tests/street-map.spec.ts'
      );
      expect((await sorted([`${worker}/src/lib/mvt.ts`], files))[0]).toBe('tests/mvt.spec.ts');
    }, 60_000);

    test('what failed or ran longest last time does not move it', async () => {
      const files = specs.map(file);
      const order = await sorted([`${worker}/src/lib/street-map.ts`], files);
      expect(order.indexOf('tests/form-pages-language.spec.ts')).toBeGreaterThan(
        order.indexOf('tests/street-map.spec.ts')
      );
      expect(await sorted([`${worker}/src/lib/street-map.ts`], [...files].reverse())).toEqual(
        order
      );
    }, 60_000);

    test('it is the order of orderSpecs for the mutated file, for just the files of the run', async () => {
      const some = ['tests/pmtiles.spec.ts', 'tests/street-map.spec.ts', 'tests/mvt.spec.ts'];
      expect(await sorted([`${worker}/src/lib/pmtiles.ts`], some.map(file))).toEqual(
        G.orderSpecs(specs, ['src/lib/pmtiles.ts'], worker).filter((s) => some.includes(s))
      );
    }, 60_000);

    test('every file handed over is handed back, one it does not know last', async () => {
      const files = [file('tests/not-in-the-pass.spec.ts'), ...specs.map(file)];
      for (const related of [[`${worker}/src/lib/mvt.ts`], [], undefined]) {
        const order = await sorted(related, files);
        expect([...order].sort()).toEqual(names(files).sort());
        expect(order[order.length - 1]).toBe('tests/not-in-the-pass.spec.ts');
      }
    }, 60_000);
  });
});
