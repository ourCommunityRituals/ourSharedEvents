#!/usr/bin/env node

/**
 * Diagnostic Script for Apps Script API Access Issues
 *
 * This script performs a series of checks to diagnose why Apps Script API
 * access is failing and provides specific guidance for each issue.
 *
 * Usage:
 *   SERVICE_ACCOUNT_JSON='...' SCRIPT_ID='...' node scripts/diagnose-apps-script-access.js
 */

const { google } = require('googleapis');

// Configuration
const SCRIPT_ID = process.env.SCRIPT_ID;
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function printHeader(text) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${text}`);
  console.log('═'.repeat(70) + '\n');
}

function printCheck(status, message) {
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  const color = status === 'pass' ? colors.green : status === 'fail' ? colors.red : colors.yellow;
  console.log(`${color}${icon} ${message}${colors.reset}`);
}

function printInfo(message) {
  console.log(`${colors.cyan}ℹ️  ${message}${colors.reset}`);
}

function printAction(number, message) {
  console.log(`${colors.yellow}   ${number}. ${message}${colors.reset}`);
}

/**
 * Check 1: Verify environment variables are set
 */
function checkEnvironmentVariables() {
  printHeader('CHECK 1: Environment Variables');

  let allPresent = true;

  if (!SERVICE_ACCOUNT_JSON) {
    printCheck('fail', 'SERVICE_ACCOUNT_JSON is not set');
    allPresent = false;
  } else {
    printCheck('pass', 'SERVICE_ACCOUNT_JSON is set');

    // Try to parse it
    try {
      const creds = JSON.parse(SERVICE_ACCOUNT_JSON);
      printCheck('pass', 'SERVICE_ACCOUNT_JSON is valid JSON');

      if (creds.client_email) {
        printInfo(`Service Account Email: ${creds.client_email}`);
      }
      if (creds.project_id) {
        printInfo(`Project ID: ${creds.project_id}`);
      }
    } catch (error) {
      printCheck('fail', 'SERVICE_ACCOUNT_JSON is not valid JSON');
      printInfo(`Parse error: ${error.message}`);
      allPresent = false;
    }
  }

  if (!SCRIPT_ID) {
    printCheck('fail', 'SCRIPT_ID is not set');
    allPresent = false;
  } else {
    printCheck('pass', 'SCRIPT_ID is set');
    printInfo(`Script ID: ${SCRIPT_ID}`);
  }

  return allPresent;
}

/**
 * Check 2: Verify service account authentication works
 */
async function checkAuthentication() {
  printHeader('CHECK 2: Service Account Authentication');

  try {
    const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/script.projects',
        'https://www.googleapis.com/auth/script.deployments',
        'https://www.googleapis.com/auth/script.webapp.deploy'
      ]
    });

    const authClient = await auth.getClient();
    printCheck('pass', 'Service account authentication successful');

    return { authClient, auth };
  } catch (error) {
    printCheck('fail', 'Service account authentication failed');
    printInfo(`Error: ${error.message}`);

    console.log('\n📋 How to fix:');
    printAction(1, 'Verify SERVICE_ACCOUNT_JSON is the complete JSON key file');
    printAction(2, 'Ensure the service account exists in Google Cloud Console');
    printAction(3, 'Check that the service account has not been deleted');

    return null;
  }
}

/**
 * Check 3: Verify Apps Script API is enabled (project level)
 */
async function checkApiEnabled(authClient) {
  printHeader('CHECK 3: Apps Script API Enabled (Project Level)');

  const scriptClient = google.script({ version: 'v1', auth: authClient });

  try {
    // Try to list projects (this requires the API to be enabled)
    await scriptClient.projects.get({
      scriptId: SCRIPT_ID
    });

    printCheck('pass', 'Apps Script API is enabled in Google Cloud Console');
    return true;
  } catch (error) {
    if (error.code === 403) {
      printCheck('fail', 'Apps Script API appears to be disabled or access is denied');

      console.log('\n📋 How to fix:');
      printAction(1, 'Go to: https://console.cloud.google.com/apis/library');
      printAction(2, 'Search for "Apps Script API"');
      printAction(3, 'Click "ENABLE" if not already enabled');
      printAction(4, 'Also check Step 4 below (User Settings) - CRITICAL!');

      return false;
    } else if (error.code === 404) {
      printCheck('fail', 'Apps Script project not found');
      printInfo(`Script ID: ${SCRIPT_ID}`);

      console.log('\n📋 How to fix:');
      printAction(1, 'Verify the SCRIPT_ID is correct');
      printAction(2, 'Open Apps Script → Project Settings → Copy "Script ID"');
      printAction(3, 'Update the SCRIPT_ID environment variable or GitHub secret');

      return false;
    } else {
      printCheck('fail', `Unexpected error: ${error.message}`);
      return false;
    }
  }
}

/**
 * Check 4: Verify service account has access to the script
 */
async function checkScriptAccess(authClient) {
  printHeader('CHECK 4: Service Account Access to Apps Script Project');

  const scriptClient = google.script({ version: 'v1', auth: authClient });

  try {
    const project = await scriptClient.projects.get({
      scriptId: SCRIPT_ID
    });

    printCheck('pass', 'Can read project metadata');
    printInfo(`Project Title: ${project.data.title || 'N/A'}`);

    return true;
  } catch (error) {
    if (error.code === 403) {
      printCheck('fail', 'Service account does not have access to the Apps Script project');

      const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);

      console.log('\n📋 How to fix:');
      printAction(1, `Open Apps Script project: https://script.google.com/d/${SCRIPT_ID}/edit`);
      printAction(2, 'Click "Share" (top right)');
      printAction(3, `Add this email as Editor: ${credentials.client_email}`);
      printAction(4, 'Uncheck "Notify people"');
      printAction(5, 'Click "Share"');

      return false;
    } else if (error.code === 404) {
      printCheck('fail', 'Apps Script project not found');
      printInfo('The SCRIPT_ID may be incorrect');
      return false;
    } else {
      printCheck('warn', `Unexpected error: ${error.message}`);
      return false;
    }
  }
}

