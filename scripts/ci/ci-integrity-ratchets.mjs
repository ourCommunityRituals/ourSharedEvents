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
 * Token split (OSE-1695): progress away from the write-capable OCR_PROPAGATE_TOKEN. Six
 * more measurements from the shared enumerator scripts/ci/hub-token-wiring.mjs (the same
 * one tests/integration/adr008-wiring.test.js uses), each with an explicit good direction:
 *   UP-ONLY   readUsesOnNewSecret     read sites whose token names OCR_HUB_READ
 *   UP-ONLY   writeUsesOnNewSecret    the named write sites whose token names a write secret
 *   DOWN-ONLY bareOldTokenUses        bare secrets.OCR_PROPAGATE_TOKEN (baseline 0)
 *   DOWN-ONLY fallbackUses            `NEW || OCR_PROPAGATE_TOKEN` expressions (2: the write sites)
 *   DOWN-ONLY writeUsesOnWrongToken   write sites not on their decided token (notify-osm today)
 *   DOWN-ONLY unrecognizedTokenForms  token expressions in no recognized form, and read sites
 *                                     with no recognized read token (baseline 0)
 * Current must equal the baseline both ways, per file and per step name, so every move is
 * registered in the same change and a swap at equal totals is red.
 * --base-config: a down-only ceiling may not rise above the base branch's copy; an up-only
 * floor may not fall below it, except by exactly the number of `retired` entries this
 * change adds ({ file, step, reason, story }, one per deliberately deleted site). A key
 * absent from the base copy is new: its base-branch check is skipped (that key only).
 *
 * Usage: node scripts/ci/ci-integrity-ratchets.mjs [--root .] [--base-config f] [--update]
 * Exports measure() / compare() for tests/integration/ci-integrity-ratchets.test.js.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureTokenSplit, SCRIPT_TOKEN_ENV } from './hub-token-wiring.mjs';

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
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '@@GLOB@@')
            .replace(/\*/g, '[^/]*')
            .replace(/@@GLOB@@/g, '.*') +
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
    ...measureTokenSplit(root),
  };
}

export const KEYS = ['continueOnError', 'skipsUnconditional', 'skipsConditional', 'orphanSpecs'];
const count = (e, k) => (k === 'orphanSpecs' ? e[k].files.length : e[k].total);

// ── Token split (OSE-1695): directional ratchets ────────────────────────────
// Built from two lists so no quoted direction word is assigned to a key whose
// name the secret scanner reads as a credential name.
const UP_ONLY_KEYS = ['readUsesOnNewSecret', 'writeUsesOnNewSecret'];
const DOWN_ONLY_KEYS = [
  'bareOldTokenUses',
  'fallbackUses',
  'writeUsesOnWrongToken',
  'unrecognizedTokenForms',
];
export const TOKEN_KEYS = Object.fromEntries([
  ...UP_ONLY_KEYS.map((k) => [k, 'up']),
  ...DOWN_ONLY_KEYS.map((k) => [k, 'down']),
]);
const UPDATE_CMD = 'node scripts/ci/ci-integrity-ratchets.mjs --update';
const READ_FIX =
  `a hub-staging step sets env ${SCRIPT_TOKEN_ENV}: \${{ secrets.OCR_HUB_READ }} ` +
  '(the script reads that variable name, with no fallback); a hub / OCR-docs checkout sets ' +
  'with.token to the same expression';
