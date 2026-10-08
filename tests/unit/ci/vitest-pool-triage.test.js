/**
 * The pool triage manifest reads the same on Windows and on Linux.
 *
 * `scripts/triage-vitest-pool.mjs --check` compares the committed manifest,
 * byte for byte, with one it builds from the spec files. The manifest is
 * written on a developer machine (often Windows) and checked in CI (Linux), so
 * anything in it that follows the operating system turns the check red for a
 * reason that has nothing to do with the specs. Three places could:
 *
 *   1. the order of the entries: sorting native paths puts `ops\a` after `ops2`
 *      on Windows (`\` is 0x5C) and `ops/a` before it on Linux (`/` is 0x2F);
 *   2. the committed file itself: a Windows checkout with autocrlf holds it
 *      with CRLF line ends, while the script builds it with LF;
 *   3. the spec sources, which the same checkout also holds with CRLF.
 *
 * The first two were real. The third is pinned here so it stays untrue.
 */

const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

let triage;

beforeAll(async () => {
  triage = await import('../../../scripts/triage-vitest-pool.mjs');
});

const T = 'workers/oursharedevents/tests';
const win = (p) => p.replace(/\//g, '\\');

describe('pool triage: entry order does not follow the path separator', () => {
  // `-` 0x2D < `/` 0x2F < `2` 0x32 < `X` 0x58 < `\` 0x5C
  const LINUX_ORDER = [
    `${T}/ops-z.spec.ts`,
    `${T}/ops/a.spec.ts`,
    `${T}/ops2.spec.ts`,
    `${T}/opsX.spec.ts`,
  ];
  const shuffled = [LINUX_ORDER[2], LINUX_ORDER[0], LINUX_ORDER[3], LINUX_ORDER[1]];

  test('the case is a real trap: sorting Windows paths as they come gives another order', () => {
    const naive = shuffled
      .map(win)
      .sort()
      .map((p) => p.replace(/\\/g, '/'));
    expect(naive).not.toEqual(LINUX_ORDER);
  });

  test('paths with forward slashes come out in code-unit order', () => {
    expect(triage.sortSpecPaths(shuffled)).toEqual(LINUX_ORDER);
  });

  test('the same paths with backslashes come out in the same order, with forward slashes', () => {
    expect(triage.sortSpecPaths(shuffled.map(win))).toEqual(LINUX_ORDER);
  });

  test('a real folder is walked into that order on whichever system runs this', () => {
    const root = mkdtempSync(join(tmpdir(), 'pool-triage-'));
    try {
      const tests = join(root, 'tests');
      mkdirSync(join(tests, 'ops'), { recursive: true });
      writeFileSync(join(tests, 'ops2.spec.ts'), "it('b', () => {});\n");
      writeFileSync(join(tests, 'ops', 'a.spec.ts'), "it('a', () => {});\n");
      writeFileSync(join(tests, 'notes.txt'), 'not a spec\n');

      const manifest = triage.buildManifest(tests, root);
      expect(manifest.files.map((f) => f.file)).toEqual([
        'tests/ops/a.spec.ts',
        'tests/ops2.spec.ts',
      ]);
      expect(manifest.summary).toMatchObject({ total: 2, totalTests: 2, node: 2, workerd: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('pool triage: a spec classifies the same with LF and with CRLF line ends', () => {
  const LF = [
    '// SELF.fetch is only named in this comment',
    "import { env } from 'cloudflare:test';",
    '/* env.DB is only named',
    '   in this block comment */',
    "describe('a static gate', () => {",
    "  it('reads bundled source', () => {",
    '    expect(env.TEST_SOURCE_FILES_JSON).toBeTruthy(); // trailing note',
    '  });',
    '  it',
    "    .each([1, 2])('case %s', () => {});",
    "  test.concurrent('alongside', () => {});",
    '});',
    '',
  ].join('\n');
  const CRLF = LF.replace(/\n/g, '\r\n');

  test('the fixture is what it says: one copy has carriage returns, one has none', () => {
    expect(LF).not.toContain('\r');
    expect(CRLF.split('\r\n')).toHaveLength(LF.split('\n').length);
  });

  test('bucket, review flag, reason and test count are the same for both', () => {
    const lf = triage.classifySource(`${T}/x.spec.ts`, LF);
    expect(lf).toEqual({
      file: `${T}/x.spec.ts`,
      bucket: 'node',
      needsReview: true,
      reason: 'cloudflare:test used only for static env.TEST_*_JSON source read — fs-relocatable',
      testCount: 3,
    });
    expect(triage.classifySource(`${T}/x.spec.ts`, CRLF)).toEqual(lf);
  });

  test('a runtime marker is found in both', () => {
    const src = "import { SELF } from 'cloudflare:test';\nit('x', () => SELF.fetch('/'));\n";
    const lf = triage.classifySource(`${T}/y.spec.ts`, src);
    expect(lf).toMatchObject({ bucket: 'workerd', needsReview: false, testCount: 1 });
    expect(triage.classifySource(`${T}/y.spec.ts`, src.replace(/\n/g, '\r\n'))).toEqual(lf);
  });
});

// The written file holds one entry per spec and nothing that depends on any
// other spec. It used to hold the totals too. A total changes with every spec
// or test added, so any two pull requests that each added one changed the same
// lines and could not both merge without one being regenerated. Seen on
// 2026-10-07: three rounds of regenerating open pull requests after a merge.
// The totals are still worked out and printed; they are just not stored.
describe('pool triage: the written manifest merges cleanly', () => {
  const NODE_SPEC = "it('one', () => {});\n";
  const folder = (specs) => {
    const root = mkdtempSync(join(tmpdir(), 'pool-triage-'));
    mkdirSync(join(root, 'tests'), { recursive: true });
    for (const [name, src] of Object.entries(specs)) writeFileSync(join(root, 'tests', name), src);
    return root;
  };
  const built = (specs) => {
    const root = folder(specs);
    try {
      return triage.buildManifest(join(root, 'tests'), root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const written = (specs) => triage.serializeManifest(built(specs));
  const BASE = { 'b.spec.ts': NODE_SPEC, 'm.spec.ts': NODE_SPEC };
  const TWO_TESTS = `${NODE_SPEC}it('two', () => {});\n`;

  test('it holds one entry per spec and no totals', () => {
    const stored = JSON.parse(written(BASE));
    expect(Object.keys(stored)).toEqual(['generatedBy', 'files']);
    expect(stored.files.map((f) => f.file)).toEqual(['tests/b.spec.ts', 'tests/m.spec.ts']);
  });

  test('each entry still records its test count, so a dropped test shows in the diff', () => {
    const stored = JSON.parse(written({ ...BASE, 'b.spec.ts': TWO_TESTS }));
    expect(stored.files.map((f) => f.testCount)).toEqual([2, 1]);
  });

  test('adding a test to one spec changes one line of the file', () => {
    const before = written(BASE).split('\n');
    const after = written({ ...BASE, 'b.spec.ts': TWO_TESTS }).split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toEqual(['      "testCount": 2']);
  });

  test('the totals are still worked out, for the summary the script prints', () => {
    expect(built(BASE).summary).toMatchObject({ total: 2, totalTests: 2, node: 2, workerd: 0 });
  });

  // The property itself, with git's own three-way merge. `ours` and `theirs`
  // are two pull requests made from the same `base`; the merged file must be
  // exactly what a fresh build of both changes gives.
  const mergesCleanly = (ours, theirs, both) => {
    const { spawnSync } = require('child_process');
    const dir = mkdtempSync(join(tmpdir(), 'pool-triage-merge-'));
    try {
      const put = (name, text) => {
        writeFileSync(join(dir, name), text);
        return join(dir, name);
      };
      const merge = spawnSync(
        'git',
        [
          'merge-file',
          '-p',
          put('ours.json', written(ours)),
          put('base.json', written(BASE)),
          put('theirs.json', written(theirs)),
        ],
        { encoding: 'utf8' }
      );
      expect(merge.status, `git merge-file reported conflicts:\n${merge.stdout}`).toBe(0);
      expect(triage.isManifestStale(merge.stdout, written(both))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('two branches that each add a spec merge with no conflict, and the result is up to date', () => {
    const ours = { ...BASE, 'a.spec.ts': NODE_SPEC };
    const theirs = { ...BASE, 'z.spec.ts': NODE_SPEC };
    mergesCleanly(ours, theirs, { ...ours, ...theirs });
  }, 30_000);

  test('a branch that adds a test and a branch that adds a spec merge the same way', () => {
    const ours = { ...BASE, 'b.spec.ts': TWO_TESTS };
    const theirs = { ...BASE, 'z.spec.ts': NODE_SPEC };
    mergesCleanly(ours, theirs, { ...BASE, 'b.spec.ts': TWO_TESTS, 'z.spec.ts': NODE_SPEC });
  }, 30_000);
});

describe('pool triage: --check compares content, not line ends', () => {
  const manifest = {
    generatedBy: 'scripts/triage-vitest-pool.mjs',
    summary: { total: 1, totalTests: 1, workerd: 0, node: 1, needsReview: 0 },
    files: [
      { file: `${T}/x.spec.ts`, bucket: 'node', needsReview: false, reason: 'r', testCount: 1 },
    ],
  };

  test('the manifest is written with LF line ends and one final newline', () => {
    const text = triage.serializeManifest(manifest);
    expect(text).not.toContain('\r');
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      generatedBy: manifest.generatedBy,
      files: manifest.files,
    });
  });

  test('the same manifest, checked out with CRLF, is up to date', () => {
    const text = triage.serializeManifest(manifest);
    expect(triage.isManifestStale(text, text)).toBe(false);
    expect(triage.isManifestStale(text.replace(/\n/g, '\r\n'), text)).toBe(false);
  });

  test('a manifest that differs in content is stale, whatever its line ends', () => {
    const text = triage.serializeManifest(manifest);
    const other = triage.serializeManifest({ ...manifest, files: [] });
    expect(triage.isManifestStale(other, text)).toBe(true);
    expect(triage.isManifestStale(other.replace(/\n/g, '\r\n'), text)).toBe(true);
  });

  test('a missing manifest is stale', () => {
    expect(triage.isManifestStale('', triage.serializeManifest(manifest))).toBe(true);
  });

  // The script only acts when it is the entry point. If that test ever came out
  // false for the command CI runs, the check would print nothing and exit 0.
  test('run the way CI runs it, the check gives a verdict and an exit code to match', () => {
    const { spawnSync } = require('child_process');
    const ROOT = join(__dirname, '..', '..', '..');
    const run = spawnSync(process.execPath, ['scripts/triage-vitest-pool.mjs', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const said = `${run.stdout}${run.stderr}`;
    expect(said).toMatch(/vitest-pool-triage\.json is (up to date|stale)/);
    expect(run.status).toBe(said.includes('is up to date') ? 0 : 1);
  });

  // The pre-commit hook runs prettier over every staged *.json. The check is a
  // byte compare with the script's own output, so the script is the formatter
  // for this file, as it is for the other generated files in .prettierignore.
  test('the pre-commit formatter is told to leave the manifest alone', () => {
    const { readFileSync } = require('fs');
    const ROOT = join(__dirname, '..', '..', '..');
    const ignored = readFileSync(join(ROOT, '.prettierignore'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(ignored).toContain('docs/testing/vitest-pool-triage.json');
  });
});
