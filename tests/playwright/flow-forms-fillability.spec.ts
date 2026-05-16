/**
 * OSE-312 — /forms/:id?type=<...> form fillability flows (4 variations).
 *
 * Walks each of the 4 form-type customer journeys at 375x812 and asserts
 * mobile workability + form-fill UX at each step. Third flow spec in the
 * OSE-307 arc, after flow-events-discovery.spec.ts and
 * flow-email-signup-fillable.spec.ts.
 *
 * The 4 form variations all share the /forms/:id?type=<...> URL contract
 * but render different inputs:
 *   - register      → name + email inputs, register-submit button
 *   - checkin       → no inputs, big checkin-submit tap button + count display
 *   - survey        → 5 rating buttons (survey-rating-1..5) + comments textarea + survey-submit
 *   - email-signup  → name + email inputs (same shape as register), register-submit button
 *
 * **Non-mutating:** every form spec fills + interacts but DOES NOT tap submit.
 * Reasons:
 *   - register would create form_registration rows on staging
 *   - checkin would increment checkin_counts for the event
 *   - survey would create form_surveys rows
 *   - email-signup would create form_registrations rows
 *
 * Submission round-trip tests will ship as separate data-writing specs
 * once a synthetic-fixture cleanup convention is agreed (per OSE-307
 * acceptance criteria). For now, validate the FORM-FILL UX failure
 * modes that the per-surface mobile-workability audit doesn't reach:
 *
 *   - Tapping an input causes the viewport to jump (iOS auto-zoom)
 *   - Submit button reachable per 44px floor BUT hidden behind on-screen
 *     keyboard (keyboard estimate: ~280px from viewport bottom)
 *   - Typing in input doesn't update the value (broken event handler)
 *   - Survey ratings — tapping a rating button updates the .selected
 *     state (visual feedback works)
 *
 * Each form-type test runs independently with its own page context.
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-312 | FE | flow forms-<type> | step N: <assertion>`.
 *
 * Uses test-event-001 (the seeded staging fixture). If it ever gets
 * removed from staging, these specs will need an alternative event ID.
 */

import { test, expect } from '@playwright/test';
import {
  loadAndSettle,
  assertMobileWorkable,
  MOBILE_VIEWPORT,
  MIN_INPUT_FONT_SIZE_PX,
} from './_helpers/mobile-workability-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const EVENT_ID = 'test-event-001';

const KEYBOARD_ESTIMATE_PX = 280;
const KEYBOARD_FOLD_Y = MOBILE_VIEWPORT.height - KEYBOARD_ESTIMATE_PX;

const SYNTHETIC_NAME = `e2e-test-${Date.now()}`;
const SYNTHETIC_EMAIL = `e2e-test-${Date.now()}@oursharedevents.test`;
const SYNTHETIC_COMMENT = `e2e-test synthetic comment ${Date.now()}`;

// ─── Register form ──────────────────────────────────────────────────────────

test.describe('OSE-312 forms /register fillability — mobile workability per step', () => {
  const PATH = `/forms/${EVENT_ID}?type=register`;

  test('OSE-312 | FE | flow forms-register | step 1: register-form visible + mobile-clean', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertMobileWorkable(page, '/forms/:id?type=register', {
      primaryCtaSelector: '[data-testid="register-submit"]',
    });
    await expect(page.locator('[data-testid="register-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-submit"]')).toBeVisible();
  });

  test('OSE-312 | FE | flow forms-register | step 2: name + email inputs hit 16px font-size floor (iOS auto-zoom guard)', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    for (const testid of ['register-name-input', 'register-email-input']) {
      const fontSize = await page
        .locator(`[data-testid="${testid}"]`)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) || 0);
      expect(
        fontSize,
        `${testid} font-size = ${fontSize}px; < ${MIN_INPUT_FONT_SIZE_PX}px triggers iOS auto-zoom`
      ).toBeGreaterThanOrEqual(MIN_INPUT_FONT_SIZE_PX);
    }
  });

  test('OSE-312 | FE | flow forms-register | step 3: typing in name + email updates values (event handlers wired)', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    const nameInput = page.locator('[data-testid="register-name-input"]');
    const emailInput = page.locator('[data-testid="register-email-input"]');
    await nameInput.fill(SYNTHETIC_NAME);
    await emailInput.fill(SYNTHETIC_EMAIL);
    expect(await nameInput.inputValue()).toBe(SYNTHETIC_NAME);
    expect(await emailInput.inputValue()).toBe(SYNTHETIC_EMAIL);
  });

  test('OSE-312 | FE | flow forms-register | step 4: register-submit stays above keyboard fold after fill', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await page.locator('[data-testid="register-name-input"]').fill(SYNTHETIC_NAME);
    await page.locator('[data-testid="register-email-input"]').fill(SYNTHETIC_EMAIL);
    await page.waitForTimeout(150);
    const submitBox = await page.locator('[data-testid="register-submit"]').boundingBox();
    expect(submitBox).not.toBeNull();
    expect(
      submitBox!.y,
      `register-submit top = ${Math.round(submitBox!.y)}px; keyboard fold estimate ${KEYBOARD_FOLD_Y}px`
    ).toBeLessThan(KEYBOARD_FOLD_Y);
  });
});

