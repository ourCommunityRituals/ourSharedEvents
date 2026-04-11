#!/usr/bin/env node

/**
 * Verify Secrets Configuration (Story 2 - Confirm Secrets & Environment Variables)
 *
 * This script checks if all required secrets and configurations are properly set up
 * for CI/CD deployment. Secrets are grouped by function for clarity.
 *
 * Usage:
 *   node scripts/verify-secrets.js [--stage1|--stage2|--all] [--json] [--quiet]
 *
 * Options:
 *   --stage1   Validate Stage 1 secrets only (deployment)
 *   --stage2   Validate Stage 2 secrets only (testing)
 *   --all      Validate all secrets (default)
 *   --json     Output results as JSON
 *   --quiet    Only output errors
 *
 * Exit Codes:
 *   0 - All required secrets are present
 *   1 - One or more required secrets are missing
 *
 * @see docs/CLOUDFLARE_SECRETS.md - Full secrets documentation
 * @see .github-secrets-required.json - Canonical list of required secrets
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const MODE = {
  stage1: args.includes('--stage1'),
  stage2: args.includes('--stage2'),
  all: args.includes('--all') || (!args.includes('--stage1') && !args.includes('--stage2')),
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
};

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

/**
 * Secret definitions grouped by function
 *
 * Categories:
 * - cloudflare: Cloudflare Worker deployment credentials
 * - admin: Admin authentication keys
 * - notifications: Slack/Teams webhook URLs
 * - testing: Test-specific environment variables
 */
const SECRET_GROUPS = {
  cloudflare: {
    name: 'Cloudflare Deployment',
    description: 'Cloudflare Worker deployment and routing',
    docLink: 'docs/CLOUDFLARE_SECRETS.md#cloudflare-deployment',
    secrets: {
      stage1: [
        {
          name: 'CLOUDFLARE_API_TOKEN_OSE',
          env: 'CLOUDFLARE_API_TOKEN_OSE',
          description: 'Cloudflare API authentication token (OurSharedEvents)',
          required: true,
          rotationPolicy: 'As needed',
        },
        {
          name: 'CLOUDFLARE_ACCOUNT_ID',
          env: 'CLOUDFLARE_ACCOUNT_ID',
          description: 'Cloudflare account identifier',
          required: true,
          rotationPolicy: 'Static',
        },
      ],
      stage2: [],
    },
  },

  admin: {
    name: 'Admin Authentication',
    description: 'API authentication for admin endpoints',
    docLink: 'docs/CLOUDFLARE_SECRETS.md#admin-authentication',
    secrets: {
      stage1: [],
      stage2: [
        {
          name: 'ADMIN_KEY_ROOT',
          env: 'ADMIN_KEY_ROOT',
          description: 'Root brand admin key for API authentication',
          required: true,
          rotationPolicy: '90 days',
        },
        {
          name: 'ADMIN_KEY_ABC',
          env: 'ADMIN_KEY_ABC',
          description: 'ABC brand admin key',
          required: false,
        },
        {
          name: 'ADMIN_KEY_CBC',
          env: 'ADMIN_KEY_CBC',
          description: 'CBC brand admin key',
          required: false,
        },
        {
          name: 'ADMIN_KEY_CBL',
          env: 'ADMIN_KEY_CBL',
          description: 'CBL brand admin key',
          required: false,
        },
      ],
    },
  },

  notifications: {
    name: 'Notifications',
    description: 'CI/CD notification webhooks',
    docLink: 'N/A',
    secrets: {
      stage1: [
        {
          name: 'SLACK_WEBHOOK_URL',
          env: 'SLACK_WEBHOOK_URL',
          description: 'Slack webhook for CI notifications',
          required: false,
        },
        {
          name: 'TEAMS_WEBHOOK_URL',
          env: 'TEAMS_WEBHOOK_URL',
          description: 'Microsoft Teams webhook for CI notifications',
          required: false,
        },
      ],
      stage2: [
        {
          name: 'SLACK_WEBHOOK_URL',
          env: 'SLACK_WEBHOOK_URL',
          description: 'Slack webhook for test notifications',
          required: false,
        },
        {
          name: 'TEAMS_WEBHOOK_URL',
          env: 'TEAMS_WEBHOOK_URL',
          description: 'Microsoft Teams webhook for test notifications',
          required: false,
        },
      ],
    },
  },

  testing: {
    name: 'Testing Configuration',
    description: 'Playwright and test environment variables',
    docLink: 'docs/TESTING.md',
    secrets: {
      stage1: [],
      stage2: [
        {
          name: 'CF_ACCESS_CLIENT_ID',
          env: 'CF_ACCESS_CLIENT_ID',
          description: 'Cloudflare Access client ID for analytics tests',
          required: false,
        },
        {
          name: 'CF_ACCESS_CLIENT_SECRET',
          env: 'CF_ACCESS_CLIENT_SECRET',
          description: 'Cloudflare Access client secret for analytics tests',
          required: false,
        },
      ],
    },
  },
};

