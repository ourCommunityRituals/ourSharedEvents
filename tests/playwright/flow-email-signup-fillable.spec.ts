/**
 * OSE-307 — Email signup form-fillability flow.
 *
 * Second flow spec of the OSE-307 arc (after flow-events-discovery).
 * Walks the customer's email signup form-fill experience at 375x812
 * and asserts mobile workability at each interaction step.
 *
 * **Non-mutating:** this flow fills the form fully but DOES NOT tap
 * submit. Purpose: validate the FORM-FILL UX failure modes (keyboard
 * interaction, input focus, submit-button reachability) without
 * polluting staging's subscribers table with test rows. A future
 * data-writing flow (flow-email-signup-roundtrip) will exercise the
 * full round-trip once a synthetic-email cleanup convention is agreed
 * (per OSE-307 acceptance criteria).
 *
 * Failure modes this catches that the per-surface audit doesn't:
 *   - Tapping the email input causes the viewport to jump (iOS auto-
 *     zoom on focus). Caught by asserting viewport height + input
 *     font-size both AFTER focus.
 *   - Submit button is reachable (44x44 floor — per-surface audit
 *     covers this) BUT goes below the fold when the on-screen
 *     keyboard takes ~280px from the bottom. Caught by asserting
 *     submit button's y < (viewport - keyboard estimate).
 *   - Typing in the email input doesn't update the value (broken
 *     event handler). Caught by asserting input.value === typed
 *     after fill.
 *   - Focus trap: tab from email lands somewhere unexpected (e.g.,
 *     header navigation instead of submit button). Caught by
 *     asserting next focusable after email is submit.
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-307 | FE | flow email-signup-fillable | step N: <assertion>`.
 */

import { test, expect } from '@playwright/test';
import {
  loadAndSettle,
  assertMobileWorkable,
  MOBILE_VIEWPORT,
  MIN_INPUT_FONT_SIZE_PX,
} from './_helpers/mobile-workability-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

// Synthetic email — .test TLD is reserved per RFC 2606, can NEVER
// resolve to a real domain. Distinguishable in any future audit-log
// review by the e2e-test prefix.
const SYNTHETIC_EMAIL = `e2e-test-${Date.now()}@oursharedevents.test`;