/**
 * Check 5: Verify write access (most critical)
 */
async function checkWriteAccess(authClient) {
  printHeader('CHECK 5: Apps Script API Write Access (User Settings)');

  const scriptClient = google.script({ version: 'v1', auth: authClient });

  try {
    // First, get the current content
    const currentContent = await scriptClient.projects.getContent({
      scriptId: SCRIPT_ID
    });

    printCheck('pass', 'Can read project content');

    // Now test ACTUAL write access by doing a no-op update
    printInfo('Testing actual write access (updateContent)...');

    await scriptClient.projects.updateContent({
      scriptId: SCRIPT_ID,
      requestBody: {
        files: currentContent.data.files,
        scriptId: SCRIPT_ID
      }
    });

    printCheck('pass', 'Apps Script API write access is enabled');
    printCheck('pass', 'User settings are correctly configured');
    printCheck('pass', 'Deployment will work!');

    return true;
  } catch (error) {
    if (error.code === 403 || error.message?.includes('User has not enabled')) {
      printCheck('fail', 'Apps Script API user setting is NOT enabled');
      printCheck('fail', 'This is the MOST COMMON issue!');

      console.log(`\n${colors.red}⚠️  CRITICAL: Project owner must enable Apps Script API${colors.reset}`);
      console.log(`${colors.red}              in their USER settings!${colors.reset}\n`);

      console.log('📋 Required steps (MUST be done by project owner):');
      printAction(1, 'Visit: https://script.google.com/home/usersettings');
      printAction(2, 'Toggle ON: "Google Apps Script API"');
      printAction(3, 'You should see: ✅ "Google Apps Script API: ON"');
      printAction(4, 'Wait 2-5 minutes for the change to propagate');
      printAction(5, 'Retry this diagnostic script');

      console.log(`\n${colors.yellow}Important notes:${colors.reset}`);
      printInfo('The GCP API setting enables the API at the project level');
      printInfo('The user setting enables the API for the project OWNER');
      printInfo('Service accounts inherit permissions from the project owner');
      printInfo('BOTH settings must be enabled!');

      console.log(`\n${colors.yellow}Verify the correct account:${colors.reset}`);
      printAction(1, `Open: https://script.google.com/home/projects/${SCRIPT_ID}/edit`);
      printAction(2, 'Click "Share" and check who the OWNER is (not just Editor)');
      printAction(3, 'The OWNER must enable the API in THEIR user settings');
      printAction(4, 'If you have multiple Google accounts, make sure you\'re logged in as the owner');

      return false;
    } else {
      printCheck('warn', `Unexpected error: ${error.message}`);
      printInfo('This may indicate a different access issue');
      if (error.response?.data) {
        printInfo(`Full error: ${JSON.stringify(error.response.data)}`);
      }
      return false;
    }
  }
}

