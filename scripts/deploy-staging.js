#!/usr/bin/env node
/**
 * Staging Deployment Automation
 *
 * Automated, self-healing staging deployment script.
 * Handles config swapping, deployment, and verification.
 *
 * Usage:
 *   npm run deploy:staging:auto         # Full deployment
 *   npm run deploy:staging:auto -- --check  # Check only
 *   npm run deploy:staging:auto -- --verify # Verify existing deployment
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  prodClaspFile: '.clasp.json',
  stagingClaspFile: '.clasp-staging.json',
  stagingScriptId: '1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ',
  stagingUrl: 'https://stg.eventangle.com',
  maxRetries: 3,
  retryDelay: 5000
};

const args = process.argv.slice(2);
const MODE = {
  check: args.includes('--check'),
  verify: args.includes('--verify'),
  force: args.includes('--force'),
  verbose: args.includes('--verbose')
};

// Utilities
function log(msg) { console.log(`[staging] ${msg}`); }
function success(msg) { console.log(`✅ ${msg}`); }
function warn(msg) { console.log(`⚠️  ${msg}`); }
function error(msg) { console.log(`❌ ${msg}`); }

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function run(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      timeout: options.timeout || 60000
    });
    return { success: true, output: result };
  } catch (e) {
    return { success: false, error: e.message, output: e.stdout || '' };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Pre-flight Checks
// ============================================================================
function preflightChecks() {
  log('Running pre-flight checks...');

  // Check staging config exists
  if (!fs.existsSync(CONFIG.stagingClaspFile)) {
    error(`${CONFIG.stagingClaspFile} not found`);
    log('Creating default staging config...');

    const stagingConfig = {
      scriptId: CONFIG.stagingScriptId,
      rootDir: './src/mvp',
      _comment: 'Staging script - Owner: zeventbook@gmail.com'
    };
    writeJson(CONFIG.stagingClaspFile, stagingConfig);
    success('Created staging config');
  }

  // Validate staging config
  const stagingConfig = readJson(CONFIG.stagingClaspFile);
  if (!stagingConfig?.scriptId) {
    error('Invalid staging config - missing scriptId');
    return false;
  }

  if (stagingConfig.scriptId.includes('PLACEHOLDER') || stagingConfig.scriptId.includes('REPLACE')) {
    error('Staging config has placeholder Script ID');
    log(`Expected Script ID: ${CONFIG.stagingScriptId}`);
    return false;
  }

  // Check prod config exists (we'll swap back to it)
  if (!fs.existsSync(CONFIG.prodClaspFile)) {
    error(`${CONFIG.prodClaspFile} not found - cannot safely swap configs`);
    return false;
  }

  // Check clasp login - look for credentials file first
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const clasprcPath = path.join(home, '.clasprc.json');

  if (!fs.existsSync(clasprcPath)) {
    error('Not logged in to clasp - ~/.clasprc.json not found');
    log('Run: clasp login');
    return false;
  }

  // Validate clasprc.json has tokens
  const clasprc = readJson(clasprcPath);
  if (!clasprc?.tokens?.default?.access_token && !clasprc?.token?.access_token) {
    error('Invalid clasp credentials - missing access_token');
    log('Run: rm ~/.clasprc.json && clasp login');
    return false;
  }

  success('Clasp credentials found');

  // Optional: verify API access (non-blocking)
  log('Verifying clasp API access...');
  const loginCheck = run('clasp list', { silent: true, timeout: 20000 });
  if (loginCheck.success) {
    success('Clasp API access verified');
  } else {
    warn('Could not verify clasp API access - proceeding anyway');
    log('If deployment fails, run: clasp login');
  }

  success('Pre-flight checks passed');
  return true;
}

// ============================================================================
// Deploy to Staging
// ============================================================================
async function deployToStaging() {
  log('Starting staging deployment...');

  // Backup prod config
  const prodConfig = readJson(CONFIG.prodClaspFile);
  const stagingConfig = readJson(CONFIG.stagingClaspFile);

  if (!prodConfig || !stagingConfig) {
    error('Failed to read config files');
    return false;
  }

  log(`Staging Script ID: ${stagingConfig.scriptId}`);

  // Swap to staging config
  log('Swapping to staging config...');
  writeJson(CONFIG.prodClaspFile, stagingConfig);

  let deploymentId = null;
  let deploySuccess = false;

  try {
    // Push code (use clasp directly, not npx - npx has env issues)
    log('Pushing code to staging...');
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      const pushResult = run('clasp push --force', { timeout: 120000 });

      if (pushResult.success) {
        success('Code pushed to staging');
        break;
      }

      if (attempt < CONFIG.maxRetries) {
        warn(`Push attempt ${attempt} failed, retrying in ${CONFIG.retryDelay / 1000}s...`);
        await sleep(CONFIG.retryDelay);
      } else {
        error('Failed to push code after all retries');
        throw new Error('Push failed');
      }
    }

    // Create/update deployment (use clasp directly)
    log('Creating staging deployment...');
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      const timestamp = new Date().toISOString();
      const deployResult = run(
        `clasp deploy -d "Staging deployment ${timestamp}"`,
        { silent: true, timeout: 60000 }
      );

      if (deployResult.success) {
        // Extract deployment ID from output
        const match = deployResult.output?.match(/AKfycb[a-zA-Z0-9_-]+/);
        if (match) {
          deploymentId = match[0];
          success(`Deployment created: ${deploymentId}`);
          deploySuccess = true;
          break;
        }
      }

      if (attempt < CONFIG.maxRetries) {
        warn(`Deploy attempt ${attempt} failed, retrying...`);
        await sleep(CONFIG.retryDelay);
      } else {
        error('Failed to create deployment');
        throw new Error('Deploy failed');
      }
    }

    // List deployments for verification
    log('Verifying deployment...');
    const listResult = run('clasp deployments', { silent: true });
    if (listResult.success && MODE.verbose) {
      console.log(listResult.output);
    }

  } finally {
    // ALWAYS restore prod config
    log('Restoring production config...');
    writeJson(CONFIG.prodClaspFile, prodConfig);
    success('Production config restored');
  }

  if (deploySuccess && deploymentId) {
    console.log('');
    console.log('═'.repeat(60));
    success('STAGING DEPLOYMENT COMPLETE');
    console.log('═'.repeat(60));
    console.log('');
    console.log(`Deployment ID: ${deploymentId}`);
    console.log(`Web App URL: https://script.google.com/macros/s/${deploymentId}/exec`);
    console.log(`Staging URL: ${CONFIG.stagingUrl} (requires Cloudflare setup)`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Verify deployment: npm run staging:verify');
    console.log('  2. Update GitHub secret STAGING_DEPLOYMENT_ID if needed');
    console.log('  3. Deploy Cloudflare worker: npm run deploy:staging:worker');
    console.log('');

    return true;
  }

  return false;
}

// ============================================================================
// Verify Staging Deployment
// ============================================================================
async function verifyStagingDeployment() {
  log('Verifying staging deployment...');

  // Check staging endpoint
  const stagingConfig = readJson(CONFIG.stagingClaspFile);
  if (!stagingConfig?.scriptId) {
    error('No staging config found');
    return false;
  }

  // Get deployment ID
  const prodConfig = readJson(CONFIG.prodClaspFile);
  writeJson(CONFIG.prodClaspFile, stagingConfig);

  try {
    const deployResult = run('clasp deployments', { silent: true });
    writeJson(CONFIG.prodClaspFile, prodConfig);

    if (!deployResult.success) {
      error('Failed to get deployments');
      return false;
    }

    const deployments = deployResult.output
      .split('\n')
      .filter(l => l.includes('AKfycb'));

    if (deployments.length === 0) {
      error('No staging deployments found');
      log('Run: npm run deploy:staging:auto');
      return false;
    }

    success(`Found ${deployments.length} staging deployment(s)`);

    // Try to reach staging URL
    log(`Checking staging URL: ${CONFIG.stagingUrl}/status`);
    try {
      const curlResult = run(
        `curl -sf -o /dev/null -w "%{http_code}" --connect-timeout 10 "${CONFIG.stagingUrl}/status"`,
        { silent: true }
      );

      if (curlResult.success && curlResult.output?.includes('200')) {
        success('Staging URL is reachable');
      } else {
        warn('Staging URL not reachable (Cloudflare may not be configured)');
        log('This is OK if you haven\'t set up Cloudflare staging routes yet');
      }
    } catch (e) {
      warn('Could not check staging URL');
    }

    return true;

  } finally {
    // Restore prod config
    writeJson(CONFIG.prodClaspFile, prodConfig);
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           STAGING DEPLOYMENT AUTOMATION                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // Pre-flight checks
  if (!preflightChecks()) {
    process.exit(1);
  }

  // Check only mode
  if (MODE.check) {
    success('Pre-flight checks passed - ready to deploy');
    process.exit(0);
  }

  // Verify only mode
  if (MODE.verify) {
    const verified = await verifyStagingDeployment();
    process.exit(verified ? 0 : 1);
  }

  // Full deployment
  const deployed = await deployToStaging();

  if (deployed) {
    // Verify after deployment
    await verifyStagingDeployment();
    process.exit(0);
  } else {
    error('Deployment failed');
    process.exit(1);
  }
}

main().catch(e => {
  error(`Unexpected error: ${e.message}`);
  process.exit(1);
});
