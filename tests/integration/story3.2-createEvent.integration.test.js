/**
 * Integration Tests for Story 3.2 - Admin Create Event API
 *
 * Tests the complete create event flow against staging environment.
 *
 * Stage-2 test requirements:
 * - Creates dummy event via Admin API
 * - Verifies it shows in /api/events list
 *
 * Environment:
 *   WORKER_URL - Base URL for Worker API (defaults to staging)
 *   ADMIN_TOKEN - Admin authentication token
 *
 * Run locally:
 *   WORKER_URL=http://localhost:8787 ADMIN_TOKEN=test npm test -- tests/integration/story3.2
 *
 * Run against staging:
 *   WORKER_URL=https://api-stg.eventangle.com ADMIN_TOKEN=xxx npm test -- tests/integration/story3.2
 *
 * @see worker/src/handlers/adminCreateEvent.ts
 * @see Story 3.2 - Port createEvent to Worker
 */

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
const BRAND_ID = 'root';

// =============================================================================
// Test Setup
// =============================================================================

/**
 * Generate a unique event name for testing
 */
function generateUniqueEventName() {
  return `Test Event ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create an event via the Admin API
 */
async function createEvent(eventData) {
  const response = await fetch(`${WORKER_URL}/api/admin/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify(eventData),
  });

  const body = await response.json();
  return { status: response.status, body };
}

/**
 * List events via the public API
 */
async function listEvents(brandId = BRAND_ID) {
  const response = await fetch(`${WORKER_URL}/api/events?brand=${brandId}`);
  const body = await response.json();
  return { status: response.status, body };
}

// =============================================================================
// Integration Tests - Happy Path
// =============================================================================

describe('Story 3.2 Integration: Create Event via Worker API', () => {

  describe('POST /api/admin/events - Create Event', () => {

    it('should create a new event and return 201 with event data', async () => {
      const eventName = generateUniqueEventName();
      const eventData = {
        name: eventName,
        startDateISO: '2025-12-15',
        venue: 'Integration Test Venue',
        brandId: BRAND_ID,
      };

      const { status, body } = await createEvent(eventData);

      // Verify response
      expect(status).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.status).toBe(201);
      expect(body.item).toBeDefined();
      expect(body.message).toContain('Event created');

      // Verify event data
      const event = body.item;
      expect(event.id).toBeDefined();
      expect(event.id).toMatch(/^evt-/);
      expect(event.slug).toBeDefined();
      expect(event.name).toBe(eventName);
      expect(event.startDateISO).toBe('2025-12-15');
      expect(event.venue).toBe('Integration Test Venue');
      expect(event.brandId).toBe(BRAND_ID);
      expect(event.eventTag).toBeDefined();
      expect(event.createdAtISO).toBeDefined();
      expect(event.updatedAtISO).toBeDefined();
    });

    it('should generate unique slug from event name', async () => {
      const eventData = {
        name: 'Slug Generation Test Event',
        startDateISO: '2025-12-16',
        venue: 'Test Venue',
        brandId: BRAND_ID,
      };

      const { status, body } = await createEvent(eventData);

      expect(status).toBe(201);
      expect(body.item.slug).toBe('slug-generation-test-event');
    });

    it('should handle slug collisions with -2 suffix', async () => {
      const baseName = `Collision Test ${Date.now()}`;

      // Create first event
      const { status: status1, body: body1 } = await createEvent({
        name: baseName,
        startDateISO: '2025-12-17',
        venue: 'Venue 1',
        brandId: BRAND_ID,
      });

      expect(status1).toBe(201);
      const firstSlug = body1.item.slug;

      // Create second event with same name but different venue
      const { status: status2, body: body2 } = await createEvent({
        name: baseName,
        startDateISO: '2025-12-18',
        venue: 'Venue 2',
        brandId: BRAND_ID,
      });

      expect(status2).toBe(201);
      const secondSlug = body2.item.slug;

      // Second slug should have -2 suffix
      expect(secondSlug).toBe(`${firstSlug}-2`);
    });

    it('should generate eventTag with brand, slug, and date', async () => {
      const eventData = {
        name: 'EventTag Test',
        startDateISO: '2025-12-19',
        venue: 'Test Venue',
        brandId: 'abc',
      };

      const { status, body } = await createEvent(eventData);

      expect(status).toBe(201);
      expect(body.item.eventTag).toContain('ABC');
      expect(body.item.eventTag).toContain('2025-12-19');
    });

    it('should be idempotent - same payload returns existing event', async () => {
      const eventName = generateUniqueEventName();
      const eventData = {
        name: eventName,
        startDateISO: '2025-12-20',
        venue: 'Idempotent Test Venue',
        brandId: BRAND_ID,
      };

      // Create first event
      const { status: status1, body: body1 } = await createEvent(eventData);
      expect(status1).toBe(201);
      const firstId = body1.item.id;

      // Try to create same event again
      const { status: status2, body: body2 } = await createEvent(eventData);
      expect(status2).toBe(201);
      expect(body2.item.id).toBe(firstId);
      expect(body2.message).toContain('idempotent');
    });
  });

  describe('GET /api/events - Verify Event in List', () => {

    it('should show created event in events list', async () => {
      const eventName = generateUniqueEventName();

      // Create event
      const { status: createStatus, body: createBody } = await createEvent({
        name: eventName,
        startDateISO: '2025-12-21',
        venue: 'List Test Venue',
        brandId: BRAND_ID,
      });

      expect(createStatus).toBe(201);
      const createdId = createBody.item.id;

      // List events
      const { status: listStatus, body: listBody } = await listEvents(BRAND_ID);

      expect(listStatus).toBe(200);
      expect(listBody.ok).toBe(true);
      expect(Array.isArray(listBody.items)).toBe(true);

      // Find created event in list
      const foundEvent = listBody.items.find(e => e.id === createdId);
      expect(foundEvent).toBeDefined();
      expect(foundEvent.name).toBe(eventName);
    });
  });
});

