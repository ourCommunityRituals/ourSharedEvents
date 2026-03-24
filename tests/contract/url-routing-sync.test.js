/**
 * URL Routing Sync Contract Test
 *
 * Story 5.3: GAS is retired. Worker is the single source of truth for routing.
 *
 * This test now verifies:
 *   - Worker pathToPage covers all MVP surfaces
 *   - Config.gs (archived) still has correct mappings for reference
 *
 * Contract:
 *   - Worker pathToPage must cover all MVP surfaces
 *   - Both must agree on: events, admin, display, poster, report, status
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Source Extractors
// ============================================================================

/**
 * Extract pathToPage mapping from worker.js
 * Parses the CANONICAL_PATH_TO_PAGE constant from the source
 */
function extractWorkerPathToPage() {
  const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
  const content = fs.readFileSync(workerPath, 'utf8');

  // Find the CANONICAL_PATH_TO_PAGE object in the source
  // Format: const CANONICAL_PATH_TO_PAGE = Object.freeze({ 'events': 'public', ... })
  const regex = /const\s+CANONICAL_PATH_TO_PAGE\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/;
  const match = content.match(regex);

  if (!match) {
    throw new Error('Could not find CANONICAL_PATH_TO_PAGE in worker.js');
  }

  // Parse the object literal
  const mapping = {};
  const entries = match[1].matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g);

  for (const entry of entries) {
    mapping[entry[1]] = entry[2];
  }

  return mapping;
}

/**
 * Extract URL_ALIASES from Config.gs (archived)
 * Story 5.3: Config.gs moved to archive/gas/ after GAS retirement
 * Parses the JavaScript object literal from the source
 */
