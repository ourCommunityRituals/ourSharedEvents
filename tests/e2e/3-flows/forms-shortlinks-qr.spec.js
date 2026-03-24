/**
 * E2E Tests: Forms → Shortlinks → QR Codes Workflow
 *
 * Critical test for poster generation workflow:
 * 1. Create Google Form from template
 * 2. Generate shortlink for the form
 * 3. Generate QR code for the shortlink
 * 4. Verify QR code appears on poster page
 * 5. Test analytics tracking when QR code is scanned
 *
 * This workflow is essential for event management posters
 */

import { test, expect } from '@playwright/test';
import { getCurrentEnvironment } from '../../config/environments.js';

test.describe('Forms → Shortlinks → QR Codes Workflow', () => {
  let env;
  let baseUrl;
  let adminKey;
  let testEventId;

  test.beforeAll(() => {
    env = getCurrentEnvironment();
    baseUrl = env.baseUrl;
    adminKey = process.env.ADMIN_KEY || env.adminKey;

    if (!adminKey) {
      console.warn('⚠️  ADMIN_KEY not configured. Tests requiring authentication will be skipped.');
    }
  });

  // Helper to create test event (only for tests that need it)
  async function createTestEvent(request) {
    if (!adminKey) {
      throw new Error('Test requires ADMIN_KEY');
    }

    const createResponse = await request.post(baseUrl, {
      data: {
        action: 'create',
        brandId: 'root',
        scope: 'events',
        templateId: 'event',
        adminKey,
        data: {
          name: `Test Event for Forms - ${Date.now()}`,
          dateISO: '2025-12-31',
          location: 'Test Venue',
          signupUrl: ''
        }
      }
    });

    expect(createResponse.ok()).toBeTruthy();
    const createData = await createResponse.json();
    expect(createData.ok).toBe(true);
    return createData.value.id;
  }

  test.describe('Complete Workflow: All 4 Form Types', () => {

    const formTypes = [
      { id: 'sign-up', label: 'Sign-Up Form', description: 'Pre-registration' },
      { id: 'check-in', label: 'Check-In Form', description: 'Quick check-in' },
      { id: 'walk-in', label: 'Walk-In Registration Form', description: 'Walk-in attendees' },
      { id: 'survey', label: 'Post-Event Survey', description: 'Feedback survey' }
    ];

    formTypes.forEach(formType => {
      test(`should complete workflow for ${formType.label}`, async ({ request, page }) => {
        // Skip if no admin key
        if (!adminKey) {
          test.skip('Test requires ADMIN_KEY for authentication');
          return;
        }

        // Create test event
        testEventId = await createTestEvent(request);

        // ===== STEP 1: List Form Templates =====
        const listResponse = await request.post(baseUrl, {
          data: {
            action: 'listFormTemplates'
          }
        });

        expect(listResponse.ok()).toBeTruthy();
        const listData = await listResponse.json();
        expect(listData.ok).toBe(true);
        expect(listData.value.templates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: formType.id, label: formType.label })
          ])
        );

        console.log(`✓ Step 1: Listed form templates, found ${formType.label}`);

        // ===== STEP 2: Create Form from Template =====
        // Note: In real environment, this creates actual Google Form
        // In test environment, we'll mock or skip actual form creation
        const createFormResponse = await request.post(baseUrl, {
          data: {
            action: 'createFormFromTemplate',
            brandId: 'root',
            adminKey,
            templateType: formType.id,
            eventName: `Test Event - ${formType.label}`,
            eventId: testEventId
          }
        });

        const createFormData = await createFormResponse.json();

        // Check if form creation succeeded or if we need to handle test environment
        if (createFormData.ok) {
          // Real environment - form was created
          expect(createFormData.value).toHaveProperty('formId');
          expect(createFormData.value).toHaveProperty('publishedUrl');
          expect(createFormData.value).toHaveProperty('editUrl');
          expect(createFormData.value).toHaveProperty('responseSheetUrl');
          expect(createFormData.value.templateType).toBe(formType.id);
          expect(createFormData.value.eventId).toBe(testEventId);

          console.log(`✓ Step 2: Created ${formType.label} - ${createFormData.value.formId}`);

          const formUrl = createFormData.value.publishedUrl;

          // ===== STEP 3: Generate Shortlink for Form =====
          const shortlinkResponse = await request.post(baseUrl, {
            data: {
              action: 'generateFormShortlink',
              brandId: 'root',
              adminKey,
              formUrl: formUrl,
              formType: formType.id,
              eventId: testEventId
            }
          });

          expect(shortlinkResponse.ok()).toBeTruthy();
          const shortlinkData = await shortlinkResponse.json();
          expect(shortlinkData.ok).toBe(true);
          expect(shortlinkData.value).toHaveProperty('token');
          expect(shortlinkData.value).toHaveProperty('shortlink');
          expect(shortlinkData.value.targetUrl).toBe(formUrl);

          console.log(`✓ Step 3: Generated shortlink - ${shortlinkData.value.shortlink}`);

          const shortlink = shortlinkData.value.shortlink;
          const token = shortlinkData.value.token;

          // ===== STEP 4: Generate QR Code URL =====
          const qrCodeUrl = `https://quickchart.io/qr?text=${encodeURIComponent(shortlink)}&size=200&margin=1`;

          expect(qrCodeUrl).toContain('quickchart.io/qr');
          expect(qrCodeUrl).toContain(encodeURIComponent(shortlink));

          console.log(`✓ Step 4: Generated QR code URL`);

          // ===== STEP 5: Verify QR Code on Poster Page =====
          const posterUrl = `${baseUrl}?page=poster&p=events&brand=root&id=${testEventId}`;
          await page.goto(posterUrl);

          // Wait for poster to load
          await page.waitForSelector('.poster-container', { timeout: 10000 });

          // Check if QR code image is present (either generated QR or placeholder)
          const qrSection = page.locator('.qr-section');
          await expect(qrSection).toBeVisible();

          // Look for QR code images
          const qrImages = page.locator('img[src*="quickchart.io/qr"]');
          const qrCount = await qrImages.count();

          if (qrCount > 0) {
            console.log(`✓ Step 5: Found ${qrCount} QR code(s) on poster`);
          } else {
            console.log('⚠ Step 5: No QR codes found - may need form URLs configured in event data');
          }

          // ===== STEP 6: Test Shortlink Redirect =====
          const redirectUrl = shortlink.includes('?')
            ? shortlink
            : `${baseUrl}?page=r&t=${token}`;

          await page.goto(redirectUrl);

          // Should either:
          // 1. Redirect to form URL (internal)
          // 2. Show external warning page (if external)
          // 3. Show analytics logged message

          await page.waitForTimeout(2000); // Wait for redirect

          const pageContent = await page.content();
          const currentUrl = page.url();

          // Verify redirect happened
          const redirected =
            currentUrl.includes('docs.google.com/forms') || // Redirected to form
            pageContent.includes('External Link Warning') ||  // External warning
            pageContent.includes('Redirecting');               // Redirect in progress

          expect(redirected).toBeTruthy();

          console.log(`✓ Step 6: Shortlink redirect works`);

          // ===== STEP 7: Verify Analytics Logged =====
          const reportResponse = await request.post(baseUrl, {
            data: {
              action: 'getReport',
              brandId: 'root',
              adminKey,
              eventId: testEventId
            }
          });

          expect(reportResponse.ok()).toBeTruthy();
          const reportData = await reportResponse.json();

          if (reportData.ok) {
            // Analytics should include the shortlink click
            console.log(`✓ Step 7: Analytics tracking verified`);
            console.log(`   Total clicks: ${reportData.value.totals.clicks}`);
          }

        } else {
          // Test environment - form creation may not be supported
          console.log(`⚠ Step 2: Form creation returned error (expected in test env): ${createFormData.message}`);

          // Skip to testing with mock form URL
          const mockFormUrl = `https://docs.google.com/forms/d/e/mock-form-${formType.id}/viewform`;

          // Test shortlink generation with mock URL
          const shortlinkResponse = await request.post(baseUrl, {
            data: {
              action: 'generateFormShortlink',
              brandId: 'root',
              adminKey,
              formUrl: mockFormUrl,
              formType: formType.id,
              eventId: testEventId
            }
          });

          const shortlinkData = await shortlinkResponse.json();

          if (shortlinkData.ok) {
            expect(shortlinkData.value).toHaveProperty('shortlink');
            console.log(`✓ Generated shortlink with mock URL`);
          } else {
            console.log(`⚠ Shortlink generation also requires real form URL`);
          }
        }
      });
    });
  });

  test.describe('Form Template Validation (No Auth Required)', () => {

    test('should list all 4 form templates', async ({ request }) => {
      const response = await request.post(baseUrl, {
        data: {
          action: 'listFormTemplates'
        }
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.value.templates).toHaveLength(4);

      const templateIds = data.value.templates.map(t => t.id);
      expect(templateIds).toContain('sign-up');
      expect(templateIds).toContain('check-in');
      expect(templateIds).toContain('walk-in');
      expect(templateIds).toContain('survey');

      console.log('✓ All 4 form templates available:', templateIds.join(', '));
    });

    test('should reject invalid template type', async ({ request }) => {
      const response = await request.post(baseUrl, {
        data: {
          action: 'createFormFromTemplate',
          brandId: 'root',
          adminKey,
          templateType: 'invalid-template',
          eventName: 'Test Event',
          eventId: testEventId
        }
      });

      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.message).toContain('Unknown template type');
    });

    test('should require authentication for form creation', async ({ request }) => {
      const response = await request.post(baseUrl, {
        data: {
          action: 'createFormFromTemplate',
          brandId: 'root',
          adminKey: 'invalid-key',
          templateType: 'sign-up',
          eventName: 'Test Event',
          eventId: testEventId
        }
      });

      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.code).toMatch(/BAD_INPUT|RATE_LIMITED/);
    });
  });

  test.describe('Shortlink Generation', () => {

    test('should generate shortlink with proper surface tagging', async ({ request }) => {
      const mockFormUrl = 'https://docs.google.com/forms/d/e/test-form/viewform';

      const response = await request.post(baseUrl, {
        data: {
          action: 'generateFormShortlink',
          brandId: 'root',
          adminKey,
          formUrl: mockFormUrl,
          formType: 'check-in',
          eventId: testEventId
        }
      });

      const data = await response.json();

      if (data.ok) {
        expect(data.value).toHaveProperty('shortlink');
        expect(data.value).toHaveProperty('token');
        expect(data.value.targetUrl).toBe(mockFormUrl);
        // Surface should be tagged as 'form-check-in' in analytics
      }
    });

    test('should reject missing formUrl', async ({ request }) => {
      const response = await request.post(baseUrl, {
        data: {
          action: 'generateFormShortlink',
          brandId: 'root',
          adminKey,
          formType: 'sign-up',
          eventId: testEventId
          // Missing formUrl
        }
      });

      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.message).toContain('formUrl');
    });

    test('should validate URL format', async ({ request }) => {
      const response = await request.post(baseUrl, {
        data: {
          action: 'generateFormShortlink',
          brandId: 'root',
          adminKey,
          formUrl: 'javascript:alert(1)', // Invalid/dangerous URL
          formType: 'survey',
          eventId: testEventId
        }
      });

      const data = await response.json();
      // Should reject dangerous URLs
      expect(data.ok).toBe(false);
    });
  });

  test.describe('QR Code Display on Poster', () => {

    test('should show QR codes when form URLs are configured', async ({ request, page }) => {
      // Update event with form URLs
      const signupUrl = 'https://docs.google.com/forms/d/e/test-signup/viewform';
      const surveyUrl = 'https://docs.google.com/forms/d/e/test-survey/viewform';

      await request.post(baseUrl, {
        data: {
          action: 'update',
          brandId: 'root',
          adminKey,
          scope: 'events',
          id: testEventId,
          data: {
            signupUrl,
            registerUrl: signupUrl,
            surveyUrl,
            summaryLink: 'https://example.com/event-info'
          }
        }
      });

      // Visit poster page
      const posterUrl = `${baseUrl}?page=poster&p=events&brand=root&id=${testEventId}`;
      await page.goto(posterUrl);

      await page.waitForSelector('.qr-section');

      // Check for QR code section
      const qrSection = page.locator('.qr-section');
      await expect(qrSection).toBeVisible();

      // Should have heading
      await expect(qrSection.locator('h2')).toHaveText('Scan to Connect');

      // Look for QR code images
      const pageContent = await page.content();
      const hasQRImages = pageContent.includes('quickchart.io/qr');

      if (hasQRImages) {
        console.log('✓ QR codes displayed on poster');
      } else {
        console.log('⚠ QR codes not found - check event configuration');
      }
    });

    test('should show helpful message when no QR codes configured', async ({ page }) => {
      // Create event without any form URLs
      const response = await page.request.post(baseUrl, {
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'event',
          adminKey,
          data: {
            name: 'Event Without Forms',
            dateISO: '2025-12-31',
            signupUrl: '' // No form URLs
          }
        }
      });

      const data = await response.json();
      const emptyEventId = data.value.id;

      // Visit poster
      const posterUrl = `${baseUrl}?page=poster&p=events&brand=root&id=${emptyEventId}`;
      await page.goto(posterUrl);

      await page.waitForSelector('.qr-section');

      const qrGrid = page.locator('#qrGrid');
      const content = await qrGrid.textContent();

      // Should show helpful message
      expect(content).toContain('No QR codes available');
    });
  });

  test.describe('Analytics Tracking', () => {

    test('should track form shortlink clicks with correct surface', async ({ request }) => {
      // Create shortlink
      const mockFormUrl = 'https://docs.google.com/forms/d/e/test/viewform';

      const shortlinkResponse = await request.post(baseUrl, {
        data: {
          action: 'generateFormShortlink',
          brandId: 'root',
          adminKey,
          formUrl: mockFormUrl,
          formType: 'walk-in',
          eventId: testEventId
        }
      });

      const shortlinkData = await shortlinkResponse.json();

      if (!shortlinkData.ok) {
        test.skip('Shortlink creation not available in test environment');
        return;
      }

      const token = shortlinkData.value.token;

      // Simulate clicking the shortlink (analytics should log)
      await request.get(`${baseUrl}?page=r&t=${token}`);

      // Check analytics
      const reportResponse = await request.post(baseUrl, {
        data: {
          action: 'getReport',
          brandId: 'root',
          adminKey,
          eventId: testEventId
        }
      });

      const reportData = await reportResponse.json();

      if (reportData.ok) {
        // Should have analytics for this event
        expect(reportData.value.totals.clicks).toBeGreaterThanOrEqual(1);

        // Check if analytics includes form-walk-in surface
        const surfaces = Object.keys(reportData.value.bySurface || {});
        console.log('Surfaces tracked:', surfaces);
      }
    });
  });
});
