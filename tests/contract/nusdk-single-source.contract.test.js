/**
 * NUSDK Single Source of Truth Contract Test
 *
 * Story 1: Centralize SDK Injection
 *
 * This test ensures:
 * 1. window.NU is defined ONLY in NUSDK.html (single source of truth)
 * 2. All active MVP surface templates include NUSDK.html
 * 3. No surface template has an inline window.NU redefinition
 * 4. NU is available on every page exactly once (no drift)
 *
 * Acceptance Criteria:
 * - Every reference to window.NU, postMessage, or NU bootstrap is cataloged
 * - A single file (NUSDK.html) is selected as canonical NU SDK
 * - All other templates reference this SDK; no file redefines NU
 * - No behavior change
 *
 * @see src/mvp/NUSDK.html - The canonical NU SDK
 */

const fs = require('fs');
const path = require('path');

describe('NUSDK Single Source of Truth', () => {
  const srcDir = path.join(__dirname, '../../src/mvp');
  const nusdkPath = path.join(srcDir, 'NUSDK.html');

  // All active MVP surface templates that should include NUSDK
  const activeSurfaceTemplates = [
    'Admin.html',
    'Public.html',
    'Display.html',
    'Poster.html',
    'SharedReport.html'
  ];

  // Files that are allowed to reference window.NU but should NOT define it
  const allowedNUReferences = [
    'SharedUtils.html',  // Delegates to NU.esc
    'SponsorUtils.html', // Uses NU.safeAnalytics etc.
  ];

  // =============================================================================
  // CANONICAL SDK TESTS
  // =============================================================================

  describe('Canonical SDK Location', () => {
    test('NUSDK.html should exist', () => {
      expect(fs.existsSync(nusdkPath)).toBe(true);
    });

    test('NUSDK.html should be the ONLY file that defines window.NU = {', () => {
      // Read all .html files in src/mvp
      const htmlFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.html'));

      const filesDefiningNU = [];

      for (const file of htmlFiles) {
        const filePath = path.join(srcDir, file);
        const content = fs.readFileSync(filePath, 'utf8');

        // Look for window.NU = { definition (not just usage)
        // This pattern matches "window.NU = {" which is the assignment
        if (/window\.NU\s*=\s*\{/.test(content)) {
          filesDefiningNU.push(file);
        }
      }

      // ONLY NUSDK.html should define window.NU
      expect(filesDefiningNU).toEqual(['NUSDK.html']);
    });

    test('NUSDK.html should define the required NU methods', () => {
      const content = fs.readFileSync(nusdkPath, 'utf8');

      // Required methods per NUSDK documentation
      const requiredMethods = [
        'rpc',           // Core RPC method
        'swr',           // Stale-while-revalidate
        'esc',           // XSS escape
        'safeRpc',       // Graceful error handling
        'safeAnalytics', // Fire-and-forget analytics
        'flush',         // Flush pending requests (v2.0)
      ];

      for (const method of requiredMethods) {
        // Check for method definition (either async methodName or methodName:)
        const methodPattern = new RegExp(`(async\\s+)?${method}\\s*[:(]`);
        expect(content).toMatch(methodPattern);
      }
    });

    test('NUSDK.html should define VERSION property (v2.0+)', () => {
      const content = fs.readFileSync(nusdkPath, 'utf8');
      expect(content).toMatch(/VERSION:\s*['"][0-9]+\.[0-9]+\.[0-9]+['"]/);
    });

    test('NUSDK.html should define rolling log buffer window.__NU_LOGS__ (v2.0+)', () => {
      const content = fs.readFileSync(nusdkPath, 'utf8');
      expect(content).toMatch(/window\.__NU_LOGS__\s*=\s*\[\]/);
    });

    test('NUSDK.html should define NU_DIAG diagnostic helper (v2.0+)', () => {
      const content = fs.readFileSync(nusdkPath, 'utf8');
      expect(content).toMatch(/window\.NU_DIAG\s*=\s*\{/);
    });

    test('NUSDK.html should support path-based routing (v2.0+)', () => {
      const content = fs.readFileSync(nusdkPath, 'utf8');
      // Check for /api/<path> pattern support
      expect(content).toMatch(/apiBase:\s*['"]\/api['"]/);
    });
  });

  // =============================================================================
  // SURFACE TEMPLATE INCLUSION TESTS
  // =============================================================================

  describe('Surface Templates', () => {
    test.each(activeSurfaceTemplates)(
      '%s should include NUSDK.html via GAS template include',
      (surfaceFile) => {
        const filePath = path.join(srcDir, surfaceFile);

        if (!fs.existsSync(filePath)) {
          console.warn(`[SKIP] ${surfaceFile} not found at ${filePath}`);
          return;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        // Check for GAS include pattern
        const includePattern = /<\?!?=\s*include\(['"]NUSDK['"]\)\s*;?\s*\?>/;
        expect(content).toMatch(includePattern);
      }
    );

    test.each(activeSurfaceTemplates)(
      '%s should NOT have inline window.NU = { definition',
      (surfaceFile) => {
        const filePath = path.join(srcDir, surfaceFile);

        if (!fs.existsSync(filePath)) {
          console.warn(`[SKIP] ${surfaceFile} not found at ${filePath}`);
          return;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        // Should NOT have window.NU = { (that's NUSDK's job)
        const nuDefinitionPattern = /window\.NU\s*=\s*\{/;
        expect(content).not.toMatch(nuDefinitionPattern);
      }
    );
  });

  // =============================================================================
  // NO DUPLICATE DEFINITIONS TESTS
  // =============================================================================

  describe('No Duplicate Definitions', () => {
    test('No active src/mvp file should redefine window.NU except NUSDK.html', () => {
      const htmlFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.html'));

      const violations = [];

      for (const file of htmlFiles) {
        if (file === 'NUSDK.html') continue; // Skip the canonical file

        const filePath = path.join(srcDir, file);
        const content = fs.readFileSync(filePath, 'utf8');

        // Check for any window.NU = { assignment
        if (/window\.NU\s*=\s*\{/.test(content)) {
          violations.push(file);
        }
      }

      expect(violations).toEqual([]);
    });

    test('No file should redefine NU.rpc method', () => {
      const htmlFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.html'));

      const violations = [];

      for (const file of htmlFiles) {
        if (file === 'NUSDK.html') continue;

        const filePath = path.join(srcDir, file);
        const content = fs.readFileSync(filePath, 'utf8');

        // Check for NU.rpc = function or window.NU.rpc = function
        // But allow usage like NU.rpc('method', payload)
        if (/(?:window\.)?NU\.rpc\s*=\s*function/.test(content)) {
          violations.push(file);
        }
      }

      expect(violations).toEqual([]);
    });
  });

  // =============================================================================
  // DELEGATE PATTERN VERIFICATION
  // =============================================================================

  describe('Delegate Pattern', () => {
    test('SharedUtils.html should delegate esc() to NU.esc when available', () => {
      const sharedUtilsPath = path.join(srcDir, 'SharedUtils.html');

      if (!fs.existsSync(sharedUtilsPath)) {
        console.warn('[SKIP] SharedUtils.html not found');
        return;
      }

      const content = fs.readFileSync(sharedUtilsPath, 'utf8');

      // Should check for NU.esc availability before using it
      expect(content).toMatch(/window\.NU\s*&&.*NU\.esc/);
    });
  });

  // =============================================================================
  // LEGACY POSTMESSAGE BRIDGE CHECK
  // =============================================================================

  describe('No Legacy PostMessage Bridge', () => {
    test.each(activeSurfaceTemplates)(
      '%s should not have legacy postMessage bridge for backend calls',
      (surfaceFile) => {
        const filePath = path.join(srcDir, surfaceFile);

        if (!fs.existsSync(filePath)) {
          console.warn(`[SKIP] ${surfaceFile} not found`);
          return;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        // Check for postMessage patterns used for backend RPC (not valid UI postMessage)
        // Legacy pattern: window.parent.postMessage for API calls
        const legacyRpcPattern = /postMessage\s*\(\s*\{[^}]*(?:method|action|rpc)[^}]*\}/i;
        expect(content).not.toMatch(legacyRpcPattern);
      }
    );
  });

  // =============================================================================
  // SDK INCLUDE ORDER
  // =============================================================================

  describe('Include Order', () => {
    test.each(activeSurfaceTemplates)(
      '%s should include NUSDK before SharedUtils (if both included)',
      (surfaceFile) => {
        const filePath = path.join(srcDir, surfaceFile);

        if (!fs.existsSync(filePath)) {
          console.warn(`[SKIP] ${surfaceFile} not found`);
          return;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        // Find positions of includes
        const nusdkInclude = content.search(/include\(['"]NUSDK['"]\)/);
        const sharedUtilsInclude = content.search(/include\(['"]SharedUtils['"]\)/);

        // If both are included, NUSDK should come first
        if (nusdkInclude !== -1 && sharedUtilsInclude !== -1) {
          expect(nusdkInclude).toBeLessThan(sharedUtilsInclude);
        }
      }
    );
  });
});
