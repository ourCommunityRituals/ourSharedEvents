/**
 * k6 Spike Load Test
 *
 * Purpose: Test system resilience to sudden traffic spikes
 *
 * Load Profile:
 * - Start with 1 VU (baseline)
 * - Spike to 100 VUs instantly
 * - Hold at 100 VUs for 30 seconds
 * - Drop back to 1 VU instantly
 * - Hold at 1 VU for 30 seconds (recovery)
 *
 * Simulates:
 * - Sudden viral event (social media spike)
 * - Event announcement going live
 * - Breaking news driving traffic
 * - System recovery after spike
 *
 * Usage:
 *   k6 run tests/load/spike-load.js
 *
 * With environment variables:
 *   BASE_URL=https://your-deployment.com ADMIN_KEY=your-key k6 run tests/load/spike-load.js
 */

import { group, sleep } from 'k6';
import {
  getBaseUrl,
  getAdminKey,
  getBrandId,
  checkSuccess,
  SystemAPI,
  EventsAPI,
  SponsorsAPI,
  generateEventData,
  generateSponsorData,
  extractId,
  randomSleep
} from './helpers.js';

/**
 * Test configuration with spike stages
 */
export const options = {
  stages: [
    { duration: '10s', target: 1 },   // Baseline: 1 VU for 10 seconds
    { duration: '0s', target: 100 },  // Spike: Instant jump to 100 VUs
    { duration: '30s', target: 100 }, // Hold: 100 VUs for 30 seconds
    { duration: '0s', target: 1 },    // Drop: Instant drop to 1 VU
    { duration: '30s', target: 1 }    // Recovery: 1 VU for 30 seconds
  ],
  thresholds: {
    // Very relaxed thresholds for spike test (expecting some degradation)
    http_req_failed: ['rate<0.10'], // Allow up to 10% failure rate during spike
    http_req_duration: ['p(95)<15000'], // 95% under 15 seconds
    'http_req_duration{avg}': ['<8000'], // Average under 8 seconds
    checks: ['rate>0.80'] // 80% check success rate (spike can be harsh)
  },
  tags: {
    test_type: 'spike',
    environment: __ENV.ENVIRONMENT || 'production'
  }
};

/**
 * Setup - runs once before test starts
 */
export function setup() {
  const baseUrl = getBaseUrl();
  const adminKey = getAdminKey();
  const brandId = getBrandId();

  console.log('⚡ Spike Load Test Configuration:');
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Brand ID: ${brandId}`);
  console.log(`   Admin Key: ${adminKey ? '✅ Set' : '❌ Not Set'}`);
  console.log('');
  console.log('📈 Spike Profile:');
  console.log('   Stage 1: Baseline (1 VU, 10s)');
  console.log('   Stage 2: SPIKE! (1 → 100 VUs instantly)');
  console.log('   Stage 3: Hold (100 VUs, 30s)');
  console.log('   Stage 4: Drop (100 → 1 VU instantly)');
  console.log('   Stage 5: Recovery (1 VU, 30s)');
  console.log('');
  console.log('🎯 Testing:');
  console.log('   - System response to sudden traffic spike');
  console.log('   - Error handling under extreme load');
  console.log('   - Recovery after spike ends');
  console.log('   - Google Apps Script rate limiting behavior');
  console.log('');
  console.log('⚠️  Note: Expect some errors during spike - this is normal!');

  return { baseUrl, adminKey, brandId };
}

/**
 * Main test function - runs for each VU iteration
 */
export default function (data) {
  const { baseUrl, adminKey, brandId } = data;

  const systemAPI = new SystemAPI(baseUrl, brandId);
  const eventsAPI = new EventsAPI(baseUrl, brandId);
  const sponsorsAPI = new SponsorsAPI(baseUrl, brandId);

  // During spike, focus on read-heavy operations (most realistic)
  // Very few writes during a viral spike
  const operationType = Math.random();

  if (operationType < 0.85) {
    // 85% - Read operations (realistic for viral traffic)
    spikeReadWorkflow(systemAPI, eventsAPI, sponsorsAPI);
  } else if (operationType < 0.95 && adminKey) {
    // 10% - Quick writes (admins responding to spike)
    spikeWriteWorkflow(eventsAPI, sponsorsAPI, adminKey);
  } else {
    // 5% - Status checks only (health monitoring)
    spikeStatusWorkflow(systemAPI);
  }
}

/**
 * Read workflow optimized for spike (fast, minimal think time)
 */
function spikeReadWorkflow(systemAPI, eventsAPI, sponsorsAPI) {
  group('Spike: Read Workflow', () => {
    // Quick status check
    systemAPI.getStatus();
    sleep(0.1); // Minimal think time during spike

    // List events (most common during spike)
    const eventsResponse = eventsAPI.list();
    checkSuccess(eventsResponse, 'spike: list events');
    sleep(0.1);

    // Some users check sponsors too
    if (Math.random() < 0.3) {
      sponsorsAPI.list();
      sleep(0.1);
    }

    // Few users drill down to specific events
    if (Math.random() < 0.2) {
      try {
        const body = JSON.parse(eventsResponse.body);
        if (body.value?.items?.length > 0) {
          const firstEvent = body.value.items[0];
          if (firstEvent.id) {
            eventsAPI.get(firstEvent.id);
          }
        }
      } catch (e) {
        // Ignore parsing errors during spike
      }
    }

    sleep(0.5); // Minimal think time
  });
}

/**
 * Write workflow during spike (quick, essential operations only)
 */
function spikeWriteWorkflow(eventsAPI, sponsorsAPI, adminKey) {
  group('Spike: Write Workflow', () => {
    // Quick create operation
    const eventData = generateEventData('Spike');
    const createResponse = eventsAPI.create(eventData, adminKey);

    // Only delete if create succeeded (don't compound errors)
    if (createResponse.status === 200) {
      const eventId = extractId(createResponse);
      if (eventId) {
        sleep(0.2);
        // Quick cleanup
        eventsAPI.delete(eventId, adminKey);
      }
    }

    sleep(0.5);
  });
}

/**
 * Status-only workflow (health check monitoring)
 */
function spikeStatusWorkflow(systemAPI) {
  group('Spike: Status Check', () => {
    systemAPI.getStatus();
    sleep(1); // Status checks can be slower
  });
}

/**
 * Teardown - runs once after test completes
 */
export function teardown(data) {
  console.log('✅ Spike load test completed');
  console.log('');
  console.log('📊 Review metrics:');
  console.log('   - How did the system handle the sudden spike?');
  console.log('   - What was the error rate during peak?');
  console.log('   - How long did it take to recover?');
  console.log('   - Were there any rate limiting (429) errors?');
  console.log('');
  console.log('💡 Tips:');
  console.log('   - Check p95/p99 response times during spike');
  console.log('   - Look for error patterns in the logs');
  console.log('   - Compare baseline vs spike vs recovery metrics');
  console.log('   - Google Apps Script has rate limits - spikes may hit them');
}
