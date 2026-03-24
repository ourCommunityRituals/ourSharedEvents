/**
 * Wiring Diagram Sync Contract Tests
 *
 * LOCKED CONTRACT: Ensures the wiring diagram stays in sync with:
 * - Surface HTML files' NU.rpc() calls
 * - Code.gs _listMvpApis_() function
 * - Analytics metrics fed/read by each surface
 *
 * TEST FAILS IF:
 * - A surface makes an RPC call not reflected in the wiring diagram
 * - An API in _listMvpApis_() is not referenced in the diagram (orphaned)
 * - The wiring diagram is out of date with source code
 *
 * RUN: npm test -- tests/contract/wiring-diagram-sync.test.js
 *
 * @see /docs/wiring-admin-public-display-poster-report.json
 * @see /scripts/generate-wiring-diagram.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Paths
// ============================================================================

const ROOT = path.join(__dirname, '../..');
const WIRING_JSON = path.join(ROOT, 'docs/wiring-admin-public-display-poster-report.json');
// Story 5.3: GAS files archived to archive/gas/
const CODE_GS = path.join(ROOT, 'archive/gas/Code.gs');
const SRC_MVP = path.join(ROOT, 'src/mvp');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load the committed wiring diagram
 */
function loadWiringDiagram() {
  if (!fs.existsSync(WIRING_JSON)) {
    throw new Error('Wiring diagram not found. Run: node scripts/generate-wiring-diagram.js');
  }
  return JSON.parse(fs.readFileSync(WIRING_JSON, 'utf8'));
}

/**
 * Extract MVP APIs from Code.gs
 */
