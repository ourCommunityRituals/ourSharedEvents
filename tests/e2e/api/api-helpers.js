/**
 * API Testing Helpers for Playwright
 *
 * Story 5.2: Updated to use Worker-native /api/v2/* endpoints
 * All requests go directly to Cloudflare Worker (no GAS proxy)
 *
 * EVENT_CONTRACT.md v2.0 Compliance:
 * - EventBuilder uses v2.0 field names: startDateISO, venue
 * - API responses validated for canonical event shape
 */

export class ApiHelpers {
  /**
   * @param {import('@playwright/test').APIRequestContext} request
   * @param {string} baseUrl
   */
  constructor(request, baseUrl) {
    this.request = request;
    this.baseUrl = baseUrl;
  }

  /**
   * GET request helper
   * @param {string} path - URL path (including query params)
   * @param {object} options - Additional options
   */
  async get(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    return await this.request.get(url, options);
  }

  /**
   * POST request helper
   * @param {string} path - URL path
   * @param {object} data - Request body
   * @param {object} options - Additional options
   */
  async post(path, data, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    return await this.request.post(url, {
      data,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
  }

  /**
   * PUT request helper
   * @param {string} path - URL path
   * @param {object} data - Request body
   * @param {object} options - Additional options
   */
  async put(path, data, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    return await this.request.put(url, {
      data,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
  }

  /**
   * DELETE request helper
   * @param {string} path - URL path
   * @param {object} options - Additional options
   */
  async delete(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    return await this.request.delete(url, options);
  }

  // ============================================================================
  // SYSTEM APIs
  // ============================================================================

  /**
   * Check system status via Worker-native API
   * @param {string} brand - Brand ID
   */
  async getStatus(brand = 'root') {
    return await this.get(`/api/v2/status?brand=${brand}`);
  }

  /**
   * Ping endpoint for health check
   */
  async ping() {
    return await this.get('/api/v2/ping');
  }

  // ============================================================================
  // EVENT APIs (CRUD) - Worker-native /api/v2/events
  // ============================================================================

  /**
   * Create an event via Worker-native API
   * POST /api/v2/events
   *
   * @param {string} brand - Brand ID
   * @param {object} eventData - Event data (per EVENT_CONTRACT.md v2.0)
   * @param {string} adminKey - Admin key for authentication
   */
  async createEvent(brand, eventData, adminKey) {
    return await this.post('/api/v2/events', {
      ...eventData,
      brandId: brand
    }, {
      headers: {
        'X-Admin-Key': adminKey
      }
    });
  }

  /**
   * Get a specific event
   * GET /api/v2/events/:id
   *
   * @param {string} brand - Brand ID
   * @param {string} eventId - Event ID
   */
  async getEvent(brand, eventId) {
    return await this.get(`/api/v2/events/${eventId}?brand=${brand}`);
  }

  /**
   * List all events for a brand
   * GET /api/v2/events
   *
   * @param {string} brand - Brand ID
   * @param {boolean} full - Include full event data
   */
  async listEvents(brand, full = false) {
    const params = new URLSearchParams({ brand });
    if (full) params.set('full', 'true');
    return await this.get(`/api/v2/events?${params}`);
  }

  /**
   * Update an event via Worker-native API
   * PUT /api/v2/events/:id
   *
   * @param {string} brand - Brand ID
   * @param {string} eventId - Event ID
   * @param {object} eventData - Event data to update
   * @param {string} adminKey - Admin key for authentication
   */
  async updateEvent(brand, eventId, eventData, adminKey) {
    return await this.put(`/api/v2/events/${eventId}?brand=${brand}`, eventData, {
      headers: {
        'X-Admin-Key': adminKey
      }
    });
  }

  /**
   * Delete an event via Worker-native API
   * DELETE /api/v2/events/:id
   *
   * @param {string} brand - Brand ID
   * @param {string} eventId - Event ID
   * @param {string} adminKey - Admin key for authentication
   */
  async deleteEvent(brand, eventId, adminKey) {
    return await this.delete(`/api/v2/events/${eventId}?brand=${brand}`, {
      headers: {
        'X-Admin-Key': adminKey
      }
    });
  }

  // ============================================================================
  // BUNDLE APIs - Worker-native /api/v2/events/:id/bundle/:type
  // ============================================================================

  /**
   * Get public bundle for an event
   * @param {string} brand - Brand ID
   * @param {string} eventId - Event ID or slug
   */
  async getPublicBundle(brand, eventId) {
    return await this.get(`/api/v2/events/${eventId}/bundle/public?brand=${brand}`);
  }

  /**
   * Get display bundle for an event
   * @param {string} brand - Brand ID
   * @param {string} eventId - Event ID or slug
   */
  async getDisplayBundle(brand, eventId) {
    return await this.get(`/api/v2/events/${eventId}/bundle/display?brand=${brand}`);
  }

  /**
   * Get poster bundle for an event
   * @param {string} brand - Brand ID
   * @param {string} eventId - Event ID or slug
   */
  async getPosterBundle(brand, eventId) {
    return await this.get(`/api/v2/events/${eventId}/bundle/poster?brand=${brand}`);
  }

  /**
   * Get admin bundle for an event (requires auth)
   * @param {string} brand - Brand ID
   * @param {string} eventId - Event ID
   * @param {string} adminKey - Admin key
   */
  async getAdminBundle(brand, eventId, adminKey) {
    return await this.get(`/api/v2/events/${eventId}/bundle/admin?brand=${brand}`, {
      headers: {
        'X-Admin-Key': adminKey
      }
    });
  }

  // ============================================================================
  // SPONSOR APIs (CRUD) - Placeholder for future Worker-native implementation
  // ============================================================================
  // Note: Sponsors are not yet implemented in Worker-native API
  // These methods will return 404 until implemented

  /**
   * Create a sponsor (NOT YET IMPLEMENTED IN WORKER)
   */
  async createSponsor(brand, sponsorData, adminKey) {
    // TODO: Implement /api/v2/sponsors when needed
    console.warn('Sponsor API not yet implemented in Worker-native');
    return await this.post('/api/v2/sponsors', {
      ...sponsorData,
      brandId: brand
    }, {
      headers: { 'X-Admin-Key': adminKey }
    });
  }

  /**
   * Get a specific sponsor (NOT YET IMPLEMENTED IN WORKER)
   */
  async getSponsor(brand, sponsorId) {
    return await this.get(`/api/v2/sponsors/${sponsorId}?brand=${brand}`);
  }

  /**
   * List all sponsors for a brand (NOT YET IMPLEMENTED IN WORKER)
   */
  async listSponsors(brand) {
    return await this.get(`/api/v2/sponsors?brand=${brand}`);
  }

  /**
   * Update a sponsor (NOT YET IMPLEMENTED IN WORKER)
   */
  async updateSponsor(brand, sponsorId, updateData, adminKey) {
    return await this.put(`/api/v2/sponsors/${sponsorId}?brand=${brand}`, updateData, {
      headers: { 'X-Admin-Key': adminKey }
    });
  }

  /**
   * Delete a sponsor (NOT YET IMPLEMENTED IN WORKER)
   */
  async deleteSponsor(brand, sponsorId, adminKey) {
    return await this.delete(`/api/v2/sponsors/${sponsorId}?brand=${brand}`, {
      headers: { 'X-Admin-Key': adminKey }
    });
  }

  // ============================================================================
  // HELPER UTILITIES
  // ============================================================================

  /**
   * Assert response is successful
   * @param {import('@playwright/test').APIResponse} response
   */
  async assertSuccess(response) {
    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`API request failed: ${response.status()} ${response.statusText()}\n${body}`);
    }
    return response;
  }

  /**
   * Get JSON response or throw detailed error
   * @param {import('@playwright/test').APIResponse} response
   */
  async getJsonOrThrow(response) {
    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`API request failed: ${response.status()}\n${body}`);
    }
    return await response.json();
  }

