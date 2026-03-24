#!/usr/bin/env node

/**
 * Story 5.3 - Worker Rollback Script
 *
 * Rollback Cloudflare Workers to previous (N-1) deployment in a single command.
 *
 * Usage:
 *   npm run rollback:staging      - Rollback staging to previous version
 *   npm run rollback:prod         - Rollback production to previous version
 *   npm run rollback:all          - Rollback both staging and production
 *
 *   node scripts/rollback-worker.mjs staging
 *   node scripts/rollback-worker.mjs production
 *   node scripts/rollback-worker.mjs all
 *
 * Options:
 *   --list       List recent deployments without rolling back
 *   --dry-run    Show what would be rolled back without executing
 *   --force      Skip confirmation prompt
 *   --verify     Run health checks after rollback
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_DIR = join(__dirname, '..', 'cloudflare-proxy');

// Configuration
const CONFIG = {
  staging: {
    env: 'staging',
    workerName: 'eventangle-staging',
    healthUrl: 'https://stg.eventangle.com/api/status',
    displayName: 'Staging',
  },
  production: {
    env: 'production',
    workerName: 'eventangle-prod',
    healthUrl: 'https://www.eventangle.com/api/status',
    displayName: 'Production',
  },
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

function logSuccess(message) {
  log(`[OK] ${message}`, 'green');
}

function logError(message) {
  log(`[ERROR] ${message}`, 'red');
}

function logWarning(message) {
  log(`[WARN] ${message}`, 'yellow');
}

function logInfo(message) {
  log(`[INFO] ${message}`, 'cyan');
}

function logHeader(title) {
  console.log('\n' + colors.cyan + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + colors.reset + '\n');
}

/**
 * Execute a command and return the result
 */
function exec(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      cwd: options.cwd || PROXY_DIR,
      stdio: options.silent ? 'pipe' : ['pipe', 'pipe', 'pipe'],
      ...options,
    });
    return { success: true, output: result.trim() };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      output: error.stdout?.toString() || error.stderr?.toString() || '',
    };
  }
}

/**
 * List deployments for an environment
 */
function listDeployments(env) {
  logInfo(`Fetching deployments for ${env}...`);

  const result = exec(`wrangler deployments list --env ${env}`, { silent: true });

  if (!result.success) {
    logError(`Failed to list deployments: ${result.error}`);
    return null;
  }

  // Parse the deployment list output
  const lines = result.output.split('\n');
  const deployments = [];

  for (const line of lines) {
    // Look for deployment IDs (UUID format)
    const match = line.match(/([a-f0-9-]{36})/i);
    if (match) {
      const isActive = line.toLowerCase().includes('active') || line.includes('*');
      deployments.push({
        id: match[1],
        active: isActive,
        raw: line.trim(),
      });
    }
  }

  return {
    raw: result.output,
    deployments,
  };
}

/**
 * Display deployments in a formatted table
 */
function displayDeployments(env, data) {
  const config = CONFIG[env];
  logHeader(`${config.displayName} Deployments (${config.workerName})`);

  if (!data || !data.raw) {
    logWarning('No deployment data available');
    return;
  }

  console.log(data.raw);
  console.log();

  if (data.deployments.length >= 2) {
    const current = data.deployments.find((d) => d.active) || data.deployments[0];
    const previous = data.deployments.find((d) => !d.active) || data.deployments[1];

    logInfo(`Current (N):   ${current?.id || 'Unknown'}`);
    logInfo(`Previous (N-1): ${previous?.id || 'Unknown'}`);
  }
}

/**
 * Perform rollback for an environment
 */
async function rollback(env, options = {}) {
  const config = CONFIG[env];

  logHeader(`Rolling back ${config.displayName}`);

  // Get current deployments
  const deployments = listDeployments(env);

  if (!deployments || deployments.deployments.length < 2) {
    logError(`Not enough deployments found for ${env}. Need at least 2 deployments to rollback.`);
    return { success: false, env };
  }

  // Find the previous deployment (N-1)
  const activeDeployment = deployments.deployments.find((d) => d.active);
  const previousDeployment = deployments.deployments.find((d) => !d.active);

  if (!previousDeployment) {
    logError('Could not identify previous deployment');
    return { success: false, env };
  }

  logInfo(`Current deployment: ${activeDeployment?.id || 'Unknown'}`);
  logInfo(`Will rollback to:   ${previousDeployment.id}`);

  // Dry run check
  if (options.dryRun) {
    logWarning('DRY RUN - No changes will be made');
    logInfo(`Would execute: wrangler rollback --env ${env}`);
    return { success: true, env, dryRun: true };
  }

  // Confirmation prompt (unless --force)
  if (!options.force) {
    const confirmed = await confirm(
      `\nAre you sure you want to rollback ${config.displayName} to deployment ${previousDeployment.id}?`
    );
    if (!confirmed) {
      logWarning('Rollback cancelled by user');
      return { success: false, env, cancelled: true };
    }
  }

  // Execute rollback
  logInfo(`Executing rollback for ${env}...`);

  const result = exec(`wrangler rollback --env ${env}`, { silent: false });

  if (!result.success) {
    logError(`Rollback failed: ${result.error}`);
    return { success: false, env, error: result.error };
  }

  logSuccess(`Rollback completed for ${config.displayName}`);

  // Verify if requested
  if (options.verify) {
    await verifyRollback(env);
  }

  return { success: true, env };
}

/**
 * Verify rollback was successful with health check
 */
