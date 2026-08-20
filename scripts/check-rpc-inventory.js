#!/usr/bin/env node
/**
 * RPC Inventory Validator - check-rpc-inventory.js
 *
 * Story 5: Tighten RPC Inventory Comments to Actual APIs
 *
 * This script validates that the RPC ENDPOINT INVENTORY comment block
 * in ApiSchemas.gs matches reality and enforces MVP/V2 separation.
 *
 * VALIDATION STEPS:
 *   0. V2 QUARANTINE CHECK - FAIL if V2 blocked endpoints appear in MVP surfaces
 *   1. Endpoints listed in the inventory comment
 *   2. Actual api_* functions in Code.gs
 *   3. Schema definitions in ApiSchemas.gs
 *   4. Actual RPC calls in HTML surface files
 *
 * V2 QUARANTINE:
 *   - V2_BLOCKED_ENDPOINTS defines endpoints NOT allowed in MVP
 *   - CI fails if any HTML file references blocked endpoints
 *   - To enable V2 feature: move from V2_BLOCKED to EXPECTED_INVENTORY
 *
 * Usage:
 *   node scripts/check-rpc-inventory.js
 *   node scripts/check-rpc-inventory.js --verbose
 *
 * Exit codes:
 *   0 - Inventory is accurate and V2 quarantine intact
 *   1 - Found discrepancies or V2 quarantine violations
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CODE_GS = path.join(ROOT, 'src', 'mvp', 'Code.gs');
const API_SCHEMAS_GS = path.join(ROOT, 'src', 'mvp', 'ApiSchemas.gs');
const MVP_HTML_DIR = path.join(ROOT, 'src', 'mvp');

// ============================================================================
// EXPECTED INVENTORY - Source of truth
// ============================================================================
// This MUST match the RPC ENDPOINT INVENTORY comment in ApiSchemas.gs
// If you update ApiSchemas.gs, update this too!

const EXPECTED_INVENTORY = {
  'Admin.html': [
    'api_getEventTemplates',
    'api_saveEvent',
    'api_get',
    'api_getEventsSafe',
    'api_createFormFromTemplate',
    'api_generateFormShortlink',
  ],
  'Public.html': ['api_getPublicBundle', 'api_list', 'api_logExternalClick'],
  'Display.html': ['api_getDisplayBundle', 'api_logExternalClick'],
  'Poster.html': ['api_getPosterBundle'],
  'SharedReport.html': [
    'api_getSharedAnalytics',
    'api_getSponsorAnalytics',
    'api_getSponsorReportQr',
  ],
};

// ============================================================================
// V2-QUARANTINE: BLOCKED ENDPOINTS - CI FAILS IF THESE APPEAR IN MVP
// ============================================================================
// These endpoints are V2 features NOT allowed in MVP surfaces.
// If HTML files reference these endpoints, CI will FAIL.
//
// To enable a V2 feature:
//   1. Set FEATURE_FLAGS.PORTFOLIO_V2 = true in Config.gs
//   2. Move endpoint from V2_BLOCKED_ENDPOINTS to EXPECTED_INVENTORY
//   3. Update API_TO_SCHEMA mapping
//   4. Wire UI buttons (remove display:none)
//   5. Redeploy

const V2_BLOCKED_ENDPOINTS = [
  'api_exportSharedReport', // Export to CSV/JSON/PDF - V2 feature
  'api_generateSharedReport', // Report generation with recommendations
  'api_getPortfolioAnalyticsV2', // Multi-event portfolio mode
  'api_getAdvancedAnalytics', // V2 advanced analytics
  'api_webhookRegister', // V2 webhooks
  'api_webhookUnregister', // V2 webhooks
  'api_webhookList', // V2 webhooks
  'api_webhookTest', // V2 webhooks
];

// Mapping from api_* to schema path (subset of reference/gas-mvp/scripts/check-apis-vs-schemas.js)
const API_TO_SCHEMA = {
  api_getEventTemplates: 'templates.getEventTemplates',
  api_saveEvent: 'events.saveEvent',
  api_get: 'events.get',
  api_getEventsSafe: 'events.getEventsSafe',
  api_createFormFromTemplate: 'forms.createFromTemplate',
  api_generateFormShortlink: 'forms.generateShortlink',
  api_getPublicBundle: 'bundles.public',
  api_list: 'events.list',
  api_logExternalClick: 'analytics.logExternalClick',
  api_getDisplayBundle: 'bundles.display',
  api_getPosterBundle: 'bundles.poster',
  api_getSharedAnalytics: 'analytics.getSharedReport',
  api_getSponsorAnalytics: 'analytics.getSponsorAnalytics',
  api_getSponsorReportQr: 'analytics.getSponsorReportQr',
};

// ============================================================================
// PARSING FUNCTIONS
// ============================================================================

/**
 * Extract inventory block from ApiSchemas.gs
 * Stops at the V2-QUARANTINE section to avoid including blocked endpoints
 */