// Verification results
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  groups: [],
};

function log(msg) {
  if (!MODE.quiet && !MODE.json) {
    console.log(msg);
  }
}

function printHeader(title) {
  log('');
  log(colors.bright + colors.cyan + '='.repeat(70) + colors.reset);
  log(colors.bright + colors.cyan + `  ${title}` + colors.reset);
  log(colors.bright + colors.cyan + '='.repeat(70) + colors.reset);
  log('');
}

function printGroupHeader(groupName, description, docLink) {
  log('');
  log(colors.bright + colors.blue + `----- ${groupName} -----` + colors.reset);
  log(colors.dim + `  ${description}` + colors.reset);
  if (docLink && docLink !== 'N/A') {
    log(colors.dim + `  See: ${docLink}` + colors.reset);
  }
  log('');
}

function printCheck(passed, message, details = '', required = true) {
  const icon = passed ? '\u2705' : required ? '\u274C' : '\u26AA';
  const color = passed ? colors.green : required ? colors.red : colors.dim;

  log(`${color}${icon} ${message}${colors.reset}`);

  if (details) {
    log(`   ${colors.yellow}${details}${colors.reset}`);
  }

  if (passed) {
    results.passed++;
  } else if (required) {
    results.failed++;
  } else {
    results.warnings++;
  }
}

function printActionableError(secretName, description, docLink) {
  log('');
  log(colors.red + colors.bright + `ERROR: Missing required secret '${secretName}'` + colors.reset);
  log(colors.yellow + `  Purpose: ${description}` + colors.reset);
  log(colors.yellow + `  Action: Add this secret at:` + colors.reset);
  log(
    colors.cyan +
      `    https://github.com/OurCommunityRituals/ourSharedEvents/settings/secrets/actions` +
      colors.reset
  );
  if (docLink && docLink !== 'N/A') {
    log(colors.yellow + `  Documentation: ${docLink}` + colors.reset);
  }
  log('');
}

function checkEnvVar(name) {
  const value = process.env[name];
  return !!(value && value.length > 0 && value !== 'undefined');
}

function checkSecret(secret) {
  const exists = checkEnvVar(secret.env);
  return {
    name: secret.name,
    env: secret.env,
    description: secret.description,
    required: secret.required,
    rotationPolicy: secret.rotationPolicy,
    environment: secret.environment,
    exists,
    preview: exists ? `${process.env[secret.env].substring(0, 10)}...` : null,
  };
}

function validateStage(stage) {
  const stageResults = {
    stage,
    groups: [],
    required: { total: 0, missing: [], found: [] },
    optional: { total: 0, missing: [], found: [] },
  };

  for (const [_groupKey, group] of Object.entries(SECRET_GROUPS)) {
    const secrets = group.secrets[stage];
    if (!secrets || secrets.length === 0) continue;

    const groupResult = {
      name: group.name,
      description: group.description,
      docLink: group.docLink,
      secrets: [],
    };

    printGroupHeader(group.name, group.description, group.docLink);

    for (const secret of secrets) {
      const check = checkSecret(secret);
      groupResult.secrets.push(check);

      if (secret.required) {
        stageResults.required.total++;
        if (check.exists) {
          printCheck(true, `${check.name} is set`);
          stageResults.required.found.push(check);
        } else {
          printCheck(false, `${check.name} is not set`, check.description, true);
          printActionableError(check.name, check.description, group.docLink);
          stageResults.required.missing.push(check);
        }
      } else {
        stageResults.optional.total++;
        if (check.exists) {
          printCheck(true, `${check.name} is set`, '', false);
          stageResults.optional.found.push(check);
        } else {
          printCheck(false, `${check.name} is not set (optional)`, '', false);
          stageResults.optional.missing.push(check);
        }
      }
    }

    stageResults.groups.push(groupResult);
  }

  return stageResults;
}

