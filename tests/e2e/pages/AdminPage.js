/**
 * Admin Page Object
 *
 * Sustainability: Encapsulates all admin page interactions
 * Easy to understand: Methods named after user actions
 * Mobile support: Inherits mobile-aware interactions from BasePage
 */

import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class AdminPage extends BasePage {
  constructor(page) {
    super(page);

    // Event Form Selectors (match Admin.html actual IDs)
    this.eventNameInput = '#name';
    this.eventDateInput = '#startDateISO';  // Note: Admin.html uses #startDateISO, not #dateISO
    this.eventVenueInput = '#venue';  // Note: Admin.html uses #venue, not #location
    this.eventDescriptionInput = '#summary, #description, textarea[placeholder*="description"]';
    this.eventSubmitButton = 'button[type="submit"]:has-text("Create"), button:has-text("Save Event")';
    this.eventCard = '#eventCard, [data-testid="event-card"]';

    // Sponsor Form Selectors
    this.sponsorNameInput = '.sp-name, [data-testid="sponsor-name"]';
    this.sponsorUrlInput = '.sp-url, [data-testid="sponsor-url"]';
    this.sponsorLogoInput = '.sp-logo, [data-testid="sponsor-logo"]';
    this.addSponsorButton = 'button:has-text("Add Sponsor")';

    // Display Configuration Selectors
    this.configureDisplayButton = 'button:has-text("Configure Display")';
    this.displaySettings = '#displaySettings, [data-testid="display-settings"]';

    // Forms Templates Selectors
    this.openFormsButton = 'button:has-text("Forms Templates"), button:has-text("Create Forms")';
    this.formsPanel = '#formsPanel, [data-testid="forms-panel"]';
  }

  /**
   * Create a new event
   * @param {string} name - Event name
   * @param {string} date - Event date (ISO format)
   * @param {string} description - Event description (optional)
   * @returns {Promise<string>} Event ID
   */
  async createEvent(name, date = '2025-12-31', description = '') {
    // Fill event form
    await this.fill(this.eventNameInput, name);
    await this.fill(this.eventDateInput, date);

    if (description) {
      await this.fill(this.eventDescriptionInput, description);
    }

    // Submit form
    await this.click(this.eventSubmitButton);

    // Wait for event card to appear (confirms creation)
    const eventCard = await this.waitFor(this.eventCard);

    // Extract event ID from card
    const cardText = await eventCard.textContent();
    const idMatch = cardText.match(/ID:\s*(\w+)/);

    if (!idMatch) {
      throw new Error('Could not extract event ID from event card');
    }

    const eventId = idMatch[1];
    console.log(`✅ Created event: ${name} (ID: ${eventId})`);

    return eventId;
  }

  /**
   * Add a sponsor to the current event
   * @param {string} name - Sponsor name
   * @param {string} url - Sponsor website URL
   * @param {string} logoUrl - Sponsor logo URL (optional)
   */
  async addSponsor(name, url, logoUrl = '') {
    // Fill sponsor form
    await this.fill(this.sponsorNameInput, name);
    await this.fill(this.sponsorUrlInput, url);

    if (logoUrl) {
      await this.fill(this.sponsorLogoInput, logoUrl);
    }

    // Click Add Sponsor
    await this.click(this.addSponsorButton);

    // Verify sponsor appears on page
    await this.waitFor(`text="${name}"`);

    console.log(`✅ Added sponsor: ${name}`);
  }

  /**
   * Open display configuration panel
   */
  async openDisplayConfiguration() {
    await this.click(this.configureDisplayButton);
    await this.waitFor(this.displaySettings);
    console.log('✅ Opened display configuration');
  }

  /**
   * Open forms templates panel
   */
  async openFormsPanel() {
    await this.click(this.openFormsButton);
    await this.waitFor(this.formsPanel);
    console.log('✅ Opened forms panel');
  }

  /**
   * Create form from template
   * @param {string} templateType - Type of form (check-in, walk-in, survey)
   * @returns {Promise<string>} Shortlink URL
   */
  async createFormFromTemplate(templateType) {
    // Ensure forms panel is open
    if (!(await this.exists(this.formsPanel))) {
      await this.openFormsPanel();
    }

    // Click create button for specific template
    const createButton = this.page.locator(
      `button[onclick*="${templateType}"], button[data-template="${templateType}"]`
    );
    await createButton.click();

    // Wait for shortlink to appear
    const shortlinkInput = this.page.locator(
      `#${templateType}-shortlink, input[value*="http"][readonly]`
    );
    await expect(shortlinkInput).toBeVisible({ timeout: 15000 });

    // Get shortlink value
    const shortlink = await shortlinkInput.inputValue();
    console.log(`✅ Created ${templateType} form: ${shortlink}`);

    return shortlink;
  }

  /**
   * Verify event appears in event card
   * @param {string} eventName - Expected event name
   */
  async verifyEventCreated(eventName) {
    const eventCard = this.page.locator(this.eventCard);
    await expect(eventCard).toBeVisible();
    await expect(eventCard).toContainText(eventName);
  }

  /**
   * Get links for public and display pages
   * @returns {Promise<{public: string, display: string}>}
   */
  async getEventLinks() {
    const eventCard = this.page.locator(this.eventCard);
    await expect(eventCard).toBeVisible();

    // Extract links from card
    const publicLink = await eventCard
      .locator('a[href*="p=events"], a:has-text("Public")')
      .getAttribute('href');

    const displayLink = await eventCard
      .locator('a[href*="display"], a:has-text("Display")')
      .getAttribute('href');

    return {
      public: publicLink,
      display: displayLink,
    };
  }

  /**
   * Clear/reset event form
   */
  async clearEventForm() {
    const clearButton = this.page.locator('button:has-text("Clear")');

    if (await clearButton.isVisible()) {
      await clearButton.click();
      console.log('✅ Cleared event form');
    }
  }
}