/**
 * Main diagnostic function
 */
async function diagnose() {
  console.log(`${colors.blue}`);
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                    ║');
  console.log('║    Apps Script API Access Diagnostic Tool                         ║');
  console.log('║                                                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);

  console.log('\nThis tool will check:');
  console.log('  1. Environment variables are set correctly');
  console.log('  2. Service account authentication works');
  console.log('  3. Apps Script API is enabled (GCP Console)');
  console.log('  4. Service account has access to the project');
  console.log('  5. Apps Script API user setting is enabled (CRITICAL!)');

  // Check 1: Environment variables
  const envCheck = checkEnvironmentVariables();
  if (!envCheck) {
    printHeader('DIAGNOSIS FAILED');
    console.log('❌ Cannot proceed without required environment variables.\n');
    console.log('Usage:');
    console.log('  SERVICE_ACCOUNT_JSON=\'...\' SCRIPT_ID=\'...\' node scripts/diagnose-apps-script-access.js\n');
    process.exit(1);
  }

  // Check 2: Authentication
  const authResult = await checkAuthentication();
  if (!authResult) {
    printHeader('DIAGNOSIS FAILED');
    console.log('❌ Cannot proceed without valid authentication.\n');
    process.exit(1);
  }

  // Check 3: API enabled
  const apiEnabled = await checkApiEnabled(authResult.authClient);

  // Check 4: Script access
  const scriptAccess = await checkScriptAccess(authResult.authClient);

  // Check 5: Write access (user settings)
  const writeAccess = await checkWriteAccess(authResult.authClient);

  // Final summary
  printHeader('DIAGNOSIS SUMMARY');

  if (apiEnabled && scriptAccess && writeAccess) {
    console.log(`${colors.green}✅ ALL CHECKS PASSED!${colors.reset}\n`);
    console.log('Your Apps Script API access is correctly configured.');
    console.log('Deployment should work successfully.\n');
    console.log('Next step: Run deployment');
    console.log('  npm run deploy\n');
    process.exit(0);
  } else {
    console.log(`${colors.red}❌ CONFIGURATION ISSUES DETECTED${colors.reset}\n`);
    console.log('Please review the failed checks above and follow the remediation steps.\n');

    if (!writeAccess && apiEnabled && scriptAccess) {
      console.log(`${colors.yellow}Most likely issue:${colors.reset}`);
      console.log('  → Apps Script API user setting is not enabled');
      console.log('  → Go to: https://script.google.com/home/usersettings');
      console.log('  → Enable: "Google Apps Script API"\n');
    }

    console.log('📖 Complete setup guide: docs/APPS_SCRIPT_API_SETUP.md\n');
    process.exit(1);
  }
}

// Run diagnostics
if (require.main === module) {
  diagnose().catch(error => {
    console.error('\n❌ Diagnostic script failed:', error.message);
    process.exit(1);
  });
}

module.exports = { diagnose };
