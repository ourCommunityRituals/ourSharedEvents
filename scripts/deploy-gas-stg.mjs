#!/usr/bin/env node
/**
 * Deploy to Google Apps Script - STAGING Environment
 *
 * Stable CI primitive for Stage-1 deployment to staging.
 * This script deploys ONLY to the staging Script ID with staging credentials.
 *
 * Usage:
 *   npm run deploy:gas:stg          # Deploy to staging
 *   node scripts/deploy-gas-stg.mjs # Direct execution
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
  environment: 'STAGING',
  claspConfigFile: '.clasp-staging.json',
  mainClaspFile: '.clasp.json',
  expectedScriptId: '1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ',
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
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[PASS]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[FAIL]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}\n`),
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

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

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

function validateStagingConfig() {
  log.info('Validating staging configuration...');

  const configPath = join(ROOT_DIR, CONFIG.claspConfigFile);

  if (!existsSync(configPath)) {
    log.error(`${CONFIG.claspConfigFile} not found`);
    log.info('Staging configuration file is required for deployment');
    return null;
  }

  const stagingConfig = readJson(configPath);

  if (!stagingConfig?.scriptId) {
    log.error(`${CONFIG.claspConfigFile} missing scriptId`);
    return null;
  }

  // Validate this is actually the staging Script ID
  if (stagingConfig.scriptId !== CONFIG.expectedScriptId) {
    log.warn(`Script ID mismatch!`);
    log.warn(`  Expected: ${CONFIG.expectedScriptId}`);
    log.warn(`  Found:    ${stagingConfig.scriptId}`);
    log.info('Proceeding with configured Script ID...');
  }

  // Safety check - ensure we're not using production Script ID
  const prodConfig = readJson(join(ROOT_DIR, CONFIG.mainClaspFile));
  if (prodConfig?.scriptId === stagingConfig.scriptId) {
    log.error('SAFETY CHECK FAILED: Staging config has production Script ID!');
    log.error('This would deploy to PRODUCTION instead of staging.');
    log.error('Fix .clasp-staging.json to use the staging Script ID.');
    return null;
  }

  log.success('Staging configuration validated');
  return stagingConfig;
}

// ============================================================================
// Deployment
// ============================================================================

async function deployToStaging(stagingConfig) {
  const commitHash = getCommitHash();
  const commitHashFull = getCommitHashFull();
  const buildTimestamp = getBuildTimestamp();

  // Print Admin Diagnostics
  log.header('ADMIN DIAGNOSTICS - STAGING DEPLOYMENT');
  log.diagnostic('Environment', CONFIG.environment);
  log.diagnostic('Script ID', stagingConfig.scriptId);
  log.diagnostic('Build Timestamp', buildTimestamp);
  log.diagnostic('Commit Hash', commitHashFull);
  log.diagnostic('Commit (short)', commitHash);
  console.log('');

  // Backup main .clasp.json and swap to staging config
  const mainClaspPath = join(ROOT_DIR, CONFIG.mainClaspFile);

  const originalConfig = readJson(mainClaspPath);
  if (!originalConfig) {
    log.error(`Cannot read ${CONFIG.mainClaspFile}`);
    return false;
  }

  log.info('Swapping to staging configuration...');
  writeJson(mainClaspPath, stagingConfig);

  let deploymentId = null;
  let success = false;

  try {
    // Push code to Apps Script
    log.info('Pushing code to staging...');
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      const pushResult = run('npx clasp push --force', { timeout: 180000 });

      if (pushResult.success) {
        log.success('Code pushed to staging');
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
    log.info('Creating staging deployment...');
    const deployDescription = `Staging deploy ${buildTimestamp} [${commitHash}]`;

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

  } finally {
    // ALWAYS restore original config
    log.info('Restoring original configuration...');
    writeJson(mainClaspPath, originalConfig);
    log.success('Configuration restored');
  }

  if (success && deploymentId) {
    // Print deployment summary
    console.log('');
    log.header('STAGING DEPLOYMENT COMPLETE');
    log.diagnostic('Deployment ID', deploymentId);
    log.diagnostic('Web App URL', `https://script.google.com/macros/s/${deploymentId}/exec`);
    log.diagnostic('Script ID', stagingConfig.scriptId);
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
${colors.bright}${colors.cyan}
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║              GOOGLE APPS SCRIPT DEPLOYMENT - STAGING                  ║
  ║                                                                       ║
  ║  Stable CI primitive for Stage-1 staging deployment                   ║
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

  // Step 2: Validate staging configuration
  const stagingConfig = validateStagingConfig();
  if (!stagingConfig) {
    log.error('');
    log.error('DEPLOYMENT ABORTED: Invalid staging configuration');
    process.exit(1);
  }

  // Step 3: Deploy
  const deployed = await deployToStaging(stagingConfig);

  if (deployed) {
    log.success('Staging deployment successful');
    process.exit(0);
  } else {
    log.error('Staging deployment failed');
    process.exit(1);
  }
}

// Run main
main().catch(error => {
  log.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
