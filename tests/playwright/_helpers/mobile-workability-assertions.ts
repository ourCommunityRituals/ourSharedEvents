/**
 * OSE-307 — shared per-step mobile workability assertions for flow-level
 * e2e Playwright tests.
 *
 * Walks the SAME contract surface as `tests/playwright/mobile-workability.spec.ts`
 * (the per-surface audit) but exposes the checks as composable helpers so
 * flow-level specs can assert per-step at each surface in a customer
 * journey.
 *
 * Five contracts mirror invariant 14 (OCR_STANDARD_mobileWorkability +
 * OCR-42 refinements):
 *   1. No horizontal scroll
 *   2. Touch targets >= 44x44 px (with WCAG 2.5.5 inline-text exemption)
 *   3. Input font-size >= 16 px (when inputs are present)
 *   4. Primary CTA above the fold (when caller provides selector)
 *   5. Viewport meta does NOT block pinch-zoom
 *
 * Per-surface OCR-42 refinements applied automatically:
 *   - Inline text-flow link exemption (display:inline inside p/li/dt/dd/
 *     span/em/strong/label)
 *   - Page-state steady-state wait (aria-busy="false" / data-ready="true"
 *     / 3000ms fallback) — applied by callers via the `loadAndSettle`
 *     helper before measurement
 *   - Math.round() precision on touch-target comparisons
 *
 * Pattern: each contract is a separate exported function so flow specs
 * compose only the assertions relevant to the current step (e.g., a
 * landing-page step with no form doesn't run `assertInputFontSize`).
 * The bundled `assertMobileWorkable` runs all five for convenience.
 */

import { expect, type Page } from '@playwright/test';

export const MOBILE_VIEWPORT = { width: 375, height: 812 };
export const MIN_TOUCH_TARGET_PX = 44;
export const MIN_INPUT_FONT_SIZE_PX = 16;
const STEADY_STATE_TIMEOUT_MS = 3000;

/**
 * Navigate to a URL, set the mobile viewport, and wait for steady state
 * before any assertion. The steady-state wait is the OCR-42 contract (4)
 * refinement — surfaces with async data loading need to settle before we
 * measure CTA visibility.
 */
export async function loadAndSettle(page: Page, url: string): Promise<void> {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await Promise.race([
    page
      .locator('main[aria-busy="false"], main:not([aria-busy])')
      .first()
      .waitFor({ state: 'attached', timeout: STEADY_STATE_TIMEOUT_MS })
      .catch(() => null),
    page
      .locator('body[data-ready="true"]')
      .first()
      .waitFor({ state: 'attached', timeout: STEADY_STATE_TIMEOUT_MS })
      .catch(() => null),
    page.waitForTimeout(STEADY_STATE_TIMEOUT_MS),
  ]);
}

/**
 * Same steady-state wait as `loadAndSettle`, but for the case where the
 * page navigates internally (e.g., after tapping a CTA) and the spec
 * already has the new URL loaded. Use after `page.click()` + `waitForURL`.
 */
export async function settle(page: Page): Promise<void> {
  await Promise.race([
    page
      .locator('main[aria-busy="false"], main:not([aria-busy])')
      .first()
      .waitFor({ state: 'attached', timeout: STEADY_STATE_TIMEOUT_MS })
      .catch(() => null),
    page
      .locator('body[data-ready="true"]')
      .first()
      .waitFor({ state: 'attached', timeout: STEADY_STATE_TIMEOUT_MS })
      .catch(() => null),
    page.waitForTimeout(STEADY_STATE_TIMEOUT_MS),
  ]);
}

/**
 * Contract 1 — no horizontal scroll at 375px wide.
 * Tolerance: 1px for sub-pixel rendering rounding.
 */
