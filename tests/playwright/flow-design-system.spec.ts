/**
 * OSE-286 — Design system compliance — full fleet surface coverage.
 * OSE-307 — e2e flow test infrastructure (provenance trace).
 *
 * Asserts design system invariants across EVERY OSE surface that a customer,
 * operator, or embed partner can reach. Unlike the per-surface
 * mobile-workability audit (one surface at a time, fixed 375×812 viewport)
 * and the flow-forms-fillability spec (non-mutating form UX), this spec
 * concentrates on token adoption, structural accessibility, and semantic
 * integrity — checks that survive screen resizes and theme switches.
 *
 * ## Scope: all 11 public surfaces
 *
 *   Step 1   /                              Landing
 *   Step 2   /events                        Events listing
 *   Step 3   /events/:id                    Event detail
 *   Step 4   /forms/:id?type=register       Register form
 *   Step 5   /forms/:id?type=checkin        Check-in form
 *   Step 6   /forms/:id?type=survey         Survey form
 *   Step 7   /forms/:id?type=email-signup   Email-signup form
 *   Step 8   /poster                        Poster preview
 *   Step 9   /display                       TV/kiosk display board
 *   Step 10  /ui-preview                    @ocr/ui component showcase
 *   Step 11  Cross-surface continuity       Token consistency across all surfaces
 *
 * ## Design invariants asserted at each surface
 *
 *   DS-1  Shared stylesheet linked (/ui.css) — tokens available
 *   DS-2  No hardcoded inline colors on interactive elements
 *   DS-3  Heading hierarchy valid — h1 present, no level skips
 *   DS-4  Landmark structure — <main> + <header|nav> present
 *   DS-5  All <img> elements have alt attributes (WCAG 1.1.1)
 *   DS-6  CSS custom properties resolve on :root (tokens loading)
 *   DS-7  No horizontal scroll at project viewport
 *   DS-8  Touch targets ≥ 44×44 px on interactive elements (WCAG 2.5.5)
 *   DS-9  Viewport meta does not block pinch-zoom (WCAG 1.4.4)
 *   DS-10 Input font-size ≥ 16px (iOS auto-zoom guard) — form surfaces only
 *
 * ## What this spec does NOT duplicate
 *
 *   flow-forms-fillability.spec.ts covers (NOT repeated here):
 *     - form fill UX (typing updates values, keyboard fold, submit CTA)
 *     - aria chains per form type (role=alert, aria-describedby, aria-required,
 *       role=group on survey rating) — those are unique to each form type
 *       and already exhaustively covered in that spec
 *
 *   mobile-workability.spec.ts covers (NOT repeated here):
 *     - all 5 WCAG/mobile contracts at a fixed 375×812 viewport per surface
 *
 * This spec runs at EVERY device project (iPhone SE, iPhone 14 Pro Max,
 * iPad Air, Desktop Safari) so design invariants are verified at each
 * viewport — not just the mobile floor.
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-286 | Design | flow design-system | step N: <surface> — <assertion>`
 */

import { test, expect, type Page } from '@playwright/test';
import {
  loadAndSettle,
  assertTouchTargetsClean,
  assertInputFontSize,
  assertViewportAllowsPinchZoom,
  assertNoHorizontalScroll,
} from './_helpers/mobile-workability-assertions';
import {
  assertSharedStylesheetLinked,
  assertNoInlineColors,
  assertHeadingHierarchy,
  assertLandmarkStructure,
  assertImagesHaveAlt,
  assertDesignTokensResolve,
  assertDesignSystemCompliant,
} from './_helpers/design-system-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const EVENT_ID = 'test-event-001';

