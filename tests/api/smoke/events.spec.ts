/**
 * Stage-2 API Smoke Test: Events Endpoints
 *
 * Validates that events endpoints return correct shape per v4.1.2 contract.
 * These are ENVELOPE endpoints (Ok/Err wrapper).
 *
 * Contract: schemas/event.schema.json
 *
 * @see API_CONTRACT.md - Envelope Endpoints section
 * @see EVENT_CONTRACT.md - Event entity contract v1.0
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('Events API Smoke Tests', () => {

  test.describe('api_list - List Events', () => {

    test('returns HTTP 200', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      expect(response.status()).toBe(200);
    });

    test('returns valid envelope wrapper', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      expect(response.ok()).toBe(true);

      const json = await response.json();

      // Envelope format validation
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');

      if (json.ok === true) {
        // Success envelope must have 'value' (unless notModified)
        if (!json.notModified) {
          expect(json).toHaveProperty('value');
        }
      } else {
        // Error envelope must have code and message
        expect(json).toHaveProperty('code');
        expect(json).toHaveProperty('message');
      }
    });

    test('value contains items array', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('items');
        expect(Array.isArray(json.value.items)).toBe(true);
      }
    });

    test('events have required MVP fields per v1.0 contract', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        // event.schema.json required fields
        expect(event).toHaveProperty('id');
        expect(typeof event.id).toBe('string');

        expect(event).toHaveProperty('slug');
        expect(typeof event.slug).toBe('string');

        expect(event).toHaveProperty('name');
        expect(typeof event.name).toBe('string');

        expect(event).toHaveProperty('startDateISO');
        expect(typeof event.startDateISO).toBe('string');
        // YYYY-MM-DD format
        expect(event.startDateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        expect(event).toHaveProperty('venue');
        expect(typeof event.venue).toBe('string');
      }
    });

    test('events have required links object', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        expect(event).toHaveProperty('links');
        expect(typeof event.links).toBe('object');

        // Required link fields per event.schema.json
        expect(event.links).toHaveProperty('publicUrl');
        expect(event.links).toHaveProperty('displayUrl');
        expect(event.links).toHaveProperty('posterUrl');
        expect(event.links).toHaveProperty('signupUrl');
      }
    });

    test('events have required qr object', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        expect(event).toHaveProperty('qr');
        expect(typeof event.qr).toBe('object');

        // Required QR fields per event.schema.json
        expect(event.qr).toHaveProperty('public');
        expect(event.qr).toHaveProperty('signup');
      }
    });

    test('events have required ctas object', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        expect(event).toHaveProperty('ctas');
        expect(typeof event.ctas).toBe('object');

        // Required CTA fields per event.schema.json
        expect(event.ctas).toHaveProperty('primary');
        expect(event.ctas.primary).toHaveProperty('label');
        expect(event.ctas.primary).toHaveProperty('url');
      }
    });

    test('events have required settings object', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        expect(event).toHaveProperty('settings');
        expect(typeof event.settings).toBe('object');

        // Required settings fields per event.schema.json
        expect(event.settings).toHaveProperty('showSchedule');
        expect(event.settings).toHaveProperty('showStandings');
        expect(event.settings).toHaveProperty('showBracket');
      }
    });

    test('events have timestamps', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        expect(event).toHaveProperty('createdAtISO');
        expect(typeof event.createdAtISO).toBe('string');

        expect(event).toHaveProperty('updatedAtISO');
        expect(typeof event.updatedAtISO).toBe('string');
      }
    });

  });

  test.describe('api_getPublicBundle - Public Event Bundle', () => {

    test('returns HTTP 200 for valid event', async ({ request }) => {
      // First get an event ID from the list
      const listResponse = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const listJson = await listResponse.json();

      if (listJson.ok && listJson.value && listJson.value.items.length > 0) {
        const eventId = listJson.value.items[0].id;

        const response = await request.get(`/?p=api&action=getPublicBundle&brand=${BRAND}&eventId=${eventId}`);
        expect(response.status()).toBe(200);
      }
    });

    test('returns envelope with event and config', async ({ request }) => {
      const listResponse = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const listJson = await listResponse.json();

      if (listJson.ok && listJson.value && listJson.value.items.length > 0) {
        const eventId = listJson.value.items[0].id;

        const response = await request.get(`/?p=api&action=getPublicBundle&brand=${BRAND}&eventId=${eventId}`);
        const json = await response.json();

        expect(json).toHaveProperty('ok', true);
        expect(json).toHaveProperty('value');

        if (json.value) {
          // Bundle should contain event data
          expect(json.value).toHaveProperty('event');
        }
      }
    });

  });

  test.describe('Contract Compliance', () => {

    test('slug matches expected pattern', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        // slug pattern: ^[a-z0-9-]+$
        expect(event.slug).toMatch(/^[a-z0-9-]+$/);
        expect(event.slug.length).toBeLessThanOrEqual(128);
      }
    });

    test('id matches expected pattern', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        // id pattern: ^[a-zA-Z0-9_-]+$
        expect(event.id).toMatch(/^[a-zA-Z0-9_-]+$/);
        expect(event.id.length).toBeLessThanOrEqual(128);
      }
    });

    test('URLs are valid when present', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        // Check each link URL if non-empty
        for (const [key, url] of Object.entries(event.links)) {
          if (url && typeof url === 'string' && url.length > 0) {
            expect(url).toMatch(/^https?:\/\//);
          }
        }
      }
    });

  });

});