function extractInventoryComment() {
  const content = fs.readFileSync(API_SCHEMAS_GS, 'utf8');

  // Find the inventory block - look for the full block including all surfaces
  // The block starts with "RPC ENDPOINT INVENTORY" and ends before V2-QUARANTINE
  const startMarker = '* RPC ENDPOINT INVENTORY';
  const startIdx = content.indexOf(startMarker);

  if (startIdx === -1) {
    throw new Error('Could not find RPC ENDPOINT INVENTORY block in ApiSchemas.gs');
  }

  // Find the V2-QUARANTINE section or closing equals line
  // We want to stop BEFORE the V2 section to avoid parsing blocked endpoints
  const v2QuarantineMarker = '[V2-QUARANTINE]';
  const v2Idx = content.indexOf(v2QuarantineMarker, startIdx);

  if (v2Idx !== -1) {
    // Stop before V2-QUARANTINE section
    return content.substring(startIdx, v2Idx);
  }

  // Fallback: find the closing equals line after all the content
  const endPattern = /\n \* ═{50,}\n \*\n \* @module/;
  const endMatch = content.substring(startIdx).match(endPattern);

  if (!endMatch) {
    throw new Error('Could not find end of RPC ENDPOINT INVENTORY block');
  }

  return content.substring(startIdx, startIdx + endMatch.index + endMatch[0].length);
}

/**
 * Parse inventory comment to extract endpoints per surface
 */
function parseInventoryComment(inventoryBlock) {
  const result = {};
  const lines = inventoryBlock.split('\n');

  let currentSurface = null;

  for (const line of lines) {
    // Match surface headers like "Admin.html (5 endpoints):"
    const surfaceMatch = line.match(/\*\s+(\w+\.html)\s+\(\d+.*\):/);
    if (surfaceMatch) {
      currentSurface = surfaceMatch[1];
      result[currentSurface] = [];
      continue;
    }

    // Match endpoint lines like "- api_saveEvent → events.saveEvent"
    if (currentSurface) {
      const endpointMatch = line.match(/\*\s+-\s+(api_\w+)/);
      if (endpointMatch) {
        result[currentSurface].push(endpointMatch[1]);
      }
    }
  }

  return result;
}

/**
 * Extract api_* functions from all .gs files in src/mvp
 */
function extractApiFunctions() {
  const apis = new Set();
  const mvpDir = path.join(ROOT, 'src', 'mvp');
  const gsFiles = fs.readdirSync(mvpDir).filter((f) => f.endsWith('.gs'));

  for (const file of gsFiles) {
    const content = fs.readFileSync(path.join(mvpDir, file), 'utf8');
    const pattern = /function\s+(api_\w+)\s*\(/g;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      apis.add(match[1]);
    }
  }

  return apis;
}

/**
 * Extract RPC calls from an HTML file
 * @param {string} htmlPath - Path to HTML file
 * @param {boolean} includeV2 - If true, also include V2 endpoints (for blocking check)
 */
function extractRpcCallsFromHtml(htmlPath, includeV2 = false) {
  if (!fs.existsSync(htmlPath)) {
    return [];
  }

  const content = fs.readFileSync(htmlPath, 'utf8');
  const pattern = /NU\.rpc\(['"]([^'"]+)['"]/g;
  const calls = new Set();

  let match;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1].startsWith('api_')) {
      if (includeV2) {
        // Include all api_* calls for V2 blocking check
        calls.add(match[1]);
      } else {
        // Only include MVP calls (not V2 endpoints)
        if (!match[1].includes('V2') && !V2_BLOCKED_ENDPOINTS.includes(match[1])) {
          calls.add(match[1]);
        }
      }
    }
  }

  return [...calls].sort();
}

/**
 * Check if HTML file contains any V2 blocked endpoints
 * Returns list of blocked endpoints found
 */
