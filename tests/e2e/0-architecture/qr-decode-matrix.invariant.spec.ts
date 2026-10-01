/**
 * INVARIANT: the QR decode matrix stays a live gate (QR Path to Done, rung 4 — OSE-1439)
 *
 * WHY
 * ─────────────────────────────────────────────────────────────────────────────
 * OSE-1127 / OSE-1128: every poster QR was unscannable while the whole suite was
 * green. The encoder had seven independent defects; each looked right on
 * inspection, and the only thing that found them was decoding real output with
 * jsQR — `workers/oursharedevents/tests/qr-roundtrip.spec.ts`. A poster that does
 * not scan is discovered by a volunteer at the venue, not by CI.
 *
 * That spec is therefore the one thing standing between an encoder change and an
 * unscannable poster. Nothing stopped it being deleted, `.skip`-ped, moved out of
 * the pool CI runs, or having its L/M/Q/H × v1–v7 sweep quietly narrowed (the
 * sweep WAS narrowed once, legitimately, while OSE-1128 was open — the same edit
 * done carelessly would hide the next regression). This is a META-GATE in the
 * `deprecation-lock` pattern (see this directory's README): it does not decode
 * anything itself; it asserts the decoder gate exists, is unweakened, and runs.
 *
 * Subject-naming on purpose: the invariant is about ONE artifact (the decode
 * spec), so naming it is correct — a property scan would have nothing to scan.
 *
 * WHAT FAILS THIS
 * ─────────────────────────────────────────────────────────────────────────────
 *   - the spec is deleted, or stops decoding with jsQR / stops reading the
 *     poster-bundle the poster page renders
 *   - any test in it is skipped, focused, todo'd or marked expected-to-fail
 *   - any (EC level, payload length) case in the locked sweep is removed, or the
 *     sweep stops reaching symbol version 7 at levels L and M
 *   - the spec is moved into the node project (it needs the workers pool) or
 *     excluded from the workers project
 *   - CI stops running the worker suite (`npm test`) in the T0 `worker-d1-schema`
 *     section, or splits it with `--shard` into anything other than exactly
 *     1/N..N/N, or `jsqr` stops being installed (root package.json; the worker
 *     resolves it from the root node_modules)
 *   - the mutation catalog drops an encoder mutant that this spec is the killer of
 *
 * Widening the sweep is always allowed. Narrowing it is a decision: change
 * LOCKED_SWEEP below in the same PR, with the reason, where review sees it.
 */

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import picomatch from 'picomatch';
import yaml from 'js-yaml';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER = join(REPO_ROOT, 'workers', 'oursharedevents');
const DECODE_SPEC_REL = 'tests/qr-roundtrip.spec.ts';
const DECODE_SPEC = join(WORKER, DECODE_SPEC_REL);
const NODE_SPECS = join(WORKER, 'vitest.node-specs.mjs');
const WORKERS_CONFIG = join(WORKER, 'vitest.workers.config.mts');
const ROOT_VITEST_CONFIG = join(WORKER, 'vitest.config.mts');
const WORKER_PKG = join(WORKER, 'package.json');
const ROOT_PKG = join(REPO_ROOT, 'package.json');
const MUTATION_CATALOG = join(WORKER, 'scripts', 'mutate.mjs');
const VITEST_RETRY = join(REPO_ROOT, 'scripts', 'vitest-retry.mjs');
const CI_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'oursharedevents-ci.yml');

type Level = 'L' | 'M' | 'Q' | 'H';

/** The sweep as locked by OSE-1128 (21 cases). Superset required; never subset. */
const LOCKED_SWEEP: Array<[Level, number]> = [
  ['L', 13],
  ['L', 30],
  ['L', 50],
  ['L', 90],
  ['L', 130],
  ['L', 150],
  ['M', 13],
  ['M', 30],
  ['M', 50],
  ['M', 70],
  ['M', 90],
  ['M', 110],
  ['Q', 13],
  ['Q', 30],
  ['Q', 50],
  ['Q', 60],
  ['Q', 70],
  ['H', 13],
  ['H', 30],
  ['H', 40],
  ['H', 55],
];

/**
 * ISO/IEC 18004 byte-mode capacity, versions 1–7. Written here independently of
 * src/lib/qr.ts on purpose: a meta-gate that borrowed the encoder's own table
 * would drift with it.
 */