  /**
   * Wait for condition with retries
   * @param {Function} condition - Async function that returns boolean
   * @param {number} maxAttempts - Maximum retry attempts
   * @param {number} delayMs - Delay between retries
   */
  async waitFor(condition, maxAttempts = 10, delayMs = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      if (await condition()) {
        return true;
      }
      if (i < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    return false;
  }

  /**
   * Create test event with default values per EVENT_CONTRACT.md v2.0
   * @param {string} brand - Brand ID
   * @param {string} adminKey - Admin key
   * @param {object} overrides - Override default values
   */
  async createTestEvent(brand, adminKey, overrides = {}) {
    const timestamp = Date.now();
    // v2.0: Use canonical field names (startDateISO, venue)
    const defaultEvent = {
      name: `Test Event ${timestamp}`,
      startDateISO: '2025-12-01',  // v2.0: was dateISO
      venue: 'Test Venue',          // v2.0: was location
      // V2 optional defaults
      ctas: {
        primary: { label: 'Sign Up', url: '' },
        secondary: null
      },
      settings: {
        showSchedule: false,
        showStandings: false,
        showBracket: false,
        showSponsors: false
      },
      ...overrides
    };

    const response = await this.createEvent(brand, defaultEvent, adminKey);
    const data = await this.getJsonOrThrow(response);

    return {
      response,
      data,
      eventId: data.value?.id,
      eventData: defaultEvent
    };
  }

  /**
   * Create test sponsor with default values
   * @param {string} brand - Brand ID
   * @param {string} adminKey - Admin key
   * @param {object} overrides - Override default values
   */
  async createTestSponsor(brand, adminKey, overrides = {}) {
    const timestamp = Date.now();
    const defaultSponsor = {
      name: `Test Sponsor ${timestamp}`,
      website: 'https://example.com',
      tier: 'gold',
      entity: 'test',
      ...overrides
    };

    const response = await this.createSponsor(brand, defaultSponsor, adminKey);
    const data = await this.getJsonOrThrow(response);

    return {
      response,
      data,
      sponsorId: data.value?.id,
      sponsorData: defaultSponsor
    };
  }
}

/**
 * Test data builders per EVENT_CONTRACT.md v2.0
 */
export class EventBuilder {
  constructor() {
    // v2.0 canonical field names
    this.data = {
      name: 'Test Event',
      startDateISO: '2025-12-01',  // v2.0: was dateISO
      venue: 'Test Venue',          // v2.0: was location
      ctas: {
        primary: { label: 'Sign Up', url: '' },
        secondary: null
      },
      settings: {
        showSchedule: false,
        showStandings: false,
        showBracket: false,
        showSponsors: false
      },
      // v2.0: Payments seam (Stripe MVP)
      payments: {
        enabled: false,
        provider: 'stripe',
        price: null,
        currency: 'USD',
        checkoutUrl: null
      }
    };
  }

