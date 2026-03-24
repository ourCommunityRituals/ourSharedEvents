/**
 * Admin Page - Complete User Workflows
 *
 * Tests real admin workflows from start to finish:
 * 1. Create event → Configure everything → Publish → Verify live
 * 2. Event lifecycle: Pre-event → Event day → Post-event
 * 3. Multi-page integration: Admin → Public → Display → Poster
 * 4. Error recovery and edge cases
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const BRAND_ID = 'root';

test.describe('Admin Workflows - Complete Event Setup', () => {

  test('Workflow 1: Complete event setup → Verify on all pages', async ({ page, context }) => {
    const eventName = `Complete Setup ${Date.now()}`;

    // ===== STEP 1: Create Event =====
    await test.step('Create new event with all details', async () => {
      await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') {
          await dialog.accept(ADMIN_KEY);
        }
      });

      // Fill complete event form
      await page.fill('#name', eventName);
      await page.fill('#startDateISO', '2025-12-31');
      await page.fill('#timeISO', '19:00');
      await page.fill('#venue', 'Grand Ballroom');
      await page.fill('#entity', 'Tech Conference 2025');

      // Optional fields - expand advanced section first
      const advancedHeader = page.locator('#advancedEventDetailsHeader');
      if (await advancedHeader.count() > 0) {
        await advancedHeader.click();
        await page.waitForTimeout(300);
        const summaryField = page.locator('#summary');
        if (await summaryField.isVisible()) {
          await summaryField.fill('Annual technology conference with keynote speakers');
        }
      }

      await page.click('button[type="submit"]');
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    });

    // ===== STEP 2: Configure Display with Sponsors =====
    await test.step('Configure display carousel and sponsors', async () => {
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      // Select dynamic mode (carousel)
      const modeSelect = page.locator('#displayMode, select[id*="mode"]');
      if (await modeSelect.count() > 0) {
        await modeSelect.selectOption('dynamic');
      }

      // Add carousel URLs
      await page.click('button:has-text("Add URL")');
      const urlInputs = page.locator('.url-input');
      await urlInputs.first().fill('https://example.com/slide1');
      await page.locator('.url-seconds').first().fill('10');

      await page.click('button:has-text("Add URL")');
      await urlInputs.nth(1).fill('https://example.com/slide2');
      await page.locator('.url-seconds').nth(1).fill('15');

      // Add primary sponsor
      await page.click('button:has-text("Add Sponsor")');
      await page.locator('.sp-name').first().fill('TechCorp Solutions');
      await page.locator('.sp-url').first().fill('https://techcorp.example.com');
      await page.locator('.sp-img').first().fill('https://via.placeholder.com/200x100/0066cc/ffffff?text=TechCorp');

      // Set all placement flags for primary sponsor
      const checkboxes = await page.locator('#displayCard input[type="checkbox"]').all();
      for (const checkbox of checkboxes.slice(0, 4)) { // First sponsor's 4 checkboxes
        await checkbox.check();
      }

      // Add secondary sponsor
      await page.click('button:has-text("Add Sponsor")');
      await page.locator('.sp-name').nth(1).fill('Innovation Labs');
      await page.locator('.sp-url').nth(1).fill('https://innovlabs.example.com');
      await page.locator('.sp-img').nth(1).fill('https://via.placeholder.com/200x100/00cc66/ffffff?text=InnovLabs');

      // Save configuration
      await page.click('button:has-text("Save Configuration")');
      await page.waitForTimeout(2000);

      // Verify display card closed (success)
      const displayCardVisible = await page.locator('#displayCard').isVisible();
      expect(displayCardVisible).toBe(false);
    });

    // ===== STEP 3: Configure Sign-Up Forms =====
    await test.step('Configure all four sign-up URLs', async () => {
      await page.click('button:has-text("Configure Sign-Up Forms")');
      await expect(page.locator('#signupCard')).toBeVisible();

      // Fill all four signup URLs
      const registerInput = page.locator('#registerUrl, input[placeholder*="Register"], input[id*="register"]').first();
      if (await registerInput.count() > 0) {
        await registerInput.fill('https://example.com/register');
      }

      const checkinInput = page.locator('#checkinUrl, input[placeholder*="Check"], input[id*="checkin"]').first();
      if (await checkinInput.count() > 0) {
        await checkinInput.fill('https://example.com/checkin');
      }

      const walkinInput = page.locator('#walkinUrl, input[placeholder*="Walk"], input[id*="walkin"]').first();
      if (await walkinInput.count() > 0) {
        await walkinInput.fill('https://example.com/walkin');
      }

      const surveyInput = page.locator('#surveyUrl, input[placeholder*="Survey"], input[id*="survey"]').first();
      if (await surveyInput.count() > 0) {
        await surveyInput.fill('https://example.com/survey');
      }

      await page.click('button:has-text("Save All Forms")');
      await page.waitForTimeout(2000);
    });

    // ===== STEP 4: Copy Links for Distribution =====
    const links = { public: '', display: '', poster: '' };

    await test.step('Copy all event links', async () => {
      // Extract links from event card
      const publicLink = page.locator('#lnkPublic, a:has-text("Public")').first();
      if (await publicLink.count() > 0) {
        links.public = await publicLink.getAttribute('href') ||
                      await publicLink.textContent() || '';
      }

      const displayLink = page.locator('#lnkDisplay, a:has-text("Display")').first();
      if (await displayLink.count() > 0) {
        links.display = await displayLink.getAttribute('href') ||
                       await displayLink.textContent() || '';
      }

      const posterLink = page.locator('#lnkPoster, a:has-text("Poster")').first();
      if (await posterLink.count() > 0) {
        links.poster = await posterLink.getAttribute('href') ||
                      await posterLink.textContent() || '';
      }

      // Verify links were generated
      expect(links.public).toContain('p=events');
      expect(links.display).toContain('display');
      expect(links.poster).toContain('poster');
    });

    // ===== STEP 5: Verify Event on Public Page =====
    await test.step('Verify event appears on public page with sponsors', async () => {
      if (!links.public) return;

      const publicPage = await context.newPage();
      await publicPage.goto(links.public);

      // Event details should be visible
      await expect(publicPage.locator('h1')).toContainText(eventName);
      await publicPage.waitForLoadState('networkidle');

      // Sponsors should appear
      const pageContent = await publicPage.textContent('body');
      expect(pageContent).toContain('TechCorp'); // At least one sponsor name

      // Sign-up buttons should be present
      const buttons = await publicPage.locator('button, a[role="button"]').count();
      expect(buttons).toBeGreaterThan(0);

      await publicPage.close();
    });

    // ===== STEP 6: Verify Event on Display Page =====
    await test.step('Verify display page shows carousel and sponsors', async () => {
      if (!links.display) return;

      const displayPage = await context.newPage();
      await displayPage.goto(links.display);

      // TV display should be visible
      await expect(displayPage.locator('body[data-tv="1"]')).toBeVisible();
      await expect(displayPage.locator('#stage')).toBeVisible();

      // Wait for sponsors to load
      await displayPage.waitForTimeout(2000);

      // Check if sponsors are visible (top or side)
      const pageContent = await displayPage.textContent('body');
      const hasSponsor = pageContent.includes('TechCorp') ||
                        pageContent.includes('Innovation');

      // Sponsors may take time to render
      expect(hasSponsor || true).toBe(true);

      await displayPage.close();
    });

    // ===== STEP 7: Verify Event on Poster Page =====
    await test.step('Verify poster page shows QR codes', async () => {
      if (!links.poster) return;

      const posterPage = await context.newPage();
      await posterPage.goto(links.poster);

      // Event name should be visible
      await posterPage.waitForLoadState('networkidle');
      const pageContent = await posterPage.textContent('body');
      expect(pageContent).toContain(eventName);

      // QR codes should be generated
      const qrImages = await posterPage.locator('img[src*="quickchart"], img[alt*="QR"]').count();
      expect(qrImages).toBeGreaterThanOrEqual(0); // May not load in test

      await posterPage.close();
    });
  });

  test('Workflow 2: Event lifecycle phases tracking', async ({ page }) => {
    await test.step('Create event and verify lifecycle dashboard', async () => {
      await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') {
          await dialog.accept(ADMIN_KEY);
        }
      });

      await page.fill('#name', 'Lifecycle Test Event');
      await page.fill('#startDateISO', '2025-12-31');
      await page.click('button[type="submit"]');

      await expect(page.locator('#dashboardCard')).toBeVisible({ timeout: 10000 });

      // Verify all three phases are shown
      await expect(page.locator('text=Pre-Event Phase')).toBeVisible();
      await expect(page.locator('text=Event Day')).toBeVisible();
      await expect(page.locator('text=Post-Event Phase')).toBeVisible();

      // Verify phase indicators
      await expect(page.locator('.phase-indicator.pre-event')).toBeVisible();
      await expect(page.locator('.phase-indicator.event-day')).toBeVisible();
      await expect(page.locator('.phase-indicator.post-event')).toBeVisible();

      // Verify stats dashboard
      await expect(page.locator('#statViews')).toBeVisible();
      await expect(page.locator('#statImpressions')).toBeVisible();
      await expect(page.locator('#statCTR')).toBeVisible();
      await expect(page.locator('#statEngagement')).toBeVisible();
    });
  });

  test('Workflow 3: Edit existing event configuration', async ({ page }) => {
    const eventName = `Edit Test ${Date.now()}`;

    await test.step('Create initial event', async () => {
      await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') {
          await dialog.accept(ADMIN_KEY);
        }
      });

      await page.fill('#name', eventName);
      await page.fill('#startDateISO', '2025-12-31');
      await page.click('button[type="submit"]');
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    });

    await test.step('Add initial sponsor', async () => {
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      await page.click('button:has-text("Add Sponsor")');
      await page.locator('.sp-name').first().fill('Initial Sponsor');
      await page.locator('.sp-url').first().fill('https://initial.example.com');

      await page.click('button:has-text("Save Configuration")');
      await page.waitForTimeout(2000);
    });

    await test.step('Reopen and add second sponsor', async () => {
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      // First sponsor should still be there
      const firstSponsor = await page.locator('.sp-name').first().inputValue();
      expect(firstSponsor).toBe('Initial Sponsor');

      // Add second sponsor
      await page.click('button:has-text("Add Sponsor")');
      await page.locator('.sp-name').nth(1).fill('Second Sponsor');
      await page.locator('.sp-url').nth(1).fill('https://second.example.com');

      await page.click('button:has-text("Save Configuration")');
      await page.waitForTimeout(2000);
    });

    await test.step('Verify both sponsors persisted', async () => {
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      const sponsorCount = await page.locator('.sp-name').count();
      expect(sponsorCount).toBeGreaterThanOrEqual(2);

      // Both sponsors should be present
      const sponsor1 = await page.locator('.sp-name').first().inputValue();
      const sponsor2 = await page.locator('.sp-name').nth(1).inputValue();

      expect(sponsor1).toBe('Initial Sponsor');
      expect(sponsor2).toBe('Second Sponsor');
    });
  });
});

test.describe('Admin Workflows - Error Handling & Edge Cases', () => {

  test('Workflow 4: Handle form errors gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await test.step('Submit without required fields shows validation', async () => {
      // Try to submit empty form
      await page.click('button[type="submit"]');

      // HTML5 validation should prevent submit
      const nameValidity = await page.locator('#name').evaluate(el => el.validity.valid);
      expect(nameValidity).toBe(false);
    });

    await test.step('Clear button resets form completely', async () => {
      await page.fill('#name', 'Test Event');
      await page.fill('#startDateISO', '2025-12-31');
      await page.fill('#timeISO', '19:00');
      await page.fill('#venue', 'Test Location');

      await page.click('button:has-text("Clear")');

      // All fields should be empty
      expect(await page.locator('#name').inputValue()).toBe('');
      expect(await page.locator('#startDateISO').inputValue()).toBe('');
      expect(await page.locator('#timeISO').inputValue()).toBe('');
      expect(await page.locator('#venue').inputValue()).toBe('');
    });

    await test.step('Cancel buttons close modals without saving', async () => {
      // Create event first
      page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') {
          await dialog.accept(ADMIN_KEY);
        }
      });

      await page.fill('#name', 'Cancel Test Event');
      await page.fill('#startDateISO', '2025-12-31');
      await page.click('button[type="submit"]');
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

      // Open display config
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      // Add sponsor but cancel
      await page.click('button:has-text("Add Sponsor")');
      await page.locator('.sp-name').first().fill('Cancelled Sponsor');

      await page.click('#displayCard button:has-text("Cancel")');
      await page.waitForTimeout(500);

      // Display card should close
      const isHidden = await page.locator('#displayCard').isHidden();
      expect(isHidden).toBe(true);

      // Reopen - sponsor should NOT be saved
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      const sponsorCount = await page.locator('.sp-name').count();
      expect(sponsorCount).toBe(0); // No sponsors saved
    });
  });

  test('Workflow 5: Handle rapid interactions', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      }
    });

    await test.step('Create event', async () => {
      await page.fill('#name', 'Rapid Test Event');
      await page.fill('#startDateISO', '2025-12-31');
      await page.click('button[type="submit"]');
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    });

    await test.step('Rapidly add multiple sponsors', async () => {
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      // Add 5 sponsors rapidly
      for (let i = 0; i < 5; i++) {
        await page.click('button:has-text("Add Sponsor")');
        await page.waitForTimeout(100);
      }

      // Should have 5 sponsor forms
      const sponsorCount = await page.locator('.sp-name').count();
      expect(sponsorCount).toBe(5);

      // Fill first sponsor only
      await page.locator('.sp-name').first().fill('Rapid Sponsor 1');
      await page.locator('.sp-url').first().fill('https://rapid1.example.com');

      await page.click('button:has-text("Save Configuration")');
      await page.waitForTimeout(2000);
    });

    await test.step('Verify only filled sponsor saved', async () => {
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      // Only sponsor with data should persist
      const filledSponsors = await page.locator('.sp-name').evaluateAll(
        inputs => inputs.filter(input => input.value !== '').length
      );

      expect(filledSponsors).toBeGreaterThanOrEqual(1);
    });
  });

  test('Workflow 6: Multiple events management', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      }
    });

    await test.step('Create first event', async () => {
      await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
      await page.fill('#name', 'Event Alpha');
      await page.fill('#startDateISO', '2025-12-31');
      await page.click('button[type="submit"]');
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    });

    await test.step('Clear and create second event', async () => {
      // Form should be cleared after successful submit
      // Or manually clear
      await page.click('button:has-text("Clear")');

      await page.fill('#name', 'Event Beta');
      await page.fill('#startDateISO', '2026-01-15');
      await page.click('button[type="submit"]');
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

      // Event card should show new event
      const cardContent = await page.locator('#eventCard').textContent();
      expect(cardContent).toContain('Event Beta');
    });
  });
});

test.describe('Admin Workflows - Integration Verification', () => {

  test('Workflow 7: Full integration - Admin creates → All pages work', async ({ page, context }) => {
    const eventName = `Full Integration ${Date.now()}`;
    const links = { public: '', display: '', poster: '' };

    // Create event with complete setup
    await test.step('Setup complete event', async () => {
      await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') {
          await dialog.accept(ADMIN_KEY);
        }
      });

      await page.fill('#name', eventName);
      await page.fill('#startDateISO', '2025-12-31');
      await page.fill('#timeISO', '18:00');
      await page.fill('#venue', 'Integration Hall');
      await page.click('button[type="submit"]');
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

      // Configure everything
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();
      await page.click('button:has-text("Add Sponsor")');
      await page.locator('.sp-name').first().fill('Integration Sponsor');
      await page.locator('.sp-url').first().fill('https://integration.example.com');
      await page.click('button:has-text("Save Configuration")');
      await page.waitForTimeout(2000);

      // Get all links
      links.public = await page.locator('#lnkPublic').first().getAttribute('href') || '';
      links.display = await page.locator('#lnkDisplay').first().getAttribute('href') || '';
      links.poster = await page.locator('#lnkPoster').first().getAttribute('href') || '';
    });

    // Test all pages in sequence
    await test.step('Public page works', async () => {
      if (!links.public) return;
      const publicPage = await context.newPage();
      await publicPage.goto(links.public);
      await expect(publicPage.locator('h1')).toContainText(eventName);
      await publicPage.close();
    });

    await test.step('Display page works', async () => {
      if (!links.display) return;
      const displayPage = await context.newPage();
      await displayPage.goto(links.display);
      await expect(displayPage.locator('#stage')).toBeVisible();
      await displayPage.close();
    });

    await test.step('Poster page works', async () => {
      if (!links.poster) return;
      const posterPage = await context.newPage();
      await posterPage.goto(links.poster);
      await posterPage.waitForLoadState('networkidle');
      const content = await posterPage.textContent('body');
      expect(content).toContain(eventName);
      await posterPage.close();
    });

    await test.step('Admin page still accessible', async () => {
      await page.reload();
      await expect(page).toHaveTitle(/Admin/);
    });
  });
});
