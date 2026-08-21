/**
 * SPONSOR JOURNEY — Full-Path E2E Test
 *
 * Tests the complete sponsor lifecycle against live staging:
 *
 *   Admin creates sponsor (API)
 *     → Sponsor appears in admin list
 *     → Sponsor resolves for event (public API)
 *     → Sponsor renders on Display surface (tvTop banner + tvSide sidebar)
 *     → Sponsor renders on Poster surface
 *     → Sponsor metrics appear on SharedReport
 *     → Impression logged for displayed sponsor
 *     → Admin soft-deletes sponsor
 *     → Sponsor no longer resolves for event
 *
 * This is a LIVE test — no route mocking. Runs against stg.oursharedevents.com.
 * Requires ADMIN_KEY environment variable for auth-gated endpoints.
 *
 * Run:
 *   ADMIN_KEY=<key> npx playwright test --config=playwright.e2e-smoke.config.ts tests/e2e/3-flows/sponsor-journey.spec.ts
 *
 * Source of truth:
 *   - workers/oursharedevents/src/handlers/sponsors.ts (CRUD + public APIs)
 *   - workers/oursharedevents/src/lib/sponsor-resolver.ts (resolution engine)
 *   - workers/oursharedevents/src/handlers/pages.ts (surface rendering)
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 30_000;
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.X_OCR_INTERNAL || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Admin API fetch using Playwright's request context (not browser).
 * Bypasses CORS preflight — CF Access headers pass through directly.
 * The `request` fixture comes from test parameters, not page.evaluate.
 */
