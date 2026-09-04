import { defineConfig } from 'vitest/config';

// ─────────────────────────────────────────────────────────────────────────────
// vitest.config.mts — root of the OSE-946 dual-pool suite.
//
// `vitest run` (the worker package's `npm test`) discovers this file and runs
// BOTH projects:
//   • workers (vitest.workers.mts) — the @cloudflare/vitest-pool-workers
//     (miniflare/workerd) pool for specs that exercise the runtime.
//   • node    (vitest.node.mts)    — a plain node environment for pure-logic /
//     static specs that never needed the Worker: parallel, seconds, and unable
//     to crash the workers pool at teardown (the OSE-696 flake).
//
// The two projects partition the spec set (workers EXCLUDES the node list; node
// INCLUDES it — both from vitest.node-specs.mjs), so no spec is dropped or
// double-run. a11y-axe stays under vitest.config.a11y.mts (run via `test:a11y`),
// out of both projects here.
//
// History: this file WAS the single workers-pool config; OSE-946 renamed that to
// vitest.workers.mts and made this the projects root. CI still invokes the pool
// through `node ../../scripts/vitest-retry.mjs npm test`; restoring parallelism
// and the required-check wiring is OSE-946 child 4/5 (deferred).
// ─────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  test: {
    projects: ['./vitest.workers.config.mts', './vitest.node.config.mts'],
  },
});
