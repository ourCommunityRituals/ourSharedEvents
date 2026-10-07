#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// triage-vitest-pool.mjs — OSE-946 child 1 (the prerequisite).
//
// WHY. The worker vitest suite runs every spec under
// `workers/oursharedevents/tests/**/*.spec.ts` in ONE
// `@cloudflare/vitest-pool-workers` (miniflare/workerd) pool. Most of those
// specs genuinely exercise the runtime (SELF.fetch, env.DB, DO/KV/R2), but a
// large minority are pure-logic or static-source-shape checks that never needed
// the Worker — loading the pyramid's *base* into the *integration* runtime is
// what drives the OSE-696 teardown flake and forces maxWorkers:1. See the epic
// (OSE-946) for the full argument.
//
// WHAT. This script is the reproducible measurement behind the reshape: it
// classifies each worker spec into the cheapest runtime that still proves what
// the spec proves, and emits the evidence (which markers matched) so the call is
// auditable rather than asserted. It is intentionally a static classifier — it
// reads source, it does not run tests — so it is deterministic and safe to run
// in CI. Child 5 reuses it as the coverage-parity gate: the manifest is the
// contract that nothing was silently dropped when specs are relocated.
//
// BUCKETS.
//   workerd  — proven runtime coupling (a hard marker matched). Must stay in the
//              workers pool. Never a false "node-able".
//   node     — no `cloudflare:test` import at all: pure logic / pure Node. Runs
//              in the node project as-is.
//   review   — imports `cloudflare:test` for `env` only, with NO runtime marker.
//              Almost always a static-source or config-scalar gate that is
//              node-able once its source input is fed via fs instead of the
//              miniflare `env.*_JSON` binding — but that per-file relocation is
//              child 3, so here it is auto-suggested `node` and FLAGGED for human
//              confirmation (OSE-946 PO decision: auto-classify + flag review).
//
// USAGE.
//   node scripts/triage-vitest-pool.mjs            # write manifest + print summary
//   node scripts/triage-vitest-pool.mjs --check    # exit 1 if manifest is stale
//                                                   # (drift gate, T0 lint shard)
//
// SAME ON EVERY SYSTEM. The manifest is written on a developer machine (often
// Windows) and checked in CI (Linux), byte for byte, so nothing in it may follow
// the operating system: entries are sorted by their forward-slash path, never by
// the native one (`\` and `/` sort on opposite sides of digits and capitals);
// the file is written with LF; and `--check` reads the committed copy without
// its carriage returns, since a Windows checkout with autocrlf holds it as CRLF.
// Pinned by tests/unit/ci/vitest-pool-triage.test.js.
//
// The functions are exported and safe to import; the CLI runs only when this
// file is the entry point.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const TEST_ROOT = join(repoRoot, 'workers', 'oursharedevents', 'tests');
const MANIFEST_JSON = join(repoRoot, 'docs', 'testing', 'vitest-pool-triage.json');

// Hard runtime markers — presence proves the spec needs the workerd/miniflare
// runtime. `env.DB` / `env.FORMS_DB` are treated as hard even without a trailing
// method call: handing the D1 binding anywhere means real D1. Conservative by
// design — a marker in a comment or string can only over-classify toward
// workerd (safe: it stays in the pool it already runs in), never the reverse.
const RUNTIME_MARKERS = [
  /\bSELF\.fetch\b/,
  /\benv\.DB\b/,
  /\benv\.FORMS_DB\b/,
  /\benv\.RATE_LIMIT_KV\b/,
  /\benv\.UPLOADS_BUCKET\b/,
  /\brunInDurableObject\b/,
  /\brunDurableObjectAlarm\b/,
  /\bcreateExecutionContext\b/,
  /\bwaitOnExecutionContext\b/,
  /\bapplyD1Migrations\b/,
  /\bfetchMock\b/,
  /\bimportModule\b/,
];

