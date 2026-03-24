/**
 * Stage-2 API Smoke Test: QR Code Endpoints
 *
 * Validates that QR code endpoints return valid PNG/SVG data.
 * Tests both embedded QR codes in events and dedicated QR endpoints.
 *
 * Contract: schemas/sponsor-report-qr.schema.json
 *
 * @see API_CONTRACT.md - QR Code section
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// PNG magic bytes (first 8 bytes of PNG file)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

test.describe('QR Code API Smoke Tests', () => {

  test.describe('Event QR Codes (embedded)', () => {

    test('events contain QR codes in correct format', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        expect(event).toHaveProperty('qr');
        expect(event.qr).toHaveProperty('public');
        expect(event.qr).toHaveProperty('signup');
      }
    });

    test('public QR code is valid base64 PNG', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        if (event.qr.public && event.qr.public.length > 0) {
          // QR codes should be data URIs or raw base64
          if (event.qr.public.startsWith('data:image/png;base64,')) {
            const base64Data = event.qr.public.replace('data:image/png;base64,', '');
            expect(base64Data.length).toBeGreaterThan(0);

            // Decode and check PNG magic bytes
            const buffer = Buffer.from(base64Data, 'base64');
            expect(buffer.length).toBeGreaterThan(8);
            expect(buffer.slice(0, 8).equals(PNG_MAGIC)).toBe(true);
          } else {
            // Raw base64 - check it's valid base64
            expect(() => Buffer.from(event.qr.public, 'base64')).not.toThrow();
          }
        }
      }
    });

    test('signup QR code is valid base64 PNG when present', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        if (event.qr.signup && event.qr.signup.length > 0) {
          // QR codes should be data URIs or raw base64
          if (event.qr.signup.startsWith('data:image/png;base64,')) {
            const base64Data = event.qr.signup.replace('data:image/png;base64,', '');
            expect(base64Data.length).toBeGreaterThan(0);

            // Decode and check PNG magic bytes
            const buffer = Buffer.from(base64Data, 'base64');
            expect(buffer.length).toBeGreaterThan(8);
            expect(buffer.slice(0, 8).equals(PNG_MAGIC)).toBe(true);
          } else {
            // Raw base64 - check it's valid base64
            expect(() => Buffer.from(event.qr.signup, 'base64')).not.toThrow();
          }
        }
      }
    });

  });

  test.describe('api_getSponsorReportQr - Sponsor Report QR', () => {

    test('returns HTTP 200 for valid sponsor', async ({ request }) => {
      // First get a sponsor ID from the list
      const listResponse = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=sponsors`);
      const listJson = await listResponse.json();

      if (listJson.ok && listJson.value && listJson.value.items && listJson.value.items.length > 0) {
        const sponsorId = listJson.value.items[0].id;

        const response = await request.post('/?action=getSponsorReportQr', {
          data: {
            brandId: BRAND,
            sponsorId: sponsorId
          }
        });

        // Should return 200 (may be ok=false if sponsor not found, but HTTP should be 200)
        expect(response.status()).toBe(200);
      }
    });

    test('returns valid envelope with QR data', async ({ request }) => {
      const listResponse = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=sponsors`);
      const listJson = await listResponse.json();

      if (listJson.ok && listJson.value && listJson.value.items && listJson.value.items.length > 0) {
        const sponsorId = listJson.value.items[0].id;

        const response = await request.post('/?action=getSponsorReportQr', {
          data: {
            brandId: BRAND,
            sponsorId: sponsorId
          }
        });

        const json = await response.json();

        expect(json).toHaveProperty('ok');

        if (json.ok && json.value) {
          // sponsor-report-qr.schema.json required fields
          expect(json.value).toHaveProperty('url');
          expect(typeof json.value.url).toBe('string');

          expect(json.value).toHaveProperty('qrB64');
          expect(typeof json.value.qrB64).toBe('string');

          expect(json.value).toHaveProperty('verified');
          expect(typeof json.value.verified).toBe('boolean');
        }
      }
    });

    test('qrB64 is valid base64 PNG', async ({ request }) => {
      const listResponse = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=sponsors`);
      const listJson = await listResponse.json();

      if (listJson.ok && listJson.value && listJson.value.items && listJson.value.items.length > 0) {
        const sponsorId = listJson.value.items[0].id;

        const response = await request.post('/?action=getSponsorReportQr', {
          data: {
            brandId: BRAND,
            sponsorId: sponsorId
          }
        });

        const json = await response.json();

        if (json.ok && json.value && json.value.qrB64 && json.value.qrB64.length > 0) {
          // qrB64 should be raw base64 (no data URI prefix per schema)
          const buffer = Buffer.from(json.value.qrB64, 'base64');
          expect(buffer.length).toBeGreaterThan(8);

          // Check PNG magic bytes
          expect(buffer.slice(0, 8).equals(PNG_MAGIC)).toBe(true);
        }
      }
    });

    test('url contains sponsorId parameter', async ({ request }) => {
      const listResponse = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=sponsors`);
      const listJson = await listResponse.json();

      if (listJson.ok && listJson.value && listJson.value.items && listJson.value.items.length > 0) {
        const sponsorId = listJson.value.items[0].id;

        const response = await request.post('/?action=getSponsorReportQr', {
          data: {
            brandId: BRAND,
            sponsorId: sponsorId
          }
        });

        const json = await response.json();

        if (json.ok && json.value && json.value.url) {
          // URL should contain sponsorId parameter
          expect(json.value.url).toContain('sponsorId');
          expect(json.value.url).toContain(sponsorId);
        }
      }
    });

  });

  test.describe('QR Code Image Validation', () => {

    test('QR PNG has reasonable dimensions (100x100 minimum)', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        if (event.qr.public && event.qr.public.length > 0) {
          let base64Data = event.qr.public;
          if (base64Data.startsWith('data:image/png;base64,')) {
            base64Data = base64Data.replace('data:image/png;base64,', '');
          }

          const buffer = Buffer.from(base64Data, 'base64');

          // PNG header contains dimensions at offset 16-24
          // Width at 16-19, Height at 20-23 (big endian)
          if (buffer.length > 24) {
            const width = buffer.readUInt32BE(16);
            const height = buffer.readUInt32BE(20);

            // QR codes should be at least 100x100 for readability
            expect(width).toBeGreaterThanOrEqual(100);
            expect(height).toBeGreaterThanOrEqual(100);

            // And reasonably sized (not larger than 1000x1000)
            expect(width).toBeLessThanOrEqual(1000);
            expect(height).toBeLessThanOrEqual(1000);
          }
        }
      }
    });

  });

});
