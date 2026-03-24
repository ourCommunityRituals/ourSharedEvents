#!/usr/bin/env node
/**
 * API Contracts Tests Runner
 *
 * Runs all API contract validation tests using Jest.
 * Validates API response structures match expected schemas.
 *
 * Usage:
 *   node scripts/test-api-contracts.js
 *   npm run test:api-contracts
 */

const { execSync } = require('child_process');

console.log('Running API contract tests...\n');

try {
  execSync(
    'npx jest tests/api-contracts --runInBand',
    {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' }
    }
  );
  console.log('\n✓ API contract tests passed');
  process.exit(0);
} catch (error) {
  console.error('\n✗ API contract tests failed');
  process.exit(1);
}