// ─── Check-in form ──────────────────────────────────────────────────────────

test.describe('OSE-312 forms /checkin tappability — mobile workability per step', () => {
  const PATH = `/forms/${EVENT_ID}?type=checkin`;

  test('OSE-312 | FE | flow forms-checkin | step 1: checkin-submit tap button visible + mobile-clean', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertMobileWorkable(page, '/forms/:id?type=checkin', {
      primaryCtaSelector: '[data-testid="checkin-submit"]',
      // Check-in has no fillable inputs; skip the font-size assertion.
      skipInputFontSize: true,
    });
    await expect(page.locator('[data-testid="checkin-submit"]')).toBeVisible();
    await expect(page.locator('[data-testid="checkin-count"]')).toBeVisible();
  });

  test('OSE-312 | FE | flow forms-checkin | step 2: checkin-submit is a large tap target (>= 44x44, ideally larger)', async ({
    page,
  }) => {
    // The check-in flow is a SINGLE tap. The button is the primary
    // mode of interaction — should be MORE than the minimum.
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    const box = await page.locator('[data-testid="checkin-submit"]').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
  });

  test('OSE-312 | FE | flow forms-checkin | step 3: checkin-submit is above the fold on entry', async ({
    page,
  }) => {
    // Check-in flow is one-tap — the button MUST be visible on entry,
    // no scroll required.
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    const box = await page.locator('[data-testid="checkin-submit"]').boundingBox();
    expect(box).not.toBeNull();
    expect(
      box!.y,
      `checkin-submit top = ${Math.round(box!.y)}px > viewport height ${MOBILE_VIEWPORT.height}px`
    ).toBeLessThan(MOBILE_VIEWPORT.height);
  });
});

// ─── Survey form ────────────────────────────────────────────────────────────

test.describe('OSE-312 forms /survey fillability — mobile workability per step', () => {
  const PATH = `/forms/${EVENT_ID}?type=survey`;

  test('OSE-312 | FE | flow forms-survey | step 1: survey-form + 5 rating buttons + comments visible + mobile-clean', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertMobileWorkable(page, '/forms/:id?type=survey', {
      primaryCtaSelector: '[data-testid="survey-submit"]',
    });
    await expect(page.locator('[data-testid="survey-form"]')).toBeVisible();
    for (let i = 1; i <= 5; i++) {
      await expect(
        page.locator(`[data-testid="survey-rating-${i}"]`),
        `survey-rating-${i} not visible`
      ).toBeVisible();
    }
    await expect(page.locator('[data-testid="survey-comments-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="survey-submit"]')).toBeVisible();
  });

  test('OSE-312 | FE | flow forms-survey | step 2: tapping a rating button updates its visual state', async ({
    page,
  }) => {
    // The 5 rating buttons should give visual feedback when tapped
    // (typically via a .selected class). Without the feedback the
    // customer doesn't know which rating they picked.
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    const rating4 = page.locator('[data-testid="survey-rating-4"]');
    await rating4.click();
    await page.waitForTimeout(100);
    const className = await rating4.getAttribute('class');
    expect(
      className,
      `survey-rating-4 className after tap = "${className}"; expected to contain "selected"`
    ).toMatch(/selected/);
  });

  test('OSE-312 | FE | flow forms-survey | step 3: comments textarea accepts text input', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    const comments = page.locator('[data-testid="survey-comments-input"]');
    await comments.fill(SYNTHETIC_COMMENT);
    expect(await comments.inputValue()).toBe(SYNTHETIC_COMMENT);
  });

  test('OSE-312 | FE | flow forms-survey | step 4: survey-submit stays above keyboard fold after comments fill', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await page.locator('[data-testid="survey-rating-3"]').click();
    await page.locator('[data-testid="survey-comments-input"]').fill(SYNTHETIC_COMMENT);
    await page.waitForTimeout(150);
    const submitBox = await page.locator('[data-testid="survey-submit"]').boundingBox();
    expect(submitBox).not.toBeNull();
    expect(
      submitBox!.y,
      `survey-submit top = ${Math.round(submitBox!.y)}px; keyboard fold ${KEYBOARD_FOLD_Y}px`
    ).toBeLessThan(KEYBOARD_FOLD_Y);
  });
});

