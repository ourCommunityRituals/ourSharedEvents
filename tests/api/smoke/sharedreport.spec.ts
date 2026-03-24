/**
 * Stage-2 API Smoke Test: SharedReport / Analytics Endpoints
 *
 * Validates that shared analytics endpoints return correct shape per v4.1.2 contract.
 * These are ENVELOPE endpoints (Ok/Err wrapper).
 *
 * Contract: schemas/shared-analytics.schema.json
 *
 * @see API_CONTRACT.md - Analytics Endpoints section
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('SharedReport API Smoke Tests', () => {

  test.describe('api_getSharedAnalytics - Shared Analytics', () => {

    test('returns HTTP 200', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      expect(response.status()).toBe(200);
    });

    test('returns valid envelope wrapper', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      // Envelope format validation
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');

      if (json.ok === true) {
        if (!json.notModified) {
          expect(json).toHaveProperty('value');
        }
      } else {
        expect(json).toHaveProperty('code');
        expect(json).toHaveProperty('message');
      }
    });

    test('value contains required lastUpdatedISO field', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('lastUpdatedISO');
        expect(typeof json.value.lastUpdatedISO).toBe('string');

        // Validate ISO 8601 format
        expect(json.value.lastUpdatedISO).toMatch(/^\d{4}-\d{2}-\d{2}/);
      }
    });

    test('value contains required summary object', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('summary');
        expect(typeof json.value.summary).toBe('object');

        const summary = json.value.summary;

        // shared-analytics.schema.json required summary fields
        expect(summary).toHaveProperty('totalImpressions');
        expect(typeof summary.totalImpressions).toBe('number');
        expect(summary.totalImpressions).toBeGreaterThanOrEqual(0);

        expect(summary).toHaveProperty('totalClicks');
        expect(typeof summary.totalClicks).toBe('number');
        expect(summary.totalClicks).toBeGreaterThanOrEqual(0);

        expect(summary).toHaveProperty('totalQrScans');
        expect(typeof summary.totalQrScans).toBe('number');
        expect(summary.totalQrScans).toBeGreaterThanOrEqual(0);

        expect(summary).toHaveProperty('totalSignups');
        expect(typeof summary.totalSignups).toBe('number');
        expect(summary.totalSignups).toBeGreaterThanOrEqual(0);

        expect(summary).toHaveProperty('uniqueEvents');
        expect(typeof summary.uniqueEvents).toBe('number');
        expect(summary.uniqueEvents).toBeGreaterThanOrEqual(0);

        expect(summary).toHaveProperty('uniqueSponsors');
        expect(typeof summary.uniqueSponsors).toBe('number');
        expect(summary.uniqueSponsors).toBeGreaterThanOrEqual(0);
      }
    });

    test('value contains required surfaces array', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('surfaces');
        expect(Array.isArray(json.value.surfaces)).toBe(true);
      }
    });

    test('surfaces have required fields', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value && json.value.surfaces.length > 0) {
        const surface = json.value.surfaces[0];

        // SurfaceMetrics required fields
        expect(surface).toHaveProperty('id');
        expect(typeof surface.id).toBe('string');
        // Valid surface IDs: poster, display, public, signup
        expect(['poster', 'display', 'public', 'signup']).toContain(surface.id);

        expect(surface).toHaveProperty('label');
        expect(typeof surface.label).toBe('string');

        expect(surface).toHaveProperty('impressions');
        expect(typeof surface.impressions).toBe('number');
        expect(surface.impressions).toBeGreaterThanOrEqual(0);

        expect(surface).toHaveProperty('clicks');
        expect(typeof surface.clicks).toBe('number');
        expect(surface.clicks).toBeGreaterThanOrEqual(0);

        expect(surface).toHaveProperty('qrScans');
        expect(typeof surface.qrScans).toBe('number');
        expect(surface.qrScans).toBeGreaterThanOrEqual(0);
      }
    });

    test('topSponsors have required fields when present', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value && json.value.topSponsors && json.value.topSponsors.length > 0) {
        const sponsor = json.value.topSponsors[0];

        // SponsorMetrics required fields
        expect(sponsor).toHaveProperty('id');
        expect(typeof sponsor.id).toBe('string');

        expect(sponsor).toHaveProperty('name');
        expect(typeof sponsor.name).toBe('string');

        expect(sponsor).toHaveProperty('impressions');
        expect(typeof sponsor.impressions).toBe('number');
        expect(sponsor.impressions).toBeGreaterThanOrEqual(0);

        expect(sponsor).toHaveProperty('clicks');
        expect(typeof sponsor.clicks).toBe('number');
        expect(sponsor.clicks).toBeGreaterThanOrEqual(0);

        expect(sponsor).toHaveProperty('ctr');
        expect(typeof sponsor.ctr).toBe('number');
        expect(sponsor.ctr).toBeGreaterThanOrEqual(0);
      }
    });

    test('topSponsors array has max 3 items', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value && json.value.topSponsors) {
        // maxItems: 3 per schema
        expect(json.value.topSponsors.length).toBeLessThanOrEqual(3);
      }
    });

  });

  test.describe('api_getSharedReportBundle - Report Bundle', () => {

    test('returns HTTP 200', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedReportBundle&brand=${BRAND}`);
      expect(response.status()).toBe(200);
    });

    test('returns valid envelope with report data', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedReportBundle&brand=${BRAND}`);
      const json = await response.json();

      expect(json).toHaveProperty('ok');

      if (json.ok && json.value) {
        // Bundle should contain analytics data
        expect(json.value).toHaveProperty('analytics');

        if (json.value.analytics) {
          // Analytics should have summary
          expect(json.value.analytics).toHaveProperty('summary');
        }
      }
    });

  });

  test.describe('Contract Compliance', () => {

    test('lastUpdatedISO is valid ISO 8601 datetime', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value && json.value.lastUpdatedISO) {
        // Should be parseable as a date
        const date = new Date(json.value.lastUpdatedISO);
        expect(date.toString()).not.toBe('Invalid Date');
      }
    });

    test('numeric metrics are non-negative integers', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value && json.value.summary) {
        const metrics = [
          'totalImpressions',
          'totalClicks',
          'totalQrScans',
          'totalSignups',
          'uniqueEvents',
          'uniqueSponsors'
        ];

        for (const metric of metrics) {
          const value = json.value.summary[metric];
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('CTR values are valid percentages', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`);
      const json = await response.json();

      if (json.ok && json.value) {
        // Check surfaces engagementRate
        if (json.value.surfaces) {
          for (const surface of json.value.surfaces) {
            if (surface.engagementRate !== null && surface.engagementRate !== undefined) {
              expect(typeof surface.engagementRate).toBe('number');
              expect(surface.engagementRate).toBeGreaterThanOrEqual(0);
              // CTR/engagement can exceed 100% in edge cases but should be reasonable
              expect(surface.engagementRate).toBeLessThan(1000);
            }
          }
        }

        // Check sponsors CTR
        if (json.value.sponsors) {
          for (const sponsor of json.value.sponsors) {
            expect(typeof sponsor.ctr).toBe('number');
            expect(sponsor.ctr).toBeGreaterThanOrEqual(0);
            expect(sponsor.ctr).toBeLessThan(1000);
          }
        }

        // Check topSponsors CTR
        if (json.value.topSponsors) {
          for (const sponsor of json.value.topSponsors) {
            expect(typeof sponsor.ctr).toBe('number');
            expect(sponsor.ctr).toBeGreaterThanOrEqual(0);
            expect(sponsor.ctr).toBeLessThan(1000);
          }
        }
      }
    });

  });

});
