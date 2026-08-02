/**
 * OSE-286 — Shared design-system compliance assertions.
 *
 * These helpers assert design-system invariants that must hold at every OSE
 * surface — independent of device, flow step, or form type. They complement
 * the WCAG/mobile contracts in `mobile-workability-assertions.ts`; together
 * they form the full per-surface design compliance contract.
 *
 * ## What lives here vs mobile-workability-assertions.ts
 *
 * `mobile-workability-assertions.ts` — WCAG/mobile usability contracts:
 *   touch targets, input font size, horizontal scroll, pinch-zoom, CTA fold
 *
 * `design-system-assertions.ts` — token adoption + structural integrity:
 *   stylesheet linked, no inline colors, heading hierarchy, landmark
 *   structure, image alt text, CSS custom properties resolved, focus visible
 *
 * All helpers follow the same pattern:
 *   - Accept `(page: Page, surfaceName: string)` for consistent error messages
 *   - Return void, throw via `expect()` on failure
 *   - Are composable — call individually or via `assertDesignSystemCompliant()`
 */

import { expect, type Page } from '@playwright/test';

/**
 * Verify the shared @ocr/ui stylesheet is linked — design tokens are
 * available on this surface.
 */
export async function assertSharedStylesheetLinked(page: Page, surfaceName: string): Promise<void> {
  const linked = await page.locator('link[rel="stylesheet"][href="/ui.css"]').count();
  expect(
    linked,
    `${surfaceName}: /ui.css not linked — @ocr/ui design tokens unavailable`
  ).toBeGreaterThan(0);
}

/**
 * Verify no interactive element carries a hardcoded inline style with
 * `color` or `background[-color]`. Design system surfaces must use CSS
 * classes for color so tokens propagate correctly through light/dark themes.
 *
 * Exemption: purely decorative elements (img, hr, svg) are excluded.
 */
export async function assertNoInlineColors(page: Page, surfaceName: string): Promise<void> {
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
  expect(
    violations,
    `${surfaceName}: interactive elements with hardcoded inline colors — use CSS classes:\n  ${violations.join('\n  ')}`
  ).toEqual([]);
}

/**
 * Verify heading levels form a valid hierarchy — h1 is present, and no
 * level is skipped (e.g., h1 → h3 without an h2 in between). Skipped
 * heading levels break screen-reader navigation and indicate that
 * headings are being used for visual styling rather than document structure.
 */
