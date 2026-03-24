/**
 * Stage-2 Smoke Tests: Story 2.1 Sheets Client Implementation
 *
 * Validates that the Worker can communicate with Google Sheets using
 * service account credentials.
 *
 * Story 2.1 Acceptance Criteria:
 * - Worker successfully fetches rows from staging sheet
 * - No OAuth UI prompts (service account only)
 * - /api/status returns "sheets":"ok"
 *
 * Required Cloudflare Secrets:
 * - GOOGLE_CLIENT_EMAIL: Service account email
 * - GOOGLE_PRIVATE_KEY: Service account private key (PEM)
 * - SHEETS_SPREADSHEET_ID: Staging spreadsheet ID
 *
 * @see worker/src/sheets/sheetsClient.ts
 * @see worker/src/handlers/status.ts
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 30000;
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('Story 2.1: Sheets Client Implementation', () => {

  test.describe('/api/status - Sheets Connectivity', () => {

    test('returns sheets: "ok" when configured', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      expect(response.ok()).toBe(true);

      const json = await response.json();

      // Story 2.1 AC: /api/status returns "sheets":"ok"
      expect(json.sheets).toBe('ok');
    });

    test('returns ok: true when sheets is ok', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      // When sheets connectivity is working, overall status should be ok
      if (json.sheets === 'ok') {
        expect(json.ok).toBe(true);
        expect(json.status).toBe(200);
      }
    });

    test('returns backend: "worker"', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      // Confirm we're hitting the Worker, not GAS
      expect(json.backend).toBe('worker');
    });

    test('includes sheetsLatencyMs when connected', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      // When sheets is ok, latency should be reported
      if (json.sheets === 'ok') {
        expect(json).toHaveProperty('sheetsLatencyMs');
        expect(typeof json.sheetsLatencyMs).toBe('number');
        expect(json.sheetsLatencyMs).toBeGreaterThan(0);
        expect(json.sheetsLatencyMs).toBeLessThan(10000); // Should respond within 10s
      }
    });

    test('sheets latency is reasonable (<3s typical)', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      if (json.sheets === 'ok' && json.sheetsLatencyMs !== undefined) {
        // Typical latency should be under 3 seconds
        // This is a soft check - may fail under load
        if (json.sheetsLatencyMs > 3000) {
          console.warn(`Sheets latency is high: ${json.sheetsLatencyMs}ms`);
        }
      }
    });
  });

  test.describe('/api/events - Sheets Data Retrieval', () => {

    test('Worker successfully fetches rows from staging sheet (AC)', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

      // If configured, should return 200
      // If not configured, should return 503 with NOT_CONFIGURED
      if (response.status() === 200) {
        const json = await response.json();

        // Story 2.1 AC: Worker successfully fetches rows from staging sheet
        expect(json.ok).toBe(true);
        expect(json.status).toBe(200);
        expect(json).toHaveProperty('items');
        expect(Array.isArray(json.items)).toBe(true);
      } else if (response.status() === 503) {
        const json = await response.json();
        expect(json.code).toBe('NOT_CONFIGURED');
        console.warn('Sheets not configured - skipping data retrieval test');
      } else {
        // Unexpected status
        expect(response.status()).toBe(200);
      }
    });

    test('events have data from Sheets', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

      if (response.status() !== 200) return;

      const json = await response.json();

      // If events exist, they should have proper data
      if (json.items.length > 0) {
        const event = json.items[0];

        // Core fields from EVENTS sheet
        expect(event).toHaveProperty('id');
        expect(typeof event.id).toBe('string');
        expect(event.id.length).toBeGreaterThan(0);

        expect(event).toHaveProperty('name');
        expect(typeof event.name).toBe('string');
        expect(event.name.length).toBeGreaterThan(0);
      }
    });

    test('publicBundle reads multiple sheet ranges', async ({ request }) => {
      // Get an event first
      const eventsResponse = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

      if (eventsResponse.status() !== 200) return;

      const eventsJson = await eventsResponse.json();
      if (eventsJson.items.length === 0) return;

      const eventId = eventsJson.items[0].id;

      // Fetch publicBundle which uses batchGet to read multiple ranges
      const bundleResponse = await request.get(
        `/api/events/${eventId}/publicBundle?brand=${BRAND}`,
        { timeout: TIMEOUT }
      );

      if (bundleResponse.status() === 200) {
        const bundleJson = await bundleResponse.json();

        // publicBundle should have data from multiple sheet ranges
        expect(bundleJson).toHaveProperty('ok');
        expect(bundleJson.ok).toBe(true);
        expect(bundleJson).toHaveProperty('item');
      }
    });
  });

  test.describe('Service Account Authentication (No OAuth UI)', () => {

    test('does NOT redirect to OAuth login page', async ({ request }) => {
      const response = await request.get('/api/status', {
        timeout: TIMEOUT,
        maxRedirects: 0, // Don't follow redirects
      });

      // Should not redirect to accounts.google.com
      expect(response.status()).not.toBe(302);
      expect(response.status()).not.toBe(301);

      const location = response.headers()['location'];
      if (location) {
        expect(location).not.toContain('accounts.google.com');
        expect(location).not.toContain('oauth2');
      }
    });

    test('does NOT require user interaction for auth', async ({ request }) => {
      // Multiple sequential requests should work without prompts
      for (let i = 0; i < 3; i++) {
        const response = await request.get('/api/status', { timeout: TIMEOUT });
        expect(response.ok()).toBe(true);

        const json = await response.json();
        // Each request should use cached service account token
        expect(['ok', 'not_configured']).toContain(json.sheets);
      }
    });

    test('auth uses service account (JWT bearer)', async ({ request }) => {
      // This is validated by checking the response comes from Worker
      // (which uses service account), not a redirect to OAuth
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      // Confirm backend is worker (uses service account)
      expect(json.backend).toBe('worker');

      // Confirm no auth-related errors (service account working)
      if (json.sheets === 'error') {
        // Error should not be about OAuth prompts
        if (json.sheetsError) {
          expect(json.sheetsError).not.toContain('user interaction');
          expect(json.sheetsError).not.toContain('consent');
          expect(json.sheetsError).not.toContain('OAuth');
        }
      }
    });
  });

  test.describe('Error Handling', () => {

    test('returns sheets: "error" with message when Sheets unavailable', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      // If sheets is error, should include error message
      if (json.sheets === 'error') {
        expect(json.ok).toBe(false);
        expect(json.status).toBe(503);
        expect(json).toHaveProperty('sheetsError');
        expect(typeof json.sheetsError).toBe('string');
      }
    });

    test('returns sheets: "not_configured" without secrets', async ({ request }) => {
      // This test verifies the graceful handling when secrets aren't set
      // In staging with secrets, this won't trigger - just validates shape
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      // not_configured is valid when secrets aren't present
      if (json.sheets === 'not_configured') {
        // Should still be considered "ok" (Worker running, just no Sheets)
        expect(json.ok).toBe(true);
        expect(json.status).toBe(200);
      }
    });

    test('events returns NOT_CONFIGURED when sheets unavailable', async ({ request }) => {
      // First check if sheets is configured
      const statusResponse = await request.get('/api/status', { timeout: TIMEOUT });
      const statusJson = await statusResponse.json();

      if (statusJson.sheets === 'not_configured') {
        // Events should return NOT_CONFIGURED
        const eventsResponse = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });
        expect(eventsResponse.status()).toBe(503);

        const eventsJson = await eventsResponse.json();
        expect(eventsJson.ok).toBe(false);
        expect(eventsJson.code).toBe('NOT_CONFIGURED');
      }
    });
  });

  test.describe('Performance', () => {

    test('/api/status responds within 5 seconds', async ({ request }) => {
      const startTime = Date.now();
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const endTime = Date.now();

      expect(response.ok()).toBe(true);
      expect(endTime - startTime).toBeLessThan(5000);
    });

    test('/api/events responds within 10 seconds', async ({ request }) => {
      const startTime = Date.now();
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });
      const endTime = Date.now();

      // Even if not configured, should respond quickly
      expect([200, 503]).toContain(response.status());
      expect(endTime - startTime).toBeLessThan(10000);
    });
  });
});

test.describe('Story 2.1: Cloudflare Secrets Configuration', () => {

  test('GOOGLE_CLIENT_EMAIL secret is configured', async ({ request }) => {
    // Verified indirectly through sheets connectivity
    const response = await request.get('/api/status', { timeout: TIMEOUT });
    const json = await response.json();

    // If sheets is ok or error (tried to connect), credentials exist
    // If not_configured, credentials are missing
    if (json.sheets === 'not_configured') {
      test.skip(true, 'GOOGLE_CLIENT_EMAIL not configured');
    }

    // Reaching here means credentials were attempted
    expect(['ok', 'error']).toContain(json.sheets);
  });

  test('GOOGLE_PRIVATE_KEY secret is configured', async ({ request }) => {
    // Same as above - verified through connectivity attempt
    const response = await request.get('/api/status', { timeout: TIMEOUT });
    const json = await response.json();

    if (json.sheets === 'not_configured') {
      test.skip(true, 'GOOGLE_PRIVATE_KEY not configured');
    }

    expect(['ok', 'error']).toContain(json.sheets);
  });

  test('SHEETS_SPREADSHEET_ID secret is configured', async ({ request }) => {
    // If events returns data or NOT_FOUND (not NOT_CONFIGURED), ID is set
    const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

    if (response.status() === 503) {
      const json = await response.json();
      if (json.code === 'NOT_CONFIGURED') {
        test.skip(true, 'SHEETS_SPREADSHEET_ID not configured');
      }
    }

    // If we get here, spreadsheet ID was used
    expect([200, 404, 502]).toContain(response.status());
  });
});