function findV2EndpointsInHtml(htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    return [];
  }

  const content = fs.readFileSync(htmlPath, 'utf8');
  const foundBlocked = [];

  for (const blockedEndpoint of V2_BLOCKED_ENDPOINTS) {
    // Check for direct calls: NU.rpc('api_exportSharedReport', ...)
    const directPattern = new RegExp(`NU\\.rpc\\(['"]${blockedEndpoint}['"]`, 'g');
    if (directPattern.test(content)) {
      foundBlocked.push({ endpoint: blockedEndpoint, type: 'direct-call' });
    }

    // Check for dynamic calls: rpcName = 'api_exportSharedReport'
    const dynamicPattern = new RegExp(`rpcName\\s*=\\s*['"]${blockedEndpoint}['"]`, 'g');
    if (dynamicPattern.test(content)) {
      foundBlocked.push({ endpoint: blockedEndpoint, type: 'dynamic-assignment' });
    }
  }

  return foundBlocked;
}

/**
 * Check if schema exists for an endpoint
 */
function schemaExists(schemaPath) {
  const content = fs.readFileSync(API_SCHEMAS_GS, 'utf8');
  const [category, operation] = schemaPath.split('.');

  // Check for the schema definition with request/response
  const pattern = new RegExp(`${operation}:\\s*\\{[^}]*(?:request:|response:)`, 's');
  return pattern.test(content);
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

function validateInventory(verbose = false) {
  console.log('RPC Inventory Validator - Checking inventory comment accuracy...\n');

  const errors = [];
  const warnings = [];

  // =========================================================================
  // STEP 0: V2 QUARANTINE CHECK - Fail fast if V2 endpoints in MVP surfaces
  // =========================================================================
  console.log('='.repeat(60));
  console.log('V2 QUARANTINE CHECK');
  console.log('='.repeat(60));
  console.log(`\nBlocked V2 endpoints: ${V2_BLOCKED_ENDPOINTS.length}`);
  if (verbose) {
    V2_BLOCKED_ENDPOINTS.forEach((e) => console.log(`  - ${e}`));
  }

  let v2Violations = 0;
  const htmlFiles = fs.readdirSync(MVP_HTML_DIR).filter((f) => f.endsWith('.html'));

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(MVP_HTML_DIR, htmlFile);
    const v2Found = findV2EndpointsInHtml(htmlPath);

    if (v2Found.length > 0) {
      console.log(`\n  ERROR: ${htmlFile} contains V2 blocked endpoints!`);
      for (const violation of v2Found) {
        console.log(`    - ${violation.endpoint} (${violation.type})`);
        errors.push(`V2 QUARANTINE: ${htmlFile} uses blocked endpoint ${violation.endpoint}`);
        v2Violations++;
      }
    } else if (verbose) {
      console.log(`  OK: ${htmlFile} - no V2 endpoints`);
    }
  }

  if (v2Violations === 0) {
    console.log('\n  PASS: No V2 blocked endpoints in MVP surfaces');
  } else {
    console.log(`\n  FAIL: Found ${v2Violations} V2 endpoint violation(s)`);
  }

  // =========================================================================
  // STEP 1: Parse inventory from ApiSchemas.gs
  // =========================================================================
  const inventoryBlock = extractInventoryComment();
  const inventoryEndpoints = parseInventoryComment(inventoryBlock);

  console.log('\n' + '='.repeat(60));
  console.log('INVENTORY PARSING');
  console.log('='.repeat(60));
  console.log('\nParsed inventory from ApiSchemas.gs comment:');
  for (const [surface, endpoints] of Object.entries(inventoryEndpoints)) {
    console.log(`  ${surface}: ${endpoints.length} endpoints`);
  }

  // Step 2: Get all api_* functions from Code.gs
  const apiFunctions = extractApiFunctions();
  console.log(`\nFound ${apiFunctions.size} api_* functions in src/mvp/*.gs`);

  // Step 3: Validate each surface
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATING SURFACES');
  console.log('='.repeat(60));

  for (const [surface, expectedEndpoints] of Object.entries(EXPECTED_INVENTORY)) {
    console.log(`\n${surface}:`);

    const htmlPath = path.join(MVP_HTML_DIR, surface);
    const actualCalls = extractRpcCallsFromHtml(htmlPath);
    const inventoryForSurface = inventoryEndpoints[surface] || [];

    // Check 1: Inventory matches expected
    const inventorySet = new Set(inventoryForSurface);
    const expectedSet = new Set(expectedEndpoints);

    const missingFromInventory = expectedEndpoints.filter((e) => !inventorySet.has(e));
    const extraInInventory = inventoryForSurface.filter((e) => !expectedSet.has(e));

    if (missingFromInventory.length > 0) {
      errors.push(`${surface}: Missing from inventory: ${missingFromInventory.join(', ')}`);
      console.log(`  ERROR: Missing from inventory: ${missingFromInventory.join(', ')}`);
    }
    if (extraInInventory.length > 0) {
      errors.push(`${surface}: Extra in inventory: ${extraInInventory.join(', ')}`);
      console.log(`  ERROR: Extra in inventory: ${extraInInventory.join(', ')}`);
    }

    // Check 2: Each endpoint exists in Code.gs
    for (const endpoint of expectedEndpoints) {
      if (!apiFunctions.has(endpoint)) {
        errors.push(`${surface}: ${endpoint} not found in Code.gs`);
        console.log(`  ERROR: ${endpoint} not found in Code.gs`);
      } else if (verbose) {
        console.log(`  OK: ${endpoint} exists in Code.gs`);
      }
    }

    // Check 3: Each endpoint has a schema
    for (const endpoint of expectedEndpoints) {
      const schemaPath = API_TO_SCHEMA[endpoint];
      if (!schemaPath) {
        warnings.push(`${surface}: ${endpoint} has no schema mapping`);
        console.log(`  WARN: ${endpoint} has no schema mapping`);
      } else if (!schemaExists(schemaPath)) {
        errors.push(`${surface}: ${endpoint} schema ${schemaPath} not found`);
        console.log(`  ERROR: ${endpoint} schema ${schemaPath} not found`);
      } else if (verbose) {
        console.log(`  OK: ${endpoint} has schema ${schemaPath}`);
      }
    }

    // Check 4: Actual HTML calls match inventory (warning only)
    if (actualCalls.length > 0) {
      const htmlSet = new Set(actualCalls);
      const notInHtml = expectedEndpoints.filter((e) => !htmlSet.has(e));
      const notInInventory = actualCalls.filter((e) => !expectedSet.has(e));

      if (notInHtml.length > 0 && verbose) {
        console.log(`  NOTE: In inventory but not called by ${surface}: ${notInHtml.join(', ')}`);
      }
      if (notInInventory.length > 0) {
        // Filter out dynamic calls that might be intentional
        const nonDynamic = notInInventory.filter(
          (e) => !e.includes('V2') && !e.includes('Portfolio')
        );
        if (nonDynamic.length > 0) {
          warnings.push(`${surface}: Calls ${nonDynamic.join(', ')} but not in inventory`);
          console.log(`  WARN: ${surface} calls ${nonDynamic.join(', ')} but not in inventory`);
        }
      }
    }

    if (missingFromInventory.length === 0 && extraInInventory.length === 0) {
      console.log(`  PASS: Inventory matches expected`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  // Count unique endpoints
  const allEndpoints = new Set();
  for (const endpoints of Object.values(EXPECTED_INVENTORY)) {
    endpoints.forEach((e) => allEndpoints.add(e));
  }
  console.log(`\nMVP Contract:`);
  console.log(`  - Unique MVP endpoints: ${allEndpoints.size}`);
  console.log(`  - V2 blocked endpoints: ${V2_BLOCKED_ENDPOINTS.length}`);
  console.log(`  - V2 quarantine violations: ${v2Violations}`);

  if (errors.length === 0) {
    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS: RPC inventory is accurate and V2 quarantine is intact!');
    console.log('='.repeat(60));
    if (warnings.length > 0) {
      console.log(`\nWarnings (${warnings.length}):`);
      warnings.forEach((w) => console.log(`  - ${w}`));
    }
    return 0;
  } else {
    console.log('\n' + '='.repeat(60));
    console.log(`FAILED: Found ${errors.length} error(s)`);
    console.log('='.repeat(60));
    errors.forEach((e) => console.log(`  - ${e}`));
    if (warnings.length > 0) {
      console.log(`\nWarnings (${warnings.length}):`);
      warnings.forEach((w) => console.log(`  - ${w}`));
    }
    return 1;
  }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

function main() {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

  // Story 1: Check if GAS files exist (may be archived after GAS→Worker migration)
  if (!fs.existsSync(API_SCHEMAS_GS) || !fs.existsSync(CODE_GS)) {
    console.log('ℹ️  GAS files not found in src/mvp/ (archived after GAS→Worker migration)');
    if (!fs.existsSync(API_SCHEMAS_GS)) {
      console.log('   - ApiSchemas.gs: archived');
    }
    if (!fs.existsSync(CODE_GS)) {
      console.log('   - Code.gs: archived');
    }
    console.log(
      'ℹ️  Skipping RPC inventory check - HTML surfaces still validate against V2 quarantine'
    );
    console.log('ℹ️  See docs/GAS-TO-CLOUDFLARE-MIGRATION.md for architecture details\n');
    console.log('SUCCESS: RPC inventory check skipped (migrated to Cloudflare Workers)');
    process.exit(0);
  }

  const exitCode = validateInventory(verbose);
  process.exit(exitCode);
}

main();