// =============================================================================
// Integration Tests - Authentication
// =============================================================================

describe('Story 3.2 Integration: Authentication', () => {

  it('should return 401 without auth token', async () => {
    const response = await fetch(`${WORKER_URL}/api/admin/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Unauthorized Test',
        startDateISO: '2025-12-22',
        venue: 'Test Venue',
        brandId: BRAND_ID,
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBeDefined();
  });

  it('should return 401 with invalid auth token', async () => {
    const response = await fetch(`${WORKER_URL}/api/admin/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-token',
      },
      body: JSON.stringify({
        name: 'Invalid Token Test',
        startDateISO: '2025-12-23',
        venue: 'Test Venue',
        brandId: BRAND_ID,
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });
});

// =============================================================================
// Integration Tests - Validation Errors
// =============================================================================

describe('Story 3.2 Integration: Validation Errors', () => {

  it('should return 400 for missing name', async () => {
    const { status, body } = await createEvent({
      startDateISO: '2025-12-24',
      venue: 'Test Venue',
      brandId: BRAND_ID,
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('name');
  });

  it('should return 400 for missing startDateISO', async () => {
    const { status, body } = await createEvent({
      name: 'Missing Date Test',
      venue: 'Test Venue',
      brandId: BRAND_ID,
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('startDateISO');
  });

  it('should return 400 for missing venue', async () => {
    const { status, body } = await createEvent({
      name: 'Missing Venue Test',
      startDateISO: '2025-12-25',
      brandId: BRAND_ID,
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('venue');
  });

  it('should return 400 for invalid date format', async () => {
    const { status, body } = await createEvent({
      name: 'Invalid Date Test',
      startDateISO: 'not-a-date',
      venue: 'Test Venue',
      brandId: BRAND_ID,
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('YYYY-MM-DD');
  });

  it('should return 400 for invalid brand', async () => {
    const { status, body } = await createEvent({
      name: 'Invalid Brand Test',
      startDateISO: '2025-12-26',
      venue: 'Test Venue',
      brandId: 'invalid-brand',
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('Invalid brand');
  });

  it('should return 405 for non-POST method', async () => {
    const response = await fetch(`${WORKER_URL}/api/admin/events`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
      },
    });

    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('should return 400 for wrong Content-Type', async () => {
    const response = await fetch(`${WORKER_URL}/api/admin/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: 'not json',
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
  });
});

// =============================================================================
// Integration Tests - Response Shape
// =============================================================================

describe('Story 3.2 Integration: Response Shape', () => {

  it('should return complete event shape with all required fields', async () => {
    const eventName = generateUniqueEventName();
    const { status, body } = await createEvent({
      name: eventName,
      startDateISO: '2025-12-27',
      venue: 'Shape Test Venue',
      brandId: BRAND_ID,
      signupUrl: 'https://example.com/signup',
    });

    expect(status).toBe(201);

    const event = body.item;

    // Identity fields
    expect(event.id).toBeDefined();
    expect(event.slug).toBeDefined();
    expect(event.name).toBeDefined();
    expect(event.startDateISO).toBeDefined();
    expect(event.venue).toBeDefined();
    expect(event.brandId).toBeDefined();
    expect(event.eventTag).toBeDefined();

    // Links
    expect(event.links).toBeDefined();
    expect(event.links.publicUrl).toBeDefined();
    expect(event.links.displayUrl).toBeDefined();
    expect(event.links.posterUrl).toBeDefined();
    expect(event.links.signupUrl).toBe('https://example.com/signup');

    // QR codes (may be empty placeholders)
    expect(event.qr).toBeDefined();
    expect(event.qr).toHaveProperty('public');
    expect(event.qr).toHaveProperty('signup');

    // CTAs
    expect(event.ctas).toBeDefined();
    expect(event.ctas.primary).toBeDefined();
    expect(event.ctas.primary.label).toBeDefined();
    expect(event.ctas.primary.url).toBeDefined();

    // Settings
    expect(event.settings).toBeDefined();
    expect(typeof event.settings.showSchedule).toBe('boolean');
    expect(typeof event.settings.showStandings).toBe('boolean');
    expect(typeof event.settings.showBracket).toBe('boolean');
    expect(typeof event.settings.showSponsors).toBe('boolean');

    // Timestamps
    expect(event.createdAtISO).toBeDefined();
    expect(event.updatedAtISO).toBeDefined();
  });

  it('should default brandId to root when not provided', async () => {
    const { status, body } = await createEvent({
      name: generateUniqueEventName(),
      startDateISO: '2025-12-28',
      venue: 'Default Brand Test',
      // No brandId provided
    });

    expect(status).toBe(201);
    expect(body.item.brandId).toBe('root');
  });
});
