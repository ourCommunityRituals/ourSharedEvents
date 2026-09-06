/**
 * Component/viewport tests: /q form-pages — RESPONSIVE LAYOUT (data-less)
 *
 * OSE-1071 (S2.2): move mobile-viewport/responsive coverage for the
 * mobile-primary surfaces off live-E2E and onto the COMPONENT tier
 * (playwright.component.config.ts — local `wrangler dev --local`, real
 * Chromium + WebKit, every PR). This file covers the `/q` form-pages surface
 * (register / checkin / survey); the public `/` landing breakpoints are a
 * fast follow-up.
 *
 * DATA-LESS BY CONSTRUCTION. handleFormPage's DB binding is optional
 * ("compatible with test environments that don't bind DB", form-pages.ts:26-28):
 * the form SHELL renders regardless of D1, and event existence is validated at
 * POST, not GET. So these specs assert layout on the local (unseeded) worker
 * without the OSE-1228 "no such table: events" false-green trap — no row is read.
 *
 * WHAT IS ASSERTED, AND WHY IT IS MUTATION-MEANINGFUL. The responsive contract
 * is one CSS rule in the form shell (form-pages.ts):
 *     main { max-width: 480px; margin: 0 auto; padding: 1.5rem 1rem }
 *     *, *::before, *::after { box-sizing: border-box }
 * Mobile-first fluid: full-width under 480px, capped-and-centred above it — no
 * @media needed. The assertions read that rule back off the rendered box:
 *   - revert `max-width: 480px`  → the container fills the desktop viewport →
 *     the "capped" and "centred" assertions fail.
 *   - revert `margin: 0 auto`    → the container is 480px but left-aligned →
 *     the "centred" assertion fails.
 * Single-viewport workability (44px targets, 16px inputs, no h-scroll @375) is
 * OSE-1236's job; this file proves the layout stays sane ACROSS widths.
 *
 * Source of truth: workers/oursharedevents/src/handlers/form-pages.ts
 * Data-testids: form-main, form-register, form-checkin, form-survey,
 *   register-name-input, checkin-submit, register-submit
 */

import { test, expect, type Page } from '@playwright/test';

// A well-formed event id. The row need not exist — the shell renders either way
// (see header). Same id the mobile-workability audit uses against a local worker.
const EVENT = 'evt_test_2026';

const FORM_TYPES = ['register', 'checkin', 'survey'] as const;

// Breakpoints straddling the 480px cap: one below (fills), two above (capped +
// centred). 375 workability is covered elsewhere; these prove reflow behaviour.
const WIDTHS = [
  { label: 'small phone', width: 360, height: 800, fills: true },
  { label: 'tablet', width: 768, height: 1024, fills: false },
  { label: 'desktop', width: 1280, height: 800, fills: false },
] as const;

const CAP = 480; // main { max-width: 480px }
const TYPE_TESTID: Record<(typeof FORM_TYPES)[number], string> = {
  register: 'form-register',
  checkin: 'form-checkin',
  survey: 'form-survey',
};

async function gotoForm(page: Page, type: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const res = await page.goto(`/forms/${EVENT}?type=${type}`);
  expect(res?.status(), `/forms/${EVENT}?type=${type} should render (200)`).toBe(200);
}

for (const type of FORM_TYPES) {
  test.describe(`Form page /q?type=${type} — responsive container`, () => {
    for (const bp of WIDTHS) {
      test(`${bp.label} (${bp.width}px): shell renders and the form is visible`, async ({
        page,
      }) => {
        await gotoForm(page, type, bp.width, bp.height);
        await expect(page.getByTestId('form-main')).toBeVisible();
        await expect(page.getByTestId(TYPE_TESTID[type])).toBeVisible();
      });

      test(`${bp.label} (${bp.width}px): no horizontal scroll`, async ({ page }) => {
        await gotoForm(page, type, bp.width, bp.height);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        // Allow 1px for sub-pixel rounding; anything more is a real x-overflow.
        expect(overflow, 'the page must not scroll sideways at any width').toBeLessThanOrEqual(1);
      });

      test(`${bp.label} (${bp.width}px): container is ${
        bp.fills ? 'full-width (fluid)' : 'capped at 480px and centred'
      }`, async ({ page }) => {
        await gotoForm(page, type, bp.width, bp.height);
        const box = await page.getByTestId('form-main').boundingBox();
        expect(box, 'form-main must have a layout box').not.toBeNull();
        if (!box) return;

        // Never wider than the cap, never wider than the viewport (border-box).
        expect(box.width, 'container must not exceed the 480px cap').toBeLessThanOrEqual(CAP + 1);
        expect(box.width, 'container must not exceed the viewport').toBeLessThanOrEqual(
          bp.width + 1
        );

        if (bp.fills) {
          // Below the cap: the container uses the available width (mobile-first).
          expect(
            box.width,
            'below 480px the container should fill the viewport'
          ).toBeGreaterThanOrEqual(bp.width - 2);
        } else {
          // Above the cap: pinned to 480 and horizontally centred by margin:auto.
          expect(
            box.width,
            'above 480px the container should pin to the cap'
          ).toBeGreaterThanOrEqual(CAP - 2);
          const expectedLeft = (bp.width - box.width) / 2;
          expect(
            Math.abs(box.x - expectedLeft),
            'margin:0 auto must centre the container (equal left/right gutters)'
          ).toBeLessThanOrEqual(2);
        }
      });
    }
  });
}

// The mobile-first floors must not regress on wider viewports either — a desktop
// width is where an author is most tempted to shrink inputs below the 16px iOS
// zoom threshold or a control below 44px. Assert they hold at 1280px too.
test.describe('Form page /q — mobile-first floors hold on desktop width', () => {
  test('register inputs stay >= 16px font and the submit stays >= 44px tall at 1280px', async ({
    page,
  }) => {
    await gotoForm(page, 'register', 1280, 800);

    const nameFont = await page
      .getByTestId('register-name-input')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(
      nameFont,
      'input font-size must stay >= 16px (iOS auto-zoom floor)'
    ).toBeGreaterThanOrEqual(16);

    const submit = await page.getByTestId('register-submit').boundingBox();
    expect(submit?.height ?? 0, 'submit target must stay >= 44px tall').toBeGreaterThanOrEqual(44);
  });

  test('checkin tap target is a large (>= 44px) control at 1280px', async ({ page }) => {
    await gotoForm(page, 'checkin', 1280, 800);
    const btn = await page.getByTestId('checkin-submit').boundingBox();
    expect(btn?.width ?? 0, 'check-in target width >= 44px').toBeGreaterThanOrEqual(44);
    expect(btn?.height ?? 0, 'check-in target height >= 44px').toBeGreaterThanOrEqual(44);
  });
});
