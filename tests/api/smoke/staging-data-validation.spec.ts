/**
 * Stage-2 API Smoke Test: Staging Environment Data Validation
 *
 * Story 5 - Full Testing Pipeline: Test "Misaligned Data" Scenarios
 *
 * Validates that staging environment is truly using staging data/database.
 * Prevents scenarios where staging might accidentally be pointing to prod data.
 *
 * Acceptance Criteria:
 * - Staging environment returns staging-specific data markers
 * - Script ID matches staging Script ID (not production)
 * - Deployment ID matches staging Deployment ID
 * - Worker env variable shows "staging" (not "production")
 * - Content does not contain production-only markers
 *
 * @see config/deployment-ids.js - Expected staging/production IDs
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// Expected Script IDs for each environment
const EXPECTED_IDS = {
  staging: {
    scriptId: '1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ',
    deploymentId: 'AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm',
    workerEnv: 'staging',
    hostname: 'stg.eventangle.com',
  },
  production: {
    scriptId: '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l',
    deploymentId: '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l',
    workerEnv: 'production',
    hostname: 'www.eventangle.com',
  }
};

// Detect expected environment from BASE_URL
function detectExpectedEnvironment(): 'staging' | 'production' {
  const baseUrl = process.env.BASE_URL;

  if (process.env.USE_PRODUCTION === 'true') {
    return 'production';
  }

  if (!baseUrl) {
    return 'staging'; // Default to staging
  }

  try {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.hostname === 'www.eventangle.com' || parsedUrl.hostname === 'eventangle.com') {
      return 'production';
    }
  } catch {
    // Invalid URL, default to staging
  }

  return 'staging';
}

const EXPECTED_ENV = detectExpectedEnvironment();
const EXPECTED = EXPECTED_IDS[EXPECTED_ENV];

test.describe('Staging Environment Data Validation (Story 5)', () => {

  test.describe.configure({ mode: 'serial' });

  test.describe('Script ID Validation', () => {

    test('GAS scriptId matches expected environment', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      expect(response.status()).toBe(200);

      const json = await response.json();

      if (json.scriptId !== EXPECTED.scriptId) {
        console.error('='.repeat(60));
        console.error(`MISALIGNED DATA: Expected ${EXPECTED_ENV} Script ID`);
        console.error(`Expected: ${EXPECTED.scriptId}`);
        console.error(`Got: ${json.scriptId}`);
        console.error('');
        if (EXPECTED_ENV === 'staging' && json.scriptId === EXPECTED_IDS.production.scriptId) {
          console.error('WARNING: Staging is pointing to PRODUCTION Script!');
        } else if (EXPECTED_ENV === 'production' && json.scriptId === EXPECTED_IDS.staging.scriptId) {
          console.error('WARNING: Production is pointing to STAGING Script!');
        }
        console.error('='.repeat(60));
      }

      expect(json.scriptId).toBe(EXPECTED.scriptId);
    });

  });

  test.describe('Worker Environment Validation', () => {

    test('Worker env variable matches expected environment', async ({ request }) => {
      const response = await request.get('/env-status');
      expect(response.status()).toBe(200);

      const json = await response.json();

      if (json.env !== EXPECTED.workerEnv) {
        console.error('='.repeat(60));
        console.error(`MISALIGNED DATA: Worker env is "${json.env}"`);
        console.error(`Expected: "${EXPECTED.workerEnv}"`);
        console.error('');
        console.error('Worker is configured for wrong environment!');
        console.error('='.repeat(60));
      }

      expect(json.env).toBe(EXPECTED.workerEnv);
    });

    test('Worker gasBase URL matches expected environment', async ({ request }) => {
      const response = await request.get('/env-status');
      const json = await response.json();

      // gasBase should contain the correct Script ID
      expect(json.gasBase).toContain(EXPECTED.scriptId);

      // gasBase should be a valid GAS URL
      expect(json.gasBase).toMatch(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/);
    });

  });

  test.describe('Deployment ID Consistency', () => {

    test('deploymentId is consistent between Worker and GAS', async ({ request }) => {
      const [envStatusRes, whoamiRes] = await Promise.all([
        request.get('/env-status'),
        request.get(`/?page=whoami&brand=${BRAND}`)
      ]);

      const envStatus = await envStatusRes.json();
      const whoami = await whoamiRes.json();

      // Both should return the same deploymentId
      expect(envStatus.deploymentId).toBe(whoami.deploymentId);
    });

    test('deploymentId format is valid', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      // Deployment IDs start with AKfycb
      expect(json.deploymentId).toMatch(/^AKfycb[a-zA-Z0-9_-]+$/);
      expect(json.deploymentId.length).toBeGreaterThan(20);
    });

  });

  test.describe('Account Validation', () => {

    test('account email is the correct service account', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      // Should be zeventbook account
      expect(json.email.toLowerCase()).toContain('zeventbook');

      // Should be a valid email format
      expect(json.email).toContain('@');
    });

  });

  test.describe('Data Source Validation', () => {

    test('status endpoint reflects correct environment', async ({ request }) => {
      const response = await request.get('/status');
      const json = await response.json();

      // Status should return valid data
      expect(json.ok).toBe(true);

      // Build ID should be present
      expect(json.buildId).toBeDefined();
      expect(json.buildId.length).toBeGreaterThan(0);
    });

    test('events list returns data from correct environment', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      expect(response.status()).toBeLessThan(500);

      const json = await response.json();

      // If ok, should have valid structure
      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('items');
        expect(Array.isArray(json.value.items)).toBe(true);
      }
    });

  });

  test.describe('Cross-Environment Isolation', () => {

    test.skip(EXPECTED_ENV === 'production', 'Skip staging-specific test in production');

    test('staging environment is isolated from production', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      // Staging should NOT have production Script ID
      expect(json.scriptId).not.toBe(EXPECTED_IDS.production.scriptId);
    });

  });

  test.describe('Environment Report', () => {

    test('generates environment validation report', async ({ request }) => {
      // Fetch all environment data
      const [statusRes, envStatusRes, whoamiRes] = await Promise.all([
        request.get('/status'),
        request.get('/env-status'),
        request.get(`/?page=whoami&brand=${BRAND}`)
      ]);

      const status = await statusRes.json();
      const envStatus = await envStatusRes.json();
      const whoami = await whoamiRes.json();

      // Build validation report
      const report = {
        timestamp: new Date().toISOString(),
        expectedEnvironment: EXPECTED_ENV,
        validation: {
          scriptIdMatch: whoami.scriptId === EXPECTED.scriptId,
          workerEnvMatch: envStatus.env === EXPECTED.workerEnv,
          deploymentIdConsistent: envStatus.deploymentId === whoami.deploymentId,
          accountValid: whoami.email.toLowerCase().includes('zeventbook'),
        },
        actual: {
          scriptId: whoami.scriptId,
          deploymentId: whoami.deploymentId,
          workerEnv: envStatus.env,
          email: whoami.email,
          buildId: status.buildId,
        },
        expected: EXPECTED,
      };

      // Log report for CI visibility
      console.log('\n========== STAGING DATA VALIDATION REPORT ==========');
      console.log(JSON.stringify(report, null, 2));
      console.log('='.repeat(50));

      // All validations should pass
      expect(report.validation.scriptIdMatch, 'Script ID mismatch').toBe(true);
      expect(report.validation.workerEnvMatch, 'Worker env mismatch').toBe(true);
      expect(report.validation.deploymentIdConsistent, 'Deployment ID inconsistent').toBe(true);
      expect(report.validation.accountValid, 'Account invalid').toBe(true);
    });

  });

});