// ── Step 1: Landing (/) ───────────────────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 1: landing (/)', () => {
  test('OSE-286 | Design | flow design-system | step 1: landing — DS-1 shared stylesheet linked', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertSharedStylesheetLinked(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: landing — DS-2 no hardcoded inline colors on CTAs', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertNoInlineColors(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: landing — DS-3 heading hierarchy valid', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertHeadingHierarchy(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: landing — DS-4 landmark structure present', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertLandmarkStructure(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: landing — DS-5 images have alt attributes', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertImagesHaveAlt(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: landing — DS-6 design tokens resolve on root', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertDesignTokensResolve(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: landing — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertNoHorizontalScroll(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: landing — DS-8 touch targets ≥ 44px', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertTouchTargetsClean(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: landing — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertViewportAllowsPinchZoom(page, 'landing');
  });
});

// ── Step 2: Events listing (/events) ─────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 2: events listing (/events)', () => {
  test('OSE-286 | Design | flow design-system | step 2: /events — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);
    await assertDesignSystemCompliant(page, '/events');
  });

  test('OSE-286 | Design | flow design-system | step 2: /events — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);
    await assertNoHorizontalScroll(page, '/events');
  });

  test('OSE-286 | Design | flow design-system | step 2: /events — DS-8 touch targets ≥ 44px on event links', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);
    await assertTouchTargetsClean(page, '/events');
  });

  test('OSE-286 | Design | flow design-system | step 2: /events — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);
    await assertViewportAllowsPinchZoom(page, '/events');
  });

  test('OSE-286 | Design | flow design-system | step 2: /events — event links have accessible text', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);
    const links = await page.locator('main a[href]').all();
    const violations: string[] = [];
    for (const link of links) {
      if (!(await link.isVisible().catch(() => false))) continue;
      const text = (await link.textContent())?.trim() ?? '';
      const ariaLabel = await link.getAttribute('aria-label').catch(() => null);
      if (!text && !ariaLabel) {
        const href = await link.getAttribute('href').catch(() => '?');
        violations.push(`<a href="${href}"> has no text or aria-label`);
      }
    }
    expect(violations, `accessible link text violations:\n  ${violations.join('\n  ')}`).toEqual(
      []
    );
  });
});

// ── Step 3: Event detail (/events/:id) ───────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 3: event detail', () => {
  const PATH = `/events/${EVENT_ID}`;

  test('OSE-286 | Design | flow design-system | step 3: event detail — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    if ((await page.locator('main').count()) === 0) return; // surface not seeded
    await assertDesignSystemCompliant(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 3: event detail — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertNoHorizontalScroll(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 3: event detail — DS-8 touch targets ≥ 44px', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertTouchTargetsClean(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 3: event detail — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertViewportAllowsPinchZoom(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 3: event detail — primary CTA touch-sized regardless of phase', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    // OSE-298: staging may render the event in any phase (pre/live/post).
    // Accept any primary CTA the phase provides.
    const cta = page
      .locator(
        '[data-testid="event-rsvp"], [data-testid="event-checkin"], [data-testid="error-cta"]'
      )
      .first();
    if ((await cta.count()) === 0) return;
    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.height), 'primary CTA height < 44px').toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.width), 'primary CTA width < 44px').toBeGreaterThanOrEqual(44);
  });
});

// ── Step 4: Register form ─────────────────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 4: register form', () => {
  const PATH = `/forms/${EVENT_ID}?type=register`;

  test('OSE-286 | Design | flow design-system | step 4: register — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertDesignSystemCompliant(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 4: register — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertNoHorizontalScroll(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 4: register — DS-8 touch targets ≥ 44px', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertTouchTargetsClean(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 4: register — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertViewportAllowsPinchZoom(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 4: register — DS-10 input font-size ≥ 16px', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertInputFontSize(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 4: register — error container pre-wired before interaction', async ({
    page,
  }) => {
    // DS gate: the error container must be in the DOM, empty, and carry
    // the correct ARIA attributes on page load — before any interaction.
    // (The per-interaction + aria-chain assertions live in flow-forms-fillability.)
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await expect(page.locator('[data-testid="form-error"]')).toHaveAttribute('role', 'alert');
    await expect(page.locator('[data-testid="form-error"]')).toHaveAttribute(
      'aria-live',
      'assertive'
    );
    await expect(page.locator('[data-testid="form-error"]')).toBeEmpty();
  });
});

