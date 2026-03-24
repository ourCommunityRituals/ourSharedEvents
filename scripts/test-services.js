#!/usr/bin/env node
/**
 * Service Tests Runner
 *
 * Runs all service-level unit tests using Jest.
 * Tests: form-service, sponsor-service, security-middleware
 *
 * Usage:
 *   node scripts/test-services.js
 *   npm run test:services
 */

const { execSync } = require('child_process');

console.log('Running service tests...\n');

try {
  execSync(
    'npx jest --testMatch="**/tests/unit/{form-service,sponsor-service,security-middleware}.test.js" --runInBand',
    {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' }
    }
  );
  console.log('\n✓ Service tests passed');
  process.exit(0);
} catch (error) {
  console.error('\n✗ Service tests failed');
  process.exit(1);
}
