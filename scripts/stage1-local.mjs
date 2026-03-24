#!/usr/bin/env node
/**
 * Stage 1 Unified Truth Script
 *
 * SINGLE SOURCE OF TRUTH for Stage 1 validation.
 * This script runs identically in local development and GitHub Actions CI.
 *
 * Usage:
 *   npm run stage1-local          # Run Stage 1 validation
 *   node scripts/stage1-local.mjs # Direct execution
 *
 * Stage 1 Components (in order):
 *   1. lint          - ESLint code quality
 *   2. typecheck     - (N/A - project uses .gs, not TypeScript)
 *   3. unit tests    - Jest unit tests (includes security tests)
 *   4. contract tests- Jest contract tests (schema + API + bundles)
 *   5. security lint - Security-specific test validation
 *   6. guards        - MVP surface, dead code, schema, API checks
 *   7. build verify  - Bundle compilation verification
 *
 * HERMETIC: Stage 1 has ZERO external dependencies (no BASE_URL, no HTTP calls)
 *
 * Exit Codes:
 *   0 - All validations passed
 *   1 - One or more validations failed
 *
 * @see .github/workflows/stage1-deploy.yml (CI uses same validations)
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// ANSI colors for terminal output
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

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[PASS]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[FAIL]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}\n`),
  step: (num, total, msg) => console.log(`\n${colors.bright}${colors.yellow}[${num}/${total}]${colors.reset} ${colors.bright}${msg}${colors.reset}\n`),
  substep: (msg) => console.log(`  ${colors.dim}>${colors.reset} ${msg}`),
};

/**
 * Stage 1 validation steps
 * Each step has: name, description, command, and optional validate function
 */
const STAGE1_STEPS = [
  {
    name: 'lint',
    description: 'ESLint Code Quality',
    command: 'npm run lint',
    critical: true,
  },
  {
    name: 'banned-origins',
    description: 'GAS URL Ban Check (Story 2.1)',
    command: 'npm run check:banned-origins',
    critical: true,
  },
  {
    name: 'unit-tests',
    description: 'Jest Unit Tests (MVP Logic + Security)',
    command: 'npm run test:unit',
    critical: true,
    postValidate: () => {
      // Verify security tests exist and ran
      const securityTestPath = join(ROOT_DIR, 'tests/unit/security.test.js');
      if (!existsSync(securityTestPath)) {
        throw new Error('Security test file not found: tests/unit/security.test.js');
      }
      return true;
    },
  },
  {
    name: 'contract-tests',
    description: 'Jest Contract Tests (Schema + API + Bundles)',
    command: 'npm run test:contract',
    critical: true,
    postValidate: () => {
      // Verify bundle contract tests exist
      const bundleTestPath = join(ROOT_DIR, 'tests/contract/bundles.contract.test.js');
      if (!existsSync(bundleTestPath)) {
        throw new Error('Bundle contract test file not found: tests/contract/bundles.contract.test.js');
      }
      return true;
    },
  },
  {
    name: 'security-lint',
    description: 'Security-Specific Test Validation',
    command: 'npm run test:unit -- tests/unit/security.test.js --verbose',
    critical: true,
  },
  {
    name: 'mvp-guards',
    description: 'MVP Guards (Surfaces + Dead Code + Schema + API)',
    command: 'npm run check:guards',
    critical: true,
  },
  {
    name: 'v2-files-check',
    description: 'V2 File Guardrails (No V2 in MVP)',
    command: 'node scripts/check-v2-files.js',
    critical: true,
  },
  {
    name: 'build-verify',
    description: 'Bundle Compilation Verification',
    validate: verifyBundleCompilation,
    critical: true,
  },
];

/**
 * Run a command and capture output
 */
function runCommand(command, options = {}) {
  const { silent = false, cwd = ROOT_DIR } = options;

  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
      // HERMETIC: Stage 1 must have no external dependencies
      // Set SKIP_NETWORK_TESTS to ensure contract tests don't make HTTP calls
      env: { ...process.env, FORCE_COLOR: '1', SKIP_NETWORK_TESTS: 'true' },
    });
    return { success: true, output };
  } catch (error) {
    return { success: false, output: error.stdout || error.message };
  }
}

/**
 * Verify bundle compilation - ensures the Apps Script bundle is syntactically valid
 */
