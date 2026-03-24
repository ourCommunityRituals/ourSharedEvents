/**
 * k6 Stress Load Test
 *
 * Purpose: Test system behavior under heavy sustained load
 *
 * Load Profile:
 * - Ramp up from 0 to 50 VUs over 1 minute
 * - Hold at 50 VUs for 2 minutes
 * - Ramp down to 0 over 1 minute
 * - Total duration: 4 minutes
 *
 * Simulates:
 * - Gradual increase in traffic (conference starting, event going viral)
 * - Sustained high load (peak usage)
 * - Gradual decrease (traffic returning to normal)
 *
 * Usage:
 *   k6 run tests/load/stress-load.js
 *
 * With environment variables:
 *   BASE_URL=https://your-deployment.com ADMIN_KEY=your-key k6 run tests/load/stress-load.js
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
  randomSleep,
  thresholds
} from './helpers.js';

/**
 * Test configuration with ramp-up/ramp-down stages
 */
export const options = {
  stages: [
    { duration: '1m', target: 50 },  // Ramp up to 50 VUs over 1 minute
    { duration: '2m', target: 50 },  // Stay at 50 VUs for 2 minutes
    { duration: '1m', target: 0 }    // Ramp down to 0 VUs over 1 minute
  ],
  thresholds: {
    // Relaxed thresholds for stress test
    http_req_failed: ['rate<0.05'], // Allow up to 5% failure rate
    http_req_duration: ['p(95)<10000'], // 95% under 10 seconds
    'http_req_duration{avg}': ['<5000'], // Average under 5 seconds
    checks: ['rate>0.90'] // 90% check success rate
  },
  tags: {
    test_type: 'stress',
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

  console.log('💪 Stress Load Test Configuration:');
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Brand ID: ${brandId}`);
  console.log(`   Admin Key: ${adminKey ? '✅ Set' : '❌ Not Set'}`);
  console.log('');
  console.log('📈 Load Profile:');
  console.log('   Stage 1: Ramp up 0 → 50 VUs (1 minute)');
  console.log('   Stage 2: Hold at 50 VUs (2 minutes)');
  console.log('   Stage 3: Ramp down 50 → 0 VUs (1 minute)');
  console.log('');
  console.log('🎯 Testing:');
  console.log('   - System stability under high load');
  console.log('   - Response times during peak usage');
  console.log('   - Error rates under stress');

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

  // Mix of read-heavy and write operations
  const operationType = Math.random();

  if (operationType < 0.6) {
    // 60% - Read operations (most common)
    readHeavyWorkflow(systemAPI, eventsAPI, sponsorsAPI);
  } else if (operationType < 0.9 && adminKey) {
    // 30% - Write operations (if admin key available)
    writeHeavyWorkflow(eventsAPI, sponsorsAPI, adminKey);
  } else {
    // 10% - Mixed operations
    mixedWorkflow(systemAPI, eventsAPI, sponsorsAPI, adminKey);
  }
}

/**
 * Read-heavy workflow (browsing, listing, getting)
 */
function readHeavyWorkflow(systemAPI, eventsAPI, sponsorsAPI) {
  group('Read-Heavy Workflow', () => {
    // Status check
    systemAPI.getStatus();
    sleep(0.5);

    // List events
    const eventsResponse = eventsAPI.list();
    checkSuccess(eventsResponse, 'list events');
    sleep(0.5);

    // List sponsors
    const sponsorsResponse = sponsorsAPI.list();
    checkSuccess(sponsorsResponse, 'list sponsors');
    sleep(0.5);

    // Try to get specific items
    try {
      const eventsBody = JSON.parse(eventsResponse.body);
      if (eventsBody.value?.items?.length > 0) {
        const randomEvent = eventsBody.value.items[0];
        if (randomEvent.id) {
          eventsAPI.get(randomEvent.id);
        }
      }
    } catch (e) {
      // Ignore
    }

    randomSleep(1, 2);
  });
}

/**
 * Write-heavy workflow (creating, updating, deleting)
 */
function writeHeavyWorkflow(eventsAPI, sponsorsAPI, adminKey) {
  group('Write-Heavy Workflow', () => {
    // Alternate between events and sponsors
    if (Math.random() < 0.5) {
      // Event CRUD
      const eventData = generateEventData('Stress');
      const createResponse = eventsAPI.create(eventData, adminKey);

      if (createResponse.status === 200) {
        const eventId = extractId(createResponse);

        if (eventId) {
          sleep(0.5);

          // Update
          eventsAPI.update(eventId, { summary: 'Updated under stress' }, adminKey);
          sleep(0.5);

          // Delete
          eventsAPI.delete(eventId, adminKey);
        }
      }
    } else {
      // Sponsor CRUD
      const sponsorData = generateSponsorData('Stress');
      const createResponse = sponsorsAPI.create(sponsorData, adminKey);

      if (createResponse.status === 200) {
        const sponsorId = extractId(createResponse);

        if (sponsorId) {
          sleep(0.5);

          // Update
          sponsorsAPI.update(sponsorId, { description: 'Updated under stress' }, adminKey);
          sleep(0.5);

          // Delete
          sponsorsAPI.delete(sponsorId, adminKey);
        }
      }
    }

    randomSleep(1, 2);
  });
}

/**
 * Mixed workflow (combination of reads and writes)
 */
function mixedWorkflow(systemAPI, eventsAPI, sponsorsAPI, adminKey) {
  group('Mixed Workflow', () => {
    // Status
    systemAPI.getStatus();
    sleep(0.5);

    // List
    eventsAPI.list();
    sleep(0.5);

    sponsorsAPI.list();
    sleep(0.5);

    // Create if admin
    if (adminKey) {
      const eventData = generateEventData('StressMixed');
      const createResponse = eventsAPI.create(eventData, adminKey);

      if (createResponse.status === 200) {
        const eventId = extractId(createResponse);
        if (eventId) {
          sleep(0.5);
          eventsAPI.delete(eventId, adminKey);
        }
      }
    }

    randomSleep(1, 3);
  });
}

/**
 * Teardown - runs once after test completes
 */
export function teardown(data) {
  console.log('✅ Stress load test completed');
  console.log('');
  console.log('📊 Review metrics:');
  console.log('   - Did response times degrade under load?');
  console.log('   - Were there any errors during peak load?');
  console.log('   - Did the system recover during ramp-down?');
  console.log('   - What is the maximum sustainable load?');
}
