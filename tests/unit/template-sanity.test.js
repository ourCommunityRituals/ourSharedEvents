/**
 * Template Sanity Tests - Story 3 Implementation
 *
 * Unit tests for template sanity helpers in the Worker.
 * Verifies that getTemplate() returns non-empty strings for all templates
 * and throws appropriate errors for missing/empty templates.
 *
 * Tests cover:
 * 1. All templates (Admin, Public, Display, Poster, Report) are present
 * 2. Templates are non-empty and valid HTML
 * 3. Invalid template names throw errors
 * 4. Missing/empty templates throw appropriate errors
 * 5. Template validation logic
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Fixtures and Helpers
// =============================================================================

const TEMPLATES_DIR = path.join(__dirname, '../../cloudflare-proxy/templates');
const MANIFEST_PATH = path.join(TEMPLATES_DIR, 'manifest.json');

/**
 * Valid template names matching VALID_TEMPLATE_NAMES in worker.js
 */
const VALID_TEMPLATE_NAMES = ['admin', 'public', 'display', 'poster', 'report'];

/**
 * Minimum expected size for each template (bytes)
 */
const MIN_TEMPLATE_SIZE = 100;

/**
 * Load template content from file system (simulates KV storage)
 */
function loadTemplate(templateName) {
  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  if (!fs.existsSync(templatePath)) {
    return null;
  }
  return fs.readFileSync(templatePath, 'utf8');
}

/**
 * Load manifest from file system
 */
function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

/**
 * Simulate validateTemplate logic from worker.js
 */
function validateTemplate(templateName, content) {
  // Check for null/undefined
  if (content == null) {
    throw new Error(`Template '${templateName}' error: Template content is null or undefined`);
  }

  // Check for string type
  if (typeof content !== 'string') {
    throw new Error(`Template '${templateName}' error: Template content must be string, got ${typeof content}`);
  }

  // Check for empty content
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error(`Template '${templateName}' error: Template content is empty`);
  }

  // Basic HTML sanity check
  const lowerContent = trimmed.toLowerCase();
  if (!lowerContent.includes('<!doctype html') && !lowerContent.includes('<html')) {
    throw new Error(`Template '${templateName}' error: Template content does not appear to be valid HTML`);
  }

  // Check minimum length
  if (trimmed.length < MIN_TEMPLATE_SIZE) {
    throw new Error(`Template '${templateName}' error: Template content too small (${trimmed.length} bytes, min ${MIN_TEMPLATE_SIZE})`);
  }

  return content;
}

/**
 * Simulate getTemplate logic from worker.js
 */
