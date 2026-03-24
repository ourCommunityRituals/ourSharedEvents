#!/usr/bin/env node
/**
 * Update Deploy Manifest Utility
 *
 * Story 1.2 (DevOps): Updates deploy-manifest.json with new deployment values.
 * Called by CI/CD after successful deployments.
 *
 * Usage:
 *   node scripts/update-manifest.js <environment> <field> <value>
 *
 * Examples:
 *   node scripts/update-manifest.js staging appsScript.deploymentId AKfycb...
 *   node scripts/update-manifest.js production appsScript.deploymentId AKfycb...
 *
 * Environment Variables:
 *   MANIFEST_PATH - Override path to deploy-manifest.json (default: ./deploy-manifest.json)
 *
 * @module scripts/update-manifest
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
 * Save the manifest to file
 * @param {Object} manifest - Manifest object to save
 */
function saveManifest(manifest) {
  const manifestPath = process.env.MANIFEST_PATH || DEFAULT_MANIFEST_PATH;

  try {
    // Update the _lastUpdated field
    manifest._lastUpdated = new Date().toISOString().split('T')[0];

    const content = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(manifestPath, content + '\n', 'utf8');
    console.log(`Manifest saved to ${manifestPath}`);
  } catch (error) {
    console.error(`Error saving manifest: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Set a nested value in an object using dot notation
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot-separated path (e.g., 'appsScript.deploymentId')
 * @param {*} value - Value to set
 */
function setNestedValue(obj, pathStr, value) {
  const keys = pathStr.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Update a value in the manifest
 * @param {string} environment - Environment name (staging, production)
 * @param {string} path - Dot-separated path to the value
 * @param {string} value - New value to set
 */
function updateManifestValue(environment, pathStr, value) {
  const manifest = loadManifest();

  // Get environment-specific config
  if (!manifest.environments[environment]) {
    console.error(`Error: Unknown environment '${environment}'`);
    console.error(`Available environments: ${Object.keys(manifest.environments).join(', ')}`);
    process.exit(1);
  }

  // Set the value
  setNestedValue(manifest.environments[environment], pathStr, value);

  // If updating deploymentId, also update the webAppUrl
  if (pathStr === 'appsScript.deploymentId') {
    const webAppUrl = `https://script.google.com/macros/s/${value}/exec`;
    setNestedValue(manifest.environments[environment], 'appsScript.webAppUrl', webAppUrl);
    console.log(`Also updated appsScript.webAppUrl to: ${webAppUrl}`);
  }

  // Save the updated manifest
  saveManifest(manifest);

  console.log(`Updated ${environment}.${pathStr} to: ${value}`);
}

// Main execution
function main() {
  const args = process.argv.slice(2);

  // Help text
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: node scripts/update-manifest.js <environment> <path> <value>

Arguments:
  environment   Environment name: staging, production
  path          Dot-separated path to the value (e.g., appsScript.deploymentId)
  value         New value to set

Examples:
  node scripts/update-manifest.js staging appsScript.deploymentId AKfycb...
  node scripts/update-manifest.js production appsScript.deploymentId AKfycb...

Environment Variables:
  MANIFEST_PATH   Override path to deploy-manifest.json

For CI/CD usage:
  After a successful deployment, update the manifest with the new deployment ID:
  node scripts/update-manifest.js staging appsScript.deploymentId "$NEW_DEPLOYMENT_ID"
`);
    process.exit(0);
  }

  // Validate arguments
  if (args.length < 3) {
    console.error('Error: Environment, path, and value are required');
    console.error('Usage: node scripts/update-manifest.js <environment> <path> <value>');
    process.exit(1);
  }

  const [environment, pathStr, value] = args;
  updateManifestValue(environment, pathStr, value);
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = {
  loadManifest,
  saveManifest,
  updateManifestValue,
  setNestedValue
};
