#!/usr/bin/env node

/**
 * Synthetic Health Check Validation Script
 *
 * Story 3.2: Validates /health/origin and /events endpoints
 * for synthetic monitoring assertions.
 *
 * Usage:
 *   node scripts/synthetic-health-check.js [--env staging|production] [--json]
 *
 * Exit Codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 *   2 - Script error (invalid args, network failure)
 *
 * @see docs/SYNTHETIC_MONITORING.md
 */

const https = require('https');
const http = require('http');

// =============================================================================
// Configuration
// =============================================================================

const ENVIRONMENTS = {
  staging: {
    baseUrl: 'https://stg.eventangle.com',
    expectedEnv: 'staging',
  },
  production: {
    baseUrl: 'https://www.eventangle.com',
    expectedEnv: 'production',
  },
};

const CHECKS = {
  healthOrigin: {
    name: '/health/origin',
    path: '/health/origin',
    assertions: [
      { type: 'httpStatus', expected: 200 },
      { type: 'jsonField', field: 'ok', expected: true },
      { type: 'jsonField', field: 'env', expectedFromEnv: 'expectedEnv' },
    ],
  },
  events: {
    name: '/events',
    path: '/events',
    assertions: [
      { type: 'httpStatus', expected: 200 },
      { type: 'bodyContains', pattern: 'data-testid="events-root"' },
    ],
  },
};

const TIMEOUT_MS = 30000;

// =============================================================================
// Utilities
// =============================================================================

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    env: 'staging',
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--env' && args[i + 1]) {
      options.env = args[++i];
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--env=')) {
      options.env = arg.split('=')[1];
    }
  }

  return options;
}

/**
 * Make HTTP(S) request
 */
function fetchUrl(url, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const protocol = url.startsWith('https') ? https : http;

    const req = protocol.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          latencyMs: Date.now() - startTime,
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });
  });
}

/**
 * Run assertions against response
 */
function runAssertions(response, assertions, envConfig) {
  const results = [];

  for (const assertion of assertions) {
    let result = { assertion, passed: false, actual: null, expected: null };

    switch (assertion.type) {
      case 'httpStatus':
        result.actual = response.status;
        result.expected = assertion.expected;
        result.passed = response.status === assertion.expected;
        break;

      case 'jsonField':
        try {
          const json = JSON.parse(response.body);
          result.actual = json[assertion.field];
          result.expected = assertion.expectedFromEnv
            ? envConfig[assertion.expectedFromEnv]
            : assertion.expected;
          result.passed = result.actual === result.expected;
        } catch (e) {
          result.actual = `JSON parse error: ${e.message}`;
          result.passed = false;
        }
        break;

      case 'bodyContains':
        result.expected = assertion.pattern;
        result.actual = response.body.includes(assertion.pattern)
          ? 'FOUND'
          : 'NOT FOUND';
        result.passed = response.body.includes(assertion.pattern);
        break;

      default:
        result.actual = `Unknown assertion type: ${assertion.type}`;
        result.passed = false;
    }

    results.push(result);
  }

  return results;
}

// =============================================================================
// Main Check Runner
// =============================================================================

async function runCheck(checkConfig, envConfig) {
  const url = `${envConfig.baseUrl}${checkConfig.path}`;
  const result = {
    name: checkConfig.name,
    url,
    passed: false,
    httpStatus: null,
    latencyMs: null,
    assertions: [],
    error: null,
  };

  try {
    const response = await fetchUrl(url);
    result.httpStatus = response.status;
    result.latencyMs = response.latencyMs;

    // Parse JSON for health/origin to include in output
    if (checkConfig.path === '/health/origin') {
      try {
        result.responseData = JSON.parse(response.body);
      } catch (e) {
        result.responseData = null;
      }
    }

    result.assertions = runAssertions(response, checkConfig.assertions, envConfig);
    result.passed = result.assertions.every((a) => a.passed);
  } catch (err) {
    result.error = err.message;
    result.passed = false;
  }

  return result;
}

