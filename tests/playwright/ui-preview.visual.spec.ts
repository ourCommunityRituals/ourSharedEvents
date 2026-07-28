/**
 * OSE-286 — @ocr/ui visual regression baselines.
 *
 * Captures pixel-exact screenshots of the /ui-preview component showcase
 * in light and dark themes at desktop (1280×900) and mobile (375×812).
 * Committed PNGs are the source of truth: any rendering change that
 * falls outside the maxDiffPixelRatio (2%) threshold set in
 * playwright.config.ts fails this suite.
 *
 * ## Purpose
 *
 * When Claude Design generates a new component or proposes a style
 * change, the resulting PR runs this suite against staging. If the
 * screenshots drift beyond tolerance, CI blocks merge — the generated
 * output must visually match the established design system, not just
 * pass structural checks.
 *
 * ## Baseline management
 *
 * First run creates baselines (nothing to compare against yet):
 *   npx playwright test --update-snapshots ui-preview.visual
 *
 * After an intentional design change, update and commit new baselines:
 *   npx playwright test --update-snapshots ui-preview.visual
 *   git add tests/playwright/ui-preview.visual.spec.ts-snapshots/
 *   git commit -m "chore(visual): update @ocr/ui baselines after <change>"
 *
 * ## Screenshot inventory (12 PNGs)
 *
 * Full-page (4):
 *   - light-desktop-full.png    light theme, 1280×900
 *   - dark-desktop-full.png     dark theme,  1280×900
 *   - light-mobile-full.png     light theme, 375×812
 *   - dark-mobile-full.png      dark theme,  375×812
 *
 * Section-level, desktop only, both themes (8):
 *   - [light|dark]-section-buttons.png
 *   - [light|dark]-section-inputs.png
 *   - [light|dark]-section-form-partials.png
 *   - [light|dark]-section-empty-state.png
 *
 * ## Determinism
 *
 * CSS animations and transitions are frozen two ways:
 *   1. playwright.config.ts sets toHaveScreenshot.animations='disabled'
 *      (Playwright's built-in screenshot-time freeze)
 *   2. Each test injects a <style> tag disabling all transitions so
 *      the DOM is fully settled before capture (belt-and-suspenders)
 *
 * POM: UiPreviewPage fixture via _helpers/fixtures.ts (test.extend pattern).
 */

import { test, expect } from './_helpers/fixtures';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 812 };

/** Freeze all CSS transitions/animations for deterministic pixel capture. */
async function freezeAnimations(page: import('@playwright/test').Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  });
}

// ─── Full-page baselines ───────────────────────────────────────────────────────

test.describe('GET /ui-preview — full-page baselines', () => {
  test('OSE-286 | VR | light theme, desktop 1280×900 — full page matches baseline', async ({
    uiPreview,
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeLight();
    await freezeAnimations(page);
    await expect(page).toHaveScreenshot('light-desktop-full.png', { fullPage: true });
  });

  test('OSE-286 | VR | dark theme, desktop 1280×900 — full page matches baseline', async ({
    uiPreview,
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeDark();
    await freezeAnimations(page);
    await expect(page).toHaveScreenshot('dark-desktop-full.png', { fullPage: true });
  });

  test('OSE-286 | VR | light theme, mobile 375×812 — full page matches baseline', async ({
    uiPreview,
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeLight();
    await freezeAnimations(page);
    await expect(page).toHaveScreenshot('light-mobile-full.png', { fullPage: true });
  });

  test('OSE-286 | VR | dark theme, mobile 375×812 — full page matches baseline', async ({
    uiPreview,
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeDark();
    await freezeAnimations(page);
    await expect(page).toHaveScreenshot('dark-mobile-full.png', { fullPage: true });
  });
});

// ─── Section-level baselines (desktop, both themes) ───────────────────────────
// Targeted captures of the sections Claude Design is most likely to interact
// with. Section-level diffs isolate a change to one component category rather
// than flagging the entire page as changed.

test.describe('GET /ui-preview — section baselines (desktop, light)', () => {
  test.beforeEach(async ({ uiPreview, page }) => {
    await page.setViewportSize(DESKTOP);
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeLight();
    await freezeAnimations(page);
  });

  test('OSE-286 | VR | buttons section, light — matches baseline', async ({ uiPreview }) => {
    await expect(uiPreview.sectionButtons).toHaveScreenshot('light-section-buttons.png');
  });

  test('OSE-286 | VR | inputs section, light — matches baseline', async ({ uiPreview }) => {
    await expect(uiPreview.sectionInputs).toHaveScreenshot('light-section-inputs.png');
  });

  test('OSE-286 | VR | form partials section, light — matches baseline', async ({ uiPreview }) => {
    await expect(uiPreview.sectionFormPartials).toHaveScreenshot('light-section-form-partials.png');
  });

  test('OSE-286 | VR | empty state section, light — matches baseline', async ({ uiPreview }) => {
    await expect(uiPreview.sectionEmptyState).toHaveScreenshot('light-section-empty-state.png');
  });
});

test.describe('GET /ui-preview — section baselines (desktop, dark)', () => {
  test.beforeEach(async ({ uiPreview, page }) => {
    await page.setViewportSize(DESKTOP);
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeDark();
    await freezeAnimations(page);
  });

  test('OSE-286 | VR | buttons section, dark — matches baseline', async ({ uiPreview }) => {
    await expect(uiPreview.sectionButtons).toHaveScreenshot('dark-section-buttons.png');
  });

  test('OSE-286 | VR | inputs section, dark — matches baseline', async ({ uiPreview }) => {
    await expect(uiPreview.sectionInputs).toHaveScreenshot('dark-section-inputs.png');
  });

  test('OSE-286 | VR | form partials section, dark — matches baseline', async ({ uiPreview }) => {
    await expect(uiPreview.sectionFormPartials).toHaveScreenshot('dark-section-form-partials.png');
  });

  test('OSE-286 | VR | empty state section, dark — matches baseline', async ({ uiPreview }) => {
    await expect(uiPreview.sectionEmptyState).toHaveScreenshot('dark-section-empty-state.png');
  });
});
