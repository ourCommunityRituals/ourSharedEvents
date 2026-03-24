#!/usr/bin/env node

/**
 * Staging Environment Setup Script
 *
 * This script helps configure the staging environment by:
 * 1. Updating .clasp-staging.json with the staging Script ID
 * 2. Updating wrangler.toml with staging deployment IDs
 * 3. Updating config/environments.js with staging configuration
 * 4. Verifying the configuration
 *
 * Usage:
 *   node scripts/setup-staging.js configure --script-id=YOUR_SCRIPT_ID --deployment-id=YOUR_DEPLOYMENT_ID
 *   node scripts/setup-staging.js verify
 *   node scripts/setup-staging.js status
 *
 * Prerequisites:
 *   1. Create a staging GAS project at https://script.google.com
 *   2. Deploy it as a web app
 *   3. Get the Script ID from Project Settings
 *   4. Get the Deployment ID from the deployment URL
 */

const fs = require('fs');
const path = require('path');

// Paths
const ROOT_DIR = path.join(__dirname, '..');
const CLASP_STAGING_PATH = path.join(ROOT_DIR, '.clasp-staging.json');
const WRANGLER_PATH = path.join(ROOT_DIR, 'cloudflare-proxy', 'wrangler.toml');
const ENVIRONMENTS_PATH = path.join(ROOT_DIR, 'config', 'environments.js');

// Placeholder patterns
const SCRIPT_ID_PLACEHOLDER = 'STAGING_SCRIPT_ID_PLACEHOLDER';
const DEPLOYMENT_ID_PLACEHOLDER = 'STAGING_DEPLOYMENT_ID_PLACEHOLDER';

/**
 * Read and parse JSON file
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Error reading ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Write JSON file
 */
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Read file as text
 */
function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Write text file
 */
function writeText(filePath, content) {
  fs.writeFileSync(filePath, content);
}

/**
 * Check if a string is a placeholder
 */
function isPlaceholder(value) {
  return !value ||
         value.includes('PLACEHOLDER') ||
         value === SCRIPT_ID_PLACEHOLDER ||
         value === DEPLOYMENT_ID_PLACEHOLDER;
}

/**
 * Validate Script ID format
 */
function isValidScriptId(scriptId) {
  // Script IDs are typically 44 characters, alphanumeric with underscores
  return scriptId && /^[a-zA-Z0-9_-]{30,60}$/.test(scriptId);
}

/**
 * Validate Deployment ID format
 */
function isValidDeploymentId(deploymentId) {
  // Deployment IDs start with 'AKfycb' and are around 80 characters
  return deploymentId && /^AKfycb[a-zA-Z0-9_-]{50,100}$/.test(deploymentId);
}

/**
 * Get current staging configuration status
 */
function getStatus() {
  const status = {
    claspStaging: { configured: false, scriptId: null },
    wrangler: { configured: false, deploymentId: null },
    environments: { configured: false, deploymentId: null }
  };

  // Check .clasp-staging.json
  const claspData = readJson(CLASP_STAGING_PATH);
  if (claspData) {
    status.claspStaging.scriptId = claspData.scriptId;
    status.claspStaging.configured = !isPlaceholder(claspData.scriptId);
  }

  // Check wrangler.toml
  const wranglerContent = readText(WRANGLER_PATH);
  const deploymentMatch = wranglerContent.match(/\[env\.staging\.vars\][\s\S]*?DEPLOYMENT_ID\s*=\s*"([^"]+)"/);
  if (deploymentMatch) {
    status.wrangler.deploymentId = deploymentMatch[1];
    status.wrangler.configured = !isPlaceholder(deploymentMatch[1]);
  }

  // Check environments.js
  const envContent = readText(ENVIRONMENTS_PATH);
  const envMatch = envContent.match(/STAGING_DEPLOYMENT_ID\s*=\s*process\.env\.STAGING_DEPLOYMENT_ID\s*\|\|\s*'([^']+)'/);
  if (envMatch) {
    status.environments.deploymentId = envMatch[1];
    status.environments.configured = !isPlaceholder(envMatch[1]);
  }

  return status;
}

/**
 * Print status report
 */
