/**
 * Security Tests for SEC-IAC-07 - IAC Smoke Tests
 *
 * These tests verify that Infrastructure Access Control (IAC)
 * smoke tests are properly configured to run in CI.
 *
 * Critical Security Requirements:
 * - Smoke test file exists and covers IAC enforcement
 * - Tests validate 401 for unauthenticated admin access
 * - Tests validate 403 for public POST without token
 * - Tests validate 404 for unknown routes
 * - CI workflow includes IAC smoke tests
 *
 * @see tests/api/smoke/sec-iac-07-smoke.spec.ts
 * @see .github/workflows/stage2.yml
 * @see SEC-IAC-07 - IAC Smoke Tests
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const smokeTestPath = path.join(__dirname, '../../../tests/api/smoke/sec-iac-07-smoke.spec.ts');
const stage2WorkflowPath = path.join(__dirname, '../../../.github/workflows/stage2.yml');
const playwrightConfigPath = path.join(__dirname, '../../../playwright.smoke.config.ts');

let smokeTestSource = '';
let stage2WorkflowSource = '';
let playwrightConfigSource = '';

beforeAll(() => {
  try {
    smokeTestSource = fs.readFileSync(smokeTestPath, 'utf8');
    stage2WorkflowSource = fs.readFileSync(stage2WorkflowPath, 'utf8');
    playwrightConfigSource = fs.readFileSync(playwrightConfigPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// SEC-IAC-07: Smoke Test Module Existence
// =============================================================================

describe('SEC-IAC-07: Smoke Test Module Structure', () => {

  it('MUST have sec-iac-07-smoke.spec.ts smoke test file', () => {
    expect(fs.existsSync(smokeTestPath)).toBe(true);
  });

  it('MUST be a Playwright test file', () => {
    expect(smokeTestSource).toContain("import { test, expect } from '@playwright/test'");
  });

  it('MUST have SEC-IAC-07 identifier in test description', () => {
    expect(smokeTestSource).toContain('SEC-IAC-07');
  });
});

// =============================================================================
// SEC-IAC-07: Admin Auth Guard (401)
// =============================================================================

describe('SEC-IAC-07: Admin Unauthenticated → 401', () => {

  it('MUST test /api/v2/admin endpoint without auth', () => {
    expect(smokeTestSource).toContain('/api/v2/admin');
  });

  it('MUST assert 401 status code', () => {
    expect(smokeTestSource).toContain('.toBe(401)');
  });

  it('MUST verify UNAUTH error code', () => {
    expect(smokeTestSource).toContain("'UNAUTH'");
  });

  it('MUST describe test case for admin without auth', () => {
    expect(smokeTestSource).toMatch(/admin.*without auth.*401|401.*admin.*unauthenticated/i);
  });
});

// =============================================================================
// SEC-IAC-07: Signed Mutations Guard (403)
// =============================================================================

describe('SEC-IAC-07: Public POST Without Token → 403', () => {

  it('MUST test POST without X-Mutation-Token', () => {
    expect(smokeTestSource).toContain('X-Mutation-Token');
  });

  it('MUST assert 403 status code', () => {
    expect(smokeTestSource).toContain('403');
  });

  it('MUST verify MISSING_TOKEN error code', () => {
    expect(smokeTestSource).toContain("'MISSING_TOKEN'");
  });

  it('MUST describe test case for POST without token', () => {
    expect(smokeTestSource).toMatch(/POST.*without.*token|token.*403/i);
  });
});

// =============================================================================
// SEC-IAC-07: Router 404 Handling
// =============================================================================

describe('SEC-IAC-07: Unknown Route → 404', () => {

  it('MUST test unknown API route', () => {
    expect(smokeTestSource).toMatch(/\/api\/v2\/(unknown|nonexistent|does-not-exist)/);
  });

  it('MUST assert 404 status code', () => {
    expect(smokeTestSource).toContain('.toBe(404)');
  });

  it('MUST verify Not Found error', () => {
    expect(smokeTestSource).toContain("'Not Found'");
  });

  it('MUST describe test case for unknown route', () => {
    expect(smokeTestSource).toMatch(/unknown.*route.*404|404.*unknown/i);
  });
});

// =============================================================================
// SEC-IAC-07: CI Integration
// =============================================================================

describe('SEC-IAC-07: CI Workflow Integration', () => {

  it('MUST have Stage-2 workflow file', () => {
    expect(fs.existsSync(stage2WorkflowPath)).toBe(true);
  });

  it('MUST reference SEC-IAC-07 in workflow', () => {
    expect(stage2WorkflowSource).toContain('SEC-IAC-07');
  });

  it('MUST have iac-smoke step in workflow', () => {
    expect(stage2WorkflowSource).toContain('iac-smoke');
  });

  it('MUST run sec-iac-07-smoke.spec.ts in CI', () => {
    expect(stage2WorkflowSource).toContain('sec-iac-07-smoke.spec.ts');
  });

  it('MUST fail pipeline on IAC regression', () => {
    // Verify there's a check step that exits with 1 on failure
    expect(stage2WorkflowSource).toMatch(/iac-smoke.*failure.*exit 1|Check IAC.*exit 1/s);
  });

  it('MUST include IAC smoke in summary', () => {
    expect(stage2WorkflowSource).toContain('IAC Smoke');
  });
});

// =============================================================================
// SEC-IAC-07: Playwright Configuration
// =============================================================================

describe('SEC-IAC-07: Playwright Configuration', () => {

  it('MUST have Playwright smoke config', () => {
    expect(fs.existsSync(playwrightConfigPath)).toBe(true);
  });

  it('MUST include tests/api/smoke directory', () => {
    expect(playwrightConfigSource).toContain('./tests/api/smoke');
  });
});

// =============================================================================
// SEC-IAC-07: Test Coverage Requirements
// =============================================================================

describe('SEC-IAC-07: Test Coverage', () => {

  it('MUST have deterministic response tests', () => {
    expect(smokeTestSource).toContain('Deterministic');
  });

  it('MUST verify requestId uniqueness', () => {
    expect(smokeTestSource).toContain('requestId');
  });

  it('MUST use proper test timeout', () => {
    expect(smokeTestSource).toContain('TIMEOUT');
    expect(smokeTestSource).toContain('timeout:');
  });

  it('MUST test against configured BRAND', () => {
    expect(smokeTestSource).toContain('BRAND');
    expect(smokeTestSource).toContain('process.env.TEST_BRAND');
  });
});