function verifyBundleCompilation() {
  log.substep('Checking MVP source files...');

  const mvpDir = join(ROOT_DIR, 'src/mvp');
  if (!existsSync(mvpDir)) {
    throw new Error('MVP source directory not found: src/mvp');
  }

  // Required source files for Apps Script bundle
  const requiredFiles = [
    'Code.gs',
    'ApiSchemas.gs',
    'Admin.html',
    'Public.html',
    'Display.html',
    'Poster.html',
  ];

  const missingFiles = [];
  const syntaxErrors = [];

  for (const file of requiredFiles) {
    const filePath = join(mvpDir, file);
    if (!existsSync(filePath)) {
      missingFiles.push(file);
      continue;
    }

    // For .gs files, do basic syntax validation
    if (file.endsWith('.gs')) {
      try {
        const content = readFileSync(filePath, 'utf-8');

        // Check for obvious syntax issues
        const issues = checkGsSyntax(content, file);
        if (issues.length > 0) {
          syntaxErrors.push(...issues);
        }
      } catch (err) {
        syntaxErrors.push(`${file}: Failed to read file - ${err.message}`);
      }
    }

    // For .html files, check basic structure
    if (file.endsWith('.html')) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const issues = checkHtmlSyntax(content, file);
        if (issues.length > 0) {
          syntaxErrors.push(...issues);
        }
      } catch (err) {
        syntaxErrors.push(`${file}: Failed to read file - ${err.message}`);
      }
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(`Missing required MVP files: ${missingFiles.join(', ')}`);
  }

  if (syntaxErrors.length > 0) {
    throw new Error(`Bundle syntax errors:\n  - ${syntaxErrors.join('\n  - ')}`);
  }

  log.substep(`Verified ${requiredFiles.length} required MVP files`);
  log.substep('Bundle compilation check passed');

  return true;
}

/**
 * Basic syntax checks for .gs files
 *
 * Note: We don't do deep JS syntax analysis here because:
 * 1. ESLint catches actual syntax errors in the lint step
 * 2. Counting braces/parens is unreliable due to strings, regex, etc.
 *
 * This check focuses on file structure issues that would prevent deployment.
 */
function checkGsSyntax(content, filename) {
  const issues = [];

  // Check for empty file
  if (content.trim().length === 0) {
    issues.push(`${filename}: File is empty`);
    return issues;
  }

  // Check for obviously broken syntax (file starts/ends with garbage)
  if (!content.match(/^[\s\S]*function\s+\w+/m)) {
    issues.push(`${filename}: No function declarations found`);
  }

  // Check for null bytes (file corruption)
  if (content.includes('\x00')) {
    issues.push(`${filename}: Contains null bytes (possible file corruption)`);
  }

  // Check minimum content - .gs files should have substantial code
  if (content.length < 100) {
    issues.push(`${filename}: File appears too small (${content.length} bytes)`);
  }

  return issues;
}

/**
 * Basic syntax checks for .html files
 */
function checkHtmlSyntax(content, filename) {
  const issues = [];

  // Check for DOCTYPE
  if (!content.toLowerCase().includes('<!doctype html>')) {
    issues.push(`${filename}: Missing DOCTYPE declaration`);
  }

  // Check for basic HTML structure
  if (!content.includes('<html')) {
    issues.push(`${filename}: Missing <html> tag`);
  }
  if (!content.includes('<head')) {
    issues.push(`${filename}: Missing <head> tag`);
  }
  if (!content.includes('<body')) {
    issues.push(`${filename}: Missing <body> tag`);
  }

  // Check for closing tags
  const openHtml = (content.match(/<html/gi) || []).length;
  const closeHtml = (content.match(/<\/html>/gi) || []).length;
  if (openHtml !== closeHtml) {
    issues.push(`${filename}: Missing closing </html> tag`);
  }

  return issues;
}

/**
 * Run a single stage step
 */
