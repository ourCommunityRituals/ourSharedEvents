/**
 * T4 CROSS-BRAND ISOLATION — Invariant 9 Runtime Complement
 *
 * Brain Invariant #9 (tenant_isolation):
 *   - group: security_isolation
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * This is the T4 staging runtime test for Invariant #9. The L0 structural
 * spec (tenant-isolation.invariant.spec.ts) asserts that brand_id is on
 * every multi-tenant schema and that queries scope by WHERE brand_id = ?. This
 * spec asserts the runtime contract: brand A's events are invisible to brand B
 * consumers at the actual deployed staging worker — the database query scoping
 * that the structural spec locked in code is actually doing what it claims.
 *
 * Isolation model under test:
 *   GET /api/v2/events?brand=<slug> → returns only events WHERE brand_id = slug
 *   An event seeded under brand "isoltest-a" must NOT appear in the response
 *   for brand "isoltest-b", and vice versa.
 *
 * Why this matters:
 *   OSE runs multiple brands (root, plus partner/franchise brands). Without
 *   database-level brand isolation, a consumer of brand B would see brand A's
 *   events — leaking event metadata, schedules, and location data across tenants.
 *   This is a data-confidentiality issue for partners who deploy OSE under
 *   their own brand slug and expect a single-brand view.
 *
 * What this spec does:
 *   1. Seed one event under brand "isoltest-a" via admin API
 *   2. Seed one event under brand "isoltest-b" via admin API
 *   3. GET /api/v2/events?brand=isoltest-a — assert isoltest-b event absent
 *   4. GET /api/v2/events?brand=isoltest-b — assert isoltest-a event absent
 *   5. Assert each brand's own event IS present in its own brand's list
 *   6. Clean up both events (DELETE via admin API)
 *
 * Prerequisites:
 *   BASE_URL              — staging worker URL (e.g., https://stg.oursharedevents.com)
 *   ADMIN_KEY             — Bearer token for /api/v2/admin/* routes
 *   X_OCR_INTERNAL        — X-OCR-Internal header secret (CI/CD auth)
 *   CF_ACCESS_CLIENT_ID   — Cloudflare Access service token client ID
 *   CF_ACCESS_CLIENT_SECRET — Cloudflare Access service token client secret
 *
 * Run locally (once CF Access token is rotated):
 *   BASE_URL=https://stg.oursharedevents.com \
 *   ADMIN_KEY=<key> \
 *   X_OCR_INTERNAL=<secret> \
 *   CF_ACCESS_CLIENT_ID=<id> \
 *   CF_ACCESS_CLIENT_SECRET=<secret> \
 *   npx playwright test --config=playwright.e2e-smoke.config.ts \
 *     tests/e2e/3-flows/cross-brand-isolation.spec.ts
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';
const TIMEOUT = 30_000;

// Two brand slugs that will never exist in real data — use a prefix that is
// clearly synthetic so cleanup is safe even if a test crashes mid-run.
const BRAND_A = 'isoltest-a';
const BRAND_B = 'isoltest-b';

function adminHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ADMIN_KEY}`,
  };
  if (X_OCR_INTERNAL) h['X-OCR-Internal'] = X_OCR_INTERNAL;
  if (CF_ACCESS_CLIENT_ID) h['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID;
  if (CF_ACCESS_CLIENT_SECRET) h['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET;
  return h;
}

async function adminFetch(
  request: any,
  method: string,
  path: string,
  body?: Record<string, unknown>
) {
  const resp = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: adminHeaders(),
    data: body,
    timeout: TIMEOUT,
  });
  const status = resp.status();
  const ct = resp.headers()['content-type'] || '';
  if (ct.includes('text/html')) {
    throw new Error(
      `CF Access service token rejected (HTML response, HTTP ${status}). ` +
        'The CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET secrets are stale. ' +
        'Rotate the service token in the Cloudflare Access dashboard and update the GitHub secrets. ' +
        'See OSE-349.'
    );
  }
  return resp;
}

/** Seed a minimal test event under a given brand. Returns the event ID. */
async function seedEvent(request: any, brand: string, suffix: string): Promise<string> {
  const body = {
    id: `cross-brand-isolation-${suffix}`,
    brand_id: brand,
    title: `Cross-Brand Isolation Test (${suffix})`,
    slug: `isolation-test-${suffix}`,
    status: 'active',
    description: 'Temporary test event — cross-brand-isolation.spec.ts. Auto-deleted.',
    location: 'Test Location',
    // POST /api/v2/admin/events validates dates as YYYY-MM-DD (isValidIsoDate,
    // events.ts) — it appends 'T00:00:00Z' itself. A full ISO datetime here is
    // rejected 400 INVALID_DATE (OSE-554: this E2E never hit the live endpoint).
    start_date: '2099-01-01',
    end_date: '2099-01-02',
    timezone: 'America/New_York',
  };
  const resp = await adminFetch(request, 'POST', '/api/v2/admin/events', body);
  expect(
    resp.status(),
    `Failed to seed test event for brand '${brand}' (HTTP ${resp.status()}). ` +
      'Check ADMIN_KEY and X_OCR_INTERNAL — admin seeding is a prerequisite for this test.'
  ).toBe(201);
  const json = await resp.json();
  return json.item?.id ?? body.id;
}

