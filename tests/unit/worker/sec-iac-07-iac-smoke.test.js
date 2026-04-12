/**
 * Security Tests for SEC-IAC-07 - IAC Smoke Tests
 *
 * Validates that Infrastructure Access Control smoke tests exist
 * and are properly configured to run in CI via the security-gated pipeline.
 *
 * @see tests/api/smoke/sec-iac-07-smoke.spec.ts
 * @see .github/workflows/oursharedevents-ci.yml
 * @see SEC-IAC-07 - IAC Smoke Tests
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

// SEC-IAC-07 smoke spec archived — GAS-era tests replaced by D1 Worker admin auth tests
// Auth coverage now lives in storyC1-adminAuth.spec.ts (401/UNAUTH assertions)
const smokeTestPath = path.join(
  __dirname,
  '../../../tests/api/smoke/archive/sec-iac-07-smoke.spec.ts'
);
const ciWorkflowPath = path.join(__dirname, '../../../.github/workflows/oursharedevents-ci.yml');
const playwrightConfigPath = path.join(__dirname, '../../../playwright.smoke.config.ts');

let smokeTestSource = '';
let ciWorkflowSource = '';
let playwrightConfigSource = '';

beforeAll(() => {
  try {
    smokeTestSource = fs.readFileSync(smokeTestPath, 'utf8');
    ciWorkflowSource = fs.readFileSync(ciWorkflowPath, 'utf8');
    playwrightConfigSource = fs.readFileSync(playwrightConfigPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Smoke Test Module Existence
// =============================================================================

describe('SEC-IAC-07: Smoke Test Module Structure', () => {
  it('MUST have sec-iac-07-smoke.spec.ts smoke test file', () => {
    expect(fs.existsSync(smokeTestPath)).toBe(true);
  });

  it('MUST be a Playwright test file', () => {
    expect(smokeTestSource).toContain("import { test, expect } from '@playwright/test'");
  });

  it('MUST have SEC-IAC-07 identifier', () => {
    expect(smokeTestSource).toContain('SEC-IAC-07');
  });
});

// =============================================================================
// Admin Auth Guard (401)
// =============================================================================

describe('SEC-IAC-07: Admin Unauthenticated → 401', () => {
  it('MUST test admin endpoint without auth', () => {
    expect(smokeTestSource).toContain('/api/v2/admin');
  });

  it('MUST handle 401 status code (worker auth) or CF Access interception', () => {
    // The smoke test checks for 401 conditionally — CF Access may intercept first
    expect(smokeTestSource).toContain('401');
  });

  it('MUST verify UNAUTH error code', () => {
    expect(smokeTestSource).toContain("'UNAUTH'");
  });
});

// =============================================================================
// CI Integration — Security-Gated Pipeline
// =============================================================================

describe('SEC-IAC-07: CI Workflow Integration', () => {
  it('MUST have oursharedevents-ci.yml workflow', () => {
    expect(fs.existsSync(ciWorkflowPath)).toBe(true);
  });

  it('CI workflow MUST have Security Gate job', () => {
    expect(ciWorkflowSource).toContain('Security Gate');
  });

  it('CI workflow MUST have Quality Smoke job for security bookend', () => {
    expect(ciWorkflowSource).toContain('Quality Smoke');
  });

  it('CI workflow MUST run admin auth smoke in quality smoke', () => {
    // Auth coverage migrated from sec-iac-07 to storyC1-adminAuth
    expect(ciWorkflowSource).toContain('storyC1-adminAuth.spec.ts');
  });

  it('CI workflow MUST run security-smoke.spec.js in quality smoke', () => {
    expect(ciWorkflowSource).toContain('security-smoke.spec.js');
  });
});

// =============================================================================
// Playwright Configuration
// =============================================================================

describe('SEC-IAC-07: Playwright Configuration', () => {
  it('MUST have Playwright smoke config', () => {
    expect(fs.existsSync(playwrightConfigPath)).toBe(true);
  });

  it('MUST include tests/api/smoke directory', () => {
    expect(playwrightConfigSource).toContain('./tests/api/smoke');
  });
});
