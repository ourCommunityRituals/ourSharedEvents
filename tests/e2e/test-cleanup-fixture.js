/**
 * Test Cleanup Fixture (Story 3.5)
 *
 * Provides automatic test data cleanup for E2E tests.
 * Tracks all resources created during tests and cleans them up automatically.
 *
 * Usage:
 *   import { test, expect, testCleanup } from './test-cleanup-fixture';
 *
 *   test('create event', async ({ page, testCleanup }) => {
 *     const eventId = await createEvent('Test Event');
 *     testCleanup.trackEvent(eventId);  // Will be auto-cleaned
 *   });
 *
 * Features:
 * - Automatic cleanup after each test
 * - Resource tracking (events, sponsors, etc.)
 * - Integration with session tracking
 * - Graceful error handling during cleanup
 */

import { test as base, expect } from '@playwright/test';
import { config } from './config';

/**
 * Test markers for identifying QA test data
 */
const TEST_MARKERS = {
  eventPrefix: 'QA_TEST_',
  sessionPrefix: 'SESSION_',
  descriptionTag: '[AUTO-GENERATED-TEST-DATA]',
};

/**
 * Cleanup manager class
 */
class CleanupManager {
  constructor(request) {
    this.request = request;
    this.trackedEvents = [];
    this.trackedSponsors = [];
    this.sessionId = process.env.TEST_SESSION_ID || 'unknown';
  }

  /**
   * Track an event for cleanup
   */
  trackEvent(eventId, eventName = null) {
    this.trackedEvents.push({ id: eventId, name: eventName, tracked: Date.now() });
  }

  /**
   * Track a sponsor for cleanup
   */
  trackSponsor(sponsorId, sponsorName = null) {
    this.trackedSponsors.push({ id: sponsorId, name: sponsorName, tracked: Date.now() });
  }

  /**
   * Generate QA-prefixed event name
   */
  generateEventName(baseName = 'Event') {
    const timestamp = Date.now();
    return `${TEST_MARKERS.eventPrefix}${baseName}_${timestamp}`;
  }

  /**
   * Generate QA-prefixed sponsor name
   */
  generateSponsorName(baseName = 'Sponsor') {
    const timestamp = Date.now();
    return `${TEST_MARKERS.sessionPrefix}${this.sessionId}_${baseName}_${timestamp}`;
  }

