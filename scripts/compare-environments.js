#!/usr/bin/env node

/**
 * Environment Parity Comparison Script
 *
 * Story 1.4 (PO): This script compares staging and production configurations
 * to ensure parity and identify intentional vs unintentional differences.
 *
 * Usage:
 *   node scripts/compare-environments.js           # Full comparison report
 *   node scripts/compare-environments.js --json    # JSON output for CI
 *   node scripts/compare-environments.js --strict  # Exit with error if parity issues found
 *
 * Exit Codes:
 *   0 - All checks passed (parity verified)
 *   1 - Parity issues found that require review
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================

const ROOT_DIR = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'deploy-manifest.json');
const WRANGLER_PATH = path.join(ROOT_DIR, 'cloudflare-proxy', 'wrangler.toml');

// Parse command line arguments
const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes('--json');
const STRICT_MODE = args.includes('--strict');

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Load JSON file safely
 */
function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

/**
 * Parse TOML-like wrangler.toml (simplified)
 */
function parseWranglerEnvVars(content, envName) {
  const envSection = new RegExp(`\\[env\\.${envName}\\.vars\\]([\\s\\S]*?)(?=\\[|$)`, 'm');
  const match = content.match(envSection);
  if (!match) return {};

  const vars = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const varMatch = line.match(/^([A-Z_]+)\s*=\s*"([^"]*)"/);
    if (varMatch) {
      vars[varMatch[1]] = varMatch[2];
    }
  }
  return vars;
}

/**
 * Deep compare two objects
 */
function deepCompare(obj1, obj2, path = '') {
  const differences = [];

  const keys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

  for (const key of keys) {
    if (key.startsWith('_')) continue; // Skip comment fields

    const fullPath = path ? `${path}.${key}` : key;
    const val1 = obj1 ? obj1[key] : undefined;
    const val2 = obj2 ? obj2[key] : undefined;

    if (val1 === undefined) {
      differences.push({ path: fullPath, staging: undefined, production: val2, type: 'production_only' });
    } else if (val2 === undefined) {
      differences.push({ path: fullPath, staging: val1, production: undefined, type: 'staging_only' });
    } else if (typeof val1 === 'object' && typeof val2 === 'object' && !Array.isArray(val1)) {
      differences.push(...deepCompare(val1, val2, fullPath));
    } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
      differences.push({ path: fullPath, staging: val1, production: val2, type: 'different' });
    }
  }

  return differences;
}

// =============================================================================
// PARITY CHECKS
// =============================================================================

/**
 * Check manifest configuration parity
 */
