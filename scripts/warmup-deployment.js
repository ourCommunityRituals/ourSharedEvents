#!/usr/bin/env node

/**
 * Deployment Warmup Script
 *
 * Warms up the Google Apps Script deployment before running tests.
 * This eliminates cold start flakiness by ensuring the GAS instance is ready.
 *
 * Features:
 * - Exponential backoff with jitter
 * - Multiple status endpoint checks
 * - Validates deployment is actually responding (not just accepting connections)
 * - Outputs deployment readiness metrics
 *
 * Usage:
 *   BASE_URL="https://www.eventangle.com" node scripts/warmup-deployment.js
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" node scripts/warmup-deployment.js
 *
 * Options:
 *   --max-attempts=N    Maximum warmup attempts (default: 5)
 *   --timeout=N         Request timeout in ms (default: 60000)
 *   --brands=a,b,c      Brands to warm up (default: root,abc,cbc,cbl)
 */

const https = require('https');
const http = require('http');

// Configuration
const MAX_ATTEMPTS = parseInt(process.env.WARMUP_MAX_ATTEMPTS || getArg('--max-attempts') || '5', 10);
const REQUEST_TIMEOUT = parseInt(process.env.WARMUP_TIMEOUT || getArg('--timeout') || '60000', 10);
const BASE_DELAY = 2000; // 2 seconds base delay
const MAX_DELAY = 30000; // 30 seconds max delay

// Brands to warm up (can be overridden via env or args)
const DEFAULT_BRANDS = ['root', 'abc', 'cbc', 'cbl'];
const BRANDS = (process.env.WARMUP_BRANDS || getArg('--brands') || DEFAULT_BRANDS.join(',')).split(',');

/**
 * Parse command line arguments
 */
function getArg(name) {
  const arg = process.argv.find(a => a.startsWith(name + '='));
  return arg ? arg.split('=')[1] : null;
}

/**
 * Sleep with optional jitter
 */
function sleep(ms, jitter = true) {
  const jitterMs = jitter ? Math.random() * 1000 : 0;
  return new Promise(resolve => setTimeout(resolve, ms + jitterMs));
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt) {
  const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
  return delay;
}

/**
 * Make HTTP request with timeout
 */
function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const protocol = url.startsWith('https') ? https : http;

    const options = {
      timeout: timeoutMs,
      headers: {
        // Add headers to avoid bot detection
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      }
    };

    const request = protocol.get(url, options, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        console.log(`  ↪ Redirecting to: ${redirectUrl.substring(0, 80)}...`);
        return fetchWithTimeout(redirectUrl, timeoutMs - (Date.now() - startTime))
          .then(resolve)
          .catch(reject);
      }

      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          body: data,
          duration: Date.now() - startTime
        });
      });
    });

    request.on('error', (err) => {
      reject(new Error(`Request failed: ${err.message}`));
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
  });
}

/**
 * Warm up a single brand endpoint
 */
async function warmupBrand(baseUrl, brand) {
  // Construct the status URL
  // For root brand, use /status directly; for others use /{brand}/status
  const statusPath = brand === 'root' ? '/status' : `/${brand}/status`;
  const url = `${baseUrl}${statusPath}`;

  console.log(`\n  🔥 Warming up ${brand.toUpperCase()}: ${url}`);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const attemptNum = attempt + 1;
    console.log(`     Attempt ${attemptNum}/${MAX_ATTEMPTS}...`);

    try {
      const result = await fetchWithTimeout(url, REQUEST_TIMEOUT);

      if (result.statusCode === 200) {
        // Validate response is valid JSON with ok: true
        try {
          const json = JSON.parse(result.body);
          if (json.ok === true) {
            console.log(`     ✅ Ready! (${result.duration}ms, buildId: ${json.buildId || 'unknown'})`);
            return {
              brand,
              success: true,
              duration: result.duration,
              attempts: attemptNum,
              buildId: json.buildId
            };
          } else {
            console.log(`     ⚠️ Response ok=${json.ok}, retrying...`);
          }
        } catch (parseErr) {
          console.log(`     ⚠️ Invalid JSON response, retrying...`);
        }
      } else {
        console.log(`     ⚠️ HTTP ${result.statusCode}, retrying...`);
      }
    } catch (err) {
      console.log(`     ⚠️ ${err.message}`);
    }

    // Wait before retry (except on last attempt)
    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = getBackoffDelay(attempt);
      console.log(`     ⏳ Waiting ${Math.round(delay / 1000)}s before retry...`);
      await sleep(delay);
    }
  }

  console.log(`     ❌ Failed after ${MAX_ATTEMPTS} attempts`);
  return {
    brand,
    success: false,
    attempts: MAX_ATTEMPTS
  };
}

/**
 * Warm up all brand endpoints in parallel
 */
async function warmupAllBrands(baseUrl) {
  console.log(`\n🚀 Warming up ${BRANDS.length} brand endpoints...`);

  // First, warm up root brand (main cold start)
  const rootResult = await warmupBrand(baseUrl, 'root');

  if (!rootResult.success) {
    return { success: false, results: [rootResult] };
  }

  // Then warm up other brands in parallel
  const otherBrands = BRANDS.filter(b => b !== 'root');
  const otherResults = await Promise.all(
    otherBrands.map(brand => warmupBrand(baseUrl, brand))
  );

  const allResults = [rootResult, ...otherResults];
  const allSuccess = allResults.every(r => r.success);

  return {
    success: allSuccess,
    results: allResults
  };
}

/**
 * Main warmup function
 */
async function main() {
  const baseUrl = process.env.BASE_URL;

  if (!baseUrl) {
    console.error('❌ ERROR: BASE_URL environment variable is required');
    console.error('');
    console.error('Usage:');
    console.error('  BASE_URL="https://www.eventangle.com" node scripts/warmup-deployment.js');
    console.error('  BASE_URL="https://script.google.com/macros/s/<ID>/exec" node scripts/warmup-deployment.js');
    process.exit(1);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  🔥 Deployment Warmup');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Base URL:      ${baseUrl}`);
  console.log(`  Brands:        ${BRANDS.join(', ')}`);
  console.log(`  Max Attempts:  ${MAX_ATTEMPTS}`);
  console.log(`  Timeout:       ${REQUEST_TIMEOUT}ms`);

  const startTime = Date.now();
  const { success, results } = await warmupAllBrands(baseUrl);
  const totalDuration = Date.now() - startTime;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  📊 Warmup Summary');
  console.log('═══════════════════════════════════════════════════════════');

  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    const details = r.success
      ? `${r.duration}ms (${r.attempts} attempt${r.attempts > 1 ? 's' : ''})`
      : `Failed after ${r.attempts} attempts`;
    console.log(`  ${status} ${r.brand.toUpperCase()}: ${details}`);
  });

  console.log('');
  console.log(`  Total time: ${Math.round(totalDuration / 1000)}s`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (!success) {
    console.error('❌ Warmup FAILED - deployment may not be ready');
    process.exit(1);
  }

  console.log('✅ Warmup COMPLETE - deployment is ready for testing');

  // Output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    const fs = require('fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `warmup_success=true\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `warmup_duration=${totalDuration}\n`);

    // Extract build IDs for validation
    const buildIds = results.filter(r => r.buildId).map(r => r.buildId);
    if (buildIds.length > 0) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `build_id=${buildIds[0]}\n`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});
