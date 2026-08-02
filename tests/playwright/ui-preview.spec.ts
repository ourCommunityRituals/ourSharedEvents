/**
 * OSE-286 — @ocr/ui component showcase spec.
 *
 * Validates GET /ui-preview: component sections render, theme toggle writes
 * [data-theme] on <html>, form partials are present with correct aria wiring,
 * and the surface meets the mobile workability contracts that the component
 * library itself is meant to enforce.
 *
 * Test naming follows OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-286 | <role> | GET /ui-preview (<condition>) | <assertion>`
 *
 * POM: UiPreviewPage fixture via _helpers/fixtures.ts (test.extend pattern).
 * Mobile WCAG contracts: assertMobileWorkable from mobile-workability-assertions.ts.
 */

import { test, expect } from './_helpers/fixtures';
import { loadAndSettle, assertMobileWorkable } from './_helpers/mobile-workability-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

test.describe('GET /ui-preview', () => {
  test('OSE-286 | FE | GET /ui-preview (cold load) | page renders with correct title', async ({
    uiPreview,
    page,
  }) => {
    await uiPreview.goto(BASE_URL);
    await expect(page).toHaveTitle(/@ocr\/ui/);
  });

  test('OSE-286 | FE | GET /ui-preview (cold load) | all 11 component sections are present', async ({
    uiPreview,
  }) => {
    await uiPreview.goto(BASE_URL);
    for (const section of uiPreview.allSections) {
      await expect(section).toBeVisible();
    }
  });

  test('OSE-286 | FE | GET /ui-preview (cold load) | theme bar is sticky and all three toggles render', async ({
    uiPreview,
  }) => {
    await uiPreview.goto(BASE_URL);
    await expect(uiPreview.themeBar).toBeVisible();
    await expect(uiPreview.themeAutoBtn).toBeVisible();
    await expect(uiPreview.themeLightBtn).toBeVisible();
    await expect(uiPreview.themeDarkBtn).toBeVisible();
  });

  test('OSE-286 | FE | GET /ui-preview (theme=light) | clicking Light sets data-theme="light" on <html>', async ({
    uiPreview,
  }) => {
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeLight();
    expect(await uiPreview.currentTheme()).toBe('light');
  });

  test('OSE-286 | FE | GET /ui-preview (theme=dark) | clicking Dark sets data-theme="dark" on <html>', async ({
    uiPreview,
  }) => {
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeDark();
    expect(await uiPreview.currentTheme()).toBe('dark');
  });

  test('OSE-286 | FE | GET /ui-preview (theme=auto) | clicking Auto removes data-theme from <html>', async ({
    uiPreview,
  }) => {
    await uiPreview.goto(BASE_URL);
    await uiPreview.setThemeDark();
    await uiPreview.setThemeAuto();
    expect(await uiPreview.currentTheme()).toBeNull();
  });

  test('OSE-286 | FE | GET /ui-preview (buttons section) | primary, secondary, danger, and disabled variants render', async ({
    uiPreview,
    page,
  }) => {
    await uiPreview.goto(BASE_URL);
    await expect(uiPreview.btnPrimary).toBeVisible();
    await expect(page.getByTestId('btn-secondary-demo')).toBeVisible();
    await expect(page.getByTestId('btn-danger-demo')).toBeVisible();
    await expect(uiPreview.btnDisabled).toBeDisabled();
  });

  test('OSE-286 | FE | GET /ui-preview (form partials section) | formInput, textarea, select, checkbox, and radioGroup render', async ({
    uiPreview,
  }) => {
    await uiPreview.goto(BASE_URL);
    await expect(uiPreview.sectionFormPartials).toBeVisible();
    await expect(uiPreview.formInputName).toBeVisible();
    await expect(uiPreview.formInputEmail).toBeVisible();
    await expect(uiPreview.formTextarea).toBeVisible();
    await expect(uiPreview.formSelect).toBeVisible();
    await expect(uiPreview.formCheckbox).toBeVisible();
  });

  test('OSE-286 | A11Y | GET /ui-preview (form partials — error state) | aria-invalid and role=alert are present on error input', async ({
    uiPreview,
    page,
  }) => {
    await uiPreview.goto(BASE_URL);
    await expect(uiPreview.formInputError).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#pv-err-error[role="alert"]')).toBeVisible();
  });

  test('OSE-286 | A11Y | GET /ui-preview (form partials — required field) | required mark and attribute present on name input', async ({
    uiPreview,
  }) => {
    await uiPreview.goto(BASE_URL);
    await expect(uiPreview.formInputName).toHaveAttribute('required', '');
    await expect(uiPreview.sectionFormPartials.locator('.required-mark').first()).toBeVisible();
  });

  test('OSE-286 | A11Y | GET /ui-preview (form partials — hint) | aria-describedby wired to hint on email input', async ({
    uiPreview,
    page,
  }) => {
    await uiPreview.goto(BASE_URL);
    const describedBy = await uiPreview.formInputEmail.getAttribute('aria-describedby');
    expect(describedBy).toBe('pv-email-hint');
    await expect(page.locator('#pv-email-hint')).toBeVisible();
  });

  test('OSE-286 | FE | GET /ui-preview (design tokens section) | token swatch grid renders at least 10 swatches', async ({
    uiPreview,
  }) => {
    await uiPreview.goto(BASE_URL);
    const swatches = uiPreview.sectionTokens.locator('.token-swatch');
    expect(await swatches.count()).toBeGreaterThanOrEqual(10);
  });

  test('OSE-286 | WCAG | GET /ui-preview (mobile 375px) | surface meets mobile workability contracts', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/ui-preview`);
    await assertMobileWorkable(page, '/ui-preview', {
      primaryCtaSelector: '[data-testid="btn-primary-demo"]',
    });
  });
});
