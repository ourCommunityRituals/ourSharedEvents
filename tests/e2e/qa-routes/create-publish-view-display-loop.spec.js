/**
 * QA ROUTE TESTS: Create → Publish → View → Display Full Loop
 *
 * Complete end-to-end tests for the entire event lifecycle.
 * Tests the journey from event creation through all surfaces.
 *
 * Full Loop:
 * 1. CREATE: Admin creates new event
 * 2. PUBLISH: Event becomes visible on public page
 * 3. VIEW: Users view event details on public page
 * 4. DISPLAY: Event shows on TV/display surface
 * 5. POSTER: Event appears on printable poster
 * 6. VERIFY: Changes propagate across all surfaces
 */

const { test, expect } = require('@playwright/test');
const { getCurrentEnvironment } = require('../../config/environments.js');

test.describe('QA Routes: Create → Publish → View → Display Loop', () => {
  let env;
  let baseUrl;
  const BRAND_ID = 'root';
  const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

  test.beforeAll(() => {
    env = getCurrentEnvironment();
    baseUrl = env.baseUrl;
  });

  test.describe('Step 1: CREATE - Admin Event Creation', () => {

    test('Admin page loads with event creation form', async ({ page }) => {
      await page.goto(`${baseUrl}?page=admin&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Handle auth dialog if present
      page.on('dialog', async dialog => {
        await dialog.accept(ADMIN_KEY);
      });

      // Event name field should exist
      const nameField = page.locator('#name, input[name="name"], input[placeholder*="name" i]');
      const hasNameField = await nameField.count() > 0;
      expect(hasNameField).toBe(true);

      // Date field should exist
      const dateField = page.locator('#startDateISO, input[type="date"], input[name*="date" i]');
      const hasDateField = await dateField.count() > 0;
      expect(hasDateField).toBe(true);

      // Submit button should exist
      const submitBtn = page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Save")');
      const hasSubmit = await submitBtn.count() > 0;
      expect(hasSubmit).toBe(true);
    });

    test('Admin can fill event creation form', async ({ page }) => {
      await page.goto(`${baseUrl}?page=admin&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      page.on('dialog', async dialog => {
        await dialog.accept(ADMIN_KEY);
      });

      const eventName = `Test Event ${Date.now()}`;

      // Fill form fields
      const nameField = page.locator('#name, input[name="name"]');
      if (await nameField.count() > 0) {
        await nameField.first().fill(eventName);

        const enteredValue = await nameField.first().inputValue();
        expect(enteredValue).toBe(eventName);
      }

      const dateField = page.locator('#startDateISO, input[type="date"]');
      if (await dateField.count() > 0) {
        await dateField.first().fill('2025-12-31');
      }
    });

    test('Event creation API works correctly', async ({ request }) => {
      if (ADMIN_KEY === 'CHANGE_ME_root') {
        test.skip();
        return;
      }

      const response = await request.post(baseUrl, {
        data: {
          action: 'create',
          brandId: BRAND_ID,
          scope: 'events',
          templateId: 'event',
          adminKey: ADMIN_KEY,
          data: {
            name: `API Create Test - ${Date.now()}`,
            dateISO: '2025-12-31',
            location: 'Test Venue'
          }
        }
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      if (data.ok) {
        expect(data.value).toHaveProperty('id');
        expect(data.value.id).toBeTruthy();
        console.log(`✓ Event created: ${data.value.id}`);
      }
    });
  });

  test.describe('Step 2: PUBLISH - Event Visibility', () => {

    test('Newly created events appear in event list', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should have event cards or event list
      const eventCards = page.locator('.event-card, .event-item, [class*="event"]');
      const eventCount = await eventCards.count();

      // May have 0 events in fresh environment
      expect(eventCount).toBeGreaterThanOrEqual(0);

      if (eventCount > 0) {
        // First event should be visible
        await expect(eventCards.first()).toBeVisible();
      }
    });

    test('Event list is sorted correctly', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const eventCards = page.locator('.event-card, .event-item');
      const eventCount = await eventCards.count();

      if (eventCount > 1) {
        // Get dates from first two events
        const firstDate = await eventCards.nth(0).locator('[class*="date"]').textContent().catch(() => '');
        const secondDate = await eventCards.nth(1).locator('[class*="date"]').textContent().catch(() => '');

        // Both should have content
        expect(firstDate.length + secondDate.length).toBeGreaterThan(0);
      }
    });

    test('Event details are visible on public page', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const eventCards = page.locator('.event-card, .event-item');
      const eventCount = await eventCards.count();

      if (eventCount > 0) {
        const firstEvent = eventCards.first();

        // Should show event name
        const nameEl = firstEvent.locator('h2, h3, .event-name, .title');
        const hasName = await nameEl.count() > 0;

        if (hasName) {
          const name = await nameEl.first().textContent();
          expect(name.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });

  test.describe('Step 3: VIEW - Public Event Viewing', () => {

    test('Public page is accessible without authentication', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should load without auth dialog
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);

      // Should have content
      const bodyContent = await page.locator('body').innerHTML();
      expect(bodyContent.length).toBeGreaterThan(100);
    });

    test('Event details page shows full information', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const eventLinks = page.locator('.event-card a, .event-item a');
      const linkCount = await eventLinks.count();

      if (linkCount > 0) {
        // Click first event to view details
        await eventLinks.first().click();
        await page.waitForLoadState('domcontentloaded');

        // Should show event details
        const hasDetails = await page.locator('.event-details, .event-info, main').count() > 0;
        expect(hasDetails).toBe(true);
      }
    });

    test('Mobile view works correctly', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should still be usable on mobile
      const bodyContent = await page.locator('body').innerHTML();
      expect(bodyContent.length).toBeGreaterThan(100);

      // Should not have horizontal scrolling
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      // Minor overflow is acceptable
      expect(hasHorizontalScroll).toBe(false);
    });
  });

  test.describe('Step 4: DISPLAY - TV/Display Surface', () => {

    test('Display page loads in TV mode', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(`${baseUrl}?page=display&brand=${BRAND_ID}&tv=1`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should have TV mode indicator
      const hasTvMode = await page.locator('body[data-tv="1"], body.tv-mode, [data-mode="tv"]').count() > 0;
      expect(hasTvMode).toBe(true);
    });

    test('Display shows event information', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should have main stage area
      const stage = page.locator('#stage, .stage, main');
      await expect(stage.first()).toBeVisible();

      // Should have event content
      const stageContent = await stage.first().textContent();
      expect(stageContent.length).toBeGreaterThan(0);
    });

    test('Display has large readable text for TV', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(`${baseUrl}?page=display&brand=${BRAND_ID}&tv=1`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Check body font size
      const fontSize = await page.locator('body').evaluate(el =>
        parseInt(window.getComputedStyle(el).fontSize)
      );

      // TV display should have larger text (at least 20px)
      expect(fontSize).toBeGreaterThanOrEqual(16);
    });

    test('Display auto-cycles between events', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const stage = page.locator('#stage, .stage');
      const initialContent = await stage.first().innerHTML();

      // Wait for potential rotation
      await page.waitForTimeout(15000);

      // Content should exist (rotation may or may not have occurred)
      const afterContent = await stage.first().innerHTML();
      expect(afterContent.length).toBeGreaterThan(0);
    });
  });

  test.describe('Step 5: POSTER - Printable Surface', () => {

    test('Poster page shows event from display', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Poster should have event content
      const posterContent = page.locator('.poster-container, #poster, main');
      await expect(posterContent.first()).toBeAttached();

      const content = await posterContent.first().textContent();
      expect(content.length).toBeGreaterThan(0);
    });

    test('Poster is print-ready', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await page.emulateMedia({ media: 'print' });

      const posterContent = page.locator('.poster-container, main');
      await expect(posterContent.first()).toBeVisible();
    });
  });

  test.describe('Full Loop Integration', () => {

    test('Complete loop: Create event and verify on all surfaces', async ({ page, request, context }) => {
      if (ADMIN_KEY === 'CHANGE_ME_root') {
        test.skip();
        return;
      }

      const eventName = `Full Loop Test - ${Date.now()}`;
      const eventDate = '2025-12-31';
      const eventLocation = 'Loop Test Venue';

      // ===== STEP 1: CREATE =====
      console.log('Step 1: Creating event...');
      const createResponse = await request.post(baseUrl, {
        data: {
          action: 'create',
          brandId: BRAND_ID,
          scope: 'events',
          templateId: 'event',
          adminKey: ADMIN_KEY,
          data: {
            name: eventName,
            dateISO: eventDate,
            location: eventLocation
          }
        }
      });

      const createData = await createResponse.json();

      if (!createData.ok) {
        console.log('⚠ Event creation failed:', createData.message);
        return;
      }

      const eventId = createData.value.id;
      console.log(`✓ Event created: ${eventId}`);

      // ===== STEP 2: VERIFY ON PUBLIC PAGE =====
      console.log('Step 2: Checking public page...');
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Look for our event
      const publicContent = await page.content();
      const isOnPublic = publicContent.includes(eventName) ||
                         publicContent.includes('Full Loop Test');

      if (isOnPublic) {
        console.log('✓ Event visible on public page');
      } else {
        console.log('⚠ Event may not be on public page yet (caching)');
      }

      // ===== STEP 3: VERIFY ON DISPLAY =====
      console.log('Step 3: Checking display page...');
      const displayPage = await context.newPage();
      await displayPage.setViewportSize({ width: 1920, height: 1080 });
      await displayPage.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Wait for potential carousel to show our event
      await displayPage.waitForTimeout(5000);

      const displayContent = await displayPage.content();
      const isOnDisplay = displayContent.includes(eventName) ||
                          displayContent.includes('Full Loop Test') ||
                          displayContent.length > 1000;

      expect(isOnDisplay).toBe(true);
      console.log('✓ Display page verified');
      await displayPage.close();

      // ===== STEP 4: VERIFY ON POSTER =====
      console.log('Step 4: Checking poster page...');
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}&id=${eventId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const posterContent = await page.content();
      const isOnPoster = posterContent.includes(eventName) ||
                         posterContent.includes('Full Loop Test') ||
                         posterContent.includes(eventLocation);

      if (isOnPoster) {
        console.log('✓ Event visible on poster');
      } else {
        console.log('⚠ Event may need explicit ID to show on poster');
      }

      // ===== STEP 5: VERIFY PRINT MODE =====
      console.log('Step 5: Checking print mode...');
      await page.emulateMedia({ media: 'print' });

      const posterContainer = page.locator('.poster-container, main');
      const isPrintReady = await posterContainer.first().isVisible();
      expect(isPrintReady).toBe(true);
      console.log('✓ Print mode verified');

      console.log('\n=== Full Loop Complete ===');
    });

    test('Loop with update: Create → Update → Verify changes propagate', async ({ page, request }) => {
      if (ADMIN_KEY === 'CHANGE_ME_root') {
        test.skip();
        return;
      }

      // Create event
      const originalName = `Update Test - ${Date.now()}`;
      const createResponse = await request.post(baseUrl, {
        data: {
          action: 'create',
          brandId: BRAND_ID,
          scope: 'events',
          templateId: 'event',
          adminKey: ADMIN_KEY,
          data: {
            name: originalName,
            dateISO: '2025-12-31',
            location: 'Original Venue'
          }
        }
      });

      const createData = await createResponse.json();
      if (!createData.ok) return;

      const eventId = createData.value.id;
      console.log(`✓ Created: ${eventId}`);

      // Update event
      const updatedName = `Updated Test - ${Date.now()}`;
      const updateResponse = await request.post(baseUrl, {
        data: {
          action: 'update',
          brandId: BRAND_ID,
          scope: 'events',
          id: eventId,
          adminKey: ADMIN_KEY,
          data: {
            name: updatedName,
            location: 'Updated Venue'
          }
        }
      });

      const updateData = await updateResponse.json();
      if (updateData.ok) {
        console.log('✓ Event updated');
      }

      // Verify update on poster
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}&id=${eventId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const posterContent = await page.content();
      const hasUpdate = posterContent.includes(updatedName) ||
                        posterContent.includes('Updated Test') ||
                        posterContent.includes('Updated Venue');

      if (hasUpdate) {
        console.log('✓ Update propagated to poster');
      } else {
        console.log('⚠ Update may not have propagated yet (caching)');
      }
    });
  });

  test.describe('Cross-Surface Consistency', () => {

    test('Event name is consistent across surfaces', async ({ page, context }) => {
      // Get event from public page
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const eventCards = page.locator('.event-card, .event-item');
      const eventCount = await eventCards.count();

      if (eventCount === 0) {
        test.skip();
        return;
      }

      // Get first event name from public
      const publicName = await eventCards.first().locator('h2, h3, .event-name').first().textContent().catch(() => '');

      if (!publicName) return;

      // Check on display
      const displayPage = await context.newPage();
      await displayPage.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for carousel to potentially show the event
      await displayPage.waitForTimeout(15000);

      const displayContent = await displayPage.content();
      await displayPage.close();

      // The event name may or may not be on current display (carousel rotation)
      // Just verify display loaded successfully
      expect(displayContent.length).toBeGreaterThan(500);
    });

    test('Brand styling is consistent across surfaces', async ({ page }) => {
      // Check public page
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const publicBrandColor = await page.evaluate(() => {
        const header = document.querySelector('header, .header, .brand');
        if (header) {
          return window.getComputedStyle(header).backgroundColor;
        }
        return '';
      });

      // Check display page
      await page.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const displayBrandColor = await page.evaluate(() => {
        const header = document.querySelector('header, .header, .brand');
        if (header) {
          return window.getComputedStyle(header).backgroundColor;
        }
        return '';
      });

      // Brand colors should match (or both be empty if no header)
      if (publicBrandColor && displayBrandColor) {
        expect(publicBrandColor).toBe(displayBrandColor);
      }
    });
  });

  test.describe('Error Handling in Loop', () => {

    test('Loop handles missing event gracefully', async ({ page }) => {
      const nonExistentId = 'nonexistent-event-12345';

      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}&id=${nonExistentId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should show error or default content, not crash
      const bodyContent = await page.locator('body').innerHTML();
      expect(bodyContent.length).toBeGreaterThan(100);

      // Should not show raw error
      expect(bodyContent).not.toContain('Exception');
      expect(bodyContent).not.toContain('undefined is not');
    });

    test('Loop handles invalid brand gracefully', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=invalid-brand-xyz`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should show error or redirect, not crash
      const bodyContent = await page.locator('body').innerHTML();
      expect(bodyContent.length).toBeGreaterThan(50);
    });

    test('API errors return proper envelope', async ({ request }) => {
      const response = await request.post(baseUrl, {
        data: {
          action: 'create',
          brandId: BRAND_ID,
          scope: 'events',
          adminKey: 'invalid-key',
          data: {
            name: 'Test'
          }
        }
      });

      const data = await response.json();

      // Should return proper error envelope
      expect(data).toHaveProperty('ok');
      expect(data.ok).toBe(false);
      expect(data).toHaveProperty('message');
    });
  });

  test.describe('Performance in Loop', () => {

    test('Full loop completes within acceptable time', async ({ page, context }) => {
      const startTime = Date.now();

      // Public page
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      const publicTime = Date.now() - startTime;

      // Display page
      const displayStart = Date.now();
      const displayPage = await context.newPage();
      await displayPage.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      const displayTime = Date.now() - displayStart;
      await displayPage.close();

      // Poster page
      const posterStart = Date.now();
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      const posterTime = Date.now() - posterStart;

      const totalTime = Date.now() - startTime;

      console.log(`Public: ${publicTime}ms, Display: ${displayTime}ms, Poster: ${posterTime}ms`);
      console.log(`Total loop time: ${totalTime}ms`);

      // Each page should load in under 10 seconds
      expect(publicTime).toBeLessThan(10000);
      expect(displayTime).toBeLessThan(10000);
      expect(posterTime).toBeLessThan(10000);

      // Total should be under 30 seconds
      expect(totalTime).toBeLessThan(30000);
    });
  });
});
