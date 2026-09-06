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
export const NODE_SPECS = [
// Batch 1 — pure-logic units (import a src/ module, assert its output; no DOM,
// no axe, no cloudflare:test, no fs). Proven green in the node project.
  'tests/count-floor.spec.ts',
  'tests/event-price.spec.ts',
  'tests/event-phase.spec.ts',
  'tests/event-state.spec.ts',
  'tests/report-depth.spec.ts',

// Batch 2 (OSE-946 c3) — manifest node-clean bucket, then GREEN-FILTERED in the
// node project: added all 43 non-review node candidates, ran the node project,
// kept only the 27 that passed. The 16 excluded need the workers pool or a DOM
// env — transitive `cloudflare:test` (briefing, uec-fixtures-example → helpers/uec),
// or jsdom/.html (a11y-axe, color-contrast, keyboard-nav, screen-reader, poster-*,
// advanced-metrics, demo-banner, pdf-export) — the manifest missed them by keying
// only on the spec file, not its import graph. Those stay in the workers pool.
  'tests/admin-brand-scope.spec.ts',
  'tests/admin-servicetoken-fallthrough.spec.ts',
  'tests/corridor-map.spec.ts',
  'tests/demo-ci-gate.spec.ts',
  'tests/demo-registry.spec.ts',
  'tests/demo-site.spec.ts',
  'tests/dev-open-admin-guard.spec.ts',
  'tests/fat-finger.property.spec.ts',
  'tests/forbidden-join-boundary.spec.ts',
  'tests/form-page-email-signup-dispatch.spec.ts',
  'tests/form-sponsor-ui.spec.ts',
  'tests/forms-pepper-preflight.spec.ts',
  'tests/geo-link-maps-not-h3.spec.ts',
  'tests/geo.spec.ts',
  'tests/ncr-pipeline.spec.ts',
  'tests/ops/payment-links-guard.spec.ts',
  'tests/phase-cache.spec.ts',
  'tests/riph-brain-conformance.spec.ts',
  'tests/riph-demo-dataset.spec.ts',
  'tests/schema-guard.spec.ts',
  'tests/shared-report-auth.spec.ts',
  'tests/signed-link-token-forgery.spec.ts',
  'tests/sponsor-frequency-rotation.spec.ts',
  'tests/sponsor-logo.spec.ts',
  'tests/sponsor-share-covenant.spec.ts',
  'tests/sponsor-share-rotation.spec.ts',
  'tests/uec-module.spec.ts',
];
