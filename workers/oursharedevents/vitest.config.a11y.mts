import { readFileSync } from 'fs';
import { defineConfig, Plugin } from 'vitest/config';

// Wrangler treats .html files as text modules (via [[rules]] type="Text").
// The Cloudflare vitest pool replicates this natively. But the jsdom a11y
// environment uses plain Vite, which would try to parse .html as JavaScript.
// This plugin intercepts .html loads and returns the file content as a
// default string export — matching the text-module contract that pages.ts
// depends on at import time.
const htmlAsStringPlugin: Plugin = {
  name: 'html-as-string',
  load(id) {
    if (id.endsWith('.html')) {
      const content = readFileSync(id, 'utf8');
      return `export default ${JSON.stringify(content)};`;
    }
  },
};

export default defineConfig({
  plugins: [htmlAsStringPlugin],
  test: {
    include: ['tests/a11y-axe.spec.ts'],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        // Don't execute embedded page scripts — axe only needs the DOM structure
        runScripts: 'outside-only',
      },
    },
  },
});