async function verifyRollback(env) {
  const config = CONFIG[env];

  logInfo(`Verifying rollback for ${config.displayName}...`);

  // Wait a moment for deployment to propagate
  logInfo('Waiting 5 seconds for deployment to propagate...');
  await sleep(5000);

  // Health check
  try {
    const https = await import('https');

    const healthResult = await new Promise((resolve) => {
      const req = https.default.get(config.healthUrl, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ success: res.statusCode === 200, statusCode: res.statusCode, data });
        });
      });

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Timeout' });
      });
    });

    if (healthResult.success) {
      logSuccess(`Health check passed for ${config.displayName}`);

      // Try to parse and show version info
      try {
        const status = JSON.parse(healthResult.data);
        if (status.version || status.buildId) {
          logInfo(`Version: ${status.version || status.buildId}`);
        }
      } catch {
        // Ignore parse errors
      }
    } else {
      logWarning(
        `Health check returned status ${healthResult.statusCode || healthResult.error}`
      );
    }

    return healthResult;
  } catch (error) {
    logError(`Health check failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Prompt for confirmation
 */
function confirm(message) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    environments: [],
    list: false,
    dryRun: false,
    force: false,
    verify: false,
    help: false,
  };

  for (const arg of args) {
    switch (arg) {
      case '--list':
      case '-l':
        options.list = true;
        break;
      case '--dry-run':
      case '-n':
        options.dryRun = true;
        break;
      case '--force':
      case '-f':
        options.force = true;
        break;
      case '--verify':
      case '-v':
        options.verify = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case 'staging':
      case 'stg':
        options.environments.push('staging');
        break;
      case 'production':
      case 'prod':
        options.environments.push('production');
        break;
      case 'all':
      case 'both':
        options.environments.push('staging', 'production');
        break;
      default:
        if (!arg.startsWith('-')) {
          logWarning(`Unknown argument: ${arg}`);
        }
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
${colors.cyan}Story 5.3 - Worker Rollback Script${colors.reset}

Rollback Cloudflare Workers to the previous (N-1) deployment.

${colors.bright}USAGE:${colors.reset}
  node scripts/rollback-worker.mjs <environment> [options]

${colors.bright}ENVIRONMENTS:${colors.reset}
  staging, stg       Rollback staging worker (eventangle-staging)
  production, prod   Rollback production worker (eventangle-prod)
  all, both          Rollback both staging and production

${colors.bright}OPTIONS:${colors.reset}
  --list, -l         List recent deployments without rolling back
  --dry-run, -n      Show what would happen without making changes
  --force, -f        Skip confirmation prompts
  --verify, -v       Run health checks after rollback
  --help, -h         Show this help message

${colors.bright}NPM SCRIPTS:${colors.reset}
  npm run rollback:staging       Rollback staging to N-1
  npm run rollback:prod          Rollback production to N-1
  npm run rollback:all           Rollback both environments
  npm run rollback:list          List deployments for all environments

${colors.bright}EXAMPLES:${colors.reset}
  # List all deployments
  node scripts/rollback-worker.mjs staging --list

  # Rollback staging (with confirmation)
  node scripts/rollback-worker.mjs staging

  # Rollback production without confirmation
  node scripts/rollback-worker.mjs production --force

  # Rollback both with verification
  node scripts/rollback-worker.mjs all --verify

  # Dry run to see what would happen
  node scripts/rollback-worker.mjs production --dry-run

${colors.bright}WRANGLER COMMANDS USED:${colors.reset}
  wrangler deployments list --env <env>   List deployment history
  wrangler rollback --env <env>           Rollback to previous version

${colors.bright}DOCUMENTATION:${colors.reset}
  See docs/ROLLBACK.md for complete rollback procedures.
`);
}

/**
 * Main function
 */
async function main() {
  // Check we're in the right directory
  if (!existsSync(PROXY_DIR)) {
    logError(`cloudflare-proxy directory not found at ${PROXY_DIR}`);
    logInfo('Make sure you run this from the repository root');
    process.exit(1);
  }

  const options = parseArgs();

  // Help
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Default to showing help if no environment specified
  if (options.environments.length === 0 && !options.list) {
    printHelp();
    process.exit(0);
  }

  // List mode
  if (options.list) {
    const envs = options.environments.length > 0 ? options.environments : ['staging', 'production'];

    for (const env of envs) {
      const data = listDeployments(env);
      displayDeployments(env, data);
    }
    process.exit(0);
  }

  // Rollback mode
  logHeader('Worker Rollback - Story 5.3');

  const results = [];

  for (const env of options.environments) {
    const result = await rollback(env, options);
    results.push(result);
  }

  // Summary
  console.log('\n' + colors.cyan + '='.repeat(60) + colors.reset);
  log('  ROLLBACK SUMMARY', 'bright');
  console.log(colors.cyan + '='.repeat(60) + colors.reset + '\n');

  for (const result of results) {
    const config = CONFIG[result.env];
    if (result.success) {
      if (result.dryRun) {
        logInfo(`${config.displayName}: DRY RUN - would rollback`);
      } else if (result.cancelled) {
        logWarning(`${config.displayName}: Cancelled`);
      } else {
        logSuccess(`${config.displayName}: Rolled back successfully`);
      }
    } else {
      logError(`${config.displayName}: Failed${result.error ? ` - ${result.error}` : ''}`);
    }
  }

  console.log();

  // Exit with error if any rollback failed
  const anyFailed = results.some((r) => !r.success && !r.cancelled);
  process.exit(anyFailed ? 1 : 0);
}

// Run
main().catch((error) => {
  logError(`Unexpected error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
