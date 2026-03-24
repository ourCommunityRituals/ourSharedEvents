/**
 * k6 Average Load Test
 *
 * Purpose: Simulate normal/average usage patterns
 *
 * Load Profile:
 * - 10 Virtual Users (VUs)
 * - 2 minutes duration
 * - Tests typical user workflows (mostly reads, some writes)
 *
 * Simulates:
 * - 10 concurrent users browsing events and sponsors
 * - Occasional event/sponsor creation by admins
 * - Realistic think time between requests
 *
 * Usage:
 *   k6 run tests/load/average-load.js
 *
 * With environment variables:
 *   BASE_URL=https://your-deployment.com ADMIN_KEY=your-key k6 run tests/load/average-load.js
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
 * Test configuration
 */
export const options = {
  vus: 10, // 10 virtual users
  duration: '2m', // 2 minutes
  thresholds: thresholds,
  tags: {
    test_type: 'average_load',
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

  console.log('📊 Average Load Test Configuration:');
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Brand ID: ${brandId}`);
  console.log(`   Admin Key: ${adminKey ? '✅ Set' : '❌ Not Set'}`);
  console.log(`   VUs: ${options.vus}`);
  console.log(`   Duration: ${options.duration}`);
  console.log('');
  console.log('🎭 Simulating:');
  console.log('   - 70% read-only users (browsing events/sponsors)');
  console.log('   - 30% admin users (creating/updating data)');

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

  // Determine user type (70% read-only, 30% admin)
  const isAdmin = adminKey && Math.random() < 0.3;

  if (isAdmin) {
    // Admin User Workflow
    adminUserWorkflow(systemAPI, eventsAPI, sponsorsAPI, adminKey);
  } else {
    // Read-Only User Workflow (browsing)
    readOnlyUserWorkflow(systemAPI, eventsAPI, sponsorsAPI);
  }
}

/**
 * Read-only user workflow (browsing events and sponsors)
 */
function readOnlyUserWorkflow(systemAPI, eventsAPI, sponsorsAPI) {
  group('Browse Events (Read-Only)', () => {
    // Check system status
    systemAPI.getStatus();
    randomSleep(0.5, 1.5);

    // List all events
    const listResponse = eventsAPI.list();
    checkSuccess(listResponse, 'list events');
    randomSleep(1, 3);

    // Try to get a specific event (if any exist)
    try {
      const body = JSON.parse(listResponse.body);
      if (body.value?.items?.length > 0) {
        const randomEvent = body.value.items[Math.floor(Math.random() * body.value.items.length)];
        if (randomEvent.id) {
          eventsAPI.get(randomEvent.id);
          randomSleep(2, 4);
        }
      }
    } catch (e) {
      // Ignore parsing errors
    }

    // List sponsors
    const sponsorsResponse = sponsorsAPI.list();
    checkSuccess(sponsorsResponse, 'list sponsors');
    randomSleep(1, 2);
  });
}

/**
 * Admin user workflow (creating/updating content)
 */
function adminUserWorkflow(systemAPI, eventsAPI, sponsorsAPI, adminKey) {
  group('Admin Operations', () => {
    // Check system status
    systemAPI.getStatus();
    randomSleep(0.5, 1);

    // Decide what to do (50% event operations, 50% sponsor operations)
    if (Math.random() < 0.5) {
      // Event operations
      group('Manage Events', () => {
        // Create event
        const eventData = generateEventData('AverageLoad');
        const createResponse = eventsAPI.create(eventData, adminKey);
        const createSuccess = checkSuccess(createResponse, 'create event');

        if (createSuccess) {
          const eventId = extractId(createResponse);

          if (eventId) {
            randomSleep(1, 2);

            // Update event
            const updateData = {
              summary: `Updated at ${new Date().toISOString()}`
            };
            eventsAPI.update(eventId, updateData, adminKey);
            randomSleep(1, 2);

            // Delete event (cleanup)
            eventsAPI.delete(eventId, adminKey);
          }
        }
      });
    } else {
      // Sponsor operations
      group('Manage Sponsors', () => {
        // Create sponsor
        const sponsorData = generateSponsorData('AverageLoad');
        const createResponse = sponsorsAPI.create(sponsorData, adminKey);
        const createSuccess = checkSuccess(createResponse, 'create sponsor');

        if (createSuccess) {
          const sponsorId = extractId(createResponse);

          if (sponsorId) {
            randomSleep(1, 2);

            // Update sponsor
            const updateData = {
              description: `Updated at ${new Date().toISOString()}`
            };
            sponsorsAPI.update(sponsorId, updateData, adminKey);
            randomSleep(1, 2);

            // Delete sponsor (cleanup)
            sponsorsAPI.delete(sponsorId, adminKey);
          }
        }
      });
    }

    randomSleep(2, 4); // Admin think time
  });
}

/**
 * Teardown - runs once after test completes
 */
export function teardown(data) {
  console.log('✅ Average load test completed');
  console.log('📊 Check results for performance metrics and success rates');
}