export const TOKEN_HELP = {
  readUsesOnNewSecret: {
    what: 'read sites (hub staging steps, hub / OCR-docs checkouts) whose token names OCR_HUB_READ',
    reason:
      'Reads must name OCR_HUB_READ (OSE-1695): may only rise; a deleted read site needs a retired entry.',
    restore: READ_FIX,
  },
  writeUsesOnNewSecret: {
    what: 'the named write steps whose token names a write secret (OCR_AUTOMATION_WRITE / OCR_NOTIFY_OSM)',
    reason: 'Write sites must name a write secret, not only the old PAT (OSE-1695): may only rise.',
    restore:
      'set the step env GH_TOKEN to ${{ secrets.<WRITE_SECRET> || secrets.OCR_PROPAGATE_TOKEN }} ' +
      '(conformance: OCR_AUTOMATION_WRITE, notify-osm: OCR_NOTIFY_OSM); a renamed write step ' +
      'is a rename of WRITE_SITES in scripts/ci/hub-token-wiring.mjs',
  },
  bareOldTokenUses: {
    what: 'bare ${{ secrets.OCR_PROPAGATE_TOKEN }} references (the write-capable PAT, alone)',
    reason: 'No bare use of the write-capable PAT may exist (OSE-1695); stays 0.',
    fix: `${READ_FIX}. A new write use is an owner decision and gets its own token, not this one.`,
  },
  fallbackUses: {
    what: '`NEW || OCR_PROPAGATE_TOKEN` fallback expressions (PR #986), anywhere',
    reason:
      'Reads name OCR_HUB_READ alone; the only fallbacks left are the two write sites (conformance PR step, notify-osm), removed by OSE-1695. May only fall.',
    fix:
      'do not add a fallback: name the new secret alone (${{ secrets.OCR_HUB_READ }} for a read); ' +
      'the two write sites keep theirs until OSE-1695 removes them',
  },
  writeUsesOnWrongToken: {
    what: 'write sites not on their decided token (conformance: OCR_AUTOMATION_WRITE, notify-osm: OCR_NOTIFY_OSM)',
    reason:
      'Known violation: notify-osm uses OCR_AUTOMATION_WRITE instead of OCR_NOTIFY_OSM (OSE-1695); may only fall.',
    fix: 'point the write step at its own secret (see WRITE_SITES in scripts/ci/hub-token-wiring.mjs)',
  },
  unrecognizedTokenForms: {
    what: 'token expressions in no recognized form, and read sites with no recognized read token',
    reason:
      'Every token expression must be a recognized form and every read site must carry a read token (OSE-1695); stays 0.',
    fix:
      `use a recognized form, new secret FIRST (\`OLD || NEW\` always picks the write PAT). ${READ_FIX}. ` +
      'A composite action cannot read secrets: run the staging script from a workflow step',
  },
};

const idsOf = (entry) =>
  Object.entries(entry?.byFile || {}).flatMap(([f, e]) =>
    (e.steps || []).map((s) => `${f} :: ${s}`)
  );
/** Multiset difference a − b. */
function minus(a, b) {
  const left = new Map();
  for (const x of b) left.set(x, (left.get(x) || 0) + 1);
  return a.filter((x) => {
    const n = left.get(x) || 0;
    if (n) left.set(x, n - 1);
    return !n;
  });
}
const bullet = (xs) => xs.map((x) => `\n    - ${x}`).join('');
const retiredKey = (r) => `${r?.file} :: ${r?.step}`;