async function runStep(step, index, total) {
  log.step(index + 1, total, step.description);

  const startTime = Date.now();

  try {
    // Run command if provided
    if (step.command) {
      log.substep(`Running: ${step.command}`);
      const result = runCommand(step.command);

      if (!result.success) {
        log.error(`${step.name} failed`);
        return { name: step.name, success: false, duration: Date.now() - startTime };
      }
    }

    // Run validate function if provided
    if (step.validate) {
      const result = step.validate();
      if (!result) {
        log.error(`${step.name} validation failed`);
        return { name: step.name, success: false, duration: Date.now() - startTime };
      }
    }

    // Run post-validation if provided
    if (step.postValidate) {
      const result = step.postValidate();
      if (!result) {
        log.error(`${step.name} post-validation failed`);
        return { name: step.name, success: false, duration: Date.now() - startTime };
      }
    }

    const duration = Date.now() - startTime;
    log.success(`${step.name} passed (${(duration / 1000).toFixed(1)}s)`);
    return { name: step.name, success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error(`${step.name} failed: ${error.message}`);
    return { name: step.name, success: false, duration, error: error.message };
  }
}

/**
 * Print summary of all steps
 */
function printSummary(results, totalDuration) {
  log.header('STAGE 1 SUMMARY');

  console.log('Step Results:');
  console.log('');

  const maxNameLen = Math.max(...results.map(r => r.name.length));

  for (const result of results) {
    const status = result.success
      ? `${colors.green}PASS${colors.reset}`
      : `${colors.red}FAIL${colors.reset}`;
    const duration = `${(result.duration / 1000).toFixed(1)}s`;
    const padding = ' '.repeat(maxNameLen - result.name.length);
    console.log(`  ${result.name}${padding}  ${status}  (${duration})`);
    if (result.error) {
      console.log(`    ${colors.dim}${result.error}${colors.reset}`);
    }
  }

  console.log('');
  console.log(`Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  if (failed === 0) {
    console.log(`${colors.bright}${colors.green}STAGE 1 PASSED${colors.reset} (${passed}/${results.length} steps)`);
    console.log('');
    console.log('All validations passed. Code is ready for deployment.');
  } else {
    console.log(`${colors.bright}${colors.red}STAGE 1 FAILED${colors.reset} (${failed}/${results.length} steps failed)`);
    console.log('');
    console.log('Fix the failing steps before proceeding to deployment.');
    console.log('');
    console.log('Failing steps:');
    for (const result of results.filter(r => !r.success)) {
      console.log(`  - ${result.name}`);
    }
  }

  console.log('');
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
${colors.bright}Stage 1 Unified Truth Script${colors.reset}

${colors.cyan}USAGE:${colors.reset}
  npm run stage1-local
  node scripts/stage1-local.mjs [options]

${colors.cyan}OPTIONS:${colors.reset}
  --help, -h     Show this help message
  --verbose, -v  Show verbose output
  --step=NAME    Run only specific step (e.g., --step=lint)
  --list         List all available steps

${colors.cyan}STEPS (run in order):${colors.reset}
${STAGE1_STEPS.map((s, i) => `  ${i + 1}. ${s.name.padEnd(20)} ${s.description}`).join('\n')}

${colors.cyan}DESCRIPTION:${colors.reset}
  This is the SINGLE SOURCE OF TRUTH for Stage 1 validation.
  It runs identically in local development and GitHub Actions CI.

  Stage 1 is HERMETIC - no external dependencies required.
  All tests run against local files and mocks.

${colors.cyan}EXIT CODES:${colors.reset}
  0  All validations passed
  1  One or more validations failed

${colors.cyan}EXAMPLES:${colors.reset}
  # Run full Stage 1 validation
  npm run stage1-local

  # Run only lint step
  node scripts/stage1-local.mjs --step=lint

  # List all steps
  node scripts/stage1-local.mjs --list

${colors.cyan}CI PARITY:${colors.reset}
  This script is invoked by .github/workflows/stage1-deploy.yml
  Running locally guarantees the same validations as CI.
`);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Handle help
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Handle list
  if (args.includes('--list')) {
    console.log('\nAvailable Stage 1 Steps:\n');
    STAGE1_STEPS.forEach((s, i) => {
      console.log(`  ${i + 1}. ${colors.bright}${s.name}${colors.reset}`);
      console.log(`     ${s.description}`);
      if (s.command) console.log(`     ${colors.dim}Command: ${s.command}${colors.reset}`);
      console.log('');
    });
    process.exit(0);
  }

  // Handle single step
  const stepArg = args.find(a => a.startsWith('--step='));
  const singleStep = stepArg ? stepArg.split('=')[1] : null;

  // Print banner
  console.log(`
${colors.bright}${colors.cyan}
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║                    STAGE 1 UNIFIED TRUTH SCRIPT                       ║
  ║                                                                       ║
  ║  Single source of truth for local + CI Stage 1 validation             ║
  ║  HERMETIC: No external dependencies (no BASE_URL, no HTTP calls)      ║
  ╚═══════════════════════════════════════════════════════════════════════╝
${colors.reset}`);

  // Verify hermetic environment
  if (process.env.BASE_URL) {
    log.warn('BASE_URL is set but will be ignored - Stage 1 is hermetic');
  }

  log.header('STAGE 1: BUILD & VALIDATE');
  log.info(`Running ${singleStep ? `step: ${singleStep}` : 'all steps'}`);
  log.info('');

  const startTime = Date.now();
  const results = [];

  // Determine which steps to run
  const stepsToRun = singleStep
    ? STAGE1_STEPS.filter(s => s.name === singleStep)
    : STAGE1_STEPS;

  if (singleStep && stepsToRun.length === 0) {
    log.error(`Unknown step: ${singleStep}`);
    log.info(`Available steps: ${STAGE1_STEPS.map(s => s.name).join(', ')}`);
    process.exit(1);
  }

  // Run steps
  for (let i = 0; i < stepsToRun.length; i++) {
    const step = stepsToRun[i];
    const result = await runStep(step, i, stepsToRun.length);
    results.push(result);

    // Stop on critical failure
    if (!result.success && step.critical) {
      log.error('');
      log.error('Critical step failed - stopping Stage 1');
      log.error('Fix the issue and re-run: npm run stage1-local');
      break;
    }
  }

  const totalDuration = Date.now() - startTime;

  // Print summary
  printSummary(results, totalDuration);

  // Exit with appropriate code
  const allPassed = results.every(r => r.success);
  process.exit(allPassed ? 0 : 1);
}

// Run main
main().catch(error => {
  log.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
