#!/usr/bin/env node
/**
 * check-events-gas-marker.js
 *
 * Story 1 - SDET Checklist Script
 *
 * Quick diagnostic script to check if /events returns GAS HTML
 * with the blue-banner marker text. This helps identify whether
 * responses are coming through the Worker proxy correctly.
 *
 * Usage:
 *   node scripts/check-events-gas-marker.js [url]
 *
 * Examples:
 *   node scripts/check-events-gas-marker.js
 *   node scripts/check-events-gas-marker.js https://stg.eventangle.com/events
 *   node scripts/check-events-gas-marker.js https://eventangle.com/events
 *
 * Checks:
 *   1. Response status code
 *   2. Worker transparency headers (X-Proxied-By, X-Worker-Version)
 *   3. GAS blue-banner markers in HTML
 *   4. Content-Type header
 *
 * Exit codes:
 *   0 - All checks passed (proxied correctly, no GAS banner)
 *   1 - Warning: GAS markers detected (possible direct GAS response)
 *   2 - Error: Request failed or unexpected response
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Default URL to check
const DEFAULT_URL = 'https://eventangle.com/events';

// GAS blue-banner marker strings to detect in HTML content
// Using string matching instead of regex to avoid false positive security warnings
const GAS_MARKER_STRINGS = [
  // Google Apps Script direct response markers
  'script.google.com',
  'Google Apps Script',
  // Google's error page styling
  '<div class="errorMessage">',
  'errorpage-background',
  // Google infrastructure
  'googleapis.com',
  // Google's warning/banner styling
  'class="google-material-icons"',
  // Google's XSSI protection prefix (indicates direct GAS JSON)
  ")]}'",
];

// Pattern for GAS exec URL (requires regex for dynamic deployment ID)
const GAS_EXEC_URL_PATTERN = /macros\/s\/[A-Za-z0-9_-]+\/exec/;

// Expected Worker headers
const EXPECTED_HEADERS = {
  'x-proxied-by': 'eventangle-worker',
};

/**
 * Fetch a URL and return response details
 */
function fetchUrl(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const protocol = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'EventAngle-GAS-Marker-Check/1.0',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      timeout: 30000,
    };

    const req = protocol.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body,
          url: urlString,
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Sanitize a string for safe logging (prevent log injection)
 * Removes newlines, carriage returns, and control characters
 */
function sanitizeForLog(str) {
  if (typeof str !== 'string') return String(str);
  // Remove control characters (ASCII 0-31 and 127) and limit length
  // eslint-disable-next-line no-control-regex -- Intentionally matching control chars for security
  return str.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 2000);
}

/**
 * Check for GAS markers in response body
 */
function checkGasMarkers(body) {
  const found = [];
  const lowerBody = body.toLowerCase();

  // Check string markers (case-insensitive)
  for (const marker of GAS_MARKER_STRINGS) {
    if (lowerBody.includes(marker.toLowerCase())) {
      found.push(marker);
    }
  }

  // Check regex pattern for GAS exec URL
  if (GAS_EXEC_URL_PATTERN.test(body)) {
    found.push('macros/s/.../exec URL pattern');
  }

  return found;
}

/**
 * Check for expected Worker headers
 */
function checkWorkerHeaders(headers) {
  const results = {};

  for (const [header, expectedValue] of Object.entries(EXPECTED_HEADERS)) {
    const actualValue = headers[header.toLowerCase()];
    results[header] = {
      expected: expectedValue,
      actual: actualValue || null,
      match: actualValue === expectedValue,
    };
  }

  // Also capture X-Worker-Version if present
  if (headers['x-worker-version']) {
    results['x-worker-version'] = {
      expected: 'any',
      actual: headers['x-worker-version'],
      match: true,
    };
  }

  return results;
}

/**
 * Main check function
 */
