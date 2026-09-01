/**
 * PAGE TESTS - Level 2: Survey Form Page
 *
 * Purpose: Test the public survey form at /forms/{eventId}?type=survey
 * Coverage: Rating buttons, comments textarea, submission, success state
 *
 * Public page - no authentication required.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
// OSE-1004: survey SUBMISSION is Phase-2 gated (legal_clearance_tier >= 2). Target the
// synthetic Phase-2 fixture (evt_forms_phase2) so the code path is exercised, not 403'd.
const TEST_EVENT_ID = process.env.PHASE2_EVENT_ID || 'evt_forms_phase2';
const FORM_URL = `${BASE_URL}/forms/${TEST_EVENT_ID}?type=survey`;

test.describe('Survey Form - Page Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('page loads with survey container', async ({ page }) => {
    const container = page.locator('[data-testid="form-survey"]');
    await expect(container).toBeVisible();
  });

  test('survey form element is present', async ({ page }) => {
    const form = page.locator('[data-testid="survey-form"]');
    await expect(form).toBeVisible();
  });

  test('all 5 rating buttons are visible', async ({ page }) => {
    for (let i = 1; i <= 5; i++) {
      const ratingBtn = page.locator(`[data-testid="survey-rating-${i}"]`);
      await expect(ratingBtn).toBeVisible();
    }
  });

  test('comments textarea is present with maxlength 1000', async ({ page }) => {
    const comments = page.locator('[data-testid="survey-comments-input"]');
    await expect(comments).toBeVisible();
    await expect(comments).toHaveAttribute('maxlength', '1000');
  });

  test('submit button is visible', async ({ page }) => {
    const submit = page.locator('[data-testid="survey-submit"]');
    await expect(submit).toBeVisible();
  });

  test('privacy notice is visible', async ({ page }) => {
    const notice = page.locator('[data-testid="privacy-notice"]');
    await expect(notice).toBeVisible();
    const text = await notice.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});

test.describe('Survey Form - Rating Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('clicking rating 4 adds selected class', async ({ page }) => {
    const rating4 = page.locator('[data-testid="survey-rating-4"]');
    await rating4.click();
    await expect(rating4).toHaveClass(/selected/);
  });

  test('selecting a lower rating clears the higher ones (star fill)', async ({ page }) => {
    // OSE-1168: the overall rating is a cumulative STAR FILL, not a radio group —
    // form-pages.ts setRating(): `toggle('selected', i < val)` fills buttons 1..N and
    // submits a single value. So clicking a HIGHER rating keeps the lower ones filled;
    // deselection happens when you click a LOWER rating (it clears the ones above it).
    const rating3 = page.locator('[data-testid="survey-rating-3"]');
    const rating4 = page.locator('[data-testid="survey-rating-4"]');
    const rating5 = page.locator('[data-testid="survey-rating-5"]');

    // Fill to 5 → buttons 1..5 all selected; rating 3 stays filled (3 <= 5).
    await rating5.click();
    await expect(rating5).toHaveClass(/selected/);
    await expect(rating3).toHaveClass(/selected/);

    // Now pick a LOWER rating (3) → 4 and 5 clear; 1..3 remain.
    await rating3.click();
    await expect(rating3).toHaveClass(/selected/);
    await expect(rating4).not.toHaveClass(/selected/);
    await expect(rating5).not.toHaveClass(/selected/);
  });

  test('comments textarea accepts text input', async ({ page }) => {
    const comments = page.locator('[data-testid="survey-comments-input"]');
    await comments.fill('Great event, really enjoyed it!');
    await expect(comments).toHaveValue('Great event, really enjoyed it!');
  });
});

test.describe('Survey Form - Submission', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('submit with rating only shows success (comments optional)', async ({ page }) => {
    const rating4 = page.locator('[data-testid="survey-rating-4"]');
    await rating4.click();

    const submit = page.locator('[data-testid="survey-submit"]');
    await submit.click();

    const success = page.locator('[data-testid="form-success"]');
    await expect(success).toBeVisible({ timeout: 10000 });
  });

  test('submit with rating and comments shows success', async ({ page }) => {
    const rating5 = page.locator('[data-testid="survey-rating-5"]');
    await rating5.click();

    const comments = page.locator('[data-testid="survey-comments-input"]');
    await comments.fill('Excellent event, would attend again.');

    const submit = page.locator('[data-testid="survey-submit"]');
    await submit.click();

    const success = page.locator('[data-testid="form-success"]');
    await expect(success).toBeVisible({ timeout: 10000 });
  });

  test('API call sends correct payload', async ({ page }) => {
    const apiPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/v2/events/${TEST_EVENT_ID}/forms/survey`) &&
        req.method() === 'POST'
    );

    const rating4 = page.locator('[data-testid="survey-rating-4"]');
    await rating4.click();

    const comments = page.locator('[data-testid="survey-comments-input"]');
    await comments.fill('Good event');

    const submit = page.locator('[data-testid="survey-submit"]');
    await submit.click();

    const request = await apiPromise;
    const body = request.postDataJSON();
    expect(body).toHaveProperty('responses');
    expect(body.responses).toHaveProperty('overall', 4);
    expect(body.responses).toHaveProperty('comments', 'Good event');
  });
});
