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
 *     shard, or `jsqr` stops being installed (root package.json; the worker
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

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER = join(REPO_ROOT, 'workers', 'oursharedevents');
const DECODE_SPEC_REL = 'tests/qr-roundtrip.spec.ts';
const DECODE_SPEC = join(WORKER, DECODE_SPEC_REL);
const NODE_SPECS = join(WORKER, 'vitest.node-specs.mjs');
const WORKERS_CONFIG = join(WORKER, 'vitest.workers.config.mts');
const WORKER_PKG = join(WORKER, 'package.json');
const ROOT_PKG = join(REPO_ROOT, 'package.json');
const MUTATION_CATALOG = join(WORKER, 'scripts', 'mutate.mjs');
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
 * Source with comments removed, so a shape assertion is satisfied by code and
 * never by the spec's own explanatory header (which names `/poster-bundle`,
 * `jsQR` and the rest). Only whole-line `//` comments are dropped: a `//` inside
 * a string (`https://…`) must survive.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** String literals in a config array, plus `...NODE_SPECS` expanded. */
async function arrayPatterns(body: string): Promise<string[]> {
  const literals = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
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
  });

  test('OSE-1439 | nothing in it is skipped, focused, todo or expected-to-fail', () => {
    const src = code(DECODE_SPEC);
    const weakeners = src.match(
      /\b(?:test|it|describe)\s*\.\s*(?:skip|only|todo|fails|skipIf|runIf|concurrent\.skip)\b|\bx(?:it|test|describe)\s*\(/g
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

    const cfg = read(WORKERS_CONFIG);
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

    const wf = read(CI_WORKFLOW);
    const shard = wf.match(
      /- section: worker-d1-schema\s+workdir: workers\/oursharedevents\s+command: ([^\n]+)/
    );
    expect(
      shard,
      'the T0 worker-d1-schema shard must exist in oursharedevents-ci.yml'
    ).not.toBeNull();
    expect(shard![1], 'the worker-d1-schema shard must run `npm test`').toMatch(/npm test/);
  });

  test('OSE-1439 | the encoder mutants it kills stay in the mutation catalog', () => {
    const catalog = read(MUTATION_CATALOG);
    const qrMutants = [
      ...catalog.matchAll(/id:\s*'(qr-[a-z0-9-]+)'[^}]*specs:\s*\[[^\]]*qr-roundtrip\.spec\.ts/g),
    ].map((m) => m[1]);
    expect(
      qrMutants.length,
      `scripts/mutate.mjs lists ${qrMutants.length} encoder mutants killed by the decode spec; OSE-1128 locked 7`
    ).toBeGreaterThanOrEqual(7);
  });
});
