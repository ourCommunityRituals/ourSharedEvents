/**
 * Multi-brand API Tests - Playwright
 * Ensures brand isolation and cross-brand security
 */

import { test, expect } from '@playwright/test';
import { ApiHelpers, EventBuilder } from './api-helpers.js';
import { getCurrentEnvironment } from '../../config/environments.js';

const BRANDS = ['root', 'abc', 'cbc', 'cbl'];

test.describe('Multi-brand APIs', () => {
  let api;
  let adminKey;

  test.beforeEach(async ({ request }) => {
    const env = getCurrentEnvironment();
    api = new ApiHelpers(request, env.baseUrl);
    adminKey = process.env.ADMIN_KEY;

    if (!adminKey) {
      test.skip('ADMIN_KEY not set');
    }
  });

  test.describe('Brand Isolation', () => {
    const createdEventIds = {};

    test.beforeAll(async ({ request }) => {
      // Create one event per brand
      const env = getCurrentEnvironment();
      const setupApi = new ApiHelpers(request, env.baseUrl);

      for (const brand of BRANDS) {
        const { eventId } = await setupApi.createTestEvent(brand, process.env.ADMIN_KEY, {
          name: `${brand.toUpperCase()} Isolation Test`
        });
        createdEventIds[brand] = eventId;
      }
    });

    test.afterAll(async ({ request }) => {
      // Clean up
      const env = getCurrentEnvironment();
      const cleanupApi = new ApiHelpers(request, env.baseUrl);

      for (const brand of BRANDS) {
        const eventId = createdEventIds[brand];
        if (eventId) {
          try {
            await cleanupApi.deleteEvent(brand, eventId, adminKey);
          } catch (error) {
            console.warn(`Failed to cleanup ${brand}:${eventId}`);
          }
        }
      }
    });

    test('each brand can only see their own events', async () => {
      for (const brand of BRANDS) {
        const response = await api.listEvents(brand);
        const data = await response.json();

        expect(data.ok).toBe(true);

        const events = data.value;
        const ownEvent = events.find(e => e.id === createdEventIds[brand]);

        // Should find own event
        expect(ownEvent).toBeDefined();
        expect(ownEvent.name).toContain(brand.toUpperCase());

        // Should NOT find other brands' events
        for (const otherBrand of BRANDS) {
          if (otherBrand === brand) continue;

          const otherEvent = events.find(e => e.id === createdEventIds[otherBrand]);
          expect(otherEvent).toBeUndefined();
        }
      }
    });

    test('cannot access another brand\'s event directly', async () => {
      // Try to access root's event from abc brand
      const rootEventId = createdEventIds['root'];

      const response = await api.getEvent('abc', rootEventId);

      // Should either return 404 or ok:false
      if (response.status() === 404) {
        expect(response.ok()).toBe(false);
      } else {
        const data = await response.json();
        expect(data.ok).toBe(false);
      }
    });

    test('cannot update another brand\'s event', async () => {
      const rootEventId = createdEventIds['root'];

      // Try to update root's event from abc brand
      const response = await api.post('?action=update', {
        brandId: 'abc',
        scope: 'events',
        id: rootEventId,
        adminKey,
        data: { name: 'Hacked Name' }
      });

      // Should fail
      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }

      // Verify root event unchanged
      const getResponse = await api.getEvent('root', rootEventId);
      const getData = await getResponse.json();

      expect(getData.value.name).toContain('ROOT');
      expect(getData.value.name).not.toContain('Hacked');
    });

    test('cannot delete another brand\'s event', async () => {
      const rootEventId = createdEventIds['root'];

      // Try to delete root's event from abc brand
      const response = await api.post('?action=delete', {
        brandId: 'abc',
        scope: 'events',
        id: rootEventId,
        adminKey
      });

      // Should fail
      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }

      // Verify root event still exists
      const getResponse = await api.getEvent('root', rootEventId);
      const getData = await getResponse.json();

      expect(getData.ok).toBe(true);
      expect(getData.value).toBeDefined();
    });
  });

  test.describe('Brand Status', () => {
    test('all brands return valid status', async () => {
      for (const brand of BRANDS) {
        const response = await api.getStatus(brand);
        const data = await response.json();

        expect(response.ok()).toBe(true);
        expect(data.ok).toBe(true);
        expect(data.value.brand).toBe(brand);
      }
    });

    test('brands have correct configuration', async () => {
      const brandConfigs = {
        root: 'Zeventbook',
        abc: 'American Bocce Co.',
        cbc: 'Chicago Bocce Club',
        cbl: 'Chicago Bocce League'
      };

      for (const brand of BRANDS) {
        const response = await api.getStatus(brand);
        const data = await response.json();

        expect(data.value.brand).toBe(brand);
        // Could verify brand name if returned in status
      }
    });
  });

  test.describe('Concurrent Multi-brand Operations', () => {
    test('handles concurrent requests across brands', async () => {
      // Fire concurrent requests to all brands
      const promises = BRANDS.map(brand =>
        api.getStatus(brand)
      );

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach((response, index) => {
        expect(response.ok()).toBe(true);
      });

      // Verify each returned correct brand
      for (let i = 0; i < responses.length; i++) {
        const data = await responses[i].json();
        expect(data.value.brand).toBe(BRANDS[i]);
      }
    });

    test('handles concurrent event creation across brands', async () => {
      const createdIds = [];

      try {
        // Create events concurrently for all brands
        const promises = BRANDS.map(brand =>
          api.createTestEvent(brand, adminKey, {
            name: `${brand} Concurrent Test`
          })
        );

        const results = await Promise.all(promises);

        // All should succeed
        results.forEach((result, index) => {
          expect(result.data.ok).toBe(true);
          expect(result.eventId).toBeDefined();
          createdIds.push({ brand: BRANDS[index], eventId: result.eventId });
        });

        // Verify isolation - each brand should only see their own
        for (const { brand, eventId } of createdIds) {
          const response = await api.listEvents(brand);
          const data = await response.json();

          const ownEvent = data.value.find(e => e.id === eventId);
          expect(ownEvent).toBeDefined();

          // Should not see other brands' events
          for (const { brand: otherBrand, eventId: otherEventId } of createdIds) {
            if (brand === otherBrand) continue;

            const otherEvent = data.value.find(e => e.id === otherEventId);
            expect(otherEvent).toBeUndefined();
          }
        }
      } finally {
        // Cleanup
        for (const { brand, eventId } of createdIds) {
          try {
            await api.deleteEvent(brand, eventId, adminKey);
          } catch (error) {
            console.warn(`Failed to cleanup ${brand}:${eventId}`);
          }
        }
      }
    });
  });

  test.describe('Brand Scopes', () => {
    test('all brands support events scope', async () => {
      for (const brand of BRANDS) {
        const response = await api.listEvents(brand);
        const data = await response.json();

        expect(response.ok()).toBe(true);
        expect(data.ok).toBe(true);
        expect(data.value).toBeInstanceOf(Array);
      }
    });

    test('all brands support sponsors scope', async () => {
      for (const brand of BRANDS) {
        const response = await api.listSponsors(brand);
        const data = await response.json();

        expect(response.ok()).toBe(true);
        expect(data.ok).toBe(true);
        expect(data.value).toBeInstanceOf(Array);
      }
    });
  });

  test.describe('Brand Data Integrity', () => {
    test('event IDs are unique across brands', async () => {
      const createdIds = [];

      try {
        // Create events in all brands
        for (const brand of BRANDS) {
          const { eventId } = await api.createTestEvent(brand, adminKey);
          createdIds.push({ brand, eventId });
        }

        // Verify all IDs are unique
        const ids = createdIds.map(item => item.eventId);
        const uniqueIds = new Set(ids);

        expect(uniqueIds.size).toBe(ids.length);
      } finally {
        // Cleanup
        for (const { brand, eventId } of createdIds) {
          try {
            await api.deleteEvent(brand, eventId, adminKey);
          } catch (error) {
            console.warn(`Failed to cleanup ${brand}:${eventId}`);
          }
        }
      }
    });

    test('brand data persists independently', async () => {
      const createdIds = [];

      try {
        // Create event in root
        const { eventId: rootEventId } = await api.createTestEvent('root', adminKey, {
          name: 'Root Persistence Test'
        });
        createdIds.push({ brand: 'root', eventId: rootEventId });

        // Create event in abc
        const { eventId: abcEventId } = await api.createTestEvent('abc', adminKey, {
          name: 'ABC Persistence Test'
        });
        createdIds.push({ brand: 'abc', eventId: abcEventId });

        // Delete root event
        await api.deleteEvent('root', rootEventId, adminKey);

        // Verify abc event still exists
        const abcResponse = await api.getEvent('abc', abcEventId);
        const abcData = await abcResponse.json();

        expect(abcData.ok).toBe(true);
        expect(abcData.value).toBeDefined();

        // Verify root event is gone
        const rootResponse = await api.getEvent('root', rootEventId);

        if (rootResponse.status() === 404) {
          expect(rootResponse.ok()).toBe(false);
        } else {
          const rootData = await rootResponse.json();
          expect(rootData.ok).toBe(false);
        }

        // Clean up abc event
        await api.deleteEvent('abc', abcEventId, adminKey);
      } catch (error) {
        // Cleanup on error
        for (const { brand, eventId } of createdIds) {
          try {
            await api.deleteEvent(brand, eventId, adminKey);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
        }
        throw error;
      }
    });
  });
});
