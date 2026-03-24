#!/usr/bin/env node
/**
 * Read Deploy Manifest Utility
 *
 * Story 1.2 (DevOps): Helper script to read values from deploy-manifest.json
 *
 * Usage:
 *   node scripts/read-manifest.js <environment> <path>
 *
 * Examples:
 *   node scripts/read-manifest.js staging appsScript.scriptId
 *   node scripts/read-manifest.js production urls.baseUrl
 *   node scripts/read-manifest.js staging cloudflare.workerName
 *   node scripts/read-manifest.js defaults testEnvironment
 *
 * Output:
 *   Prints the value to stdout (for use in shell scripts)
 *   Exit code 0 on success, 1 on error
 *
 * Environment Variables:
 *   MANIFEST_PATH - Override path to deploy-manifest.json (default: ./deploy-manifest.json)
 *
 * @module scripts/read-manifest
 */

const fs = require('fs');
const path = require('path');

// Default manifest path
const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', 'deploy-manifest.json');

/**
 * Load and parse the deployment manifest
 * @returns {Object} Parsed manifest
 */
function loadManifest() {
  const manifestPath = process.env.MANIFEST_PATH || DEFAULT_MANIFEST_PATH;

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest not found at ${manifestPath}`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error parsing manifest: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Get a nested value from an object using dot notation
 * @param {Object} obj - Object to traverse
 * @param {string} path - Dot-separated path (e.g., 'appsScript.scriptId')
 * @returns {*} Value at path or undefined
 */
function getNestedValue(obj, pathStr) {
  return pathStr.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * Get a value from the manifest
 * @param {string} environment - Environment name (staging, production) or 'defaults'
 * @param {string} path - Dot-separated path to the value
 * @returns {*} The value
 */
function getManifestValue(environment, pathStr) {
  const manifest = loadManifest();

  // Handle special cases
  if (environment === 'defaults') {
    return getNestedValue(manifest.defaults, pathStr);
  }

  if (environment === 'brands') {
    return getNestedValue(manifest.brands, pathStr);
  }

  if (environment === 'validation') {
    return getNestedValue(manifest.validation, pathStr);
  }

  // Get environment-specific value
  const envConfig = manifest.environments[environment];
  if (!envConfig) {
    console.error(`Error: Unknown environment '${environment}'`);
    console.error(`Available environments: ${Object.keys(manifest.environments).join(', ')}`);
    process.exit(1);
  }

  return getNestedValue(envConfig, pathStr);
}

/**
 * Format output for shell consumption
 * @param {*} value - Value to format
 * @returns {string} Formatted string
 */
function formatOutput(value) {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

// Main execution
function main() {
  const args = process.argv.slice(2);

  // Help text
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: node scripts/read-manifest.js <environment> <path>

Arguments:
  environment   Environment name: staging, production, defaults, brands, validation
  path          Dot-separated path to the value (e.g., appsScript.scriptId)

Examples:
  node scripts/read-manifest.js staging appsScript.scriptId
  node scripts/read-manifest.js production urls.baseUrl
  node scripts/read-manifest.js staging cloudflare.workerName
  node scripts/read-manifest.js defaults testEnvironment
  node scripts/read-manifest.js brands validBrands

Environment Variables:
  MANIFEST_PATH   Override path to deploy-manifest.json

For CI/CD usage:
  STAGING_SCRIPT_ID=$(node scripts/read-manifest.js staging appsScript.scriptId)
  PROD_URL=$(node scripts/read-manifest.js production urls.baseUrl)
`);
    process.exit(0);
  }

  // List environments
  if (args[0] === '--list-environments') {
    const manifest = loadManifest();
    console.log(Object.keys(manifest.environments).join('\n'));
    process.exit(0);
  }

  // Validate manifest
  if (args[0] === '--validate') {
    const manifest = loadManifest();
    const errors = [];

    // Check required environments
    if (!manifest.environments.staging) {
      errors.push('Missing staging environment');
    }
    if (!manifest.environments.production) {
      errors.push('Missing production environment');
    }

    // Validate each environment
    for (const [envName, env] of Object.entries(manifest.environments)) {
      if (!env.appsScript?.scriptId) {
        errors.push(`${envName}: Missing appsScript.scriptId`);
      }
      if (!env.appsScript?.deploymentId) {
        errors.push(`${envName}: Missing appsScript.deploymentId`);
      }
      if (!env.urls?.baseUrl) {
        errors.push(`${envName}: Missing urls.baseUrl`);
      }

      // Validate patterns
      const scriptIdPattern = new RegExp(manifest.validation?.scriptIdPattern || '^[a-zA-Z0-9_-]{40,60}$');
      const deploymentIdPattern = new RegExp(manifest.validation?.deploymentIdPattern || '^AKfycb[a-zA-Z0-9_-]+$');

      if (env.appsScript?.scriptId && !scriptIdPattern.test(env.appsScript.scriptId)) {
        errors.push(`${envName}: Invalid scriptId format`);
      }
      if (env.appsScript?.deploymentId && !deploymentIdPattern.test(env.appsScript.deploymentId)) {
        errors.push(`${envName}: Invalid deploymentId format`);
      }
    }

    if (errors.length > 0) {
      console.error('Validation errors:');
      errors.forEach(err => console.error(`  - ${err}`));
      process.exit(1);
    }

    console.log('Manifest validation passed');
    process.exit(0);
  }

  // Export for CI (outputs in GitHub Actions format)
  if (args[0] === '--export-ci') {
    const environment = args[1];
    if (!environment) {
      console.error('Error: --export-ci requires an environment argument');
      process.exit(1);
    }

    const manifest = loadManifest();
    const env = manifest.environments[environment];

    if (!env) {
      console.error(`Error: Unknown environment '${environment}'`);
      process.exit(1);
    }

    // Output environment variables for CI
    console.log(`${environment.toUpperCase()}_SCRIPT_ID=${env.appsScript.scriptId}`);
    console.log(`${environment.toUpperCase()}_DEPLOYMENT_ID=${env.appsScript.deploymentId}`);
    console.log(`${environment.toUpperCase()}_WEB_APP_URL=${env.appsScript.webAppUrl}`);
    console.log(`${environment.toUpperCase()}_URL=${env.urls.baseUrl}`);
    console.log(`${environment.toUpperCase()}_WORKER_NAME=${env.cloudflare.workerName}`);
    console.log(`${environment.toUpperCase()}_DEBUG_LEVEL=${env.flags.debugLevel}`);
    process.exit(0);
  }

  // Regular value lookup
  if (args.length < 2) {
    console.error('Error: Both environment and path are required');
    console.error('Usage: node scripts/read-manifest.js <environment> <path>');
    process.exit(1);
  }

  const [environment, pathStr] = args;
  const value = getManifestValue(environment, pathStr);

  if (value === undefined) {
    console.error(`Error: Path '${pathStr}' not found in environment '${environment}'`);
    process.exit(1);
  }

  console.log(formatOutput(value));
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = {
  loadManifest,
  getManifestValue,
  getNestedValue
};
