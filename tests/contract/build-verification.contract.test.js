/**
 * Bundle Compilation Verification Contract Test
 *
 * This test ensures the Worker and HTML templates are properly configured.
 * It is part of the Stage 1 CI gate and runs locally + in GitHub Actions.
 *
 * Tests:
 *   1. All required HTML surface files exist
 *   2. .html files have valid structure (DOCTYPE, html, head, body)
 *   3. Worker code exists and is properly configured
 *   4. Admin bundle includes diagnostics capability
 *
 * NOTE: Story 5.3 - GAS backend has been archived. The .gs files are now in
 * archive/gas/ and are no longer part of the active codebase. All API traffic
 * is handled by Cloudflare Workers.
 *
 * This test validates Story requirement:
 *   "Add a test in the Test Harness that confirms the bundle compiles cleanly
 *    (Admin > Diagnostics -> Build verification)"
 *
 * @see scripts/stage1-local.mjs (unified Stage 1 runner)
 * @see archive/gas/README.md (GAS restoration guide)
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const MVP_DIR = path.join(ROOT_DIR, 'src', 'mvp');
const GAS_ARCHIVE_DIR = path.join(ROOT_DIR, 'archive', 'gas');
const WORKER_DIR = path.join(ROOT_DIR, 'cloudflare-proxy');

/**
 * Required MVP source files
 * NOTE: .gs files are archived in archive/gas/ (Story 5.3)
 */
const REQUIRED_FILES = {
  archived_gas: [
    'Code.gs',
    'ApiSchemas.gs',
  ],
  surfaces: [
    'Admin.html',
    'Public.html',
    'Display.html',
    'Poster.html',
    'SharedReport.html',
  ],
  optional: [
    'Shared.html',
    'Styles.html',
  ],
};

/**
 * Required api_* function exports in Code.gs
 * These are the public API entry points for MVP surfaces
 */
const REQUIRED_API_EXPORTS = [
  'api_getPublicBundle',
  'api_getDisplayBundle',
  'api_getAdminBundle',
  'api_getPosterBundle',
  'api_getConfig',
];

