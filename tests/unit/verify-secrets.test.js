/**
 * Tests for verify-secrets.js (Story 2 - Confirm Secrets & Environment Variables)
 *
 * These tests verify that the secrets validation script correctly:
 * 1. Detects missing required secrets
 * 2. Handles Google credentials fallback (new vs legacy naming)
 * 3. Validates private key format
 * 4. Validates OAuth credentials JSON structure
 * 5. Reports actionable error messages
 */

const path = require('path');

// Store original environment
const originalEnv = { ...process.env };

// Import the module under test
const {
  SECRET_GROUPS,
  checkEnvVar,
  checkSecret,
  validateGoogleCredentials,
  validatePrivateKeyFormat,
  validateOAuthCredentials,
} = require('../../scripts/verify-secrets.js');

describe('verify-secrets.js', () => {
  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    // Clear all test secrets
    delete process.env.GOOGLE_SA_CLIENT_EMAIL;
    delete process.env.GOOGLE_SA_PRIVATE_KEY_PEM;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    delete process.env.STAGING_SHEETS_SPREADSHEET_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.OAUTH_CREDENTIALS;
    delete process.env.ADMIN_KEY_ROOT;
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('SECRET_GROUPS structure', () => {
    test('should define all required secret categories', () => {
      expect(SECRET_GROUPS).toHaveProperty('google');
      expect(SECRET_GROUPS).toHaveProperty('cloudflare');
      expect(SECRET_GROUPS).toHaveProperty('admin');
      expect(SECRET_GROUPS).toHaveProperty('apps_script');
      expect(SECRET_GROUPS).toHaveProperty('notifications');
      expect(SECRET_GROUPS).toHaveProperty('testing');
    });

    test('google group should have stage1 secrets defined', () => {
      expect(SECRET_GROUPS.google.secrets.stage1.length).toBeGreaterThan(0);
      const secretNames = SECRET_GROUPS.google.secrets.stage1.map(s => s.name);
      expect(secretNames).toContain('GOOGLE_CLIENT_EMAIL');
      expect(secretNames).toContain('GOOGLE_PRIVATE_KEY');
      expect(secretNames).toContain('STAGING_SHEETS_SPREADSHEET_ID');
    });

    test('cloudflare group should have required deployment secrets', () => {
      const secrets = SECRET_GROUPS.cloudflare.secrets.stage1;
      const cloudflareApi = secrets.find(s => s.name === 'CLOUDFLARE_API_TOKEN');
      const cloudflareAccount = secrets.find(s => s.name === 'CLOUDFLARE_ACCOUNT_ID');

      expect(cloudflareApi).toBeDefined();
      expect(cloudflareApi.required).toBe(true);
      expect(cloudflareAccount).toBeDefined();
      expect(cloudflareAccount.required).toBe(true);
    });

    test('admin group should have ADMIN_KEY_ROOT as required for stage2', () => {
      const secrets = SECRET_GROUPS.admin.secrets.stage2;
      const adminKeyRoot = secrets.find(s => s.name === 'ADMIN_KEY_ROOT');

      expect(adminKeyRoot).toBeDefined();
      expect(adminKeyRoot.required).toBe(true);
    });

    test('each secret group should have docLink for documentation', () => {
      for (const [key, group] of Object.entries(SECRET_GROUPS)) {
        expect(group).toHaveProperty('docLink');
        expect(typeof group.docLink).toBe('string');
      }
    });
  });

  describe('checkEnvVar', () => {
    test('should return true for set environment variables', () => {
      process.env.TEST_VAR = 'test_value';
      expect(checkEnvVar('TEST_VAR')).toBe(true);
      delete process.env.TEST_VAR;
    });

    test('should return false for unset environment variables', () => {
      expect(checkEnvVar('UNSET_VAR')).toBe(false);
    });

    test('should return false for empty string', () => {
      process.env.EMPTY_VAR = '';
      expect(checkEnvVar('EMPTY_VAR')).toBe(false);
      delete process.env.EMPTY_VAR;
    });

    test('should return false for "undefined" string value', () => {
      process.env.UNDEFINED_VAR = 'undefined';
      expect(checkEnvVar('UNDEFINED_VAR')).toBe(false);
      delete process.env.UNDEFINED_VAR;
    });
  });

  describe('checkSecret', () => {
    test('should return exists: true when secret is set', () => {
      process.env.TEST_SECRET = 'secret_value_12345';
      const result = checkSecret({
        name: 'TEST_SECRET',
        env: 'TEST_SECRET',
        description: 'Test secret',
        required: true,
      });

      expect(result.exists).toBe(true);
      expect(result.name).toBe('TEST_SECRET');
      expect(result.preview).toBe('secret_val...');
      delete process.env.TEST_SECRET;
    });

    test('should return exists: false when secret is not set', () => {
      const result = checkSecret({
        name: 'MISSING_SECRET',
        env: 'MISSING_SECRET',
        description: 'Missing secret',
        required: true,
      });

      expect(result.exists).toBe(false);
      expect(result.preview).toBeNull();
    });

    test('should preserve rotation policy in result', () => {
      process.env.TEST_SECRET = 'value';
      const result = checkSecret({
        name: 'TEST_SECRET',
        env: 'TEST_SECRET',
        description: 'Test',
        required: true,
        rotationPolicy: '90 days',
      });

      expect(result.rotationPolicy).toBe('90 days');
      delete process.env.TEST_SECRET;
    });
  });

  describe('validateGoogleCredentials', () => {
    test('should validate new naming convention (GOOGLE_SA_*)', () => {
      process.env.GOOGLE_SA_CLIENT_EMAIL = 'sa@project.iam.gserviceaccount.com';
      process.env.GOOGLE_SA_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';

      const result = validateGoogleCredentials();

      expect(result.valid).toBe(true);
      expect(result.type).toBe('new');
    });

    test('should validate legacy naming convention (GOOGLE_CLIENT_EMAIL)', () => {
      process.env.GOOGLE_CLIENT_EMAIL = 'legacy@project.iam.gserviceaccount.com';
      process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';

      const result = validateGoogleCredentials();

      expect(result.valid).toBe(true);
      expect(result.type).toBe('legacy');
    });

    test('should prefer new naming when both are set', () => {
      process.env.GOOGLE_SA_CLIENT_EMAIL = 'new@project.iam.gserviceaccount.com';
      process.env.GOOGLE_SA_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\nnew\n-----END PRIVATE KEY-----';
      process.env.GOOGLE_CLIENT_EMAIL = 'legacy@project.iam.gserviceaccount.com';
      process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nlegacy\n-----END PRIVATE KEY-----';

      const result = validateGoogleCredentials();

      expect(result.valid).toBe(true);
      expect(result.type).toBe('new');
    });

    test('should return invalid when no credentials are set', () => {
      const result = validateGoogleCredentials();

      expect(result.valid).toBe(false);
      expect(result.type).toBeNull();
    });

    test('should return invalid when only email is set (missing key)', () => {
      process.env.GOOGLE_CLIENT_EMAIL = 'only-email@project.iam.gserviceaccount.com';

      const result = validateGoogleCredentials();

      expect(result.valid).toBe(false);
    });

    test('should return invalid when only key is set (missing email)', () => {
      process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';

      const result = validateGoogleCredentials();

      expect(result.valid).toBe(false);
    });
  });

  describe('validatePrivateKeyFormat', () => {
    test('should validate correctly formatted PEM key with newlines', () => {
      process.env.TEST_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----';
      const result = validatePrivateKeyFormat('TEST_KEY');

      expect(result.valid).toBe(true);
      delete process.env.TEST_KEY;
    });

    test('should validate PEM key with escaped newlines', () => {
      process.env.TEST_KEY = '-----BEGIN PRIVATE KEY-----\\nMIIEvQ...\\n-----END PRIVATE KEY-----';
      const result = validatePrivateKeyFormat('TEST_KEY');

      expect(result.valid).toBe(true);
      delete process.env.TEST_KEY;
    });

    test('should reject key without PEM markers', () => {
      process.env.TEST_KEY = 'MIIEvQ...just-base64-content';
      const result = validatePrivateKeyFormat('TEST_KEY');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('PEM markers');
      delete process.env.TEST_KEY;
    });

    test('should warn about missing line breaks', () => {
      process.env.TEST_KEY = '-----BEGIN PRIVATE KEY-----MIIEvQ...-----END PRIVATE KEY-----';
      const result = validatePrivateKeyFormat('TEST_KEY');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('line breaks');
      delete process.env.TEST_KEY;
    });

    test('should return invalid when key is not set', () => {
      const result = validatePrivateKeyFormat('UNSET_KEY');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Key not set');
    });
  });

  describe('validateOAuthCredentials', () => {
    test('should validate correctly structured OAuth JSON', () => {
      process.env.OAUTH_CREDENTIALS = JSON.stringify({
        access_token: 'ya29.xxx',
        refresh_token: '1//xxx',
        token_type: 'Bearer',
        expiry_date: 1234567890,
      });

      const result = validateOAuthCredentials();

      expect(result.valid).toBe(true);
    });

    test('should validate nested oauth2Client structure', () => {
      // The clasp credential format may have nested structure
      // The validation checks both top-level and nested oauth2Client fields
      process.env.OAUTH_CREDENTIALS = JSON.stringify({
        oauth2Client: {
          access_token: 'ya29.xxx',
          refresh_token: '1//xxx',
          token_type: 'Bearer',
        },
      });

      const result = validateOAuthCredentials();

      // This should pass because we check oauth2Client?.field
      expect(result.valid).toBe(true);
    });

    test('should reject invalid JSON', () => {
      process.env.OAUTH_CREDENTIALS = 'not-valid-json';

      const result = validateOAuthCredentials();

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid JSON');
    });

    test('should reject missing required fields', () => {
      process.env.OAUTH_CREDENTIALS = JSON.stringify({
        access_token: 'ya29.xxx',
        // missing refresh_token and token_type
      });

      const result = validateOAuthCredentials();

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing fields');
    });

    test('should return invalid when not set', () => {
      const result = validateOAuthCredentials();

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Not set');
    });
  });

  describe('Missing secret scenarios (Acceptance Criteria)', () => {
    test('should detect missing GOOGLE_CLIENT_EMAIL', () => {
      // Only set partial credentials
      process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';

      const result = validateGoogleCredentials();

      expect(result.valid).toBe(false);
    });

    test('should detect missing STAGING_SHEETS_SPREADSHEET_ID', () => {
      const secrets = SECRET_GROUPS.google.secrets.stage1;
      const secret = secrets.find(s => s.name === 'STAGING_SHEETS_SPREADSHEET_ID');

      expect(secret).toBeDefined();
      expect(secret.required).toBe(true);

      const result = checkSecret(secret);
      expect(result.exists).toBe(false);
    });

    test('should detect missing CLOUDFLARE_API_TOKEN', () => {
      const secrets = SECRET_GROUPS.cloudflare.secrets.stage1;
      const secret = secrets.find(s => s.name === 'CLOUDFLARE_API_TOKEN');

      expect(secret).toBeDefined();
      expect(secret.required).toBe(true);

      const result = checkSecret(secret);
      expect(result.exists).toBe(false);
    });

    test('should detect missing ADMIN_KEY_ROOT', () => {
      const secrets = SECRET_GROUPS.admin.secrets.stage2;
      const secret = secrets.find(s => s.name === 'ADMIN_KEY_ROOT');

      expect(secret).toBeDefined();
      expect(secret.required).toBe(true);

      const result = checkSecret(secret);
      expect(result.exists).toBe(false);
    });

    test('should detect missing OAUTH_CREDENTIALS', () => {
      const secrets = SECRET_GROUPS.apps_script.secrets.stage1;
      const secret = secrets.find(s => s.name === 'OAUTH_CREDENTIALS');

      expect(secret).toBeDefined();
      expect(secret.required).toBe(true);

      const result = checkSecret(secret);
      expect(result.exists).toBe(false);
    });
  });

  describe('Optional secrets', () => {
    test('SLACK_WEBHOOK_URL should be optional', () => {
      const secret = SECRET_GROUPS.notifications.secrets.stage1.find(
        s => s.name === 'SLACK_WEBHOOK_URL'
      );

      expect(secret).toBeDefined();
      expect(secret.required).toBe(false);
    });

    test('TEAMS_WEBHOOK_URL should be optional', () => {
      const secret = SECRET_GROUPS.notifications.secrets.stage1.find(
        s => s.name === 'TEAMS_WEBHOOK_URL'
      );

      expect(secret).toBeDefined();
      expect(secret.required).toBe(false);
    });

    test('brand-specific admin keys should be optional', () => {
      const brandKeys = ['ADMIN_KEY_ABC', 'ADMIN_KEY_CBC', 'ADMIN_KEY_CBL'];

      for (const keyName of brandKeys) {
        const secret = SECRET_GROUPS.admin.secrets.stage2.find(
          s => s.name === keyName
        );
        expect(secret).toBeDefined();
        expect(secret.required).toBe(false);
      }
    });
  });

  describe('Secret metadata', () => {
    test('secrets should have rotation policy where applicable', () => {
      const googleEmail = SECRET_GROUPS.google.secrets.stage1.find(
        s => s.name === 'GOOGLE_CLIENT_EMAIL'
      );

      expect(googleEmail.rotationPolicy).toBe('90 days');
    });

    test('secrets should have environment scope where applicable', () => {
      const stagingSpreadsheet = SECRET_GROUPS.google.secrets.stage1.find(
        s => s.name === 'STAGING_SHEETS_SPREADSHEET_ID'
      );

      expect(stagingSpreadsheet.environment).toBe('staging');
    });
  });
});
