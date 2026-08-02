/**
 * Page Object Model for GET /ui-preview — @ocr/ui component showcase.
 *
 * Encapsulates all selectors and interactions for the design-system preview
 * page so ui-preview.spec.ts stays free of raw selector strings. Each section
 * is identified by its data-testid anchor; theme state is read from
 * document.documentElement.dataset.theme.
 *
 * Companion to mobile-workability-assertions.ts — import assertMobileWorkable
 * from there when you need the WCAG contract checks on this surface.
 */

import type { Page, Locator } from '@playwright/test';

export class UiPreviewPage {
  readonly page: Page;

  // Theme controls
  readonly themeBar: Locator;
  readonly themeAutoBtn: Locator;
  readonly themeLightBtn: Locator;
  readonly themeDarkBtn: Locator;

  // Component sections — each identified by data-testid on the wrapper div
  readonly sectionButtons: Locator;
  readonly sectionCards: Locator;
  readonly sectionInputs: Locator;
  readonly sectionNavigation: Locator;
  readonly sectionFeedback: Locator;
  readonly sectionLists: Locator;
  readonly sectionChips: Locator;
  readonly sectionEmptyState: Locator;
  readonly sectionFormControls: Locator;
  readonly sectionFormPartials: Locator;
  readonly sectionTokens: Locator;

  // Representative component instances within sections
  readonly btnPrimary: Locator;
  readonly btnDisabled: Locator;
  readonly inputDemo: Locator;
  readonly formInputName: Locator;
  readonly formInputEmail: Locator;
  readonly formInputError: Locator;
  readonly formTextarea: Locator;
  readonly formSelect: Locator;
  readonly formCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;

    this.themeBar = page.getByTestId('theme-bar');
    this.themeAutoBtn = page.getByTestId('theme-auto');
    this.themeLightBtn = page.getByTestId('theme-light');
    this.themeDarkBtn = page.getByTestId('theme-dark');

    this.sectionButtons = page.getByTestId('preview-section-buttons');
    this.sectionCards = page.getByTestId('preview-section-cards');
    this.sectionInputs = page.getByTestId('preview-section-inputs');
    this.sectionNavigation = page.getByTestId('preview-section-navigation');
    this.sectionFeedback = page.getByTestId('preview-section-feedback');
    this.sectionLists = page.getByTestId('preview-section-lists');
    this.sectionChips = page.getByTestId('preview-section-chips');
    this.sectionEmptyState = page.getByTestId('preview-section-empty-state');
    this.sectionFormControls = page.getByTestId('preview-section-form-controls');
    this.sectionFormPartials = page.getByTestId('preview-section-form-partials');
    this.sectionTokens = page.getByTestId('preview-section-tokens');

    this.btnPrimary = page.getByTestId('btn-primary-demo');
    this.btnDisabled = page.getByTestId('btn-disabled-demo');
    this.inputDemo = page.getByTestId('input-demo');
    this.formInputName = page.locator('#pv-name');
    this.formInputEmail = page.locator('#pv-email');
    this.formInputError = page.locator('#pv-err');
    this.formTextarea = page.locator('#pv-bio');
    this.formSelect = page.locator('#pv-tier');
    this.formCheckbox = page.locator('#pv-agree');
  }

  async goto(baseUrl: string): Promise<void> {
    await this.page.goto(`${baseUrl}/ui-preview`, { waitUntil: 'domcontentloaded' });
  }

  /** Returns the current [data-theme] value on <html>, or null when auto (system). */
  async currentTheme(): Promise<string | null> {
    return this.page.evaluate(() => document.documentElement.dataset['theme'] ?? null);
  }

  async setThemeLight(): Promise<void> {
    await this.themeLightBtn.click();
  }

  async setThemeDark(): Promise<void> {
    await this.themeDarkBtn.click();
  }

  async setThemeAuto(): Promise<void> {
    await this.themeAutoBtn.click();
  }

  get allSections(): Locator[] {
    return [
      this.sectionButtons,
      this.sectionCards,
      this.sectionInputs,
      this.sectionNavigation,
      this.sectionFeedback,
      this.sectionLists,
      this.sectionChips,
      this.sectionEmptyState,
      this.sectionFormControls,
      this.sectionFormPartials,
      this.sectionTokens,
    ];
  }
}