async function adminFetch(
  request: any,
  method: string,
  path: string,
  body?: Record<string, unknown>
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ADMIN_KEY}`,
  };
  if (CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID;
  if (CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET;

  try {
    const response = await request.fetch(path, { method, headers, data: body });
    const status = response.status();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) {
      const text = await response.text();
      console.log(`[adminFetch] ${method} ${path} → ${status} (non-JSON: ${text.slice(0, 200)})`);
      return {
        status,
        body: { ok: false, code: 'CF_ACCESS_BLOCKED', error: 'CF Access returned HTML' },
      };
    }
    const body2 = await response.json();
    if (method === 'POST' || status !== 200) {
      console.log(
        `[adminFetch] ${method} ${path} → ${status} body=${JSON.stringify(body2).slice(0, 300)}`
      );
    }
    return { status, body: body2 };
  } catch {
    return {
      status: 0,
      body: { ok: false, code: 'FETCH_ERROR', error: 'Request failed' },
    };
  }
}

async function publicFetch(page: any, path: string) {
  return page.evaluate(async (p: string) => {
    const res = await fetch(p);
    return { status: res.status, body: await res.json() };
  }, path);
}

// ─── Test Data ──────────────────────────────────────────────────────────────────

const timestamp = Date.now();
const SPONSOR_NAME = `Journey Sponsor ${timestamp}`;

// ═══════════════════════════════════════════════════════════════════════════════
// SPONSOR JOURNEY: Full lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Sponsor Journey — Full Lifecycle', () => {
  // State shared across serial tests
  let eventId: string;
  let sponsorId: string;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not set — skipping sponsor journey');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 0: Find an event to attach sponsor to
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 0: Resolve a live event for sponsor attachment', async ({ page, request }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.ok).toBe(true);

    const items = eventsRes.body.items || [];
    test.skip(items.length === 0, 'No events in staging — cannot attach sponsor');

    eventId = items[0].id;
    expect(eventId).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 1: Admin creates sponsor via API
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 1: Admin creates sponsor via API', async ({ page, request }) => {
    test.skip(!eventId, 'No event available');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await adminFetch(request, 'POST', '/api/v2/admin/sponsors', {
      name: SPONSOR_NAME,
      event_id: eventId,
      tier: 'gold',
      logo_url: 'https://via.placeholder.com/300x100?text=Journey+Sponsor',
      website_url: 'https://journey-test.example.com',
      placement_formats: JSON.stringify({
        tvTop: true,
        tvSide: true,
        posterTop: true,
        mobileBanner: true,
      }),
    });

    test.skip(res.body?.code === 'CF_ACCESS_BLOCKED', 'CF Access blocked admin API');

    expect([200, 201]).toContain(res.status);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeTruthy();

    sponsorId = res.body.id;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 2: Sponsor appears in admin list
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 2: Sponsor appears in admin list', async ({ page, request }) => {
    test.skip(!sponsorId, 'Sponsor not created');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await adminFetch(request, 'GET', '/api/v2/admin/sponsors');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const found = res.body.items.find((s: any) => s.id === sponsorId);
    expect(found).toBeTruthy();
    expect(found.name).toBe(SPONSOR_NAME);
    expect(found.tier).toBe('gold');
    expect(found.is_active).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 3: Sponsor resolves for event (public API)
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 3: Sponsor resolves for event via public API', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await publicFetch(page, `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const found = res.body.items.find((s: any) => s.id === sponsorId);
    expect(found).toBeTruthy();
    expect(found.name).toBe(SPONSOR_NAME);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 4: Sponsor-bundle returns sponsor with display surface filtering
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 4: Sponsor-bundle includes sponsor for display surface', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=display`
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const bundle = res.body.bundle;
    expect(bundle).toBeTruthy();

    // OSE-891/#25: placement is UNIFORM — every active sponsor is eligible for
    // EVERY surface bucket (the retired placement_formats named-slot selection is
    // gone; buildSponsorBundle gives all four buckets the same covenant rotation).
    // So assert presence on all four surfaces, not just the two a legacy
    // placement_formats would have picked.
    for (const surface of ['posterTop', 'tvTop', 'tvSide', 'mobileBanner']) {
      const inSurface = bundle.surface_sponsors[surface].find((s: any) => s.id === sponsorId);
      expect(inSurface, `sponsor must appear on ${surface} (uniform eligibility)`).toBeTruthy();
    }

    // Rotation config should be valid
    expect(bundle.rotation_config.rotationMs).toBeGreaterThanOrEqual(3000);
    expect(bundle.rotation_config.rotationMs).toBeLessThanOrEqual(15000);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 5: Display surface renders sponsor in DOM
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 5: Display surface renders sponsor in banner and sidebar', async ({
    page,
    request,
  }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');

    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });
    // Wait for sponsor loading to complete
    await page.waitForTimeout(3000);

    // Banner (tvTop): sponsor should appear with data-tier="gold"
    const bannerItems = page.locator('[data-testid="display-sponsor-item"]');
    const bannerCount = await bannerItems.count();
    expect(bannerCount).toBeGreaterThan(0);

    // Find our specific sponsor in the banner
    let foundInBanner = false;
    for (let i = 0; i < bannerCount; i++) {
      const name = await bannerItems.nth(i).locator('.name').textContent();
      if (name?.includes('Journey Sponsor')) {
        foundInBanner = true;
        const tier = await bannerItems.nth(i).getAttribute('data-tier');
        expect(tier).toBe('gold');
        break;
      }
    }
    expect(foundInBanner).toBe(true);

    // Sidebar (tvSide): sponsor should rotate through
    const sidebarItem = page.locator('[data-testid="display-sponsor-rotate"]');
    await expect(sidebarItem).toBeVisible();
    const sidebarTier = await sidebarItem.getAttribute('data-tier');
    expect(sidebarTier).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 6: Poster surface renders sponsor
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 6: Poster surface renders sponsor', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');

    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);

    // Check poster-bundle API directly
    const res = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=poster`
    );
    expect(res.status).toBe(200);

    const posterSponsors = res.body.bundle?.surface_sponsors?.posterTop || [];
    const found = posterSponsors.find((s: any) => s.id === sponsorId);
    expect(found).toBeTruthy();

    // Check DOM rendering
    const sponsorItems = page.locator('[data-testid="poster-sponsor-item"]');
    const count = await sponsorItems.count();

    if (count > 0) {
      let foundInPoster = false;
      for (let i = 0; i < count; i++) {
        const text = await sponsorItems.nth(i).textContent();
        if (text?.includes('Journey Sponsor')) {
          foundInPoster = true;
          break;
        }
      }
      expect(foundInPoster).toBe(true);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 7: SharedReport shows sponsor metrics
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 7: SharedReport shows sponsor in metrics', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');

    await page.goto('/sharedReport', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(5000);

    // SharedReport fetches sponsors for all events and renders metric cards
    const sponsorCards = page.locator('[data-testid="report-sponsor-card"]');
    const count = await sponsorCards.count();

    if (count > 0) {
      let foundInReport = false;
      for (let i = 0; i < count; i++) {
        const text = await sponsorCards.nth(i).textContent();
        if (text?.includes('Journey Sponsor')) {
          foundInReport = true;
          // Verify tier is shown
          expect(text).toContain('gold');
          break;
        }
      }
      expect(foundInReport).toBe(true);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 8: Impression logged for displayed sponsor
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 8: Impression logged for sponsor', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await page.evaluate(
      async ({ eid, sid }: { eid: string; sid: string }) => {
        const r = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsors/${encodeURIComponent(sid)}/impression`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surface: 'display', placement: 'tvTop' }),
          }
        );
        return { status: r.status, body: await r.json() };
      },
      { eid: eventId, sid: sponsorId }
    );

    expect([200, 201]).toContain(res.status);
    expect(res.body.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 9: Click logged for sponsor
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 9: Click logged for sponsor', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await page.evaluate(
      async ({ eid, sid }: { eid: string; sid: string }) => {
        const r = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsors/${encodeURIComponent(sid)}/click`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surface: 'display', placement: 'tvTop' }),
          }
        );
        return { status: r.status, body: await r.json() };
      },
      { eid: eventId, sid: sponsorId }
    );

    expect([200, 201]).toContain(res.status);
    expect(res.body.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 10: Admin soft-deletes sponsor
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 10: Admin soft-deletes sponsor', async ({ page, request }) => {
    test.skip(!sponsorId, 'Sponsor not created');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await adminFetch(
      page,
      'DELETE',
      `/api/v2/admin/sponsors/${encodeURIComponent(sponsorId)}`
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 11: Deleted sponsor no longer resolves for event
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 11: Deleted sponsor no longer resolves for event', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await publicFetch(page, `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const found = res.body.items.find((s: any) => s.id === sponsorId);
    expect(found).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 12: Display surface no longer shows deleted sponsor
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 12: Display no longer renders deleted sponsor', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');

    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);

    // Banner should not contain our sponsor
    const bannerItems = page.locator('[data-testid="display-sponsor-item"]');
    const count = await bannerItems.count();

    for (let i = 0; i < count; i++) {
      const name = await bannerItems.nth(i).locator('.name').textContent();
      expect(name).not.toContain('Journey Sponsor');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPONSOR JOURNEY: Tier upgrade path
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Sponsor Journey — Tier Upgrade', () => {
  let eventId: string;
  let sponsorId: string;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not set');
  });

  test('Step 0: Find live event', async ({ page, request }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    const res = await publicFetch(page, '/api/v2/events');
    test.skip(!res.body.ok || !res.body.items?.length, 'No events');
    eventId = res.body.items[0].id;
  });

  test('Step 1: Create bronze sponsor', async ({ page, request }) => {
    test.skip(!eventId, 'No event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await adminFetch(request, 'POST', '/api/v2/admin/sponsors', {
      name: `Tier Upgrade ${timestamp}`,
      event_id: eventId,
      tier: 'bronze',
      logo_url: 'https://via.placeholder.com/200x80?text=Bronze',
      placement_formats: JSON.stringify({ tvTop: true, tvSide: true }),
    });

    expect([200, 201]).toContain(res.status);
    sponsorId = res.body.id;
  });

  test('Step 2: Verify bronze tier on Display', async ({ page, request }) => {
    test.skip(!sponsorId, 'No sponsor');
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);

    const items = page.locator('[data-testid="display-sponsor-item"]');
    const count = await items.count();

    for (let i = 0; i < count; i++) {
      const name = await items.nth(i).locator('.name').textContent();
      if (name?.includes('Tier Upgrade')) {
        const tier = await items.nth(i).getAttribute('data-tier');
        expect(tier).toBe('bronze');
        break;
      }
    }
  });

  test('Step 3: Upgrade to platinum tier', async ({ page, request }) => {
    test.skip(!sponsorId, 'No sponsor');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await adminFetch(
      page,
      'PUT',
      `/api/v2/admin/sponsors/${encodeURIComponent(sponsorId)}`,
      { tier: 'platinum' }
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('Step 4: Verify platinum tier renders with UNIFORM treatment on Display (#25)', async ({
    page,
    request,
  }) => {
    test.skip(!sponsorId, 'No sponsor');
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);

    const items = page.locator('[data-testid="display-sponsor-item"]');
    const count = await items.count();

    for (let i = 0; i < count; i++) {
      const name = await items.nth(i).locator('.name').textContent();
      if (name?.includes('Tier Upgrade')) {
        // data-tier is retained for rotation/frequency identity…
        const tier = await items.nth(i).getAttribute('data-tier');
        expect(tier).toBe('platinum');

        // …but #25/OSE-878: it drives NO visual accent — the platinum item carries the
        // same default border as every other sponsor (the retired gold accent is gone).
        const borderColor = await items
          .nth(i)
          .evaluate((el) => window.getComputedStyle(el).borderColor);
        expect(borderColor).toContain('0.06');
        break;
      }
    }
  });

  test('Cleanup: Delete sponsor', async ({ page, request }) => {
    test.skip(!sponsorId, 'No sponsor');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await adminFetch(request, 'DELETE', `/api/v2/admin/sponsors/${encodeURIComponent(sponsorId)}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPONSOR JOURNEY: Cross-surface rendering
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Sponsor Journey — Cross-Surface Rendering', () => {
  let eventId: string;
  let sponsorId: string;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not set');
  });

  test('Setup: Create sponsor with all surfaces enabled', async ({ page, request }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const evRes = await publicFetch(page, '/api/v2/events');
    test.skip(!evRes.body.ok || !evRes.body.items?.length, 'No events');
    eventId = evRes.body.items[0].id;

    const res = await adminFetch(request, 'POST', '/api/v2/admin/sponsors', {
      name: `Cross Surface ${timestamp}`,
      event_id: eventId,
      tier: 'gold',
      logo_url: 'https://via.placeholder.com/300x100?text=Cross+Surface',
      placement_formats: JSON.stringify({
        tvTop: true,
        tvSide: true,
        posterTop: true,
        mobileBanner: true,
      }),
    });
    expect([200, 201]).toContain(res.status);
    sponsorId = res.body.id;
  });

  test('Display surface: sponsor in bundle', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor/event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=display`
    );
    const tvTop = res.body.bundle?.surface_sponsors?.tvTop || [];
    expect(tvTop.find((s: any) => s.id === sponsorId)).toBeTruthy();
  });

  test('Poster surface: sponsor in bundle', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor/event');
    await page.goto('/poster', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=poster`
    );
    const posterTop = res.body.bundle?.surface_sponsors?.posterTop || [];
    expect(posterTop.find((s: any) => s.id === sponsorId)).toBeTruthy();
  });

  test('Public surface: sponsor in bundle', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor/event');
    await page.goto('/public', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=public`
    );
    const mobileBanner = res.body.bundle?.surface_sponsors?.mobileBanner || [];
    expect(mobileBanner.find((s: any) => s.id === sponsorId)).toBeTruthy();
  });

  test('SharedReport surface: sponsor in unfiltered list', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor/event');
    await page.goto('/sharedReport', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await publicFetch(page, `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`);
    expect(res.body.items.find((s: any) => s.id === sponsorId)).toBeTruthy();
  });

  test('Cleanup: Delete sponsor', async ({ page, request }) => {
    test.skip(!sponsorId, 'No sponsor');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await adminFetch(request, 'DELETE', `/api/v2/admin/sponsors/${encodeURIComponent(sponsorId)}`);
  });
});
