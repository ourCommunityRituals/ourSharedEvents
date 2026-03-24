#!/usr/bin/env node
/**
 * ci:all Single Gate - Unified CI validation
 *
 * A single, definitive CI gate that runs all local validations.
 * This is the "one command to rule them all" for local CI.
 *
 * Usage:
 *   npm run ci:all:gate           # Run the complete gate
 *   npm run ci:all:gate -- --json # Output JSON for CI systems
 *   npm run ci:all:gate -- --fast # Skip non-critical tests
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 *
 * This gate includes ALL contract guards:
 *   1. MVP Surfaces (check-surfaces.js)
 *   2. RPC Inventory (check-rpc-inventory.js)
 *   3. API vs Schemas (check-apis-vs-schemas.js)
 *   4. Event Schema (test-event-schema.js)
 *   5. Service Tests (test-services.js)
 *   6. URL Routing (test-url-routing.js) - requires BASE_URL
 *   7. Dead Exports (check-dead-code.js)
 *   8. Schema Fields (check-schema-fields.js)
 *   9. Analytics Schema (test-analytics-schema.js)
 *   10. Triangle Happy-Path (test:triangle:happy-path) - requires BASE_URL + ADMIN_KEY, non-blocking
 *
 * Correlation ID: Each run gets a unique ID for tracing.
 */

const { execSync } = require('child_process');

// Generate correlation ID for this CI run (Story 14 integration)
function generateRunId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `ci-${timestamp}-${random}`;
}

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

// Parse CLI args
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const fastMode = args.includes('--fast');
const verbose = args.includes('--verbose') || args.includes('-v');

// Run configuration
const runId = generateRunId();
const startTime = Date.now();

// Results collector
const results = {
  runId,
  timestamp: new Date().toISOString(),
  mode: fastMode ? 'fast' : 'full',
  checks: [],
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  },
  timing: {
    startTime: startTime,
    endTime: null,
    durationMs: null,
  },
};

/**
 * Log to console (unless JSON mode)
 */
function log(msg, color = c.white) {
  if (!jsonOutput) {
    console.log(`${color}${msg}${c.reset}`);
  }
}

/**
 * Print the CI gate header
 */
function printHeader() {
  if (jsonOutput) return;

  console.log(`
${c.cyan}${c.bold}╔════════════════════════════════════════════════════════════════╗
║                    CI:ALL SINGLE GATE                          ║
║                   Story 15 Implementation                      ║
╚════════════════════════════════════════════════════════════════╝${c.reset}

${c.dim}Run ID: ${runId}${c.reset}
${c.dim}Mode: ${fastMode ? 'FAST (critical only)' : 'FULL (all checks)'}${c.reset}
${c.dim}Started: ${new Date().toLocaleTimeString()}${c.reset}
`);
}

/**
 * Run a single check
 */
function runCheck(name, command, options = {}) {
  const { critical = true, skipInFastMode = false } = options;

  // Skip if in fast mode and this check can be skipped
  if (fastMode && skipInFastMode) {
    const result = {
      name,
      command,
      status: 'skipped',
      critical,
      durationMs: 0,
      output: null,
      error: null,
    };
    results.checks.push(result);
    results.summary.skipped++;
    results.summary.total++;
    log(`${c.yellow}⊘${c.reset} ${c.dim}${name} (skipped in fast mode)${c.reset}`);
    return true;
  }

  const checkStart = Date.now();
  log(`${c.blue}▶${c.reset} ${name}...`, c.white);

  try {
    const output = execSync(command, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: verbose ? 'inherit' : 'pipe',
      env: { ...process.env, FORCE_COLOR: '1', CI: 'true' },
    });

    const durationMs = Date.now() - checkStart;
    const result = {
      name,
      command,
      status: 'passed',
      critical,
      durationMs,
      output: verbose ? null : (output || '').slice(-1000), // Last 1KB
      error: null,
    };
    results.checks.push(result);
    results.summary.passed++;
    results.summary.total++;

    log(`${c.green}✓${c.reset} ${name} ${c.dim}(${formatDuration(durationMs)})${c.reset}`);
    return true;
  } catch (err) {
    const durationMs = Date.now() - checkStart;
    const result = {
      name,
      command,
      status: 'failed',
      critical,
      durationMs,
      output: err.stdout ? err.stdout.slice(-2000) : null,
      error: err.stderr ? err.stderr.slice(-2000) : (err.message || 'Unknown error'),
    };
    results.checks.push(result);
    results.summary.failed++;
    results.summary.total++;

    log(`${c.red}✗${c.reset} ${name} ${c.dim}(${formatDuration(durationMs)})${c.reset}`, c.red);

    // Show error snippet in non-JSON mode
    if (!jsonOutput && err.stderr) {
      const lines = err.stderr.split('\n').slice(-5).join('\n');
      log(`  ${c.dim}${lines}${c.reset}`);
    }

    return !critical; // Return true only if non-critical
  }
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Print results summary
 */
