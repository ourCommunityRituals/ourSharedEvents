#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename --
   This is a repo-local source census: every path it touches is one it derived
   itself by walking two hard-coded roots under the repository. There is no
   user-supplied input, so the non-literal-fs warnings are false positives here.
   Same rationale as tests/unit/security/post-execution-integrity.test.js. */
/**
 * Skip-guard census — OSE-852 (MINE-0) fix #2/#3.
 *
 * A suite that skips is not a suite that passes, but from the outside the two
 * look identical once nobody is counting. This emits the counts so a growth in
 * silent skips becomes an object that can go red (see
 * tests/unit/skip-guard-ratchet.test.js), rather than something rediscovered by
 * hand every few months with a different number each time.
 *
 * Classes, in descending order of how badly they lie:
 *   ifReturn      `if (...) return;` in a test body — the GAS failure mode. No
 *                 report entry at all: the test PASSES having asserted nothing.
 *   unannotated   `test.skip(cond)` with no reason — shows as skipped, but the
 *                 report cannot say why, so nobody can tell signal from rot.
 *   bare          `test.skip()` / `describe.skip(...)` — unconditional.
 *   annotated     `test.skip(cond, 'reason')` — the CORRECT form. Counted so the
 *                 conversion of the classes above is visible as movement, and so
 *                 a regression from annotated back to silent is caught.
 *   fixme         `test.fixme` — deliberately deferred, visible in the report.
 *
 * Usage: node scripts/skip-census.mjs [--json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOTS = ['tests', 'workers/oursharedevents/tests'];
const SPEC = /\.(spec|test)\.(js|ts|mjs|cjs)$/;

/**
 * The ratchet's own meta-test QUOTES skip syntax in its comments and failure
 * messages, so censusing it counts prose as production skips — the meter
 * measuring itself. Excluded by exact path, and only this path: an exclusion
 * list is precisely how a census grows a blind spot, so the meta-test asserts
 * this set stays at exactly one entry.
 */
export const CENSUS_EXCLUDE = new Set(['tests/unit/skip-guard-ratchet.test.js']);

const RE = {
  fixme: /\b(?:test|it)\.fixme\b/g,
  ifReturn: /^\s*if\s*\([^)]{0,160}\)\s*return\s*;?\s*$/,
};

/**
 * Extract each `test.skip(...)` argument list, balancing parentheses so calls
 * whose arguments wrap across lines are read whole. A line-bounded regex reads
 * every multiline call as argument-less and reports it as unannotated — which
 * is exactly backwards, since in this repo all 11 of them carry a reason.
 * Quote-aware so a `)` inside a reason string does not close the call early.
 */
function hasSecondArg(args) {
  // Split on the top-level comma only — a comma inside a nested call, array or
  // string is not an argument separator.
  let depth = 0, quote = null;
  for (let i = 0; i < args.length; i++) {
    const c = args[i], prev = args[i - 1];
    if (quote) { if (c === quote && prev !== '\\') quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return args.slice(i + 1).trim().length > 0;
  }
  return false;
}

function skipCallArgs(src) {
  const out = [];
  const re = /\btest\.skip\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1, quote = null, buf = '';
    for (; i < src.length && depth > 0; i++) {
      const c = src[i], prev = src[i - 1];
      if (quote) {
        if (c === quote && prev !== '\\') quote = null;
      } else if (c === "'" || c === '"' || c === '`') {
        quote = c;
      } else if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      buf += c;
    }
    out.push(buf);
  }
  return out;
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SPEC.test(e) && !CENSUS_EXCLUDE.has(p.split(sep).join('/'))) out.push(p);
  }
  return out;
}

export function census() {
  const totals = { ifReturn: 0, unannotated: 0, bare: 0, annotated: 0, fixme: 0 };
  const byFile = {};
  const files = ROOTS.flatMap((r) => walk(r));

  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    const f = { ifReturn: 0, unannotated: 0, bare: 0, annotated: 0, fixme: 0 };

    for (const arg of skipCallArgs(src)) {
      const a = arg.trim();
      // Annotated = a SECOND argument of any kind. It need not be a string
      // literal: `test.skip(!!s.skipReason, s.skipReason)` passes the reason
      // through a variable and reports it just as well. An earlier version of
      // this census accepted only literals and reported all six of those as
      // silent, which was wrong in the direction that manufactures work.
      if (hasSecondArg(a)) f.annotated++;
      // A lone string argument is an unconditional skip carrying a message.
      else if (/^[`'"]/.test(a)) f.bare++;
      // Empty args = imperative `test.skip()`.
      else if (a === '') f.bare++;
      // A condition and nothing else: skipped with no reason in the report.
      else f.unannotated++;
    }
    f.bare += (src.match(/\bdescribe\.skip\s*\(/g) ?? []).length;
    f.fixme = (src.match(RE.fixme) ?? []).length;
    for (const line of src.split('\n')) if (RE.ifReturn.test(line)) f.ifReturn++;

    for (const k of Object.keys(totals)) totals[k] += f[k];
    const n = f.ifReturn + f.unannotated + f.bare;
    if (n) byFile[p] = n;
  }
  return { totals, filesScanned: files.length, offenderFiles: Object.keys(byFile).length, byFile };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = census();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ totals: r.totals, filesScanned: r.filesScanned }, null, 2));
  } else {
    console.log(`spec/test files scanned: ${r.filesScanned}\n`);
    console.log(`  ${String(r.totals.ifReturn).padStart(5)}  if (...) return;      SILENT — passes having asserted nothing`);
    console.log(`  ${String(r.totals.unannotated).padStart(5)}  test.skip(cond)       skipped, no reason in the report`);
    console.log(`  ${String(r.totals.bare).padStart(5)}  bare skip/describe    unconditional`);
    console.log(`  ${String(r.totals.annotated).padStart(5)}  test.skip(cond,'..')  CORRECT form`);
    console.log(`  ${String(r.totals.fixme).padStart(5)}  test.fixme            deliberately deferred`);
    console.log(`\n  files carrying a silent construct: ${r.offenderFiles}`);
  }
}