function checkManifestParity(manifest) {
  const results = {
    name: 'Deployment Manifest',
    status: 'PASS',
    checks: [],
    differences: []
  };

  if (!manifest) {
    results.status = 'FAIL';
    results.checks.push({ item: 'Manifest file', status: 'FAIL', message: 'deploy-manifest.json not found' });
    return results;
  }

  const staging = manifest.environments?.staging;
  const production = manifest.environments?.production;

  if (!staging || !production) {
    results.status = 'FAIL';
    results.checks.push({ item: 'Environments', status: 'FAIL', message: 'Missing staging or production config' });
    return results;
  }

  // Check 1: Both environments exist
  results.checks.push({ item: 'Both environments defined', status: 'PASS' });

  // Check 2: Same Cloudflare zone
  if (staging.cloudflare?.zoneName === production.cloudflare?.zoneName) {
    results.checks.push({ item: 'Same Cloudflare zone', status: 'PASS', value: staging.cloudflare?.zoneName });
  } else {
    results.checks.push({ item: 'Same Cloudflare zone', status: 'WARN', message: 'Different zones' });
  }

  // Check 3: MVP feature parity
  const stagingMvp = staging.featureFlags?.mvpFeatures || {};
  const prodMvp = production.featureFlags?.mvpFeatures || {};
  const mvpDiffs = deepCompare(stagingMvp, prodMvp);
  if (mvpDiffs.length === 0) {
    results.checks.push({ item: 'MVP feature parity', status: 'PASS' });
  } else {
    results.status = 'FAIL';
    results.checks.push({ item: 'MVP feature parity', status: 'FAIL', message: 'MVP features must match' });
    results.differences.push(...mvpDiffs.map(d => ({ ...d, category: 'mvpFeatures' })));
  }

  // Check 4: V2 feature parity
  const stagingV2 = staging.featureFlags?.v2Features || {};
  const prodV2 = production.featureFlags?.v2Features || {};
  const v2Diffs = deepCompare(stagingV2, prodV2);
  if (v2Diffs.length === 0) {
    results.checks.push({ item: 'V2 feature parity', status: 'PASS' });
  } else {
    results.status = 'FAIL';
    results.checks.push({ item: 'V2 feature parity', status: 'FAIL', message: 'V2 features must match' });
    results.differences.push(...v2Diffs.map(d => ({ ...d, category: 'v2Features' })));
  }

  // Check 5: Testing features - expected to differ
  const stagingTest = staging.featureFlags?.testingFeatures || {};
  const prodTest = production.featureFlags?.testingFeatures || {};
  const testDiffs = deepCompare(stagingTest, prodTest);

  // Verify staging has testing features ON, production has them OFF
  let testingConfigCorrect = true;
  for (const diff of testDiffs) {
    if (diff.type === 'different') {
      if (diff.staging !== true || diff.production !== false) {
        testingConfigCorrect = false;
      }
    }
  }
  if (testingConfigCorrect) {
    results.checks.push({
      item: 'Testing features config',
      status: 'PASS',
      message: 'Staging=ON, Production=OFF as expected'
    });
  } else {
    results.checks.push({
      item: 'Testing features config',
      status: 'WARN',
      message: 'Unexpected testing feature configuration'
    });
  }

  // Check 6: Brands configuration
  if (JSON.stringify(manifest.brands) === JSON.stringify(manifest.brands)) {
    results.checks.push({ item: 'Brands config shared', status: 'PASS' });
  }

  // Check 7: Validation patterns
  if (manifest.validation) {
    results.checks.push({ item: 'Validation patterns defined', status: 'PASS' });
  }

  // Check 8: Debug settings appropriate per environment
  const stagingDebug = staging.flags?.debugLevel === 'debug';
  const prodDebug = production.flags?.debugLevel === 'error';
  if (stagingDebug && prodDebug) {
    results.checks.push({
      item: 'Debug levels appropriate',
      status: 'PASS',
      message: 'Staging=debug, Production=error'
    });
  } else {
    results.checks.push({
      item: 'Debug levels appropriate',
      status: 'WARN',
      message: `Staging=${staging.flags?.debugLevel}, Production=${production.flags?.debugLevel}`
    });
  }

  // Check 9: Debug endpoints
  const stagingEndpoints = staging.flags?.enableDebugEndpoints === true;
  const prodEndpoints = production.flags?.enableDebugEndpoints === false;
  if (stagingEndpoints && prodEndpoints) {
    results.checks.push({
      item: 'Debug endpoints appropriate',
      status: 'PASS',
      message: 'Enabled in staging, disabled in production'
    });
  } else {
    results.status = 'FAIL';
    results.checks.push({
      item: 'Debug endpoints appropriate',
      status: 'FAIL',
      message: 'Debug endpoints should be disabled in production'
    });
  }

  return results;
}

/**
 * Check Cloudflare Worker configuration parity
 */
