/**
 * testid inventory — artifact-integrity checker #1 (SDET standard, from OSE-1005).
 *
 * PROBLEM: a Playwright spec can reference a `data-testid` the code never
 * emits (typo, renamed element, aspirational UI). The spec then fails, is
 * skipped, or — worst — passes via a fallback selector / soft assertion. Either
 * way it's "green ≠ true": the exact class behind OSE-1003 roots 1 & 3 (a
 * `checkin-button` selector when the element is `checkin-submit`). This is
 * invisible until a 14-minute live E2E runs.
 *
 * ORACLE: cross-reference the testids REFERENCED by specs against the testids
 * PRESENT (emitted) in source — statically, in milliseconds. A referenced
 * testid with no backing anywhere is "drift".
 *
 * PRECISION over recall (this backs a CI gate): "present" = the testid appears
 * as ANY quoted literal in worker/packages source (or matches an emitted
 * dynamic `data-testid="prefix-${…}"` prefix). That is deliberately permissive
 * — better to miss a subtle drift than to false-fail on a real element — yet
 * it still surfaces every testid that exists NOWHERE in source.
 *
 * Consumed by tests/unit/testid-drift.test.js (baselined CI gate) and
 * scripts/lint-testids.js (author-time CLI) — one implementation (DRY).
 */

const fs = require('fs');
const path = require('path');

function walk(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full, exts, acc);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Source files that emit testids: worker surfaces + in-repo packages + the
 * shared UI package. @ocr/ui is no longer in this repo (ADR-008 Phase 0): it is
 * the hub's packages/ui, staged beside the checkout at ../packages/ui from the
 * commit pinned in .ocr-hub-ref (scripts/ci-stage-ocr-workspace.sh).
 */
function sourceFiles(repoRoot) {
  return [
    ...walk(path.join(repoRoot, 'workers', 'oursharedevents', 'src'), ['.ts', '.html']),
    ...walk(path.join(repoRoot, 'packages'), ['.ts', '.tsx']),
    ...walk(path.join(repoRoot, '..', 'packages', 'ui', 'src'), ['.ts', '.tsx']),
  ];
}

/** Spec files that reference testids. */
function specFiles(repoRoot) {
  return [
    ...walk(path.join(repoRoot, 'tests', 'e2e'), ['.spec.ts', '.spec.js']),
    ...walk(path.join(repoRoot, 'tests', 'ui'), ['.spec.ts', '.spec.js']),
  ];
}

/**
 * PRESENT testids: `{ literals: Set<string>, prefixes: string[] }`.
 * literals — every quoted `'x'` / `"x"` / `` `x` `` token that looks like a
 *   testid (kebab-case, ≥3 chars). prefixes — literal stems of dynamic
 *   `data-testid="stem-${…}"` / `data-testid="stem-' + …` emitters.
 */
function collectPresent(repoRoot) {
  const literals = new Set();
  const prefixes = [];
  for (const file of sourceFiles(repoRoot)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/['"`]([a-z][a-z0-9-]{2,})['"`]/g)) literals.add(m[1]);
    for (const m of text.matchAll(/data-testid=["'`]?([a-z0-9-]*?)(?:\$\{|["'`]\s*\+)/g)) {
      if (m[1] && m[1].length >= 3) prefixes.push(m[1]);
    }
  }
  return { literals, prefixes };
}

/** REFERENCED testids: `Map<testid, string[]>` (value = spec basenames). */
function collectReferenced(repoRoot) {
  const referenced = new Map();
  for (const file of specFiles(repoRoot)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const text = fs.readFileSync(file, 'utf8');
    const re = /\[data-testid="([^"${}]*)"\]|getByTestId\(['"`]([^'"`${}]*)['"`]\)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const id = m[1] || m[2];
      if (!id) continue;
      if (!referenced.has(id)) referenced.set(id, new Set());
      referenced.get(id).add(path.basename(file));
    }
  }
  return referenced;
}

/**
 * DRIFT: referenced testids present nowhere in source (not a literal, not a
 * dynamic prefix). Returns `[{ testid, specs: string[] }]` sorted by testid.
 */
function computeDrift(repoRoot) {
  const { literals, prefixes } = collectPresent(repoRoot);
  const referenced = collectReferenced(repoRoot);
  const drift = [];
  for (const [testid, specs] of referenced) {
    if (literals.has(testid)) continue;
    if (prefixes.some((p) => testid.startsWith(p))) continue;
    drift.push({ testid, specs: [...specs].sort() });
  }
  return drift.sort((a, b) => a.testid.localeCompare(b.testid));
}

module.exports = { computeDrift, collectPresent, collectReferenced, sourceFiles, specFiles };
