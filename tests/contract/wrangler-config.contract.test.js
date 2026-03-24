/**
 * Wrangler Configuration Contract Test (Stage-1 Hermetic)
 *
 * Story 4 - Review & Harden wrangler.toml Configuration
 *
 * Purpose:
 *   Hermetic validation of Cloudflare Worker wrangler.toml configuration.
 *   Ensures correct environment sections, routes, zone_id, and environment
 *   variables WITHOUT making HTTP calls.
 *
 * Stage-1 Test (Hermetic):
 *   - No network calls
 *   - Validates configuration file contracts
 *   - Runs in CI without staging environment
 *
 * Acceptance Criteria Validated:
 *   - wrangler.toml defines staging and production sections
 *   - Routes match expected DNS configuration
 *   - zone_name is correctly set for all routes
 *   - Required environment variables are present
 *   - Secrets are NOT stored in config files
 *   - Worker-only mode is enforced (BACKEND_MODE = "worker")
 *   - Obsolete environment sections are removed
 *
 * @see cloudflare-proxy/wrangler.toml - Main configuration
 * @see wrangler.toml - Root staging configuration
 * @see docs/ci-cd-architecture.md - Cloudflare Routing Alignment section
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Source File Paths
// =============================================================================

const PROXY_WRANGLER_PATH = path.join(__dirname, '../../cloudflare-proxy/wrangler.toml');
const ROOT_WRANGLER_PATH = path.join(__dirname, '../../wrangler.toml');
const WORKER_WRANGLER_PATH = path.join(__dirname, '../../worker/wrangler.toml');

// =============================================================================
// Expected Configuration Values (From ci-cd-architecture.md)
// =============================================================================

const EXPECTED_ZONE_NAME = 'eventangle.com';

const EXPECTED_STAGING_ROUTES = [
  'stg.eventangle.com/*',
  'api-stg.eventangle.com/*',
];

// SEC-4.1: www.eventangle.com/* removed - redirected at edge via Cloudflare Redirect Rule
// See docs/RUNBOOK-SEC-4.1-CANONICAL-HOST.md
const EXPECTED_PRODUCTION_ROUTES = [
  'eventangle.com/*',
  'api.eventangle.com/*',
];

// Secrets that must NOT be in config files (only via wrangler secret put)
const FORBIDDEN_SECRETS = [
  'ADMIN_TOKEN',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_SA_CLIENT_EMAIL',
  'GOOGLE_SA_PRIVATE_KEY_PEM',
  'SHEETS_SPREADSHEET_ID',
];

// Obsolete environment sections that should not exist
const OBSOLETE_ENV_SECTIONS = [
  'api-only',
  'events',
];

// =============================================================================
// Helper Functions
// =============================================================================

function readFileContent(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Check if content contains a secret value (not just a comment about the secret)
 */
function hasSecretValue(content, secretName) {
  // Match lines that assign a value to the secret (not commented out)
  const pattern = new RegExp(`^[^#]*${secretName}\\s*=\\s*"[^"]+"|^[^#]*${secretName}\\s*=\\s*'[^']+'`, 'm');
  return pattern.test(content);
}

/**
 * Check if content has an uncommented section header
 */
function hasSection(content, sectionName) {
  return new RegExp(`^\\[${sectionName}\\]`, 'm').test(content);
}

/**
 * Check if content has an uncommented environment section
 */
function hasEnvSection(content, envName) {
  return new RegExp(`^\\[env\\.${envName}\\]`, 'm').test(content);
}

/**
 * Check if content has an uncommented var assignment
 */
function hasVarAssignment(content, varName, expectedValue) {
  if (expectedValue !== undefined) {
    const pattern = new RegExp(`^[^#]*${varName}\\s*=\\s*"${expectedValue}"`, 'm');
    return pattern.test(content);
  }
  const pattern = new RegExp(`^[^#]*${varName}\\s*=\\s*`, 'm');
  return pattern.test(content);
}

/**
 * Check if content has a route pattern
 */