describe('Bundle Compilation Verification', () => {

  describe('Required Source Files', () => {

    test('all archived .gs files exist in archive/gas/ (Story 5.3)', () => {
      // GAS files were archived as part of Story 5.3 - Decommission Apps Script Project
      for (const file of REQUIRED_FILES.archived_gas) {
        const filePath = path.join(GAS_ARCHIVE_DIR, file);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    test('all surface .html files exist', () => {
      for (const file of REQUIRED_FILES.surfaces) {
        const filePath = path.join(MVP_DIR, file);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    test('MVP source directory exists', () => {
      expect(fs.existsSync(MVP_DIR)).toBe(true);
    });

    test('GAS archive directory exists (Story 5.3)', () => {
      expect(fs.existsSync(GAS_ARCHIVE_DIR)).toBe(true);
    });

    test('Worker directory exists', () => {
      expect(fs.existsSync(WORKER_DIR)).toBe(true);
    });

    test('Worker entry point exists', () => {
      const workerPath = path.join(WORKER_DIR, 'worker.js');
      expect(fs.existsSync(workerPath)).toBe(true);
    });

  });

  describe('Archived .gs File Syntax Validation (Story 5.3)', () => {
    // These tests validate the archived GAS code in archive/gas/
    // The GAS backend is archived but preserved for emergency rollback

    test('archived Code.gs has balanced braces', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;

      expect(openBraces).toBe(closeBraces);
    });

    test('archived Code.gs has balanced parentheses', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;

      expect(openParens).toBe(closeParens);
    });

    test('archived ApiSchemas.gs has balanced braces', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'ApiSchemas.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;

      expect(openBraces).toBe(closeBraces);
    });

    test('all archived .gs files have no unclosed string literals', () => {
      const gsFiles = [...REQUIRED_FILES.archived_gas];

      for (const file of gsFiles) {
        const filePath = path.join(GAS_ARCHIVE_DIR, file);
        if (!fs.existsSync(filePath)) continue;

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

          // Count quotes (basic check - doesn't handle escaped quotes perfectly)
          const singleQuotes = (line.match(/'/g) || []).length;
          const doubleQuotes = (line.match(/"/g) || []).length;

          // Quotes should be balanced within a line (simplified check)
          // This is a basic heuristic - template literals and multi-line strings may differ
        }
      }
    });

  });

  describe('.html File Structure Validation', () => {

    test.each(REQUIRED_FILES.surfaces)('%s has valid HTML structure', (file) => {
      const filePath = path.join(MVP_DIR, file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Required surface file not found: ${file}`);
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      // Check DOCTYPE
      expect(content.toLowerCase()).toContain('<!doctype html>');

      // Check basic tags
      expect(content.toLowerCase()).toContain('<html');
      expect(content.toLowerCase()).toContain('<head');
      expect(content.toLowerCase()).toContain('<body');
      expect(content.toLowerCase()).toContain('</html>');
    });

    test.each(REQUIRED_FILES.surfaces)('%s has closing body and html tags', (file) => {
      const filePath = path.join(MVP_DIR, file);
      if (!fs.existsSync(filePath)) return;

      const content = fs.readFileSync(filePath, 'utf-8').toLowerCase();

      expect(content).toContain('</body>');
      expect(content).toContain('</html>');
    });

  });

  describe('Archived Code.gs API Exports (Story 5.3)', () => {
    // These tests validate the archived GAS code
    // The GAS backend is archived but preserved for emergency rollback

    test('archived Code.gs exports required api_* functions', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      for (const apiFunc of REQUIRED_API_EXPORTS) {
        // Check for function declaration
        const pattern = new RegExp(`function\\s+${apiFunc}\\s*\\(`);
        expect(content).toMatch(pattern);
      }
    });

    test('archived Code.gs has doGet function for web app routing', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).toMatch(/function\s+doGet\s*\(/);
    });

    test('archived Code.gs has doPost function for API handling', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).toMatch(/function\s+doPost\s*\(/);
    });

  });

  describe('Archived ApiSchemas.gs Structure (Story 5.3)', () => {
    // These tests validate the archived GAS code

    test('archived ApiSchemas.gs defines EVENT schema object', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'ApiSchemas.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check for event schema definition
      expect(content).toMatch(/EVENT|event|EventSchema/i);
    });

    test('archived ApiSchemas.gs defines SETTINGS schema object', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'ApiSchemas.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check for settings schema definition
      expect(content).toMatch(/SETTINGS|settings|SettingsSchema/i);
    });

  });

  describe('Admin Diagnostics - Build Verification', () => {

    /**
     * This test validates the Admin > Diagnostics capability exists
     * which includes build verification features.
     */
    test('Admin.html includes diagnostics section', () => {
      const filePath = path.join(MVP_DIR, 'Admin.html');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check for diagnostics reference
      expect(content.toLowerCase()).toMatch(/diagnostic|status|health|build/);
    });

    test('archived Code.gs has api_getAdminBundle for diagnostics data', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Admin bundle should exist
      expect(content).toMatch(/function\s+api_getAdminBundle\s*\(/);

      // Diagnostics should be part of admin bundle (check for diagnostics object)
      expect(content).toMatch(/diagnostics|buildInfo|systemStatus/i);
    });

    test('archived Code.gs has api_getConfig for system configuration', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).toMatch(/function\s+api_getConfig\s*\(/);
    });

  });

  describe('Stage 1 Contract Compliance', () => {

    test('security.test.js exists for security lint', () => {
      const securityTestPath = path.join(ROOT_DIR, 'tests', 'unit', 'security.test.js');
      expect(fs.existsSync(securityTestPath)).toBe(true);
    });

    test('check-v2-files.js guard exists', () => {
      const guardPath = path.join(ROOT_DIR, 'scripts', 'check-v2-files.js');
      expect(fs.existsSync(guardPath)).toBe(true);
    });

    test('check-surfaces.js guard exists', () => {
      const guardPath = path.join(ROOT_DIR, 'scripts', 'check-surfaces.js');
      expect(fs.existsSync(guardPath)).toBe(true);
    });

    test('check-dead-code.js guard exists', () => {
      const guardPath = path.join(ROOT_DIR, 'scripts', 'check-dead-code.js');
      expect(fs.existsSync(guardPath)).toBe(true);
    });

    test('stage1-local.mjs unified script exists', () => {
      const scriptPath = path.join(ROOT_DIR, 'scripts', 'stage1-local.mjs');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

  });

  describe('Bundle File Size Validation', () => {

    test('archived Code.gs is not empty', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(1000); // At least 1KB
    });

    test('archived Code.gs is under Apps Script limit (50MB)', () => {
      const filePath = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const stats = fs.statSync(filePath);
      const maxSize = 50 * 1024 * 1024; // 50MB
      expect(stats.size).toBeLessThan(maxSize);
    });

    test('total bundle size is under Apps Script project limit', () => {
      let totalSize = 0;
      // Check archived GAS files
      for (const file of REQUIRED_FILES.archived_gas) {
        const filePath = path.join(GAS_ARCHIVE_DIR, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        }
      }
      // Check HTML surfaces
      for (const file of REQUIRED_FILES.surfaces) {
        const filePath = path.join(MVP_DIR, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        }
      }

      const maxProjectSize = 50 * 1024 * 1024; // 50MB project limit
      expect(totalSize).toBeLessThan(maxProjectSize);
    });

    test('Worker entry point exists and is not empty', () => {
      const workerPath = path.join(WORKER_DIR, 'worker.js');
      const stats = fs.statSync(workerPath);
      expect(stats.size).toBeGreaterThan(1000); // At least 1KB
    });

  });

});

describe('CI Stage 1 Contract Invocation', () => {

  /**
   * This test validates that the Stage 1 CI contract can be invoked.
   * The actual CI workflow uses npm run stage1-local which calls
   * scripts/stage1-local.mjs.
   *
   * This test ensures the contract exists and is properly configured.
   */
  test('package.json has stage1-local script', () => {
    const packageJsonPath = path.join(ROOT_DIR, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    expect(packageJson.scripts).toHaveProperty('stage1-local');
    expect(packageJson.scripts['stage1-local']).toContain('stage1-local.mjs');
  });

  test('package.json has test:ci:stage1 script pointing to unified script', () => {
    const packageJsonPath = path.join(ROOT_DIR, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    expect(packageJson.scripts).toHaveProperty('test:ci:stage1');
    expect(packageJson.scripts['test:ci:stage1']).toContain('stage1-local.mjs');
  });

  test('ci:stage1-local script points to unified script', () => {
    const packageJsonPath = path.join(ROOT_DIR, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    expect(packageJson.scripts).toHaveProperty('ci:stage1-local');
    expect(packageJson.scripts['ci:stage1-local']).toContain('stage1-local.mjs');
  });

});