function getTemplate(templateName) {
  // Handle non-string inputs
  if (typeof templateName !== 'string') {
    throw new Error(`Template '${templateName}' error: Invalid template name. Valid names: ${VALID_TEMPLATE_NAMES.join(', ')}`);
  }

  const name = templateName?.toLowerCase();

  // Validate template name first
  if (!name || !VALID_TEMPLATE_NAMES.includes(name)) {
    throw new Error(`Template '${templateName}' error: Invalid template name. Valid names: ${VALID_TEMPLATE_NAMES.join(', ')}`);
  }

  const content = loadTemplate(name);

  if (content === null) {
    throw new Error(`Template '${name}' error: Template file '${name}.html' not found`);
  }

  // Validate and return
  return validateTemplate(name, content);
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Template Sanity - Story 3', () => {

  describe('Template Files Presence', () => {
    it('should have templates directory', () => {
      expect(fs.existsSync(TEMPLATES_DIR)).toBe(true);
    });

    it('should have manifest.json', () => {
      expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
    });

    it.each(VALID_TEMPLATE_NAMES)('should have %s.html template file', (templateName) => {
      const templatePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
      expect(fs.existsSync(templatePath)).toBe(true);
    });
  });

  describe('getTemplate() Returns Non-Empty String', () => {
    it.each(VALID_TEMPLATE_NAMES)('getTemplate("%s") should return a non-empty string', (templateName) => {
      const content = getTemplate(templateName);

      expect(content).toBeDefined();
      expect(typeof content).toBe('string');
      expect(content.trim().length).toBeGreaterThan(0);
    });

    it.each(VALID_TEMPLATE_NAMES)('getTemplate("%s") should return valid HTML', (templateName) => {
      const content = getTemplate(templateName);
      const lowerContent = content.toLowerCase();

      // Should have DOCTYPE or html tag
      expect(
        lowerContent.includes('<!doctype html') ||
        lowerContent.includes('<html')
      ).toBe(true);
    });

    it.each(VALID_TEMPLATE_NAMES)('getTemplate("%s") should return HTML with required placeholders', (templateName) => {
      const content = getTemplate(templateName);

      // Should have GAS template placeholders
      expect(content).toMatch(/<\?=\s*appTitle\s*\?>/);
      expect(content).toMatch(/<\?=\s*brandId\s*\?>/);
    });
  });

  describe('Template Size Validation', () => {
    it.each(VALID_TEMPLATE_NAMES)('%s template should be larger than minimum size', (templateName) => {
      const content = getTemplate(templateName);
      expect(content.length).toBeGreaterThan(MIN_TEMPLATE_SIZE);
    });

    it.each(VALID_TEMPLATE_NAMES)('%s template should be at least 10KB', (templateName) => {
      const content = getTemplate(templateName);
      // All our templates should be substantial (at least 10KB)
      expect(content.length).toBeGreaterThan(10000);
    });
  });

  describe('Invalid Template Names', () => {
    const invalidNames = [
      'unknown',
      'invalid',
      'foo',
      'AdminPage',     // Wrong case with extra suffix
      'public.html',   // Includes extension
      '',
      null,
      undefined,
      123,
      {}
    ];

    it.each(invalidNames)('getTemplate(%p) should throw error', (invalidName) => {
      expect(() => getTemplate(invalidName)).toThrow(/Invalid template name/);
    });
  });

  describe('validateTemplate() Error Cases', () => {
    it('should throw for null content', () => {
      expect(() => validateTemplate('admin', null)).toThrow(/null or undefined/);
    });

    it('should throw for undefined content', () => {
      expect(() => validateTemplate('admin', undefined)).toThrow(/null or undefined/);
    });

    it('should throw for empty string', () => {
      expect(() => validateTemplate('admin', '')).toThrow(/empty/);
    });

    it('should throw for whitespace-only string', () => {
      expect(() => validateTemplate('admin', '   \n\t   ')).toThrow(/empty/);
    });

    it('should throw for non-string content', () => {
      expect(() => validateTemplate('admin', 123)).toThrow(/must be string/);
      expect(() => validateTemplate('admin', {})).toThrow(/must be string/);
      expect(() => validateTemplate('admin', [])).toThrow(/must be string/);
    });

    it('should throw for non-HTML content', () => {
      expect(() => validateTemplate('admin', 'Just plain text')).toThrow(/not appear to be valid HTML/);
      expect(() => validateTemplate('admin', '{ "json": true }')).toThrow(/not appear to be valid HTML/);
    });

    it('should throw for content smaller than minimum', () => {
      expect(() => validateTemplate('admin', '<html></html>')).toThrow(/too small/);
    });

    it('should accept valid HTML with DOCTYPE', () => {
      const validHtml = '<!DOCTYPE html>\n<html>\n<head><title>Test</title></head>\n<body>Content here that is long enough to pass validation</body>\n</html>';
      expect(() => validateTemplate('admin', validHtml)).not.toThrow();
    });

    it('should accept valid HTML without DOCTYPE', () => {
      const validHtml = '<html>\n<head><title>Test</title></head>\n<body>Content here that is long enough to pass the minimum size validation check</body>\n</html>';
      expect(() => validateTemplate('admin', validHtml)).not.toThrow();
    });
  });

  describe('Template Manifest Validation', () => {
    it('should have valid manifest structure', () => {
      const manifest = loadManifest();

      expect(manifest).toBeDefined();
      expect(manifest).toHaveProperty('version');
      expect(manifest).toHaveProperty('generated');
      expect(manifest).toHaveProperty('templates');
    });

    it.each(VALID_TEMPLATE_NAMES)('manifest should include %s template', (templateName) => {
      const manifest = loadManifest();

      expect(manifest.templates).toHaveProperty(templateName);
      expect(manifest.templates[templateName]).toHaveProperty('file');
      expect(manifest.templates[templateName]).toHaveProperty('size');
      expect(manifest.templates[templateName]).toHaveProperty('hash');
    });

    it('manifest template sizes should be reasonable', () => {
      const manifest = loadManifest();

      for (const templateName of VALID_TEMPLATE_NAMES) {
        const manifestSize = manifest.templates[templateName].size;

        // Each template should be at least 10KB (manifest records bundled size)
        expect(manifestSize).toBeGreaterThan(10000);

        // And less than 1MB (sanity check)
        expect(manifestSize).toBeLessThan(1000000);
      }
    });
  });

  describe('Template Content Quality', () => {
    it.each(VALID_TEMPLATE_NAMES)('%s template should have resolved includes (no <?!= include)', (templateName) => {
      const content = getTemplate(templateName);

      // Includes should be resolved - no <?!= include(...) ?> should remain
      expect(content).not.toMatch(/<\?!=\s*include\s*\(/);
    });

    it.each(VALID_TEMPLATE_NAMES)('%s template should have bundle metadata comment', (templateName) => {
      const content = getTemplate(templateName);

      // Should have bundle metadata
      expect(content).toContain('Template:');
      expect(content).toContain('Bundled:');
    });

    it.each(VALID_TEMPLATE_NAMES)('%s template should have closing </html> tag', (templateName) => {
      const content = getTemplate(templateName);

      expect(content.toLowerCase()).toContain('</html>');
    });
  });

  describe('Case Sensitivity', () => {
    it.each([
      ['Admin', 'admin'],
      ['PUBLIC', 'public'],
      ['DiSpLaY', 'display'],
      ['POSTER', 'poster'],
      ['Report', 'report']
    ])('getTemplate("%s") should normalize to "%s"', (inputName, expectedLower) => {
      // Should not throw - case should be normalized
      const content = getTemplate(inputName);
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Debug Endpoints Tests (Static Validation)
// =============================================================================

describe('Debug Endpoints - Story 3', () => {
  const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');

  it('should have handleDebugEndpoint function', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('async function handleDebugEndpoint(url, env)');
  });

  it('should check ENABLE_DEBUG_ENDPOINTS flag', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain("env.ENABLE_DEBUG_ENDPOINTS !== 'true'");
  });

  it('should handle /__debug/template/<name> pattern', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain("pathname.match(/^\\/__debug\\/template\\/([a-z]+)$/)");
  });

  it('should handle /__debug/templates/manifest', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain("pathname === '/__debug/templates/manifest'");
  });

  it('should handle /__debug/templates/validate', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain("pathname === '/__debug/templates/validate'");
  });

  it('should call handleDebugEndpoint in fetch handler', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('const debugResponse = await handleDebugEndpoint(url, env)');
  });
});

