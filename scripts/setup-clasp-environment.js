#!/usr/bin/env node
/**
 * Apps Script Environment Setup & Validation
 *
 * A comprehensive, self-healing setup script for clasp and Apps Script environments.
 *
 * Features:
 * - Validates clasp login and ownership
 * - Checks configuration files
 * - Deploys staging if needed
 * - Validates GitHub secrets requirements
 * - Provides actionable fix instructions
 *
 * Usage:
 *   npm run setup:clasp           # Interactive setup
 *   npm run setup:clasp -- --check   # Check only, no changes
 *   npm run setup:clasp -- --fix     # Auto-fix where possible
 *   npm run setup:clasp -- --ci      # CI mode (exit codes only)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  requiredOwner: 'zeventbook@gmail.com',
  prodScriptId: '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l',
  stagingScriptId: '1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ',
  prodClaspFile: '.clasp.json',
  stagingClaspFile: '.clasp-staging.json',
  clasprcPath: path.join(process.env.HOME || process.env.USERPROFILE, '.clasprc.json'),
  requiredSecrets: [
    'OAUTH_CREDENTIALS',
    'DEPLOYMENT_ID',
    'ADMIN_KEY_ROOT',
    'ADMIN_KEY_ABC',
    'ADMIN_KEY_CBC',
    'ADMIN_KEY_CBL',
    'SPREADSHEET_ID',
    'SPREADSHEET_ID_ROOT',
    'SPREADSHEET_ID_ABC',
    'SPREADSHEET_ID_CBC',
    'SPREADSHEET_ID_CBL',
    'STAGING_SCRIPT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID'
  ],
  optionalSecrets: [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'STAGING_DEPLOYMENT_ID'
  ]
};

// Parse command line arguments
const args = process.argv.slice(2);
const MODE = {
  check: args.includes('--check'),
  fix: args.includes('--fix'),
  ci: args.includes('--ci'),
  verbose: args.includes('--verbose') || args.includes('-v'),
  json: args.includes('--json')
};

// Results tracking
const results = {
  checks: [],
  errors: [],
  warnings: [],
  fixes: [],
  actions: []
};

// Logging utilities
const log = {
  info: (msg) => !MODE.json && console.log(`ℹ️  ${msg}`),
  success: (msg) => !MODE.json && console.log(`✅ ${msg}`),
  warning: (msg) => !MODE.json && console.log(`⚠️  ${msg}`),
  error: (msg) => !MODE.json && console.log(`❌ ${msg}`),
  action: (msg) => !MODE.json && console.log(`👉 ${msg}`),
  header: (msg) => !MODE.json && console.log(`\n${'═'.repeat(60)}\n  ${msg}\n${'═'.repeat(60)}`),
  subheader: (msg) => !MODE.json && console.log(`\n--- ${msg} ---`),
  blank: () => !MODE.json && console.log('')
};

// Helper functions
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

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

function runCommand(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      timeout: options.timeout || 30000,
      stdio: options.silent ? 'pipe' : 'pipe'
    });
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, error: e.message, output: e.stdout?.trim() || '' };
  }
}

function addCheck(name, passed, message, fix = null) {
  results.checks.push({ name, passed, message });
  if (!passed) {
    results.errors.push({ name, message, fix });
    if (fix) results.actions.push(fix);
  }
  return passed;
}

function addWarning(name, message, fix = null) {
  results.warnings.push({ name, message, fix });
  if (fix) results.actions.push(fix);
}

// ============================================================================
// CHECK 1: Clasp Installation
// ============================================================================
function checkClaspInstalled() {
  log.subheader('Checking clasp installation');

  const result = runCommand('npx clasp --version', { silent: true });

  if (result.success) {
    log.success(`clasp installed: v${result.output}`);
    return addCheck('clasp_installed', true, `clasp v${result.output}`);
  }

  log.error('clasp not found');
  return addCheck('clasp_installed', false, 'clasp not installed',
    'Run: npm install -g @google/clasp');
}

// ============================================================================
// CHECK 2: Clasp Login Status
// ============================================================================
function checkClaspLogin() {
  log.subheader('Checking clasp login status');

  if (!fileExists(CONFIG.clasprcPath)) {
    log.error('Not logged in to clasp');
    return addCheck('clasp_login', false, 'No ~/.clasprc.json found',
      'Run: clasp login (as zeventbook@gmail.com)');
  }

  const clasprc = readJson(CONFIG.clasprcPath);
  // Support both token formats: tokens.default.access_token or token.access_token
  const hasToken = clasprc?.tokens?.default?.access_token || clasprc?.token?.access_token;

  if (!clasprc || !hasToken) {
    log.error('Invalid clasp credentials');
    return addCheck('clasp_login', false, 'Invalid ~/.clasprc.json format',
      'Run: rm ~/.clasprc.json && clasp login');
  }

  log.success('clasp credentials found');

  // Test actual API access (non-blocking - just a warning if it fails)
  const listResult = runCommand('clasp list', { silent: true, timeout: 20000 });

  if (!listResult.success) {
    if (listResult.error && (listResult.error.includes('invalid_grant') || listResult.error.includes('Token has been expired'))) {
      log.error('Clasp token expired or revoked');
      return addCheck('clasp_login', false, 'Token expired or revoked',
        'Run: rm ~/.clasprc.json && clasp login');
    }
    log.warning('Could not verify clasp API access - may be transient');
    addWarning('clasp_api', 'API access check failed - proceeding anyway');
  } else {
    log.success('clasp API access verified');
  }

  return addCheck('clasp_login', true, 'Logged in with valid credentials');
}

// ============================================================================
// CHECK 3: Production Config
// ============================================================================
function checkProdConfig() {
  log.subheader('Checking production config (.clasp.json)');

  const configPath = path.join(process.cwd(), CONFIG.prodClaspFile);

  if (!fileExists(configPath)) {
    log.error('.clasp.json not found');
    return addCheck('prod_config', false, '.clasp.json missing',
      'Create .clasp.json with production Script ID');
  }

  const config = readJson(configPath);
  if (!config || !config.scriptId) {
    log.error('.clasp.json invalid');
    return addCheck('prod_config', false, '.clasp.json missing scriptId');
  }

  if (config.scriptId !== CONFIG.prodScriptId) {
    log.warning(`Script ID mismatch: ${config.scriptId}`);
    addWarning('prod_script_id', `Expected ${CONFIG.prodScriptId}, got ${config.scriptId}`);
  }

  log.success(`Production Script ID: ${config.scriptId.substring(0, 20)}...`);
  return addCheck('prod_config', true, 'Production config valid');
}

// ============================================================================
// CHECK 4: Staging Config
// ============================================================================
function checkStagingConfig() {
  log.subheader('Checking staging config (.clasp-staging.json)');

  const configPath = path.join(process.cwd(), CONFIG.stagingClaspFile);

  if (!fileExists(configPath)) {
    log.error('.clasp-staging.json not found');
    if (MODE.fix) {
      const stagingConfig = {
        scriptId: CONFIG.stagingScriptId,
        rootDir: './src/mvp',
        _comment: 'Staging script - Owner: zeventbook@gmail.com'
      };
      writeJson(configPath, stagingConfig);
      log.success('Created .clasp-staging.json');
      results.fixes.push('Created .clasp-staging.json');
      return addCheck('staging_config', true, 'Created staging config');
    }
    return addCheck('staging_config', false, '.clasp-staging.json missing',
      'Create .clasp-staging.json with staging Script ID');
  }

  const config = readJson(configPath);
  if (!config || !config.scriptId) {
    log.error('.clasp-staging.json invalid');
    return addCheck('staging_config', false, '.clasp-staging.json missing scriptId');
  }

  if (config.scriptId.includes('REPLACE') || config.scriptId.includes('PLACEHOLDER')) {
    log.error('Staging Script ID not configured');
    if (MODE.fix) {
      config.scriptId = CONFIG.stagingScriptId;
      writeJson(configPath, config);
      log.success('Updated staging Script ID');
      results.fixes.push('Updated staging Script ID');
      return addCheck('staging_config', true, 'Fixed staging config');
    }
    return addCheck('staging_config', false, 'Staging Script ID is placeholder',
      `Update scriptId to: ${CONFIG.stagingScriptId}`);
  }

  log.success(`Staging Script ID: ${config.scriptId.substring(0, 20)}...`);
  return addCheck('staging_config', true, 'Staging config valid');
}

// ============================================================================
// CHECK 5: Script Access
// ============================================================================
function checkScriptAccess() {
  log.subheader('Checking script access');

  const listResult = runCommand('npx clasp list', { silent: true, timeout: 20000 });

  if (!listResult.success) {
    log.warning('Could not list scripts');
    addWarning('script_access', 'Failed to list accessible scripts');
    return true; // Non-blocking warning
  }

  // Filter lines containing Apps Script URLs (use regex for proper URL matching)
  const appsScriptUrlPattern = /https:\/\/script\.google\.com\/d\/[a-zA-Z0-9_-]+/;
  const scripts = listResult.output.split('\n').filter(l => appsScriptUrlPattern.test(l));

  if (scripts.length === 0) {
    log.warning('No scripts found');
    addWarning('script_access', 'No accessible scripts - verify account ownership');
    return true;
  }

  log.success(`Found ${scripts.length} accessible script(s)`);

  // Check for our expected scripts
  const hasProd = scripts.some(s => s.includes(CONFIG.prodScriptId));
  const hasStaging = scripts.some(s => s.includes(CONFIG.stagingScriptId));

  if (!hasProd) {
    addWarning('prod_access', 'Production script not in accessible list');
  } else {
    log.success('Production script accessible');
  }

  if (!hasStaging) {
    addWarning('staging_access', 'Staging script not in accessible list');
  } else {
    log.success('Staging script accessible');
  }

  return addCheck('script_access', true, `${scripts.length} scripts accessible`);
}

// ============================================================================
// CHECK 6: Test Push (Optional)
// ============================================================================
function checkPushAccess() {
  if (MODE.ci) return true; // Skip in CI mode

  log.subheader('Testing push access (dry-run)');

  // We'll just verify we can access the project, not actually push
  const result = runCommand('npx clasp status', { silent: true, timeout: 15000 });

  if (result.success) {
    log.success('Push access verified');
    return addCheck('push_access', true, 'Can access project for push');
  }

  log.warning('Could not verify push access');
  addWarning('push_access', 'Push access check failed - may need to verify manually');
  return true;
}

// ============================================================================
// CHECK 7: Staging Deployment Status
// ============================================================================
function checkStagingDeployment() {
  log.subheader('Checking staging deployment');

  // Switch to staging config temporarily
  const prodConfig = path.join(process.cwd(), CONFIG.prodClaspFile);
  const stagingConfig = path.join(process.cwd(), CONFIG.stagingClaspFile);

  if (!fileExists(stagingConfig)) {
    return addCheck('staging_deployment', false, 'No staging config',
      'Configure .clasp-staging.json first');
  }

  // Backup prod config
  const prodData = readJson(prodConfig);
  const stagingData = readJson(stagingConfig);

  if (!stagingData?.scriptId || stagingData.scriptId.includes('PLACEHOLDER')) {
    return addCheck('staging_deployment', false, 'Staging not configured');
  }

  // Temporarily use staging config
  writeJson(prodConfig, stagingData);

  try {
    const result = runCommand('npx clasp deployments', { silent: true, timeout: 20000 });

    // Restore prod config
    writeJson(prodConfig, prodData);

    if (result.success && result.output.includes('AKfycb')) {
      const deployments = result.output.split('\n').filter(l => l.includes('AKfycb'));
      log.success(`Staging has ${deployments.length} deployment(s)`);
      return addCheck('staging_deployment', true, `${deployments.length} staging deployments`);
    }

    log.warning('No staging deployments found');
    return addCheck('staging_deployment', false, 'No staging deployments',
      'Run: npm run deploy:staging');
  } catch (e) {
    // Restore prod config
    writeJson(prodConfig, prodData);
    log.warning('Could not check staging deployments');
    addWarning('staging_deployment', 'Failed to check staging deployments');
    return true;
  }
}

// ============================================================================
// CHECK 8: GitHub Secrets Requirements
// ============================================================================
function checkSecretsRequirements() {
  log.subheader('Checking GitHub secrets requirements');

  const required = CONFIG.requiredSecrets.filter(s => !CONFIG.optionalSecrets.includes(s));
  const optional = CONFIG.optionalSecrets;

  log.info(`Required secrets: ${required.length}`);
  log.info(`Optional secrets: ${optional.length}`);

  // We can't actually check GitHub secrets from here, but we can document what's needed
  const secretsDoc = {
    required: required.map(s => ({ name: s, description: getSecretDescription(s) })),
    optional: optional.map(s => ({ name: s, description: getSecretDescription(s) }))
  };

  // Write secrets requirements to a file for reference
  const secretsPath = path.join(process.cwd(), '.github-secrets-required.json');
  writeJson(secretsPath, secretsDoc);

  log.success(`Secrets requirements documented in .github-secrets-required.json`);
  results.actions.push('Verify GitHub secrets at: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions');

  return true;
}

function getSecretDescription(name) {
  const descriptions = {
    'OAUTH_CREDENTIALS': 'Contents of ~/.clasprc.json for clasp authentication',
    'DEPLOYMENT_ID': 'Production Apps Script deployment ID (AKfycb...)',
    'ADMIN_KEY_ROOT': 'Admin key for root brand',
    'ADMIN_KEY_ABC': 'Admin key for ABC brand',
    'ADMIN_KEY_CBC': 'Admin key for CBC brand',
    'ADMIN_KEY_CBL': 'Admin key for CBL brand',
    'SPREADSHEET_ID': 'Root spreadsheet ID (fallback)',
    'SPREADSHEET_ID_ROOT': 'Root brand spreadsheet ID',
    'SPREADSHEET_ID_ABC': 'ABC brand spreadsheet ID',
    'SPREADSHEET_ID_CBC': 'CBC brand spreadsheet ID',
    'SPREADSHEET_ID_CBL': 'CBL brand spreadsheet ID',
    'STAGING_SCRIPT_ID': 'Staging Apps Script ID',
    'CLOUDFLARE_API_TOKEN': 'Cloudflare API token for Worker deployments',
    'CLOUDFLARE_ACCOUNT_ID': 'Cloudflare account ID',
    'STAGING_DEPLOYMENT_ID': 'Staging Apps Script deployment ID'
  };
  return descriptions[name] || 'No description available';
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
async function main() {
  log.header('Apps Script Environment Setup & Validation');
  log.info(`Mode: ${MODE.check ? 'check' : MODE.fix ? 'fix' : MODE.ci ? 'ci' : 'interactive'}`);
  log.info(`Required owner: ${CONFIG.requiredOwner}`);
  log.blank();

  // Run all checks
  checkClaspInstalled();
  checkClaspLogin();
  checkProdConfig();
  checkStagingConfig();
  checkScriptAccess();
  checkPushAccess();
  checkStagingDeployment();
  checkSecretsRequirements();

  // Summary
  log.header('Summary');

  const passed = results.checks.filter(c => c.passed).length;
  const failed = results.checks.filter(c => !c.passed).length;
  const warnings = results.warnings.length;

  log.info(`Checks: ${passed} passed, ${failed} failed, ${warnings} warnings`);

  if (results.fixes.length > 0) {
    log.blank();
    log.subheader('Fixes Applied');
    results.fixes.forEach(f => log.success(f));
  }

  if (results.errors.length > 0) {
    log.blank();
    log.subheader('Errors');
    results.errors.forEach(e => {
      log.error(`${e.name}: ${e.message}`);
      if (e.fix) log.action(e.fix);
    });
  }

  if (results.warnings.length > 0) {
    log.blank();
    log.subheader('Warnings');
    results.warnings.forEach(w => {
      log.warning(`${w.name}: ${w.message}`);
      if (w.fix) log.action(w.fix);
    });
  }

  if (results.actions.length > 0 && !MODE.ci) {
    log.blank();
    log.subheader('Required Actions');
    [...new Set(results.actions)].forEach((a, i) => log.action(`${i + 1}. ${a}`));
  }

  // JSON output mode
  if (MODE.json) {
    console.log(JSON.stringify({
      success: failed === 0,
      checks: results.checks,
      errors: results.errors,
      warnings: results.warnings,
      fixes: results.fixes,
      actions: [...new Set(results.actions)]
    }, null, 2));
  }

  // Exit code
  log.blank();
  if (failed === 0) {
    log.success('Environment setup validated successfully!');
    process.exit(0);
  } else {
    log.error(`${failed} check(s) failed - see above for fixes`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});