const CFTEST_IMPORT = /from\s+['"]cloudflare:test['"]/;
const STATIC_ENV = /\benv\.TEST_[A-Z0-9_]+\b/; // bundled source/config JSON, fs-relocatable
const TEST_CASE = /\b(?:it|test)\s*(?:\.\w+)?\s*\(/g;

// Strip line + block comments so a marker mentioned in a WHY-comment does not
// count as runtime coupling. Strings are left intact (a marker inside a string
// literal is rare and only risks a safe over-classification to `review`).
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** A path as the manifest spells it: forward slashes on every system. */
export function toPosixPath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Spec paths in manifest order: forward slashes first, then a plain code-unit
 * sort. Sorting the native paths instead would order `ops\a` after `ops2` on
 * Windows and `ops/a` before it on Linux.
 */
export function sortSpecPaths(paths) {
  return paths.map(toPosixPath).sort();
}

/** One manifest row for a spec, from its repo-relative path and its source text. */
export function classifySource(file, source) {
  const rel = toPosixPath(file);
  const src = stripComments(source);
  const matched = RUNTIME_MARKERS.filter((re) => re.test(src)).map((re) =>
    // human-readable marker name: drop the \b anchors and regex backslashes,
    // keep the literal dots (so `env\.DB` reads as `env.DB`, not `envDB`).
    re.source.replace(/\\b/g, '').replace(/\\/g, '').replace(/[()]/g, '')
  );
  const importsCfTest = CFTEST_IMPORT.test(src);
  const usesStaticEnv = STATIC_ENV.test(src);
  const testCount = (src.match(TEST_CASE) || []).length;

  let bucket;
  let reason;
  if (matched.length > 0) {
    bucket = 'workerd';
    reason = `runtime marker(s): ${matched.join(', ')}`;
  } else if (!importsCfTest) {
    bucket = 'node';
    reason = 'no cloudflare:test import — pure logic / pure node';
  } else {
    // imports cloudflare:test for env only, no runtime marker
    bucket = 'node'; // auto-suggested (PO: auto-classify + flag review)
    reason = usesStaticEnv
      ? 'cloudflare:test used only for static env.TEST_*_JSON source read — fs-relocatable'
      : 'cloudflare:test imported for env only, no runtime marker';
  }
  const needsReview = bucket === 'node' && importsCfTest;
  return { file: rel, bucket, needsReview, reason, testCount };
}

/** The manifest for every `*.spec.ts` under `testRoot`, with paths relative to `root`. */
export function buildManifest(testRoot = TEST_ROOT, root = repoRoot) {
  const files = sortSpecPaths(walk(testRoot).map((full) => relative(root, full)));
  const rows = files.map((file) => classifySource(file, readFileSync(join(root, file), 'utf8')));
  const summary = {
    total: rows.length,
    totalTests: rows.reduce((n, r) => n + r.testCount, 0),
    workerd: rows.filter((r) => r.bucket === 'workerd').length,
    node: rows.filter((r) => r.bucket === 'node').length,
    needsReview: rows.filter((r) => r.needsReview).length,
  };
  return { generatedBy: 'scripts/triage-vitest-pool.mjs', summary, files: rows };
}

/** The manifest as it is written to disk: two-space JSON, LF line ends, one final newline. */
export function serializeManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * True when the committed manifest does not say what a fresh build says. Only
 * the content counts: carriage returns added by a Windows checkout are dropped
 * before the two are compared.
 */
export function isManifestStale(committedText, serialized) {
  return committedText.replace(/\r\n/g, '\n') !== serialized;
}

function main(argv) {
  const manifest = buildManifest();
  const serialized = serializeManifest(manifest);

  if (argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(MANIFEST_JSON, 'utf8');
    } catch {
      /* missing → stale */
    }
    if (isManifestStale(current, serialized)) {
      console.error(
        '✗ vitest-pool-triage.json is stale. Run `node scripts/triage-vitest-pool.mjs` and commit the result.'
      );
      return 1;
    }
    console.log('✓ vitest-pool-triage.json is up to date.');
    return 0;
  }

  writeFileSync(MANIFEST_JSON, serialized);
  const s = manifest.summary;
  console.log(`triage: ${s.total} specs, ${s.totalTests} test cases`);
  console.log(`  workerd (must stay in pool): ${s.workerd}`);
  console.log(
    `  node    (relocatable):       ${s.node}  (of which ${s.needsReview} flagged needs-review)`
  );
  console.log(`wrote ${toPosixPath(relative(repoRoot, MANIFEST_JSON))}`);
  return 0;
}

// The file-name test is the fallback for a path that reaches this file through a
// link, where the two URLs differ: a check that quietly did nothing would exit 0.
const entry = process.argv[1] || '';
const isMain =
  entry !== '' &&
  (import.meta.url === pathToFileURL(entry).href ||
    toPosixPath(entry).endsWith('scripts/triage-vitest-pool.mjs'));
if (isMain) process.exit(main(process.argv.slice(2)));
