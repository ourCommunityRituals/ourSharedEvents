#!/usr/bin/env node
/**
 * Local CI Runner - Mirrors GitHub Actions CI pipeline
 *
 * Usage:
 *   node scripts/run-ci-local.js           # Full CI (Stage 1 + Stage 2)
 *   node scripts/run-ci-local.js stage1    # Stage 1 only (npm run test:ci:stage1)
 *   node scripts/run-ci-local.js stage2    # Stage 2 only (API + smoke + flows + pages)
 *   node scripts/run-ci-local.js quick     # Quick CI (critical tests only)
 *   node scripts/run-ci-local.js --help    # Show help
 *
 * STAGE 1 CONTRACT:
 *   - Canonical command: npm run test:ci:stage1
 *   - Runs: lint + unit + contract + guards (env-agnostic)
 *   - This is the single source of truth for Stage 1
 *
 * This script implements the same progressive gating as the CI:
 * - Stage 1 must pass before Stage 2 runs
 * - API tests must pass before smoke tests
 * - Smoke tests must pass before expensive tests (flows + pages)
 */

const { execSync } = require('child_process');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
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
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(60)}${colors.reset}\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n${colors.bright}${colors.cyan}${'='.repeat(60)}${colors.reset}\n`),
  stage: (msg) => console.log(`\n${colors.bright}${colors.yellow}>>> ${msg}${colors.reset}\n`),
};

/**
 * Run a command and return success/failure
 */
function runCommand(name, command) {
  log.stage(`Running: ${name}`);
  console.log(`$ ${command}\n`);

  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    log.success(`${name} passed`);
    return true;
  } catch (error) {
    log.error(`${name} failed`);
    return false;
  }
}

/**
 * Stage 1: Build & Validate (mirrors stage1-deploy.yml)
 *
 * UNIFIED TRUTH SCRIPT: npm run stage1-local (scripts/stage1-local.mjs)
 * This is the single source of truth for Stage 1 validation.
 * Same script runs locally and in CI - zero drift.
 *
 * Components:
 *   - lint            → ESLint code quality
 *   - unit tests      → Jest unit tests (mocked, no network)
 *   - contract tests  → Contract tests (schema, API, bundles - all local)
 *   - security lint   → Security-specific test validation
 *   - mvp guards      → Surface, dead-code, schema-fields, API-schema checks
 *   - v2 files check  → Prevents V2 files in MVP directory
 *   - build verify    → Bundle compilation verification
 */
async function runStage1() {
  log.header('STAGE 1: Build & Validate');
  log.info('Unified truth script: npm run stage1-local');
  log.info('Same script runs locally and in CI - zero drift');
  log.info('Mirrors: .github/workflows/stage1-deploy.yml');

  // Single source of truth: npm run stage1-local
  const success = runCommand('Stage 1 Unified Validation', 'npm run stage1-local');

  if (!success) {
    log.error('Stage 1 BLOCKED: Fix failures before proceeding');
    log.info('Run "npm run stage1-local" to see detailed output');
  }

  return { success, results: { stage1: success } };
}

/**
 * Stage 2: E2E Testing (mirrors stage2-testing.yml)
 */
async function runStage2(skipGates = false) {
  log.header('STAGE 2: E2E Testing (Progressive)');
  log.info('This stage runs: API Tests -> Smoke Tests -> Flows -> Pages');
  log.info('Mirrors: .github/workflows/stage2-testing.yml');
  log.info('Progressive gating: Each stage must pass to proceed');

  const results = {
    apiTests: false,
    smokeTests: false,
    flowTests: false,
    pageTests: false,
  };

  // Check if BASE_URL is set
  if (!process.env.BASE_URL && !process.env.GOOGLE_SCRIPT_URL) {
    log.warn('BASE_URL not set - using default Apps Script URL');
    log.info('Set BASE_URL to test against a specific deployment');
  }

  // Gate 0: API Tests (always run first)
  results.apiTests = runCommand('API Tests (Critical)', 'npm run test:api');
  if (!results.apiTests && !skipGates) {
    log.error('Stage 2 Gate 1 BLOCKED: API tests failed');
    log.info('Fix API issues before running smoke tests');
    return { success: false, results, stoppedAt: 'api' };
  }

  // Gate 1: Smoke Tests
  results.smokeTests = runCommand('Smoke Tests (Critical)', 'npm run test:smoke');
  if (!results.smokeTests && !skipGates) {
    log.error('Stage 2 Gate 2 BLOCKED: Smoke tests failed');
    log.info('Fix smoke test issues before running expensive tests');
    return { success: false, results, stoppedAt: 'smoke' };
  }

  // Expensive tests (only if previous gates passed)
  log.stage('Running Expensive Tests (Flow + Page)');

  results.flowTests = runCommand('Flow Tests (Expensive)', 'npm run test:flows');
  results.pageTests = runCommand('Page Tests (Expensive)', 'npm run test:pages');

  const expensivePassed = results.flowTests && results.pageTests;
  if (!expensivePassed) {
    log.warn('Some expensive tests failed - review test reports');
  }

  return {
    success: results.apiTests && results.smokeTests && expensivePassed,
    results
  };
}

/**
 * Quick CI - Critical tests only
 */
async function runQuickCI() {
  log.header('QUICK CI: Critical Tests Only');
  log.info('Runs: Lint -> Unit -> Contract -> API -> Smoke');
  log.info('Use this before committing for fast feedback');

  const results = {
    lint: false,
    unitTests: false,
    contractTests: false,
    apiTests: false,
    smokeTests: false,
  };

  // Stage 1 critical
  results.lint = runCommand('ESLint', 'npm run lint');
  if (!results.lint) return { success: false, results };

  results.unitTests = runCommand('Unit Tests', 'npm run test:unit');
  if (!results.unitTests) return { success: false, results };

  results.contractTests = runCommand('Contract Tests', 'npm run test:contract');
  if (!results.contractTests) return { success: false, results };

  // Stage 2 critical
  results.apiTests = runCommand('API Tests', 'npm run test:api');
  if (!results.apiTests) return { success: false, results };

  results.smokeTests = runCommand('Smoke Tests', 'npm run test:smoke');

  return { success: results.smokeTests, results };
}

/**
 * Print summary
 */
function printSummary(stage1Results, stage2Results) {
  log.header('CI SUMMARY');

  console.log('Stage 1 (Build & Validate):');
  if (stage1Results) {
    console.log(`  npm run test:ci:stage1: ${stage1Results.success ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);
    console.log(`  (lint + unit + contract + guards)`);
  } else {
    console.log('  (skipped)');
  }

  console.log('\nStage 2 (E2E Testing):');
  if (stage2Results) {
    console.log(`  API Tests:         ${stage2Results.results.apiTests ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);
    console.log(`  Smoke Tests:       ${stage2Results.results.smokeTests ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);
    console.log(`  Flow Tests:        ${stage2Results.results.flowTests ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);
    console.log(`  Page Tests:        ${stage2Results.results.pageTests ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);
    console.log(`  Overall:           ${stage2Results.success ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);
    if (stage2Results.stoppedAt) {
      console.log(`  ${colors.yellow}(stopped at ${stage2Results.stoppedAt} due to gate failure)${colors.reset}`);
    }
  } else {
    console.log('  (skipped - Stage 1 failed)');
  }

  const overallSuccess = (stage1Results?.success ?? true) && (stage2Results?.success ?? true);
  console.log(`\n${colors.bright}OVERALL: ${overallSuccess ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);

  return overallSuccess;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
${colors.bright}Local CI Runner - Mirrors GitHub Actions CI Pipeline${colors.reset}

${colors.cyan}USAGE:${colors.reset}
  node scripts/run-ci-local.js [command]
  npm run ci:local [command]

${colors.cyan}COMMANDS:${colors.reset}
  (none)    Run full CI (Stage 1 + Stage 2)
  stage1    Run Stage 1 only (calls npm run test:ci:stage1)
  stage2    Run Stage 2 only (API, smoke, flow, page tests)
  quick     Run quick CI (critical tests only - fast feedback)
  --help    Show this help

${colors.cyan}STAGE 1 UNIFIED TRUTH SCRIPT (env-agnostic):${colors.reset}
  Single source of truth: npm run stage1-local
  Script location: scripts/stage1-local.mjs

  Components (run in order):
    - lint            → ESLint code quality
    - unit tests      → Jest unit tests (mocked, no network)
    - contract tests  → Contract tests (schema, API, bundles)
    - security lint   → Security-specific test validation
    - mvp guards      → Surface, dead-code, schema-fields, API checks
    - v2 files check  → Prevents V2 files in MVP directory
    - build verify    → Bundle compilation verification

  This is the canonical definition. The CI workflow and this script
  both invoke the same unified script for 100% parity.

${colors.cyan}EXAMPLES:${colors.reset}
  # Full CI before creating a PR
  npm run ci:local

  # Quick check before committing
  npm run ci:local quick

  # Just validate Stage 1 (no deployment needed, no env required)
  npm run ci:local stage1
  npm run test:ci:stage1     # equivalent - the canonical command

  # Run Stage 2 against a specific URL
  BASE_URL=https://your-deployment.com npm run ci:local stage2

${colors.cyan}ENVIRONMENT VARIABLES:${colors.reset}
  BASE_URL            Deployment URL for E2E tests (Stage 2 only)
  GOOGLE_SCRIPT_URL   Alternative to BASE_URL (Stage 2 only)

${colors.cyan}CI PARITY:${colors.reset}
  This script mirrors the exact behavior of the GitHub Actions workflows:
  - stage1-deploy.yml   -> npm run test:ci:stage1 (env-agnostic)
  - stage2-testing.yml  -> npm run ci:local stage2 (requires BASE_URL)
`);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'full';

  if (command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  console.log(`
${colors.bright}${colors.cyan}
  ╔═══════════════════════════════════════════════════════════╗
  ║           LOCAL CI RUNNER - MVP Event Toolkit             ║
  ║                                                           ║
  ║  Mirrors GitHub Actions for local development parity      ║
  ╚═══════════════════════════════════════════════════════════╝
${colors.reset}`);

  let stage1Results = null;
  let stage2Results = null;
  let success = false;

  switch (command) {
    case 'stage1':
      stage1Results = await runStage1();
      success = stage1Results.success;
      printSummary(stage1Results, null);
      break;

    case 'stage2':
      stage2Results = await runStage2();
      success = stage2Results.success;
      printSummary(null, stage2Results);
      break;

    case 'quick': {
      const quickResults = await runQuickCI();
      console.log(`\n${colors.bright}QUICK CI: ${quickResults.success ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);
      success = quickResults.success;
      break;
    }

    case 'full':
    default:
      stage1Results = await runStage1();
      if (stage1Results.success) {
        stage2Results = await runStage2();
      }
      success = printSummary(stage1Results, stage2Results);
      break;
  }

  process.exit(success ? 0 : 1);
}

main().catch(error => {
  log.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
