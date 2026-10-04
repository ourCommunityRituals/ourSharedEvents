#!/usr/bin/env node
/**
 * CI integrity ratchets (OSE-1606). Same pattern as .ocr-design-check.json.
 *
 * Counts that may only shrink, recorded in .ci-integrity-baseline.json:
 *   1. continue-on-error steps in .github/workflows (a failing step that cannot fail CI)
 *   2. unconditional skips: it/test/describe.skip|fixme('title', ...), xit/xtest/xdescribe
 *      (conditional skips, `test.skip(cond, ...)`, are counted and ratcheted separately)
 *   3. orphan specs: tests/e2e specs whose path no workflow names (they never run in CI)
 *
 * Rules: current > baseline -> fail (a new one was added).
 *        current < baseline -> fail (lower the baseline in the same change).
 *        --base-config <file> -> the baseline itself may not exceed the base branch's copy.
 *        --update -> rewrite the baseline from the tree (keeps existing reasons).
 *
 * Usage: node scripts/ci/ci-integrity-ratchets.mjs [--root .] [--base-config f] [--update]
 * Exports measure() / compare() for tests/integration/ci-integrity-ratchets.test.js.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILE = '.ci-integrity-baseline.json';
const SKIP_ROOTS = ['tests', 'workers/oursharedevents/tests', 'packages'];
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.wrangler', 'test-results']);
const TEST_FILE = /\.(spec|test)\.(js|mjs|cjs|ts|tsx)$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (root, p) => relative(root, p).split(sep).join('/');

function workflowFiles(root) {
  return walk(join(root, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
}

/** continue-on-error: true, per workflow file (comment lines never match). */
export function countContinueOnError(root) {
  const out = {};
  for (const f of workflowFiles(root)) {
    const n = readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .filter((l) =>
        /^\s*(-\s+)?continue-on-error:\s*(true|['"]true['"]|\$\{\{.*\}\})\s*(#.*)?$/.test(l)
      ).length;
    if (n) out[rel(root, f)] = n;
  }
  return out;
}

const SKIP_CALL =
  /\b(?:(?:it|test|describe)(?:\.(?:only|serial|parallel))*\.(?:skip|fixme)|xit|xtest|xdescribe)\s*\(\s*([^\s)]?)/g;

/** Skips per test file, split into declaration skips (title first) and conditional skips. */
export function countSkips(root) {
  const unconditional = {};
  const conditional = {};
  for (const r of SKIP_ROOTS) {
    for (const f of walk(join(root, r))) {
      if (!TEST_FILE.test(f)) continue;
      // This ratchet's own test carries skip patterns inside fixture strings.
      if (f.endsWith('ci-integrity-ratchets.test.js')) continue;
      const text = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const m of text.matchAll(SKIP_CALL)) {
        const isDecl = /^['"`]$/.test(m[1]) || /\bx(?:it|test|describe)\s*\(/.test(m[0]);
        const target = isDecl ? unconditional : conditional;
        const k = rel(root, f);
        target[k] = (target[k] || 0) + 1;
      }
    }
  }
  return { unconditional, conditional };
}

/** tests/e2e specs that no workflow names (full path, directory prefix, or glob). */
export function findOrphanSpecs(root) {
  const wfText = workflowFiles(root)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const tokens = [...wfText.matchAll(/tests\/e2e\/[^\s'"`\\;)(,]+/g)].map((m) => m[0]);
  const matchers = tokens.map((t) => {
    if (t.endsWith('/')) return (p) => p.startsWith(t);
    if (t.includes('*')) {
      const re = new RegExp(
        '^' +
          t
            .replace(/[.+?^${}()|[\]]/g, '\\$&')
            .replace(/\*\*/g, '\@@GLOB@@')
            .replace(/\*/g, '[^/]*')
            .replace(/\@@GLOB@@/g, '.*') +
          '$'
      );
      return (p) => re.test(p);
    }
    return (p) => p === t;
  });
  return walk(join(root, 'tests/e2e'))
    .filter((f) => /\.(spec|test)\.(js|ts)$/.test(f))
    .map((f) => rel(root, f))
    .filter((p) => !matchers.some((m) => m(p)))
    .sort();
}

export function measure(root) {
  const coe = countContinueOnError(root);
  const skips = countSkips(root);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return {
    continueOnError: { total: sum(coe), byFile: coe },
    skipsUnconditional: { total: sum(skips.unconditional), byFile: skips.unconditional },
    skipsConditional: { total: sum(skips.conditional), byFile: skips.conditional },
    orphanSpecs: { files: findOrphanSpecs(root) },
  };
}

export const KEYS = ['continueOnError', 'skipsUnconditional', 'skipsConditional', 'orphanSpecs'];
const count = (e, k) => (k === 'orphanSpecs' ? e[k].files.length : e[k].total);

/** Returns problem strings; empty means green. `baseline` is the committed file. */
export function compare(current, baseline, baseBaseline) {
  const problems = [];
  for (const k of KEYS) {
    const cur = count(current, k);
    const base = k === 'orphanSpecs' ? baseline[k].files.length : baseline[k].total;
    if (cur > base)
      problems.push(
        `${k}: ${cur} > baseline ${base} (a new one was added; remove it or fix the cause)`
      );
    if (cur < base)
      problems.push(
        `${k}: ${cur} < baseline ${base} (lower ${BASELINE_FILE} to ${cur} in this change so the gain is locked)`
      );
    if (baseBaseline) {
      const bb = k === 'orphanSpecs' ? baseBaseline[k].files.length : baseBaseline[k].total;
      if (base > bb)
        problems.push(`${k}: baseline raised to ${base} above the base branch's ${bb}`);
    }
    if (cur !== base) continue;
    // Equal totals can hide a swap (one fixed, one added): compare entries too.
    if (k === 'orphanSpecs') {
      const known = new Set(baseline[k].files.map((f) => f.path));
      for (const f of current[k].files)
        if (!known.has(f)) problems.push(`orphanSpecs: new orphan ${f}`);
      for (const f of known)
        if (!current[k].files.includes(f))
          problems.push(`orphanSpecs: ${f} is no longer an orphan; remove it from the baseline`);
    } else {
      for (const [f, n] of Object.entries(current[k].byFile)) {
        const b = baseline[k].byFile[f]?.count ?? 0;
        if (n !== b) problems.push(`${k}: ${f} has ${n}, baseline ${b}`);
      }
      for (const f of Object.keys(baseline[k].byFile)) {
        if (!(f in current[k].byFile))
          problems.push(`${k}: ${f} is clean now; remove it from the baseline`);
      }
    }
  }
  return problems;
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const root = resolve(arg('--root') || '.');
  const cur = measure(root);
  const basePath = join(root, BASELINE_FILE);
  const baseline = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
  if (argv.includes('--update')) {
    const next = {
      _comment:
        'CI integrity ratchet baseline (OSE-1606). Counts may only fall; every entry carries a reason.',
    };
    for (const k of KEYS) {
      if (k === 'orphanSpecs') {
        next[k] = {
          total: cur[k].files.length,
          files: cur[k].files.map((p) => ({
            path: p,
            reason:
              baseline?.[k].files.find((f) => f.path === p)?.reason ||
              'TODO: wire into a workflow or delete (OSE-1244)',
          })),
        };
      } else {
        next[k] = {
          total: cur[k].total,
          byFile: Object.fromEntries(
            Object.entries(cur[k].byFile).map(([f, n]) => [
              f,
              { count: n, reason: baseline?.[k].byFile[f]?.reason || 'TODO: state why' },
            ])
          ),
        };
      }
    }
    writeFileSync(basePath, JSON.stringify(next, null, 2) + '\n');
    console.log('baseline written');
    return;
  }
  if (!baseline) {
    console.error(`::error::${BASELINE_FILE} missing`);
    process.exit(1);
  }
  const bc = arg('--base-config');
  const problems = compare(cur, baseline, bc ? JSON.parse(readFileSync(bc, 'utf8')) : null);
  for (const p of problems) console.error(`::error::ci-integrity: ${p}`);
  if (problems.length) process.exit(1);
  console.log('ci-integrity ratchets ok', KEYS.map((k) => `${k}=${count(cur, k)}`).join(' '));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
