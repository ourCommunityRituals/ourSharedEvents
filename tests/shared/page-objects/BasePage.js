/**
 * Base Page Object for E2E Tests
 *
 * Contains common methods and utilities for all page objects
 *
 * BASE_URL-Aware: Automatically uses centralized environment config
 * Default: https://stg.eventangle.com (staging via Cloudflare Workers)
 */

const { getBaseUrl } = require('../../config/environments');

class BasePage {
  constructor(page) {
    this.page = page;
    // Use centralized BASE_URL config (defaults to stg.eventangle.com)
    this.baseUrl = getBaseUrl();
    this.brandId = process.env.BRAND_ID || 'root';
    this.adminKey = process.env.ADMIN_KEY || 'CHANGE_ME_root';
  }

  /**
   * Navigate to a specific page with parameters
   */
  async navigateTo(params = {}) {
    const url = new URL(this.baseUrl);
    Object.entries({ brand: this.brandId, ...params }).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
    await this.page.goto(url.toString(), { waitUntil: 'networkidle' });
  }

  /**
   * Wait for page to be fully loaded
   */
  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForFunction(() => document.readyState === 'complete');
  }

  /**
   * Handle admin authentication dialog
   */
  async handleAdminDialog(adminKey = this.adminKey) {
    this.page.once('dialog', async dialog => {
      await dialog.accept(adminKey);
    });
  }

  /**
   * Check if element exists
   */
  async elementExists(selector) {
    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get element text
   */
  async getElementText(selector) {
    const element = await this.page.locator(selector);
    return await element.textContent();
  }

  /**
   * Click element with retry
   */
  async clickWithRetry(selector, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.page.locator(selector).click();
        return;
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await this.page.waitForTimeout(1000);
      }
    }
  }

  /**
   * Fill input field
   */
  async fillInput(selector, value) {
    await this.page.locator(selector).fill(value);
  }

  /**
   * Select dropdown option
   */
  async selectOption(selector, value) {
    await this.page.locator(selector).selectOption(value);
  }

  /**
   * Check if page contains text
   */
  async pageContainsText(text) {
    const content = await this.page.textContent('body');
    return content.includes(text);
  }

  /**
   * Take screenshot
   */
  async takeScreenshot(name) {
    await this.page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  }

  /**
   * Wait for navigation
   */
  async waitForNavigation() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get current URL
   */
  async getCurrentUrl() {
    return this.page.url();
  }

  /**
   * Check if URL contains parameter
   */
  async urlContainsParam(key, value = null) {
    const url = new URL(await this.getCurrentUrl());
    if (value === null) {
      return url.searchParams.has(key);
    }
    return url.searchParams.get(key) === value;
  }

  /**
   * Wait for API response
   */
  async waitForApiResponse(action) {
    return await this.page.waitForResponse(
      response => response.url().includes(`action=${action}`) && response.status() === 200,
      { timeout: 10000 }
    );
  }

  /**
   * Execute JavaScript in page context
   */
  async evaluate(fn, ...args) {
    return await this.page.evaluate(fn, ...args);
  }

  /**
   * Set viewport size
   */
  async setViewportSize(width, height) {
    await this.page.setViewportSize({ width, height });
  }

  /**
   * Emulate device (mobile, tablet, desktop)
   */
  async emulateDevice(device) {
    const devices = {
      mobile: { width: 375, height: 667 },
      tablet: { width: 768, height: 1024 },
      desktop: { width: 1920, height: 1080 },
      tv: { width: 1920, height: 1080 },
      '4k': { width: 3840, height: 2160 }
    };

    const deviceConfig = devices[device.toLowerCase()];
    if (deviceConfig) {
      await this.setViewportSize(deviceConfig.width, deviceConfig.height);
    }
  }

  /**
   * Check for JavaScript errors
   */
  async checkForJavaScriptErrors() {
    const errors = [];
    this.page.on('pageerror', error => {
      errors.push(error.message);
    });
    return errors;
  }

  /**
   * Get page performance metrics
   */
  async getPerformanceMetrics() {
    return await this.page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        loadTime: navigation.loadEventEnd - navigation.loadEventStart,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        timeToFirstByte: navigation.responseStart - navigation.requestStart
      };
    });
  }
}

module.exports = BasePage;
