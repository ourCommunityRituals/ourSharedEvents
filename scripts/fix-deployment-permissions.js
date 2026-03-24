#!/usr/bin/env node

/**
 * Fix Deployment Permissions Script
 *
 * This script automates the process of fixing Google Apps Script deployment
 * permission issues when the web app can't access Google Spreadsheets.
 *
 * What it does:
 * 1. Tests the current deployment for permission errors
 * 2. Verifies OAuth scopes are configured correctly
 * 3. Guides through manual authorization if needed
 * 4. Tests spreadsheet access
 * 5. Re-deploys with correct permissions
 *
 * Usage:
 *   node scripts/fix-deployment-permissions.js
 *   node scripts/fix-deployment-permissions.js --auto   # Skip confirmations
 *   node scripts/fix-deployment-permissions.js --test   # Test only, no deploy
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

// Configuration
const CONFIG = {
  SCRIPT_ID: '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l',
  SPREADSHEET_ID: '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ',
  DEPLOYMENT_URL: process.env.BASE_URL || 'https://script.google.com/macros/s/AKfycbx3n9ALDESLEQTgIf47pimbs4zhugPzC4gLLr6aBff6UpH4VzAquYHRVHurP-6QjZ-g/exec',
  TEST_BRAND: 'abc',
};

// Parse command line arguments
const args = process.argv.slice(2);
const AUTO_MODE = args.includes('--auto');
const TEST_ONLY = args.includes('--test');

// Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

// Emojis
const emoji = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  rocket: '🚀',
  gear: '⚙️',
  lock: '🔒',
  key: '🔑',
  check: '✓',
  cross: '✗',
  hourglass: '⏳',
};

// Helper Functions
function print(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

function printHeader(title) {
  console.log('\n' + colors.cyan + '═'.repeat(70));
  console.log('  ' + title);
  console.log('═'.repeat(70) + colors.reset + '\n');
}

function printSuccess(message) {
  print(`${emoji.success} ${message}`, 'green');
}

function printError(message) {
  print(`${emoji.error} ${message}`, 'red');
}

function printWarning(message) {
  print(`${emoji.warning} ${message}`, 'yellow');
}

function printInfo(message) {
  print(`${emoji.info} ${message}`, 'cyan');
}

function printStep(step, total, message) {
  print(`\n[Step ${step}/${total}] ${message}`, 'blue');
  print('─'.repeat(70), 'blue');
}

function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
    return { success: true, output: result };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      output: error.stdout || error.stderr || ''
    };
  }
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    }).on('error', reject);
  });
}

async function prompt(question) {
  if (AUTO_MODE) return 'y';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(colors.yellow + question + colors.reset + ' ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase());
    });
  });
}

// Test Functions
async function testDeploymentAccess() {
  printInfo('Testing deployment URL...');

  try {
    const testUrl = `${CONFIG.DEPLOYMENT_URL}?page=status&brand=${CONFIG.TEST_BRAND}`;
    print(`  GET ${testUrl}`, 'cyan');

    const response = await httpsGet(testUrl);

    print(`  HTTP ${response.statusCode}`,
      response.statusCode === 200 ? 'green' : 'red');

    if (response.statusCode === 200) {
      try {
        const json = JSON.parse(response.body);
        if (json.ok) {
          printSuccess('Deployment is accessible and working!');
          print(`    Build: ${json.value.build}`, 'cyan');
          print(`    Brand: ${json.value.brand}`, 'cyan');
          return { success: true, data: json };
        } else {
          printError('API returned error: ' + json.message);
          return { success: false, error: json.message };
        }
      } catch (e) {
        printWarning('Response is not valid JSON');
        return { success: false, error: 'Invalid JSON response' };
      }
    } else if (response.statusCode === 302 || response.statusCode === 401) {
      printError('Authentication redirect detected!');
      printInfo('This means the deployment requires authorization');
      return { success: false, error: 'auth_required' };
    } else if (response.statusCode === 403) {
      printError('Permission denied!');
      printInfo('This usually means:');
      print('  • The spreadsheet ID is incorrect', 'yellow');
      print('  • The deployment account lacks spreadsheet access', 'yellow');
      print('  • The web app needs to be re-authorized', 'yellow');
      return { success: false, error: 'permission_denied' };
    } else {
      printError(`Unexpected status code: ${response.statusCode}`);
      return { success: false, error: `http_${response.statusCode}` };
    }
  } catch (error) {
    printError('Network error: ' + error.message);
    return { success: false, error: error.message };
  }
}

function checkAppsScriptConfig() {
  printInfo('Checking appsscript.json configuration...');

  const configPath = path.join(process.cwd(), 'appsscript.json');
  if (!fs.existsSync(configPath)) {
    printError('appsscript.json not found!');
    return { success: false, error: 'Missing appsscript.json' };
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const checks = [];

  // Check webapp configuration
  if (!config.webapp) {
    checks.push({ name: 'webapp configuration', status: 'missing' });
  } else {
    if (config.webapp.access === 'ANYONE_ANONYMOUS') {
      checks.push({ name: 'access: ANYONE_ANONYMOUS', status: 'ok' });
    } else {
      checks.push({ name: 'access', status: 'wrong', value: config.webapp.access });
    }

    if (config.webapp.executeAs === 'USER_DEPLOYING') {
      checks.push({ name: 'executeAs: USER_DEPLOYING', status: 'ok' });
    } else {
      checks.push({ name: 'executeAs', status: 'wrong', value: config.webapp.executeAs });
    }
  }

  // Check OAuth scopes
  const requiredScopes = [
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/spreadsheets'
  ];

  const missingScopes = requiredScopes.filter(scope =>
    !config.oauthScopes || !config.oauthScopes.includes(scope)
  );

  if (missingScopes.length === 0) {
    checks.push({ name: 'OAuth scopes', status: 'ok' });
  } else {
    checks.push({ name: 'OAuth scopes', status: 'missing', scopes: missingScopes });
  }

  // Print results
  let allOk = true;
  checks.forEach(check => {
    if (check.status === 'ok') {
      printSuccess(`  ${check.name}`);
    } else if (check.status === 'missing') {
      printError(`  ${check.name} - MISSING`);
      if (check.scopes) {
        check.scopes.forEach(scope => print(`    - ${scope}`, 'yellow'));
      }
      allOk = false;
    } else if (check.status === 'wrong') {
      printWarning(`  ${check.name} - WRONG VALUE: ${check.value}`);
      allOk = false;
    }
  });

  return { success: allOk, checks, config };
}

function checkClaspAuth() {
  printInfo('Checking clasp authentication...');

  const clasprcPath = path.join(require('os').homedir(), '.clasprc.json');

  if (!fs.existsSync(clasprcPath)) {
    printError('~/.clasprc.json not found!');
    printInfo('You need to authenticate with clasp first:');
    print('  npx @google/clasp login', 'cyan');
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const clasprc = JSON.parse(fs.readFileSync(clasprcPath, 'utf8'));

    // Check for OAuth token (support multiple formats)
    const hasToken =
      clasprc.access_token ||  // Flat format
      clasprc.token?.access_token ||  // Nested format
      clasprc.tokens?.default?.access_token;  // Clasp 3.x format

    if (hasToken) {
      printSuccess('Clasp is authenticated');
      return { success: true };
    } else {
      printError('No valid OAuth token found in ~/.clasprc.json');
      return { success: false, error: 'Invalid token' };
    }
  } catch (error) {
    printError('Failed to parse ~/.clasprc.json: ' + error.message);
    return { success: false, error: error.message };
  }
}

function checkBrandConfig() {
  printInfo('Checking brand configuration...');

  const configPath = path.join(process.cwd(), 'Config.gs');
  if (!fs.existsSync(configPath)) {
    printError('Config.gs not found!');
    return { success: false, error: 'Missing Config.gs' };
  }

  const config = fs.readFileSync(configPath, 'utf8');

  // Check spreadsheet ID
  const spreadsheetMatch = config.match(/spreadsheetId:\s*['"]([^'"]+)['"]/g);
  if (!spreadsheetMatch) {
    printError('No spreadsheet IDs found in Config.gs');
    return { success: false, error: 'Missing spreadsheet IDs' };
  }

  print(`  Found ${spreadsheetMatch.length} spreadsheet ID(s)`, 'cyan');

  // Check if our test brand exists
  const brandMatch = config.match(/id:\s*['"]abc['"]/);
  if (brandMatch) {
    printSuccess(`Test brand '${CONFIG.TEST_BRAND}' is configured`);
    return { success: true };
  } else {
    printWarning(`Test brand '${CONFIG.TEST_BRAND}' not found`);
    return { success: true, warning: 'Test brand not found' };
  }
}

async function runAuthorizationFlow() {
  printInfo('Starting authorization flow...');
  print('');
  print('Google Apps Script requires manual authorization when:');
  print('  • The script accesses Google services (like Spreadsheets)', 'yellow');
  print('  • The authorization has expired', 'yellow');
  print('  • The OAuth scopes have changed', 'yellow');
  print('');

  printWarning('This CANNOT be fully automated due to Google security requirements.');
  printInfo('You must authorize the script once through the Apps Script UI.');
  print('');

  print('Here\'s what you need to do:', 'bright');
  print('');
  print('1. Open your Apps Script project:', 'cyan');
  print(`   https://script.google.com/home/projects/${CONFIG.SCRIPT_ID}/edit`, 'blue');
  print('');
  print('2. In the editor, select any function that accesses Spreadsheets:', 'cyan');
  print('   • Select "api_status" from the function dropdown', 'blue');
  print('   • Click the Run button (▶️)', 'blue');
  print('');
  print('3. Authorize the script:', 'cyan');
  print('   • Click "Review permissions"', 'blue');
  print('   • Choose your Google account', 'blue');
  print('   • Click "Advanced" → "Go to [Project name] (unsafe)"', 'blue');
  print('   • Click "Allow"', 'blue');
  print('');
  print('4. After authorization, the function should run successfully', 'cyan');
  print('');

  const answer = await prompt('Have you completed the authorization? (y/n)');

  if (answer === 'y' || answer === 'yes') {
    printSuccess('Authorization completed!');
    return { success: true };
  } else {
    printWarning('Authorization skipped');
    return { success: false, skipped: true };
  }
}

async function redeployScript() {
  printInfo('Redeploying script with correct permissions...');

  // Push code first
  printInfo('Pushing code to Apps Script...');
  const pushResult = execCommand('npx @google/clasp push --force', { silent: false });

  if (!pushResult.success) {
    printError('Failed to push code');
    return { success: false, error: 'Push failed' };
  }

  printSuccess('Code pushed successfully');

  // Check if we should create a new deployment
  printInfo('Checking existing deployments...');
  const deploymentsResult = execCommand('npx @google/clasp deployments', { silent: true });

  if (deploymentsResult.success) {
    print(deploymentsResult.output);
  }

  const answer = await prompt('\nCreate a new deployment? (y/n)');

  if (answer === 'y' || answer === 'yes') {
    printInfo('Creating new deployment...');
    const timestamp = new Date().toISOString();
    const deployResult = execCommand(
      `npx @google/clasp deploy -d "Permission fix - ${timestamp}"`,
      { silent: false }
    );

    if (deployResult.success) {
      printSuccess('New deployment created!');
      printInfo('Please update your deployment URL in environment variables');
      return { success: true };
    } else {
      printError('Failed to create deployment');
      return { success: false, error: 'Deploy failed' };
    }
  } else {
    printInfo('Deployment skipped');
    return { success: true, skipped: true };
  }
}

async function generateAuthScript() {
  printInfo('Generating one-time authorization script...');

  const authScriptPath = path.join(process.cwd(), 'AuthorizeSpreadsheetAccess.gs');
  const authScript = `/**
 * ONE-TIME AUTHORIZATION SCRIPT
 *
 * This script is designed to be run ONCE from the Apps Script editor
 * to authorize spreadsheet access for the web app deployment.
 *
 * Instructions:
 * 1. Copy this file to your Apps Script project
 * 2. Select "authorizeSpreadsheetAccess" from the function dropdown
 * 3. Click Run (▶️)
 * 4. Complete the authorization flow
 * 5. Once authorized, you can delete this file
 *
 * After authorization, your web app deployment will have permission
 * to access the configured spreadsheets.
 */

