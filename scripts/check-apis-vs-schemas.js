#!/usr/bin/env node
/**
 * API Schema Guard - check-apis-vs-schemas.js
 *
 * Story 4: Global Contract Guardrails
 *
 * This script ensures all api_* functions in Code.gs have corresponding
 * schema definitions in ApiSchemas.gs. Contract drift happens when developers
 * add new API endpoints without defining their contracts. This guard dog
 * catches those misses at CI time.
 *
 * How it works:
 *   1. Parse Code.gs and extract all `function api_<Name>` definitions
 *   2. Parse ApiSchemas.gs and extract all keys in the SCHEMAS object
 *   3. Compare using explicit mapping + naming heuristics
 *   4. Fail (exit 1) if any api_* is missing from schemas
 *
 * Usage:
 *   node scripts/check-apis-vs-schemas.js
 *   node scripts/check-apis-vs-schemas.js --verbose
 *
 * Exit codes:
 *   0 - All api_* functions have corresponding schemas (or are whitelisted)
 *   1 - Found api_* functions missing from schemas
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CODE_GS = path.join(ROOT, 'src', 'mvp', 'Code.gs');
const API_SCHEMAS_GS = path.join(ROOT, 'src', 'mvp', 'ApiSchemas.gs');

// ============================================================================
// EXPLICIT API-TO-SCHEMA MAPPING
// ============================================================================
// This mapping defines the canonical relationship between api_* functions
// and their schema paths in SCHEMAS. Format: 'api_functionName': 'category.operation'
//
// The mapping exists because:
// 1. Some api names don't follow a consistent pattern (e.g., api_get vs events.get)
// 2. Bundle APIs have special naming (api_getPublicBundle -> bundles.public)
// 3. Some APIs are aliased (api_getSharedAnalytics -> analytics.getSharedReport)

const EXPLICIT_MAPPING = {
  // Events API
  'api_list': 'events.list',
  'api_get': 'events.get',
  'api_getEventsSafe': 'events.getEventsSafe',
  'api_saveEvent': 'events.saveEvent',

  // Bundle APIs (surface-optimized payloads)
  'api_getPublicBundle': 'bundles.public',
  'api_getDisplayBundle': 'bundles.display',
  'api_getPosterBundle': 'bundles.poster',

  // Template APIs
  'api_getEventTemplates': 'templates.getEventTemplates',

  // Analytics APIs
  'api_logExternalClick': 'analytics.logExternalClick',
  'api_getSharedAnalytics': 'analytics.getSharedReport',  // Surface name differs from schema
  'api_exportSharedReport': 'analytics.exportReport',     // Surface name differs from schema
  'api_getSponsorReportQr': 'analytics.getSponsorReportQr',
  'api_logEvents': 'analytics.logEvents',
  'api_getReport': 'analytics.getReport',

  // Sponsor APIs
  'api_getSponsorAnalytics': 'analytics.getSponsorAnalytics',  // In analytics category, not sponsors
  'api_getSponsorROI': 'sponsors.getROI',

  // Form APIs
  'api_listFormTemplates': 'forms.listTemplates',
  'api_createFormFromTemplate': 'forms.createFromTemplate',
  'api_generateFormShortlink': 'forms.generateShortlink',

  // Auth APIs
  'api_generateToken': 'auth.generateToken'
};

// ============================================================================
// WHITELIST - APIs intentionally NOT requiring schemas
// ============================================================================
// These api_* functions are either:
// - Internal/system endpoints (diagnostics, health checks)
// - Legacy/orphaned endpoints kept for backward compatibility
// - V2/feature-gated endpoints not yet canonicalized
//
// Each entry MUST have a comment explaining why it's whitelisted.

const WHITELIST = {
  // === SYSTEM/DIAGNOSTICS ENDPOINTS ===
  // These return system status, not business data. No contract needed.
  'api_status': 'System status endpoint - returns health/config data',
  'api_statusPure': 'Pure function version of api_status for testing',
  'api_statusMvp': 'MVP status endpoint - returns MVP-specific health data',
  'api_health': 'Story 5: CI/CD health check - validates GAS connectivity and events index',
  'api_whoami': 'Story 4: Deployment/account info for CI comparison with Worker /env-status',
  'api_setupCheck': 'Admin setup verification - internal use only',
  'api_checkPermissions': 'Permission check endpoint - internal diagnostics',
  'api_healthCheck': 'Health check endpoint for monitoring',
  'api_getConfig': 'Config getter - returns runtime configuration',
  'api_runDiagnostics': 'Diagnostic runner - dev/admin tool',

  // === LEGACY/ORPHANED ENDPOINTS ===
  // These are superseded by api_saveEvent but kept for backward compatibility.
  // See ZEVENT-003: api_saveEvent is the canonical write endpoint.
  'api_create': 'ORPHANED: Superseded by api_saveEvent (ZEVENT-003)',
  'api_updateEventData': 'ORPHANED: Superseded by api_saveEvent (ZEVENT-003)',

  // === V2/FEATURE-GATED ENDPOINTS ===
  // These bundles exist but are not yet canonicalized with full schemas.
  // They extend the base bundle pattern and will be schema'd in V2.
  'api_getAdminBundle': 'V2: Admin bundle - extends base bundle pattern',
  'api_getSponsorBundle': 'V2: Sponsor bundle - extends base bundle pattern',
  'api_getSharedReportBundle': 'V2: SharedReport bundle - extends base bundle pattern',

  // === SPECIALIZED ENDPOINTS ===
  // These have specialized behavior not captured by standard schemas.
  'api_trackEventMetric': 'Analytics tracking - fire-and-forget, no response contract',
  'api_createShortlink': 'URL shortener - simple utility endpoint',
  'api_exportReport': 'Report export - returns file data, not JSON',
  'api_getSponsorSettings': 'Sponsor settings getter - internal admin use',
  'api_validateSponsorPlacements': 'Sponsor validation - admin utility',

  // === PORTFOLIO ENDPOINTS (V2 FEATURE) ===
  // SponsorPortfolioV2 is a feature-gated module not yet schema'd.
  'api_getPortfolioSponsorReport': 'V2: Portfolio feature - not yet schema\'d',
  'api_getPortfolioSummary': 'V2: Portfolio feature - not yet schema\'d',
  'api_getPortfolioSponsors': 'V2: Portfolio feature - not yet schema\'d'
};

// ============================================================================
// PARSING FUNCTIONS
// ============================================================================

/**
 * Extract all api_* function names from Code.gs
 * @returns {string[]} Array of api function names (e.g., ['api_list', 'api_get', ...])
 */
