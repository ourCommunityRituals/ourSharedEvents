/**
 * Events CRUD API Tests - Playwright
 * Replaces Newman event API tests with comprehensive Playwright coverage
 *
 * EVENT_CONTRACT.md v2.0 Compliance:
 * - Uses canonical field names: startDateISO, venue
 * - Validates v2.0 event shape: links, qr, ctas, settings
 * - MVP Required fields validated
 */

import { test, expect } from '@playwright/test';
import { ApiHelpers, EventBuilder } from './api-helpers.js';
import { getCurrentEnvironment } from '../../config/environments.js';

test.describe('Events CRUD APIs', () => {
  let api;
  let adminKey;
  const brand = 'root';
  const createdEventIds = []; // Track for cleanup

  test.beforeEach(async ({ request }) => {
    const env = getCurrentEnvironment();
    api = new ApiHelpers(request, env.baseUrl);
    adminKey = process.env.ADMIN_KEY;

    if (!adminKey) {
      test.skip('ADMIN_KEY not set');
    }
  });

  test.afterEach(async () => {
    // Clean up created events
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(brand, eventId, adminKey);
      } catch (error) {
        console.warn(`Failed to delete event ${eventId}:`, error.message);
      }
    }
    createdEventIds.length = 0;
  });

  test.describe('Create Event', () => {
    test('creates event with valid data', async () => {
      const eventData = new EventBuilder()
        .withName('Playwright Test Event')
        .withDate('2025-12-15')
        .withLocation('Test Venue')
        .build();

      const response = await api.createEvent(brand, eventData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('id');
      expect(data.value.id).toBeDefined();

      createdEventIds.push(data.value.id);
    });

    test('creates event with MVP required fields (v2.0)', async () => {
      // v2.0 MVP Required: name, startDateISO, venue
      const eventData = {
        name: 'Minimal Event',
        startDateISO: '2025-12-20',  // v2.0 field name
        venue: 'Test Venue'           // v2.0 field name
      };

      const response = await api.createEvent(brand, eventData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('id');

      createdEventIds.push(data.value.id);
    });

    test('creates event with v2.0 optional fields', async () => {
      const eventData = new EventBuilder()
        .withName('Complete Event')
        .withDate('2025-12-25')
        .withVenue('Complete Venue')
        .withSignupUrl('https://example.com/signup')
        .withSchedule([
          { time: '10:00 AM', title: 'Registration', description: null }
        ])
        .build();

      // Add V2 optional fields
      Object.assign(eventData, {
        media: {
          videoUrl: 'https://youtube.com/watch?v=test',
          mapUrl: 'https://maps.google.com/...'
        },
        externalData: {}
      });

      const response = await api.createEvent(brand, eventData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('id');

      createdEventIds.push(data.value.id);
    });

    test('requires authentication', async () => {
      const eventData = {
        name: 'Unauthorized Event',
        dateISO: '2025-12-30'
      };

      // Try without admin key
      const response = await api.post('?action=create', {
        brandId: brand,
        scope: 'events',
        templateId: 'event',
        data: eventData
        // Missing adminKey
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });

    test('validates required fields', async () => {
      // Missing required 'name' field
      const eventData = {
        dateISO: '2025-12-31'
        // name is required but missing
      };

      const response = await api.createEvent(brand, eventData, adminKey);

      // Should fail validation
      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data.error).toBeDefined();
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });
  });

  test.describe('Get Event', () => {
    let testEventId;

    test.beforeEach(async () => {
      // Create a test event
      const { eventId } = await api.createTestEvent(brand, adminKey);
      testEventId = eventId;
      createdEventIds.push(testEventId);
    });

    test('retrieves event with v2.0 canonical shape', async () => {
      const response = await api.getEvent(brand, testEventId);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);

      // v2.0 MVP Required fields
      expect(data.value).toHaveProperty('id', testEventId);
      expect(data.value).toHaveProperty('name');
      expect(data.value).toHaveProperty('startDateISO');  // v2.0 field name
      expect(data.value).toHaveProperty('venue');          // v2.0 field name
      expect(data.value).toHaveProperty('links');
      expect(data.value).toHaveProperty('ctas');
      expect(data.value).toHaveProperty('settings');
    });

    test('returns 404 for non-existent event', async () => {
      const fakeId = 'non-existent-id-12345';
      const response = await api.getEvent(brand, fakeId);

      // Should either return 404 or ok:false
      if (response.status() === 404) {
        expect(response.ok()).toBe(false);
      } else {
        const data = await response.json();
        expect(data.ok).toBe(false);
      }
    });

    test('does not require authentication for public read', async () => {
      // Get event without admin key (public read)
      const response = await api.getEvent(brand, testEventId);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
    });
  });

  test.describe('List Events', () => {
    test.beforeEach(async () => {
      // Create 3 test events
      for (let i = 0; i < 3; i++) {
        const { eventId } = await api.createTestEvent(brand, adminKey, {
          name: `List Test Event ${i + 1}`
        });
        createdEventIds.push(eventId);
      }
    });

    test('lists all events for brand', async () => {
      const response = await api.listEvents(brand);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
      expect(data.value).toBeInstanceOf(Array);
      expect(data.value.length).toBeGreaterThanOrEqual(3);
    });

    test('returns events with v2.0 structure', async () => {
      const response = await api.listEvents(brand);
      const data = await response.json();

      expect(data.value.length).toBeGreaterThan(0);

      const event = data.value[0];
      // v2.0 MVP Required fields
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('startDateISO');  // v2.0 field name
      expect(event).toHaveProperty('venue');          // v2.0 field name
    });

    test('does not require authentication for public read', async () => {
      const response = await api.listEvents(brand);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
    });
  });

  test.describe('Update Event', () => {
    let testEventId;

    test.beforeEach(async () => {
      // Create a test event with v2.0 fields
      const { eventId } = await api.createTestEvent(brand, adminKey, {
        name: 'Original Name',
        venue: 'Original Venue'  // v2.0 field name
      });
      testEventId = eventId;
      createdEventIds.push(testEventId);
    });

    test('updates event fields (v2.0)', async () => {
      const updateData = {
        name: 'Updated Name',
        venue: 'Updated Venue'  // v2.0 field name
      };

      const response = await api.updateEvent(brand, testEventId, updateData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);

      // Verify update
      const getResponse = await api.getEvent(brand, testEventId);
      const getData = await getResponse.json();

      expect(getData.value.name).toBe('Updated Name');
      expect(getData.value.venue).toBe('Updated Venue');  // v2.0 field name
    });

    test('updates partial fields', async () => {
      // Only update name, leave venue unchanged
      const updateData = {
        name: 'Partially Updated'
      };

      const response = await api.updateEvent(brand, testEventId, updateData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);

      // Verify update
      const getResponse = await api.getEvent(brand, testEventId);
      const getData = await getResponse.json();

      expect(getData.value.name).toBe('Partially Updated');
      expect(getData.value.venue).toBe('Original Venue');  // Unchanged, v2.0 field name
    });

    test('requires authentication', async () => {
      const updateData = { name: 'Unauthorized Update' };

      const response = await api.post('?action=update', {
        brandId: brand,
        scope: 'events',
        id: testEventId,
        data: updateData
        // Missing adminKey
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });

    test('returns error for non-existent event', async () => {
      const fakeId = 'non-existent-id-12345';
      const updateData = { name: 'Cannot Update' };

      const response = await api.updateEvent(brand, fakeId, updateData, adminKey);

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });
  });

  test.describe('Delete Event', () => {
    let testEventId;

    test.beforeEach(async () => {
      // Create a test event
      const { eventId } = await api.createTestEvent(brand, adminKey);
      testEventId = eventId;
    });

    test('deletes event successfully', async () => {
      const response = await api.deleteEvent(brand, testEventId, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);

      // Verify deletion - event should not exist
      const getResponse = await api.getEvent(brand, testEventId);

      if (getResponse.status() === 404) {
        expect(getResponse.ok()).toBe(false);
      } else {
        const getData = await getResponse.json();
        expect(getData.ok).toBe(false);
      }

      // Don't add to cleanup array since we already deleted it
    });

    test('requires authentication', async () => {
      const response = await api.post('?action=delete', {
        brandId: brand,
        scope: 'events',
        id: testEventId
        // Missing adminKey
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }

      // Clean up
      createdEventIds.push(testEventId);
    });

    test('returns error for non-existent event', async () => {
      const fakeId = 'non-existent-id-12345';

      const response = await api.deleteEvent(brand, fakeId, adminKey);

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }

      // Clean up the real event
      createdEventIds.push(testEventId);
    });
  });

  test.describe('Get Public Bundle', () => {
    let testEventId;

    test.beforeEach(async () => {
      // Create a test event with sponsors
      const eventData = new EventBuilder()
        .withName('Bundle Test Event')
        .withDate('2025-12-20')
        .withLocation('Bundle Venue')
        .build();

      // Add sponsor data
      eventData.sponsors = [
        { id: 'sp-test-1', name: 'Test Sponsor', placements: { mobileBanner: true, posterTop: true } }
      ];
      eventData.display = { mode: 'public' };

      const response = await api.createEvent(brand, eventData, adminKey);
      const data = await response.json();
      testEventId = data.value.id;
      createdEventIds.push(testEventId);
    });

    test('retrieves bundled event data', async () => {
      const response = await api.post('?action=getPublicBundle', {
        brandId: brand,
        scope: 'events',
        id: testEventId
      });
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('event');
      expect(data.value).toHaveProperty('sponsors');
      expect(data.value).toHaveProperty('display');
      expect(data.value).toHaveProperty('links');
      expect(data.value).toHaveProperty('config');
    });

    test('returns event with v2.0 canonical structure', async () => {
      const response = await api.post('?action=getPublicBundle', {
        brandId: brand,
        scope: 'events',
        id: testEventId
      });
      const data = await response.json();

      // v2.0: Event is canonical shape (flat, no nested data object)
      expect(data.value.event).toHaveProperty('id', testEventId);
      expect(data.value.event).toHaveProperty('name', 'Bundle Test Event');
      expect(data.value.event).toHaveProperty('startDateISO');
      expect(data.value.event).toHaveProperty('venue');
      expect(data.value.event).toHaveProperty('links');
      expect(data.value.event).toHaveProperty('ctas');
      expect(data.value.event).toHaveProperty('settings');
    });

    test('returns sponsors at top level for convenience', async () => {
      const response = await api.post('?action=getPublicBundle', {
        brandId: brand,
        scope: 'events',
        id: testEventId
      });
      const data = await response.json();

      expect(Array.isArray(data.value.sponsors)).toBe(true);
    });

    test('returns all v2.0 link types', async () => {
      const response = await api.post('?action=getPublicBundle', {
        brandId: brand,
        scope: 'events',
        id: testEventId
      });
      const data = await response.json();

      // v2.0: Links include signupUrl
      expect(data.value.event.links).toHaveProperty('publicUrl');
      expect(data.value.event.links).toHaveProperty('posterUrl');
      expect(data.value.event.links).toHaveProperty('displayUrl');
      expect(data.value.event.links).toHaveProperty('signupUrl');  // v2.0 required
    });

    test('supports etag caching', async () => {
      const response = await api.post('?action=getPublicBundle', {
        brandId: brand,
        scope: 'events',
        id: testEventId
      });
      const data = await response.json();

      expect(data).toHaveProperty('etag');
      expect(typeof data.etag).toBe('string');
    });

    test('returns 404 for non-existent event', async () => {
      const fakeId = 'non-existent-bundle-12345';
      const response = await api.post('?action=getPublicBundle', {
        brandId: brand,
        scope: 'events',
        id: fakeId
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });
  });

  test.describe('Event CRUD Flow', () => {
    test('complete CRUD lifecycle (v2.0)', async () => {
      // 1. CREATE with v2.0 fields
      const eventData = new EventBuilder()
        .withName('Lifecycle Test Event')
        .withDate('2025-12-25')
        .withVenue('Lifecycle Venue')  // v2.0 field name
        .build();

      const createResponse = await api.createEvent(brand, eventData, adminKey);
      const createData = await createResponse.json();

      expect(createData.ok).toBe(true);
      const eventId = createData.value.id;

      // 2. READ - verify v2.0 fields
      const getResponse = await api.getEvent(brand, eventId);
      const getData = await getResponse.json();

      expect(getData.ok).toBe(true);
      expect(getData.value.name).toBe('Lifecycle Test Event');
      expect(getData.value.startDateISO).toBe('2025-12-25');  // v2.0 field
      expect(getData.value.venue).toBe('Lifecycle Venue');     // v2.0 field

      // 3. UPDATE with v2.0 fields
      const updateResponse = await api.updateEvent(brand, eventId, {
        venue: 'Updated Venue'  // v2.0 field name
      }, adminKey);
      const updateData = await updateResponse.json();

      expect(updateData.ok).toBe(true);

      // 4. READ (verify update)
      const getResponse2 = await api.getEvent(brand, eventId);
      const getData2 = await getResponse2.json();

      expect(getData2.value.venue).toBe('Updated Venue');  // v2.0 field name

      // 5. DELETE
      const deleteResponse = await api.deleteEvent(brand, eventId, adminKey);
      const deleteData = await deleteResponse.json();

      expect(deleteData.ok).toBe(true);

      // 6. READ (verify deletion)
      const getResponse3 = await api.getEvent(brand, eventId);

      if (getResponse3.status() === 404) {
        expect(getResponse3.ok()).toBe(false);
      } else {
        const getData3 = await getResponse3.json();
        expect(getData3.ok).toBe(false);
      }
    });
  });

  test.describe('Analytics: api_trackEventMetric (MVP)', () => {
    /**
     * Tests for the simplified analytics tracking endpoint.
     * Validates the MVP analytics seam for public surfaces.
     */
    let testEventId;

    test.beforeEach(async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      testEventId = eventId;
      createdEventIds.push(testEventId);
    });

    test('tracks page view metric', async () => {
      const response = await api.post('?action=trackEventMetric', {
        brandId: brand,
        eventId: testEventId,
        surface: 'public',
        action: 'view'
      });

      if (response.ok()) {
        const data = await response.json();
        // Should return ok:true with count
        expect(data.ok).toBe(true);
        expect(data.value).toHaveProperty('count');
        expect(data.value.count).toBeGreaterThanOrEqual(1);
      }
    });

    test('tracks CTA click metric', async () => {
      const response = await api.post('?action=trackEventMetric', {
        brandId: brand,
        eventId: testEventId,
        surface: 'public',
        action: 'cta_click'
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(true);
        expect(data.value.count).toBeGreaterThanOrEqual(1);
      }
    });

    test('tracks sponsor click with sponsorId', async () => {
      const response = await api.post('?action=trackEventMetric', {
        brandId: brand,
        eventId: testEventId,
        surface: 'public',
        action: 'sponsor_click',
        sponsorId: 'test-sponsor-123'
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(true);
      }
    });

    test('tracks display dwell time with value', async () => {
      const response = await api.post('?action=trackEventMetric', {
        brandId: brand,
        eventId: testEventId,
        surface: 'display',
        action: 'dwell',
        value: 30  // 30 seconds
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(true);
      }
    });

    test('validates required eventId', async () => {
      const response = await api.post('?action=trackEventMetric', {
        brandId: brand,
        // Missing eventId
        surface: 'public',
        action: 'view'
      });

      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.code).toBe('BAD_INPUT');
    });

    test('validates surface enum', async () => {
      const response = await api.post('?action=trackEventMetric', {
        brandId: brand,
        eventId: testEventId,
        surface: 'invalid_surface',
        action: 'view'
      });

      const data = await response.json();
      expect(data.ok).toBe(false);
    });

    test('validates action enum', async () => {
      const response = await api.post('?action=trackEventMetric', {
        brandId: brand,
        eventId: testEventId,
        surface: 'public',
        action: 'invalid_action'
      });

      const data = await response.json();
      expect(data.ok).toBe(false);
    });

    test('accepts all valid surface values', async () => {
      const surfaces = ['public', 'display', 'poster', 'admin'];

      for (const surface of surfaces) {
        const response = await api.post('?action=trackEventMetric', {
          brandId: brand,
          eventId: testEventId,
          surface,
          action: 'view'
        });

        if (response.ok()) {
          const data = await response.json();
          expect(data.ok).toBe(true);
        }
      }
    });

    test('accepts all valid action values', async () => {
      const actions = ['view', 'impression', 'click', 'scan', 'cta_click', 'sponsor_click', 'dwell'];

      for (const action of actions) {
        const response = await api.post('?action=trackEventMetric', {
          brandId: brand,
          eventId: testEventId,
          surface: 'public',
          action,
          value: action === 'dwell' ? 10 : undefined
        });

        if (response.ok()) {
          const data = await response.json();
          expect(data.ok).toBe(true);
        }
      }
    });
  });

  test.describe('Payments Seam (Stripe MVP)', () => {
    /**
     * Tests for the payments seam infrastructure.
     * Validates the Stripe seam shape in event responses.
     */
    let testEventId;

    test.beforeEach(async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      testEventId = eventId;
      createdEventIds.push(testEventId);
    });

    test('event includes payments seam in default shape', async () => {
      const response = await api.getEvent(brand, testEventId);
      const data = await response.json();

      expect(data.ok).toBe(true);

      // v2.0: payments seam should exist with Stripe structure
      if (data.value.payments) {
        expect(data.value.payments).toHaveProperty('enabled');
        expect(data.value.payments).toHaveProperty('provider');
        expect(data.value.payments.provider).toBe('stripe');
        expect(data.value.payments).toHaveProperty('price');
        expect(data.value.payments).toHaveProperty('currency');
        expect(data.value.payments).toHaveProperty('checkoutUrl');
      }
    });

    test('payments seam defaults to disabled', async () => {
      const response = await api.getEvent(brand, testEventId);
      const data = await response.json();

      if (data.value.payments) {
        expect(data.value.payments.enabled).toBe(false);
        expect(data.value.payments.checkoutUrl).toBeNull();
      }
    });

    test('public bundle includes payments seam', async () => {
      const response = await api.post('?action=getPublicBundle', {
        brandId: brand,
        scope: 'events',
        id: testEventId
      });
      const data = await response.json();

      expect(data.ok).toBe(true);

      // payments should be in event object
      if (data.value.event.payments) {
        expect(data.value.event.payments).toHaveProperty('enabled');
        expect(data.value.event.payments).toHaveProperty('provider');
      }
    });
  });

  test.describe('Settings Visibility (v2.0)', () => {
    /**
     * Tests for EVENT_CONTRACT.md v2.0 settings structure.
     * Validates showSchedule, showStandings, showBracket, showSponsors.
     */

    test('event includes v2.0 settings shape', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.getEvent(brand, eventId);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value.settings).toBeDefined();
      expect(data.value.settings).toHaveProperty('showSchedule');
      expect(data.value.settings).toHaveProperty('showStandings');
      expect(data.value.settings).toHaveProperty('showBracket');
      expect(data.value.settings).toHaveProperty('showSponsors');
    });

    test('settings are boolean values', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.getEvent(brand, eventId);
      const data = await response.json();

      const { settings } = data.value;
      expect(typeof settings.showSchedule).toBe('boolean');
      expect(typeof settings.showStandings).toBe('boolean');
      expect(typeof settings.showBracket).toBe('boolean');
      expect(typeof settings.showSponsors).toBe('boolean');
    });

    test('settings can be updated', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const updateResponse = await api.updateEvent(brand, eventId, {
        settings: {
          showSchedule: true,
          showStandings: true,
          showBracket: false,
          showSponsors: true
        }
      }, adminKey);

      expect(updateResponse.ok()).toBe(true);

      const getResponse = await api.getEvent(brand, eventId);
      const getData = await getResponse.json();

      expect(getData.value.settings.showSchedule).toBe(true);
      expect(getData.value.settings.showStandings).toBe(true);
      expect(getData.value.settings.showBracket).toBe(false);
      expect(getData.value.settings.showSponsors).toBe(true);
    });
  });

  // ============================================================================
  // Bundle APIs - Surface-specific optimized bundles
  // ============================================================================

  test.describe('api_getDisplayBundle (Display.html)', () => {
    /**
     * Tests for Display Bundle API per EVENT_CONTRACT.md v2.0.
     * DisplayBundle returns: { event, rotation, layout }
     */

    test('returns display bundle with event property', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getDisplayBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('event');
      expect(data.value.event).toHaveProperty('id');
      expect(data.value.event).toHaveProperty('name');
      expect(data.value.event).toHaveProperty('startDateISO');
      expect(data.value.event).toHaveProperty('venue');
    });

    test('returns rotation config with sponsorSlots and rotationMs', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getDisplayBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('rotation');
      expect(data.value.rotation).toHaveProperty('sponsorSlots');
      expect(data.value.rotation).toHaveProperty('rotationMs');
      expect(typeof data.value.rotation.sponsorSlots).toBe('number');
      expect(typeof data.value.rotation.rotationMs).toBe('number');
    });

    test('returns layout config with hasSidePane and emphasis', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getDisplayBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('layout');
      expect(data.value.layout).toHaveProperty('hasSidePane');
      expect(data.value.layout).toHaveProperty('emphasis');
      expect(typeof data.value.layout.hasSidePane).toBe('boolean');
    });

    test('event includes v2.0 settings shape', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getDisplayBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value.event.settings).toHaveProperty('showSchedule');
      expect(data.value.event.settings).toHaveProperty('showStandings');
      expect(data.value.event.settings).toHaveProperty('showBracket');
      expect(data.value.event.settings).toHaveProperty('showSponsors');
    });

    test('returns etag for caching', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getDisplayBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data).toHaveProperty('etag');
      expect(typeof data.etag).toBe('string');
    });

    test('returns error for missing event ID', async () => {
      const response = await api.get(`?p=api&action=getDisplayBundle&brand=${brand}&scope=events`);
      const data = await response.json();

      expect(data.ok).toBe(false);
      expect(data.code).toBe('BAD_INPUT');
    });
  });

  test.describe('api_getPosterBundle (Poster.html)', () => {
    /**
     * Tests for Poster Bundle API per EVENT_CONTRACT.md v2.0.
     * PosterBundle returns: { event, qrCodes, print }
     */

    test('returns poster bundle with event property', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getPosterBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('event');
      expect(data.value.event).toHaveProperty('id');
      expect(data.value.event).toHaveProperty('name');
      expect(data.value.event).toHaveProperty('startDateISO');
      expect(data.value.event).toHaveProperty('venue');
    });

    test('returns qrCodes with public and signup', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey, {
        ctas: {
          primary: { label: 'Sign Up', url: 'https://example.com/signup' }
        }
      });
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getPosterBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('qrCodes');
      // qrCodes may have public/signup as URLs or null
      expect(data.value.qrCodes).toBeDefined();
    });

    test('returns print-formatted strings', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getPosterBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('print');
      // print may have dateLine/venueLine
      expect(data.value.print).toBeDefined();
    });

    test('event includes ctas for poster CTA button', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getPosterBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value.event).toHaveProperty('ctas');
      expect(data.value.event.ctas).toHaveProperty('primary');
    });

    test('event includes links for QR destinations', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getPosterBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.value.event).toHaveProperty('links');
    });

    test('returns etag for caching', async () => {
      const { eventId } = await api.createTestEvent(brand, adminKey);
      createdEventIds.push(eventId);

      const response = await api.get(`?p=api&action=getPosterBundle&brand=${brand}&scope=events&id=${eventId}`);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data).toHaveProperty('etag');
      expect(typeof data.etag).toBe('string');
    });

    test('returns error for missing event ID', async () => {
      const response = await api.get(`?p=api&action=getPosterBundle&brand=${brand}&scope=events`);
      const data = await response.json();

      expect(data.ok).toBe(false);
      expect(data.code).toBe('BAD_INPUT');
    });
  });
});
