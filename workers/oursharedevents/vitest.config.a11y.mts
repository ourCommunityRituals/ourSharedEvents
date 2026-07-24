import { defineConfig } from 'vitest/config';

export default defineConfig({
  assetsInclude: ['**/*.html'],
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