/** Delete a test event by ID. Non-fatal if already absent (idempotent cleanup). */
async function deleteEvent(request: any, id: string): Promise<void> {
  try {
    await adminFetch(request, 'DELETE', `/api/v2/admin/events/${id}`);
  } catch {
    // Ignore — cleanup is best-effort; the event has a start_date of 2099
    // so it will never appear in real usage even if cleanup fails.
  }
}

test.describe('Invariant 9: Tenant Isolation — T4 cross-brand runtime isolation (staging)', () => {
  test.setTimeout(TIMEOUT * 3);

  // Event IDs seeded in this run — used by afterEach cleanup.
  let eventIdA: string | null = null;
  let eventIdB: string | null = null;

  test.afterEach(async ({ request }) => {
    if (eventIdA) await deleteEvent(request, eventIdA);
    if (eventIdB) await deleteEvent(request, eventIdB);
    eventIdA = null;
    eventIdB = null;
  });

  test('OSE-INV9 | T4 | brand isolation | brand A events are invisible to brand B list query', async ({
    request,
  }) => {
    // ── Seed ──────────────────────────────────────────────────────────────────
    eventIdA = await seedEvent(request, BRAND_A, 'brand-a');
    eventIdB = await seedEvent(request, BRAND_B, 'brand-b');

    // ── Verify brand A list excludes brand B event ─────────────────────────
    const respA = await request.get(`${BASE_URL}/api/v2/events?brand=${BRAND_A}`, {
      timeout: TIMEOUT,
    });
    expect(respA.status(), 'GET /api/v2/events?brand=isoltest-a must return 200').toBe(200);
    const payloadA = await respA.json();

    const itemsA: Array<{ id: string; brand_id: string }> = payloadA.items ?? payloadA.data ?? [];

    // Brand A's own event must appear
    const ownEventInA = itemsA.some((e) => e.id === eventIdA);
    expect(
      ownEventInA,
      `brand A's own event (id=${eventIdA}) must appear in the brand=isoltest-a list — ` +
        'if this fails, the event was not seeded or the WHERE brand_id filter is broken'
    ).toBe(true);

    // Brand B's event must NOT appear
    const crossLeakInA = itemsA.some((e) => e.id === eventIdB);
    expect(
      crossLeakInA,
      `brand B's event (id=${eventIdB}) appeared in the brand=isoltest-a list — ` +
        "this is a tenant isolation failure: brand A's consumer can see brand B's events. " +
        'Check the WHERE brand_id = ? clause in handleListEvents.'
    ).toBe(false);

    // All returned events must carry brand_id = BRAND_A
    for (const event of itemsA) {
      expect(
        event.brand_id,
        `event ${event.id} in brand=isoltest-a list has brand_id='${event.brand_id}' instead of '${BRAND_A}' — ` +
          'the list endpoint is returning cross-brand rows'
      ).toBe(BRAND_A);
    }
  });

  test('OSE-INV9 | T4 | brand isolation | brand B events are invisible to brand A list query', async ({
    request,
  }) => {
    // ── Seed ──────────────────────────────────────────────────────────────────
    eventIdA = await seedEvent(request, BRAND_A, 'brand-a-inv');
    eventIdB = await seedEvent(request, BRAND_B, 'brand-b-inv');

    // ── Verify brand B list excludes brand A event ─────────────────────────
    const respB = await request.get(`${BASE_URL}/api/v2/events?brand=${BRAND_B}`, {
      timeout: TIMEOUT,
    });
    expect(respB.status(), 'GET /api/v2/events?brand=isoltest-b must return 200').toBe(200);
    const payloadB = await respB.json();

    const itemsB: Array<{ id: string; brand_id: string }> = payloadB.items ?? payloadB.data ?? [];

    // Brand B's own event must appear
    const ownEventInB = itemsB.some((e) => e.id === eventIdB);
    expect(
      ownEventInB,
      `brand B's own event (id=${eventIdB}) must appear in the brand=isoltest-b list`
    ).toBe(true);

    // Brand A's event must NOT appear
    const crossLeakInB = itemsB.some((e) => e.id === eventIdA);
    expect(
      crossLeakInB,
      `brand A's event (id=${eventIdA}) appeared in the brand=isoltest-b list — ` +
        'tenant isolation failure: cross-brand row returned'
    ).toBe(false);

    // All returned events must carry brand_id = BRAND_B
    for (const event of itemsB) {
      expect(
        event.brand_id,
        `event ${event.id} in brand=isoltest-b list has brand_id='${event.brand_id}' instead of '${BRAND_B}'`
      ).toBe(BRAND_B);
    }
  });

  test('OSE-INV9 | T4 | brand isolation | empty brand returns empty list (not a cross-brand leak)', async ({
    request,
  }) => {
    const slug = 'isoltest-nonexistent-brand-xz9q';
    const resp = await request.get(`${BASE_URL}/api/v2/events?brand=${slug}`, {
      timeout: TIMEOUT,
    });
    expect(resp.status(), 'GET /api/v2/events with unknown brand must return 200').toBe(200);
    const payload = await resp.json();
    const items: unknown[] = payload.items ?? payload.data ?? [];
    expect(
      items.length,
      `brand=${slug} should return 0 events — if any events appear, the WHERE brand_id = ? filter is broken`
    ).toBe(0);
  });
});
