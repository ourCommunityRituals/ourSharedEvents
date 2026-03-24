/**
 * Base Page Object
 *
 * Sustainability: Common methods shared by all pages
 * Easy to understand: Simple inheritance pattern
 * Mobile support: Mobile-aware interactions built-in
 */

import { expect } from '@playwright/test';
import { isMobile } from '../config';

export class BasePage {
  constructor(page) {
    this.page = page;
    this.isMobile = isMobile(page);
  }

  /**
   * Click element (mobile-aware)
   * Auto-waits for element to be clickable
   */
  async click(selector) {
    const element = this.page.locator(selector);

    // Wait for element to be visible and stable
    await expect(element).toBeVisible();

    // Mobile: Scroll into view and wait for stability
    if (this.isMobile) {
      await element.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(200); // Brief wait for scroll animation
    }

    await element.click();
  }

  /**
   * Fill input field (mobile-aware)
   * Auto-waits for element to be editable
   */
  async fill(selector, value) {
    const element = this.page.locator(selector);

    // Wait for element to be visible and editable
    await expect(element).toBeVisible();
    await expect(element).toBeEditable();

    // Mobile: Focus may trigger virtual keyboard
    if (this.isMobile) {
      await element.scrollIntoViewIfNeeded();
    }

    // Clear existing value and fill
    await element.clear();
    await element.fill(value);

    // Verify value was set
    await expect(element).toHaveValue(value);
  }

  /**
   * Select dropdown option (mobile-aware)
   */
  async select(selector, value) {
    const element = this.page.locator(selector);
    await expect(element).toBeVisible();

    if (this.isMobile) {
      await element.scrollIntoViewIfNeeded();
    }

    await element.selectOption(value);
  }

  /**
   * Wait for element to appear
   */
  async waitFor(selector, options = {}) {
    const element = this.page.locator(selector);
    await expect(element).toBeVisible(options);
    return element;
  }

  /**
   * Get text content
   */
  async getText(selector) {
    const element = this.page.locator(selector);
    await expect(element).toBeVisible();
    return await element.textContent();
  }

  /**
   * Check if element exists
   */
  async exists(selector) {
    return await this.page.locator(selector).count() > 0;
  }

  /**
   * Take screenshot (for debugging)
   */
  async screenshot(name) {
    await this.page.screenshot({
      path: `screenshots/${name}-${Date.now()}.png`,
      fullPage: true,
    });
  }
}
