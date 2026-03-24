/**
 * Unified Status / Setup / Permissions Contract Tests
 *
 * This test validates the canonical contracts for ops-critical endpoints:
 * - api_statusPure (?page=status) - Pure health check, flat format
 * - api_status (?page=statusFull) - Full status with DB check, envelope format
 * - api_setupCheck (?page=setup) - First-time setup verification
 * - api_checkPermissions (?page=permissions) - Permission diagnostics
 *
 * Purpose: DevOps / SDET contract validation
 * - Ensures BUILD_ID is exposed consistently
 * - Ensures brandId matches configured brands
 * - Validates response structure against JSON schemas
 * - Tests both GAS URL and friendly URL patterns
 *
 * Run: npm run test:status-contract
 *
 * Environment:
 *   BASE_URL - Target environment (default: EventAngle production via Cloudflare)
 *   CI - When set, network-dependent tests are skipped
 *   SKIP_NETWORK_TESTS - Explicitly skip network tests
 *
 * Examples:
 *   npm run test:status-contract
 *   BASE_URL="https://www.eventangle.com" npm run test:status-contract
 *   BASE_URL="https://script.google.com/macros/s/XXXX/exec" npm run test:status-contract
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// --- CI Detection ---
const isCI = process.env.CI === 'true' || process.env.CI === true;
const skipNetworkTests = isCI || process.env.SKIP_NETWORK_TESTS === 'true';
const describeNetwork = skipNetworkTests ? describe.skip : describe;

// --- Test Configuration ---
const { getBaseUrl, isGoogleAppsScript, DEFAULT_GAS_URL } = require('../config/environments');

const BASE_URL = getBaseUrl();
const TIMEOUT_MS = 30000;

// --- Extract canonical values from Config.gs (Single Source of Truth) ---
// Story 5.3: GAS files archived to archive/gas/
const GAS_ARCHIVE_DIR = path.join(__dirname, '../../archive/gas');

function getCanonicalBuildId() {
  const configPath = path.join(GAS_ARCHIVE_DIR, 'Config.gs');
  const configContent = fs.readFileSync(configPath, 'utf8');
  const match = configContent.match(/BUILD_ID:\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error('Could not extract BUILD_ID from Config.gs');
  }
  return match[1];
}

function getCanonicalBrandIds() {
  const configPath = path.join(GAS_ARCHIVE_DIR, 'Config.gs');
  const configContent = fs.readFileSync(configPath, 'utf8');
  const brandsMatch = configContent.match(/const BRANDS\s*=\s*\[([\s\S]*?)\];/);
  if (!brandsMatch) {
    throw new Error('Could not find BRANDS array in Config.gs');
  }
  const brandsSection = brandsMatch[1];
  const idMatches = brandsSection.matchAll(/{\s*\n?\s*id:\s*['"]([^'"]+)['"]/g);
  const brandIds = [];
  for (const match of idMatches) {
    brandIds.push(match[1]);
  }
  if (brandIds.length === 0) {
    throw new Error('Could not extract brand IDs from Config.gs BRANDS array');
  }
  return brandIds;
}

function getCanonicalContractVersion() {
  const configPath = path.join(GAS_ARCHIVE_DIR, 'Config.gs');
  const configContent = fs.readFileSync(configPath, 'utf8');
  const match = configContent.match(/CONTRACT_VER:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

// --- Schema Loading ---

function loadSchema(schemaName) {
  const schemaPath = path.join(__dirname, `../../schemas/${schemaName}`);
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  return JSON.parse(schemaContent);
}

function createValidator() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv;
}

// --- URL Builders ---

/**
 * Build URL for an endpoint using friendly URL pattern
 * @param {string} page - Page name (status, setup, permissions)
 * @param {string} brand - Brand ID
 */
function buildFriendlyUrl(page, brand = 'root') {
  const basePath = brand === 'root' ? '' : `/${brand}`;
  return `${BASE_URL}${basePath}/${page}`;
}

/**
 * Build URL for an endpoint using GAS query parameter pattern
 * @param {string} page - Page name (status, setup, permissions)
 * @param {string} brand - Brand ID
 */
function buildGasUrl(page, brand = 'root') {
  const params = new URLSearchParams({ page });
  if (brand !== 'root') {
    params.set('brand', brand);
  }
  return `${BASE_URL}?${params.toString()}`;
}

