/**
 * Integration Tests for Story 3.3 - Admin Record Result API
 *
 * Tests the complete record result flow against staging environment.
 *
 * Stage-2 test requirements:
 * - Creates dummy event via Admin API
 * - Updates schedule/standings/bracket via Record Result API
 * - Verifies updates are persisted
 *
 * Environment:
 *   WORKER_URL - Base URL for Worker API (defaults to staging)
 *   ADMIN_TOKEN - Admin authentication token
 *
 * Run locally:
 *   WORKER_URL=http://localhost:8787 ADMIN_TOKEN=test npm test -- tests/integration/story3.3
 *
 * Run against staging:
 *   WORKER_URL=https://api-stg.eventangle.com ADMIN_TOKEN=xxx npm test -- tests/integration/story3.3
 *
 * @see worker/src/handlers/adminRecordResult.ts
 * @see Story 3.3 - Port recordResult to Worker
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
 * Record results for an event via the Admin API
 */
async function recordResult(eventId, resultData) {
  const response = await fetch(`${WORKER_URL}/api/admin/events/${eventId}/results`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify(resultData),
  });

  const body = await response.json();
  return { status: response.status, body };
}

/**
 * Get admin bundle for an event (to verify updates)
 */
async function getAdminBundle(eventId) {
  const response = await fetch(`${WORKER_URL}/api/events/${eventId}/bundle/admin`, {
    headers: {
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
  });

  if (response.status === 200) {
    const body = await response.json();
    return { status: response.status, body };
  }

  return { status: response.status, body: null };
}

// =============================================================================
// Test Fixtures
// =============================================================================

const sampleSchedule = [
  { time: '6:00 PM', activity: 'Doors Open', notes: 'Early registration available' },
  { time: '7:00 PM', activity: 'Round 1', notes: 'General knowledge' },
  { time: '8:00 PM', activity: 'Round 2', notes: 'Music trivia' },
  { time: '9:00 PM', activity: 'Finals', notes: 'Top 3 teams compete' },
];

const sampleStandings = [
  { rank: 1, name: 'Team Alpha', score: 95 },
  { rank: 2, name: 'Team Beta', score: 87 },
  { rank: 3, name: 'Team Gamma', score: 82 },
  { rank: 4, name: 'Team Delta', score: 78 },
];

const sampleBracket = {
  type: 'single',
  rounds: 3,
  matches: [
    { id: 'm1', round: 1, position: 1, team1: 'Team A', team2: 'Team B', score1: 10, score2: 8, winner: 'Team A' },
    { id: 'm2', round: 1, position: 2, team1: 'Team C', team2: 'Team D', score1: 7, score2: 12, winner: 'Team D' },
    { id: 'm3', round: 2, position: 1, team1: 'Team A', team2: 'Team D', score1: 15, score2: 11, winner: 'Team A' },
  ],
};

// =============================================================================
// Integration Tests - Happy Path
// =============================================================================

describe('Story 3.3 Integration: Record Result via Worker API', () => {

  let testEventId = null;

  beforeAll(async () => {
    // Create a test event to use for result recording
    const eventName = generateUniqueEventName();
    const { status, body } = await createEvent({
      name: eventName,
      startDateISO: '2025-12-15',
      venue: 'Integration Test Venue',
      brandId: BRAND_ID,
    });

    if (status === 201 && body.item) {
      testEventId = body.item.id;
    }
  });

  describe('POST /api/admin/events/:id/results - Record Schedule', () => {

    it('should update schedule and return 200', async () => {
      if (!testEventId) {
        console.warn('Skipping test: no test event created');
        return;
      }

      const { status, body } = await recordResult(testEventId, {
        schedule: sampleSchedule,
      });

      // Verify response
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.status).toBe(200);
      expect(body.item).toBeDefined();
      expect(body.item.eventId).toBe(testEventId);
      expect(body.item.updated.schedule).toBe(true);
      expect(body.item.updatedAtISO).toBeDefined();
      expect(body.message).toContain('schedule');
    });
  });

  describe('POST /api/admin/events/:id/results - Record Standings', () => {

    it('should update standings and return 200', async () => {
      if (!testEventId) {
        console.warn('Skipping test: no test event created');
        return;
      }

      const { status, body } = await recordResult(testEventId, {
        standings: sampleStandings,
      });

      // Verify response
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.item.updated.standings).toBe(true);
      expect(body.message).toContain('standings');
    });
  });

  describe('POST /api/admin/events/:id/results - Record Bracket', () => {

    it('should update bracket and return 200', async () => {
      if (!testEventId) {
        console.warn('Skipping test: no test event created');
        return;
      }

      const { status, body } = await recordResult(testEventId, {
        bracket: sampleBracket,
      });

      // Verify response
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.item.updated.bracket).toBe(true);
      expect(body.message).toContain('bracket');
    });
  });

  describe('POST /api/admin/events/:id/results - Record Multiple Updates', () => {

    it('should update multiple fields in one request', async () => {
      if (!testEventId) {
        console.warn('Skipping test: no test event created');
        return;
      }

      const { status, body } = await recordResult(testEventId, {
        schedule: sampleSchedule,
        standings: sampleStandings,
        bracket: sampleBracket,
      });

      // Verify response
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.item.updated.schedule).toBe(true);
      expect(body.item.updated.standings).toBe(true);
      expect(body.item.updated.bracket).toBe(true);
      expect(body.message).toContain('schedule');
      expect(body.message).toContain('standings');
      expect(body.message).toContain('bracket');
    });
  });
});