async function runChecks(urlString) {
  console.log('='.repeat(60));
  console.log('GAS Blue-Banner Marker Check');
  console.log('='.repeat(60));
  // Sanitize URL for logging to prevent log injection
  console.log(`URL: ${sanitizeForLog(urlString)}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  let response;
  try {
    response = await fetchUrl(urlString);
  } catch (err) {
    console.error('ERROR: Failed to fetch URL');
    // Sanitize error message for logging
    console.error(`  ${sanitizeForLog(err.message)}`);
    return 2;
  }

  // Check 1: Status code
  console.log('1. Response Status');
  console.log(`   Status: ${response.status}`);
  if (response.status >= 200 && response.status < 300) {
    console.log('   Result: PASS');
  } else if (response.status >= 500) {
    console.log('   Result: FAIL (5xx error)');
  } else {
    console.log(`   Result: WARN (unexpected status)`);
  }
  console.log('');

  // Check 2: Content-Type
  console.log('2. Content-Type');
  const contentType = response.headers['content-type'] || 'not set';
  console.log(`   Content-Type: ${contentType}`);
  if (contentType.includes('text/html')) {
    console.log('   Result: PASS (HTML response)');
  } else if (contentType.includes('application/json')) {
    console.log('   Result: INFO (JSON response - may be status endpoint)');
  } else {
    console.log('   Result: WARN (unexpected content type)');
  }
  console.log('');

  // Check 3: Worker headers
  console.log('3. Worker Transparency Headers');
  const headerResults = checkWorkerHeaders(response.headers);
  let workerHeadersOk = true;

  for (const [header, result] of Object.entries(headerResults)) {
    const status = result.match ? 'PASS' : 'MISSING';
    console.log(`   ${header}: ${result.actual || '(not present)'} [${status}]`);
    if (!result.match && header === 'x-proxied-by') {
      workerHeadersOk = false;
    }
  }

  if (workerHeadersOk) {
    console.log('   Result: PASS (Worker is proxying)');
  } else {
    console.log('   Result: WARN (May not be going through Worker)');
  }
  console.log('');

  // Check 4: GAS markers
  console.log('4. GAS Blue-Banner Markers');
  const gasMarkers = checkGasMarkers(response.body);

  if (gasMarkers.length === 0) {
    console.log('   No GAS markers detected');
    console.log('   Result: PASS');
  } else {
    console.log('   WARNING: GAS markers detected:');
    for (const marker of gasMarkers) {
      console.log(`     - ${marker}`);
    }
    console.log('   Result: WARN (Response may contain direct GAS content)');
  }
  console.log('');

  // Check 5: Quick content analysis
  console.log('5. Content Analysis');
  const bodyLength = response.body.length;
  console.log(`   Response size: ${bodyLength} bytes`);

  // Check for expected content markers
  const hasEventAngle = /eventangle/i.test(response.body);
  const hasDoctype = /<!DOCTYPE html>/i.test(response.body);
  const hasPublicPage = /public|events/i.test(response.body);

  console.log(`   Has DOCTYPE: ${hasDoctype ? 'Yes' : 'No'}`);
  console.log(`   Has EventAngle reference: ${hasEventAngle ? 'Yes' : 'No'}`);
  console.log(`   Has public/events content: ${hasPublicPage ? 'Yes' : 'No'}`);
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  if (response.status >= 200 && response.status < 300 && workerHeadersOk && gasMarkers.length === 0) {
    console.log('Status: ALL CHECKS PASSED');
    console.log('The /events route is being proxied correctly through the Worker.');
    console.log('No GAS blue-banner markers detected.');
    return 0;
  } else if (gasMarkers.length > 0) {
    console.log('Status: WARNING - GAS MARKERS DETECTED');
    console.log('The response may contain direct GAS content.');
    console.log('This could indicate:');
    console.log('  - Direct GAS response (not through Worker)');
    console.log('  - GAS error page being returned');
    console.log('  - Misconfigured proxy');
    return 1;
  } else if (!workerHeadersOk) {
    console.log('Status: WARNING - MISSING WORKER HEADERS');
    console.log('Response may not be going through the Worker proxy.');
    return 1;
  } else {
    console.log('Status: ERROR');
    console.log('Unexpected response or request failed.');
    return 2;
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const url = args[0] || DEFAULT_URL;

  // Validate URL
  try {
    new URL(url);
  } catch (err) {
    // Sanitize URL for logging to prevent log injection
    console.error(`Invalid URL: ${sanitizeForLog(url)}`);
    console.error('Usage: node scripts/check-events-gas-marker.js [url]');
    process.exit(2);
  }

  const exitCode = await runChecks(url);
  process.exit(exitCode);
}

main().catch((err) => {
  // Sanitize error for logging
  console.error('Unexpected error:', sanitizeForLog(err.message || String(err)));
  process.exit(2);
});
