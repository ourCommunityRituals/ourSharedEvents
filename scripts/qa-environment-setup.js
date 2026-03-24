#!/usr/bin/env node
/**
 * QA Environment Setup Script (Story 3.5)
 *
 * Prepares and resets the staging environment before E2E tests run.
 *
 * Features:
 * - Ensures test admin account exists and is accessible
 * - Clears old test events (older than configured threshold)
 * - Uses dedicated "QA" brand to isolate test data
 * - Validates environment health before tests
 * - Creates QA-specific test markers for easy identification
 *
 * Usage:
 *   node scripts/qa-environment-setup.js [command]
 *
 * Commands:
 *   setup     - Full setup (health check + cleanup + seed)
 *   cleanup   - Remove old test data only
 *   health    - Check environment health only
 *   seed      - Create fresh test data only
 *   reset     - Full reset (cleanup + seed)
 *   validate  - Validate environment is ready for tests
 *
 * Environment Variables:
 *   BASE_URL      - Target environment URL (default: staging)
 *   ADMIN_KEY     - Admin authentication key
 *   QA_BRAND_ID   - QA brand identifier (default: 'qa-testing')
 *   MAX_TEST_AGE  - Max age of test data in hours (default: 24)
 *   DRY_RUN       - If 'true', only log actions without executing
 */

const https = require('https');
const http = require('http');

// Configuration
const CONFIG = {
  // Target environment
  baseUrl: process.env.BASE_URL || 'https://stg.eventangle.com',
  adminKey: process.env.ADMIN_KEY || process.env.ADMIN_KEY_ROOT,

  // QA isolation settings
  qaBrandId: process.env.QA_BRAND_ID || 'qa-testing',
  qaTestPrefix: 'QA_TEST_',

  // Cleanup settings
  maxTestAgeHours: parseInt(process.env.MAX_TEST_AGE || '24', 10),

  // Behavior
  dryRun: process.env.DRY_RUN === 'true',
  verbose: process.env.VERBOSE === 'true' || process.env.CI === 'true',

  // Timeouts
  requestTimeout: 30000,
  healthCheckTimeout: 10000,
  maxRetries: 3,
  retryDelay: 2000,
};

// Test data markers for identification
const TEST_MARKERS = {
  eventPrefix: 'QA_TEST_',
  sponsorPrefix: 'QA_SPONSOR_',
  descriptionTag: '[AUTO-GENERATED-TEST-DATA]',
  metadataKey: '_qaTestData',
};

/**
 * Logger utility with colored output
 */
const log = {
  info: (msg) => console.log(`   ${msg}`),
  success: (msg) => console.log(`   ${msg}`),
  warn: (msg) => console.log(`   ${msg}`),
  error: (msg) => console.error(`   ${msg}`),
  step: (num, msg) => console.log(`\n[${num}] ${msg}`),
  header: (msg) => {
    console.log('\n' + '='.repeat(60));
    console.log(`  ${msg}`);
    console.log('='.repeat(60));
  },
};

/**
 * Make HTTP request with timeout and retries
 */