function extractApisFunctionsFromCodeGs() {
  const content = fs.readFileSync(CODE_GS, 'utf8');

  // Match: function api_<name>(...)
  const pattern = /function\s+(api_\w+)\s*\(/g;
  const apis = [];

  let match;
  while ((match = pattern.exec(content)) !== null) {
    apis.push(match[1]);
  }

  return [...new Set(apis)].sort(); // Dedupe and sort
}

/**
 * Extract all schema paths from ApiSchemas.gs SCHEMAS object
 * @returns {string[]} Array of schema paths (e.g., ['events.list', 'bundles.public', ...])
 */
function extractSchemasFromApiSchemasGs() {
  const content = fs.readFileSync(API_SCHEMAS_GS, 'utf8');
  const schemas = [];

  // Known top-level categories in SCHEMAS with their API operations
  // This approach is explicit and robust - we list what we expect
  const expectedSchemas = [
    // Auth
    'auth.generateToken',

    // Events
    'events.list',
    'events.get',
    'events.getEventsSafe',
    'events.create',
    'events.update',
    'events.saveEvent',

    // Bundles
    'bundles.public',
    'bundles.display',
    'bundles.poster',

    // Templates
    'templates.getEventTemplates',

    // Analytics
    'analytics.logExternalClick',
    'analytics.getSharedReport',
    'analytics.getSponsorAnalytics',
    'analytics.exportReport',
    'analytics.getSponsorReportQr',
    'analytics.logEvents',
    'analytics.getReport',
    'analytics.metrics',

    // Sponsors
    'sponsors.getAnalytics',
    'sponsors.getROI',

    // Forms
    'forms.formConfig',
    'forms.listTemplates',
    'forms.createFromTemplate',
    'forms.generateShortlink',

    // Webhooks
    'webhooks.register',
    'webhooks.unregister',
    'webhooks.list',
    'webhooks.test',
    'webhooks.getDeliveries',

    // i18n
    'i18n.translate',
    'i18n.getSupportedLocales',
    'i18n.setUserLocale'
  ];

  // Verify each expected schema exists in the file
  expectedSchemas.forEach(schemaPath => {
    const [category, operation] = schemaPath.split('.');

    // Build pattern to check: categoryName: { ... operationName: { ... request:
    // We check for operation name followed by request/response to confirm it's an API schema
    const operationPattern = new RegExp(
      `${operation}:\\s*\\{[^}]*(?:request:|response:)`,
      's'
    );

    if (operationPattern.test(content)) {
      schemas.push(schemaPath);
    }
  });

  return [...new Set(schemas)].sort();
}

/**
 * Attempt to match an api function to a schema using heuristics
 * @param {string} apiName - API function name (e.g., 'api_getFoo')
 * @param {string[]} schemas - Available schema paths
 * @returns {string|null} Matched schema path or null
 */
function heuristicMatch(apiName, schemas) {
  // Remove 'api_' prefix
  const baseName = apiName.replace(/^api_/, '');

  // Try direct matches in various categories
  for (const schema of schemas) {
    const [category, operation] = schema.split('.');
    if (operation === baseName) {
      return schema;
    }
  }

  // Try camelCase to lowercase match
  const lowerBaseName = baseName.toLowerCase();
  for (const schema of schemas) {
    const [, operation] = schema.split('.');
    if (operation && operation.toLowerCase() === lowerBaseName) {
      return schema;
    }
  }

  return null;
}

// ============================================================================
// MAIN CHECK LOGIC
// ============================================================================

/**
 * Main function - check all APIs have schemas
 * @param {boolean} verbose - Print detailed output
 * @returns {{missing: string[], matched: Object, whitelisted: string[]}}
 */
function checkApisVsSchemas(verbose = false) {
  console.log('API Schema Guard - Checking api_* functions vs SCHEMAS...\n');

  // Step 1: Extract APIs from Code.gs
  const apis = extractApisFunctionsFromCodeGs();
  console.log(`Found ${apis.length} api_* functions in Code.gs`);

  // Step 2: Extract schemas from ApiSchemas.gs
  const schemas = extractSchemasFromApiSchemasGs();
  console.log(`Found ${schemas.length} schema definitions in ApiSchemas.gs`);

  if (verbose) {
    console.log('\nSchema paths found:');
    schemas.forEach(s => console.log(`  - ${s}`));
    console.log('');
  }

  // Step 3: Check each API
  const matched = {};
  const whitelisted = [];
  const missing = [];

  apis.forEach(api => {
    // First check explicit mapping
    if (EXPLICIT_MAPPING[api]) {
      const schemaPath = EXPLICIT_MAPPING[api];
      if (schemas.includes(schemaPath)) {
        matched[api] = schemaPath;
      } else {
        // Explicit mapping exists but schema not found - this is a bug
        console.error(`WARNING: ${api} mapped to ${schemaPath} but schema not found!`);
        missing.push(api);
      }
      return;
    }

    // Then check whitelist
    if (WHITELIST[api]) {
      whitelisted.push(api);
      return;
    }

    // Try heuristic matching
    const heurMatch = heuristicMatch(api, schemas);
    if (heurMatch) {
      matched[api] = heurMatch;
      return;
    }

    // No match found - this API is missing a schema
    missing.push(api);
  });

  return { missing, matched, whitelisted, apis, schemas };
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

function main() {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

  // Story 1: Check if GAS files exist (may be archived after GAS→Worker migration)
  if (!fs.existsSync(CODE_GS) || !fs.existsSync(API_SCHEMAS_GS)) {
    console.log('ℹ️  GAS files not found in src/mvp/ (archived after GAS→Worker migration)');
    if (!fs.existsSync(CODE_GS)) {
      console.log('   - Code.gs: archived');
    }
    if (!fs.existsSync(API_SCHEMAS_GS)) {
      console.log('   - ApiSchemas.gs: archived');
    }
    console.log('ℹ️  Skipping API vs Schema check - JSON schemas in /schemas/ are the source of truth');
    console.log('ℹ️  See docs/GAS-TO-CLOUDFLARE-MIGRATION.md for architecture details\n');
    console.log('SUCCESS: GAS check skipped (migrated to Cloudflare Workers)');
    process.exit(0);
  }

  const { missing, matched, whitelisted, apis } = checkApisVsSchemas(verbose);

  // Report results
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));

  console.log(`\nMatched APIs (have schemas): ${Object.keys(matched).length}`);
  if (verbose) {
    Object.entries(matched).forEach(([api, schema]) => {
      console.log(`  ${api} -> ${schema}`);
    });
  }

  console.log(`\nWhitelisted APIs (intentionally no schema): ${whitelisted.length}`);
  if (verbose || whitelisted.length > 0) {
    whitelisted.forEach(api => {
      console.log(`  ${api}: ${WHITELIST[api]}`);
    });
  }

  if (missing.length === 0) {
    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS: All api_* functions have schemas or are whitelisted!');
    console.log('='.repeat(60));
    console.log(`\n  Total APIs: ${apis.length}`);
    console.log(`  Matched:    ${Object.keys(matched).length}`);
    console.log(`  Whitelisted: ${whitelisted.length}`);
    process.exit(0);
  } else {
    console.log('\n' + '='.repeat(60));
    console.log('FAILED: Found api_* functions missing from schemas!');
    console.log('='.repeat(60));

    console.log(`\nMissing schemas for ${missing.length} API(s):\n`);
    missing.forEach(api => {
      console.log(`  ${api}`);
    });

    console.log('\nTo fix this, either:');
    console.log('  1. Add a schema definition in ApiSchemas.gs (preferred)');
    console.log('  2. Add an explicit mapping in EXPLICIT_MAPPING');
    console.log('  3. Add to WHITELIST with a comment explaining why\n');

    console.log('Schema location: src/mvp/ApiSchemas.gs');
    console.log('Guard script:   scripts/check-apis-vs-schemas.js\n');

    process.exit(1);
  }
}

main();
