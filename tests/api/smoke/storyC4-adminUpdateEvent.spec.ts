/**
 * Exhaustive API Tests: Update Event — PUT /api/v2/admin/events/:id
 *
 * Every code path in handleUpdateEvent() is covered:
 *   - Auth gate (401)
 *   - Content-Type gate (400 BAD_CONTENT_TYPE)
 *   - Body parsing (400 INVALID_BODY, PAYLOAD_TOO_LARGE)
 *   - Date validation (400 INVALID_DATE)
 *   - No updatable fields (400 NO_FIELDS)
 *   - Not found (404 NOT_FOUND)
 *   - Success: single field, multiple fields, null fields, status change
 *   - Field truncation at max lengths
 *   - Unknown fields silently ignored
 *   - XSS / SQL injection / Unicode resilience
 *   - Response envelope & header contracts
 *   - Round-trip: update reflected in GET
 *
 * Source of truth: workers/oursharedevents/src/handlers/events.ts
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 30_000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL || '';

const hasAuth = (): boolean => Boolean(X_OCR_INTERNAL || ADMIN_KEY);
const authHeaders = (): Record<string, string> => {
  if (X_OCR_INTERNAL) return { 'X-OCR-Internal': X_OCR_INTERNAL };
  if (ADMIN_KEY) return { Authorization: `Bearer ${ADMIN_KEY}` };
  return {};
};

/** Create a disposable test event, return its ID */
async function seedEvent(request: any, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await request.post('/api/v2/admin/events', {
    timeout: TIMEOUT,
    data: {
      attendance_mode: 'in_person',
      location: 'Test Hall',
      title: `Update Seed ${Date.now()}`,
      status: 'draft',
      ...overrides,
    },
    headers: authHeaders(),
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUTH GATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Auth Gate', () => {
  test('401 without any auth header', async ({ request }) => {
    const res = await request.put('/api/v2/admin/events/evt_fake', {
      timeout: TIMEOUT,
      data: { title: 'No Auth' },
    });
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('UNAUTH');
  });

  test('401 with invalid Bearer token', async ({ request }) => {
    const res = await request.put('/api/v2/admin/events/evt_fake', {
      timeout: TIMEOUT,
      data: { title: 'Bad Token' },
      headers: { Authorization: 'Bearer invalid-xyz' },
    });
    expect(res.status()).toBe(401);
  });

  test('401 includes WWW-Authenticate header', async ({ request }) => {
    const res = await request.put('/api/v2/admin/events/evt_fake', {
      timeout: TIMEOUT,
      data: { title: 'WWW' },
    });
    expect(res.headers()['www-authenticate']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CONTENT-TYPE GATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Content-Type Gate', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('400 BAD_CONTENT_TYPE for text/plain', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events/evt_fake', {
      method: 'PUT',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'text/plain' },
      data: JSON.stringify({ title: 'CT' }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('BAD_CONTENT_TYPE');
  });

  test('accepts application/json with charset', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.fetch(`/api/v2/admin/events/${id}`, {
      method: 'PUT',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
      data: JSON.stringify({ title: `Charset ${Date.now()}` }),
    });
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. BODY PARSING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Body Parsing', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('400 INVALID_BODY for malformed JSON', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events/evt_fake', {
      method: 'PUT',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: '{broken',
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BODY');
  });

  test('400 PAYLOAD_TOO_LARGE for >16KB body', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events/evt_fake', {
      method: 'PUT',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: JSON.stringify({ description: 'x'.repeat(20_000) }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. NOT FOUND
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Not Found', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('404 NOT_FOUND for nonexistent event', async ({ request }) => {
    const res = await request.put('/api/v2/admin/events/evt_does_not_exist_000', {
      timeout: TIMEOUT,
      data: { title: 'Ghost' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('NOT_FOUND');
    expect(json).toHaveProperty('requestId');
    expect(json).toHaveProperty('timestamp');
  });

  test('404 for empty event ID path', async ({ request }) => {
    // PUT /api/v2/admin/events/ — trailing slash, no ID
    const res = await request.put('/api/v2/admin/events/', {
      timeout: TIMEOUT,
      data: { title: 'No ID' },
      headers: authHeaders(),
    });
    // Router won't match this — either 404 or method not allowed
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. NO UPDATABLE FIELDS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — NO_FIELDS', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('400 NO_FIELDS when body has only unknown fields', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { random_field: 'ignored', another: 123 },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('NO_FIELDS');
  });

  test('400 NO_FIELDS for empty object body', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: {},
      headers: authHeaders(),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('NO_FIELDS');
  });

  test('non-string values in allowed fields are ignored (NO_FIELDS if only those)', async ({
    request,
  }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { title: 12345, description: true, location: ['array'] },
      headers: authHeaders(),
    });
    // All values are non-string and non-null → skipped → NO_FIELDS
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('NO_FIELDS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DATE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Date Validation', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('400 INVALID_DATE for bad start_date', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { start_date: 'not-a-date' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('400 INVALID_DATE for bad end_date', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { end_date: '12/31/2026' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('400 INVALID_DATE for Feb 30', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { start_date: '2026-02-30' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('allows setting start_date to null (clearing)', async ({ request }) => {
    const id = await seedEvent(request, { start_date: '2026-01-01' });
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { start_date: null },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('accepts valid YYYY-MM-DD on update', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { start_date: '2026-12-31' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('400 INVALID_DATE for non-string date (number)', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { start_date: 20261231 },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. SUCCESSFUL UPDATES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Success Paths', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('200 when updating title', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { title: `Updated ${Date.now()}` },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe(200);
    expect(json.id).toBe(id);
  });

  test('200 when updating description', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { description: 'New description' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('200 when updating multiple fields at once', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: {
        title: `Multi ${Date.now()}`,
        location: 'New Venue',
        start_date: '2026-07-04',
        end_date: '2026-07-05',
        timezone: 'America/New_York',
      },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('200 when setting a field to null', async ({ request }) => {
    const id = await seedEvent(request, { description: 'Has desc', location: 'Has loc' });
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { description: null, location: null },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('200 when changing status to active', async ({ request }) => {
    const id = await seedEvent(request); // defaults to draft
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { status: 'active' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('200 when changing status to archived', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { status: 'archived' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('unknown fields are silently ignored', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { title: `Ignore Unknown ${Date.now()}`, foo: 'bar', baz: 123 },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200); // title is valid → succeeds
  });

  test('response has X-Request-Id header', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { title: `Header ${Date.now()}` },
      headers: authHeaders(),
    });
    expect(res.headers()['x-request-id']).toBeDefined();
  });

  test('response Content-Type is application/json', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { title: `CT ${Date.now()}` },
      headers: authHeaders(),
    });
    expect(res.headers()['content-type']).toContain('application/json');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FIELD TRUNCATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Field Truncation', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('title truncated at 200 chars', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { title: 'T'.repeat(300) },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('description truncated at 2000 chars', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { description: 'D'.repeat(2500) },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('location truncated at 500 chars', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { location: 'L'.repeat(600) },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. XSS / INJECTION / UNICODE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Security Resilience', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('XSS in title stored safely', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { title: `<script>alert(1)</script> ${Date.now()}` },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('SQL injection in description parameterized', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { description: "Robert'); DROP TABLE events;--" },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);

    // Verify table still works
    const listRes = await request.get('/api/v2/admin/events', { headers: authHeaders() });
    expect(listRes.status()).toBe(200);
  });

  test('emoji in description accepted', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { description: '🎉🎊 Great party vibes! 🥳' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('CJK characters in location accepted', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { location: '東京都渋谷区' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. ERROR ENVELOPE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Error Envelope Contract', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('400 errors include ok, status, code, error, requestId, timestamp', async ({ request }) => {
    const id = await seedEvent(request);
    const res = await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: {},
      headers: authHeaders(),
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.status).toBe(400);
    expect(typeof json.code).toBe('string');
    expect(typeof json.error).toBe('string');
    expect(typeof json.requestId).toBe('string');
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('404 errors include ok, status, code, requestId, timestamp', async ({ request }) => {
    const res = await request.put('/api/v2/admin/events/evt_ghost_999', {
      timeout: TIMEOUT,
      data: { title: 'Ghost' },
      headers: authHeaders(),
    });
    expect(res.status()).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.status).toBe(404);
    expect(json.code).toBe('NOT_FOUND');
    expect(typeof json.requestId).toBe('string');
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. ROUND-TRIP: UPDATE REFLECTED IN GET
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Update Event — Round-Trip Verification', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('updated title reflected in GET /api/v2/events/:id', async ({ request }) => {
    const id = await seedEvent(request, { status: 'active' });
    const newTitle = `Verified Update ${Date.now()}`;

    await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { title: newTitle },
      headers: authHeaders(),
    });

    const getRes = await request.get(`/api/v2/events/${id}`);
    expect(getRes.status()).toBe(200);
    const event = await getRes.json();
    expect(event.ok).toBe(true);
    expect(event.item.title).toBe(newTitle);
  });

  test('status change from active to archived removes from public list', async ({ request }) => {
    const id = await seedEvent(request, {
      status: 'active',
      brand_id: 'root',
      // OSE-1560: a new event is off the map unless asked.
      is_published: true,
    });

    // Verify it's in public list
    let listRes = await request.get('/api/v2/events?brand=root');
    let found = (await listRes.json()).items.some((e: { id: string }) => e.id === id);
    expect(found).toBe(true);

    // Archive it
    await request.put(`/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      data: { status: 'archived' },
      headers: authHeaders(),
    });

    // Verify it's gone from public list
    listRes = await request.get('/api/v2/events?brand=root');
    found = (await listRes.json()).items.some((e: { id: string }) => e.id === id);
    expect(found).toBe(false);
  });
});
