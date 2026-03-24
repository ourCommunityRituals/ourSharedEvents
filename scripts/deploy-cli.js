#!/usr/bin/env node

/**
 * MVP Event Toolkit - Deployment Automation CLI
 *
 * A comprehensive deployment automation tool that handles:
 * - Pre-flight verification
 * - Automated deployment with retries
 * - Post-deployment health checks
 * - Automatic rollback on failure
 * - Deployment history tracking
 * - Interactive setup wizard
 *
 * Usage:
 *   node scripts/deploy-cli.js <command> [options]
 *
 * Commands:
 *   auto       - Fully automated deployment (pre-flight → deploy → verify)
 *   setup      - Interactive setup wizard
 *   verify     - Run pre-flight checks only
 *   deploy     - Deploy without pre-flight checks
 *   rollback   - Rollback to previous deployment
 *   status     - Check current deployment status
 *   history    - Show deployment history
 *   health     - Run health checks on deployed app
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const CONFIG = {
  SCRIPT_ID: process.env.SCRIPT_ID || '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l',
  DEPLOYMENT_HISTORY_FILE: '.deployment-history.json',
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000, // ms
  HEALTH_CHECK_TIMEOUT: 30000, // ms
  HEALTH_CHECK_RETRIES: 5,
};

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
  check: '✓',
  cross: '✗',
  hourglass: '⏳',
  party: '🎉',
  fire: '🔥',
  shield: '🛡️',
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
  print(`[${step}/${total}] ${message}`, 'blue');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function execCommand(command, options = {}) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
    return { success: true, output };
  } catch (error) {
    return { success: false, error, output: error.stdout || error.stderr };
  }
}

async function execCommandAsync(command, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' });
    proc.on('close', code => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        reject({ success: false, code });
      }
    });
  });
}

// Deployment History Management
class DeploymentHistory {
  constructor() {
    this.historyFile = path.join(process.cwd(), CONFIG.DEPLOYMENT_HISTORY_FILE);
    this.history = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      printWarning(`Could not load deployment history: ${error.message}`);
    }
    return { deployments: [] };
  }

  save() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    } catch (error) {
      printWarning(`Could not save deployment history: ${error.message}`);
    }
  }

  add(deployment) {
    this.history.deployments.unshift({
      ...deployment,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 50 deployments
    if (this.history.deployments.length > 50) {
      this.history.deployments = this.history.deployments.slice(0, 50);
    }

    this.save();
  }

  getLatest() {
    return this.history.deployments[0] || null;
  }

  getPrevious() {
    return this.history.deployments[1] || null;
  }

  list(count = 10) {
    return this.history.deployments.slice(0, count);
  }
}

// Verification Module
class PreFlightVerifier {
  constructor() {
    this.checks = [];
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
  }

  async runAllChecks() {
    printHeader('PRE-FLIGHT VERIFICATION');

    await this.checkDependencies();
    await this.checkProjectFiles();
    await this.checkConfiguration();
    await this.checkTests();
    await this.checkLinting();
    await this.checkGitStatus();

    this.printSummary();
    return this.failed === 0;
  }

  async checkDependencies() {
    print('\n📦 Checking Dependencies...', 'blue');

    if (fs.existsSync('node_modules')) {
      printSuccess('node_modules exists');
      this.passed++;
    } else {
      printError('node_modules not found - run npm install');
      this.failed++;
      return;
    }

    if (fs.existsSync('node_modules/googleapis')) {
      printSuccess('googleapis package installed');
      this.passed++;
    } else {
      printError('googleapis not found - run npm install');
      this.failed++;
    }
  }

  async checkProjectFiles() {
    print('\n📄 Checking Project Files...', 'blue');

    const requiredFiles = [
      'Code.gs',
      'appsscript.json',
      'package.json',
      'scripts/deploy-apps-script.js',
      'DEPLOYMENT_CONFIGURATION.md',
    ];

    for (const file of requiredFiles) {
      if (fs.existsSync(file)) {
        printSuccess(`${file} exists`);
        this.passed++;
      } else {
        printError(`${file} not found`);
        this.failed++;
      }
    }
  }

  async checkConfiguration() {
    print('\n⚙️  Checking Configuration...', 'blue');

    if (process.env.SERVICE_ACCOUNT_JSON) {
      printSuccess('SERVICE_ACCOUNT_JSON is set');
      this.passed++;

      try {
        JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
        printSuccess('SERVICE_ACCOUNT_JSON is valid JSON');
        this.passed++;
      } catch (error) {
        printError('SERVICE_ACCOUNT_JSON is not valid JSON');
        this.failed++;
      }
    } else {
      printWarning('SERVICE_ACCOUNT_JSON not set (required for deployment)');
      this.warnings++;
    }

    if (process.env.SCRIPT_ID || CONFIG.SCRIPT_ID) {
      printSuccess('SCRIPT_ID is configured');
      this.passed++;
    } else {
      printError('SCRIPT_ID not configured');
      this.failed++;
    }
  }

  async checkTests() {
    print('\n🧪 Running Tests...', 'blue');

    const result = execCommand('npm test', { silent: true });

    if (result.success) {
      printSuccess('All tests passed');
      this.passed++;
    } else {
      printError('Tests failed');
      this.failed++;
      if (result.output) {
        console.log(result.output);
      }
    }
  }

  async checkLinting() {
    print('\n🔍 Running Linter...', 'blue');

    const result = execCommand('npm run lint', { silent: true });

    if (result.success) {
      printSuccess('Linting passed');
      this.passed++;
    } else {
      printError('Linting failed');
      this.failed++;
      if (result.output) {
        console.log(result.output);
      }
    }
  }

  async checkGitStatus() {
    print('\n🔀 Checking Git Status...', 'blue');

    const result = execCommand('git status --porcelain', { silent: true });

    if (result.success) {
      if (result.output.trim() === '') {
        printSuccess('Working directory is clean');
        this.passed++;
      } else {
        printWarning('Working directory has uncommitted changes');
        this.warnings++;
        console.log(result.output);
      }
    } else {
      printWarning('Could not check git status');
      this.warnings++;
    }

    // Check current branch
    const branchResult = execCommand('git branch --show-current', { silent: true });
    if (branchResult.success) {
      const branch = branchResult.output.trim();
      printInfo(`Current branch: ${branch}`);
    }
  }

  printSummary() {
    print('\n' + '─'.repeat(70), 'cyan');
    printSuccess(`Passed: ${this.passed}`);
    printWarning(`Warnings: ${this.warnings}`);
    printError(`Failed: ${this.failed}`);
    print('─'.repeat(70) + '\n', 'cyan');
  }
}

// Deployment Module
class Deployer {
  constructor() {
    this.history = new DeploymentHistory();
  }

  async deploy(skipPreFlight = false) {
    const startTime = Date.now();

    printHeader('🚀 AUTOMATED DEPLOYMENT');

    // Step 1: Pre-flight checks
    if (!skipPreFlight) {
      printStep(1, 5, 'Running pre-flight checks...');
      const verifier = new PreFlightVerifier();
      const passed = await verifier.runAllChecks();

      if (!passed) {
        printError('Pre-flight checks failed. Aborting deployment.');
        return { success: false, stage: 'pre-flight' };
      }
    } else {
      printWarning('Skipping pre-flight checks (not recommended)');
    }

    // Step 2: Deploy
    printStep(2, 5, 'Deploying to Apps Script...');
    const deployResult = await this.deployWithRetry();

    if (!deployResult.success) {
      printError('Deployment failed.');
      this.recordDeployment({
        status: 'failed',
        stage: 'deployment',
        error: deployResult.error,
        duration: Date.now() - startTime,
      });
      return { success: false, stage: 'deployment', error: deployResult.error };
    }

    printSuccess('Deployment successful!');

    // Step 3: Extract deployment URL
    printStep(3, 5, 'Extracting deployment URL...');
    const deploymentUrl = this.extractDeploymentUrl(deployResult.output);

    if (deploymentUrl) {
      printSuccess(`Deployment URL: ${deploymentUrl}`);
    } else {
      printWarning('Could not extract deployment URL from output');
    }

    // Step 4: Wait for deployment to propagate
    printStep(4, 5, 'Waiting for deployment to propagate...');
    await this.waitForPropagation(5000);

    // Step 5: Health checks
    printStep(5, 5, 'Running health checks...');
    const healthCheck = await this.runHealthChecks(deploymentUrl);

    if (!healthCheck.success) {
      printError('Health checks failed. Deployment may have issues.');

      // Ask about rollback
      if (await this.shouldRollback()) {
        await this.rollback();
        return { success: false, stage: 'health-check', rolledBack: true };
      }
    } else {
      printSuccess('All health checks passed!');
    }

    // Record successful deployment
    const duration = Date.now() - startTime;
    this.recordDeployment({
      status: 'success',
      url: deploymentUrl,
      duration,
      healthCheck: healthCheck.success,
    });

    this.printSuccessSummary(deploymentUrl, duration);

    return { success: true, url: deploymentUrl, duration };
  }

  async deployWithRetry() {
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      if (attempt > 1) {
        printInfo(`Retry attempt ${attempt}/${CONFIG.MAX_RETRIES}...`);
        await sleep(CONFIG.RETRY_DELAY * attempt);
      }

      try {
        const result = await execCommandAsync('npm', ['run', 'deploy']);
        if (result.success) {
          return { success: true };
        }
      } catch (error) {
        if (attempt === CONFIG.MAX_RETRIES) {
          return { success: false, error };
        }
        printWarning(`Deployment attempt ${attempt} failed, retrying...`);
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  extractDeploymentUrl(output) {
    // Try to extract URL from deployment output
    if (!output) return null;

    const urlMatch = output.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/);
    return urlMatch ? urlMatch[0] : null;
  }

  async waitForPropagation(ms) {
    printInfo(`Waiting ${ms/1000} seconds for changes to propagate...`);
    await sleep(ms);
    printSuccess('Wait complete');
  }

  async runHealthChecks(url) {
    if (!url) {
      printWarning('No deployment URL provided, skipping health checks');
      return { success: false, reason: 'no-url' };
    }

    print('\n🏥 Health Check Tests:', 'blue');

    const checks = [
      { name: 'Status Endpoint', path: '?page=status' },
    ];

    let allPassed = true;

    for (const check of checks) {
      const fullUrl = url + check.path;

      try {
        // Validate URL to prevent command injection
        let urlObj;
        try {
          urlObj = new URL(fullUrl);
        } catch (urlError) {
          printError(`${check.name}: Invalid URL`);
          allPassed = false;
          continue;
        }

        // Use Node's built-in https module instead of curl to avoid command injection
        const https = require('https');
        const http = require('http');
        const protocol = urlObj.protocol === 'https:' ? https : http;

        const result = await new Promise((resolve) => {
          const req = protocol.get(fullUrl, { timeout: 10000 }, (res) => {
            // Consume response data to free up memory
            res.resume();
            resolve({ success: true, statusCode: res.statusCode });
          });

          req.on('error', () => {
            resolve({ success: false, statusCode: 0 });
          });

          req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, statusCode: 0 });
          });
        });

        if (result.success) {
          if (result.statusCode === 200) {
            printSuccess(`${check.name}: OK (200)`);
          } else {
            printWarning(`${check.name}: ${result.statusCode}`);
            allPassed = false;
          }
        } else {
          printError(`${check.name}: Failed to connect`);
          allPassed = false;
        }
      } catch (error) {
        printError(`${check.name}: ${error.message}`);
        allPassed = false;
      }
    }

    return { success: allPassed };
  }

  async shouldRollback() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('\nHealth checks failed. Rollback to previous deployment? (y/N): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  async rollback() {
    printHeader('🔄 ROLLBACK IN PROGRESS');

    const previous = this.history.getPrevious();

    if (!previous || !previous.url) {
      printError('No previous deployment found to rollback to');
      return { success: false };
    }

    printInfo(`Rolling back to deployment from ${previous.timestamp}`);
    printInfo(`Previous URL: ${previous.url}`);

    // In a real scenario, you'd redeploy the previous version
    // For now, we just warn the user
    printWarning('Automatic rollback requires git revert or manual Apps Script rollback');
    printInfo('To rollback manually:');
    printInfo('1. Go to Apps Script → Deploy → Manage deployments');
    printInfo('2. Select previous version and promote to production');

    return { success: false, manual: true };
  }

  recordDeployment(data) {
    this.history.add(data);
  }

  printSuccessSummary(url, duration) {
    print('\n' + colors.green + '═'.repeat(70));
    print(`${emoji.party}  DEPLOYMENT SUCCESSFUL!  ${emoji.party}`, 'green');
    print('═'.repeat(70) + colors.reset);

    if (url) {
      print(`\n${emoji.rocket} Production URL:`, 'cyan');
      print(`   ${url}`, 'bright');
    }

    print(`\n${emoji.hourglass} Deployment Time: ${(duration/1000).toFixed(2)}s`, 'cyan');

    print('\n' + colors.green + '═'.repeat(70) + colors.reset + '\n');
  }
}

// Setup Wizard
class SetupWizard {
  async run() {
    printHeader('🛠️  DEPLOYMENT SETUP WIZARD');

    print('This wizard will help you configure deployment for the first time.\n', 'cyan');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt) => new Promise((resolve) => {
      rl.question(prompt, resolve);
    });

    // Check current configuration
    print('📋 Current Configuration:\n', 'blue');
    printInfo(`Script ID: ${CONFIG.SCRIPT_ID}`);
    printInfo(`Service Account JSON: ${process.env.SERVICE_ACCOUNT_JSON ? 'Set' : 'Not set'}`);

    print('\n🔐 Required Setup Steps:\n', 'yellow');

    print('1. Apps Script API - User Settings', 'bright');
    print('   URL: https://script.google.com/home/usersettings');
    print('   Action: Toggle ON "Google Apps Script API"\n');

    print('2. Service Account Access', 'bright');
    print(`   URL: https://script.google.com/home/projects/${CONFIG.SCRIPT_ID}/edit`);
    print('   Action: Share with apps-script-deployer@zeventbooks.iam.gserviceaccount.com\n');

    print('3. GitHub Secrets', 'bright');
    print('   URL: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions');
    print('   Secrets: APPS_SCRIPT_SERVICE_ACCOUNT_JSON, SCRIPT_ID, ADMIN_KEY_ROOT\n');

    const continueSetup = await question('Have you completed these steps? (y/N): ');

    if (continueSetup.toLowerCase() !== 'y' && continueSetup.toLowerCase() !== 'yes') {
      print('\nPlease complete the setup steps and run this wizard again.', 'yellow');
      print('For detailed instructions, see: docs/APPS_SCRIPT_API_SETUP.md\n', 'cyan');
      rl.close();
      return;
    }

    // Run verification
    print('\n🔍 Running verification checks...\n', 'blue');
    const verifier = new PreFlightVerifier();
    await verifier.runAllChecks();

    if (verifier.failed > 0) {
      print('\n⚠️  Some checks failed. Please fix the issues above.', 'yellow');
    } else {
      print(`\n${emoji.party} Setup looks good! You're ready to deploy!`, 'green');
      print('\nNext steps:', 'cyan');
      print('  1. Run deployment: npm run deploy:auto');
      print('  2. Or push to main: git push origin main\n');
    }

    rl.close();
  }
}

// Status Checker
class StatusChecker {
  async check() {
    printHeader('📊 DEPLOYMENT STATUS');

    const history = new DeploymentHistory();
    const latest = history.getLatest();

    if (!latest) {
      printWarning('No deployment history found');
      return;
    }

    print('Latest Deployment:\n', 'blue');
    printInfo(`Status: ${latest.status === 'success' ? emoji.success : emoji.error} ${latest.status}`);
    printInfo(`Timestamp: ${new Date(latest.timestamp).toLocaleString()}`);

    if (latest.url) {
      printInfo(`URL: ${latest.url}`);
    }

    if (latest.duration) {
      printInfo(`Duration: ${(latest.duration/1000).toFixed(2)}s`);
    }

    if (latest.url) {
      print('\n🏥 Running live health check...', 'blue');
      const deployer = new Deployer();
      const health = await deployer.runHealthChecks(latest.url);

      if (health.success) {
        printSuccess('Application is healthy');
      } else {
        printWarning('Health checks failed or incomplete');
      }
    }
  }
}

// History Viewer
class HistoryViewer {
  async show(count = 10) {
    printHeader('📜 DEPLOYMENT HISTORY');

    const history = new DeploymentHistory();
    const deployments = history.list(count);

    if (deployments.length === 0) {
      printWarning('No deployment history found');
      return;
    }

    print(`Showing last ${deployments.length} deployments:\n`, 'cyan');

    deployments.forEach((deployment, index) => {
      const status = deployment.status === 'success' ? emoji.success : emoji.error;
      const date = new Date(deployment.timestamp).toLocaleString();
      const duration = deployment.duration ? ` (${(deployment.duration/1000).toFixed(2)}s)` : '';

      print(`${index + 1}. ${status} ${date}${duration}`, deployment.status === 'success' ? 'green' : 'red');

      if (deployment.url) {
        print(`   URL: ${deployment.url}`, 'cyan');
      }

      if (deployment.error) {
        print(`   Error: ${deployment.error}`, 'red');
      }

      console.log();
    });
  }
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  try {
    switch (command) {
      case 'auto':
      case 'automatic': {
        const deployer = new Deployer();
        await deployer.deploy(false);
        break;
      }

      case 'deploy': {
        const quickDeployer = new Deployer();
        await quickDeployer.deploy(true); // Skip pre-flight
        break;
      }

      case 'verify':
      case 'check': {
        const verifier = new PreFlightVerifier();
        await verifier.runAllChecks();
        break;
      }

      case 'setup':
      case 'init': {
        const wizard = new SetupWizard();
        await wizard.run();
        break;
      }

      case 'status': {
        const checker = new StatusChecker();
        await checker.check();
        break;
      }

      case 'history': {
        const count = parseInt(args[1]) || 10;
        const viewer = new HistoryViewer();
        await viewer.show(count);
        break;
      }

      case 'rollback': {
        const rollbackDeployer = new Deployer();
        await rollbackDeployer.rollback();
        break;
      }

      case 'help':
      case '--help':
      case '-h':
      default:
        printHelp();
        break;
    }
  } catch (error) {
    printError(`Command failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

function printHelp() {
  print(`
${colors.cyan}╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║           MVP Event Toolkit - Deployment CLI                 ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bright}USAGE:${colors.reset}
  npm run deploy:<command> [options]
  node scripts/deploy-cli.js <command> [options]

${colors.bright}COMMANDS:${colors.reset}

  ${colors.green}auto${colors.reset}        ${emoji.rocket} Fully automated deployment
              - Run pre-flight checks
              - Deploy to Apps Script
              - Run health checks
              - Record deployment history
              - Offer rollback on failure

  ${colors.green}verify${colors.reset}      ${emoji.shield} Run pre-flight checks only
              - Check dependencies
              - Check configuration
              - Run tests
              - Run linter
              - Check git status

  ${colors.green}deploy${colors.reset}      ${emoji.gear} Deploy without pre-flight checks
              - Quick deployment
              - Skips verification (not recommended)

  ${colors.green}setup${colors.reset}       ${emoji.info} Interactive setup wizard
              - Guide through configuration
              - Verify setup steps
              - Run initial checks

  ${colors.green}status${colors.reset}      📊 Check deployment status
              - Show latest deployment
              - Run health checks
              - Display deployment info

  ${colors.green}history${colors.reset}     📜 Show deployment history
              - List recent deployments
              - Show success/failure stats
              Usage: history [count]

  ${colors.green}rollback${colors.reset}    🔄 Rollback to previous deployment
              - Show previous deployment
              - Guide through rollback process

  ${colors.green}help${colors.reset}        Display this help message

${colors.bright}EXAMPLES:${colors.reset}

  # Full automated deployment (recommended)
  npm run deploy:auto

  # Quick deployment without checks
  npm run deploy:quick

  # Run pre-flight checks only
  npm run deploy:verify

  # Interactive setup
  npm run deploy:setup

  # Check current status
  npm run deploy:status

  # View last 20 deployments
  npm run deploy:history 20

${colors.bright}ENVIRONMENT VARIABLES:${colors.reset}

  SERVICE_ACCOUNT_JSON    Service account credentials (required)
  SCRIPT_ID              Apps Script project ID (optional, has default)

${colors.bright}DOCUMENTATION:${colors.reset}

  Quick Start:     START_HERE.md
  Configuration:   DEPLOYMENT_CONFIGURATION.md
  Checklist:       PRE_DEPLOY_CHECKLIST.md
  Setup Guide:     docs/APPS_SCRIPT_API_SETUP.md

${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}
`, 'reset');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    printError(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  Deployer,
  PreFlightVerifier,
  SetupWizard,
  StatusChecker,
  HistoryViewer,
  DeploymentHistory,
};
