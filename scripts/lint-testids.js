#!/usr/bin/env node
/**
 * testid-drift lint (CLI) — author-time entry point for artifact-integrity #1.
 *
 * Prints every spec-referenced `data-testid` that is emitted nowhere in source
 * (dead / typo'd / aspirational selector), marking NEW drift vs the committed
 * baseline. Shares the ONE inventory with tests/unit/testid-drift.test.js (DRY).
 *
 *   node scripts/lint-testids.js            # report; exit 1 if NEW drift
 *   node scripts/lint-testids.js --update   # rewrite the baseline (triage tool)
 *
 * The baseline (tests/unit/fixtures/testid-drift-baseline.json) is the known
 * backlog — each entry is a spec to fix or a testid to implement. The gate
 * fails on anything NOT already baselined, so new stale selectors can't land.
 */

const fs = require('fs');
const path = require('path');
const { computeDrift } = require('../tests/_shared/testid-inventory.js');

const repoRoot = path.resolve(__dirname, '..');
const BASELINE = path.join(repoRoot, 'tests', 'unit', 'fixtures', 'testid-drift-baseline.json');

const drift = computeDrift(repoRoot);
const driftIds = drift.map((d) => d.testid);

if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(driftIds, null, 2) + '\n');
  console.log(
    `Baseline updated: ${driftIds.length} known-drift testids → ${path.relative(repoRoot, BASELINE)}`
  );
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE)
  ? new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')))
  : new Set();
const newDrift = drift.filter((d) => !baseline.has(d.testid));

for (const { testid, specs } of drift) {
  const tag = baseline.has(testid) ? 'baselined' : 'NEW';
  console.error(`[${tag}] ${testid}  <- ${specs.join(', ')}`);
}
console.error(
  `\n${drift.length} referenced testids emitted nowhere in source (${newDrift.length} NEW, ${drift.length - newDrift.length} baselined).`
);

if (newDrift.length > 0) {
  console.error(
    `\n✖ ${newDrift.length} NEW testid-drift. A spec references a data-testid the code never emits → the E2E fails, skips, or passes on a fallback (green ≠ true). Fix the selector, implement the element, or run \`node scripts/lint-testids.js --update\` if intentionally deferred.`
  );
  process.exit(1);
}
console.log(`✓ testid-drift clean — no new drift beyond the ${baseline.size}-entry baseline.`);