// ─── Email-signup form ──────────────────────────────────────────────────────
// NOTE: this is the /forms route's email-signup variant (uses register-*
// testids — the form shape is shared with register). NOT to be confused
// with flow-email-signup-fillable.spec.ts which tests the LANDING page's
// subscribe-form (different surface, different testids).

test.describe('OSE-312 forms /email-signup fillability — mobile workability per step', () => {
  const PATH = `/forms/${EVENT_ID}?type=email-signup`;

  test('OSE-312 | FE | flow forms-email-signup | step 1: email-signup form (register-* shape) visible + mobile-clean', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertMobileWorkable(page, '/forms/:id?type=email-signup', {
      primaryCtaSelector: '[data-testid="register-submit"]',
    });
    await expect(page.locator('[data-testid="register-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-email-input"]')).toBeVisible();
  });

  test('OSE-312 | FE | flow forms-email-signup | step 2: name + email inputs hit 16px font-size floor', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    for (const testid of ['register-name-input', 'register-email-input']) {
      const fontSize = await page
        .locator(`[data-testid="${testid}"]`)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) || 0);
      expect(fontSize).toBeGreaterThanOrEqual(MIN_INPUT_FONT_SIZE_PX);
    }
  });

  test('OSE-312 | FE | flow forms-email-signup | step 3: filling email + tapping submit stays above keyboard fold', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await page.locator('[data-testid="register-name-input"]').fill(SYNTHETIC_NAME);
    await page.locator('[data-testid="register-email-input"]').fill(SYNTHETIC_EMAIL);
    await page.waitForTimeout(150);
    const submitBox = await page.locator('[data-testid="register-submit"]').boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.y).toBeLessThan(KEYBOARD_FOLD_Y);
  });
});

// ─── NON-MUTATING marker (cross-form) ───────────────────────────────────────

test.describe('OSE-312 forms fillability — non-mutating contract', () => {
  test('OSE-312 | FE | flow forms-fillability | non-mutating marker: no submit-trigger calls in this file', async () => {
    // Self-policing: if a future change adds .click() on any *-submit
    // testid OR .submit() on any *-form testid in THIS file, the
    // flow starts writing to staging on every CI run. This test
    // reads its own source and forbids that pattern.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __filename = url.fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const selfSrc = fs.readFileSync(path.join(__dirname, 'flow-forms-fillability.spec.ts'), 'utf8');
    // Strip block comments + line comments so the doc-comment sentinels
    // above don't false-positive against themselves.
    const stripped = selfSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // Forbid clicking any *-submit testid (register-submit, checkin-
    // submit, survey-submit). survey-rating-* clicks are OK — those
    // are non-mutating visual-state taps.
    expect(
      stripped,
      'flow-forms-fillability.spec.ts contains *-submit click — would write data to staging'
    ).not.toMatch(/['"]\[data-testid="(register|checkin|survey)-submit"\]['"]\s*\)\s*\.click\(/);
    // Forbid .submit() on any *-form testid.
    expect(stripped).not.toMatch(
      /['"]\[data-testid="(register|survey)-form"\]['"]\s*\)\s*\.submit\(/
    );
  });
});