/** Problems for the token-split measurements. Prints names, ids and counts only, never values. */
export function compareTokenSplit(current, baseline, baseBaseline) {
  const problems = [];
  for (const e of current.tokenSplitParseErrors || [])
    problems.push(
      `token split: cannot parse ${e}. Fix the YAML; the gate cannot verify a file it cannot read.`
    );
  for (const [k, dir] of Object.entries(TOKEN_KEYS)) {
    const h = TOKEN_HELP[k];
    const cur = current[k];
    const base = baseline[k];
    if (!base) {
      problems.push(
        `${k}: missing from ${BASELINE_FILE}. Run \`${UPDATE_CMD}\` and commit the baseline (every reason must be a real one).`
      );
      continue;
    }
    const c = cur.total;
    const b = base.total;
    const curIds = idsOf(cur);
    const baseIds = idsOf(base);
    const added = minus(curIds, baseIds);
    const gone = minus(baseIds, curIds);
    const head = `${k} [${dir.toUpperCase()}-ONLY: ${h.what}] baseline ${b}, current ${c}`;
    const withWhy = (xs) => xs.map((x) => (cur.why?.[x] ? `${x}  (${cur.why[x]})` : x));
    if (dir === 'up') {
      if (gone.length || c < b)
        problems.push(
          `REGRESSION ${head}: went DOWN (bad; the good direction is UP). No longer counted:${bullet(gone.length ? gone : ['(the total fell)'])}\n` +
            `  If the site still exists it lost its token: ${h.restore}.\n` +
            `  If it was deleted on purpose, add one entry per deleted site to ${k}.retired in ${BASELINE_FILE}:\n` +
            `      { "file": "<workflow file>", "step": "<job> :: <step name>", "reason": "<why it was removed>", "story": "OSE-####" }\n` +
            `  then run \`${UPDATE_CMD}\` and commit the baseline.`
        );
      if (added.length || c > b)
        problems.push(
          `NOT REGISTERED ${head}: went UP (good), so raise the baseline in this change to lock it in. New:${bullet(added.length ? added : ['(the total rose)'])}\n` +
            `  Run \`${UPDATE_CMD}\`, give any new ${k}.byFile entry a real reason, and commit ${BASELINE_FILE}.`
        );
    } else {
      if (added.length || c > b)
        problems.push(
          `${head}: went UP (bad; the good direction is DOWN). New:${bullet(withWhy(added.length ? added : ['(the total rose)']))}\n` +
            `  Fix: ${h.fix}.\n  Do not raise the baseline.`
        );
      if (gone.length || c < b)
        problems.push(
          `${head}: went DOWN (good). Lock the gain in: lower the baseline to ${c} (run \`${UPDATE_CMD}\` and commit ${BASELINE_FILE}). Gone:${bullet(gone.length ? gone : ['(the total fell)'])}` +
            (k === 'writeUsesOnWrongToken' && c === 0
              ? '\n  At 0, also delete the KNOWN_WRONG_TOKEN line in tests/integration/adr008-wiring.test.js.'
              : '')
        );
    }
    const bbk = baseBaseline?.[k];
    if (!bbk) continue; // first introduction: the base branch has no floor or ceiling for this key
    if (dir === 'down' && b > bbk.total)
      problems.push(
        `${k} [DOWN-ONLY]: the committed ceiling ${b} is above the base branch's ${bbk.total}. The baseline may fall, never rise: restore it to ${bbk.total} in ${BASELINE_FILE} and fix the cause instead.`
      );
    if (dir === 'up') {
      const before = new Set((bbk.retired || []).map(retiredKey));
      const fresh = (base.retired || []).filter((r) => !before.has(retiredKey(r)));
      const bbIds = idsOf(bbk);
      let valid = 0; // only a valid retired entry lowers the floor
      fresh.forEach((r, i) => {
        const bad = [];
        if (!r || typeof r.file !== 'string' || typeof r.step !== 'string')
          bad.push('file and step');
        if (!r || typeof r.reason !== 'string' || r.reason.length < 15)
          bad.push('a reason of 15+ characters');
        if (!r || !/^OSE-\d+$/.test(String(r.story || ''))) bad.push('a story id like OSE-1234');
        if (bad.length) problems.push(`${k}.retired[new #${i + 1}] needs ${bad.join(', ')}.`);
        else if (!bbIds.includes(retiredKey(r)))
          problems.push(
            `${k}.retired: "${retiredKey(r)}" was not counted on the base branch, so it cannot be retired. Use the exact "<file>" and "<job> :: <step name>" from the base baseline.`
          );
        else if (curIds.includes(retiredKey(r)))
          problems.push(
            `${k}.retired: "${retiredKey(r)}" still exists and is counted; remove the retired entry.`
          );
        else valid += 1;
      });
      const floor = bbk.total - valid;
      if (b < floor)
        problems.push(
          `REGRESSION ${k} [UP-ONLY]: the committed floor ${b} is below the base branch's ${bbk.total}` +
            (valid ? ` minus ${valid} newly retired site(s) = ${floor}` : '') +
            `. The floor may rise, never fall. Restore the missing sites, or add one ${k}.retired entry per deliberately deleted site ({ file, step, reason, story }).`
        );
    }
  }
  return problems;
}

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
  problems.push(...compareTokenSplit(current, baseline, baseBaseline));
  return problems;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const root = resolve(arg('--root') || '.');
  const cur = measure(root);
  const basePath = join(root, BASELINE_FILE);
  const baseline = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
  if (argv.includes('--update')) {
    const next = {
      _comment:
        'CI integrity ratchet baseline (OSE-1606). Each count may only move in its good direction (most may only fall; the token-split keys say theirs in `direction`, OSE-1695); every entry carries a reason.',
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
    for (const [k, dir] of Object.entries(TOKEN_KEYS)) {
      const old = baseline?.[k];
      next[k] = {
        direction: dir,
        reason: old?.reason || TOKEN_HELP[k].reason,
        total: cur[k].total,
        byFile: Object.fromEntries(
          Object.entries(cur[k].byFile).map(([f, e]) => [
            f,
            {
              count: e.count,
              steps: e.steps,
              reason: old?.byFile?.[f]?.reason || 'TODO: state why',
            },
          ])
        ),
      };
      if (dir === 'up') next[k].retired = old?.retired || [];
    }
    let text = JSON.stringify(next, null, 2) + '\n';
    // Write it the way the pre-commit hook (lint-staged: prettier --write) would, so
    // `--update` and a commit never fight over the format of the steps arrays.
    try {
      const prettier = await import('prettier');
      const opts = (await prettier.resolveConfig(basePath)) || {};
      text = await prettier.format(text, { ...opts, filepath: basePath });
    } catch {
      // prettier unavailable: the plain JSON is still a valid baseline
    }
    writeFileSync(basePath, text);
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
  console.log(
    'ci-integrity ratchets ok',
    [
      ...KEYS.map((k) => `${k}=${count(cur, k)}`),
      ...Object.entries(TOKEN_KEYS).map(([k, d]) => `${k}=${cur[k].total}(${d})`),
    ].join(' ')
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