function extractMvpApis() {
  const content = fs.readFileSync(CODE_GS, 'utf8');
  const pattern = /function\s+_listMvpApis_\s*\(\s*\)\s*\{\s*return\s*\[([\s\S]*?)\];/;
  const match = content.match(pattern);

  if (!match) {
    throw new Error('Could not find _listMvpApis_() in Code.gs');
  }

  return match[1]
    .split(',')
    .map(s => s.trim().replace(/['"]/g, ''))
    .filter(s => s.length > 0);
}

/**
 * Extract RPC calls from a surface file
 */
function extractRpcCalls(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const calls = new Set();

  // Match NU.rpc('api_name', ...) patterns
  const rpcPattern = /NU\.rpc\s*\(\s*['"]([a-zA-Z_]+)['"]/g;
  let match;

  while ((match = rpcPattern.exec(content)) !== null) {
    calls.add(match[1]);
  }

  // Also detect dynamic RPC patterns (e.g., rpcName = 'api_xxx')
  const dynamicRpcPattern = /['"]api_[a-zA-Z_]+['"]/g;
  while ((match = dynamicRpcPattern.exec(content)) !== null) {
    const apiName = match[0].replace(/['"]/g, '');
    const idx = match.index;
    const before = content.substring(Math.max(0, idx - 100), idx);
    if (before.match(/(?:rpcName|apiName|endpoint|method)\s*[=:?]|NU\.rpc\s*\(/)) {
      calls.add(apiName);
    }
  }

  return Array.from(calls).sort();
}

// ============================================================================
// Tests
// ============================================================================

describe('Wiring Diagram Sync Contract', () => {
  let diagram;

  beforeAll(() => {
    diagram = loadWiringDiagram();
  });

  describe('Wiring diagram exists and is valid', () => {
    test('wiring diagram JSON file exists', () => {
      expect(fs.existsSync(WIRING_JSON)).toBe(true);
    });

    test('wiring diagram has required structure', () => {
      expect(diagram).toHaveProperty('_meta');
      expect(diagram).toHaveProperty('mvpApis');
      expect(diagram).toHaveProperty('surfaces');
      expect(diagram).toHaveProperty('apiUsage');
    });

    test('all expected surfaces are present', () => {
      const expectedSurfaces = ['Admin', 'Public', 'Display', 'Poster', 'SharedReport'];
      expectedSurfaces.forEach(surface => {
        expect(diagram.surfaces).toHaveProperty(surface);
      });
    });
  });

  describe('MVP APIs match _listMvpApis_()', () => {
    test('diagram mvpApis matches Code.gs _listMvpApis_()', () => {
      const codeApis = extractMvpApis();
      expect(diagram.mvpApis).toEqual(codeApis);
    });

    test('no orphaned APIs in the diagram', () => {
      // ZEVENT-003: These APIs are intentionally orphaned - kept for backward compatibility
      // but no longer called by Admin (migrated to api_saveEvent)
      // Story 2.2: api_getPublicBundle and api_list are now served by Cloudflare Worker, not GAS RPC
      // Story 2.3: api_get and api_getEventTemplates migrated to Worker adminBundle
      const allowedOrphanedApis = ['api_create', 'api_updateEventData', 'api_getPublicBundle', 'api_list', 'api_get', 'api_getEventTemplates'];

      const orphanedApis = diagram.orphanedApis || [];
      const unexpectedOrphans = orphanedApis.filter(api => !allowedOrphanedApis.includes(api));

      if (unexpectedOrphans.length > 0) {
        throw new Error(
          `Orphaned APIs found (in _listMvpApis_ but not called by any surface): ${unexpectedOrphans.join(', ')}\n` +
          `Either the API is unused and should be removed from _listMvpApis_(), ` +
          `or the wiring diagram needs to be regenerated.`
        );
      }
      expect(unexpectedOrphans).toHaveLength(0);
    });
  });

  describe('Surface RPC calls match diagram', () => {
    const surfaces = {
      Admin: 'Admin.html',
      Public: 'Public.html',
      Display: 'Display.html',
      Poster: 'Poster.html',
      SharedReport: 'SharedReport.html'
    };

    Object.entries(surfaces).forEach(([name, file]) => {
      test(`${name} RPC calls are documented in diagram`, () => {
        const filePath = path.join(SRC_MVP, file);
        if (!fs.existsSync(filePath)) {
          return; // Skip if file doesn't exist
        }

        const actualCalls = extractRpcCalls(filePath);
        const diagramCalls = diagram.surfaces[name]?.calls || [];

        // Check for calls in source but not in diagram
        const missingFromDiagram = actualCalls.filter(c => !diagramCalls.includes(c));
        if (missingFromDiagram.length > 0) {
          throw new Error(
            `${name} has RPC calls not in wiring diagram: ${missingFromDiagram.join(', ')}\n` +
            `Regenerate the diagram: node scripts/generate-wiring-diagram.js`
          );
        }

        expect(missingFromDiagram).toHaveLength(0);
      });
    });
  });

  describe('Wiring diagram is fresh', () => {
    test('diagram matches regenerated output (--check mode)', () => {
      // Run the generator in check mode
      try {
        execSync('node scripts/generate-wiring-diagram.js --check', {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: 'pipe'
        });
      } catch (error) {
        // The --check mode exits with code 1 if out of sync
        const output = error.stdout || error.message;
        throw new Error(
          `Wiring diagram is out of sync with source code!\n` +
          `Run: node scripts/generate-wiring-diagram.js\n\n` +
          output
        );
      }
    });
  });

  describe('Analytics flow integrity', () => {
    test('surfaces that feed analytics have feedsAnalytics array', () => {
      // Public, Display, Poster should feed analytics
      const feedingSurfaces = ['Public', 'Display', 'Poster'];
      feedingSurfaces.forEach(name => {
        const surface = diagram.surfaces[name];
        expect(surface).toHaveProperty('feedsAnalytics');
        expect(surface.feedsAnalytics.length).toBeGreaterThan(0);
      });
    });

    test('SharedReport reads analytics data', () => {
      const report = diagram.surfaces.SharedReport;
      expect(report).toHaveProperty('readsAnalytics');
      expect(report.readsAnalytics).toContain('summary');
      expect(report.readsAnalytics).toContain('surfaces');
    });

    test('Admin links to other surfaces', () => {
      const admin = diagram.surfaces.Admin;
      expect(admin).toHaveProperty('surfacedLinks');
      expect(admin.surfacedLinks).toContain('public');
      expect(admin.surfacedLinks).toContain('display');
      expect(admin.surfacedLinks).toContain('poster');
      expect(admin.surfacedLinks).toContain('report');
    });
  });

  describe('API usage coverage', () => {
    test('all MVP APIs are used by at least one surface', () => {
      // ZEVENT-003: These APIs are intentionally orphaned - kept for backward compatibility
      // but no longer called by Admin (migrated to api_saveEvent)
      // Story 2.2: api_getPublicBundle and api_list are now served by Cloudflare Worker, not GAS RPC
      // Story 2.3: api_get and api_getEventTemplates migrated to Worker adminBundle
      const allowedOrphanedApis = ['api_create', 'api_updateEventData', 'api_getPublicBundle', 'api_list', 'api_get', 'api_getEventTemplates'];

      const mvpApis = diagram.mvpApis;
      const orphaned = [];

      mvpApis.forEach(api => {
        const usage = diagram.apiUsage[api];
        if (!usage || usage.usedBy.length === 0) {
          orphaned.push(api);
        }
      });

      // Filter out allowed orphaned APIs
      const unexpectedOrphans = orphaned.filter(api => !allowedOrphanedApis.includes(api));

      if (unexpectedOrphans.length > 0) {
        throw new Error(
          `MVP APIs with no surface usage: ${unexpectedOrphans.join(', ')}\n` +
          `These APIs should either be used by a surface or removed from _listMvpApis_()`
        );
      }

      expect(unexpectedOrphans).toHaveLength(0);
    });

    test('each surface uses appropriate bundle API', () => {
      // Verify surfaces use their expected bundle APIs
      // Story 2.2: Public now uses Cloudflare Worker endpoint instead of GAS api_getPublicBundle
      // Public.html calls /api/events/:id/publicBundle directly via fetch
      expect(diagram.surfaces.Display.calls).toContain('api_getDisplayBundle');
      expect(diagram.surfaces.Poster.calls).toContain('api_getPosterBundle');
      expect(diagram.surfaces.SharedReport.calls).toContain('api_getSharedAnalytics');
    });
  });
});
