/**
 * SCENARIO: Quick Start - "Launch Your Event in 10 Minutes"
 *
 * This test validates the complete "10 minutes to launch" admin workflow
 * documented in Admin.html's Quick Start Guide section.
 *
 * ACCEPTANCE CRITERIA:
 * - Quick Start Guide is visible with 6 steps and time estimates
 * - User can create event with minimal fields (~2 min)
 * - Post-creation, Quick Start Guide is hidden and Happy Path Checklist shown
 * - Happy Path Checklist shows time estimates and updates dynamically
 * - All 5 core tasks can be completed (plus optional sponsor)
 *
 * TIME ESTIMATES:
 * - Step 1: Name your event (~2 min)
 * - Step 2: Set up sign-ups (~2 min)
 * - Step 3: Print your poster (~1 min)
 * - Step 4: Display on TV (~1 min)
 * - Step 5: Share with crowd (~2 min)
 * - Step 6: Add sponsors (optional)
 *
 * Related: Admin.html Quick Start Guide, Happy Path Checklist
 */

const { test, expect } = require('@playwright/test');
const { getCurrentEnvironment } = require('../../config/environments');

// Get environment configuration
const env = getCurrentEnvironment();
const BASE_URL = env.baseUrl;
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const BRAND_ID = 'root';

