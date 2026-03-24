/**
 * Stage-2 API Smoke Test: Status Endpoints
 *
 * Validates that status endpoints return correct shape per v4.1.2 contract.
 * These are FLAT endpoints (no envelope wrapper).
 *
 * Contract: schemas/status.schema.json, schemas/status-mvp.schema.json
 *
 * @see API_CONTRACT.md - Flat Endpoints section
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('Status API Smoke Tests', () => {

  test.describe('api_statusPure - System Status', () => {

    test('returns HTTP 200', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON with required keys', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);
      expect(response.ok()).toBe(true);

      const json = await response.json();

      // Flat format validation (status.schema.json)
      // Required: ok, buildId, brandId, time
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');

      expect(json).toHaveProperty('buildId');
      expect(typeof json.buildId).toBe('string');
      expect(json.buildId.length).toBeGreaterThan(0);

      expect(json).toHaveProperty('brandId');
      expect(typeof json.brandId).toBe('string');
      expect(json.brandId).toBe(BRAND);

      expect(json).toHaveProperty('time');
      expect(typeof json.time).toBe('string');
      // ISO 8601 format validation
      expect(json.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('does NOT have envelope wrapper (flat format)', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);
      const json = await response.json();

      // Flat responses must NOT have 'value' wrapper
      expect(json).not.toHaveProperty('value');

      // Must NOT have error envelope fields when ok=true
      if (json.ok === true) {
        expect(json).not.toHaveProperty('code');
      }
    });

    test('optional db field has correct structure when present', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);
      const json = await response.json();

      if (json.db !== undefined) {
        expect(json.db).toHaveProperty('ok');
        expect(typeof json.db.ok).toBe('boolean');
      }
    });

  });

  test.describe('api_statusMvp - MVP Analytics Status', () => {

    test('returns HTTP 200', async ({ request }) => {
      const response = await request.get(`/statusmvp?brand=${BRAND}`);
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON with MVP-specific keys', async ({ request }) => {
      const response = await request.get(`/statusmvp?brand=${BRAND}`);
      expect(response.ok()).toBe(true);

      const json = await response.json();

      // Flat format validation (status-mvp.schema.json)
      // Required: ok, buildId, brandId, time, analyticsSheetHealthy, sharedAnalyticsContractOk
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');

      expect(json).toHaveProperty('buildId');
      expect(typeof json.buildId).toBe('string');

      expect(json).toHaveProperty('brandId');
      expect(typeof json.brandId).toBe('string');

      expect(json).toHaveProperty('time');
      expect(typeof json.time).toBe('string');

      // MVP-specific fields
      expect(json).toHaveProperty('analyticsSheetHealthy');
      expect(typeof json.analyticsSheetHealthy).toBe('boolean');

      expect(json).toHaveProperty('sharedAnalyticsContractOk');
      expect(typeof json.sharedAnalyticsContractOk).toBe('boolean');
    });

    test('does NOT have envelope wrapper (flat format)', async ({ request }) => {
      const response = await request.get(`/statusmvp?brand=${BRAND}`);
      const json = await response.json();

      // Flat responses must NOT have 'value' wrapper
      expect(json).not.toHaveProperty('value');
    });

  });

  test.describe('Contract Compliance', () => {

    test('buildId matches expected pattern', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);
      const json = await response.json();

      // buildId pattern: ^[a-zA-Z0-9._-]+$
      expect(json.buildId).toMatch(/^[a-zA-Z0-9._-]+$/);
      expect(json.buildId.length).toBeLessThanOrEqual(64);
    });

    test('brandId matches expected pattern', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);
      const json = await response.json();

      // brandId pattern: ^[a-z0-9_-]+$
      expect(json.brandId).toMatch(/^[a-z0-9_-]+$/);
      expect(json.brandId.length).toBeLessThanOrEqual(32);
    });

    test('time is valid ISO 8601 datetime', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);
      const json = await response.json();

      // Should be parseable as a date
      const date = new Date(json.time);
      expect(date.toString()).not.toBe('Invalid Date');

      // Should be recent (within last hour)
      const now = Date.now();
      const responseTime = date.getTime();
      expect(Math.abs(now - responseTime)).toBeLessThan(3600000); // 1 hour
    });

  });

});