  /**
   * Make API call to backend
   */
  async apiCall(endpoint, data = {}) {
    try {
      const response = await this.request.post(config.baseUrl, {
        data: {
          p: endpoint,
          brand: data.brand || process.env.QA_BRAND_ID || config.brandId,
          adminKey: config.adminKey,
          ...data,
        },
      });
      return await response.json();
    } catch (error) {
      console.warn(`API call failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Create a test event with automatic tracking
   */
  async createTrackedEvent(nameOrOptions = {}) {
    const options = typeof nameOrOptions === 'string'
      ? { name: nameOrOptions }
      : nameOrOptions;

    const eventName = options.name || this.generateEventName();
    const event = {
      name: eventName,
      startDateISO: options.date || this.getFutureDate(7),
      venue: options.venue || 'QA Test Venue',
      description: `${TEST_MARKERS.descriptionTag} ${options.description || 'Auto-generated test event'}`,
      _qaTestData: true,
      _sessionId: this.sessionId,
    };

    const response = await this.apiCall('saveEvent', {
      scope: 'events',
      event,
    });

    if (response.ok && response.value?.id) {
      this.trackEvent(response.value.id, eventName);
      return response.value;
    }

    throw new Error(`Failed to create event: ${response.message || 'Unknown error'}`);
  }

  /**
   * Get future date string
   */
  getFutureDate(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0];
  }

  /**
   * Cleanup all tracked resources
   */
  async cleanup() {
    const results = {
      events: { deleted: 0, failed: 0 },
      sponsors: { deleted: 0, failed: 0 },
      errors: [],
    };

    // Skip cleanup if no admin key
    if (!config.adminKey) {
      return results;
    }

    // Delete tracked events
    for (const event of this.trackedEvents) {
      try {
        const response = await this.apiCall('deleteEvent', {
          scope: 'events',
          id: event.id,
        });

        if (response.ok) {
          results.events.deleted++;
        } else {
          results.events.failed++;
          results.errors.push(`Event ${event.id}: ${response.message}`);
        }
      } catch (error) {
        results.events.failed++;
        results.errors.push(`Event ${event.id}: ${error.message}`);
      }
    }

    // Delete tracked sponsors
    for (const sponsor of this.trackedSponsors) {
      try {
        const response = await this.apiCall('deleteSponsor', {
          scope: 'sponsors',
          id: sponsor.id,
        });

        if (response.ok) {
          results.sponsors.deleted++;
        } else {
          results.sponsors.failed++;
          results.errors.push(`Sponsor ${sponsor.id}: ${response.message}`);
        }
      } catch (error) {
        results.sponsors.failed++;
        results.errors.push(`Sponsor ${sponsor.id}: ${error.message}`);
      }
    }

    // Clear tracked resources
    this.trackedEvents = [];
    this.trackedSponsors = [];

    return results;
  }

  /**
   * Get cleanup summary
   */
  getSummary() {
    return {
      sessionId: this.sessionId,
      trackedEvents: this.trackedEvents.length,
      trackedSponsors: this.trackedSponsors.length,
    };
  }
}

/**
 * Extended test with cleanup fixture
 */
export const test = base.extend({
  /**
   * Test cleanup fixture
   * Automatically tracks and cleans up test data
   */
  testCleanup: async ({ request }, use, testInfo) => {
    const cleanup = new CleanupManager(request);

    // Run the test
    await use(cleanup);

    // After test: cleanup tracked resources
    const results = await cleanup.cleanup();

    // Log cleanup summary if there were tracked resources
    if (results.events.deleted > 0 || results.events.failed > 0 ||
        results.sponsors.deleted > 0 || results.sponsors.failed > 0) {
      console.log(`\nTest cleanup for "${testInfo.title}":`);
      console.log(`  Events: ${results.events.deleted} deleted, ${results.events.failed} failed`);
      console.log(`  Sponsors: ${results.sponsors.deleted} deleted, ${results.sponsors.failed} failed`);

      if (results.errors.length > 0) {
        console.log('  Errors:');
        results.errors.forEach(e => console.log(`    - ${e}`));
      }
    }
  },

  /**
   * Test data helper fixture
   * Provides convenient test data generation
   */
  testData: async (_, use) => {
    const helpers = {
      /**
       * Generate unique test event name
       */
      eventName(base = 'Event') {
        return `${TEST_MARKERS.eventPrefix}${base}_${Date.now()}`;
      },

      /**
       * Generate unique test sponsor name
       */
      sponsorName(base = 'Sponsor') {
        return `${TEST_MARKERS.eventPrefix}${base}_${Date.now()}`;
      },

      /**
       * Get test event data with QA markers
       */
      event(overrides = {}) {
        return {
          name: this.eventName(overrides.baseName),
          startDateISO: overrides.date || this.futureDate(7),
          venue: overrides.venue || 'QA Test Venue',
          description: `${TEST_MARKERS.descriptionTag} ${overrides.description || 'Test event'}`,
          _qaTestData: true,
          ...overrides,
        };
      },

      /**
       * Get future date string
       */
      futureDate(daysFromNow = 7) {
        const date = new Date();
        date.setDate(date.getDate() + daysFromNow);
        return date.toISOString().split('T')[0];
      },

      /**
       * Get past date string
       */
      pastDate(daysAgo = 7) {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        return date.toISOString().split('T')[0];
      },

      /**
       * Session ID for current test run
       */
      sessionId: process.env.TEST_SESSION_ID || 'unknown',

      /**
       * Test markers
       */
      markers: TEST_MARKERS,
    };

    await use(helpers);
  },
});

export { expect };

/**
 * Export test markers for use in other modules
 */
export { TEST_MARKERS };