function printSummary(allResults) {
  log('');
  log(colors.bright + '-'.repeat(70) + colors.reset);

  const totalRequired = allResults.reduce((sum, r) => sum + r.required.total, 0);
  const totalMissing = allResults.reduce((sum, r) => sum + r.required.missing.length, 0);
  const totalOptional = allResults.reduce((sum, r) => sum + r.optional.total, 0);
  const optionalMissing = allResults.reduce((sum, r) => sum + r.optional.missing.length, 0);

  log(
    `${colors.bright}Required:${colors.reset} ${colors.green}${totalRequired - totalMissing}${colors.reset}/${totalRequired} configured`
  );
  log(
    `${colors.bright}Optional:${colors.reset} ${totalOptional - optionalMissing}/${totalOptional} configured`
  );
  log('');

  if (totalMissing > 0) {
    log(
      colors.red +
        colors.bright +
        '\u274C VALIDATION FAILED - Required secrets missing' +
        colors.reset
    );
    log('');
    log('Missing required secrets:');
    for (const result of allResults) {
      for (const missing of result.required.missing) {
        log(colors.red + `  - ${missing.name}` + colors.reset);
      }
    }
    log('');
    log('To fix, add missing secrets at:');
    log(
      colors.cyan +
        'https://github.com/OurCommunityRituals/ourSharedEvents/settings/secrets/actions' +
        colors.reset
    );
    log('');
    log('For documentation, see:');
    log(colors.cyan + 'docs/CLOUDFLARE_SECRETS.md' + colors.reset);
  } else {
    log(
      colors.green +
        colors.bright +
        '\u2705 VALIDATION PASSED - All required secrets configured' +
        colors.reset
    );
    if (optionalMissing > 0) {
      log('');
      log(
        colors.yellow +
          `Note: ${optionalMissing} optional secrets are not configured.` +
          colors.reset
      );
      log(
        colors.dim +
          'These are not required but may enable additional functionality.' +
          colors.reset
      );
    }
  }

  log('');
  log(colors.bright + '-'.repeat(70) + colors.reset);

  return totalMissing === 0;
}

function checkProjectFiles() {
  printGroupHeader('Project Files', 'Required configuration files', 'N/A');

  const checks = [
    {
      path: '.github/workflows/oursharedevents-ci.yml',
      name: 'CI/CD workflow',
      required: true,
    },
    {
      path: 'docs/CLOUDFLARE_SECRETS.md',
      name: 'Secrets documentation',
      required: false,
    },
  ];

  for (const check of checks) {
    const fullPath = path.join(process.cwd(), check.path);
    const exists = fs.existsSync(fullPath);

    if (exists) {
      printCheck(true, `${check.name} (${check.path})`);
      results.passed++;
    } else if (check.required) {
      printCheck(false, `${check.name} not found`, `Expected at: ${check.path}`, true);
      results.failed++;
    } else {
      printCheck(false, `${check.name} not found (optional)`, '', false);
      results.warnings++;
    }
  }
}

async function main() {
  if (!MODE.json) {
    log('');
    log(colors.bright + colors.blue + '\u2554' + '\u2550'.repeat(68) + '\u2557' + colors.reset);
    log(colors.bright + colors.blue + '\u2551' + ' '.repeat(68) + '\u2551' + colors.reset);
    log(
      colors.bright +
        colors.blue +
        '\u2551' +
        '     Secrets & Environment Variables Verification (Story 2)       ' +
        '\u2551' +
        colors.reset
    );
    log(colors.bright + colors.blue + '\u2551' + ' '.repeat(68) + '\u2551' + colors.reset);
    log(colors.bright + colors.blue + '\u255A' + '\u2550'.repeat(68) + '\u255D' + colors.reset);
  }

  const allResults = [];

  if (MODE.all || MODE.stage1) {
    printHeader('Stage 1 Secrets (Deployment)');
    const stage1Results = validateStage('stage1');
    allResults.push(stage1Results);
  }

  if (MODE.all || MODE.stage2) {
    printHeader('Stage 2 Secrets (Testing)');
    const stage2Results = validateStage('stage2');
    allResults.push(stage2Results);
  }

  if (MODE.all) {
    printHeader('Project Files');
    checkProjectFiles();
  }

  printHeader('Summary');
  const success = printSummary(allResults);

  if (MODE.json) {
    const totalRequired = allResults.reduce((sum, r) => sum + r.required.total, 0);
    const totalMissing = allResults.reduce((sum, r) => sum + r.required.missing.length, 0);
    const totalOptional = allResults.reduce((sum, r) => sum + r.optional.total, 0);
    const optionalMissing = allResults.reduce((sum, r) => sum + r.optional.missing.length, 0);

    console.log(
      JSON.stringify(
        {
          success,
          results: allResults,
          summary: {
            required: { total: totalRequired, missing: totalMissing },
            optional: { total: totalOptional, missing: optionalMissing },
          },
          secretGroups: Object.keys(SECRET_GROUPS),
        },
        null,
        2
      )
    );
  }

  process.exit(success ? 0 : 1);
}

module.exports = {
  main,
  SECRET_GROUPS,
  checkEnvVar,
  checkSecret,
  validateStage,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(colors.red + '\u274C Fatal error:' + colors.reset, error);
    process.exit(1);
  });
}