const BYTE_CAPACITY: Record<Level, number[]> = {
  L: [17, 32, 53, 78, 106, 134, 154],
  M: [14, 26, 42, 62, 84, 106, 122],
  Q: [11, 20, 32, 46, 60, 74, 86],
  H: [7, 14, 24, 34, 44, 58, 64],
};

function versionFor(level: Level, bytes: number): number {
  const v = BYTE_CAPACITY[level].findIndex((cap) => bytes <= cap);
  return v === -1 ? Infinity : v + 1;
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Source with every comment removed, so a shape assertion is satisfied by code
 * and never by a comment — a header that names `/poster-bundle`, or an inline
 * `x = 0; // SELF.fetch(...)` left behind after the real call was deleted.
 *
 * A small lexer rather than a regex: it tracks string, template (with `${}`
 * nesting) and regex literals, so `//` inside `'https://…'` or a regex is code,
 * not a comment. No parser dependency: the T0 shard runs this with root deps only.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let lastSignificant = ''; // last non-space code char, for regex-vs-divide
  const braceStack: number[] = []; // brace depth at each open `${`
  let depth = 0;
  const regexMayFollow = () =>
    lastSignificant === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSignificant);
  const copyQuoted = (q: string) => {
    out += src[i++];
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') out += src[i++];
      out += src[i++];
    }
    out += src[i++] ?? '';
  };
  const copyTemplate = (): boolean => {
    // returns true if we stopped at `${` (entering code), false at closing backtick
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        out += src[i++] + (src[i++] ?? '');
      } else if (c === '`') {
        out += src[i++];
        return false;
      } else if (c === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        braceStack.push(depth);
        depth++;
        return true;
      } else {
        out += src[i++];
      }
    }
    return false;
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"') {
      copyQuoted(c);
      lastSignificant = c;
    } else if (c === '`') {
      out += src[i++];
      copyTemplate();
      lastSignificant = '`';
    } else if (c === '/' && regexMayFollow()) {
      out += src[i++];
      let inClass = false;
      while (i < src.length && (inClass || src[i] !== '/')) {
        if (src[i] === '\\') out += src[i++];
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        out += src[i++] ?? '';
      }
      out += src[i++] ?? '';
      while (i < src.length && /[a-z]/i.test(src[i])) out += src[i++];
      lastSignificant = '/';
    } else if (c === '{') {
      depth++;
      out += src[i++];
      lastSignificant = c;
    } else if (c === '}') {
      depth--;
      out += src[i++];
      if (braceStack.length && braceStack[braceStack.length - 1] === depth) {
        braceStack.pop();
        copyTemplate();
        lastSignificant = '`';
      } else {
        lastSignificant = c;
      }
    } else {
      out += src[i++];
      if (!/\s/.test(c)) lastSignificant = /[\w$)\]]/.test(c) ? 'w' : c;
    }
  }
  return out;
}

function code(path: string): string {
  return stripComments(read(path));
}