// ── Step 5: Check-in form ─────────────────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 5: check-in form', () => {
  const PATH = `/forms/${EVENT_ID}?type=checkin`;

  test('OSE-286 | Design | flow design-system | step 5: checkin — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertDesignSystemCompliant(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 5: checkin — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertNoHorizontalScroll(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 5: checkin — DS-8 tap button ≥ 44px (single-interaction surface)', async ({
    page,
  }) => {
    // Check-in is one tap — the submit button IS the entire UX.
    // Must clear the 44px floor by a significant margin.
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertTouchTargetsClean(page, PATH);
    const box = await page.locator('[data-testid="checkin-submit"]').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44);
  });

  test('OSE-286 | Design | flow design-system | step 5: checkin — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertViewportAllowsPinchZoom(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 5: checkin — count display has accessible label', async ({
    page,
  }) => {
    // The attendance count is meaningful data — it needs a label for
    // screen readers, not just a raw number.
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    const countEl = page.locator('[data-testid="checkin-count"]');
    const count = await countEl.count();
    if (count === 0) return;
    // Must have either visible label text or aria-label
    const ariaLabel = await countEl.getAttribute('aria-label').catch(() => null);
    const ariaLabelledBy = await countEl.getAttribute('aria-labelledby').catch(() => null);
    const textContent = (await countEl.textContent())?.trim() ?? '';
    // Acceptable: aria-label, aria-labelledby, or visible text that's
    // more than a bare number (e.g., "47 checked in" vs just "47")
    const hasContext = ariaLabel || ariaLabelledBy || /\D/.test(textContent);
    expect(
      hasContext,
      `checkin-count "${textContent}" has no accessible context — add aria-label or descriptive text`
    ).toBeTruthy();
  });
});

// ── Step 6: Survey form ───────────────────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 6: survey form', () => {
  const PATH = `/forms/${EVENT_ID}?type=survey`;

  test('OSE-286 | Design | flow design-system | step 6: survey — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertDesignSystemCompliant(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 6: survey — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertNoHorizontalScroll(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 6: survey — DS-8 touch targets ≥ 44px including rating buttons', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertTouchTargetsClean(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 6: survey — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertViewportAllowsPinchZoom(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 6: survey — DS-10 textarea font-size ≥ 16px', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertInputFontSize(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 6: survey — rating buttons use CSS class for selected state (no inline style)', async ({
    page,
  }) => {
    // Selected rating must be communicated via CSS class, not inline style.
    // An inline background color would bypass the theme system.
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    const rating3 = page.locator('[data-testid="survey-rating-3"]');
    if ((await rating3.count()) === 0) return;
    await rating3.click();
    await page.waitForTimeout(100);
    const style = await rating3.getAttribute('style').catch(() => null);
    if (style) {
      expect(
        style,
        `survey-rating-3 carries inline color/background after selection — use CSS class`
      ).not.toMatch(/(?:^|;)\s*(?:color|background(?:-color)?)\s*:/i);
    }
  });
});

// ── Step 7: Email-signup form ─────────────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 7: email-signup form', () => {
  const PATH = `/forms/${EVENT_ID}?type=email-signup`;

  test('OSE-286 | Design | flow design-system | step 7: email-signup — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertDesignSystemCompliant(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 7: email-signup — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertNoHorizontalScroll(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 7: email-signup — DS-8 touch targets ≥ 44px', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertTouchTargetsClean(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 7: email-signup — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertViewportAllowsPinchZoom(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 7: email-signup — DS-10 input font-size ≥ 16px', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertInputFontSize(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 7: email-signup — error container pre-wired and empty on load', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    const errEl = page.locator('[data-testid="form-error"]');
    if ((await errEl.count()) === 0) return;
    await expect(errEl).toHaveAttribute('role', 'alert');
    await expect(errEl).toBeEmpty();
  });
});

// ── Step 8: Poster (/poster) ──────────────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 8: poster (/poster)', () => {
  test('OSE-286 | Design | flow design-system | step 8: poster — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/poster`);
    await assertDesignSystemCompliant(page, '/poster');
  });

  test('OSE-286 | Design | flow design-system | step 8: poster — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/poster`);
    await assertNoHorizontalScroll(page, '/poster');
  });

  test('OSE-286 | Design | flow design-system | step 8: poster — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/poster`);
    await assertViewportAllowsPinchZoom(page, '/poster');
  });

  test('OSE-286 | Design | flow design-system | step 8: poster — QR code image has alt text', async ({
    page,
  }) => {
    // The poster QR code is the core content — it MUST have an alt attribute
    // describing the action, not just an empty alt (which marks it decorative).
    await loadAndSettle(page, `${BASE_URL}/poster`);
    const qrImg = page
      .locator('[data-testid="poster-qr"] img, img[alt*="QR"], img[alt*="qr"]')
      .first();
    const count = await qrImg.count();
    if (count === 0) {
      // No scoped QR img found — fall back to any img on the poster
      await assertImagesHaveAlt(page, '/poster');
      return;
    }
    const alt = await qrImg.getAttribute('alt');
    expect(
      alt,
      'QR code image alt is empty — describe the action (e.g., "Scan to register")'
    ).toBeTruthy();
    expect((alt ?? '').trim().length, 'QR code image alt is empty string').toBeGreaterThan(0);
  });
});