async function httpRequest(url, options = {}, retries = CONFIG.maxRetries) {
  const startTime = Date.now();
  const method = options.method || 'GET';
  const timeout = options.timeout || CONFIG.requestTimeout;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const urlObj = new URL(url);

        const reqOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          method,
          timeout,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers,
          },
        };

        const req = protocol.request(reqOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: data,
              duration: Date.now() - startTime,
            });
          });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`Request timeout after ${timeout}ms`));
        });

        if (options.body) {
          req.write(JSON.stringify(options.body));
        }
        req.end();
      });

      return result;
    } catch (error) {
      if (attempt < retries) {
        log.warn(`Attempt ${attempt} failed: ${error.message}. Retrying in ${CONFIG.retryDelay}ms...`);
        await sleep(CONFIG.retryDelay * attempt);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Make API call to the backend
 */
async function apiCall(endpoint, data = {}) {
  const url = `${CONFIG.baseUrl}/api`;

  const body = {
    p: endpoint,
    brand: data.brand || CONFIG.qaBrandId,
    adminKey: CONFIG.adminKey,
    ...data,
  };

  if (CONFIG.verbose) {
    log.info(`API Call: ${endpoint} -> ${url}`);
  }

  if (CONFIG.dryRun) {
    log.info(`[DRY RUN] Would call: ${endpoint}`);
    return { ok: true, dryRun: true };
  }

  const response = await httpRequest(url, {
    method: 'POST',
    body,
  });

  try {
    return JSON.parse(response.body);
  } catch {
    return { ok: false, error: 'Invalid JSON response', raw: response.body };
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check environment health
 */
async function checkHealth() {
  log.step(1, 'Checking environment health...');
  log.info(`Target: ${CONFIG.baseUrl}`);

  try {
    const response = await httpRequest(
      `${CONFIG.baseUrl}/?page=status`,
      { timeout: CONFIG.healthCheckTimeout }
    );

    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      if (data.ok === true) {
        log.success(`Environment is healthy (${response.duration}ms)`);
        log.info(`Build ID: ${data.buildId || 'unknown'}`);
        log.info(`Version: ${data.version || 'unknown'}`);
        return { healthy: true, ...data };
      }
    }

    log.error(`Health check failed: HTTP ${response.statusCode}`);
    return { healthy: false, statusCode: response.statusCode };
  } catch (error) {
    log.error(`Health check error: ${error.message}`);
    return { healthy: false, error: error.message };
  }
}

/**
 * Validate admin access
 */
async function validateAdminAccess() {
  log.step(2, 'Validating admin access...');

  if (!CONFIG.adminKey) {
    log.warn('No ADMIN_KEY configured - skipping admin validation');
    return { valid: false, reason: 'No admin key' };
  }

  try {
    const response = await apiCall('whoami', { brand: 'root' });

    if (response.ok) {
      log.success('Admin access validated');
      log.info(`Brand: ${response.brand || 'root'}`);
      return { valid: true, brand: response.brand };
    }

    log.error(`Admin validation failed: ${response.message || 'Unknown error'}`);
    return { valid: false, reason: response.message };
  } catch (error) {
    log.error(`Admin validation error: ${error.message}`);
    return { valid: false, reason: error.message };
  }
}

/**
 * Get list of test events to clean up
 */
async function getTestEventsToCleanup() {
  log.step(3, 'Identifying test events to clean up...');

  try {
    const response = await apiCall('getEvents', {
      brand: CONFIG.qaBrandId,
      scope: 'events',
    });

    if (!response.ok) {
      log.warn(`Could not fetch events: ${response.message}`);
      return [];
    }

    const events = response.value || response.events || [];
    const cutoffTime = Date.now() - (CONFIG.maxTestAgeHours * 60 * 60 * 1000);

    // Filter for test events that are old enough to clean
    const testEvents = events.filter(event => {
      const isTestEvent =
        event.name?.startsWith(TEST_MARKERS.eventPrefix) ||
        event.description?.includes(TEST_MARKERS.descriptionTag) ||
        event[TEST_MARKERS.metadataKey] === true;

      if (!isTestEvent) return false;

      // Check age
      const createdAt = event.createdAt ? new Date(event.createdAt).getTime() : 0;
      return createdAt < cutoffTime;
    });

    log.info(`Found ${events.length} total events`);
    log.info(`Identified ${testEvents.length} test events older than ${CONFIG.maxTestAgeHours}h`);

    return testEvents;
  } catch (error) {
    log.error(`Error fetching events: ${error.message}`);
    return [];
  }
}

/**
 * Clean up old test events
 */
async function cleanupTestEvents(events) {
  log.step(4, 'Cleaning up old test events...');

  if (events.length === 0) {
    log.info('No test events to clean up');
    return { cleaned: 0, failed: 0 };
  }

  let cleaned = 0;
  let failed = 0;

  for (const event of events) {
    try {
      if (CONFIG.dryRun) {
        log.info(`[DRY RUN] Would delete event: ${event.name} (${event.id})`);
        cleaned++;
        continue;
      }

      const response = await apiCall('deleteEvent', {
        brand: CONFIG.qaBrandId,
        scope: 'events',
        id: event.id,
      });

      if (response.ok) {
        log.success(`Deleted: ${event.name}`);
        cleaned++;
      } else {
        log.warn(`Failed to delete ${event.name}: ${response.message}`);
        failed++;
      }
    } catch (error) {
      log.error(`Error deleting ${event.name}: ${error.message}`);
      failed++;
    }
  }

  log.info(`Cleanup complete: ${cleaned} deleted, ${failed} failed`);
  return { cleaned, failed };
}

/**
 * Seed fresh test data
 */
async function seedTestData() {
  log.step(5, 'Seeding fresh test data...');

  const timestamp = Date.now();
  const testEvents = [
    {
      name: `${TEST_MARKERS.eventPrefix}Basic_${timestamp}`,
      dateISO: getFutureDate(7),
      venue: 'QA Test Venue',
      description: `${TEST_MARKERS.descriptionTag} Basic test event`,
      [TEST_MARKERS.metadataKey]: true,
    },
    {
      name: `${TEST_MARKERS.eventPrefix}WithSponsors_${timestamp}`,
      dateISO: getFutureDate(14),
      venue: 'QA Sponsor Venue',
      description: `${TEST_MARKERS.descriptionTag} Event with sponsors`,
      [TEST_MARKERS.metadataKey]: true,
    },
  ];

  const created = [];
  const failed = [];

  for (const eventData of testEvents) {
    try {
      if (CONFIG.dryRun) {
        log.info(`[DRY RUN] Would create event: ${eventData.name}`);
        created.push({ ...eventData, id: 'dry-run-id' });
        continue;
      }

      const response = await apiCall('saveEvent', {
        brand: CONFIG.qaBrandId,
        scope: 'events',
        event: eventData,
      });

      if (response.ok) {
        const event = response.value || response.event;
        log.success(`Created: ${eventData.name}`);
        created.push(event);
      } else {
        log.warn(`Failed to create ${eventData.name}: ${response.message}`);
        failed.push(eventData);
      }
    } catch (error) {
      log.error(`Error creating ${eventData.name}: ${error.message}`);
      failed.push(eventData);
    }
  }

  log.info(`Seeding complete: ${created.length} created, ${failed.length} failed`);
  return { created, failed };
}

/**
 * Get future date string
 */
function getFutureDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}

/**
 * Generate setup summary
 */
function generateSummary(results) {
  log.header('QA Environment Setup Summary');

  console.log('\n  Configuration:');
  console.log(`    Target URL: ${CONFIG.baseUrl}`);
  console.log(`    QA Brand: ${CONFIG.qaBrandId}`);
  console.log(`    Max Test Age: ${CONFIG.maxTestAgeHours}h`);
  console.log(`    Dry Run: ${CONFIG.dryRun}`);

  console.log('\n  Results:');
  console.log(`    Health Check: ${results.health?.healthy ? 'PASS' : 'FAIL'}`);
  console.log(`    Admin Access: ${results.admin?.valid ? 'PASS' : 'SKIP'}`);
  console.log(`    Events Cleaned: ${results.cleanup?.cleaned || 0}`);
  console.log(`    Events Created: ${results.seed?.created?.length || 0}`);

  const success =
    results.health?.healthy &&
    (results.cleanup?.failed || 0) === 0 &&
    (results.seed?.failed?.length || 0) === 0;

  console.log(`\n  Status: ${success ? 'READY FOR TESTING' : 'SETUP INCOMPLETE'}`);

  return success;
}

/**
 * Write setup state to file for test consumption
 */
async function writeSetupState(results) {
  const fs = require('fs').promises;
  const path = require('path');

  const stateDir = path.join(process.cwd(), '.test-data');
  const stateFile = path.join(stateDir, 'qa-setup-state.json');

  const state = {
    timestamp: new Date().toISOString(),
    environment: CONFIG.baseUrl,
    qaBrand: CONFIG.qaBrandId,
    health: results.health,
    adminAccess: results.admin,
    cleanup: results.cleanup,
    seed: results.seed,
    ready: results.health?.healthy,
  };

  try {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    log.info(`Setup state written to: ${stateFile}`);
  } catch (error) {
    log.warn(`Could not write setup state: ${error.message}`);
  }
}

// =============================================================================
// COMMANDS
// =============================================================================

/**
 * Full setup command
 */
async function commandSetup() {
  log.header('QA Environment Setup');
  console.log(`  Starting full environment setup...`);

  const results = {};

  // Step 1: Health check
  results.health = await checkHealth();
  if (!results.health.healthy) {
    log.error('Environment is not healthy. Aborting setup.');
    return false;
  }

  // Step 2: Validate admin access
  results.admin = await validateAdminAccess();

  // Step 3-4: Cleanup old test data
  const testEvents = await getTestEventsToCleanup();
  results.cleanup = await cleanupTestEvents(testEvents);

  // Step 5: Seed fresh test data
  results.seed = await seedTestData();

  // Write state and summary
  await writeSetupState(results);
  return generateSummary(results);
}

/**
 * Cleanup only command
 */
async function commandCleanup() {
  log.header('QA Test Data Cleanup');

  const results = {};

  results.health = await checkHealth();
  if (!results.health.healthy) {
    log.error('Environment is not healthy. Aborting cleanup.');
    return false;
  }

  const testEvents = await getTestEventsToCleanup();
  results.cleanup = await cleanupTestEvents(testEvents);

  return results.cleanup.failed === 0;
}

/**
 * Health check only command
 */
async function commandHealth() {
  log.header('QA Environment Health Check');

  const health = await checkHealth();
  const admin = await validateAdminAccess();

  console.log('\n  Summary:');
  console.log(`    Environment: ${health.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
  console.log(`    Admin Access: ${admin.valid ? 'VALID' : 'INVALID'}`);

  return health.healthy;
}

/**
 * Seed only command
 */
async function commandSeed() {
  log.header('QA Test Data Seeding');

  const results = {};

  results.health = await checkHealth();
  if (!results.health.healthy) {
    log.error('Environment is not healthy. Aborting seeding.');
    return false;
  }

  results.seed = await seedTestData();

  return (results.seed.failed?.length || 0) === 0;
}

/**
 * Reset command (cleanup + seed)
 */
async function commandReset() {
  log.header('QA Environment Reset');

  const results = {};

  results.health = await checkHealth();
  if (!results.health.healthy) {
    log.error('Environment is not healthy. Aborting reset.');
    return false;
  }

  const testEvents = await getTestEventsToCleanup();
  results.cleanup = await cleanupTestEvents(testEvents);
  results.seed = await seedTestData();

  await writeSetupState(results);
  return generateSummary(results);
}

/**
 * Validate command
 */
async function commandValidate() {
  log.header('QA Environment Validation');

  const results = {};

  // Check health
  results.health = await checkHealth();

  // Check admin access
  results.admin = await validateAdminAccess();

  // Check for existing test data
  log.step(3, 'Checking test data availability...');
  try {
    const response = await apiCall('getEvents', {
      brand: CONFIG.qaBrandId,
      scope: 'events',
    });

    if (response.ok) {
      const events = response.value || response.events || [];
      const testEvents = events.filter(e =>
        e.name?.startsWith(TEST_MARKERS.eventPrefix)
      );
      log.info(`Test events available: ${testEvents.length}`);
      results.testData = { available: testEvents.length > 0, count: testEvents.length };
    }
  } catch (error) {
    log.warn(`Could not check test data: ${error.message}`);
    results.testData = { available: false };
  }

  console.log('\n  Validation Summary:');
  console.log(`    Health: ${results.health?.healthy ? 'PASS' : 'FAIL'}`);
  console.log(`    Admin: ${results.admin?.valid ? 'PASS' : 'SKIP'}`);
  console.log(`    Test Data: ${results.testData?.available ? 'PASS' : 'NONE'}`);

  const ready = results.health?.healthy;
  console.log(`\n  Ready for Testing: ${ready ? 'YES' : 'NO'}`);

  return ready;
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const command = process.argv[2] || 'setup';

  const commands = {
    setup: commandSetup,
    cleanup: commandCleanup,
    health: commandHealth,
    seed: commandSeed,
    reset: commandReset,
    validate: commandValidate,
  };

  if (!commands[command]) {
    console.log(`
QA Environment Setup Script (Story 3.5)

Usage:
  node scripts/qa-environment-setup.js <command>

Commands:
  setup     Full setup (health check + cleanup + seed) [default]
  cleanup   Remove old test data only
  health    Check environment health only
  seed      Create fresh test data only
  reset     Full reset (cleanup + seed)
  validate  Validate environment is ready for tests

Environment Variables:
  BASE_URL      Target environment URL (default: staging)
  ADMIN_KEY     Admin authentication key
  QA_BRAND_ID   QA brand identifier (default: 'qa-testing')
  MAX_TEST_AGE  Max age of test data in hours (default: 24)
  DRY_RUN       If 'true', only log actions without executing
  VERBOSE       If 'true', enable verbose logging

Examples:
  node scripts/qa-environment-setup.js setup
  BASE_URL="https://stg.eventangle.com" node scripts/qa-environment-setup.js reset
  DRY_RUN=true node scripts/qa-environment-setup.js cleanup
    `);
    process.exit(0);
  }

  try {
    const success = await commands[command]();
    process.exit(success ? 0 : 1);
  } catch (error) {
    log.error(`Fatal error: ${error.message}`);
    if (CONFIG.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