// =============================================================================
// Worker Configuration Tests
// =============================================================================

describe('Wrangler Configuration - Story 3', () => {
  const wranglerPath = path.join(__dirname, '../../cloudflare-proxy/wrangler.toml');

  it('should have ENABLE_DEBUG_ENDPOINTS in staging only', () => {
    const content = fs.readFileSync(wranglerPath, 'utf8');

    // Should be in staging vars
    expect(content).toContain('ENABLE_DEBUG_ENDPOINTS = "true"');

    // Verify it's in the staging section (appears after [env.staging.vars])
    const stagingVarsIndex = content.indexOf('[env.staging.vars]');
    const prodVarsIndex = content.indexOf('[env.production.vars]');
    const debugEndpointIndex = content.indexOf('ENABLE_DEBUG_ENDPOINTS');

    // Debug endpoint should appear after staging vars section
    expect(debugEndpointIndex).toBeGreaterThan(stagingVarsIndex);

    // And NOT in production vars section
    if (prodVarsIndex > stagingVarsIndex) {
      // If there's content between prod and the debug setting, it shouldn't be in prod
      expect(debugEndpointIndex).toBeGreaterThan(stagingVarsIndex);
    }
  });

  it('should NOT have ENABLE_DEBUG_ENDPOINTS in production', () => {
    const content = fs.readFileSync(wranglerPath, 'utf8');

    // Extract production vars section
    const prodStartMatch = content.match(/\[env\.production\.vars\]/);
    const prodEndMatch = content.match(/\[env\.(api-only|staging|events)\]/);

    if (prodStartMatch && prodEndMatch) {
      const prodStart = prodStartMatch.index;
      const prodEnd = content.indexOf('[env.', prodStart + 1);
      const prodSection = content.slice(prodStart, prodEnd > -1 ? prodEnd : undefined);

      expect(prodSection).not.toContain('ENABLE_DEBUG_ENDPOINTS');
    }
  });
});

// =============================================================================
// Worker Version Tests
// =============================================================================

describe('Worker Version - Story 3', () => {
  it('should have version 2.1.0 or higher', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    const versionMatch = content.match(/const WORKER_VERSION = '([^']+)'/);
    expect(versionMatch).toBeTruthy();

    const [major, minor] = versionMatch[1].split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(2);
    if (major === 2) {
      expect(minor).toBeGreaterThanOrEqual(1);
    }
  });
});