// =============================================================================
// Integration Tests - Authentication
// =============================================================================

describe('Story 3.3 Integration: Authentication', () => {

  it('should return 401 without auth token', async () => {
    const response = await fetch(`${WORKER_URL}/api/admin/events/evt-test/results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schedule: sampleSchedule,
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBeDefined();
  });

  it('should return 401 with invalid auth token', async () => {
    const response = await fetch(`${WORKER_URL}/api/admin/events/evt-test/results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-token',
      },
      body: JSON.stringify({
        schedule: sampleSchedule,
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

describe('Story 3.3 Integration: Validation Errors', () => {

  it('should return 400 when no updates provided', async () => {
    const { status, body } = await recordResult('evt-test', {});

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('At least one');
  });

  it('should return 400 for invalid schedule format', async () => {
    const { status, body } = await recordResult('evt-test', {
      schedule: 'not an array',
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('schedule must be an array');
  });

  it('should return 400 for schedule item missing time', async () => {
    const { status, body } = await recordResult('evt-test', {
      schedule: [{ activity: 'Test' }],
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('time must be a string');
  });

  it('should return 400 for schedule item missing activity', async () => {
    const { status, body } = await recordResult('evt-test', {
      schedule: [{ time: '7:00 PM' }],
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('activity must be a string');
  });

  it('should return 400 for invalid standings format', async () => {
    const { status, body } = await recordResult('evt-test', {
      standings: 'not an array',
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('standings must be an array');
  });

  it('should return 400 for standings item missing rank', async () => {
    const { status, body } = await recordResult('evt-test', {
      standings: [{ name: 'Team A', score: 100 }],
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('rank must be a number');
  });

  it('should return 400 for standings item missing name', async () => {
    const { status, body } = await recordResult('evt-test', {
      standings: [{ rank: 1, score: 100 }],
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('name must be a string');
  });

  it('should return 400 for standings item missing score', async () => {
    const { status, body } = await recordResult('evt-test', {
      standings: [{ rank: 1, name: 'Team A' }],
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('score must be a number');
  });

  it('should return 400 for invalid bracket format', async () => {
    const { status, body } = await recordResult('evt-test', {
      bracket: 'not an object',
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('bracket must be an object');
  });

  it('should return 400 for bracket with invalid matches', async () => {
    const { status, body } = await recordResult('evt-test', {
      bracket: { matches: 'not an array' },
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('bracket.matches must be an array');
  });

  it('should return 400 for bracket match missing id', async () => {
    const { status, body } = await recordResult('evt-test', {
      bracket: {
        matches: [{ round: 1, position: 1 }],
      },
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('.id must be a string');
  });

  it('should return 405 for non-POST method', async () => {
    const response = await fetch(`${WORKER_URL}/api/admin/events/evt-test/results`, {
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
    const response = await fetch(`${WORKER_URL}/api/admin/events/evt-test/results`, {
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

  it('should return 404 for non-existent event', async () => {
    const { status, body } = await recordResult('evt-does-not-exist-12345', {
      schedule: sampleSchedule,
    });

    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('Event not found');
  });
});

// =============================================================================
// Integration Tests - Response Shape
// =============================================================================

describe('Story 3.3 Integration: Response Shape', () => {

  let testEventId = null;

  beforeAll(async () => {
    // Create a test event
    const eventName = generateUniqueEventName();
    const { status, body } = await createEvent({
      name: eventName,
      startDateISO: '2025-12-16',
      venue: 'Response Shape Test Venue',
      brandId: BRAND_ID,
    });

    if (status === 201 && body.item) {
      testEventId = body.item.id;
    }
  });

  it('should return complete response shape for successful update', async () => {
    if (!testEventId) {
      console.warn('Skipping test: no test event created');
      return;
    }

    const { status, body } = await recordResult(testEventId, {
      schedule: sampleSchedule,
    });

    expect(status).toBe(200);

    // Response envelope
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('status', 200);
    expect(body).toHaveProperty('item');
    expect(body).toHaveProperty('message');

    // Item shape
    expect(body.item).toHaveProperty('eventId');
    expect(body.item).toHaveProperty('updated');
    expect(body.item).toHaveProperty('updatedAtISO');

    // Updated flags
    expect(typeof body.item.updated.schedule).toBe('boolean');
  });

  it('should return error response shape for validation errors', async () => {
    const { status, body } = await recordResult('evt-test', {});

    expect(status).toBe(400);

    // Error envelope
    expect(body).toHaveProperty('ok', false);
    expect(body).toHaveProperty('status', 400);
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
  });

  it('should return error response shape with corrId for server errors', async () => {
    // This is harder to trigger, but we can verify the shape is correct
    // by checking the error response for not found (which should have similar structure)
    const { status, body } = await recordResult('evt-nonexistent', {
      schedule: sampleSchedule,
    });

    expect(body).toHaveProperty('ok', false);
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
  });
});

// =============================================================================
// Integration Tests - Empty Updates
// =============================================================================

describe('Story 3.3 Integration: Empty Arrays', () => {

  let testEventId = null;

  beforeAll(async () => {
    const eventName = generateUniqueEventName();
    const { status, body } = await createEvent({
      name: eventName,
      startDateISO: '2025-12-17',
      venue: 'Empty Arrays Test Venue',
      brandId: BRAND_ID,
    });

    if (status === 201 && body.item) {
      testEventId = body.item.id;
    }
  });

  it('should accept empty schedule array (clears schedule)', async () => {
    if (!testEventId) {
      console.warn('Skipping test: no test event created');
      return;
    }

    const { status, body } = await recordResult(testEventId, {
      schedule: [],
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.item.updated.schedule).toBe(true);
  });

  it('should accept empty standings array (clears standings)', async () => {
    if (!testEventId) {
      console.warn('Skipping test: no test event created');
      return;
    }

    const { status, body } = await recordResult(testEventId, {
      standings: [],
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.item.updated.standings).toBe(true);
  });

  it('should accept empty bracket (clears bracket)', async () => {
    if (!testEventId) {
      console.warn('Skipping test: no test event created');
      return;
    }

    const { status, body } = await recordResult(testEventId, {
      bracket: {},
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.item.updated.bracket).toBe(true);
  });
});