function extractConfigUrlAliases() {
  // Story 5.3: GAS files archived to archive/gas/
  const configPath = path.join(__dirname, '../../archive/gas/Config.gs');
  const content = fs.readFileSync(configPath, 'utf8');

  // Find URL_ALIASES block
  // This is more complex as it spans multiple lines
  const startIndex = content.indexOf('URL_ALIASES:');
  if (startIndex === -1) {
    throw new Error('Could not find URL_ALIASES in Config.gs');
  }

  // Find the opening brace after URL_ALIASES:
  const braceStart = content.indexOf('{', startIndex);
  if (braceStart === -1) {
    throw new Error('Could not find URL_ALIASES opening brace');
  }

  // Find matching closing brace (handle nested braces)
  let braceCount = 1;
  let braceEnd = braceStart + 1;
  while (braceCount > 0 && braceEnd < content.length) {
    if (content[braceEnd] === '{') braceCount++;
    if (content[braceEnd] === '}') braceCount--;
    braceEnd++;
  }

  const aliasBlock = content.substring(braceStart, braceEnd);

  // Parse alias entries
  // Format: 'alias': { page: 'pageName', label: '...', public: bool }
  const mapping = {};
  const entryRegex = /'([^']+)':\s*\{\s*page:\s*'([^']+)'/g;
  let match;

  while ((match = entryRegex.exec(aliasBlock)) !== null) {
    mapping[match[1]] = match[2];
  }

  return mapping;
}

// ============================================================================
// MVP Contract Definition
// ============================================================================

// The 5 MVP surfaces + status endpoint
// These are the canonical routes that MUST work
const MVP_CANONICAL_ROUTES = {
  'events': 'public',     // /events → Public.html
  'admin': 'admin',       // /admin → Admin.html
  'display': 'display',   // /display → Display.html
  'poster': 'poster',     // /poster → Poster.html
  'analytics': 'report',  // /analytics → SharedReport.html (canonical for report)
  'status': 'status'      // /status → JSON status
};

// Additional aliases that should also work (but have alternates)
const EXPECTED_ALIASES = {
  // Public aliases
  'schedule': 'public',
  'calendar': 'public',
  // Admin aliases
  'manage': 'admin',
  'create': 'admin',
  'dashboard': 'admin',
  // Display aliases
  'tv': 'display',
  'kiosk': 'display',
  'screen': 'display',
  // Poster aliases
  'posters': 'poster',
  'flyers': 'poster',
  // Report aliases
  'reports': 'report',
  'insights': 'report',
  'stats': 'report',
  // Status aliases
  'health': 'status'
};

// ============================================================================
// Tests
// ============================================================================

describe('URL Routing Sync Contract', () => {
  let workerMapping;
  let configMapping;

  beforeAll(() => {
    workerMapping = extractWorkerPathToPage();
    configMapping = extractConfigUrlAliases();
  });

  describe('Worker pathToPage extraction', () => {
    it('should successfully extract pathToPage from worker.js', () => {
      expect(workerMapping).toBeDefined();
      expect(Object.keys(workerMapping).length).toBeGreaterThan(0);
    });

    it('should contain all MVP canonical routes', () => {
      for (const [alias, page] of Object.entries(MVP_CANONICAL_ROUTES)) {
        expect(workerMapping[alias]).toBe(page);
      }
    });
  });

  describe('Config URL_ALIASES extraction', () => {
    it('should successfully extract URL_ALIASES from Config.gs', () => {
      expect(configMapping).toBeDefined();
      expect(Object.keys(configMapping).length).toBeGreaterThan(0);
    });

    it('should contain all MVP canonical routes', () => {
      for (const [alias, page] of Object.entries(MVP_CANONICAL_ROUTES)) {
        expect(configMapping[alias]).toBe(page);
      }
    });
  });

  describe('Worker <-> Config sync', () => {
    it('canonical MVP routes must match between Worker and Config', () => {
      const mismatches = [];

      for (const [alias, expectedPage] of Object.entries(MVP_CANONICAL_ROUTES)) {
        const workerPage = workerMapping[alias];
        const configPage = configMapping[alias];

        if (workerPage !== expectedPage) {
          mismatches.push(`Worker: ${alias} -> ${workerPage} (expected ${expectedPage})`);
        }
        if (configPage !== expectedPage) {
          mismatches.push(`Config: ${alias} -> ${configPage} (expected ${expectedPage})`);
        }
      }

      if (mismatches.length > 0) {
        throw new Error(`MVP canonical route mismatches:\n  ${mismatches.join('\n  ')}`);
      }
    });

    it('common aliases should map to same pages in both sources', () => {
      const sharedAliases = Object.keys(workerMapping).filter(
        alias => alias in configMapping
      );

      const mismatches = [];
      for (const alias of sharedAliases) {
        if (workerMapping[alias] !== configMapping[alias]) {
          mismatches.push(
            `${alias}: Worker=${workerMapping[alias]}, Config=${configMapping[alias]}`
          );
        }
      }

      if (mismatches.length > 0) {
        throw new Error(`Alias mapping mismatches:\n  ${mismatches.join('\n  ')}`);
      }
    });

    it('Config should have expected aliases', () => {
      const allExpected = { ...MVP_CANONICAL_ROUTES, ...EXPECTED_ALIASES };
      const missing = [];

      for (const [alias, page] of Object.entries(allExpected)) {
        if (!(alias in configMapping)) {
          missing.push(`${alias} (expected -> ${page})`);
        } else if (configMapping[alias] !== page) {
          missing.push(`${alias}: got ${configMapping[alias]}, expected ${page}`);
        }
      }

      if (missing.length > 0) {
        throw new Error(`Config missing or mismatched aliases:\n  ${missing.join('\n  ')}`);
      }
    });
  });

  describe('Page coverage', () => {
    const MVP_PAGES = ['public', 'admin', 'display', 'poster', 'report', 'status'];

    it('Worker should route to all MVP pages', () => {
      const workerPages = new Set(Object.values(workerMapping));
      const missing = MVP_PAGES.filter(p => !workerPages.has(p));

      expect(missing).toEqual([]);
    });

    it('Config should have aliases for all MVP pages', () => {
      const configPages = new Set(Object.values(configMapping));
      const missing = MVP_PAGES.filter(p => !configPages.has(p));

      expect(missing).toEqual([]);
    });
  });

  describe('Snapshot consistency', () => {
    it('Worker pathToPage should match expected snapshot', () => {
      // This will fail if worker.js changes unexpectedly
      // Update snapshot with: npm test -- --updateSnapshot
      expect(workerMapping).toMatchSnapshot();
    });

    it('Config URL_ALIASES should match expected snapshot', () => {
      // This will fail if Config.gs URL_ALIASES changes unexpectedly
      expect(configMapping).toMatchSnapshot();
    });
  });
});
