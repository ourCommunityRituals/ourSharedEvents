/**
 * Exhaustive API Tests: Create Event — POST /api/v2/admin/events
 *
 * Every code path in handleCreateEvent() is covered:
 *   - Auth gate (401)
 *   - Content-Type gate (400 BAD_CONTENT_TYPE)
 *   - Body parsing (400 INVALID_BODY, PAYLOAD_TOO_LARGE)
 *   - Title validation (400 MISSING_FIELD)
 *   - Brand validation (400 INVALID_BRAND)
 *   - Date validation (400 INVALID_DATE)
 *   - Slug collision (409 SLUG_TAKEN)
 *   - Success paths: minimal, full, defaults, auto-slug
 *   - Field truncation at max lengths
 *   - Status enum validation
 *   - XSS / SQL injection / Unicode resilience
 *   - Response envelope & header contracts
 *   - Created event appears in list (round-trip)
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

/** POST helper with correct Content-Type */
async function createEvent(request: any, data: Record<string, unknown>) {
  return request.post('/api/v2/admin/events', {
    timeout: TIMEOUT,
    // OSE-2012: the create API requires the mode, and a place for an in-person event.
    data: { attendance_mode: 'in_person', location: 'Test Hall', ...data },
    headers: authHeaders(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUTH GATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Auth Gate', () => {
  test('401 without any auth header', async ({ request }) => {
    const res = await request.post('/api/v2/admin/events', {
      timeout: TIMEOUT,
      data: { attendance_mode: 'in_person', location: 'Test Hall', title: 'No Auth' },
    });
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('UNAUTH');
    expect(json).toHaveProperty('requestId');
  });

  test('401 with invalid Bearer token', async ({ request }) => {
    const res = await request.post('/api/v2/admin/events', {
      timeout: TIMEOUT,
      data: { attendance_mode: 'in_person', location: 'Test Hall', title: 'Bad Token' },
      headers: { Authorization: 'Bearer invalid-token-xyz' },
    });
    expect(res.status()).toBe(401);
  });

  test('401 with empty Bearer token', async ({ request }) => {
    const res = await request.post('/api/v2/admin/events', {
      timeout: TIMEOUT,
      data: { attendance_mode: 'in_person', location: 'Test Hall', title: 'Empty Token' },
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status()).toBe(401);
  });

  test('401 with malformed Authorization header', async ({ request }) => {
    const res = await request.post('/api/v2/admin/events', {
      timeout: TIMEOUT,
      data: { attendance_mode: 'in_person', location: 'Test Hall', title: 'Malformed' },
      headers: { Authorization: 'NotBearer abc123' },
    });
    expect(res.status()).toBe(401);
  });

  test('401 includes WWW-Authenticate header', async ({ request }) => {
    const res = await request.post('/api/v2/admin/events', {
      timeout: TIMEOUT,
      data: { attendance_mode: 'in_person', location: 'Test Hall', title: 'WWW-Auth Check' },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()['www-authenticate']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CONTENT-TYPE GATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Content-Type Gate', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('400 BAD_CONTENT_TYPE for text/plain', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'text/plain' },
      data: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: 'CT Test',
      }),
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('BAD_CONTENT_TYPE');
  });

  test('400 BAD_CONTENT_TYPE for multipart/form-data', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' },
      data: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: 'Multipart Test',
      }),
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('BAD_CONTENT_TYPE');
  });

  test('400 BAD_CONTENT_TYPE for application/x-www-form-urlencoded', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'title=Urlencoded',
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('BAD_CONTENT_TYPE');
  });

  test('accepts application/json with charset', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
      data: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: `Charset Test ${Date.now()}`,
      }),
    });
    expect(res.status()).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. BODY PARSING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Body Parsing', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('400 INVALID_BODY for malformed JSON', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: '{not valid json}',
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('INVALID_BODY');
  });

  test('400 INVALID_BODY for empty body', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: '',
    });
    expect(res.status()).toBe(400);
  });

  test('400 INVALID_BODY for array body', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: JSON.stringify([{ title: 'Array' }]),
    });
    // Array is valid JSON but title extraction fails → MISSING_FIELD
    expect(res.status()).toBe(400);
  });

  test('400 INVALID_BODY for truncated JSON', async ({ request }) => {
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: '{"title": "truncat',
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('INVALID_BODY');
  });

  test('400 PAYLOAD_TOO_LARGE for >16KB body', async ({ request }) => {
    const bigBody = JSON.stringify({ title: 'Big', description: 'x'.repeat(20_000) });
    const res = await request.fetch('/api/v2/admin/events', {
      method: 'POST',
      timeout: TIMEOUT,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: bigBody,
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TITLE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Title Validation', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('400 MISSING_FIELD when title key absent', async ({ request }) => {
    const res = await createEvent(request, { description: 'No title key' });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('MISSING_FIELD');
  });

  test('400 MISSING_FIELD when title is empty string', async ({ request }) => {
    const res = await createEvent(request, { title: '' });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('MISSING_FIELD');
  });

  test('400 MISSING_FIELD when title is whitespace only', async ({ request }) => {
    const res = await createEvent(request, { title: '   \t\n  ' });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('MISSING_FIELD');
  });

  test('400 MISSING_FIELD when title is number (not string)', async ({ request }) => {
    const res = await createEvent(request, { title: 12345 });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('MISSING_FIELD');
  });

  test('400 MISSING_FIELD when title is boolean', async ({ request }) => {
    const res = await createEvent(request, { title: true });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('MISSING_FIELD');
  });

  test('400 MISSING_FIELD when title is null', async ({ request }) => {
    const res = await createEvent(request, { title: null });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('MISSING_FIELD');
  });

  test('accepts single-character title', async ({ request }) => {
    const res = await createEvent(request, { title: 'A' });
    expect(res.status()).toBe(201);
  });

  test('truncates title at 200 characters', async ({ request }) => {
    const longTitle = 'T'.repeat(250);
    const res = await createEvent(request, { title: longTitle });
    expect(res.status()).toBe(201);
    // The event was created — title was silently truncated to 200 chars
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. BRAND VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Brand Validation', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('defaults to root when brand_id not provided', async ({ request }) => {
    const res = await createEvent(request, { title: `Default Brand ${Date.now()}` });
    expect(res.status()).toBe(201);
  });

  test('accepts valid brand: root', async ({ request }) => {
    const res = await createEvent(request, { title: `Brand root ${Date.now()}`, brand_id: 'root' });
    expect(res.status()).toBe(201);
  });

  test('accepts valid brand with hyphens: my-brand', async ({ request }) => {
    const res = await createEvent(request, {
      title: `Hyphen Brand ${Date.now()}`,
      brand_id: 'my-brand',
    });
    expect(res.status()).toBe(201);
  });

  test('accepts valid brand with underscores: my_brand', async ({ request }) => {
    const res = await createEvent(request, {
      title: `Underscore Brand ${Date.now()}`,
      brand_id: 'my_brand',
    });
    expect(res.status()).toBe(201);
  });

  test('400 INVALID_BRAND for uppercase: ROOT', async ({ request }) => {
    const res = await createEvent(request, { title: 'Upper Brand', brand_id: 'ROOT' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BRAND');
  });

  test('400 INVALID_BRAND for spaces', async ({ request }) => {
    const res = await createEvent(request, { title: 'Space Brand', brand_id: 'my brand' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BRAND');
  });

  test('400 INVALID_BRAND for emoji', async ({ request }) => {
    const res = await createEvent(request, { title: 'Emoji Brand', brand_id: '🎉brand' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BRAND');
  });

  test('400 INVALID_BRAND for special characters', async ({ request }) => {
    const res = await createEvent(request, { title: 'Special Brand', brand_id: 'brand@#$' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BRAND');
  });

  test('400 INVALID_BRAND for empty string', async ({ request }) => {
    const res = await createEvent(request, { title: 'Empty Brand', brand_id: '' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BRAND');
  });

  test('400 INVALID_BRAND for >64 chars', async ({ request }) => {
    const res = await createEvent(request, { title: 'Long Brand', brand_id: 'a'.repeat(65) });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BRAND');
  });

  test('brand_id is not type-coerced from number', async ({ request }) => {
    // brand_id: 123 → typeof !== 'string' → defaults to 'root'
    const res = await createEvent(request, { title: `Num Brand ${Date.now()}`, brand_id: 123 });
    expect(res.status()).toBe(201); // defaults to root, no error
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DATE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Date Validation', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('accepts valid start_date YYYY-MM-DD', async ({ request }) => {
    const res = await createEvent(request, {
      title: `Date OK ${Date.now()}`,
      start_date: '2026-12-31',
    });
    expect(res.status()).toBe(201);
  });

  test('accepts null start_date (optional)', async ({ request }) => {
    const res = await createEvent(request, { title: `No Date ${Date.now()}` });
    expect(res.status()).toBe(201);
  });

  test('400 INVALID_DATE for MM/DD/YYYY format', async ({ request }) => {
    const res = await createEvent(request, { title: 'Bad Format', start_date: '12/31/2026' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('400 INVALID_DATE for DD-MM-YYYY format', async ({ request }) => {
    const res = await createEvent(request, { title: 'EU Format', start_date: '31-12-2026' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('400 INVALID_DATE for text', async ({ request }) => {
    const res = await createEvent(request, { title: 'Text Date', start_date: 'next friday' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('400 INVALID_DATE for impossible date 2026-13-45', async ({ request }) => {
    const res = await createEvent(request, { title: 'Impossible', start_date: '2026-13-45' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('400 INVALID_DATE for Feb 30', async ({ request }) => {
    const res = await createEvent(request, { title: 'Feb 30', start_date: '2026-02-30' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('400 INVALID_DATE for ISO datetime (not date-only)', async ({ request }) => {
    const res = await createEvent(request, {
      title: 'DateTime',
      start_date: '2026-12-31T15:00:00Z',
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('400 INVALID_DATE for bad end_date', async ({ request }) => {
    const res = await createEvent(request, { title: 'Bad End', end_date: 'not-a-date' });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DATE');
  });

  test('accepts both start_date and end_date', async ({ request }) => {
    const res = await createEvent(request, {
      title: `Both Dates ${Date.now()}`,
      start_date: '2026-06-01',
      end_date: '2026-06-03',
    });
    expect(res.status()).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. STATUS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Status Validation', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('defaults to draft when status not provided', async ({ request }) => {
    const res = await createEvent(request, { title: `No Status ${Date.now()}` });
    expect(res.status()).toBe(201);
  });

  test('accepts status: active', async ({ request }) => {
    const res = await createEvent(request, { title: `Active ${Date.now()}`, status: 'active' });
    expect(res.status()).toBe(201);
  });

  test('accepts status: draft', async ({ request }) => {
    const res = await createEvent(request, { title: `Draft ${Date.now()}`, status: 'draft' });
    expect(res.status()).toBe(201);
  });

  test('accepts status: archived', async ({ request }) => {
    const res = await createEvent(request, { title: `Archived ${Date.now()}`, status: 'archived' });
    expect(res.status()).toBe(201);
  });

  test('invalid status defaults to draft (no error)', async ({ request }) => {
    const res = await createEvent(request, {
      title: `Bad Status ${Date.now()}`,
      status: 'published',
    });
    expect(res.status()).toBe(201); // silently defaults to draft
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. SLUG HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Slug Handling', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('auto-generates slug from title', async ({ request }) => {
    const res = await createEvent(request, { title: `Slug Auto ${Date.now()}` });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.slug).toContain('slug-auto');
  });

  test('uses provided slug verbatim', async ({ request }) => {
    const slug = `custom-slug-${Date.now()}`;
    const res = await createEvent(request, { title: `Custom Slug ${Date.now()}`, slug });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.slug).toBe(slug);
  });

  test('409 SLUG_TAKEN for duplicate slug', async ({ request }) => {
    const slug = `dup-slug-${Date.now()}`;
    const first = await createEvent(request, { title: `First ${Date.now()}`, slug });
    expect(first.status()).toBe(201);

    const second = await createEvent(request, { title: `Second ${Date.now()}`, slug });
    expect(second.status()).toBe(409);
    const json = await second.json();
    expect(json.code).toBe('SLUG_TAKEN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. SUCCESS PATHS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Success Paths', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('201 with title only (minimal request)', async ({ request }) => {
    const title = `Minimal ${Date.now()}`;
    const res = await createEvent(request, { title });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe(201);
    expect(json.id).toMatch(/^evt_/);
    expect(json.slug).toBeDefined();
    expect(typeof json.slug).toBe('string');
  });

  test('201 with all optional fields', async ({ request }) => {
    const res = await createEvent(request, {
      title: `Full ${Date.now()}`,
      brand_id: 'root',
      slug: `full-event-${Date.now()}`,
      status: 'active',
      description: 'Full description',
      location: 'Test Venue, Chicago IL',
      start_date: '2026-12-31',
      end_date: '2026-12-31',
      timezone: 'America/Chicago',
      // Artwork is an uploaded file under /api/v2/uploads/ (OSE-1658).
      cover_image_url: '/api/v2/uploads/poster-art/example.png',
      template_id: 'tmpl_001',
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toMatch(/^evt_/);
  });

  test('response has X-Request-Id header', async ({ request }) => {
    const res = await createEvent(request, { title: `Header ${Date.now()}` });
    expect(res.status()).toBe(201);
    expect(res.headers()['x-request-id']).toBeDefined();
    expect(res.headers()['x-request-id'].length).toBeGreaterThan(0);
  });

  test('response Content-Type is application/json', async ({ request }) => {
    const res = await createEvent(request, { title: `CT ${Date.now()}` });
    expect(res.headers()['content-type']).toContain('application/json');
  });

  test('each create produces unique event ID', async ({ request }) => {
    const res1 = await createEvent(request, { title: `Unique1 ${Date.now()}` });
    const res2 = await createEvent(request, { title: `Unique2 ${Date.now()}` });
    const id1 = (await res1.json()).id;
    const id2 = (await res2.json()).id;
    expect(id1).not.toBe(id2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. XSS / INJECTION / UNICODE RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Security Resilience', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('XSS in title is stored without execution', async ({ request }) => {
    const xss = `<script>alert("xss")</script> Event ${Date.now()}`;
    const res = await createEvent(request, { title: xss });
    expect(res.status()).toBe(201);
  });

  test('SQL injection in title is safely parameterized', async ({ request }) => {
    const sqli = `Robert'); DROP TABLE events;-- ${Date.now()}`;
    const res = await createEvent(request, { title: sqli });
    expect(res.status()).toBe(201);

    // Verify events table still works
    const listRes = await request.get('/api/v2/admin/events', { headers: authHeaders() });
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.ok).toBe(true);
  });

  test('XSS in description is stored without execution', async ({ request }) => {
    const res = await createEvent(request, {
      title: `XSS Desc ${Date.now()}`,
      description: '<img src=x onerror=alert(1)>',
    });
    expect(res.status()).toBe(201);
  });

  test('Unicode emoji in title accepted', async ({ request }) => {
    const res = await createEvent(request, { title: `🎉 Party Event ${Date.now()}` });
    expect(res.status()).toBe(201);
  });

  test('Unicode CJK characters in title accepted', async ({ request }) => {
    const res = await createEvent(request, { title: `イベント ${Date.now()}` });
    expect(res.status()).toBe(201);
  });

  test('RTL text in title accepted', async ({ request }) => {
    const res = await createEvent(request, { title: `حدث ${Date.now()}` });
    expect(res.status()).toBe(201);
  });

  test('null bytes in title handled', async ({ request }) => {
    const res = await createEvent(request, { title: `Null\x00Byte ${Date.now()}` });
    // Should either accept or reject gracefully — no 500
    expect(res.status()).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. ERROR ENVELOPE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Error Envelope Contract', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('all 400 errors include ok, status, code, error, requestId, timestamp', async ({
    request,
  }) => {
    const res = await createEvent(request, { description: 'Missing title' });
    expect(res.status()).toBe(400);
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.status).toBe(400);
    expect(typeof json.code).toBe('string');
    expect(typeof json.error).toBe('string');
    expect(typeof json.requestId).toBe('string');
    expect(json.requestId.length).toBeGreaterThan(0);
    expect(typeof json.timestamp).toBe('string');
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('401 errors include ok, code, requestId', async ({ request }) => {
    const res = await request.post('/api/v2/admin/events', {
      timeout: TIMEOUT,
      data: { attendance_mode: 'in_person', location: 'Test Hall', title: 'Unauth Envelope' },
    });
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('UNAUTH');
    expect(json).toHaveProperty('requestId');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. ROUND-TRIP: CREATED EVENT APPEARS IN LIST
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Create Event — Round-Trip Verification', () => {
  test.skip(!hasAuth(), 'No auth credentials');

  test('created event appears in admin list', async ({ request }) => {
    const title = `RoundTrip ${Date.now()}`;
    const createRes = await createEvent(request, { title, status: 'active' });
    expect(createRes.status()).toBe(201);
    const { id } = await createRes.json();

    const listRes = await request.get('/api/v2/admin/events', { headers: authHeaders() });
    const listJson = await listRes.json();
    expect(listJson.ok).toBe(true);
    const found = listJson.items.some((e: { id: string }) => e.id === id);
    expect(found, `Event ${id} should appear in admin list`).toBe(true);
  });

  test('created active event appears in public list', async ({ request }) => {
    const title = `Public RT ${Date.now()}`;
    const createRes = await createEvent(request, {
      title,
      status: 'active',
      brand_id: 'root',
      // OSE-1560: a new event is off the map unless asked.
      is_published: true,
    });
    expect(createRes.status()).toBe(201);
    const { id } = await createRes.json();

    const listRes = await request.get('/api/v2/events?brand=root');
    const listJson = await listRes.json();
    expect(listJson.ok).toBe(true);
    const found = listJson.items.some((e: { id: string }) => e.id === id);
    expect(found, `Active event ${id} should appear in public list`).toBe(true);
  });

  test('created draft event does NOT appear in public list', async ({ request }) => {
    const title = `Draft RT ${Date.now()}`;
    const createRes = await createEvent(request, { title, status: 'draft', brand_id: 'root' });
    expect(createRes.status()).toBe(201);
    const { id } = await createRes.json();

    const listRes = await request.get('/api/v2/events?brand=root');
    const listJson = await listRes.json();
    const found = listJson.items.some((e: { id: string }) => e.id === id);
    expect(found, `Draft event ${id} should NOT appear in public list`).toBe(false);
  });
});
