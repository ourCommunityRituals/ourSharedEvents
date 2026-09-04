import { defineConfig } from 'vitest/config';
import { NODE_SPECS } from './vitest.node-specs.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// vitest.node.mts — the NODE project of the OSE-946 dual-pool reshape.
//
// Specs here are pure-logic / static-source checks that never needed the
// miniflare/workerd runtime. Running them in a plain node environment means they
// execute in parallel, in seconds, and CANNOT crash the workers pool at teardown
// (the OSE-696 flake). The companion `vitest.workers.mts` EXCLUDES exactly this
// list (both import it from `vitest.node-specs.mjs`), so every spec runs in
// exactly one project — coverage parity by construction.
//
// The include list is curated + verified, never a broad testMatch — see
// vitest.node-specs.mjs and docs/testing/vitest-pool-triage.md for the why.
// ─────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  test: {
    name: 'node',
    environment: 'node',
    globals: true,
    include: NODE_SPECS,
  },
});