function authorizeSpreadsheetAccess() {
  const BRANDS = [
    { id: 'root', spreadsheetId: '${CONFIG.SPREADSHEET_ID}' },
    { id: 'abc', spreadsheetId: '${CONFIG.SPREADSHEET_ID}' },
    { id: 'cbc', spreadsheetId: '${CONFIG.SPREADSHEET_ID}' },
    { id: 'cbl', spreadsheetId: '${CONFIG.SPREADSHEET_ID}' }
  ];

  Logger.log('Testing spreadsheet access for all brands...');
  Logger.log('═'.repeat(70));

  let allSuccess = true;

  BRANDS.forEach(function(brand) {
    try {
      Logger.log('\\nTesting brand: ' + brand.id);
      Logger.log('Spreadsheet ID: ' + brand.spreadsheetId);

      const ss = SpreadsheetApp.openById(brand.spreadsheetId);
      const name = ss.getName();
      const id = ss.getId();

      Logger.log('✅ SUCCESS');
      Logger.log('  Spreadsheet name: ' + name);
      Logger.log('  Spreadsheet ID: ' + id);
      Logger.log('  Access granted!');

    } catch (error) {
      Logger.log('❌ FAILED');
      Logger.log('  Error: ' + error.message);
      allSuccess = false;
    }
  });

  Logger.log('\\n' + '═'.repeat(70));

  if (allSuccess) {
    Logger.log('✅ ALL BRANDS: Spreadsheet access authorized!');
    Logger.log('\\nYour web app deployment is now authorized to access spreadsheets.');
    Logger.log('You can now:');
    Logger.log('  1. Test your deployment URL');
    Logger.log('  2. Delete this authorization script (optional)');
  } else {
    Logger.log('❌ SOME BRANDS FAILED');
    Logger.log('\\nPlease check:');
    Logger.log('  1. Spreadsheet IDs are correct');
    Logger.log('  2. You have access to the spreadsheets');
    Logger.log('  3. Spreadsheets exist and haven\\'t been deleted');
  }

  return allSuccess;
}

/**
 * Test just the root brand
 */
function quickTest() {
  try {
    const ss = SpreadsheetApp.openById('${CONFIG.SPREADSHEET_ID}');
    Logger.log('✅ Spreadsheet access works!');
    Logger.log('Spreadsheet: ' + ss.getName());
    return true;
  } catch (error) {
    Logger.log('❌ Error: ' + error.message);
    return false;
  }
}
`;

  fs.writeFileSync(authScriptPath, authScript);
  printSuccess(`Created authorization script: ${authScriptPath}`);
  printInfo('You can now:');
  print('  1. Copy this file to your Apps Script project', 'cyan');
  print('  2. Or run: npx @google/clasp push', 'cyan');
  print('  3. Then run authorizeSpreadsheetAccess() from the editor', 'cyan');

  return { success: true, scriptPath: authScriptPath };
}

// Main execution
async function main() {
  printHeader(`${emoji.lock} FIX DEPLOYMENT PERMISSIONS ${emoji.key}`);

  printInfo(`Script ID: ${CONFIG.SCRIPT_ID}`);
  printInfo(`Spreadsheet ID: ${CONFIG.SPREADSHEET_ID}`);
  printInfo(`Deployment URL: ${CONFIG.DEPLOYMENT_URL}`);
  print('');

  const results = {
    checks: {},
    needsAuth: false,
    needsRedeploy: false,
  };

  // Step 1: Test current deployment
  printStep(1, 6, 'Testing Current Deployment');
  const deploymentTest = await testDeploymentAccess();
  results.checks.deployment = deploymentTest;

  if (!deploymentTest.success) {
    if (deploymentTest.error === 'permission_denied' || deploymentTest.error === 'auth_required') {
      results.needsAuth = true;
    }
  }

  // Step 2: Check appsscript.json
  printStep(2, 6, 'Checking appsscript.json Configuration');
  const configCheck = checkAppsScriptConfig();
  results.checks.config = configCheck;

  if (!configCheck.success) {
    results.needsRedeploy = true;
  }

  // Step 3: Check clasp authentication
  printStep(3, 6, 'Checking Clasp Authentication');
  const claspCheck = checkClaspAuth();
  results.checks.clasp = claspCheck;

  // Step 4: Check brand configuration
  printStep(4, 6, 'Checking Brand Configuration');
  const brandCheck = checkBrandConfig();
  results.checks.brand = brandCheck;

  // Step 5: Handle authorization if needed
  if (results.needsAuth) {
    printStep(5, 6, 'Authorization Required');
    printWarning('Your deployment needs authorization!');
    print('');

    // Generate authorization script
    await generateAuthScript();
    print('');

    if (!TEST_ONLY) {
      const authResult = await runAuthorizationFlow();
      results.checks.authorization = authResult;

      if (authResult.success) {
        // Test again after authorization
        printInfo('Re-testing deployment...');
        const retestResult = await testDeploymentAccess();
        if (retestResult.success) {
          printSuccess('Authorization successful!');
          results.needsAuth = false;
        } else {
          printWarning('Deployment still failing after authorization');
        }
      }
    }
  } else {
    printStep(5, 6, 'Authorization Check');
    printSuccess('No authorization needed');
  }

  // Step 6: Redeploy if needed
  if (results.needsRedeploy && !TEST_ONLY) {
    printStep(6, 6, 'Redeployment');
    const redeployResult = await redeployScript();
    results.checks.redeploy = redeployResult;
  } else {
    printStep(6, 6, 'Deployment Status');
    if (TEST_ONLY) {
      printInfo('Test mode - skipping redeployment');
    } else {
      printSuccess('No redeployment needed');
    }
  }

  // Summary
  printHeader('📊 SUMMARY');

  const allPassed = Object.values(results.checks).every(check =>
    check.success || check.skipped
  );

  if (allPassed && deploymentTest.success) {
    printSuccess('All checks passed! Your deployment is working correctly.');
    print('');
    printInfo('Test URL:');
    print(`  ${CONFIG.DEPLOYMENT_URL}?page=status&brand=${CONFIG.TEST_BRAND}`, 'cyan');
  } else {
    printWarning('Some issues were found:');
    print('');

    Object.entries(results.checks).forEach(([name, check]) => {
      if (!check.success && !check.skipped) {
        printError(`  ${name}: ${check.error || 'Failed'}`);
      }
    });

    print('');
    printInfo('Next steps:');

    if (results.needsAuth) {
      print('  1. Complete the authorization flow (see instructions above)', 'yellow');
      print('  2. Run this script again to verify', 'yellow');
    }

    if (results.needsRedeploy) {
      print('  1. Fix appsscript.json configuration', 'yellow');
      print('  2. Run: npm run deploy', 'yellow');
    }

    if (!claspCheck.success) {
      print('  1. Authenticate with clasp: npx @google/clasp login', 'yellow');
    }
  }

  print('');
  printInfo('For more help, see:');
  print('  • APPS_SCRIPT_DEPLOYMENT_GUIDE.md', 'cyan');
  print('  • CLASP_SETUP.md', 'cyan');
  print('  • https://script.google.com/home/projects/' + CONFIG.SCRIPT_ID, 'blue');
  print('');

  process.exit(allPassed && deploymentTest.success ? 0 : 1);
}

// Run main function
main().catch(error => {
  printError('Fatal error: ' + error.message);
  console.error(error);
  process.exit(1);
});