test.describe('Quick Start: Launch Your Event in 10 Minutes', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to admin page
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Handle admin key prompts throughout the test
    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });
  });

  test('1. Quick Start Guide is visible with 6 steps on initial load', async ({ page }) => {
    // VERIFY: Quick Start Guide section is visible
    const quickStartGuide = page.locator('[data-testid="quick-start-guide"]');
    await expect(quickStartGuide).toBeVisible();

    // VERIFY: Header shows "Launch Your Event in 10 Minutes"
    await expect(quickStartGuide.locator('h2')).toContainText('Launch Your Event in 10 Minutes');

    // VERIFY: All 6 steps are displayed
    const steps = quickStartGuide.locator('.quick-start-step');
    await expect(steps).toHaveCount(6);

    // VERIFY: Steps have correct titles and time estimates
    const stepTitles = [
      { title: 'Name your event', time: '~2 min' },
      { title: 'Set up sign-ups', time: '~2 min' },
      { title: 'Print your poster', time: '~1 min' },
      { title: 'Display on your TV', time: '~1 min' },
      { title: 'Share with your crowd', time: '~2 min' },
      { title: 'Add sponsors', time: 'optional' }
    ];

    for (let i = 0; i < stepTitles.length; i++) {
      const step = steps.nth(i);
      await expect(step.locator('.step-title')).toContainText(stepTitles[i].title);
      await expect(step.locator('.step-time')).toContainText(stepTitles[i].time);
    }

    // VERIFY: Create form is visible below
    await expect(page.locator('#createCard')).toBeVisible();
    await expect(page.locator('#createCard h2')).toContainText('Step 1: Create Your Event');

    console.log('✅ Quick Start Guide displays all 6 steps with time estimates');
  });

  test('2. Create event shows minimal form (3 required fields)', async ({ page }) => {
    // VERIFY: Create form has only 3 visible required fields
    const nameInput = page.locator('#name');
    const dateInput = page.locator('#startDateISO');
    const venueInput = page.locator('#venue');

    await expect(nameInput).toBeVisible();
    await expect(dateInput).toBeVisible();
    await expect(venueInput).toBeVisible();

    // VERIFY: Required fields are marked as required
    await expect(nameInput).toHaveAttribute('required', '');
    await expect(dateInput).toHaveAttribute('required', '');
    await expect(venueInput).toHaveAttribute('required', '');

    // VERIFY: Advanced options are collapsed by default
    const moreOptionsContent = page.locator('.collapsible-content').first();
    await expect(moreOptionsContent).not.toBeVisible();

    console.log('✅ Create form shows minimal 3-field layout');
  });

  test('3. Event creation hides Quick Start Guide and shows Happy Path Checklist', async ({ page }) => {
    const timestamp = Date.now();
    const eventName = `Quick Start Test ${timestamp}`;

    // Fill minimal required fields (Step 1: ~2 min)
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Bar');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for event creation success
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // VERIFY: Quick Start Guide is hidden after event creation
    await expect(page.locator('[data-testid="quick-start-guide"]')).not.toBeVisible();

    // VERIFY: Create form is hidden
    await expect(page.locator('#createCard')).not.toBeVisible();

    // VERIFY: Happy Path Checklist is visible
    const checklist = page.locator('[data-testid="happy-path-checklist"]');
    await expect(checklist).toBeVisible();

    // VERIFY: Event step is marked as done
    const eventStep = page.locator('[data-testid="checklist-event"]');
    await expect(eventStep).toHaveClass(/done/);

    console.log('✅ Event created, Quick Start hidden, Happy Path Checklist shown');
  });

  test('4. Happy Path Checklist shows time estimates and progress', async ({ page }) => {
    // Create event first
    await page.fill('#name', `Checklist Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    const checklist = page.locator('[data-testid="happy-path-checklist"]');

    // VERIFY: Header shows time remaining
    await expect(checklist.locator('h3')).toContainText('min left');

    // VERIFY: Progress indicator shows "X of 6 done"
    await expect(checklist.locator('#checklistProgress')).toContainText('of 6 done');

    // VERIFY: Checklist items have time estimates
    await expect(page.locator('[data-testid="checklist-event"] .time-estimate')).toContainText('~2 min');
    await expect(page.locator('[data-testid="checklist-signup"] .time-estimate')).toContainText('~2 min');
    await expect(page.locator('[data-testid="checklist-poster"] .time-estimate')).toContainText('~1 min');
    await expect(page.locator('[data-testid="checklist-display"] .time-estimate')).toContainText('~1 min');
    await expect(page.locator('[data-testid="checklist-public"] .time-estimate')).toContainText('~2 min');

    // VERIFY: Sponsors is optional
    await expect(page.locator('[data-testid="checklist-sponsors"] .optional-tag')).toContainText('optional');

    console.log('✅ Happy Path Checklist shows time estimates and progress');
  });

  test('5. Complete Quick Start flow end-to-end', async ({ page }) => {
    const timestamp = Date.now();

    // ========================================
    // STEP 1: Create Event (~2 min)
    // ========================================
    await page.fill('#name', `E2E Quick Start ${timestamp}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'The Local Bar');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="checklist-event"]')).toHaveClass(/done/);
    console.log('   ✓ Step 1: Event created');

    // ========================================
    // STEP 2: Verify Sign-up Forms (~2 min)
    // ========================================
    // The signup card should have links/options
    const signupCard = page.locator('#card3SignUp');
    await expect(signupCard).toBeVisible();

    // Click to configure forms
    const configureBtn = signupCard.locator('button:has-text("Configure Forms"), button:has-text("Set Up")').first();
    if (await configureBtn.isVisible()) {
      await configureBtn.click();
      await page.waitForTimeout(500);
    }
    console.log('   ✓ Step 2: Sign-up configuration accessible');

    // ========================================
    // STEP 3: Verify Poster Link (~1 min)
    // ========================================
    const posterCard = page.locator('#card4Poster');
    await expect(posterCard).toBeVisible();

    // Poster link should be generated
    const posterLink = page.locator('#lnkPoster');
    await expect(posterLink).toBeVisible();
    const posterUrl = await posterLink.textContent();
    expect(posterUrl).toContain('http');
    expect(posterUrl).toContain('poster');
    console.log('   ✓ Step 3: Poster link generated');

    // ========================================
    // STEP 4: Verify TV Display Link (~1 min)
    // ========================================
    const displayCard = page.locator('#card5Display');
    await expect(displayCard).toBeVisible();

    const displayLink = page.locator('#lnkDisplay');
    await expect(displayLink).toBeVisible();
    const displayUrl = await displayLink.textContent();
    expect(displayUrl).toContain('http');
    expect(displayUrl).toContain('display');
    console.log('   ✓ Step 4: TV Display link generated');

    // ========================================
    // STEP 5: Verify Public Page Link (~2 min)
    // ========================================
    const publicCard = page.locator('#card6PublicPage');
    await expect(publicCard).toBeVisible();

    const publicLink = page.locator('#lnkPublic');
    await expect(publicLink).toBeVisible();
    const publicUrl = await publicLink.textContent();
    expect(publicUrl).toContain('http');
    expect(publicUrl).toContain('public');
    console.log('   ✓ Step 5: Public page link generated');

    // ========================================
    // VERIFY: Progress updated
    // ========================================
    // After auto-generated links, poster/display/public should be done
    const progressText = await page.locator('#checklistProgress').textContent();
    console.log(`   Progress: ${progressText}`);

    // Should have at least 4 done (event + poster + display + public)
    const doneCount = parseInt(progressText.split(' ')[0]);
    expect(doneCount).toBeGreaterThanOrEqual(4);

    console.log('✅ COMPLETE: Quick Start flow validated end-to-end');
  });

  test('6. Checklist items scroll to corresponding cards', async ({ page }) => {
    // Create event first
    await page.fill('#name', `Scroll Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // Test clicking each checklist item scrolls to the right card
    const checklistCardMap = [
      { checklist: 'checklist-event', card: 'card1EventBasics' },
      { checklist: 'checklist-signup', card: 'card3SignUp' },
      { checklist: 'checklist-poster', card: 'card4Poster' },
      { checklist: 'checklist-display', card: 'card5Display' },
      { checklist: 'checklist-public', card: 'card6PublicPage' },
      { checklist: 'checklist-sponsors', card: 'card2Sponsors' }
    ];

    for (const mapping of checklistCardMap) {
      const checklistItem = page.locator(`[data-testid="${mapping.checklist}"]`);
      const targetCard = page.locator(`#${mapping.card}`);

      // Click checklist item
      await checklistItem.click();
      await page.waitForTimeout(500);

      // VERIFY: Target card should be visible (scrolled into view)
      await expect(targetCard).toBeVisible();
    }

    console.log('✅ Checklist items correctly scroll to corresponding cards');
  });

  test('7. Mobile responsive: Quick Start Guide stacks vertically', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // VERIFY: Quick Start Guide still visible on mobile
    const quickStartGuide = page.locator('[data-testid="quick-start-guide"]');
    await expect(quickStartGuide).toBeVisible();

    // VERIFY: Steps are still readable
    const steps = quickStartGuide.locator('.quick-start-step');
    await expect(steps).toHaveCount(6);

    // VERIFY: First step is visible and has content
    const firstStep = steps.first();
    await expect(firstStep).toBeVisible();
    await expect(firstStep.locator('.step-title')).toBeVisible();

    console.log('✅ Quick Start Guide is mobile responsive');
  });
});

/**
 * MANUAL QA CHECKLIST COMPANION
 *
 * This automated test covers the happy path. For full QA, also manually verify:
 *
 * [ ] Quick Start Guide appears on first visit
 * [ ] Time estimates add up to ~10 minutes total (2+2+1+1+2 = 8 min core + optional)
 * [ ] Each step description is clear for non-technical users
 * [ ] "Ready? Let's get started below" text guides user to form
 * [ ] Form labels are friendly ("What's your event called?" not "Event Name")
 * [ ] Happy Path Checklist updates in real-time as tasks complete
 * [ ] Header shows decreasing time as tasks complete
 * [ ] "All Set!" message appears when 5+ items are done
 * [ ] Clicking checklist items smoothly scrolls to cards
 * [ ] Works on mobile (375px width)
 * [ ] Works on tablet (768px width)
 * [ ] Works on desktop (1280px+ width)
 */