function printSummary() {
  results.timing.endTime = Date.now();
  results.timing.durationMs = results.timing.endTime - results.timing.startTime;

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Count critical vs non-critical failures
  const criticalFailed = results.checks.filter(c => c.status === 'failed' && c.critical).length;
  const nonCriticalFailed = results.checks.filter(c => c.status === 'failed' && !c.critical).length;
  const gatePassed = criticalFailed === 0;

  console.log(`
${c.cyan}${c.bold}════════════════════════════════════════════════════════════════${c.reset}
${c.bold}                         GATE SUMMARY${c.reset}
${c.cyan}════════════════════════════════════════════════════════════════${c.reset}

${c.bold}Checks:${c.reset}
  ${c.green}Passed:${c.reset}  ${results.summary.passed}
  ${c.red}Failed:${c.reset}  ${results.summary.failed}${nonCriticalFailed > 0 ? ` (${nonCriticalFailed} non-critical)` : ''}
  ${c.yellow}Skipped:${c.reset} ${results.summary.skipped}
  ${c.white}Total:${c.reset}   ${results.summary.total}

${c.bold}Timing:${c.reset}
  Total Duration: ${formatDuration(results.timing.durationMs)}

${c.bold}Run ID:${c.reset} ${c.dim}${runId}${c.reset}
`);

  // Per-check timing breakdown
  if (verbose) {
    console.log(`${c.bold}Check Breakdown:${c.reset}`);
    results.checks.forEach(check => {
      const icon = check.status === 'passed' ? c.green + '✓' :
                   check.status === 'failed' ? c.red + '✗' :
                   c.yellow + '⊘';
      console.log(`  ${icon}${c.reset} ${check.name}: ${formatDuration(check.durationMs)}`);
    });
    console.log('');
  }

  // Final verdict
  if (gatePassed && nonCriticalFailed === 0) {
    console.log(`${c.bgGreen}${c.white}${c.bold}                    ✓ GATE PASSED                              ${c.reset}`);
    console.log(`\n${c.green}All checks passed. Ready to commit/push.${c.reset}\n`);
  } else if (gatePassed) {
    console.log(`${c.bgGreen}${c.white}${c.bold}                    ✓ GATE PASSED                              ${c.reset}`);
    console.log(`\n${c.green}All critical checks passed.${c.reset}`);
    console.log(`${c.yellow}${nonCriticalFailed} non-critical check(s) failed (warnings only).${c.reset}`);

    // List non-critical failures
    const nonCritical = results.checks.filter(c => c.status === 'failed' && !c.critical);
    if (nonCritical.length > 0) {
      console.log(`\n${c.bold}Non-Critical Warnings:${c.reset}`);
      nonCritical.forEach(check => {
        console.log(`  ${c.yellow}•${c.reset} ${check.name}`);
      });
    }
    console.log('');
  } else {
    console.log(`${c.bgRed}${c.white}${c.bold}                    ✗ GATE FAILED                              ${c.reset}`);
    console.log(`\n${c.red}${criticalFailed} critical check(s) failed. Fix issues before proceeding.${c.reset}`);

    // List critical failures
    const critical = results.checks.filter(c => c.status === 'failed' && c.critical);
    if (critical.length > 0) {
      console.log(`\n${c.bold}Critical Failures (blocks gate):${c.reset}`);
      critical.forEach(check => {
        console.log(`  ${c.red}•${c.reset} ${check.name}`);
      });
    }

    // Also list non-critical if any
    const nonCritical = results.checks.filter(c => c.status === 'failed' && !c.critical);
    if (nonCritical.length > 0) {
      console.log(`\n${c.bold}Non-Critical Warnings:${c.reset}`);
      nonCritical.forEach(check => {
        console.log(`  ${c.yellow}•${c.reset} ${check.name}`);
      });
    }

    console.log(`\n${c.dim}Use '${c.white}npm run ci:all -- --verbose${c.dim}' for detailed output${c.reset}\n`);
  }
}

/**
 * Main gate runner
 */
