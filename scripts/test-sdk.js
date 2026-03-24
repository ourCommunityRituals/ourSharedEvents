#!/usr/bin/env node
/**
 * SDK Tests Runner
 *
 * Runs all SDK-related unit tests using Jest.
 * Tests: nusdk-rpc, shared-utils, sponsor-utils
 *
 * Usage:
 *   node scripts/test-sdk.js
 *   npm run test:sdk
 */

const { execSync } = require('child_process');

console.log('Running SDK tests...\n');

try {
  execSync(
    'npx jest --testMatch="**/tests/unit/{nusdk-rpc,shared-utils,sponsor-utils}.test.js" --runInBand',
    {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' }
    }
  );
  console.log('\n✓ SDK tests passed');
  process.exit(0);
} catch (error) {
  console.error('\n✗ SDK tests failed');
  process.exit(1);
}
