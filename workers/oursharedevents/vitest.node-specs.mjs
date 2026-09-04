// ─────────────────────────────────────────────────────────────────────────────
// vitest.node-specs.mjs — the single source of truth for which worker specs run
// in the NODE project (OSE-946). The node project INCLUDES this list; the
// workers project EXCLUDES it. One list, imported by both configs, guarantees
// every spec runs in exactly one project — no double-run, no silent drop.
//
// MIGRATION DISCIPLINE (OSE-946 child 3, see docs/testing/vitest-pool-triage.md):
// specs move here ONE assertion-reviewed batch at a time, derived from the triage
// manifest's node-clean bucket and RUN GREEN in the node project before landing.
// Never add by name/intuition and never widen to a glob — a spec that only looks
// portable file-level can still bind to the runtime and go green while no longer
// testing what it was written for (`tier-equity-sort.spec.ts` reads as pure sort
// logic but seeds D1 + hits SELF.fetch; the manifest correctly buckets it
// workerd and a node run fails at its `cloudflare:test` import).
// ─────────────────────────────────────────────────────────────────────────────

// Batch 1 — pure-logic units (import a src/ module, assert its output; no DOM,
// no axe, no cloudflare:test, no fs). Proven green in the node project.
export const NODE_SPECS = [
  // Batch 1
  'tests/count-floor.spec.ts',
  'tests/event-price.spec.ts',
  'tests/event-phase.spec.ts',
  'tests/event-state.spec.ts',
  'tests/report-depth.spec.ts',
  // Batch 2 — pure-logic units, proven green in the node project.
  // NOTE: briefing.spec.ts was a candidate here but transitively imports
  // src/templates/public.html — the workers pool bundles .html as a Text module,
  // plain node/vite cannot. It (and the poster/sponsor/display/pdf template-render
  // specs) can move only once the node project handles .html imports (a separate,
  // verified child-3 step). The run caught it; do not re-add without that support.
  'tests/geo.spec.ts',
  'tests/phase-cache.spec.ts',
  'tests/ncr-pipeline.spec.ts',
  'tests/schema-guard.spec.ts',
  'tests/demo-registry.spec.ts',
  'tests/demo-ci-gate.spec.ts',
  'tests/corridor-map.spec.ts',
];
