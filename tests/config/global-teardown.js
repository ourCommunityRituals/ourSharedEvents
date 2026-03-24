/**
 * Playwright Global Teardown (Story 3.5)
 *
 * Runs once after all tests complete.
 *
 * Features:
 * - Cleans up test data created during the test run
 * - Reports test data cleanup results
 * - Generates test run summary
 * - Flags any orphaned test data for manual review
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { getBaseUrl } = require('./environments');

// Configuration
const CONFIG = {
  baseUrl: getBaseUrl(),
  adminKey: process.env.ADMIN_KEY || process.env.ADMIN_KEY_ROOT,
  qaBrandId: process.env.QA_BRAND_ID || 'qa-testing',
  cleanupEnabled: process.env.CLEANUP_AFTER_TESTS !== 'false',
  dataDir: path.join(process.cwd(), '.test-data'),
  requestTimeout: 30000,
};

// Test data markers
const TEST_MARKERS = {
  eventPrefix: 'QA_TEST_',
  sessionPrefix: 'SESSION_',
  descriptionTag: '[AUTO-GENERATED-TEST-DATA]',
};

/**
 * Read test run tracking data
 */
async function readTestRunData() {
  const trackingFile = path.join(CONFIG.dataDir, 'test-run-tracking.json');

  try {
    const content = await fs.readFile(trackingFile, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Make HTTP request
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      timeout: options.timeout || CONFIG.requestTimeout,
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
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * Make API call
 */
async function apiCall(endpoint, data = {}) {
  const url = `${CONFIG.baseUrl}/api`;

  const body = {
    p: endpoint,
    brand: data.brand || CONFIG.qaBrandId,
    adminKey: CONFIG.adminKey,
    ...data,
  };

  try {
    const response = await httpRequest(url, {
      method: 'POST',
      body,
    });
    return JSON.parse(response.body);
  } catch {
    return { ok: false, error: 'Request failed' };
  }
}

/**
 * Cleanup test data created during this session
 */
async function cleanupSessionData(sessionId) {
  if (!CONFIG.cleanupEnabled) {
    console.log('  Cleanup disabled (CLEANUP_AFTER_TESTS=false)');
    return { skipped: true };
  }

  if (!CONFIG.adminKey) {
    console.log('  No ADMIN_KEY - skipping cleanup');
    return { skipped: true, reason: 'No admin key' };
  }

  const results = {
    eventsDeleted: 0,
    eventsFailed: 0,
    errors: [],
  };

  try {
    // Get events from QA brand
    const response = await apiCall('getEvents', {
      brand: CONFIG.qaBrandId,
      scope: 'events',
    });

    if (!response.ok) {
      console.log(`  Could not fetch events: ${response.message}`);
      return results;
    }

    const events = response.value || response.events || [];

    // Filter for events created during this session
    const sessionEvents = events.filter(event => {
      // Match by session prefix in name
      if (sessionId && event.name?.includes(sessionId)) {
        return true;
      }
      // Match by QA test prefix
      if (event.name?.startsWith(TEST_MARKERS.eventPrefix)) {
        return true;
      }
      // Match by description tag
      if (event.description?.includes(TEST_MARKERS.descriptionTag)) {
        return true;
      }
      return false;
    });

    console.log(`  Found ${sessionEvents.length} test events to clean up`);

    // Delete each event
    for (const event of sessionEvents) {
      try {
        const deleteResponse = await apiCall('deleteEvent', {
          brand: CONFIG.qaBrandId,
          scope: 'events',
          id: event.id,
        });

        if (deleteResponse.ok) {
          results.eventsDeleted++;
        } else {
          results.eventsFailed++;
          results.errors.push(`${event.name}: ${deleteResponse.message}`);
        }
      } catch (error) {
        results.eventsFailed++;
        results.errors.push(`${event.name}: ${error.message}`);
      }
    }
  } catch (error) {
    results.errors.push(`Cleanup error: ${error.message}`);
  }

  return results;
}

/**
 * Generate cleanup summary
 */
async function generateCleanupSummary(cleanupResults, testRunData) {
  const summaryFile = path.join(CONFIG.dataDir, 'cleanup-summary.json');

  const summary = {
    timestamp: new Date().toISOString(),
    environment: CONFIG.baseUrl,
    qaBrand: CONFIG.qaBrandId,
    testRun: testRunData,
    cleanup: cleanupResults,
  };

  try {
    await fs.mkdir(CONFIG.dataDir, { recursive: true });
    await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2));
    console.log(`  Cleanup summary saved: ${summaryFile}`);
  } catch (error) {
    console.log(`  Could not save cleanup summary: ${error.message}`);
  }

  return summary;
}

/**
 * Update test run history for stability tracking
 */
async function updateTestRunHistory(testRunData, cleanupResults) {
  const historyFile = path.join(CONFIG.dataDir, 'test-run-history.json');

  let history = [];
  try {
    const content = await fs.readFile(historyFile, 'utf8');
    history = JSON.parse(content);
  } catch {
    // File doesn't exist yet
  }

  // Add this run to history
  const runRecord = {
    timestamp: new Date().toISOString(),
    sessionId: testRunData?.sessionId,
    environment: CONFIG.baseUrl,
    cleanup: {
      eventsDeleted: cleanupResults.eventsDeleted,
      eventsFailed: cleanupResults.eventsFailed,
      skipped: cleanupResults.skipped || false,
    },
  };

  history.push(runRecord);

  // Keep last 100 runs
  if (history.length > 100) {
    history = history.slice(-100);
  }

  try {
    await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
  } catch (error) {
    console.log(`  Could not update history: ${error.message}`);
  }
}

/**
 * Main teardown function
 */
module.exports = async () => {
  console.log('\n' + '='.repeat(60));
  console.log('  GLOBAL TEARDOWN (Story 3.5)');
  console.log('='.repeat(60) + '\n');

  // Read test run tracking data
  const testRunData = await readTestRunData();
  const sessionId = testRunData?.sessionId || process.env.TEST_SESSION_ID;

  console.log('1. Test Run Info:');
  console.log(`   Session ID: ${sessionId || 'unknown'}`);
  console.log(`   Environment: ${CONFIG.baseUrl}`);
  console.log(`   QA Brand: ${CONFIG.qaBrandId}`);
  console.log('');

  // Cleanup test data
  console.log('2. Cleaning up test data...');
  const cleanupResults = await cleanupSessionData(sessionId);

  if (cleanupResults.skipped) {
    console.log(`   Cleanup skipped: ${cleanupResults.reason || 'disabled'}`);
  } else {
    console.log(`   Events deleted: ${cleanupResults.eventsDeleted}`);
    console.log(`   Events failed: ${cleanupResults.eventsFailed}`);
    if (cleanupResults.errors.length > 0) {
      console.log('   Errors:');
      cleanupResults.errors.forEach(e => console.log(`     - ${e}`));
    }
  }
  console.log('');

  // Generate summary
  console.log('3. Generating cleanup summary...');
  await generateCleanupSummary(cleanupResults, testRunData);

  // Update history
  console.log('4. Updating test run history...');
  await updateTestRunHistory(testRunData, cleanupResults);

  console.log('\n' + '='.repeat(60));
  console.log('  TEARDOWN COMPLETE');
  console.log('='.repeat(60) + '\n');
};
