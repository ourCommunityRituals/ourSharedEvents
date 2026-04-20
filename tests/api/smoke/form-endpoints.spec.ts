/**
 * API Smoke Test: Form Endpoints
 *
 * Validates the 4 form submission endpoints + admin read endpoints against staging.
 * Uses a test event ID — submissions are real but use clearly marked test data.
 *
 * Endpoints tested:
 *   POST /api/v2/events/:id/forms/register
 *   POST /api/v2/events/:id/forms/checkin
 *   POST /api/v2/events/:id/forms/survey
 *   POST /api/v2/events/:id/forms/email-signup
 *   GET  /api/v2/admin/events/:id/forms/registrations  (auth)
 *   GET  /api/v2/admin/events/:id/forms/checkin-count   (auth)
 *   GET  /api/v2/admin/events/:id/forms/surveys         (auth)
 *   GET  /api/v2/admin/events/:id/forms/email-signups   (auth)
 *
 * Contract (workers/oursharedevents/src/handlers/forms.ts):
 *   Success: { ok: true, ... }
 *   Error:   { ok: false, status, code, error, timestamp }
 */

import { test, expect } from '@playwright/test';

const TEST_EVENT_ID = 'ci-smoke-test-event';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const UNIQUE = Date.now().toString(36);

test.describe('Form Endpoints — Public Submissions', () => {
  test.describe.configure({ mode: 'serial' });

  test('POST /forms/register returns ok:true with valid data', async ({ request }) => {
    const response = await request.post(`/api/v2/events/${TEST_EVENT_ID}/forms/register`, {
      data: {
        name: `CI Smoke ${UNIQUE}`,
        email: `ci-smoke-${UNIQUE}@test.invalid`,
      },
    });

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('registrationBucket');
  });

  test('POST /forms/checkin returns ok:true with count', async ({ request }) => {
    const response = await request.post(`/api/v2/events/${TEST_EVENT_ID}/forms/checkin`, {
      data: {},
    });

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(typeof json.count).toBe('number');
    expect(json.count).toBeGreaterThan(0);
  });

  test('POST /forms/survey returns ok:true with id', async ({ request }) => {
    const response = await request.post(`/api/v2/events/${TEST_EVENT_ID}/forms/survey`, {
      data: {
        responses: { overall: 5, comments: `CI smoke test ${UNIQUE}` },
      },
    });

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json).toHaveProperty('id');
  });

  test('POST /forms/email-signup returns ok:true with id', async ({ request }) => {
    const response = await request.post(`/api/v2/events/${TEST_EVENT_ID}/forms/email-signup`, {
      data: { email: `ci-smoke-${UNIQUE}@test.invalid` },
    });

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json).toHaveProperty('id');
  });
});

test.describe('Form Endpoints — Input Validation', () => {
  test('register rejects invalid email', async ({ request }) => {
    const response = await request.post(`/api/v2/events/${TEST_EVENT_ID}/forms/register`, {
      data: { name: 'Test', email: 'not-an-email' },
    });

    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('INVALID_EMAIL');
  });

  test('email-signup rejects missing email', async ({ request }) => {
    const response = await request.post(`/api/v2/events/${TEST_EVENT_ID}/forms/email-signup`, {
      data: {},
    });

    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.ok).toBe(false);
  });

  test('invalid event ID returns 400', async ({ request }) => {
    const response = await request.post(`/api/v2/events/!!!invalid!!!/forms/register`, {
      data: { name: 'Test' },
    });

    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('INVALID_EVENT_ID');
  });
});

test.describe('Form Endpoints — Admin Read (auth required)', () => {
  test.skip(!ADMIN_KEY, 'ADMIN_KEY not set');

  const authHeaders = {
    Authorization: `Bearer ${ADMIN_KEY}`,
  };

  test('GET /forms/registrations returns items array', async ({ request }) => {
    const response = await request.get(
      `/api/v2/admin/events/${TEST_EVENT_ID}/forms/registrations`,
      { headers: authHeaders }
    );

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.items)).toBe(true);
    expect(json).toHaveProperty('count');
  });

  test('GET /forms/checkin-count returns count', async ({ request }) => {
    const response = await request.get(
      `/api/v2/admin/events/${TEST_EVENT_ID}/forms/checkin-count`,
      { headers: authHeaders }
    );

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(typeof json.count).toBe('number');
  });

  test('GET /forms/surveys returns items array', async ({ request }) => {
    const response = await request.get(`/api/v2/admin/events/${TEST_EVENT_ID}/forms/surveys`, {
      headers: authHeaders,
    });

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.items)).toBe(true);
  });

  test('GET /forms/email-signups returns count', async ({ request }) => {
    const response = await request.get(
      `/api/v2/admin/events/${TEST_EVENT_ID}/forms/email-signups`,
      { headers: authHeaders }
    );

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json).toHaveProperty('count');
  });
});

test.describe('Form Endpoints — Response Headers', () => {
  test('X-Request-Id header present on form responses', async ({ request }) => {
    const response = await request.post(`/api/v2/events/${TEST_EVENT_ID}/forms/checkin`, {
      data: {},
    });

    expect(response.headers()['x-request-id']).toBeTruthy();
  });
});
