/**
 * Playwright Global Setup (Story 3.5 Enhanced, Story 1.3)
 * Runs once before all tests
 *
 * Features:
 * - Prints environment configuration
 * - Logs runtime environment with origin detection (Story 1.3)
 * - Optional deployment warmup (set WARMUP_BEFORE_TESTS=true)
 * - Validates deployment is responding before tests run
 * - Generates unique session ID for test run tracking
 * - Initializes test data tracking for cleanup
 * - Sets up graceful error handling hooks
 */

const { printEnvironmentInfo, getBaseUrl } = require('./environments');
const { logRuntimeEnv } = require('./runtime-logger');
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Quick health check to verify deployment is responding
 * Returns true if status endpoint returns 200 with ok: true
 */
async function checkDeploymentHealth(baseUrl, maxAttempts = 3) {
  const statusUrl = `${baseUrl}/?page=status`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fetchWithTimeout(statusUrl, 30000);

      if (result.statusCode === 200) {
        try {
          const json = JSON.parse(result.body);
          if (json.ok === true) {
            return { healthy: true, duration: result.duration, buildId: json.buildId };
          }
        } catch {
          // Invalid JSON
        }
      }

      // Wait before retry
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    } catch (err) {
      console.log(`  ⚠️ Health check attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }

  return { healthy: false };
}

/**
 * Make HTTP request with timeout
 */
function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, { timeout: timeoutMs }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return fetchWithTimeout(response.headers.location, timeoutMs - (Date.now() - startTime))
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

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    });
  });
}

/**
 * Generate unique session ID for test run tracking
 * Uses crypto.randomBytes for secure randomness (CodeQL compliant)
 */
function generateSessionId() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `SESSION_${timestamp}_${random}`;
}

/**
 * Initialize test data tracking
 */
async function initializeTestTracking(sessionId) {
  const dataDir = path.join(process.cwd(), '.test-data');
  const trackingFile = path.join(dataDir, 'test-run-tracking.json');

  const tracking = {
    sessionId,
    startTime: new Date().toISOString(),
    environment: getBaseUrl(),
    qaBrand: process.env.QA_BRAND_ID || 'qa-testing',
    createdResources: {
      events: [],
      sponsors: [],
    },
    pid: process.pid,
    ci: !!process.env.CI,
  };

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(trackingFile, JSON.stringify(tracking, null, 2));
    return true;
  } catch (error) {
    console.log(`   ⚠️ Could not initialize tracking: ${error.message}`);
    return false;
  }
}

/**
 * Set up graceful shutdown handlers
 */
function setupGracefulShutdown(sessionId) {
  // Handle unexpected termination
  const shutdownHandler = async (signal) => {
    console.log(`\n⚠️ Received ${signal} - initiating graceful shutdown...`);

    const dataDir = path.join(process.cwd(), '.test-data');
    const trackingFile = path.join(dataDir, 'test-run-tracking.json');

    try {
      const content = await fs.readFile(trackingFile, 'utf8');
      const tracking = JSON.parse(content);
      tracking.endTime = new Date().toISOString();
      tracking.terminatedBy = signal;
      tracking.status = 'terminated';
      await fs.writeFile(trackingFile, JSON.stringify(tracking, null, 2));
    } catch {
      // Ignore errors during shutdown
    }

    // Allow other handlers to run
    setTimeout(() => process.exit(signal === 'SIGTERM' ? 0 : 1), 1000);
  };

  // Register shutdown handlers (only once)
  if (!process.env._SHUTDOWN_HANDLERS_REGISTERED) {
    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.env._SHUTDOWN_HANDLERS_REGISTERED = 'true';
  }
}

/**
 * Print setup banner
 */
function printSetupBanner(sessionId) {
  console.log('\n' + '='.repeat(60));
  console.log('  GLOBAL SETUP (Story 3.5)');
  console.log('='.repeat(60));
  console.log(`  Session ID: ${sessionId}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('='.repeat(60) + '\n');
}

module.exports = async () => {
  // Generate session ID for this test run
  const sessionId = generateSessionId();

  // Store session ID in environment for access by tests
  process.env.TEST_SESSION_ID = sessionId;

  // Print setup banner
  printSetupBanner(sessionId);

  // Print environment configuration
  printEnvironmentInfo();

  // Log runtime environment with origin detection (Story 1.3)
  // This shows the actual origin tests will hit, helping debug 410/404/500 issues
  logRuntimeEnv();

  const baseUrl = getBaseUrl();
  const baseHost = new URL(baseUrl).hostname;

  // Story 3: Log and validate resolved host for environment alignment
  console.log('\n' + '='.repeat(60));
  console.log('  ENVIRONMENT ALIGNMENT CHECK (Story 3)');
  console.log('='.repeat(60));
  console.log(`  Resolved BASE_URL: ${baseUrl}`);
  console.log(`  Resolved Host: ${baseHost}`);

  // Validate that staging tests run against stg.oursharedevents.com
  if (process.env.CI) {
    const expectedStagingHost = 'stg.oursharedevents.com';
    if (!process.env.USE_PRODUCTION && baseHost !== expectedStagingHost && !baseHost.includes('oursharedevents.com')) {
      console.log(`  ⚠️ WARNING: Running in CI but not using ${expectedStagingHost}`);
      console.log(`     Expected: ${expectedStagingHost}`);
      console.log(`     Actual:   ${baseHost}`);
      console.log('');
      console.log('     Set USE_PRODUCTION=true to explicitly use production.');
      console.log('     Or ensure BASE_URL is not overridden.');
    } else {
      console.log(`  ✅ Host validated for CI: ${baseHost}`);
    }
  } else {
    console.log(`  ℹ️ Running locally, host validation skipped`);
  }

  console.log('='.repeat(60) + '\n');

  // Initialize test data tracking
  console.log('\n📋 Initializing test tracking...');
  const trackingInitialized = await initializeTestTracking(sessionId);
  if (trackingInitialized) {
    console.log(`   ✅ Tracking initialized`);
  }

  // Set up graceful shutdown handlers
  console.log('\n🛡️ Setting up graceful shutdown handlers...');
  setupGracefulShutdown(sessionId);
  console.log('   ✅ Shutdown handlers registered');

  // Optional: Run warmup before tests (set WARMUP_BEFORE_TESTS=true or CI=true)
  const shouldWarmup = process.env.WARMUP_BEFORE_TESTS === 'true' || process.env.CI === 'true';

  if (shouldWarmup) {
    console.log('\n🔥 Checking deployment health before tests...');
    console.log(`   URL: ${baseUrl}/?page=status`);

    const health = await checkDeploymentHealth(baseUrl);

    if (health.healthy) {
      console.log(`   ✅ Deployment is healthy (${health.duration}ms, build: ${health.buildId || 'unknown'})`);
    } else {
      console.log('   ⚠️ Deployment may not be fully ready - tests might experience cold start delays');
      console.log('   💡 Run "npm run warmup" before tests to avoid cold starts');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  SETUP COMPLETE - Starting tests...');
  console.log('='.repeat(60) + '\n');
};