  withName(name) {
    this.data.name = name;
    return this;
  }

  withDate(date) {
    this.data.startDateISO = date;  // v2.0 field name
    return this;
  }

  withVenue(venue) {
    this.data.venue = venue;  // v2.0 field name
    return this;
  }

  // Legacy alias for backward compatibility
  withLocation(location) {
    this.data.venue = location;  // Maps to v2.0 venue field
    return this;
  }

  withSignupUrl(url) {
    this.data.ctas.primary.url = url;
    return this;
  }

  withCTALabel(label) {
    this.data.ctas.primary.label = label;
    return this;
  }

  withSchedule(schedule) {
    this.data.schedule = schedule;
    this.data.settings.showSchedule = true;
    return this;
  }

  withSettings(settings) {
    this.data.settings = { ...this.data.settings, ...settings };
    return this;
  }

  withSponsors(sponsors) {
    this.data.sponsors = sponsors;
    if (sponsors && sponsors.length > 0) {
      this.data.settings.showSponsors = true;
    }
    return this;
  }

  withPayments(payments) {
    this.data.payments = { ...this.data.payments, ...payments };
    return this;
  }

  withCheckoutUrl(url, price = null) {
    this.data.payments = {
      ...this.data.payments,
      enabled: true,
      checkoutUrl: url,
      price: price
    };
    return this;
  }

  build() {
    return { ...this.data };
  }
}

export class SponsorBuilder {
  constructor() {
    this.data = {
      name: 'Test Sponsor',
      website: 'https://example.com',
      tier: 'gold',
      entity: 'test'
    };
  }

  withName(name) {
    this.data.name = name;
    return this;
  }

  withWebsite(website) {
    this.data.website = website;
    return this;
  }

  withTier(tier) {
    this.data.tier = tier;
    return this;
  }

  withLogo(logoUrl) {
    this.data.logoUrl = logoUrl;
    return this;
  }

  withEntity(entity) {
    this.data.entity = entity;
    return this;
  }

  build() {
    return { ...this.data };
  }
}
