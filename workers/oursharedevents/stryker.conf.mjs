// @ts-check
//
// OSE-1186 G1 — mutation testing (StrykerJS). The "teeth-check" on the test
// pyramid: a surviving mutant in invariant-enforcing code = the pyramid defending
// that invariant is HOLLOW (green with no teeth) — the gap the integrity guards
// can't see (they catch *skipped*, not *hollow*).
//
// CONSTITUTION-FIRST TARGETS. Mutation targets are chosen by the architectural
// invariant register (OCR-docs `architectural-invariants.yaml`), not by
// convenience. Slice 1 covers the two most covenant-critical numeric/omission
// guards, both pure-logic so mutation runs on the FAST node vitest project
// (off the workerd pool, which is too slow per-mutant + Windows-incompatible):
//
//   • src/lib/count-floor.ts   → Invariant #8 (K-anon floor, K>=5). A survived
//     mutant here means a sub-K count could publish — the covenant's numeric guard.
//   • src/lib/report-depth.ts  → Invariant #5 (tier equity / depth omission).
//     A survived mutant means a paid section could leak to a lower depth.
//
// Both modules are covered by node-project unit specs (count-floor.spec.ts,
// report-depth.spec.ts — in vitest.node-specs.mjs), so the node runner exercises
// their assertions directly.
//
// Run: `npm run test:mutation` (needs the one-time devDep install:
//   npm install -D @stryker-mutator/core @stryker-mutator/vitest-runner).
// CI wiring (nightly + workflow_dispatch) follows once the baseline score is known.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: {
    // Only the fast Node project — the covenant guards are pure logic; keep the
    // workerd pool out of the per-mutant loop.
    configFile: 'vitest.node.config.mts',
  },
  mutate: ['src/lib/count-floor.ts', 'src/lib/report-depth.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  // Covenant guards must be near-airtight. Break the run below 90% so a hollow
  // spot in an invariant-enforcing module fails loudly, not quietly. (Tune once
  // the first real baseline is measured.)
  thresholds: { high: 95, low: 90, break: 90 },
};
