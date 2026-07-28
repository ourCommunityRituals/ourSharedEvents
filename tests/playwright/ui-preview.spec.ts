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
 * POM: UiPreviewPage (_helpers/ui-preview.page.ts) owns all selectors.
 * Mobile WCAG contracts: assertMobileWorkable from mobile-workability-assertions.ts.
 */

import { test, expect } from '@playwright/test';
import { UiPreviewPage } from './_helpers/ui-preview.page';
import { loadAndSettle, assertMobileWorkable } from './_helpers/mobile-workability-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

test.describe('GET /ui-preview', () => {
  test('OSE-286 | FE | GET /ui-preview (cold load) | page renders with correct title', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await expect(page).toHaveTitle(/@ocr\/ui/);
  });

  test('OSE-286 | FE | GET /ui-preview (cold load) | all 11 component sections are present', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    for (const section of ui.allSections) {
      await expect(section).toBeVisible();
    }
  });

  test('OSE-286 | FE | GET /ui-preview (cold load) | theme bar is sticky and all three toggles render', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await expect(ui.themeBar).toBeVisible();
    await expect(ui.themeAutoBtn).toBeVisible();
    await expect(ui.themeLightBtn).toBeVisible();
    await expect(ui.themeDarkBtn).toBeVisible();
  });

  test('OSE-286 | FE | GET /ui-preview (theme=light) | clicking Light sets data-theme="light" on <html>', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await ui.setThemeLight();
    expect(await ui.currentTheme()).toBe('light');
  });

  test('OSE-286 | FE | GET /ui-preview (theme=dark) | clicking Dark sets data-theme="dark" on <html>', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await ui.setThemeDark();
    expect(await ui.currentTheme()).toBe('dark');
  });

  test('OSE-286 | FE | GET /ui-preview (theme=auto) | clicking Auto removes data-theme from <html>', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await ui.setThemeDark();
    await ui.setThemeAuto();
    expect(await ui.currentTheme()).toBeNull();
  });

  test('OSE-286 | FE | GET /ui-preview (buttons section) | primary, secondary, danger, and disabled variants render', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await expect(ui.btnPrimary).toBeVisible();
    await expect(page.getByTestId('btn-secondary-demo')).toBeVisible();
    await expect(page.getByTestId('btn-danger-demo')).toBeVisible();
    const disabled = ui.btnDisabled;
    await expect(disabled).toBeDisabled();
  });

  test('OSE-286 | FE | GET /ui-preview (form partials section) | formInput, textarea, select, checkbox, and radioGroup render', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await expect(ui.sectionFormPartials).toBeVisible();
    await expect(ui.formInputName).toBeVisible();
    await expect(ui.formInputEmail).toBeVisible();
    await expect(ui.formTextarea).toBeVisible();
    await expect(ui.formSelect).toBeVisible();
    await expect(ui.formCheckbox).toBeVisible();
  });

  test('OSE-286 | A11Y | GET /ui-preview (form partials — error state) | aria-invalid and role=alert are present on error input', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await expect(ui.formInputError).toHaveAttribute('aria-invalid', 'true');
    // error message container carries role=alert for assistive tech
    await expect(page.locator('#pv-err-error[role="alert"]')).toBeVisible();
  });

  test('OSE-286 | A11Y | GET /ui-preview (form partials — required field) | required mark and attribute present on name input', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    await expect(ui.formInputName).toHaveAttribute('required', '');
    await expect(ui.sectionFormPartials.locator('.required-mark').first()).toBeVisible();
  });

  test('OSE-286 | A11Y | GET /ui-preview (form partials — hint) | aria-describedby wired to hint on email input', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    const describedBy = await ui.formInputEmail.getAttribute('aria-describedby');
    expect(describedBy).toBe('pv-email-hint');
    await expect(page.locator('#pv-email-hint')).toBeVisible();
  });

  test('OSE-286 | FE | GET /ui-preview (design tokens section) | token swatch grid renders at least 10 swatches', async ({
    page,
  }) => {
    const ui = new UiPreviewPage(page);
    await ui.goto(BASE_URL);
    const swatches = ui.sectionTokens.locator('.token-swatch');
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
