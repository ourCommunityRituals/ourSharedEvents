/**
 * Sponsors CRUD API Tests - Playwright
 * Replaces Newman sponsor API tests with comprehensive Playwright coverage
 */

import { test, expect } from '@playwright/test';
import { ApiHelpers, SponsorBuilder } from './api-helpers.js';
import { getCurrentEnvironment } from '../../config/environments.js';

test.describe('Sponsors CRUD APIs', () => {
  let api;
  let adminKey;
  const brand = 'root';
  const createdSponsorIds = []; // Track for cleanup

  test.beforeEach(async ({ request }) => {
    const env = getCurrentEnvironment();
    api = new ApiHelpers(request, env.baseUrl);
    adminKey = process.env.ADMIN_KEY;

    if (!adminKey) {
      test.skip('ADMIN_KEY not set');
    }
  });

  test.afterEach(async () => {
    // Clean up created sponsors
    for (const sponsorId of createdSponsorIds) {
      try {
        await api.deleteSponsor(brand, sponsorId, adminKey);
      } catch (error) {
        console.warn(`Failed to delete sponsor ${sponsorId}:`, error.message);
      }
    }
    createdSponsorIds.length = 0;
  });

  test.describe('Create Sponsor', () => {
    test('creates sponsor with valid data', async () => {
      const sponsorData = new SponsorBuilder()
        .withName('Playwright Test Sponsor')
        .withWebsite('https://playwright.dev')
        .withTier('platinum')
        .build();

      const response = await api.createSponsor(brand, sponsorData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('id');

      createdSponsorIds.push(data.value.id);
    });

    test('creates sponsor with minimal fields', async () => {
      const sponsorData = {
        name: 'Minimal Sponsor'
      };

      const response = await api.createSponsor(brand, sponsorData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);

      createdSponsorIds.push(data.value.id);
    });

    test('creates sponsor with all fields', async () => {
      const sponsorData = new SponsorBuilder()
        .withName('Complete Sponsor')
        .withWebsite('https://complete.example.com')
        .withTier('gold')
        .withLogo('https://example.com/logo.png')
        .build();

      // Add optional fields
      Object.assign(sponsorData, {
        startDate: '2025-01-01',
        endDate: '2025-12-31'
      });

      const response = await api.createSponsor(brand, sponsorData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);

      createdSponsorIds.push(data.value.id);
    });

    test('requires authentication', async () => {
      const sponsorData = {
        name: 'Unauthorized Sponsor'
      };

      const response = await api.post('?action=create', {
        brandId: brand,
        scope: 'sponsors',
        templateId: 'sponsor',
        data: sponsorData
        // Missing adminKey
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });
  });

  test.describe('Get Sponsor', () => {
    let testSponsorId;

    test.beforeEach(async () => {
      const { sponsorId } = await api.createTestSponsor(brand, adminKey);
      testSponsorId = sponsorId;
      createdSponsorIds.push(testSponsorId);
    });

    test('retrieves sponsor by ID', async () => {
      const response = await api.getSponsor(brand, testSponsorId);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
      expect(data.value).toHaveProperty('id', testSponsorId);
      expect(data.value).toHaveProperty('name');
    });

    test('returns error for non-existent sponsor', async () => {
      const fakeId = 'non-existent-sponsor-12345';
      const response = await api.getSponsor(brand, fakeId);

      if (response.status() === 404) {
        expect(response.ok()).toBe(false);
      } else {
        const data = await response.json();
        expect(data.ok).toBe(false);
      }
    });
  });

  test.describe('List Sponsors', () => {
    test.beforeEach(async () => {
      // Create 3 test sponsors
      for (let i = 0; i < 3; i++) {
        const { sponsorId } = await api.createTestSponsor(brand, adminKey, {
          name: `List Test Sponsor ${i + 1}`,
          tier: ['gold', 'silver', 'bronze'][i]
        });
        createdSponsorIds.push(sponsorId);
      }
    });

    test('lists all sponsors for brand', async () => {
      const response = await api.listSponsors(brand);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
      expect(data.value).toBeInstanceOf(Array);
      expect(data.value.length).toBeGreaterThanOrEqual(3);
    });

    test('returns sponsors with correct structure', async () => {
      const response = await api.listSponsors(brand);
      const data = await response.json();

      expect(data.value.length).toBeGreaterThan(0);

      const sponsor = data.value[0];
      expect(sponsor).toHaveProperty('id');
      expect(sponsor).toHaveProperty('name');
    });
  });

  test.describe('Update Sponsor', () => {
    let testSponsorId;

    test.beforeEach(async () => {
      const { sponsorId } = await api.createTestSponsor(brand, adminKey, {
        name: 'Original Sponsor',
        tier: 'silver'
      });
      testSponsorId = sponsorId;
      createdSponsorIds.push(testSponsorId);
    });

    test('updates sponsor fields', async () => {
      const updateData = {
        name: 'Updated Sponsor',
        tier: 'gold'
      };

      const response = await api.updateSponsor(brand, testSponsorId, updateData, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);

      // Verify update
      const getResponse = await api.getSponsor(brand, testSponsorId);
      const getData = await getResponse.json();

      expect(getData.value.name).toBe('Updated Sponsor');
      expect(getData.value.tier).toBe('gold');
    });

    test('requires authentication', async () => {
      const updateData = { name: 'Unauthorized Update' };

      const response = await api.post('?action=update', {
        brandId: brand,
        scope: 'sponsors',
        id: testSponsorId,
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
  });

  test.describe('Delete Sponsor', () => {
    let testSponsorId;

    test.beforeEach(async () => {
      const { sponsorId } = await api.createTestSponsor(brand, adminKey);
      testSponsorId = sponsorId;
    });

    test('deletes sponsor successfully', async () => {
      const response = await api.deleteSponsor(brand, testSponsorId, adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);

      // Verify deletion
      const getResponse = await api.getSponsor(brand, testSponsorId);

      if (getResponse.status() === 404) {
        expect(getResponse.ok()).toBe(false);
      } else {
        const getData = await getResponse.json();
        expect(getData.ok).toBe(false);
      }
    });

    test('requires authentication', async () => {
      const response = await api.post('?action=delete', {
        brandId: brand,
        scope: 'sponsors',
        id: testSponsorId
        // Missing adminKey
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }

      createdSponsorIds.push(testSponsorId);
    });
  });

  test.describe('Sponsor CRUD Flow', () => {
    test('complete CRUD lifecycle', async () => {
      // 1. CREATE
      const sponsorData = new SponsorBuilder()
        .withName('Lifecycle Sponsor')
        .withTier('platinum')
        .withWebsite('https://lifecycle.example.com')
        .build();

      const createResponse = await api.createSponsor(brand, sponsorData, adminKey);
      const createData = await createResponse.json();

      expect(createData.ok).toBe(true);
      const sponsorId = createData.value.id;

      // 2. READ
      const getResponse = await api.getSponsor(brand, sponsorId);
      const getData = await getResponse.json();

      expect(getData.ok).toBe(true);
      expect(getData.value.name).toBe('Lifecycle Sponsor');

      // 3. UPDATE
      const updateResponse = await api.updateSponsor(brand, sponsorId, {
        tier: 'gold'
      }, adminKey);
      const updateData = await updateResponse.json();

      expect(updateData.ok).toBe(true);

      // 4. READ (verify update)
      const getResponse2 = await api.getSponsor(brand, sponsorId);
      const getData2 = await getResponse2.json();

      expect(getData2.value.tier).toBe('gold');

      // 5. DELETE
      const deleteResponse = await api.deleteSponsor(brand, sponsorId, adminKey);
      const deleteData = await deleteResponse.json();

      expect(deleteData.ok).toBe(true);

      // 6. READ (verify deletion)
      const getResponse3 = await api.getSponsor(brand, sponsorId);

      if (getResponse3.status() === 404) {
        expect(getResponse3.ok()).toBe(false);
      } else {
        const getData3 = await getResponse3.json();
        expect(getData3.ok).toBe(false);
      }
    });
  });
});
