#!/usr/bin/env node
/**
 * MVP Surface Guardrails - Runtime Surface Check
 *
 * This script validates that only the 5 MVP surfaces are referenced in the codebase.
 * It extracts the canonical list from Code.gs _listMvpSurfaces_() to avoid hardcoding.
 *
 * MVP Surfaces (5 total):
 *   - admin: Event management dashboard
 *   - public: Event listing & registration (default)
 *   - display: TV/kiosk display
 *   - poster: Printable poster with QR
 *   - report: Analytics & sponsor performance (alias: analytics)
 *
 * Usage:
 *   node scripts/check-surfaces.js
 *
 * Exit codes:
 *   0 - All references use valid MVP surfaces
 *   1 - Found invalid/legacy surface references
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_MVP = path.join(ROOT, 'src', 'mvp');
const CODE_GS = path.join(SRC_MVP, 'Code.gs');

// Known API endpoints that use page= but are NOT surfaces (JSON responses)
const API_ENDPOINTS = ['status', 'statusmvp', 'status-mvp', 'setup', 'setupcheck', 'permissions', 'checkpermissions', 'ping', 'whoami'];

// Redirect handlers (not surfaces)
const REDIRECT_PAGES = ['r', 'redirect'];

// Analytics alias for report
const SURFACE_ALIASES = { 'analytics': 'report' };

// V2 surfaces - BLOCKED in MVP router (no longer whitelisted)
// These surfaces are explicitly blocked in Code.gs doGet() to prevent scope creep
// The check-surfaces script should NOT allow references to these surfaces
const BLOCKED_V2_SURFACES = ['templates-v2', 'randomizer', 'teams', 'picker', 'portfolio', 'portfolio-dashboard'];

// ============================================================================
// Extract MVP surfaces from Code.gs
// ============================================================================

// Default MVP surfaces (used when Code.gs is archived after GAS→Worker migration)
// This matches the canonical list from the archived Code.gs _listMvpSurfaces_() function
const DEFAULT_MVP_SURFACES = ['admin', 'public', 'display', 'poster', 'report'];

/**
 * Parse _listMvpSurfaces_() from Code.gs to get the canonical list
 * @returns {string[]} Array of valid MVP surface identifiers
 */
