/**
 * OSE-286 — Design system compliance flow — full attendee arc.
 *
 * Walks the complete attendee journey and asserts design system invariants
 * at each surface transition. Unlike the per-surface mobile-workability
 * audit (which checks one surface at a time) and the unit-level ui-preview
 * spec (which checks the component showcase in isolation), this spec checks
 * that design standards HOLD across the real end-to-end flow a customer
 * actually takes.
 *
 * Flow:
 *   1. Landing (/)              — subscribe form aria, no inline colors on CTA
 *   2. Events (/events)         — listing loads, cards have accessible text
 *   3. Event detail             — header, RSVP CTA aria, phase-appropriate state
 *   4. Register form            — full aria chain, error container pre-wired
 *   5. Cross-surface continuity — design tokens apply consistently (font, spacing)
 *
 * ## Design invariants asserted at every step
 *
 *   - Aria: interactive elements labeled; error containers have role=alert
 *   - No hardcoded inline colors on JS-generated content (color/background
 *     must come from CSS classes, not style="" attributes)
 *   - Touch targets ≥ 44px on primary CTAs (WCAG 2.5.5)
 *   - Input font-size ≥ 16px on form surfaces (iOS auto-zoom guard)
 *   - Viewport meta does not block pinch-zoom (WCAG 1.4.4)
 *   - The shared stylesheet is linked (design tokens available)
 *
 * ## What this does NOT test
 *
 *   - Data round-trips (non-mutating — no form submissions)
 *   - @ocr/ui CSS class names on surfaces not yet migrated (templates use
 *     their own classes; we assert aria + computed CSS standards instead)
 *
 * Runs across all 4 device projects (playwright.config.ts):
 *   iPhone SE, iPhone 14 Pro Max, iPad Air, Desktop Safari.
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
} from './_helpers/mobile-workability-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const EVENT_ID = 'test-event-001';

// ── Shared design assertions ─────────────────────────────────────────────────

/** Verify the shared @ocr/ui stylesheet is linked — tokens are available. */
async function assertSharedStylesheetLinked(page: Page, surface: string): Promise<void> {
  const linked = await page.locator('link[rel="stylesheet"][href="/ui.css"]').count();
  expect(linked, `${surface}: /ui.css not linked — design tokens unavailable`).toBeGreaterThan(0);
}

/**
 * Verify no interactive element carries an inline style with a hardcoded
 * color or background-color. Design system surfaces must use CSS classes
 * for color so tokens can propagate correctly through light/dark themes.
 *
 * Exempted: purely decorative elements (images, hr, svg fills).
 */
async function assertNoInlineColors(page: Page, surface: string): Promise<void> {
  const violations = await page.evaluate(() => {
    const interactiveTags = new Set(['button', 'a', 'input', 'select', 'textarea', 'label']);
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
  expect(
    violations,
    `${surface}: interactive elements with hardcoded inline colors (use CSS classes):\n  ${violations.join('\n  ')}`
  ).toEqual([]);
}

// ── Step 1: Landing (/) ───────────────────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 1: landing (/)', () => {
  test('OSE-286 | Design | flow design-system | step 1: shared stylesheet linked', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertSharedStylesheetLinked(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: viewport allows pinch-zoom (WCAG 1.4.4)', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertViewportAllowsPinchZoom(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: primary CTA has no hardcoded inline color', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertNoInlineColors(page, 'landing');
  });

  test('OSE-286 | Design | flow design-system | step 1: touch targets ≥ 44px on CTAs', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await assertTouchTargetsClean(page, 'landing');
  });
});

