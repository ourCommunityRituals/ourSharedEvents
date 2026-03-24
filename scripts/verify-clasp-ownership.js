#!/usr/bin/env node
/**
 * Verify Apps Script Ownership
 *
 * This script verifies that clasp is configured correctly for zeventbook@gmail.com.
 * Run after `clasp login` to ensure correct account ownership.
 *
 * Usage: node scripts/verify-clasp-ownership.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REQUIRED_OWNER = 'zeventbook@gmail.com';
const PROD_CLASP = '.clasp.json';
const STAGING_CLASP = '.clasp-staging.json';

function log(symbol, msg) {
  console.log(`${symbol} ${msg}`);
}

function checkFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    return { exists: false, data: null };
  }
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return { exists: true, data };
  } catch (e) {
    return { exists: true, data: null, error: e.message };
  }
}

function checkClaspLogin() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const clasprcPath = path.join(home, '.clasprc.json');

  if (!fs.existsSync(clasprcPath)) {
    return { loggedIn: false, error: 'No ~/.clasprc.json found. Run: clasp login --no-localhost' };
  }

  try {
    const data = JSON.parse(fs.readFileSync(clasprcPath, 'utf8'));
    if (!data.token || !data.token.access_token) {
      return { loggedIn: false, error: 'Invalid clasprc.json format' };
    }
    return { loggedIn: true, data };
  } catch (e) {
    return { loggedIn: false, error: e.message };
  }
}

function runClaspList() {
  try {
    const output = execSync('npx clasp list 2>&1', { encoding: 'utf8', timeout: 30000 });
    return { success: true, output };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Apps Script Ownership Verification');
  console.log('  Required Owner: ' + REQUIRED_OWNER);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  let hasErrors = false;
  let hasWarnings = false;

  // Check 1: Clasp login status
  console.log('1. Checking clasp login status...');
  const loginStatus = checkClaspLogin();
  if (!loginStatus.loggedIn) {
    log('❌', `Not logged in: ${loginStatus.error}`);
    hasErrors = true;
  } else {
    log('✓', 'clasp credentials found (~/.clasprc.json)');
  }
  console.log('');

  // Check 2: Production clasp config
  console.log('2. Checking production config (.clasp.json)...');
  const prodConfig = checkFile(PROD_CLASP);
  if (!prodConfig.exists) {
    log('❌', `${PROD_CLASP} not found`);
    hasErrors = true;
  } else if (!prodConfig.data) {
    log('❌', `${PROD_CLASP} is invalid JSON: ${prodConfig.error}`);
    hasErrors = true;
  } else if (!prodConfig.data.scriptId) {
    log('❌', `${PROD_CLASP} missing scriptId`);
    hasErrors = true;
  } else {
    log('✓', `Production Script ID: ${prodConfig.data.scriptId}`);
    log('ℹ', `Verify owner at: https://script.google.com/home/projects/${prodConfig.data.scriptId}/edit`);
  }
  console.log('');

  // Check 3: Staging clasp config
  console.log('3. Checking staging config (.clasp-staging.json)...');
  const stagingConfig = checkFile(STAGING_CLASP);
  if (!stagingConfig.exists) {
    log('⚠', `${STAGING_CLASP} not found (optional for dev)`);
    hasWarnings = true;
  } else if (!stagingConfig.data) {
    log('❌', `${STAGING_CLASP} is invalid JSON: ${stagingConfig.error}`);
    hasErrors = true;
  } else if (!stagingConfig.data.scriptId || stagingConfig.data.scriptId.includes('REPLACE') || stagingConfig.data.scriptId.includes('PLACEHOLDER')) {
    log('⚠', `${STAGING_CLASP} has placeholder Script ID - needs configuration`);
    log('ℹ', 'See APPS_SCRIPT_PROJECT.md for staging setup instructions');
    hasWarnings = true;
  } else {
    log('✓', `Staging Script ID: ${stagingConfig.data.scriptId}`);
    log('ℹ', `Verify owner at: https://script.google.com/home/projects/${stagingConfig.data.scriptId}/edit`);
  }
  console.log('');

  // Check 4: clasp list (tests actual API access)
  console.log('4. Testing clasp API access (clasp list)...');
  if (loginStatus.loggedIn) {
    const claspList = runClaspList();
    if (!claspList.success) {
      log('❌', `clasp list failed: ${claspList.error}`);
      hasErrors = true;
    } else {
      // Filter lines containing Apps Script URLs (use regex for proper URL matching)
      const appsScriptUrlPattern = /https:\/\/script\.google\.com\/d\/[a-zA-Z0-9_-]+/;
      const lines = claspList.output.split('\n').filter(l => appsScriptUrlPattern.test(l));
      if (lines.length === 0) {
        log('⚠', 'No accessible scripts found. Ensure projects are shared with logged-in account.');
        hasWarnings = true;
      } else {
        log('✓', `Found ${lines.length} accessible script(s)`);
        lines.slice(0, 5).forEach(line => {
          log('  ', line.trim());
        });
        if (lines.length > 5) {
          log('  ', `... and ${lines.length - 5} more`);
        }
      }
    }
  } else {
    log('⏭', 'Skipped (not logged in)');
  }
  console.log('');

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  if (hasErrors) {
    console.log('  ❌ VERIFICATION FAILED - See errors above');
    console.log('');
    console.log('  Next steps:');
    console.log('  1. rm ~/.clasprc.json');
    console.log('  2. Open clean browser profile logged in ONLY as ' + REQUIRED_OWNER);
    console.log('  3. clasp login --no-localhost');
    console.log('  4. Verify OAuth screen shows ' + REQUIRED_OWNER);
    console.log('  5. Run this script again');
  } else if (hasWarnings) {
    console.log('  ⚠ VERIFICATION PASSED WITH WARNINGS');
    console.log('');
    console.log('  Manual verification required:');
    console.log('  - Open each Script URL above');
    console.log('  - Go to Project Settings (gear icon)');
    console.log('  - Confirm Owner = ' + REQUIRED_OWNER);
  } else {
    console.log('  ✅ VERIFICATION PASSED');
    console.log('');
    console.log('  Manual verification still required:');
    console.log('  - Open each Script URL above');
    console.log('  - Confirm Owner = ' + REQUIRED_OWNER);
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  process.exit(hasErrors ? 1 : 0);
}

main();
