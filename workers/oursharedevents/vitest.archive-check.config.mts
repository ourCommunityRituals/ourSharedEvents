import { defineConfig } from 'vitest/config';

// Runs one file: the street-map archive check, against a local archive named by
// `node scripts/check-street-map-archive.mjs <file>`. Not a CI project and not
// part of `vitest run`: the archive is never committed. The checker's tests run
// in the node project (tests/street-map-archive-check.spec.ts).
export default defineConfig({
  test: {
    name: 'archive-check',
    environment: 'node',
    include: ['scripts/street-map-archive/run.check.ts'],
    // Hashing and walking a file of many gigabytes takes minutes.
    testTimeout: 3_600_000,
  },
});