/** String literals in a config array, plus `...NODE_SPECS` expanded. */
async function arrayPatterns(body: string): Promise<string[]> {
  const literals = [...body.matchAll(/(['"`])((?:(?!\1).)+)\1/g)].map((m) => m[2]);
  const spreads = [...body.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const unknown = spreads.filter((name) => name !== 'NODE_SPECS');
  expect(
    unknown,
    `the workers exclude list spreads ${unknown.join(', ')}, which this gate cannot resolve — extend the gate`
  ).toEqual([]);
  if (spreads.includes('NODE_SPECS')) literals.push(...(await nodeSpecs()));
  return literals;
}

async function nodeSpecs(): Promise<string[]> {
  const mod = (await import(pathToFileURL(NODE_SPECS).href)) as { NODE_SPECS: string[] };
  expect(Array.isArray(mod.NODE_SPECS), 'vitest.node-specs.mjs must export NODE_SPECS').toBe(true);
  return mod.NODE_SPECS;
}

/** The (level, length) pairs inside the spec's `test.each([...])` sweep. */
function parseSweep(src: string): Array<[Level, number]> {
  const block = src.match(/test\.each\(\s*\[([\s\S]*?)\]\s*as\s+Array/);
  if (!block) return [];
  return [...block[1].matchAll(/\[\s*'([LMQH])'\s*,\s*(\d+)\s*\]/g)].map(
    (m) => [m[1] as Level, Number(m[2])] as [Level, number]
  );
}

test.describe('QR decode matrix — the decoder gate cannot be weakened silently (OSE-1439)', () => {
  test('OSE-1439 | the decode spec exists', () => {
    expect(
      existsSync(DECODE_SPEC),
      `${DECODE_SPEC_REL} must exist — it is the only test that proves a phone can read a poster QR (OSE-1127/1128)`
    ).toBe(true);
  });

  test('OSE-1439 | it decodes real encoder output with jsQR, through the poster-bundle', () => {
    const src = code(DECODE_SPEC);
    expect(src, 'must import the jsQR decoder').toMatch(/import\s+jsQR\s+from\s+'jsqr'/);
    expect(src, 'must call jsQR on pixels').toMatch(/jsQR\(/);
    expect(src, 'must exercise the real encoder').toMatch(
      /import\s*\{[^}]*generateQrCode[^}]*\}\s*from\s*'\.\.\/src\/lib\/qr'/
    );
    expect(src, 'must fetch the bundle the poster page renders (a comment does not count)').toMatch(
      /SELF\.fetch\(\s*`[^`]*\/poster-bundle`/
    );
    expect(
      src,
      'the sweep must assert the decoded string EQUALS the encoded URL, not merely that something decoded'
    ).toMatch(/expect\(decodeQr\(uri\)[^)]*\)\.toBe\(url\)/);
    expect(
      src,
      'the sweep must decode what the real encoder produced: `const uri = generateQrCode(url, ...)`'
    ).toMatch(/const\s+uri\s*=\s*generateQrCode\(\s*url\s*,/);
  });

  test('OSE-1439 | nothing in it is skipped, focused, todo or expected-to-fail', () => {
    const src = code(DECODE_SPEC);
    const weakeners = src.match(
      // Any receiver, dot or bracket: an alias (`const s = describe; s.skip(...)`)
      // must not get past. The decode spec has no legitimate use of these names.
      /\.\s*(?:skip|only|todo|fails|skipIf|runIf)\b|\[\s*(['"`])(?:skip|only|todo|fails|skipIf|runIf)\1\s*\]|\bx(?:it|test|describe)\s*\(/g
    );
    expect(
      weakeners ?? [],
      `${DECODE_SPEC_REL} contains test modifiers that stop it gating: ${(weakeners ?? []).join(', ')}`
    ).toEqual([]);
  });

  test('OSE-1439 | the sweep still contains every locked (level, length) case', () => {
    const sweep = parseSweep(code(DECODE_SPEC));
    expect(sweep.length, 'could not find the test.each sweep in the decode spec').toBeGreaterThan(
      0
    );
    const have = new Set(sweep.map(([l, n]) => `${l}:${n}`));
    const missing = LOCKED_SWEEP.filter(([l, n]) => !have.has(`${l}:${n}`)).map(
      ([l, n]) => `${l}@${n}B`
    );
    expect(
      missing,
      `the decode sweep was narrowed — these locked cases are gone: ${missing.join(', ')}. ` +
        'Narrowing is a decision: change LOCKED_SWEEP in this gate in the same PR, with the reason.'
    ).toEqual([]);
  });

  test('OSE-1439 | every EC level is swept, and L and M span versions 1 to 7', () => {
    const sweep = parseSweep(code(DECODE_SPEC));
    for (const level of ['L', 'M', 'Q', 'H'] as Level[]) {
      const versions = sweep.filter(([l]) => l === level).map(([l, n]) => versionFor(l, n));
      expect(versions.length, `EC level ${level} is not swept at all`).toBeGreaterThan(0);
      expect(versions.every(Number.isFinite), `a ${level} case exceeds v7 capacity`).toBe(true);
    }
    // A 13-byte URL is v1 at L/M but already v2 at Q/H, so the ends of the
    // range are asserted where the locked sweep actually reaches them.
    for (const level of ['L', 'M'] as Level[]) {
      const low = Math.min(...sweep.filter(([l]) => l === level).map(([l, n]) => versionFor(l, n)));
      expect(low, `EC level ${level} no longer covers version 1`).toBe(1);
      const top = Math.max(...sweep.filter(([l]) => l === level).map(([l, n]) => versionFor(l, n)));
      expect(
        top,
        `EC level ${level} no longer reaches version 7 (where version info is mandatory)`
      ).toBe(7);
    }
  });

  test('OSE-1439 | it runs in the workers pool, which CI runs', async () => {
    // Patterns are glob-matched, not substring-matched: `tests/qr-*.spec.ts` in
    // an exclude list drops the decode spec as surely as its exact name does.
    const matches = (patterns: string[]) =>
      patterns.filter((p) => picomatch(p, { dot: true })(DECODE_SPEC_REL));

    const inNode = matches(await nodeSpecs());
    expect(
      inNode,
      `the node project selects the decode spec (${inNode.join(', ')}) — it needs SELF.fetch (cloudflare:test), so it must stay in the workers pool`
    ).toEqual([]);

    // Comment-stripped, so a commented-out include or exclude does not count.
    // `npm test` is `vitest run`, which loads vitest.config.mts; the workers
    // project only runs if that root config still lists it.
    const root = code(ROOT_VITEST_CONFIG);
    const projects = root.match(/projects:\s*\[([^\]]*)\]/);
    expect(projects, 'vitest.config.mts must declare its projects').not.toBeNull();
    expect(
      [...projects![1].matchAll(/(['"`])((?:(?!\1).)+)\1/g)].map((m) => m[2].replace(/^\.\//, '')),
      'vitest.config.mts must load the workers project, where the decode spec runs'
    ).toContain('vitest.workers.config.mts');

    const cfg = code(WORKERS_CONFIG);
    const include = cfg.match(/include:\s*\[([^\]]*)\]/);
    const exclude = cfg.match(/exclude:\s*\[([^\]]*)\]/);
    expect(include, 'could not read the workers project include list').not.toBeNull();
    expect(exclude, 'could not read the workers project exclude list').not.toBeNull();
    expect(
      matches(await arrayPatterns(include![1])).length,
      'no workers-project include pattern selects the decode spec'
    ).toBeGreaterThan(0);
    const excludedBy = matches(await arrayPatterns(exclude![1]));
    expect(
      excludedBy,
      `the workers project excludes the decode spec via ${excludedBy.join(', ')}`
    ).toEqual([]);
  });

  test('OSE-1439 | CI runs the worker suite on every PR, and jsqr is installed', () => {
    const pkg = JSON.parse(read(WORKER_PKG)) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.scripts?.test, 'worker `npm test` must run the vitest projects root').toBe(
      'vitest run'
    );
    const deps = (p: typeof pkg) => ({ ...p.dependencies, ...p.devDependencies });
    const rootPkg = JSON.parse(read(ROOT_PKG)) as typeof pkg;
    expect(
      deps(pkg).jsqr ?? deps(rootPkg).jsqr,
      'jsqr must be installed (root or worker package.json) — without it the decode spec cannot load'
    ).toBeTruthy();

    // Parsed, not pattern-matched: a YAML comment or a disabled copy of the
    // shard must not satisfy this.
    const wf = yaml.load(read(CI_WORKFLOW)) as {
      jobs?: Record<
        string,
        { strategy?: { matrix?: { include?: Array<Record<string, string>> } } }
      >;
    };
    // Scoped to the job that runs T0 test sections, and its executing step is
    // locked too: a matrix value nobody runs is not a gate.
    const job = (wf.jobs ?? {})['gate-tests-sub'] as
      | {
          'continue-on-error'?: unknown;
          if?: unknown;
          strategy?: { matrix?: { include?: Array<Record<string, string>> } };
          steps?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(
      job,
      'oursharedevents-ci.yml must have the gate-tests-sub job (T0 test sections)'
    ).toBeTruthy();
    expect(job!['continue-on-error'], 'gate-tests-sub must not be continue-on-error').toBeFalsy();
    expect(job!.if, 'gate-tests-sub must not be conditionally skipped').toBeUndefined();
    const runStep = (job!.steps ?? []).find((st) => st.name === 'Run T0 test section');
    expect(runStep, 'gate-tests-sub must have the "Run T0 test section" step').toBeTruthy();
    expect(runStep!.run, 'the T0 step must execute the matrix command').toBe(
      '${{ matrix.command }}'
    );
    expect(runStep!['working-directory'], 'the T0 step must run in the matrix workdir').toBe(
      '${{ matrix.workdir }}'
    );
    expect(runStep!['continue-on-error'], 'the T0 step must not be continue-on-error').toBeFalsy();
    expect(runStep!.if, 'the T0 step must not be conditional').toBeUndefined();
    const shards = (job!.strategy?.matrix?.include ?? []).filter(
      (entry) => entry.section === 'worker-d1-schema'
    );
    expect(
      shards.length,
      'the T0 worker-d1-schema section must exist in oursharedevents-ci.yml'
    ).toBeGreaterThan(0);
    // The whole command is locked, not a token in it: `echo npm test` must fail.
    // The only accepted wrapper is the repo's retry runner, which executes its
    // argv exactly as passed (checked below). The suite may be split across
    // runners with vitest's `--shard=i/N` and nothing after it: an extra path
    // or filter would narrow the run.
    const SUITE =
      /^(?:node \.\.\/\.\.\/scripts\/vitest-retry\.mjs )?npm test(?: -- --shard=(\d+)\/(\d+))?$/;
    const slices = shards.map((entry) => {
      expect(entry.workdir, 'every worker-d1-schema entry must run in the worker').toBe(
        'workers/oursharedevents'
      );
      const m = String(entry.command).trim().match(SUITE);
      expect(
        m,
        `the worker-d1-schema section must run the worker suite; it runs: ${entry.command}`
      ).not.toBeNull();
      return m![1] === undefined ? 'whole' : `${Number(m![1])}/${Number(m![2])}`;
    });
    if (slices.includes('whole')) {
      expect(slices, 'an unsharded worker suite must be the only worker-d1-schema entry').toEqual([
        'whole',
      ]);
    } else {
      // Sharded: exactly 1/N..N/N, each once, one N, so every spec file
      // (qr-roundtrip included) lands in exactly one runner. A missing 2/3, a
      // duplicated 1/3, or a /2 mixed with /3 each leave files unrun.
      const n = Number(slices[0].split('/')[1]);
      expect(n, 'a sharded worker suite needs at least 2 shards').toBeGreaterThanOrEqual(2);
      expect(
        [...slices].sort(),
        'worker-d1-schema shards must be exactly 1/N..N/N, each once'
      ).toEqual(Array.from({ length: n }, (_, k) => `${k + 1}/${n}`).sort());
    }
    if (shards.some((entry) => String(entry.command).includes('vitest-retry.mjs'))) {
      // Data flow, not two independent tokens: argv → commandLine → runOnce →
      // spawn(<that parameter>). `spawn('true', ...)` must fail.
      const runner = code(VITEST_RETRY);
      const argvVar = runner.match(/const\s+(\w+)\s*=\s*process\.argv\.slice\(2\)/);
      expect(
        argvVar,
        'vitest-retry.mjs must read its command from process.argv.slice(2)'
      ).not.toBeNull();
      expect(runner, 'vitest-retry.mjs must build commandLine from the argv it read').toMatch(
        new RegExp(`const\\s+commandLine\\s*=\\s*${argvVar![1]}\\b`)
      );
      expect(runner, 'vitest-retry.mjs must run commandLine').toMatch(
        /\brunOnce\(\s*commandLine\s*\)/
      );
      expect(runner, 'runOnce must spawn the command it was given, not a fixed one').toMatch(
        /function\s+runOnce\(\s*(\w+)\s*\)\s*\{[\s\S]*?\bspawn\(\s*\1\s*,/
      );
    }
  });

  test('OSE-1439 | the encoder mutants it kills stay in the mutation catalog', () => {
    const catalog = code(MUTATION_CATALOG);
    const qrMutants = [
      ...catalog.matchAll(/id:\s*'(qr-[a-z0-9-]+)'[^}]*specs:\s*\[[^\]]*qr-roundtrip\.spec\.ts/g),
    ].map((m) => m[1]);
    expect(
      qrMutants.length,
      `scripts/mutate.mjs lists ${qrMutants.length} encoder mutants killed by the decode spec; OSE-1128 locked 7`
    ).toBeGreaterThanOrEqual(7);
  });
});