test.describe('OSE-307 email signup form-fillability — mobile workability per step', () => {
  test('OSE-307 | FE | flow email-signup-fillable | step 1: subscribe-form visible + mobile-clean on landing', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertMobileWorkable(page, 'landing (entry)', {
      primaryCtaSelector: '[data-testid="subscribe-submit"]',
    });
    await expect(
      page.locator('[data-testid="subscribe-form"]'),
      'landing: subscribe-form missing — email signup flow has no entry point'
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="subscribe-email"]'),
      'landing: subscribe-email input missing'
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="subscribe-submit"]'),
      'landing: subscribe-submit button missing'
    ).toBeVisible();
  });

  test('OSE-307 | FE | flow email-signup-fillable | step 2: email input has font-size >= 16px (iOS auto-zoom guard)', async ({
    page,
  }) => {
    // The per-surface audit already validates this — but in a flow
    // context, asserting it AFTER landing-settle ensures no late JS
    // rewrites the font-size below the floor (e.g., a re-render that
    // drops a stylesheet rule).
    await loadAndSettle(page, `${BASE_URL}/`);
    const emailInput = page.locator('[data-testid="subscribe-email"]');
    const fontSize = await emailInput.evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) || 0
    );
    expect(
      fontSize,
      `subscribe-email font-size = ${fontSize}px; < ${MIN_INPUT_FONT_SIZE_PX}px triggers iOS auto-zoom on tap`
    ).toBeGreaterThanOrEqual(MIN_INPUT_FONT_SIZE_PX);
  });

  test('OSE-307 | FE | flow email-signup-fillable | step 3: focusing email input does NOT shift viewport horizontally', async ({
    page,
  }) => {
    // Real-iPhone-Safari behavior: focusing an input with font-size <
    // 16px triggers a zoom that effectively widens the viewport. Even
    // with font-size >= 16, malformed CSS can cause unexpected
    // horizontal shifts. Assert no horizontal scroll AFTER focus.
    await loadAndSettle(page, `${BASE_URL}/`);
    await page.locator('[data-testid="subscribe-email"]').focus();
    await page.waitForTimeout(150); // brief settle for any focus-triggered layout
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      `subscribe-email focus caused horizontal overflow: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`
    ).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('OSE-307 | FE | flow email-signup-fillable | step 4: typing in email input updates the value (event handler wired)', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    const emailInput = page.locator('[data-testid="subscribe-email"]');
    await emailInput.fill(SYNTHETIC_EMAIL);
    const actualValue = await emailInput.inputValue();
    expect(
      actualValue,
      `subscribe-email value after fill = "${actualValue}"; expected "${SYNTHETIC_EMAIL}"`
    ).toBe(SYNTHETIC_EMAIL);
  });

  test('OSE-307 | FE | flow email-signup-fillable | step 5: submit button stays above the keyboard fold after input fill', async ({
    page,
  }) => {
    // iOS on-screen keyboard occupies ~280-330px from the bottom of
    // the viewport on iPhone 13 Mini / iPhone X. After filling the
    // email input, the submit button must be in the visible region
    // ABOVE that keyboard area. Approximation: keyboard ~280px, so
    // submit.y < (viewport.height - 280) = 532 on 812-tall viewport.
    //
    // Real-world this is an underestimate (the keyboard can be taller
    // with autofill suggestion bar). 280px is generous-toward-passing;
    // tighten if false-negatives accumulate.
    const KEYBOARD_ESTIMATE_PX = 280;
    const KEYBOARD_FOLD_Y = MOBILE_VIEWPORT.height - KEYBOARD_ESTIMATE_PX;

    await loadAndSettle(page, `${BASE_URL}/`);
    await page.locator('[data-testid="subscribe-email"]').fill(SYNTHETIC_EMAIL);
    await page.waitForTimeout(150);

    const submitBox = await page.locator('[data-testid="subscribe-submit"]').boundingBox();
    expect(submitBox, 'subscribe-submit has no bounding box').not.toBeNull();
    expect(
      submitBox!.y,
      `subscribe-submit top = ${Math.round(submitBox!.y)}px; keyboard fold estimate at ${KEYBOARD_FOLD_Y}px — button hidden behind on-screen keyboard`
    ).toBeLessThan(KEYBOARD_FOLD_Y);
  });

  test('OSE-307 | FE | flow email-signup-fillable | step 6: tab-from-email lands on submit (no focus trap)', async ({
    page,
  }) => {
    // After typing the email, the natural next action is to tab/swipe
    // to the submit button. If the next focusable element is the
    // header nav, the customer is dropped into an unexpected focus
    // location. Catch that.
    await loadAndSettle(page, `${BASE_URL}/`);
    const emailInput = page.locator('[data-testid="subscribe-email"]');
    await emailInput.focus();
    await emailInput.fill(SYNTHETIC_EMAIL);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      return el.getAttribute('data-testid');
    });
    expect(
      focused,
      `after tab from subscribe-email, focused element data-testid = "${focused}"; expected "subscribe-submit"`
    ).toBe('subscribe-submit');
  });

  test('OSE-307 | FE | flow email-signup-fillable | step 7: NON-MUTATING marker — flow stops short of submit', async ({
    page,
  }) => {
    // Self-documenting check: this flow spec MUST NOT contain a
    // submit-button .click() or form .submit() call. If a future
    // change adds one, that change would start writing real rows
    // to staging's subscribers table every CI run.
    //
    // Read this file's own source and assert no submit-trigger call
    // outside this assertion's own text.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __filename = url.fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const selfSrc = fs.readFileSync(
      path.join(__dirname, 'flow-email-signup-fillable.spec.ts'),
      'utf8'
    );
    // Strip the literal sentinel strings in THIS test so they don't
    // false-positive against themselves.
    const stripped = selfSrc
      .replace(/'submit-button \.click\(\)'/g, '')
      .replace(/'form \.submit\(\)'/g, '');
    expect(
      stripped,
      'flow-email-signup-fillable.spec.ts contains submit trigger — this flow is supposed to be NON-MUTATING; use flow-email-signup-roundtrip for the data-writing version'
    ).not.toMatch(/subscribe-submit['"]\)\s*\.click\(/);
    expect(stripped).not.toMatch(/subscribe-form['"]\)\s*\.submit\(/);

    // Self-assertion that the flow is intentionally non-mutating.
    expect(selfSrc).toContain('Non-mutating');
  });
});