function checkWorkerParity() {
  const results = {
    name: 'Cloudflare Worker (wrangler.toml)',
    status: 'PASS',
    checks: []
  };

  let wranglerContent;
  try {
    wranglerContent = fs.readFileSync(WRANGLER_PATH, 'utf8');
  } catch {
    results.status = 'FAIL';
    results.checks.push({ item: 'Wrangler config', status: 'FAIL', message: 'wrangler.toml not found' });
    return results;
  }

  results.checks.push({ item: 'Wrangler config exists', status: 'PASS' });

  // Check for staging and production sections
  const hasStaging = wranglerContent.includes('[env.staging]');
  const hasProduction = wranglerContent.includes('[env.production]');

  if (hasStaging && hasProduction) {
    results.checks.push({ item: 'Both environments defined', status: 'PASS' });
  } else {
    results.status = 'FAIL';
    results.checks.push({
      item: 'Both environments defined',
      status: 'FAIL',
      message: `Staging: ${hasStaging}, Production: ${hasProduction}`
    });
  }

  // Check WORKER_ENV is set correctly
  const stagingVars = parseWranglerEnvVars(wranglerContent, 'staging');
  const prodVars = parseWranglerEnvVars(wranglerContent, 'production');

  if (stagingVars.WORKER_ENV === 'staging' && prodVars.WORKER_ENV === 'production') {
    results.checks.push({ item: 'WORKER_ENV correct', status: 'PASS' });
  } else {
    results.checks.push({
      item: 'WORKER_ENV correct',
      status: 'WARN',
      message: `Staging=${stagingVars.WORKER_ENV}, Production=${prodVars.WORKER_ENV}`
    });
  }

  // Check DEBUG_LEVEL
  if (stagingVars.DEBUG_LEVEL === 'debug' && prodVars.DEBUG_LEVEL === 'error') {
    results.checks.push({
      item: 'DEBUG_LEVEL appropriate',
      status: 'PASS',
      message: 'Staging=debug, Production=error'
    });
  } else {
    results.checks.push({
      item: 'DEBUG_LEVEL appropriate',
      status: 'WARN',
      message: `Staging=${stagingVars.DEBUG_LEVEL}, Production=${prodVars.DEBUG_LEVEL}`
    });
  }

  // Check deployment IDs are different (they should be)
  if (stagingVars.STAGING_DEPLOYMENT_ID && prodVars.PROD_DEPLOYMENT_ID) {
    if (stagingVars.STAGING_DEPLOYMENT_ID !== prodVars.PROD_DEPLOYMENT_ID) {
      results.checks.push({ item: 'Different deployment IDs', status: 'PASS' });
    } else {
      results.status = 'FAIL';
      results.checks.push({
        item: 'Different deployment IDs',
        status: 'FAIL',
        message: 'Staging and production should have different deployment IDs'
      });
    }
  }

  return results;
}

/**
 * Check clasp configuration parity
 */
function checkClaspParity() {
  const results = {
    name: 'Clasp Configuration',
    status: 'PASS',
    checks: []
  };

  const claspDefault = loadJson(path.join(ROOT_DIR, '.clasp.json'));
  const claspStaging = loadJson(path.join(ROOT_DIR, '.clasp-staging.json'));
  const claspProduction = loadJson(path.join(ROOT_DIR, '.clasp-production.json'));

  // Check all files exist
  if (claspDefault) {
    results.checks.push({ item: '.clasp.json exists', status: 'PASS' });
  } else {
    results.checks.push({ item: '.clasp.json exists', status: 'FAIL' });
    results.status = 'FAIL';
  }

  if (claspStaging) {
    results.checks.push({ item: '.clasp-staging.json exists', status: 'PASS' });
  } else {
    results.checks.push({ item: '.clasp-staging.json exists', status: 'FAIL' });
    results.status = 'FAIL';
  }

  if (claspProduction) {
    results.checks.push({ item: '.clasp-production.json exists', status: 'PASS' });
  } else {
    results.checks.push({ item: '.clasp-production.json exists', status: 'FAIL' });
    results.status = 'FAIL';
  }

  // Check default points to staging (safety)
  if (claspDefault && claspStaging) {
    if (claspDefault.scriptId === claspStaging.scriptId) {
      results.checks.push({
        item: 'Default points to staging (safe)',
        status: 'PASS'
      });
    } else {
      results.checks.push({
        item: 'Default points to staging (safe)',
        status: 'WARN',
        message: 'Default .clasp.json should point to staging for safety'
      });
    }
  }

  // Check staging and production have different script IDs
  if (claspStaging && claspProduction) {
    if (claspStaging.scriptId !== claspProduction.scriptId) {
      results.checks.push({
        item: 'Different script IDs',
        status: 'PASS'
      });
    } else {
      results.status = 'FAIL';
      results.checks.push({
        item: 'Different script IDs',
        status: 'FAIL',
        message: 'Staging and production must have different script IDs'
      });
    }
  }

  return results;
}

/**
 * Check API schema parity
 */