async function runAllChecks(envName) {
  const envConfig = ENVIRONMENTS[envName];
  if (!envConfig) {
    throw new Error(`Unknown environment: ${envName}. Valid: ${Object.keys(ENVIRONMENTS).join(', ')}`);
  }

  const results = {
    environment: envName,
    baseUrl: envConfig.baseUrl,
    timestamp: new Date().toISOString(),
    checks: [],
    allPassed: false,
    alertRouting: null,
  };

  // Run checks
  for (const [key, checkConfig] of Object.entries(CHECKS)) {
    const checkResult = await runCheck(checkConfig, envConfig);
    results.checks.push(checkResult);
  }

  // Determine overall status
  results.allPassed = results.checks.every((c) => c.passed);

  // Alert routing logic per Story 3.2 AC
  const healthOriginPassed = results.checks.find((c) => c.name === '/health/origin')?.passed;
  const eventsPassed = results.checks.find((c) => c.name === '/events')?.passed;

  if (!healthOriginPassed && eventsPassed) {
    results.alertRouting = {
      type: 'CONFIG_DRIFT',
      message: '/health/origin fails but /events passes - indicates upstream config issue, not frontend',
    };
  } else if (healthOriginPassed && !eventsPassed) {
    results.alertRouting = {
      type: 'FRONTEND_ISSUE',
      message: '/events fails but /health/origin passes - indicates frontend/route issue, not upstream origin',
    };
  } else if (!healthOriginPassed && !eventsPassed) {
    results.alertRouting = {
      type: 'SYSTEM_DOWN',
      message: 'Both checks failing - indicates worker down or system-wide issue',
    };
  } else {
    results.alertRouting = {
      type: 'HEALTHY',
      message: 'All synthetic checks passing',
    };
  }

  return results;
}

// =============================================================================
// Output Formatters
// =============================================================================

function formatHumanOutput(results) {
  const lines = [];

  lines.push('============================================');
  lines.push('SYNTHETIC HEALTH CHECK VALIDATION');
  lines.push('============================================');
  lines.push(`Environment: ${results.environment}`);
  lines.push(`Target: ${results.baseUrl}`);
  lines.push(`Timestamp: ${results.timestamp}`);
  lines.push('');

  for (const check of results.checks) {
    lines.push(`Check: ${check.name}`);
    lines.push(`  URL: ${check.url}`);

    if (check.error) {
      lines.push(`  ERROR: ${check.error}`);
      lines.push(`  FAILED`);
    } else {
      lines.push(`  HTTP Status: ${check.httpStatus}`);
      if (check.latencyMs) {
        lines.push(`  Latency: ${check.latencyMs}ms`);
      }

      // Show response data for health/origin
      if (check.responseData) {
        lines.push(`  Response:`);
        lines.push(`    ok: ${check.responseData.ok}`);
        lines.push(`    env: ${check.responseData.env}`);
        if (check.responseData.upstreamReachable !== undefined) {
          lines.push(`    upstreamReachable: ${check.responseData.upstreamReachable}`);
        }
        if (check.responseData.latencyMs !== undefined) {
          lines.push(`    upstreamLatencyMs: ${check.responseData.latencyMs}`);
        }
      }

      lines.push(`  Assertions:`);
      for (const assertion of check.assertions) {
        const status = assertion.passed ? 'PASS' : 'FAIL';
        const icon = assertion.passed ? '+' : 'x';
        let desc = '';

        switch (assertion.assertion.type) {
          case 'httpStatus':
            desc = `HTTP status = ${assertion.expected}`;
            break;
          case 'jsonField':
            desc = `${assertion.assertion.field} = ${JSON.stringify(assertion.expected)}`;
            break;
          case 'bodyContains':
            desc = `body contains "${assertion.assertion.pattern}"`;
            break;
        }

        lines.push(`    [${icon}] ${desc} (actual: ${JSON.stringify(assertion.actual)})`);
      }

      lines.push(`  ${check.passed ? 'PASSED' : 'FAILED'}`);
    }

    lines.push('');
  }

  lines.push('============================================');
  lines.push(`ALERT ROUTING: ${results.alertRouting.type}`);
  lines.push(`  ${results.alertRouting.message}`);
  lines.push('============================================');
  lines.push('');
  lines.push(`RESULT: ${results.allPassed ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'}`);
  lines.push('============================================');

  return lines.join('\n');
}

function showHelp() {
  console.log(`
Synthetic Health Check Validation Script

Usage:
  node scripts/synthetic-health-check.js [options]

Options:
  --env <name>    Environment to check (staging, production) [default: staging]
  --json          Output results as JSON
  --help, -h      Show this help message

Examples:
  node scripts/synthetic-health-check.js
  node scripts/synthetic-health-check.js --env production
  node scripts/synthetic-health-check.js --env staging --json

Exit Codes:
  0  All checks passed
  1  One or more checks failed
  2  Script error

For more information, see: docs/SYNTHETIC_MONITORING.md
`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  try {
    const results = await runAllChecks(options.env);

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatHumanOutput(results));
    }

    process.exit(results.allPassed ? 0 : 1);
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`ERROR: ${err.message}`);
    }
    process.exit(2);
  }
}

main();