function extractMvpSurfacesFromCode() {
  // Story 1: Check if Code.gs exists (may be archived after GAS→Worker migration)
  if (!fs.existsSync(CODE_GS)) {
    console.log('ℹ️  Code.gs not found in src/mvp/ (archived after GAS→Worker migration)');
    console.log('ℹ️  Using default MVP surfaces:', DEFAULT_MVP_SURFACES.join(', '));
    console.log('ℹ️  See docs/GAS-TO-CLOUDFLARE-MIGRATION.md for architecture details');
    return DEFAULT_MVP_SURFACES;
  }

  const content = fs.readFileSync(CODE_GS, 'utf8');

  // Match the _listMvpSurfaces_ function and extract the array
  const pattern = /function\s+_listMvpSurfaces_\s*\(\s*\)\s*\{\s*return\s*\[([\s\S]*?)\];/;
  const match = content.match(pattern);

  if (!match) {
    console.error('ERROR: Could not find _listMvpSurfaces_() function in Code.gs');
    console.error('Expected pattern: function _listMvpSurfaces_() { return [...]; }');
    process.exit(1);
  }

  // Parse the array contents
  const arrayContents = match[1];
  const surfaces = arrayContents
    .split(',')
    .map(s => s.trim().replace(/['"]/g, ''))
    .filter(s => s.length > 0);

  console.log('📋 MVP surfaces from _listMvpSurfaces_():', surfaces.join(', '));
  return surfaces;
}

// ============================================================================
// Scan for page= references
// ============================================================================

// Known scope values (p= parameter for scope, NOT page)
// These are valid scope parameters, not page references
const SCOPE_VALUES = ['events', 'leagues', 'tournaments', 'sponsors'];

/**
 * Find all page= references in a file
 * @param {string} filePath - Path to file
 * @param {string} content - File content
 * @returns {Array<{line: number, match: string, value: string}>}
 */
function findPageReferences(filePath, content) {
  const results = [];
  const lines = content.split('\n');

  // Patterns to match:
  // 1. ?page=value in URLs (explicit page parameter)
  // 2. page='value' or page="value" or page===value in code
  // 3. pageParam === 'value' comparisons
  // NOTE: We skip ?p= patterns because p= is also used for scope parameter
  const patterns = [
    // URL patterns - only match explicit ?page= (not ?p= which could be scope)
    /[?&]page=([a-zA-Z0-9_-]+)/g,
    // Code patterns with quotes
    /page\s*[=!]=+\s*['"]([a-zA-Z0-9_-]+)['"]/g,
    /pageParam\s*[=!]=+\s*['"]([a-zA-Z0-9_-]+)['"]/g,
    /page:\s*['"]([a-zA-Z0-9_-]+)['"]/g,
    // pageFile_ calls
    /pageFile_\s*\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)/g
  ];

  // Additional pattern for ?p= but we need to filter out scope values
  const pPattern = /[?&]p=([a-zA-Z0-9_-]+)/g;

  lines.forEach((line, index) => {
    patterns.forEach(pattern => {
      let match;
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      while ((match = pattern.exec(line)) !== null) {
        results.push({
          line: index + 1,
          match: match[0],
          value: match[1]
        });
      }
    });

    // Check ?p= separately and filter scope values
    let match;
    pPattern.lastIndex = 0;
    while ((match = pPattern.exec(line)) !== null) {
      const value = match[1];
      // Skip if it's a known scope value
      if (!SCOPE_VALUES.includes(value)) {
        results.push({
          line: index + 1,
          match: match[0],
          value
        });
      }
    }
  });

  return results;
}

/**
 * Check if a page value is valid
 * @param {string} value - Page value to check
 * @param {string[]} mvpSurfaces - Valid MVP surfaces
 * @returns {{valid: boolean, reason?: string}}
 */
function isValidPageValue(value, mvpSurfaces) {
  // Check if it's a blocked V2 surface (not allowed in MVP)
  if (BLOCKED_V2_SURFACES.includes(value)) {
    return { valid: false, reason: 'Blocked V2 surface (not available in MVP)' };
  }

  // Check if it's a valid MVP surface
  if (mvpSurfaces.includes(value)) {
    return { valid: true };
  }

  // Check if it's a known alias
  if (SURFACE_ALIASES[value]) {
    return { valid: true };
  }

  // Check if it's an API endpoint (not a surface)
  if (API_ENDPOINTS.includes(value)) {
    return { valid: true };
  }

  // Check if it's a redirect page
  if (REDIRECT_PAGES.includes(value)) {
    return { valid: true };
  }

  return { valid: false, reason: 'Unknown/legacy surface' };
}

// ============================================================================
// Main scanning logic
// ============================================================================

/**
 * Scan all files in src/mvp for page references
 * @param {string[]} mvpSurfaces - Valid MVP surfaces
 * @returns {{valid: Array, invalid: Array}}
 */
function scanSourceFiles(mvpSurfaces) {
  const valid = [];
  const invalid = [];

  // Get all files in src/mvp
  const files = fs.readdirSync(SRC_MVP)
    .filter(f => f.endsWith('.gs') || f.endsWith('.html'))
    .map(f => path.join(SRC_MVP, f));

  files.forEach(filePath => {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);
    const refs = findPageReferences(filePath, content);

    refs.forEach(ref => {
      const check = isValidPageValue(ref.value, mvpSurfaces);
      const entry = {
        file: fileName,
        line: ref.line,
        match: ref.match,
        value: ref.value
      };

      if (check.valid) {
        valid.push(entry);
      } else {
        invalid.push({ ...entry, reason: check.reason });
      }
    });
  });

  return { valid, invalid };
}

/**
 * Also check Config.gs URL_ALIASES to ensure they only point to MVP surfaces
 * @param {string[]} mvpSurfaces - Valid MVP surfaces
 * @returns {Array} Invalid alias configurations
 */
function checkUrlAliases(mvpSurfaces) {
  const configPath = path.join(SRC_MVP, 'Config.gs');

  // Story 1: Check if Config.gs exists (may be archived after GAS→Worker migration)
  if (!fs.existsSync(configPath)) {
    console.log('ℹ️  Config.gs not found in src/mvp/ (archived after GAS→Worker migration)');
    console.log('ℹ️  Skipping URL_ALIASES check - use wrangler.toml routes instead');
    console.log('ℹ️  See docs/GAS-TO-CLOUDFLARE-MIGRATION.md for architecture details');
    return [];  // No invalid aliases if file doesn't exist
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const invalid = [];

  // Match page: 'value' patterns in URL_ALIASES
  const pattern = /page:\s*['"]([a-zA-Z0-9_-]+)['"]/g;
  const lines = content.split('\n');

  let inUrlAliases = false;
  lines.forEach((line, index) => {
    if (line.includes('URL_ALIASES:')) {
      inUrlAliases = true;
    }
    if (line.includes('BRAND_URL_PATTERNS:')) {
      // Also check custom aliases
    }

    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(line)) !== null) {
      const value = match[1];
      const check = isValidPageValue(value, mvpSurfaces);

      if (!check.valid) {
        invalid.push({
          file: 'Config.gs',
          line: index + 1,
          match: match[0],
          value,
          reason: 'URL alias points to non-MVP surface'
        });
      }
    }
  });

  return invalid;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log('🔍 MVP Surface Guardrails - Checking surface references...\n');

  // Step 1: Extract MVP surfaces from Code.gs
  const mvpSurfaces = extractMvpSurfacesFromCode();
  console.log('');

  // Step 2: Scan source files
  console.log('📂 Scanning src/mvp for page= references...');
  const { valid, invalid } = scanSourceFiles(mvpSurfaces);

  // Step 3: Check URL aliases in Config.gs
  console.log('📂 Checking URL_ALIASES in Config.gs...');
  const aliasInvalid = checkUrlAliases(mvpSurfaces);
  const allInvalid = [...invalid, ...aliasInvalid];

  // Report results
  console.log(`\n✅ Valid references found: ${valid.length}`);

  if (allInvalid.length === 0) {
    console.log('\n🎉 SUCCESS: All page references use valid MVP surfaces!');
    console.log('   No legacy or unknown surfaces detected.');
    process.exit(0);
  } else {
    console.log(`\n❌ INVALID references found: ${allInvalid.length}`);
    console.log('\nThe following page references are not valid MVP surfaces:\n');

    allInvalid.forEach(ref => {
      console.log(`  ${ref.file}:${ref.line}`);
      console.log(`    Match: ${ref.match}`);
      console.log(`    Value: "${ref.value}" - ${ref.reason}`);
      console.log('');
    });

    console.log('Valid MVP surfaces are:', mvpSurfaces.join(', '));
    console.log('Valid aliases:', Object.keys(SURFACE_ALIASES).join(', '));
    console.log('Valid API endpoints:', API_ENDPOINTS.join(', '));
    console.log('Valid redirects:', REDIRECT_PAGES.join(', '));
    console.log('Blocked V2 surfaces:', BLOCKED_V2_SURFACES.join(', '));

    console.log('\n❌ FAILED: Found invalid surface references. Please fix before proceeding.');
    process.exit(1);
  }
}

main();