function printStatus() {
  const status = getStatus();
  const allConfigured = status.claspStaging.configured &&
                        status.wrangler.configured &&
                        status.environments.configured;

  console.log('\n===============================================');
  console.log('  Staging Environment Configuration Status');
  console.log('===============================================\n');

  // .clasp-staging.json
  const claspIcon = status.claspStaging.configured ? '✅' : '❌';
  console.log(`${claspIcon} .clasp-staging.json`);
  console.log(`   Script ID: ${status.claspStaging.scriptId || 'NOT SET'}`);
  console.log(`   Status: ${status.claspStaging.configured ? 'Configured' : 'Using placeholder'}`);
  console.log('');

  // wrangler.toml
  const wranglerIcon = status.wrangler.configured ? '✅' : '❌';
  console.log(`${wranglerIcon} cloudflare-proxy/wrangler.toml [env.staging]`);
  console.log(`   Deployment ID: ${status.wrangler.deploymentId || 'NOT SET'}`);
  console.log(`   Status: ${status.wrangler.configured ? 'Configured' : 'Using placeholder'}`);
  console.log('');

  // environments.js
  const envIcon = status.environments.configured ? '✅' : '❌';
  console.log(`${envIcon} config/environments.js`);
  console.log(`   Deployment ID: ${status.environments.deploymentId || 'NOT SET'}`);
  console.log(`   Status: ${status.environments.configured ? 'Configured' : 'Using placeholder'}`);
  console.log('');

  console.log('-----------------------------------------------');
  if (allConfigured) {
    console.log('✅ STAGING IS FULLY CONFIGURED');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Deploy worker: npm run deploy:staging:worker');
    console.log('  2. Verify: curl https://stg.eventangle.com/status');
  } else {
    console.log('⚠️  STAGING SETUP INCOMPLETE');
    console.log('');
    console.log('To configure staging, run:');
    console.log('');
    console.log('  node scripts/setup-staging.js configure \\');
    console.log('    --script-id=YOUR_STAGING_SCRIPT_ID \\');
    console.log('    --deployment-id=YOUR_STAGING_DEPLOYMENT_ID');
    console.log('');
    console.log('Or follow the manual setup in STAGING_SETUP.md');
  }
  console.log('===============================================\n');

  return allConfigured;
}

/**
 * Configure staging environment
 */
function configure(scriptId, deploymentId) {
  console.log('\n🔧 Configuring Staging Environment...\n');

  let errors = [];

  // Validate inputs
  if (scriptId && !isValidScriptId(scriptId)) {
    errors.push(`Invalid Script ID format: ${scriptId}`);
  }
  if (deploymentId && !isValidDeploymentId(deploymentId)) {
    errors.push(`Invalid Deployment ID format: ${deploymentId}`);
  }

  if (errors.length > 0) {
    console.error('❌ Validation errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    console.log('');
    console.log('Script ID format: Alphanumeric, 30-60 characters');
    console.log('Deployment ID format: Starts with "AKfycb", 50-100 characters');
    process.exit(1);
  }

  // Update .clasp-staging.json
  if (scriptId) {
    console.log('📝 Updating .clasp-staging.json...');
    const claspData = readJson(CLASP_STAGING_PATH) || { rootDir: './src/mvp' };
    claspData.scriptId = scriptId;
    writeJson(CLASP_STAGING_PATH, claspData);
    console.log(`   ✅ Script ID set to: ${scriptId}`);
  }

  // Update wrangler.toml
  if (deploymentId) {
    console.log('📝 Updating cloudflare-proxy/wrangler.toml...');
    let wranglerContent = readText(WRANGLER_PATH);

    // Update STAGING_DEPLOYMENT_ID
    wranglerContent = wranglerContent.replace(
      /STAGING_DEPLOYMENT_ID\s*=\s*"[^"]*"/g,
      `STAGING_DEPLOYMENT_ID = "${deploymentId}"`
    );

    // Update GAS_DEPLOYMENT_BASE_URL in staging section
    const gasBaseUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;
    wranglerContent = wranglerContent.replace(
      /(\[env\.staging\.vars\][\s\S]*?)GAS_DEPLOYMENT_BASE_URL\s*=\s*"[^"]*"/,
      `$1GAS_DEPLOYMENT_BASE_URL = "${gasBaseUrl}"`
    );

    // Update DEPLOYMENT_ID in staging section
    wranglerContent = wranglerContent.replace(
      /(\[env\.staging\.vars\][\s\S]*?)DEPLOYMENT_ID\s*=\s*"[^"]*"/,
      `$1DEPLOYMENT_ID = "${deploymentId}"`
    );

    writeText(WRANGLER_PATH, wranglerContent);
    console.log(`   ✅ Deployment ID set to: ${deploymentId}`);
    console.log(`   ✅ GAS_DEPLOYMENT_BASE_URL set to: ${gasBaseUrl}`);
  }

  // Note: environments.js uses env vars, no update needed
  console.log('');
  console.log('ℹ️  config/environments.js uses STAGING_DEPLOYMENT_ID environment variable');
  console.log('   For CI/CD, set this in GitHub Secrets');
  console.log('   For local testing, set: export STAGING_DEPLOYMENT_ID=' + (deploymentId || 'YOUR_ID'));

  console.log('');
  console.log('✅ Configuration complete!');
  console.log('');

  printStatus();
}

