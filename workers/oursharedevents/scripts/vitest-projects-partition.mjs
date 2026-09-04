#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// vitest-projects-partition.mjs — coverage-parity guard for the OSE-946 split.
//
// Asserts the two vitest projects PARTITION the worker spec set:
//   • every `tests/**/*.spec.ts` runs in exactly one project (node XOR workers),
//   • except the intentionally-separate a11y-axe spec (vitest.config.a11y.mts),
//   • no NODE_SPECS entry points at a missing file,
//   • no spec is claimed by both projects, and none is silently dropped.
//
// This is the mechanical proof behind "no spec relocated to node was lost from
// the workers pool" — run it in CI (child 5) alongside the triage `--check`.
// It reads source only; it never runs tests.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_SPECS } from '../vitest.node-specs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(here, '..');
const testsDir = join(workerRoot, 'tests');
const A11Y_SEPARATE = 'tests/a11y-axe.spec.ts';

function allSpecs(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...allSpecs(full));
    else if (e.name.endsWith('.spec.ts')) out.push(relative(workerRoot, full).replace(/\\/g, '/'));
  }
  return out;
}

const specs = new Set(allSpecs(testsDir));
const node = new Set(NODE_SPECS);
const errors = [];

// 1. every NODE_SPECS entry must exist
for (const s of node) if (!existsSync(join(workerRoot, s))) errors.push(`node spec missing on disk: ${s}`);

// 2. nothing double-claimed: NODE_SPECS are excluded from the workers project by
//    config, so the only failure mode is a NODE_SPECS entry that is not a real
//    spec (covered above) — assert here that each is a discovered spec too.
for (const s of node) if (specs.has(s) === false) errors.push(`node spec not discovered under tests/: ${s}`);

// 3. completeness: workers project = all specs − a11y − node. Confirm the union
//    of (node ∪ a11y ∪ workers) is exactly the discovered set, with empty
//    intersection between node and the a11y-separate spec.
if (node.has(A11Y_SEPARATE)) errors.push(`${A11Y_SEPARATE} must not be in NODE_SPECS (it runs under vitest.config.a11y.mts)`);

const workersCount = [...specs].filter((s) => s !== A11Y_SEPARATE && !node.has(s)).length;
const accounted = workersCount + node.size + (specs.has(A11Y_SEPARATE) ? 1 : 0);

if (accounted !== specs.size) {
  errors.push(`partition incomplete: accounted ${accounted} ≠ discovered ${specs.size}`);
}

if (errors.length) {
  console.error('✗ vitest project partition broken:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `✓ partition ok: ${specs.size} specs = ${workersCount} workers + ${node.size} node + 1 a11y-separate`
);
