// Narrow Vitest project for mutation-testing the CI security rules in scripts/ci
// (see stryker.ci-scripts.conf.mjs). Only the unit test that defends each mutated
// module runs per mutant. If you add a mutate target there, add its test here.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/ci/no-secret-on-branch-push.test.js', 'tests/unit/ci/no-secret-echo.test.js'],
  },
});