function hasRoutePattern(content, pattern) {
  // Escape special regex characters in the pattern except *
  const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\*');
  const regex = new RegExp(`pattern\\s*=\\s*"${escapedPattern}"`, 'm');
  return regex.test(content);
}

/**
 * Check for uncommented marker in content (for security scanning)
 */
function hasUncommentedMarker(content, markerParts) {
  const marker = markerParts.join('');
  return content.split('\n').some(function checkLine(line) {
    if (line.trim().startsWith('#')) return false;
    return line.indexOf(marker) >= 0;
  });
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Wrangler Configuration Contract (Story 4)', () => {
  let proxyWranglerContent;
  let rootWranglerContent;

  beforeAll(() => {
    proxyWranglerContent = readFileContent(PROXY_WRANGLER_PATH);
    rootWranglerContent = readFileContent(ROOT_WRANGLER_PATH);
  });

  describe('File Structure', () => {
    test('cloudflare-proxy/wrangler.toml exists', () => {
      expect(fs.existsSync(PROXY_WRANGLER_PATH)).toBe(true);
    });

    test('root wrangler.toml exists', () => {
      expect(fs.existsSync(ROOT_WRANGLER_PATH)).toBe(true);
    });

    test('worker/wrangler.toml exists (TypeScript router)', () => {
      expect(fs.existsSync(WORKER_WRANGLER_PATH)).toBe(true);
    });
  });

  describe('Staging Environment Configuration', () => {
    test('staging environment section exists', () => {
      expect(hasEnvSection(proxyWranglerContent, 'staging')).toBe(true);
    });

    test('staging has correct worker name', () => {
      // Look for name within staging section context
      expect(proxyWranglerContent).toMatch(/\[env\.staging\][\s\S]*?name\s*=\s*"eventangle-staging"/);
    });

    test('staging routes include all expected patterns', () => {
      EXPECTED_STAGING_ROUTES.forEach(expectedRoute => {
        expect(hasRoutePattern(proxyWranglerContent, expectedRoute)).toBe(true);
      });
    });

    test('staging routes use correct zone_name', () => {
      expect(proxyWranglerContent).toContain(`zone_name = "${EXPECTED_ZONE_NAME}"`);
    });

    test('staging has WORKER_ENV set to "staging"', () => {
      expect(hasVarAssignment(proxyWranglerContent, 'WORKER_ENV', 'staging')).toBe(true);
    });

    test('staging has BACKEND_MODE set to "worker"', () => {
      expect(hasVarAssignment(proxyWranglerContent, 'BACKEND_MODE', 'worker')).toBe(true);
    });
  });

  describe('Production Environment Configuration', () => {
    test('production environment section exists', () => {
      expect(hasEnvSection(proxyWranglerContent, 'production')).toBe(true);
    });

    test('production has correct worker name', () => {
      expect(proxyWranglerContent).toMatch(/\[env\.production\][\s\S]*?name\s*=\s*"eventangle-prod"/);
    });

    test('production routes include all expected patterns', () => {
      EXPECTED_PRODUCTION_ROUTES.forEach(expectedRoute => {
        expect(hasRoutePattern(proxyWranglerContent, expectedRoute)).toBe(true);
      });
    });

    test('production routes use correct zone_name', () => {
      expect(proxyWranglerContent).toContain(`zone_name = "${EXPECTED_ZONE_NAME}"`);
    });

    test('production has WORKER_ENV set to "production"', () => {
      expect(hasVarAssignment(proxyWranglerContent, 'WORKER_ENV', 'production')).toBe(true);
    });

    test('production has BACKEND_MODE set to "worker"', () => {
      expect(hasVarAssignment(proxyWranglerContent, 'BACKEND_MODE', 'worker')).toBe(true);
    });
  });

  describe('Secrets Handling (Security)', () => {
    test('no secrets are stored as plain values in config', () => {
      FORBIDDEN_SECRETS.forEach(secretName => {
        const hasValue = hasSecretValue(proxyWranglerContent, secretName);
        expect(hasValue).toBe(false);
      });
    });

    test('secrets documentation references wrangler secret put', () => {
      expect(proxyWranglerContent).toContain('wrangler secret put');
    });

    test('config does not contain actual private key content', () => {
      // Check for multi-line private key content (not just header in comments)
      // Actual PEM keys have base64 encoded content after the header
      const hasActualPrivateKey = proxyWranglerContent
        .split('\n')
        .some((line, idx, lines) => {
          // Skip comment lines
          if (line.trim().startsWith('#')) return false;
          // Check for PEM header followed by base64 content
          if (line.includes('-----BEGIN') && line.includes('PRIVATE KEY')) {
            // This would indicate an actual key, not a documentation comment
            const nextLine = lines[idx + 1]?.trim();
            if (nextLine && !nextLine.startsWith('#') && /^[A-Za-z0-9+/=]+$/.test(nextLine)) {
              return true;
            }
          }
          return false;
        });
      expect(hasActualPrivateKey).toBe(false);
    });
  });

  describe('Obsolete Sections Removal (Story 4)', () => {
    test('no obsolete environment sections exist', () => {
      OBSOLETE_ENV_SECTIONS.forEach(section => {
        expect(hasEnvSection(proxyWranglerContent, section)).toBe(false);
      });
    });

    test('no active GAS deployment IDs in vars section', () => {
      // Check for uncommented assignment of GAS deployment IDs in [vars] section
      const hasUncommentedDeploymentId = proxyWranglerContent
        .split('\n')
        .some(line => {
          if (line.trim().startsWith('#')) return false;
          return /^(PROD_)?DEPLOYMENT_ID\s*=\s*"AKfycb/.test(line);
        });
      expect(hasUncommentedDeploymentId).toBe(false);
    });

    test('GAS deployment IDs are not uncommented in config', () => {
      const hasUncommentedDeploymentId = hasUncommentedMarker(
        proxyWranglerContent,
        ['DEPLOYMENT_ID', ' = ', '"AKfycb']
      );
      expect(hasUncommentedDeploymentId).toBe(false);
    });
  });

  describe('Worker-Only Mode Enforcement (Story 5.2)', () => {
    test('BACKEND_MODE is worker in staging (proxy)', () => {
      expect(proxyWranglerContent).toContain('BACKEND_MODE = "worker"');
    });

    test('BACKEND_MODE is worker in production (proxy)', () => {
      // Should appear multiple times for different environments
      const matches = proxyWranglerContent.match(/BACKEND_MODE\s*=\s*"worker"/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBeGreaterThanOrEqual(2); // staging + production
    });

    test('root wrangler.toml uses worker-only mode', () => {
      expect(rootWranglerContent).toContain('BACKEND_MODE = "worker"');
    });

    test('no GAS URLs are uncommented in proxy config', () => {
      const hasUncommentedGasUrl = hasUncommentedMarker(
        proxyWranglerContent,
        ['script.google', '.com/macros/s/', 'AKfycb']
      );
      expect(hasUncommentedGasUrl).toBe(false);
    });

    test('no GAS URLs are uncommented in root config', () => {
      const hasUncommentedGasUrl = hasUncommentedMarker(
        rootWranglerContent,
        ['script.google', '.com/macros/s/', 'AKfycb']
      );
      expect(hasUncommentedGasUrl).toBe(false);
    });
  });

  describe('Environment Alignment (Story 4 Gate)', () => {
    test('staging and production both have WORKER_ENV', () => {
      expect(hasVarAssignment(proxyWranglerContent, 'WORKER_ENV', 'staging')).toBe(true);
      expect(hasVarAssignment(proxyWranglerContent, 'WORKER_ENV', 'production')).toBe(true);
    });

    test('staging and production both have BACKEND_MODE', () => {
      // Count occurrences of BACKEND_MODE = "worker"
      const matches = proxyWranglerContent.match(/BACKEND_MODE\s*=\s*"worker"/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    test('ENABLE_DEBUG_ENDPOINTS is not enabled in production', () => {
      // Production section should not have debug endpoints enabled
      // This checks that if it exists in production, it's not set to "true"
      const productionSection = proxyWranglerContent.match(/\[env\.production\.vars\][\s\S]*?(?=\[|$)/);
      if (productionSection) {
        expect(productionSection[0]).not.toContain('ENABLE_DEBUG_ENDPOINTS = "true"');
      }
    });

    test('DEBUG_LEVEL is "error" in production', () => {
      // Look for DEBUG_LEVEL in production vars section
      expect(proxyWranglerContent).toMatch(/\[env\.production\.vars\][\s\S]*?DEBUG_LEVEL\s*=\s*"error"/);
    });
  });

  describe('Root Wrangler Configuration', () => {
    test('root wrangler.toml is configured for staging', () => {
      expect(rootWranglerContent).toContain('name = "eventangle-staging"');
      expect(rootWranglerContent).toContain('stg.eventangle.com');
    });

    test('root wrangler.toml points to correct worker file', () => {
      expect(rootWranglerContent).toContain('main = "cloudflare-proxy/worker.js"');
    });

    test('root wrangler.toml has WORKER_ENV set to staging', () => {
      expect(rootWranglerContent).toContain('WORKER_ENV = "staging"');
    });
  });

  describe('TypeScript Worker Configuration', () => {
    let workerWranglerContent;

    beforeAll(() => {
      workerWranglerContent = readFileContent(WORKER_WRANGLER_PATH);
    });

    test('TypeScript worker has staging environment', () => {
      expect(hasEnvSection(workerWranglerContent, 'staging')).toBe(true);
    });

    test('TypeScript worker has production environment', () => {
      expect(hasEnvSection(workerWranglerContent, 'production')).toBe(true);
    });

    test('TypeScript worker staging routes match expected patterns', () => {
      expect(hasRoutePattern(workerWranglerContent, 'stg.eventangle.com/*')).toBe(true);
      expect(hasRoutePattern(workerWranglerContent, 'api-stg.eventangle.com/*')).toBe(true);
    });

    // SEC-4.1: www.eventangle.com/* removed - redirected at edge via Cloudflare Redirect Rule
    test('TypeScript worker production routes match expected patterns', () => {
      expect(hasRoutePattern(workerWranglerContent, 'eventangle.com/*')).toBe(true);
      expect(hasRoutePattern(workerWranglerContent, 'api.eventangle.com/*')).toBe(true);
      // www.eventangle.com/* intentionally NOT in Worker routes (SEC-4.1)
      expect(hasRoutePattern(workerWranglerContent, 'www.eventangle.com/*')).toBe(false);
    });
  });
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe('Wrangler Configuration Negative Paths', () => {
  let proxyWranglerContent;

  beforeAll(() => {
    proxyWranglerContent = readFileContent(PROXY_WRANGLER_PATH);
  });

  test('missing required environment variable fails config check', () => {
    // This test verifies the contract - if WORKER_ENV is removed, tests will fail
    expect(proxyWranglerContent).toContain('WORKER_ENV = "staging"');
    expect(proxyWranglerContent).toContain('WORKER_ENV = "production"');
  });

  test('incorrect zone_name would break DNS routing', () => {
    // All routes must use zone_name = "eventangle.com"
    expect(proxyWranglerContent).toContain('zone_name = "eventangle.com"');
    // Should not have any other zone names
    expect(proxyWranglerContent).not.toMatch(/zone_name\s*=\s*"(?!eventangle\.com")[^"]+"/);
  });

  test('mismatched route and DNS would cause 503 errors', () => {
    // Routes must match DNS configuration
    // stg.eventangle.com/* for staging
    // eventangle.com/* for production
    expect(proxyWranglerContent).toContain('stg.eventangle.com/*');
    expect(proxyWranglerContent).toContain('eventangle.com/*');
  });
});