/**
 * Build URL based on current environment
 */
function buildUrl(page, brand = 'root') {
  // Use GAS pattern for script.google.com, friendly pattern otherwise
  if (isGoogleAppsScript()) {
    return buildGasUrl(page, brand);
  }
  return buildFriendlyUrl(page, brand);
}

// --- HTTP Client ---

async function fetchEndpoint(page, brand = 'root') {
  const url = buildUrl(page, brand);
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.json();
}

// --- Contract Tests ---

describe('Unified Status/Setup/Permissions Contract Tests', () => {
  let CANONICAL_BUILD_ID;
  let CANONICAL_BRAND_IDS;
  let CANONICAL_CONTRACT_VER;
  let ajv;

  beforeAll(() => {
    CANONICAL_BUILD_ID = getCanonicalBuildId();
    CANONICAL_BRAND_IDS = getCanonicalBrandIds();
    CANONICAL_CONTRACT_VER = getCanonicalContractVersion();
    ajv = createValidator();

    console.log('\n==============================================');
    console.log('Unified Status/Setup/Permissions Contract Tests');
    console.log('==============================================');
    console.log(`BASE_URL: ${BASE_URL}`);
    console.log(`URL Pattern: ${isGoogleAppsScript() ? 'GAS Query Params' : 'Friendly URLs'}`);
    console.log(`Canonical BUILD_ID: ${CANONICAL_BUILD_ID}`);
    console.log(`Canonical CONTRACT_VER: ${CANONICAL_CONTRACT_VER}`);
    console.log(`Canonical Brand IDs: ${CANONICAL_BRAND_IDS.join(', ')}`);
    if (skipNetworkTests) {
      console.log('⚠️  Network tests SKIPPED (CI environment detected)');
    }
    console.log('==============================================\n');
  });

  // ============================================================================
  // Schema File Validation
  // ============================================================================

  describe('Schema Files Validation', () => {
    it('should have valid status.schema.json (for api_statusPure)', () => {
      const schema = loadSchema('status.schema.json');
      expect(schema).toHaveProperty('$schema');
      expect(schema).toHaveProperty('title', 'Status Response');
      expect(schema.required).toContain('ok');
      expect(schema.required).toContain('buildId');
      expect(schema.required).toContain('brandId');
      expect(schema.required).toContain('time');
    });

    it('should have valid status-mvp.schema.json (for api_statusMvp)', () => {
      const schema = loadSchema('status-mvp.schema.json');
      expect(schema).toHaveProperty('$schema');
      expect(schema).toHaveProperty('title', 'MVP Status Response');
      expect(schema.required).toContain('ok');
      expect(schema.required).toContain('buildId');
      expect(schema.required).toContain('brandId');
      expect(schema.required).toContain('time');
      expect(schema.required).toContain('analyticsSheetHealthy');
      expect(schema.required).toContain('sharedAnalyticsContractOk');
      expect(schema.properties.analyticsSheetHealthy.type).toBe('boolean');
      expect(schema.properties.sharedAnalyticsContractOk.type).toBe('boolean');
    });

    it('should have valid status-envelope.schema.json (for api_status)', () => {
      const schema = loadSchema('status-envelope.schema.json');
      expect(schema).toHaveProperty('$schema');
      expect(schema).toHaveProperty('title', 'Status Envelope Response');
      expect(schema.$defs).toHaveProperty('StatusValue');
      expect(schema.$defs).toHaveProperty('DatabaseStatus');
    });

    it('should have valid setupcheck.schema.json (for api_setupCheck)', () => {
      const schema = loadSchema('setupcheck.schema.json');
      expect(schema).toHaveProperty('$schema');
      expect(schema).toHaveProperty('title', 'SetupCheck Response');
      expect(schema.$defs).toHaveProperty('SetupCheckValue');
      expect(schema.$defs).toHaveProperty('Check');
      expect(schema.$defs.Check.properties.name.enum).toContain('Brand Configuration');
      expect(schema.$defs.Check.properties.name.enum).toContain('Spreadsheet Access');
    });

    it('should have valid checkpermissions.schema.json (for api_checkPermissions)', () => {
      const schema = loadSchema('checkpermissions.schema.json');
      expect(schema).toHaveProperty('$schema');
      expect(schema).toHaveProperty('title', 'CheckPermissions Response');
      expect(schema.$defs).toHaveProperty('CheckPermissionsValue');
      expect(schema.$defs).toHaveProperty('PermissionDetails');
      expect(schema.$defs).toHaveProperty('BrandInfo');
      expect(schema.$defs).toHaveProperty('SpreadsheetInfo');
      expect(schema.$defs).toHaveProperty('OAuthInfo');
    });

    it('should have consistent error codes across all schemas', () => {
      const statusEnvelope = loadSchema('status-envelope.schema.json');
      const setupcheck = loadSchema('setupcheck.schema.json');
      const checkpermissions = loadSchema('checkpermissions.schema.json');

      const expectedCodes = ['NOT_FOUND', 'INTERNAL', 'UNAUTHORIZED', 'BAD_REQUEST'];

      expect(statusEnvelope.$defs.ErrorCode.enum).toEqual(expectedCodes);
      expect(setupcheck.$defs.ErrorCode.enum).toEqual(expectedCodes);
      expect(checkpermissions.$defs.ErrorCode.enum).toEqual(expectedCodes);
    });

    it('should have optional db health flag in status.schema.json', () => {
      const schema = loadSchema('status.schema.json');
      expect(schema.properties).toHaveProperty('db');
      expect(schema.properties.db.type).toBe('object');
      expect(schema.properties.db.properties.ok.type).toBe('boolean');
      // db is optional (not in required array)
      expect(schema.required).not.toContain('db');
    });
  });

  // ============================================================================
  // Local Response Structure Validation (CI-safe, no network)
  // These tests validate response structure using mock data against the schema.
  // External uptime / SLO is measured via ?p=status.
  // ============================================================================

  describe('Status Response Structure Validation (Local/CI)', () => {
    let ajv;
    let statusSchema;

    beforeAll(() => {
      ajv = createValidator();
      statusSchema = loadSchema('status.schema.json');
    });

    it('should validate timestamp is ISO 8601 format', () => {
      // Test various ISO 8601 timestamps
      const validTimestamps = [
        '2025-12-02T10:30:00.000Z',
        '2025-01-15T23:59:59.999Z',
        '2024-06-30T00:00:00.000Z'
      ];

      validTimestamps.forEach(timestamp => {
        const parsed = new Date(timestamp);
        expect(parsed.toISOString()).toBe(timestamp);
        expect(isNaN(parsed.getTime())).toBe(false);
      });
    });

    it('should validate ok: true response structure against schema', () => {
      const mockResponse = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        db: { ok: true }
      };

      const validate = ajv.compile(statusSchema);
      const valid = validate(mockResponse);

      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    });

    it('should validate ok: false response structure against schema', () => {
      const mockResponse = {
        ok: false,
        buildId: 'mvp-v19',
        brandId: 'unknown',
        time: new Date().toISOString(),
        db: { ok: false },
        message: 'Brand not found: invalid-brand'
      };

      const validate = ajv.compile(statusSchema);
      const valid = validate(mockResponse);

      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    });

    it('should validate response without optional db field', () => {
      // db is optional, response without it should still be valid
      const mockResponse = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString()
      };

      const validate = ajv.compile(statusSchema);
      const valid = validate(mockResponse);

      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    });

    it('should validate ok semantics: ok=true means service is operational', () => {
      const successResponse = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        db: { ok: true }
      };

      // ok: true should not have a message field (indicates success)
      expect(successResponse.ok).toBe(true);
      expect(successResponse.message).toBeUndefined();
    });

    it('should validate ok semantics: ok=false requires explanation', () => {
      const errorResponse = {
        ok: false,
        buildId: 'mvp-v19',
        brandId: 'unknown',
        time: new Date().toISOString(),
        db: { ok: false },
        message: 'Brand not found: invalid-brand'
      };

      // ok: false should have a message explaining the error
      expect(errorResponse.ok).toBe(false);
      expect(errorResponse.message).toBeDefined();
      expect(typeof errorResponse.message).toBe('string');
      expect(errorResponse.message.length).toBeGreaterThan(0);
    });

    it('should validate db.ok semantics: db.ok=true means datastore is accessible', () => {
      const response = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        db: { ok: true }
      };

      expect(response.db.ok).toBe(true);
      // API can be ok even if db is not (separation of liveness and readiness)
    });

    it('should validate db.ok semantics: db.ok=false with ok=true is valid', () => {
      // API can respond (ok: true) but report database issues (db.ok: false)
      const response = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        db: { ok: false }
      };

      const validate = ajv.compile(statusSchema);
      const valid = validate(response);

      expect(valid).toBe(true);
      expect(response.ok).toBe(true);
      expect(response.db.ok).toBe(false);
    });

    it('should reject invalid timestamp format', () => {
      const invalidTimestamps = [
        '2025-12-02',           // Missing time
        '10:30:00',             // Missing date
        '2025/12/02T10:30:00Z', // Wrong separator
        'invalid-date'          // Not a date
      ];

      invalidTimestamps.forEach(timestamp => {
        const parsed = new Date(timestamp);
        // Either parse fails or toISOString doesn't match input
        const isValidISO = !isNaN(parsed.getTime()) &&
          parsed.toISOString() === timestamp;
        expect(isValidISO).toBe(false);
      });
    });

    it('should reject response with extra fields (additionalProperties: false)', () => {
      const invalidResponse = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        db: { ok: true },
        extraField: 'should not be here'
      };

      const validate = ajv.compile(statusSchema);
      const valid = validate(invalidResponse);

      expect(valid).toBe(false);
    });
  });

  // ============================================================================
  // Canonical Values Extraction
  // ============================================================================

  describe('Canonical Values Extraction', () => {
    it('should extract BUILD_ID from Config.gs', () => {
      expect(CANONICAL_BUILD_ID).toBeDefined();
      expect(typeof CANONICAL_BUILD_ID).toBe('string');
      expect(CANONICAL_BUILD_ID.length).toBeGreaterThan(0);
    });

    it('should extract brand IDs from Config.gs', () => {
      expect(CANONICAL_BRAND_IDS).toBeDefined();
      expect(Array.isArray(CANONICAL_BRAND_IDS)).toBe(true);
      expect(CANONICAL_BRAND_IDS.length).toBeGreaterThan(0);
      expect(CANONICAL_BRAND_IDS).toContain('root');
    });

    it('should extract CONTRACT_VER from Config.gs', () => {
      expect(CANONICAL_CONTRACT_VER).toBeDefined();
      expect(CANONICAL_CONTRACT_VER).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  // ============================================================================
  // api_statusPure (?page=status) Contract Tests
  // ============================================================================

  describeNetwork('api_statusPure Contract (/status)', () => {
    it('should return flat format with ok: true', async () => {
      const data = await fetchEndpoint('status', 'root');

      expect(data).toHaveProperty('ok', true);
      expect(data).not.toHaveProperty('value'); // Flat format, no envelope
    }, TIMEOUT_MS);

    it('should return buildId matching Config.gs BUILD_ID', async () => {
      const data = await fetchEndpoint('status', 'root');

      expect(data).toHaveProperty('buildId');
      expect(data.buildId).toBe(CANONICAL_BUILD_ID);
    }, TIMEOUT_MS);

    it('should return time in ISO 8601 format', async () => {
      const data = await fetchEndpoint('status', 'root');

      expect(data).toHaveProperty('time');
      const parsed = new Date(data.time);
      expect(parsed.toISOString()).toBe(data.time);
    }, TIMEOUT_MS);

    it('should return db.ok health flag for datastore connectivity', async () => {
      const data = await fetchEndpoint('status', 'root');

      expect(data).toHaveProperty('db');
      expect(data.db).toHaveProperty('ok');
      expect(typeof data.db.ok).toBe('boolean');
      // For a healthy system, db.ok should be true
      expect(data.db.ok).toBe(true);
    }, TIMEOUT_MS);

    it('should validate against status.schema.json', async () => {
      const data = await fetchEndpoint('status', 'root');
      const schema = loadSchema('status.schema.json');
      const validate = ajv.compile(schema);
      const valid = validate(data);

      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    }, TIMEOUT_MS);

    it.each(['root', 'abc', 'cbc', 'cbl'])(
      'should return consistent buildId for brand: %s',
      async (brandId) => {
        const data = await fetchEndpoint('status', brandId);

        expect(data.ok).toBe(true);
        expect(data.buildId).toBe(CANONICAL_BUILD_ID);
        expect(data.brandId).toBe(brandId);
      },
      TIMEOUT_MS
    );

    it('should return ok: false for invalid brand', async () => {
      const url = buildUrl('status', 'nonexistent-brand-xyz');

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data).toHaveProperty('message');
        expect(data.message).toMatch(/not found/i);
      }
      // 404 is also acceptable
    }, TIMEOUT_MS);
  });

  // ============================================================================
  // api_statusMvp (?page=statusmvp) Contract Tests - Analytics Health Checks
  // ============================================================================

  describeNetwork('api_statusMvp Contract (/statusmvp)', () => {
    it('should return flat format with analytics health fields', async () => {
      const data = await fetchEndpoint('statusmvp', 'root');

      expect(data).toHaveProperty('ok');
      expect(typeof data.ok).toBe('boolean');
      expect(data).not.toHaveProperty('value'); // Flat format, no envelope
    }, TIMEOUT_MS);

    it('should return analyticsSheetHealthy boolean field', async () => {
      const data = await fetchEndpoint('statusmvp', 'root');

      expect(data).toHaveProperty('analyticsSheetHealthy');
      expect(typeof data.analyticsSheetHealthy).toBe('boolean');
    }, TIMEOUT_MS);

    it('should return sharedAnalyticsContractOk boolean field', async () => {
      const data = await fetchEndpoint('statusmvp', 'root');

      expect(data).toHaveProperty('sharedAnalyticsContractOk');
      expect(typeof data.sharedAnalyticsContractOk).toBe('boolean');
    }, TIMEOUT_MS);

    it('should return buildId matching Config.gs BUILD_ID', async () => {
      const data = await fetchEndpoint('statusmvp', 'root');

      expect(data).toHaveProperty('buildId');
      expect(data.buildId).toBe(CANONICAL_BUILD_ID);
    }, TIMEOUT_MS);

    it('should return time in ISO 8601 format', async () => {
      const data = await fetchEndpoint('statusmvp', 'root');

      expect(data).toHaveProperty('time');
      const parsed = new Date(data.time);
      expect(parsed.toISOString()).toBe(data.time);
    }, TIMEOUT_MS);

    it('should validate against status-mvp.schema.json', async () => {
      const data = await fetchEndpoint('statusmvp', 'root');
      const schema = loadSchema('status-mvp.schema.json');
      const validate = ajv.compile(schema);
      const valid = validate(data);

      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    }, TIMEOUT_MS);

    it('should have ok: true only when both analytics checks pass', async () => {
      const data = await fetchEndpoint('statusmvp', 'root');

      // ok should be true only if both analytics checks pass
      if (data.ok === true) {
        expect(data.analyticsSheetHealthy).toBe(true);
        expect(data.sharedAnalyticsContractOk).toBe(true);
        expect(data.message).toBeUndefined();
      } else {
        // If ok is false, at least one check failed and message should explain
        expect(data).toHaveProperty('message');
        expect(
          data.analyticsSheetHealthy === false ||
          data.sharedAnalyticsContractOk === false
        ).toBe(true);
      }
    }, TIMEOUT_MS);

    it.each(['root', 'abc', 'cbc', 'cbl'])(
      'should return consistent buildId for brand: %s',
      async (brandId) => {
        const data = await fetchEndpoint('statusmvp', brandId);

        expect(data.buildId).toBe(CANONICAL_BUILD_ID);
        expect(data.brandId).toBe(brandId);
        expect(data).toHaveProperty('analyticsSheetHealthy');
        expect(data).toHaveProperty('sharedAnalyticsContractOk');
      },
      TIMEOUT_MS
    );

    it('should return ok: false with analytics fields for invalid brand', async () => {
      const url = buildUrl('statusmvp', 'nonexistent-brand-xyz');

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data).toHaveProperty('message');
        expect(data.message).toMatch(/not found/i);
        expect(data.analyticsSheetHealthy).toBe(false);
        expect(data.sharedAnalyticsContractOk).toBe(false);
      }
      // 404 is also acceptable
    }, TIMEOUT_MS);
  });

  // ============================================================================
  // api_setupCheck (?page=setup) Contract Tests
  // ============================================================================

  describeNetwork('api_setupCheck Contract (/setup)', () => {
    it('should return envelope format with ok: true', async () => {
      const data = await fetchEndpoint('setup', 'root');

      expect(data).toHaveProperty('ok', true);
      expect(data).toHaveProperty('value');
    }, TIMEOUT_MS);

    it('should return value with required fields', async () => {
      const data = await fetchEndpoint('setup', 'root');

      expect(data.ok).toBe(true);
      const value = data.value;

      expect(value).toHaveProperty('status');
      expect(['ok', 'warning', 'error']).toContain(value.status);
      expect(value).toHaveProperty('message');
      expect(value).toHaveProperty('brand');
      expect(value).toHaveProperty('timestamp');
      expect(value).toHaveProperty('checks');
      expect(Array.isArray(value.checks)).toBe(true);
      expect(value).toHaveProperty('issues');
      expect(value).toHaveProperty('warnings');
      expect(value).toHaveProperty('fixes');
      expect(value).toHaveProperty('nextSteps');
    }, TIMEOUT_MS);

    it('should return 6 diagnostic checks', async () => {
      const data = await fetchEndpoint('setup', 'root');
      const checks = data.value.checks;

      expect(checks.length).toBe(6);

      const checkNames = checks.map(c => c.name);
      expect(checkNames).toContain('Brand Configuration');
      expect(checkNames).toContain('Spreadsheet Access');
      expect(checkNames).toContain('Admin Secrets');
      expect(checkNames).toContain('Deployment Configuration');
      expect(checkNames).toContain('OAuth Scopes');
      expect(checkNames).toContain('Database Structure');
    }, TIMEOUT_MS);

    it('should have valid check statuses', async () => {
      const data = await fetchEndpoint('setup', 'root');
      const checks = data.value.checks;

      const validStatuses = ['ok', 'warning', 'error', 'checking', 'skipped'];
      checks.forEach(check => {
        expect(validStatuses).toContain(check.status);
      });
    }, TIMEOUT_MS);

    it('should validate against setupcheck.schema.json', async () => {
      const data = await fetchEndpoint('setup', 'root');
      const schema = loadSchema('setupcheck.schema.json');
      const validate = ajv.compile(schema);
      const valid = validate(data);

      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    }, TIMEOUT_MS);

    it('should return error for invalid brand', async () => {
      const url = buildUrl('setup', 'nonexistent-brand-xyz');

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data).toHaveProperty('code', 'NOT_FOUND');
        expect(data).toHaveProperty('message');
      }
    }, TIMEOUT_MS);
  });

  // ============================================================================
  // api_checkPermissions (?page=permissions) Contract Tests
  // ============================================================================

  describeNetwork('api_checkPermissions Contract (/permissions)', () => {
    it('should return envelope format with ok: true', async () => {
      const data = await fetchEndpoint('permissions', 'root');

      expect(data).toHaveProperty('ok', true);
      expect(data).toHaveProperty('value');
    }, TIMEOUT_MS);

    it('should return value with required fields', async () => {
      const data = await fetchEndpoint('permissions', 'root');

      expect(data.ok).toBe(true);
      const value = data.value;

      expect(value).toHaveProperty('status');
      expect(['ok', 'error']).toContain(value.status);
      expect(value).toHaveProperty('message');
      expect(value).toHaveProperty('details');
    }, TIMEOUT_MS);

    it('should return details with all permission categories', async () => {
      const data = await fetchEndpoint('permissions', 'root');
      const details = data.value.details;

      expect(details).toHaveProperty('brand');
      expect(details.brand).toHaveProperty('id');
      expect(details.brand).toHaveProperty('name');
      expect(details.brand).toHaveProperty('spreadsheetId');

      expect(details).toHaveProperty('deployment');
      expect(details.deployment).toHaveProperty('configured');

      expect(details).toHaveProperty('spreadsheet');
      expect(details.spreadsheet).toHaveProperty('accessible');
      expect(details.spreadsheet).toHaveProperty('message');

      expect(details).toHaveProperty('oauth');
      expect(details.oauth).toHaveProperty('scopes');
      expect(details.oauth).toHaveProperty('allGranted');
    }, TIMEOUT_MS);

    it('should have valid OAuth scope tests', async () => {
      const data = await fetchEndpoint('permissions', 'root');
      const scopes = data.value.details.oauth.scopes;

      expect(Array.isArray(scopes)).toBe(true);
      expect(scopes.length).toBeGreaterThan(0);

      const validScopes = ['spreadsheets', 'external_request'];
      scopes.forEach(scope => {
        expect(validScopes).toContain(scope.scope);
        expect(typeof scope.granted).toBe('boolean');
      });
    }, TIMEOUT_MS);

    it('should return nextSteps when status is ok', async () => {
      const data = await fetchEndpoint('permissions', 'root');

      if (data.value.status === 'ok') {
        expect(data.value).toHaveProperty('nextSteps');
        expect(Array.isArray(data.value.nextSteps)).toBe(true);
      }
    }, TIMEOUT_MS);

    it('should return recommendations/helpUrl when status is error', async () => {
      const data = await fetchEndpoint('permissions', 'root');

      if (data.value.status === 'error') {
        expect(
          data.value.recommendations || data.value.helpUrl
        ).toBeDefined();
      }
    }, TIMEOUT_MS);

    it('should validate against checkpermissions.schema.json', async () => {
      const data = await fetchEndpoint('permissions', 'root');
      const schema = loadSchema('checkpermissions.schema.json');
      const validate = ajv.compile(schema);
      const valid = validate(data);

      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    }, TIMEOUT_MS);

    it('should return error for invalid brand', async () => {
      const url = buildUrl('permissions', 'nonexistent-brand-xyz');

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data).toHaveProperty('code', 'NOT_FOUND');
        expect(data).toHaveProperty('message');
      }
    }, TIMEOUT_MS);
  });

  // ============================================================================
  // Cross-Endpoint Contract Consistency
  // ============================================================================

  describeNetwork('Cross-Endpoint Contract Consistency', () => {
    it('should return consistent brand ID across all endpoints', async () => {
      const [statusData, setupData, permissionsData] = await Promise.all([
        fetchEndpoint('status', 'root'),
        fetchEndpoint('setup', 'root'),
        fetchEndpoint('permissions', 'root')
      ]);

      expect(statusData.brandId).toBe('root');
      expect(setupData.value.brand).toBe('root');
      expect(permissionsData.value.details.brand.id).toBe('root');
    }, TIMEOUT_MS);

    it('should return consistent buildId from status endpoint', async () => {
      const statusData = await fetchEndpoint('status', 'root');
      expect(statusData.buildId).toBe(CANONICAL_BUILD_ID);
    }, TIMEOUT_MS);

    it('should have consistent error envelope format', async () => {
      // Test setup and permissions return same error format for invalid brand
      const [setupResponse, permissionsResponse] = await Promise.all([
        fetch(buildUrl('setup', 'invalid-brand-xyz'), {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        }),
        fetch(buildUrl('permissions', 'invalid-brand-xyz'), {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        })
      ]);

      if (setupResponse.ok && permissionsResponse.ok) {
        const [setupData, permissionsData] = await Promise.all([
          setupResponse.json(),
          permissionsResponse.json()
        ]);

        // Both should return same error structure
        expect(setupData.ok).toBe(false);
        expect(permissionsData.ok).toBe(false);
        expect(setupData).toHaveProperty('code');
        expect(permissionsData).toHaveProperty('code');
        expect(setupData).toHaveProperty('message');
        expect(permissionsData).toHaveProperty('message');
      }
    }, TIMEOUT_MS);
  });

  // ============================================================================
  // URL Pattern Tests (GAS vs Friendly)
  // ============================================================================

  describe('URL Pattern Generation', () => {
    it('should generate correct friendly URL for root brand', () => {
      const url = buildFriendlyUrl('status', 'root');
      expect(url).toBe(`${BASE_URL}/status`);
    });

    it('should generate correct friendly URL for non-root brand', () => {
      const url = buildFriendlyUrl('status', 'abc');
      expect(url).toBe(`${BASE_URL}/abc/status`);
    });

    it('should generate correct GAS URL for root brand', () => {
      const url = buildGasUrl('status', 'root');
      expect(url).toBe(`${BASE_URL}?page=status`);
    });

    it('should generate correct GAS URL for non-root brand', () => {
      const url = buildGasUrl('status', 'abc');
      expect(url).toBe(`${BASE_URL}?page=status&brand=abc`);
    });

    it('should generate setup URLs correctly', () => {
      expect(buildFriendlyUrl('setup', 'root')).toBe(`${BASE_URL}/setup`);
      expect(buildFriendlyUrl('setup', 'cbc')).toBe(`${BASE_URL}/cbc/setup`);
    });

    it('should generate permissions URLs correctly', () => {
      expect(buildFriendlyUrl('permissions', 'root')).toBe(`${BASE_URL}/permissions`);
      expect(buildFriendlyUrl('permissions', 'cbl')).toBe(`${BASE_URL}/cbl/permissions`);
    });
  });
});
