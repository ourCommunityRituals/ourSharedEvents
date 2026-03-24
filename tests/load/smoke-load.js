/**
 * k6 Smoke Load Test
 *
 * Purpose: Baseline test to verify system works under minimal load
 *
 * Load Profile:
 * - 1 Virtual User (VU)
 * - 30 seconds duration
 * - Tests all API endpoints work correctly
 *
 * Usage:
 *   k6 run tests/load/smoke-load.js
 *
 * With environment variables:
 *   BASE_URL=https://your-deployment.com ADMIN_KEY=your-key k6 run tests/load/smoke-load.js
 */

import { group, sleep } from 'k6';
import {
  getBaseUrl,
  getAdminKey,
  getBrandId,
  checkSuccess,
  checkStructure,
  SystemAPI,
  EventsAPI,
  SponsorsAPI,
  generateEventData,
  generateSponsorData,
  extractId,
  thresholds
} from './helpers.js';

/**
 * Test configuration
 */
export const options = {
  vus: 1, // 1 virtual user
  duration: '30s', // 30 seconds
  thresholds: thresholds,
  tags: {
    test_type: 'smoke',
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

  console.log('🧪 Smoke Load Test Configuration:');
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Brand ID: ${brandId}`);
  console.log(`   Admin Key: ${adminKey ? '✅ Set' : '❌ Not Set'}`);
  console.log(`   VUs: ${options.vus}`);
  console.log(`   Duration: ${options.duration}`);

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

  // Test 1: System Status
  group('System Status', () => {
    const response = systemAPI.getStatus();
    checkSuccess(response, 'status');
    checkStructure(response, 'status');
  });

  sleep(1);

  // Test 2: List Events (Read-only)
  group('List Events', () => {
    const response = eventsAPI.list();
    checkSuccess(response, 'list events');
    checkStructure(response, 'list events');
  });

  sleep(1);

  // Test 3: List Sponsors (Read-only)
  group('List Sponsors', () => {
    const response = sponsorsAPI.list();
    checkSuccess(response, 'list sponsors');
    checkStructure(response, 'list sponsors');
  });

  sleep(1);

  // Test 4: Create & Delete Event (if admin key available)
  if (adminKey) {
    group('Event CRUD', () => {
      // Create
      const eventData = generateEventData('Smoke');
      const createResponse = eventsAPI.create(eventData, adminKey);
      const createSuccess = checkSuccess(createResponse, 'create event');

      if (createSuccess) {
        const eventId = extractId(createResponse);

        if (eventId) {
          sleep(1);

          // Read
          const getResponse = eventsAPI.get(eventId);
          checkSuccess(getResponse, 'get event');

          sleep(1);

          // Delete
          const deleteResponse = eventsAPI.delete(eventId, adminKey);
          checkSuccess(deleteResponse, 'delete event');
        }
      }
    });

    sleep(1);

    // Test 5: Create & Delete Sponsor (if admin key available)
    group('Sponsor CRUD', () => {
      // Create
      const sponsorData = generateSponsorData('Smoke');
      const createResponse = sponsorsAPI.create(sponsorData, adminKey);
      const createSuccess = checkSuccess(createResponse, 'create sponsor');

      if (createSuccess) {
        const sponsorId = extractId(createResponse);

        if (sponsorId) {
          sleep(1);

          // Read
          const getResponse = sponsorsAPI.get(sponsorId);
          checkSuccess(getResponse, 'get sponsor');

          sleep(1);

          // Delete
          const deleteResponse = sponsorsAPI.delete(sponsorId, adminKey);
          checkSuccess(deleteResponse, 'delete sponsor');
        }
      }
    });
  } else {
    console.warn('⚠️ ADMIN_KEY not set - skipping CRUD tests');
  }

  sleep(2); // Think time between iterations
}

/**
 * Teardown - runs once after test completes
 */
export function teardown(data) {
  console.log('✅ Smoke load test completed');
}