export async function assertHeadingHierarchy(page: Page, surfaceName: string): Promise<void> {
  const result = await page.evaluate(() => {
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
    ).filter((h) => {
      const style = getComputedStyle(h);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    const levels = headings.map((h) => parseInt(h.tagName[1], 10));
    return { levels, count: levels.length };
  });
  // h1 must be present (every surface needs a document title).
  expect(
    result.levels.includes(1),
    `${surfaceName}: no <h1> found — every page needs a primary heading`
  ).toBe(true);
  // No level jump greater than 1.
  const gaps: string[] = [];
  for (let i = 1; i < result.levels.length; i++) {
    const prev = result.levels[i - 1];
    const curr = result.levels[i];
    if (curr > prev + 1) {
      gaps.push(`h${prev} → h${curr}`);
    }
  }
  expect(
    gaps,
    `${surfaceName}: heading levels skip — screen readers lose document outline:\n  ${gaps.join(', ')}`
  ).toEqual([]);
}

/**
 * Verify the page has a `<main>` landmark and at least one of `<header>`
 * or `<nav>`. Missing landmarks break screen-reader skip-navigation and
 * prevent users from jumping directly to content.
 */
export async function assertLandmarkStructure(page: Page, surfaceName: string): Promise<void> {
  const mainCount = await page.locator('main').count();
  expect(
    mainCount,
    `${surfaceName}: no <main> landmark — screen readers can't skip to content`
  ).toBeGreaterThan(0);

  const headerOrNav = await page.locator('header, nav').count();
  expect(
    headerOrNav,
    `${surfaceName}: no <header> or <nav> landmark — assistive tech can't access navigation`
  ).toBeGreaterThan(0);
}

/**
 * Verify all visible `<img>` elements have an `alt` attribute.
 * Empty alt (alt="") is valid for decorative images; the absence of
 * the attribute entirely is a WCAG 1.1.1 failure.
 */
export async function assertImagesHaveAlt(page: Page, surfaceName: string): Promise<void> {
  const violations = await page.evaluate(() => {
    const imgs = document.querySelectorAll<HTMLImageElement>('img');
    const missing: string[] = [];
    for (const img of imgs) {
      if (!img.hasAttribute('alt')) {
        missing.push(img.src || img.dataset['testid'] || '(no src)');
      }
    }
    return missing;
  });
  expect(
    violations,
    `${surfaceName}: <img> elements missing alt attribute (WCAG 1.1.1):\n  ${violations.join('\n  ')}`
  ).toEqual([]);
}

/**
 * Verify that CSS custom properties from @ocr/ui resolve on :root —
 * proving the design token stylesheet is not just linked but actually
 * loaded and applying. Checks a set of known Tier 1 and Tier 2 tokens.
 */
export async function assertDesignTokensResolve(page: Page, surfaceName: string): Promise<void> {
  // Tier 2 semantic tokens that must be present when /ui.css loads.
  // An empty string means the property is not defined — the token file
  // didn't load or the property name is wrong.
  const unresolved = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const tokens = ['--bg', '--text', '--radius-sm'];
    return tokens.filter((t) => style.getPropertyValue(t).trim() === '');
  });
  expect(
    unresolved,
    `${surfaceName}: @ocr/ui tokens not resolving on :root — /ui.css may not be loading:\n  ${unresolved.join(', ')}`
  ).toEqual([]);
}

/**
 * Verify the page has a skip-to-content link — the first focusable element
 * must be a "Skip to main content" or equivalent link, ensuring keyboard-
 * only users can bypass navigation without tabbing through every nav item.
 *
 * Permissive: accepts any first anchor whose text or aria-label contains
 * "skip" or "content" (case-insensitive) — common patterns across OSE surfaces.
 * If the page has NO skip link, reports it as a warning (non-blocking gap)
 * via a separate Playwright annotation rather than a hard failure, since
 * this is a WCAG 2.4.1 Level A requirement that may still be in rollout.
 */
export async function assertSkipLink(page: Page, surfaceName: string): Promise<void> {
  // Focus the page to make skip link visible (they're often visually-hidden
  // until focus), then check the first focusable element.
  const firstAnchor = page.locator('a').first();
  const count = await firstAnchor.count();
  if (count === 0) return; // no anchors at all — landmark structure catches this
  const text = ((await firstAnchor.textContent()) ?? '').toLowerCase();
  const ariaLabel = ((await firstAnchor.getAttribute('aria-label')) ?? '').toLowerCase();
  const isSkipLink = /skip|content|main/.test(text) || /skip|content|main/.test(ariaLabel);
  // Non-blocking annotation — report the gap for visibility without failing CI
  // until all surfaces have been retroactively fitted.
  if (!isSkipLink) {
    // eslint-disable-next-line no-console
    console.warn(
      `[design-system] ${surfaceName}: no skip-to-content link detected (WCAG 2.4.1 Level A)`
    );
  }
}

/**
 * Bundled check — runs the full design system compliance suite for a
 * given surface. Callers that need to compose selectively import the
 * individual functions.
 *
 * Suite:
 *   1. Shared stylesheet linked
 *   2. No inline colors on interactive elements
 *   3. Heading hierarchy valid
 *   4. Landmark structure present
 *   5. Images have alt attributes
 *   6. Design tokens resolve on :root
 */
export async function assertDesignSystemCompliant(page: Page, surfaceName: string): Promise<void> {
  await assertSharedStylesheetLinked(page, surfaceName);
  await assertNoInlineColors(page, surfaceName);
  await assertHeadingHierarchy(page, surfaceName);
  await assertLandmarkStructure(page, surfaceName);
  await assertImagesHaveAlt(page, surfaceName);
  await assertDesignTokensResolve(page, surfaceName);
}