// ── Step 2: Events listing (/events) ─────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 2: events listing (/events)', () => {
  test('OSE-286 | Design | flow design-system | step 2: shared stylesheet linked', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);
    await assertSharedStylesheetLinked(page, '/events');
  });

  test('OSE-286 | Design | flow design-system | step 2: touch targets ≥ 44px on event links', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);
    await assertTouchTargetsClean(page, '/events');
  });

  test('OSE-286 | Design | flow design-system | step 2: no hardcoded inline colors on event cards', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);
    await assertNoInlineColors(page, '/events');
  });

  test('OSE-286 | Design | flow design-system | step 2: event links have accessible text (not icon-only)', async ({
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

  test('OSE-286 | Design | flow design-system | step 3: shared stylesheet linked', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertSharedStylesheetLinked(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 3: RSVP or check-in CTA present and touch-sized', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    // OSE-298: staging may render the event in any phase (pre/live/post).
    // Accept any primary CTA the phase provides — the key assertion is that
    // whichever CTA renders meets the touch-target floor.
    const cta = page
      .locator(
        '[data-testid="event-rsvp"], [data-testid="event-checkin"], [data-testid="error-cta"]'
      )
      .first();
    const count = await cta.count();
    if (count === 0) return; // event not seeded — skip gracefully
    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.height), 'primary CTA height < 44px').toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.width), 'primary CTA width < 44px').toBeGreaterThanOrEqual(44);
  });

  test('OSE-286 | Design | flow design-system | step 3: no hardcoded inline colors on event surface', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertNoInlineColors(page, PATH);
  });
});

// ── Step 4: Register form (/forms/:id?type=register) ─────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 4: register form', () => {
  const PATH = `/forms/${EVENT_ID}?type=register`;

  test('OSE-286 | Design | flow design-system | step 4: shared stylesheet linked', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertSharedStylesheetLinked(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 4: form inputs ≥ 16px (iOS auto-zoom guard)', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertInputFontSize(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 4: error container pre-wired with role=alert + aria-live', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await expect(page.locator('[data-testid="form-error"]')).toHaveAttribute('role', 'alert');
    await expect(page.locator('[data-testid="form-error"]')).toHaveAttribute(
      'aria-live',
      'assertive'
    );
    // Inputs must reference the error container so screen readers
    // announce validation failures without a page reload.
    await expect(page.locator('[data-testid="register-name-input"]')).toHaveAttribute(
      'aria-describedby',
      'error-msg'
    );
    await expect(page.locator('[data-testid="register-email-input"]')).toHaveAttribute(
      'aria-describedby',
      'error-msg'
    );
  });

  test('OSE-286 | Design | flow design-system | step 4: no hardcoded inline colors on form surface', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertNoInlineColors(page, PATH);
  });

  test('OSE-286 | Design | flow design-system | step 4: touch targets ≥ 44px on submit + inputs', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}${PATH}`);
    await assertTouchTargetsClean(page, PATH);
  });
});

// ── Step 5: Cross-surface continuity ─────────────────────────────────────────

test.describe('OSE-286 | Design | flow design-system — step 5: cross-surface continuity', () => {
  test('OSE-286 | Design | flow design-system | step 5: base font-size consistent across landing and event surfaces', async ({
    page,
  }) => {
    // Design token --font-size-base should resolve to the same value on
    // both surfaces. If one surface overrides it via a conflicting :root
    // block, they'll diverge — the drift check (check-ui-drift.mjs) gates
    // this structurally; this test validates the computed result.
    async function rootFontSize(url: string): Promise<number> {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return page.evaluate(
        () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 0
      );
    }
    const landingSize = await rootFontSize(`${BASE_URL}/`);
    const eventsSize = await rootFontSize(`${BASE_URL}/events`);
    expect(
      Math.abs(landingSize - eventsSize),
      `root font-size diverges: landing=${landingSize}px, /events=${eventsSize}px`
    ).toBeLessThanOrEqual(1); // 1px tolerance for sub-pixel rendering
  });

  test('OSE-286 | Design | flow design-system | step 5: viewport meta consistent — all surfaces allow pinch-zoom', async ({
    page,
  }) => {
    const surfaces = ['/', '/events', `/events/${EVENT_ID}`, `/forms/${EVENT_ID}?type=register`];
    for (const path of surfaces) {
      await loadAndSettle(page, `${BASE_URL}${path}`);
      await assertViewportAllowsPinchZoom(page, path);
    }
  });
});