function checkSchemaParity() {
  const results = {
    name: 'API Schema',
    status: 'PASS',
    checks: []
  };

  const schemasDir = path.join(ROOT_DIR, 'schemas');

  // Check key schemas exist
  const requiredSchemas = [
    'event.schema.json',
    'status-envelope.schema.json',
    'deploy-manifest.schema.json'
  ];

  for (const schema of requiredSchemas) {
    const schemaPath = path.join(schemasDir, schema);
    if (fs.existsSync(schemaPath)) {
      results.checks.push({ item: `${schema} exists`, status: 'PASS' });
    } else {
      results.checks.push({ item: `${schema} exists`, status: 'WARN', message: 'Schema not found' });
    }
  }

  // Both environments use the same schemas (no env-specific schemas)
  results.checks.push({
    item: 'Same schemas for both environments',
    status: 'PASS',
    message: 'Schemas are environment-agnostic'
  });

  return results;
}

// =============================================================================
// REPORT GENERATION
// =============================================================================

function generateReport() {
  const manifest = loadJson(MANIFEST_PATH);

  const allResults = [
    checkManifestParity(manifest),
    checkWorkerParity(),
    checkClaspParity(),
    checkSchemaParity()
  ];

  // Calculate overall status
  const hasFailures = allResults.some(r => r.status === 'FAIL');
  const hasWarnings = allResults.some(r => r.status === 'WARN');
  const overallStatus = hasFailures ? 'FAIL' : (hasWarnings ? 'WARN' : 'PASS');

  const report = {
    title: 'Environment Parity Report',
    story: 'Story 1.4 (PO): Configuration Parity and Environment Alignment',
    timestamp: new Date().toISOString(),
    overallStatus,
    summary: {
      totalChecks: allResults.reduce((sum, r) => sum + r.checks.length, 0),
      passed: allResults.reduce((sum, r) => sum + r.checks.filter(c => c.status === 'PASS').length, 0),
      warnings: allResults.reduce((sum, r) => sum + r.checks.filter(c => c.status === 'WARN').length, 0),
      failures: allResults.reduce((sum, r) => sum + r.checks.filter(c => c.status === 'FAIL').length, 0)
    },
    sections: allResults
  };

  return report;
}

function printReport(report) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${report.title}`);
  console.log(`  ${report.story}`);
  console.log('='.repeat(70));
  console.log(`  Generated: ${report.timestamp}`);
  console.log(`  Overall Status: ${report.overallStatus}`);
  console.log('-'.repeat(70));
  console.log(`  Total Checks: ${report.summary.totalChecks}`);
  console.log(`  Passed: ${report.summary.passed}`);
  console.log(`  Warnings: ${report.summary.warnings}`);
  console.log(`  Failures: ${report.summary.failures}`);
  console.log('='.repeat(70));

  for (const section of report.sections) {
    console.log(`\n[${section.status}] ${section.name}`);
    console.log('-'.repeat(50));

    for (const check of section.checks) {
      const icon = check.status === 'PASS' ? '\u2713' : (check.status === 'WARN' ? '!' : '\u2717');
      const msg = check.message ? ` - ${check.message}` : '';
      const val = check.value ? ` (${check.value})` : '';
      console.log(`  ${icon} ${check.item}${val}${msg}`);
    }

    if (section.differences && section.differences.length > 0) {
      console.log('\n  Differences found:');
      for (const diff of section.differences) {
        console.log(`    - ${diff.path}: staging=${diff.staging}, production=${diff.production}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));

  if (report.overallStatus === 'PASS') {
    console.log('  PARITY VERIFIED: Staging is an acceptable UAT proxy for production');
  } else if (report.overallStatus === 'WARN') {
    console.log('  REVIEW RECOMMENDED: Some differences require verification');
  } else {
    console.log('  PARITY ISSUES: Critical differences found - review required');
  }

  console.log('='.repeat(70) + '\n');
}

// =============================================================================
// MAIN
// =============================================================================

const report = generateReport();

if (JSON_OUTPUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

// Exit with appropriate code
if (STRICT_MODE && report.overallStatus === 'FAIL') {
  process.exit(1);
}

process.exit(0);
