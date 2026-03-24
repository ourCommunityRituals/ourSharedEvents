#!/usr/bin/env node
/**
 * Deploy to Google Apps Script - PRODUCTION Environment
 *
 * Stable CI primitive for Stage-1 deployment to production.
 * This script deploys ONLY to the production Script ID with production credentials.
 *
 * IMPORTANT: Production deployments should ONLY happen through CI after staging validation.
 * See PRODUCTION_DEPLOYMENT_POLICY.md for details.
 *
 * Usage:
 *   npm run deploy:gas:prod          # Deploy to production
 *   node scripts/deploy-gas-prod.mjs # Direct execution
 *
 * Required Environment:
 *   - OAUTH_CREDENTIALS: Clasp OAuth credentials JSON (CI mode)
 *   - OR ~/.clasprc.json present (local mode)
 *
 * Admin Diagnostics Output:
 *   - Script ID target
 *   - Build timestamp
 *   - Commit hash
 *
 * Exit Codes:
 *   0 - Deployment successful
 *   1 - Deployment failed (missing credentials, clasp error, etc.)
 *
 * @see .github/workflows/stage1-deploy.yml
 * @see docs/DEPLOYMENT.md
 * @see docs/PRODUCTION_DEPLOYMENT_POLICY.md
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// ============================================================================
// Configuration
// ============================================================================
const CONFIG = {
  environment: 'PRODUCTION',
  claspConfigFile: '.clasp.json',
  stagingClaspFile: '.clasp-staging.json',
  expectedScriptId: '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l',
  maxRetries: 3,
  retryDelayMs: 5000,
};

// ============================================================================
// Terminal Colors
// ============================================================================
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[PASS]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[FAIL]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.magenta}${'='.repeat(70)}${colors.reset}\n${colors.bright}${colors.magenta}${msg}${colors.reset}\n${colors.bright}${colors.magenta}${'='.repeat(70)}${colors.reset}\n`),
  diagnostic: (label, value) => console.log(`  ${colors.dim}${label}:${colors.reset} ${colors.bright}${value}${colors.reset}`),
};

// ============================================================================
// Utility Functions
// ============================================================================

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Note: writeJson not needed for production - we use the config directly

function run(command, options = {}) {
  try {
    const output = execSync(command, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
      timeout: options.timeout || 120000,
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    return { success: true, output: output || '' };
  } catch (error) {
    return { success: false, error: error.message, output: error.stdout || '' };
  }
}

function getCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8', cwd: ROOT_DIR }).trim();
  } catch {
    return 'unknown';
  }
}

function getCommitHashFull() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: ROOT_DIR }).trim();
  } catch {
    return 'unknown';
  }
}

function getBuildTimestamp() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Credential Validation
// ============================================================================

function validateCredentials() {
  log.info('Validating credentials...');

  const clasprcPath = join(homedir(), '.clasprc.json');

  // Check for CI mode (OAUTH_CREDENTIALS environment variable)
  if (process.env.OAUTH_CREDENTIALS) {
    log.info('CI mode detected - using OAUTH_CREDENTIALS env var');

    try {
      const credentials = JSON.parse(process.env.OAUTH_CREDENTIALS);

      // Validate credential structure
      const hasTokens = credentials.tokens?.default?.access_token ||
                        credentials.token?.access_token;

      if (!hasTokens) {
        log.error('OAUTH_CREDENTIALS missing access_token');
        log.info('Ensure OAUTH_CREDENTIALS contains valid clasp OAuth tokens');
        return false;
      }

      // Write credentials to ~/.clasprc.json for clasp to use
      mkdirSync(dirname(clasprcPath), { recursive: true });
      writeFileSync(clasprcPath, process.env.OAUTH_CREDENTIALS);
      log.success('Credentials written to ~/.clasprc.json');
      return true;

    } catch (e) {
      log.error(`Failed to parse OAUTH_CREDENTIALS: ${e.message}`);
      return false;
    }
  }

  // Check for local mode (~/.clasprc.json exists)
  if (existsSync(clasprcPath)) {
    log.info('Local mode detected - using ~/.clasprc.json');

    const clasprc = readJson(clasprcPath);
    const hasTokens = clasprc?.tokens?.default?.access_token ||
                      clasprc?.token?.access_token;

    if (!hasTokens) {
      log.error('~/.clasprc.json missing access_token');
      log.info('Run: clasp login');
      return false;
    }

    log.success('Local credentials validated');
    return true;
  }

  // No credentials found
  log.error('No credentials found');
  log.info('');
  log.info('For CI: Set OAUTH_CREDENTIALS environment variable');
  log.info('For local: Run "clasp login" to authenticate');
  return false;
}

// ============================================================================
// Config Validation
// ============================================================================

function validateProductionConfig() {
  log.info('Validating production configuration...');

  const configPath = join(ROOT_DIR, CONFIG.claspConfigFile);

  if (!existsSync(configPath)) {
    log.error(`${CONFIG.claspConfigFile} not found`);
    log.info('Production configuration file is required for deployment');
    return null;
  }

  const prodConfig = readJson(configPath);

  if (!prodConfig?.scriptId) {
    log.error(`${CONFIG.claspConfigFile} missing scriptId`);
    return null;
  }

  // Validate this is actually the production Script ID
  if (prodConfig.scriptId !== CONFIG.expectedScriptId) {
    log.warn(`Script ID mismatch!`);
    log.warn(`  Expected: ${CONFIG.expectedScriptId}`);
    log.warn(`  Found:    ${prodConfig.scriptId}`);
    log.info('Proceeding with configured Script ID...');
  }

  // Safety check - ensure we're not accidentally using staging Script ID
  const stagingConfig = readJson(join(ROOT_DIR, CONFIG.stagingClaspFile));
  if (stagingConfig?.scriptId === prodConfig.scriptId) {
    log.error('SAFETY CHECK FAILED: Production config has staging Script ID!');
    log.error('This would deploy to staging instead of PRODUCTION.');
    log.error('Fix .clasp.json to use the production Script ID.');
    return null;
  }

  log.success('Production configuration validated');
  return prodConfig;
}

// ============================================================================
// Deployment
// ============================================================================

async function deployToProduction(prodConfig) {
  const commitHash = getCommitHash();
  const commitHashFull = getCommitHashFull();
  const buildTimestamp = getBuildTimestamp();

  // Print Admin Diagnostics with PRODUCTION warning
  log.header('ADMIN DIAGNOSTICS - PRODUCTION DEPLOYMENT');
  console.log(`${colors.bright}${colors.red}  *** DEPLOYING TO PRODUCTION ***${colors.reset}`);
  console.log('');
  log.diagnostic('Environment', CONFIG.environment);
  log.diagnostic('Script ID', prodConfig.scriptId);
  log.diagnostic('Build Timestamp', buildTimestamp);
  log.diagnostic('Commit Hash', commitHashFull);
  log.diagnostic('Commit (short)', commitHash);
  console.log('');

  let deploymentId = null;
  let success = false;

  try {
    // Push code to Apps Script
    log.info('Pushing code to production...');
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      const pushResult = run('npx clasp push --force', { timeout: 180000 });

      if (pushResult.success) {
        log.success('Code pushed to production');
        break;
      }

      if (attempt < CONFIG.maxRetries) {
        log.warn(`Push attempt ${attempt}/${CONFIG.maxRetries} failed, retrying in ${CONFIG.retryDelayMs / 1000}s...`);
        await sleep(CONFIG.retryDelayMs);
      } else {
        log.error('Failed to push code after all retries');
        throw new Error('clasp push failed');
      }
    }

    // Create deployment
    log.info('Creating production deployment...');
    const deployDescription = `Production deploy ${buildTimestamp} [${commitHash}]`;

    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      const deployResult = run(
        `npx clasp deploy -d "${deployDescription}"`,
        { silent: true, timeout: 120000 }
      );

      if (deployResult.success) {
        // Extract deployment ID from output
        const match = deployResult.output?.match(/AKfycb[a-zA-Z0-9_-]+/);
        if (match) {
          deploymentId = match[0];
          log.success(`Deployment created: ${deploymentId}`);
          success = true;
          break;
        }
      }

      if (attempt < CONFIG.maxRetries) {
        log.warn(`Deploy attempt ${attempt}/${CONFIG.maxRetries} failed, retrying...`);
        await sleep(CONFIG.retryDelayMs);
      } else {
        log.error('Failed to create deployment');
        throw new Error('clasp deploy failed');
      }
    }

  } catch (error) {
    log.error(`Deployment error: ${error.message}`);
    return false;
  }

  if (success && deploymentId) {
    // Print deployment summary
    console.log('');
    log.header('PRODUCTION DEPLOYMENT COMPLETE');
    log.diagnostic('Deployment ID', deploymentId);
    log.diagnostic('Web App URL', `https://script.google.com/macros/s/${deploymentId}/exec`);
    log.diagnostic('Script ID', prodConfig.scriptId);
    log.diagnostic('Timestamp', buildTimestamp);
    log.diagnostic('Commit', commitHash);
    console.log('');

    return true;
  }

  return false;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`
${colors.bright}${colors.magenta}
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║              GOOGLE APPS SCRIPT DEPLOYMENT - PRODUCTION               ║
  ║                                                                       ║
  ║  ${colors.red}*** CAUTION: THIS DEPLOYS TO PRODUCTION ***${colors.magenta}                       ║
  ║  Stable CI primitive for Stage-1 production deployment                ║
  ╚═══════════════════════════════════════════════════════════════════════╝
${colors.reset}`);

  // Step 1: Validate credentials
  if (!validateCredentials()) {
    log.error('');
    log.error('DEPLOYMENT ABORTED: Missing credentials');
    log.info('');
    log.info('Required environment variables:');
    log.info('  OAUTH_CREDENTIALS - Clasp OAuth credentials JSON');
    log.info('');
    log.info('Or authenticate locally:');
    log.info('  clasp login');
    process.exit(1);
  }

  // Step 2: Validate production configuration
  const prodConfig = validateProductionConfig();
  if (!prodConfig) {
    log.error('');
    log.error('DEPLOYMENT ABORTED: Invalid production configuration');
    process.exit(1);
  }

  // Step 3: Deploy
  const deployed = await deployToProduction(prodConfig);

  if (deployed) {
    log.success('Production deployment successful');
    process.exit(0);
  } else {
    log.error('Production deployment failed');
    process.exit(1);
  }
}

// Run main
main().catch(error => {
  log.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
