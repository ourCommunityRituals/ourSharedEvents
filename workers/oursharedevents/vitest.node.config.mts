import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { NODE_SPECS } from './vitest.node-specs.mjs';

// Load `.html` imports as raw text (default export), mirroring the worker bundle's
// `wrangler.toml [[rules]] type="Text" globs=["**/*.html"]`. src/handlers/pages.ts
// does `import PUBLIC_HTML from '../templates/public.html'`, so any spec that
// transitively imports it needs this to run in the node project — without it Vite
// fails to transform the .html and the spec would drop to the workers pool for no
// runtime reason (OSE-946 c3). `enforce:'pre'` + `load` bypasses Vite's own HTML
// handling and reads the file directly, matching the Text semantics the workers
// pool already gives these imports. Closes the worker CLAUDE.md claim that the node
// project "loads .html as Text" — previously documented but not implemented.
const htmlAsText = {
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
  plugins: [htmlAsText],
  test: {
    name: 'node',
    environment: 'node',
    globals: true,
    include: NODE_SPECS,
  },
});
