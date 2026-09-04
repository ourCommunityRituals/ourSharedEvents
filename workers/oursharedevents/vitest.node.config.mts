import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { NODE_SPECS } from './vitest.node-specs.mjs';

// Parity with the worker bundle: wrangler.toml declares `.html` as a Text module
// (`[[rules]] type = "Text"`), i.e. a default export of the RAW file contents.
// The workers pool gets that for free; the node project must reproduce it so a
// spec importing `../src/templates/*.html` sees the identical string. A Text
// module does no processing, so JSON.stringify(readFileSync(id,'utf8')) is
// byte-exact — no divergence between the two pools.
function htmlAsText() {
  return {
    name: 'ose-html-as-text',
    enforce: 'pre' as const,
    load(id: string) {
      const path = id.split('?')[0];
      if (path.endsWith('.html')) {
        return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`;
      }
      return null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// vitest.node.config.mts — the NODE project of the OSE-946 dual-pool reshape.
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
  plugins: [htmlAsText()],
  test: {
    name: 'node',
    environment: 'node',
    globals: true,
    include: NODE_SPECS,
  },
});