export async function assertNoHorizontalScroll(page: Page, surfaceName: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${surfaceName}: scrollWidth=${scrollWidth} > clientWidth=${clientWidth} — horizontal scroll required`
  ).toBeLessThanOrEqual(clientWidth + 1);
}

/**
 * Contract 2 — every visible touch target meets the 44x44 px floor
 * (WCAG 2.5.5 Level AAA + Apple HIG). OCR-42 exemption: anchors with
 * computed display:inline inside text-flow parents are EXEMPT.
 *
 * Compares ROUNDED dimensions so 43.99px-rendered elements (visually 44)
 * don't false-positive.
 */
export async function assertTouchTargetsClean(page: Page, surfaceName: string): Promise<void> {
  const selector = [
    'button:not([hidden]):not([type="hidden"])',
    'a[href]:not([hidden])',
    'input:not([type="hidden"]):not([hidden])',
    'select:not([hidden])',
    'textarea:not([hidden])',
    '[role="button"]:not([hidden])',
    '[role="link"]:not([hidden])',
  ].join(', ');
  const all = await page.locator(selector).all();
  const viewport = page.viewportSize() ?? MOBILE_VIEWPORT;
  const violations: string[] = [];
  for (const loc of all) {
    if (!(await loc.isVisible().catch(() => false))) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box) continue;
    if (box.width < 4 || box.height < 4) continue;
    if (box.x < 0 || box.x >= viewport.width) continue;
    // OCR-42 inline text-flow link exemption
    const isInlineTextLink = await loc
      .evaluate((el) => {
        if (el.tagName.toLowerCase() !== 'a') return false;
        if (getComputedStyle(el).display !== 'inline') return false;
        const parent = el.parentElement;
        if (!parent) return false;
        const textFlowParents = new Set(['p', 'li', 'dt', 'dd', 'span', 'em', 'strong', 'label']);
        return textFlowParents.has(parent.tagName.toLowerCase());
      })
      .catch(() => false);
    if (isInlineTextLink) continue;
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (w < MIN_TOUCH_TARGET_PX || h < MIN_TOUCH_TARGET_PX) {
      const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
      const testid = (await loc.getAttribute('data-testid').catch(() => null)) ?? '(no testid)';
      violations.push(`<${tag} data-testid="${testid}"> = ${w}×${h}`);
    }
  }
  expect(
    violations,
    `${surfaceName} touch-target violations (< ${MIN_TOUCH_TARGET_PX} px):\n  ${violations.join('\n  ')}`
  ).toEqual([]);
}

/**
 * Contract 3 — every visible non-hidden input has computed font-size
 * >= 16 px (iOS Safari auto-zoom guard).
 */
export async function assertInputFontSize(page: Page, surfaceName: string): Promise<void> {
  const all = await page
    .locator(
      'input:not([type="hidden"]):not([hidden]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea:not([hidden]), select:not([hidden])'
    )
    .all();
  const violations: string[] = [];
  for (const loc of all) {
    if (!(await loc.isVisible().catch(() => false))) continue;
    const fontSize = await loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) || 0);
    if (fontSize < MIN_INPUT_FONT_SIZE_PX) {
      const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
      const testid = (await loc.getAttribute('data-testid').catch(() => null)) ?? '(no testid)';
      violations.push(`<${tag} data-testid="${testid}"> font-size = ${fontSize}px`);
    }
  }
  expect(
    violations,
    `${surfaceName} input font-size violations (< ${MIN_INPUT_FONT_SIZE_PX} px, triggers iOS auto-zoom):\n  ${violations.join('\n  ')}`
  ).toEqual([]);
}

/**
 * Contract 4 — primary CTA visible above the fold at 375x812.
 * Caller provides the selector (varies per surface). Multiple comma-
 * separated selectors accepted; `.first()` wins.
 *
 * OCR-42 page-state model: caller must call `loadAndSettle` / `settle`
 * before this assertion so disabled-but-visible CTAs (e.g.
 * /sharedReport's export buttons until data resolves) are measured
 * after they render.
 */
export async function assertPrimaryCTAAboveFold(
  page: Page,
  surfaceName: string,
  ctaSelector: string
): Promise<void> {
  const cta = page.locator(ctaSelector).first();
  const count = await cta.count();
  expect(
    count,
    `${surfaceName}: primary CTA selector '${ctaSelector}' matched 0 elements`
  ).toBeGreaterThan(0);
  const box = await cta.boundingBox();
  expect(box, `${surfaceName}: primary CTA has no bounding box`).not.toBeNull();
  expect(
    box!.y,
    `${surfaceName}: primary CTA top = ${Math.round(box!.y)}px > viewport height ${MOBILE_VIEWPORT.height}px — CTA below the fold`
  ).toBeLessThan(MOBILE_VIEWPORT.height);
}

/**
 * Contract 5 — viewport meta MUST NOT block pinch-zoom (WCAG 1.4.4).
 */
export async function assertViewportAllowsPinchZoom(
  page: Page,
  surfaceName: string
): Promise<void> {
  const viewportMeta = await page
    .locator('meta[name="viewport"]')
    .first()
    .getAttribute('content')
    .catch(() => null);
  if (!viewportMeta) return; // no viewport meta is acceptable
  expect(
    viewportMeta,
    `${surfaceName}: viewport meta blocks pinch-zoom via user-scalable=no ('${viewportMeta}')`
  ).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
  expect(
    viewportMeta,
    `${surfaceName}: viewport meta blocks pinch-zoom via maximum-scale=1 ('${viewportMeta}')`
  ).not.toMatch(/maximum-scale\s*=\s*1\b/i);
}

/**
 * Bundled assertion — runs all 5 contracts (or 4 if no primary CTA
 * selector provided). Convenience helper for flow specs that want
 * "the same checks as the per-surface audit" at each flow step.
 */
export async function assertMobileWorkable(
  page: Page,
  surfaceName: string,
  options: { primaryCtaSelector?: string; skipInputFontSize?: boolean } = {}
): Promise<void> {
  await assertNoHorizontalScroll(page, surfaceName);
  await assertTouchTargetsClean(page, surfaceName);
  if (!options.skipInputFontSize) {
    await assertInputFontSize(page, surfaceName);
  }
  if (options.primaryCtaSelector) {
    await assertPrimaryCTAAboveFold(page, surfaceName, options.primaryCtaSelector);
  }
  await assertViewportAllowsPinchZoom(page, surfaceName);
}