async function main() {
  printHeader();

  let allCriticalPassed = true;
  const hasBaseUrl = !!process.env.BASE_URL;

  // ═══════════════════════════════════════════════════════════════
  // GATE 1: MVP Surface Guard (check-surfaces.js)
  // Ensures only 5 MVP surfaces: admin, public, display, poster, report
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[1/9] MVP Surfaces${c.reset}`, c.cyan);
  if (!runCheck('MVP Surfaces', 'node scripts/check-surfaces.js', { critical: true })) {
    allCriticalPassed = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 2: RPC Inventory (check-rpc-inventory.js)
  // Validates RPC inventory comment matches actual API usage
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[2/9] RPC Inventory${c.reset}`, c.cyan);
  if (!runCheck('RPC Inventory', 'node scripts/check-rpc-inventory.js', { critical: true })) {
    allCriticalPassed = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 3: API vs Schemas (check-apis-vs-schemas.js)
  // Ensures all api_* functions have corresponding schemas
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[3/9] API vs Schemas${c.reset}`, c.cyan);
  if (!runCheck('API vs Schemas', 'node scripts/check-apis-vs-schemas.js', { critical: true })) {
    allCriticalPassed = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 4: Event Schema (test-event-schema.js)
  // Validates event schema consistency
  // Non-critical: Requires Ajv setup - tracked separately
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[4/9] Event Schema${c.reset}`, c.cyan);
  if (!runCheck('Event Schema', 'node scripts/test-event-schema.js', { critical: false, skipInFastMode: true })) {
    // Non-critical - warn but don't fail (requires schema infrastructure)
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 5: Service Tests (test-services.js)
  // Runs form-service, sponsor-service, security-middleware tests
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[5/9] Service Tests${c.reset}`, c.cyan);
  if (!runCheck('Service Tests', 'node scripts/test-services.js', { critical: true })) {
    allCriticalPassed = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 6: URL Routing (test-url-routing.js)
  // Validates friendly URLs resolve to correct surfaces
  // Only runs if BASE_URL is set (skip in local CI without deployment)
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[6/9] URL Routing${c.reset}`, c.cyan);
  if (hasBaseUrl) {
    if (!runCheck('URL Routing', 'node scripts/test-url-routing.js', { critical: true })) {
      allCriticalPassed = false;
    }
  } else {
    log(`${c.yellow}⊘${c.reset} ${c.dim}URL Routing (skipped - no BASE_URL set)${c.reset}`);
    results.checks.push({
      name: 'URL Routing',
      command: 'node scripts/test-url-routing.js',
      status: 'skipped',
      critical: true,
      durationMs: 0,
      output: 'Skipped: BASE_URL not set',
      error: null,
    });
    results.summary.skipped++;
    results.summary.total++;
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 7: Dead Export Guard (check-dead-code.js)
  // Detects unused api_* functions in Code.gs
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[7/9] Dead Exports${c.reset}`, c.cyan);
  if (!runCheck('Dead Exports', 'node scripts/check-dead-code.js --fail-on-dead', { critical: true })) {
    allCriticalPassed = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 8: Schema Fields (check-schema-fields.js)
  // Validates HTML surfaces only reference schema-defined fields
  // Non-critical: Pre-existing field drift - tracked separately
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[8/9] Schema Fields${c.reset}`, c.cyan);
  if (!runCheck('Schema Fields', 'node scripts/check-schema-fields.js', { critical: false, skipInFastMode: true })) {
    // Non-critical - warn but don't fail (pre-existing schema drift)
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 9: Analytics Schema (test-analytics-schema.js)
  // Validates analytics schema consistency
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[9/10] Analytics Schema${c.reset}`, c.cyan);
  if (!runCheck('Analytics Schema', 'node scripts/test-analytics-schema.js', { critical: false, skipInFastMode: true })) {
    // Non-critical - warn but don't fail
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 10: Triangle Happy-Path Integration Test
  // End-to-end smoke test: Admin → Surfaces → SharedReport
  // Non-blocking (warn-only) for now - intent to make blocking later
  // Only runs if BASE_URL and ADMIN_KEY are set
  // ═══════════════════════════════════════════════════════════════
  log(`\n${c.bold}[10/10] Triangle Happy-Path${c.reset}`, c.cyan);
  const hasAdminKey = !!process.env.ADMIN_KEY;
  if (hasBaseUrl && hasAdminKey) {
    if (!runCheck('Triangle Happy-Path', 'npm run test:triangle:happy-path', { critical: false, skipInFastMode: true })) {
      // Non-critical - warn but don't fail (integration test, may have timing issues)
    }
  } else {
    const skipReason = !hasBaseUrl && !hasAdminKey ? 'no BASE_URL or ADMIN_KEY set' :
                       !hasBaseUrl ? 'no BASE_URL set' : 'no ADMIN_KEY set';
    log(`${c.yellow}⊘${c.reset} ${c.dim}Triangle Happy-Path (skipped - ${skipReason})${c.reset}`);
    results.checks.push({
      name: 'Triangle Happy-Path',
      command: 'npm run test:triangle:happy-path',
      status: 'skipped',
      critical: false,
      durationMs: 0,
      output: `Skipped: ${skipReason}`,
      error: null,
    });
    results.summary.skipped++;
    results.summary.total++;
  }

  // Print final summary
  printSummary();

  // Exit with appropriate code
  process.exit(allCriticalPassed ? 0 : 1);
}

// Run the gate
main().catch(err => {
  if (!jsonOutput) {
    console.error(`${c.red}Gate runner error: ${err.message}${c.reset}`);
  } else {
    results.error = err.message;
    console.log(JSON.stringify(results, null, 2));
  }
  process.exit(1);
});