// ── Step 9: Display board (/display) ─────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 9: display (/display)', () => {
  test('OSE-286 | Design | flow design-system | step 9: display — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/display`);
    await assertDesignSystemCompliant(page, '/display');
  });

  test('OSE-286 | Design | flow design-system | step 9: display — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/display`);
    await assertNoHorizontalScroll(page, '/display');
  });

  test('OSE-286 | Design | flow design-system | step 9: display — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/display`);
    await assertViewportAllowsPinchZoom(page, '/display');
  });

  test('OSE-286 | Design | flow design-system | step 9: display — no inline colors on live attendance counter', async ({
    page,
  }) => {
    // The live count display is JS-injected — verify it doesn't carry
    // inline colors that would resist theme changes.
    await loadAndSettle(page, `${BASE_URL}/display`);
    await assertNoInlineColors(page, '/display');
  });
});

// ── Step 10: UI Preview (/ui-preview) ─────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 10: ui-preview (/ui-preview)', () => {
  test('OSE-286 | Design | flow design-system | step 10: ui-preview — full design system compliance', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/ui-preview`);
    await assertDesignSystemCompliant(page, '/ui-preview');
  });

  test('OSE-286 | Design | flow design-system | step 10: ui-preview — DS-7 no horizontal scroll', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/ui-preview`);
    await assertNoHorizontalScroll(page, '/ui-preview');
  });

  test('OSE-286 | Design | flow design-system | step 10: ui-preview — DS-8 touch targets ≥ 44px on theme toggle', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/ui-preview`);
    await assertTouchTargetsClean(page, '/ui-preview');
  });

  test('OSE-286 | Design | flow design-system | step 10: ui-preview — DS-9 viewport allows pinch-zoom', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/ui-preview`);
    await assertViewportAllowsPinchZoom(page, '/ui-preview');
  });

  test('OSE-286 | Design | flow design-system | step 10: ui-preview — theme toggle changes data-theme attribute', async ({
    page,
  }) => {
    // The theme bar must actually mutate data-theme — without this, the
    // design system's light/dark token cascade is untestable.
    await loadAndSettle(page, `${BASE_URL}/ui-preview`);
    const lightBtn = page.locator('[data-testid="theme-btn-light"]');
    const darkBtn = page.locator('[data-testid="theme-btn-dark"]');
    if ((await lightBtn.count()) === 0) return;
    await lightBtn.click();
    await page.waitForTimeout(100);
    const afterLight = await page.locator('[data-theme]').first().getAttribute('data-theme');
    expect(afterLight, 'data-theme did not update after light toggle').toBe('light');
    await darkBtn.click();
    await page.waitForTimeout(100);
    const afterDark = await page.locator('[data-theme]').first().getAttribute('data-theme');
    expect(afterDark, 'data-theme did not update after dark toggle').toBe('dark');
  });

  test('OSE-286 | Design | flow design-system | step 10: ui-preview — dark theme changes --bg token', async ({
    page,
  }) => {
    // Token values must actually change between themes — if they don't,
    // the light/dark cascade is broken even if the attribute toggles.
    await loadAndSettle(page, `${BASE_URL}/ui-preview`);
    const lightBtn = page.locator('[data-testid="theme-btn-light"]');
    const darkBtn = page.locator('[data-testid="theme-btn-dark"]');
    if ((await lightBtn.count()) === 0) return;
    await lightBtn.click();
    await page.waitForTimeout(100);
    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    await darkBtn.click();
    await page.waitForTimeout(100);
    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(
      lightBg === darkBg,
      `--bg unchanged between light "${lightBg}" and dark "${darkBg}" — theme cascade is broken`
    ).toBe(false);
  });

  test('OSE-286 | Design | flow design-system | step 10: ui-preview — all 11 preview sections render', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/ui-preview`);
    const sections = [
      'buttons',
      'cards',
      'inputs',
      'navigation',
      'feedback',
      'lists',
      'chips',
      'empty-state',
      'form-controls',
      'form-partials',
      'tokens',
    ];
    for (const name of sections) {
      const el = page.locator(`[data-testid="preview-section-${name}"]`);
      await expect(el, `preview-section-${name} not found`).toBeAttached();
    }
  });
});

// ── Step 11: Cross-surface continuity ─────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 11: cross-surface continuity', () => {
  // All public surfaces that don't require auth.
  const ALL_PUBLIC_PATHS = [
    '/',
    '/events',
    `/events/${EVENT_ID}`,
    `/forms/${EVENT_ID}?type=register`,
    `/forms/${EVENT_ID}?type=checkin`,
    `/forms/${EVENT_ID}?type=survey`,
    `/forms/${EVENT_ID}?type=email-signup`,
    '/poster',
    '/display',
    '/ui-preview',
  ];

  test('OSE-286 | Design | flow design-system | step 11: root font-size consistent across all surfaces (≤1px tolerance)', async ({
    page,
  }) => {
    // --font-size-base must resolve identically on every surface.
    // A divergence means a surface has a conflicting :root override.
    const sizes: Record<string, number> = {};
    for (const path of ALL_PUBLIC_PATHS) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
      sizes[path] = await page.evaluate(
        () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 0
      );
    }
    const values = Object.values(sizes);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const diverged = Object.entries(sizes)
      .filter(([, v]) => Math.abs(v - min) > 1)
      .map(([p, v]) => `${p}=${v}px`);
    expect(
      diverged,
      `root font-size diverges by >1px across surfaces (min=${min}px, max=${max}px):\n  ${diverged.join('\n  ')}`
    ).toEqual([]);
  });

  test('OSE-286 | Design | flow design-system | step 11: design tokens resolve on all surfaces', async ({
    page,
  }) => {
    // Every surface must load /ui.css and have the core tokens available.
    const failures: string[] = [];
    for (const path of ALL_PUBLIC_PATHS) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
      const unresolved = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return ['--bg', '--text', '--radius-sm'].filter(
          (t) => style.getPropertyValue(t).trim() === ''
        );
      });
      if (unresolved.length > 0) {
        failures.push(`${path}: [${unresolved.join(', ')}]`);
      }
    }
    expect(
      failures,
      `Design tokens not resolving on these surfaces:\n  ${failures.join('\n  ')}`
    ).toEqual([]);
  });

  test('OSE-286 | Design | flow design-system | step 11: viewport meta allows pinch-zoom on all surfaces', async ({
    page,
  }) => {
    for (const path of ALL_PUBLIC_PATHS) {
      await loadAndSettle(page, `${BASE_URL}${path}`);
      await assertViewportAllowsPinchZoom(page, path);
    }
  });

  test('OSE-286 | Design | flow design-system | step 11: shared stylesheet linked on all surfaces', async ({
    page,
  }) => {
    const missing: string[] = [];
    for (const path of ALL_PUBLIC_PATHS) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
      const linked = await page.locator('link[rel="stylesheet"][href="/ui.css"]').count();
      if (linked === 0) missing.push(path);
    }
    expect(
      missing,
      `/ui.css not linked on these surfaces (design tokens unavailable):\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  test('OSE-286 | Design | flow design-system | step 11: no inline colors across all surfaces', async ({
    page,
  }) => {
    const allViolations: string[] = [];
    for (const path of ALL_PUBLIC_PATHS) {
      await loadAndSettle(page, `${BASE_URL}${path}`);
      const violations = await page.evaluate(() => {
        const els = document.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, [role="button"], [role="link"]'
        );
        const found: string[] = [];
        for (const el of els) {
          const style = el.getAttribute('style') ?? '';
          if (/(?:^|;)\s*(?:color|background(?:-color)?)\s*:/i.test(style)) {
            const testid = el.dataset['testid'] ?? el.tagName.toLowerCase();
            found.push(`${testid}: style="${style}"`);
          }
        }
        return found;
      });
      if (violations.length > 0) {
        allViolations.push(`  ${path}:\n    ${violations.join('\n    ')}`);
      }
    }
    expect(
      allViolations,
      `Hardcoded inline colors found across surfaces:\n${allViolations.join('\n')}`
    ).toEqual([]);
  });

  test('OSE-286 | Design | flow design-system | step 11: no horizontal scroll on any surface', async ({
    page,
  }) => {
    const scrolling: string[] = [];
    for (const path of ALL_PUBLIC_PATHS) {
      await loadAndSettle(page, `${BASE_URL}${path}`);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (scrollWidth > clientWidth + 1) {
        scrolling.push(`${path}: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`);
      }
    }
    expect(
      scrolling,
      `Horizontal scroll required on these surfaces:\n  ${scrolling.join('\n  ')}`
    ).toEqual([]);
  });
});
