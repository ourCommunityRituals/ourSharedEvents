#!/usr/bin/env node

/**
 * API Health Check Script - Story 5
 *
 * Lightweight health check script for CI/CD pipelines.
 * Hits the /api/status endpoint and fails if the system is unhealthy.
 *
 * Usage:
 *   npm run test:api:health                          # Uses BASE_URL from env or defaults to staging
 *   BASE_URL="https://stg.eventangle.com" npm run test:api:health
 *   BASE_URL="https://www.eventangle.com" npm run test:api:health
 *
 * Exit codes:
 *   0 - Health check passed (ok:true, status:200)
 *   1 - Health check failed (ok:false or status not 200)
 *   2 - Configuration error (missing BASE_URL)
 *
 * Expected success response:
 *   {
 *     "ok": true,
 *     "status": 200,
 *     "version": "stg-2025.12.09",
 *     "checks": {
 *       "gas": "ok",
 *       "eventsIndex": "ok"
 *     }
 *   }
 *
 * Failure response when GAS is broken:
 *   {
 *     "ok": false,
 *     "status": 502,
 *     "errorCode": "GAS_UPSTREAM_NON_JSON"
 *   }
 */

const https = require('https');
const http = require('http');

// Configuration
const DEFAULT_BASE_URL = 'https://stg.eventangle.com';
const TIMEOUT_MS = 20000; // 20 seconds - slightly longer than health check timeout
const ENDPOINT = '/api/status';

/**
 * Make HTTP/HTTPS GET request
 * @param {string} url - Full URL to fetch
 * @returns {Promise<{statusCode: number, body: string, headers: object}>}
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, { timeout: TIMEOUT_MS }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location.startsWith('http')
          ? response.headers.location
          : new URL(response.headers.location, url).href;
        return fetchUrl(redirectUrl).then(resolve).catch(reject);
      }

      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          body: data,
          headers: response.headers
        });
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
    });
  });
}

/**
 * Format duration in a human-readable way
 * @param {number} ms - Duration in milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Run the health check
 */
async function runHealthCheck() {
  const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
  const brand = process.env.BRAND || 'root';
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

  // Build the health check URL
  const healthUrl = `${baseUrl}${ENDPOINT}?brand=${brand}`;

  console.log('');
  console.log('🏥 API Health Check (Story 5)');
  console.log('═'.repeat(60));
  console.log(`📍 URL: ${healthUrl}`);
  console.log('');

  const startTime = Date.now();

  try {
    console.log('⏳ Checking health endpoint...');
    const { statusCode, body, headers } = await fetchUrl(healthUrl);
    const duration = Date.now() - startTime;

    if (verbose) {
      console.log(`   HTTP Status: ${statusCode}`);
      console.log(`   Duration: ${formatDuration(duration)}`);
      console.log(`   X-Worker-Version: ${headers['x-worker-version'] || 'N/A'}`);
      console.log(`   X-Backend-Status: ${headers['x-backend-status'] || 'N/A'}`);
      console.log(`   X-Backend-Duration-Ms: ${headers['x-backend-duration-ms'] || 'N/A'}`);
    }

    // Parse JSON response
    let json;
    try {
      json = JSON.parse(body);
    } catch (parseErr) {
      console.log('');
      console.log('❌ HEALTH CHECK FAILED');
      console.log('═'.repeat(60));
      console.log('   Error: Response is not valid JSON');
      console.log(`   HTTP Status: ${statusCode}`);
      console.log(`   Raw response (first 500 chars): ${body.substring(0, 500)}`);
      console.log('');
      process.exit(1);
    }

    console.log('');
    console.log('📋 Response:');
    console.log(JSON.stringify(json, null, 2));
    console.log('');

    // Validate response structure
    const errors = [];

    // Check ok field
    if (typeof json.ok !== 'boolean') {
      errors.push('Missing or invalid "ok" field (expected boolean)');
    } else if (json.ok !== true) {
      errors.push(`"ok" is not true: ${json.ok}`);
    }

    // Check HTTP status matches expected
    if (statusCode !== 200) {
      errors.push(`HTTP status is not 200: ${statusCode}`);
    }

    // Check status field in response body
    if (json.status !== undefined && json.status !== 200) {
      errors.push(`Response status is not 200: ${json.status}`);
    }

    // Check version field
    if (!json.version) {
      errors.push('Missing "version" field');
    }

    // Check checks object
    if (!json.checks) {
      errors.push('Missing "checks" object');
    } else {
      if (json.checks.gas !== 'ok') {
        errors.push(`GAS check failed: ${json.checks.gas}`);
      }
      if (json.checks.eventsIndex !== 'ok') {
        errors.push(`Events index check failed: ${json.checks.eventsIndex}`);
      }
    }

    // Include any errors from the response
    if (json.errors && json.errors.length > 0) {
      errors.push(`Backend reported errors: ${json.errors.join(', ')}`);
    }

    // Report results
    if (errors.length > 0) {
      console.log('❌ HEALTH CHECK FAILED');
      console.log('═'.repeat(60));
      errors.forEach((err) => console.log(`   • ${err}`));
      if (json.errorCode) {
        console.log(`   Error Code: ${json.errorCode}`);
      }
      if (json.message) {
        console.log(`   Message: ${json.message}`);
      }
      console.log(`   Duration: ${formatDuration(duration)}`);
      console.log('');
      process.exit(1);
    }

    console.log('✅ HEALTH CHECK PASSED');
    console.log('═'.repeat(60));
    console.log(`   ✓ ok: ${json.ok}`);
    console.log(`   ✓ status: ${json.status || 200}`);
    console.log(`   ✓ version: ${json.version}`);
    console.log(`   ✓ gas: ${json.checks.gas}`);
    console.log(`   ✓ eventsIndex: ${json.checks.eventsIndex}`);
    console.log(`   ✓ Response time: ${formatDuration(duration)}`);
    if (json.gasBuildId) {
      console.log(`   ✓ GAS Build ID: ${json.gasBuildId}`);
    }
    console.log('');
    process.exit(0);

  } catch (err) {
    const duration = Date.now() - startTime;

    console.log('');
    console.log('❌ HEALTH CHECK FAILED');
    console.log('═'.repeat(60));
    console.log(`   Error: ${err.message}`);
    console.log(`   Duration: ${formatDuration(duration)}`);
    console.log('');
    console.log('   This could indicate:');
    console.log('   - Network connectivity issues');
    console.log('   - Worker deployment problems');
    console.log('   - GAS backend unavailability');
    console.log('');
    process.exit(1);
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
API Health Check Script - Story 5

Usage:
  npm run test:api:health                              # Uses BASE_URL or defaults to staging
  BASE_URL="https://stg.eventangle.com" npm run test:api:health
  BASE_URL="https://www.eventangle.com" npm run test:api:health

Options:
  --verbose, -v   Show detailed response headers
  --help, -h      Show this help message

Environment Variables:
  BASE_URL        Base URL of the API (default: ${DEFAULT_BASE_URL})
  BRAND           Brand ID for the health check (default: root)

Exit Codes:
  0               Health check passed
  1               Health check failed

CI/CD Usage:
  This script is designed for Stage-2 pipeline gates. If the health check
  fails, the pipeline should skip heavy test suites and mark the build red.
`);
  process.exit(0);
}

runHealthCheck();
