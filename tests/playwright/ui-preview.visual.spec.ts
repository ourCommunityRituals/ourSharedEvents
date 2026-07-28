/**
 * OSE-286 — @ocr/ui visual regression baselines.
 *
 * Captures pixel-exact screenshots of /ui-preview in light and dark themes.
 * Runs under every project defined in playwright.config.ts (iPhone SE,
 * iPhone 14 Pro Max, iPad Air, Desktop Safari) — Playwright namespaces
 * snapshot filenames by project automatically, so each device gets its own
 * baseline set:
 *   light-full-iPhone-SE-darwin.png
 *   light-full-Desktop-Safari-darwin.png  …etc.
 *
 * ## Baseline management
 *
 * First run creates baselines:
 *   npx playwright test --update-snapshots ui-preview.visual
 *
 * After an intentional design change, update and commit new baselines:
 *   npx playwright test --update-snapshots ui-preview.visual
 *   git add tests/playwright/ui-preview.visual.spec.ts-snapshots/
 *   git commit -m "chore(visual): update @ocr/ui baselines after <change>"
 *
 * ## Screenshot inventory (per project)
 *
 * Full-page (2): light-full.png, dark-full.png
 * Section-level (8): [light|dark]-section-{buttons,inputs,form-partials,empty-state}.png
 *
 * ## Determinism
 *
 * Animations frozen two ways:
 *   1. playwright.config.ts: toHaveScreenshot.animations='disabled'
 *   2. freezeAnimations() injects a <style> tag before capture
 *
 * POM: UiPreviewPage fixture via _helpers/fixtures.ts (test.extend pattern).
 */

import { test, expect } from './_helpers/fixtures';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

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
  test('OSE-286 | VR | light theme — full page matches baseline', async ({ uiPreview, page }) => {
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeLight();
    await freezeAnimations(page);
    await expect(page).toHaveScreenshot('light-full.png', { fullPage: true });
  });

  test('OSE-286 | VR | dark theme — full page matches baseline', async ({ uiPreview, page }) => {
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeDark();
    await freezeAnimations(page);
    await expect(page).toHaveScreenshot('dark-full.png', { fullPage: true });
  });
});

// ─── Section-level baselines ───────────────────────────────────────────────────
// Targeted captures of the sections Claude Design is most likely to interact
// with. Section-level diffs isolate a change to one component category.

test.describe('GET /ui-preview — section baselines (light)', () => {
  test.beforeEach(async ({ uiPreview, page }) => {
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

test.describe('GET /ui-preview — section baselines (dark)', () => {
  test.beforeEach(async ({ uiPreview, page }) => {
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
