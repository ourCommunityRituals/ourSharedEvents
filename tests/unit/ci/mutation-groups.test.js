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
    // Reads the whole Worker's import graph once per group: seconds on a loaded runner.
  }, 60_000);
});