/**
 * Verify staging endpoint
 */
async function verify() {
  console.log('\n🔍 Verifying Staging Environment...\n');

  const status = getStatus();

  if (!status.wrangler.configured) {
    console.error('❌ Staging not configured. Run setup first.');
    process.exit(1);
  }

  const stagingUrl = 'https://stg.eventangle.com/status';
  console.log(`Testing: ${stagingUrl}`);
  console.log('');

  try {
    const response = await fetch(stagingUrl, {
      headers: { 'Accept': 'application/json' }
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      console.log('');
      console.log('Response:');
      console.log(JSON.stringify(data, null, 2));
      console.log('');

      if (data.ok) {
        console.log('✅ STAGING IS WORKING!');
        console.log('');
        console.log('Build ID:', data.buildId || 'N/A');
        console.log('Environment:', data.environment || 'N/A');
      } else {
        console.log('⚠️  Staging responded but reported not ok');
      }
    } else {
      console.error('❌ Staging returned error status');
      const text = await response.text();
      console.log('Response body:', text.slice(0, 500));
    }
  } catch (error) {
    console.error('❌ Failed to reach staging:', error.message);
    console.log('');
    console.log('Possible causes:');
    console.log('  1. DNS not configured (stg.eventangle.com → worker)');
    console.log('  2. Worker not deployed (run: npm run deploy:staging:worker)');
    console.log('  3. GAS not deployed (run: npm run deploy:staging)');
    console.log('');
    console.log('See STAGING_SETUP.md for complete setup instructions.');
    process.exit(1);
  }
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
Staging Environment Setup Script

Usage:
  node scripts/setup-staging.js <command> [options]

Commands:
  status                   Show current staging configuration status
  configure                Configure staging with provided IDs
  verify                   Test if staging endpoint is working
  help                     Show this help message

Options for configure:
  --script-id=ID           Staging GAS Script ID (from Project Settings)
  --deployment-id=ID       Staging GAS Deployment ID (from deployment URL)

Examples:
  # Check current status
  node scripts/setup-staging.js status

  # Configure staging
  node scripts/setup-staging.js configure \\
    --script-id=1ABC...xyz \\
    --deployment-id=AKfycby...

  # Verify staging works
  node scripts/setup-staging.js verify

Setup Steps:
  1. Create staging GAS project at https://script.google.com
  2. Link staging spreadsheets (STAGING_EVENTS, STAGING_DIAG)
  3. Deploy as web app, copy the Deployment ID
  4. Get Script ID from Project Settings
  5. Run: node scripts/setup-staging.js configure --script-id=... --deployment-id=...
  6. Deploy worker: npm run deploy:staging:worker
  7. Configure DNS: stg.eventangle.com → eventangle.workers.dev (CNAME)
  8. Verify: node scripts/setup-staging.js verify

See STAGING_SETUP.md for detailed instructions.
`);
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const result = { command: null, options: {} };

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      result.options[key.replace(/-/g, '_')] = value || true;
    } else if (!result.command) {
      result.command = arg;
    }
  }

  return result;
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'status':
      printStatus();
      break;

    case 'configure': {
      const scriptId = args.options.script_id;
      const deploymentId = args.options.deployment_id;

      if (!scriptId && !deploymentId) {
        console.error('❌ At least one of --script-id or --deployment-id is required');
        console.log('');
        console.log('Usage:');
        console.log('  node scripts/setup-staging.js configure --script-id=ID --deployment-id=ID');
        process.exit(1);
      }

      configure(scriptId, deploymentId);
      break;
    }

    case 'verify':
      await verify();
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      if (args.command) {
        console.error(`Unknown command: ${args.command}`);
        console.log('');
      }
      printStatus();
      break;
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
