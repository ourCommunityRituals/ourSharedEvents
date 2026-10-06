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
const SMOKE_EVENT_SPONSORED = process.env.SMOKE_EVENT_SPONSORED || '';

// OSE-834: in a blocking CI tier (PW_REQUIRE_PRECONDITIONS=1) an unmet precondition
// — no admin key, a CF Access edge block — is a FAILURE, not a green skip: "a tier
// that cannot fail is not a tier." Locally / on forks (flag unset) it still skips so
// the spec stays runnable without staging creds. This flag is set by the workflow
// step that runs this tier, once the seed + tokens + fresh deploy make the
// preconditions genuinely satisfiable (the arm — OSE-834 slice 2c).
const REQUIRE_PRECONDITIONS = process.env.PW_REQUIRE_PRECONDITIONS === '1';
function precondition(unmet: boolean, message: string): void {
  if (unmet && REQUIRE_PRECONDITIONS) {
    throw new Error(`precondition unmet in a blocking job: ${message}`);
  }
  test.skip(unmet, message);
}

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

type JourneyEvent = { id?: string; phase?: string };

// The TV board drops a finished event (display.html isShowable), so a sponsor
// attached to one can never render there. The journey needs an event the board
// will feature.
function isOnTheBoard(item: JourneyEvent | undefined): item is JourneyEvent & { id: string } {
  return !!item?.id && item.phase !== 'post_event';
}

/**
 * The event this run attaches its sponsor to, and features on the TV.
 *
 * OSE-1197: T4b seeds a dedicated sponsored fixture (`SMOKE_EVENT_SPONSORED`).
 * It is live but not in the public list, so it is read by id, the same way
 * `/display?event=<id>` reads it. Otherwise the first listed event that has not
 * finished. Never "whichever sorts first": on staging that is test-event-001,
 * which ended in May.
 */
async function resolveJourneyEvent(page: any, listed: JourneyEvent[]): Promise<string | undefined> {
  if (SMOKE_EVENT_SPONSORED) {
    const one = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(SMOKE_EVENT_SPONSORED)}`
    );
    if (one.status === 200 && one.body?.ok && isOnTheBoard(one.body.item)) return one.body.item.id;
  }
  return listed.find(isOnTheBoard)?.id;
}

// The bare /display features the first listed event; the journey must look at
// the event it attached its sponsor to.
function displayUrl(eventId: string): string {
  return `/display?event=${encodeURIComponent(eventId)}`;
}

// ─── Test Data ──────────────────────────────────────────────────────────────────

const timestamp = Date.now();
const SPONSOR_NAME = `Journey Sponsor ${timestamp}`;

// Find the Display sponsor tile whose name matches EXACTLY (not a substring), so a
// leftover sponsor from a prior run on the shared event can never be mistaken for
// this run's. Returns the item locator, or null when it is not currently rendered.
async function findDisplaySponsorByName(
  page: import('@playwright/test').Page,
  sponsorName: string
): Promise<import('@playwright/test').Locator | null> {
  const items = page.locator('[data-testid="display-sponsor-item"]');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const name = await items.nth(i).locator('.name').textContent();
    if (name === sponsorName) return items.nth(i);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPONSOR JOURNEY: Full lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Sponsor Journey — Full Lifecycle', () => {
  // State shared across serial tests
  let eventId: string;
  let sponsorId: string;
  let placementId: string;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    precondition(!ADMIN_KEY, 'ADMIN_KEY not set — required for the sponsor journey');
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

    const pickedEventId = await resolveJourneyEvent(page, items);
    expect(pickedEventId, 'an event that has not finished, so the TV can feature it').toBeTruthy();
    eventId = pickedEventId!;
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

    precondition(
      res.body?.code === 'CF_ACCESS_BLOCKED',
      'CF Access blocked the admin API — an infra block is not a pass'
    );

    expect([200, 201]).toContain(res.status);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeTruthy();
    expect(res.body.placement_id, 'create exposes placement_id for the accept step').toBeTruthy();

    sponsorId = res.body.id;
    placementId = res.body.placement_id;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 1b: Sponsor accepts the placement (strict consent — ADR-019)
  // ─────────────────────────────────────────────────────────────────────────────
  // An organizer-created placement is PENDING; strict consent hides a pending
  // sponsor from EVERY public surface until the sponsor accepts on its own
  // /sponsor page. This is the real triangle flow: admin mints the sponsor-home
  // link (brand-scoped) → the sponsor's token responds "accept". Without it,
  // Steps 3–7 (public visibility) correctly see nothing. adminFetch carries the
  // CF-Access headers so both calls reach the worker through Access (the Bearer
  // it also adds is ignored by the token-authed respond endpoint).

  test('Step 1b: Sponsor accepts the placement (mint home-link → respond)', async ({ request }) => {
    test.skip(!sponsorId || !placementId, 'Sponsor/placement not created');

    const mint = await adminFetch(request, 'POST', `/api/v2/admin/sponsors/${sponsorId}/home-link`);
    precondition(
      mint.body?.code === 'CF_ACCESS_BLOCKED',
      'CF Access blocked the home-link mint — an infra block is not a pass'
    );
    expect(mint.status).toBe(200);
    expect(mint.body.ok).toBe(true);
    const token = new URL(mint.body.url).searchParams.get('t');
    expect(token, 'home-link URL carries a ?t= token').toBeTruthy();

    const res = await adminFetch(
      request,
      'POST',
      `/api/v2/sponsor/placements/${placementId}/respond`,
      { token, accepted: true }
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
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

    // OSE-944: the public sponsors read is cache-fronted (SWR); the sponsor created
    // in Step 1 may not appear on the immediate read. Poll until it propagates
    // instead of asserting once (the flywheel's screen N+1 sees screen N contract).
    // The poll MUST exceed the 30s cache TTL: invalidation is best-effort
    // (sponsors.ts), so a missed purge means the write is only visible at TTL
    // expiry — a 20s poll under-budgeted that worst case and flaked on the first
    // cold-cache staging deploy (P1-7). 40s covers the full TTL + margin.
    await expect(async () => {
      const res = await publicFetch(page, `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const found = res.body.items.find((s: any) => s.id === sponsorId);
      expect(found, 'sponsor present in public list after write→read propagation').toBeTruthy();
      expect(found.name).toBe(SPONSOR_NAME);
    }).toPass({ timeout: 40000, intervals: [500, 1000, 2000, 3000, 5000] });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 4: Sponsor-bundle returns sponsor with display surface filtering
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 4: Sponsor-bundle includes sponsor for display surface', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // OSE-944: cache-fronted bundle read — poll until the new sponsor propagates.
    await expect(async () => {
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
    }).toPass({ timeout: 40000, intervals: [500, 1000, 2000, 3000, 5000] });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 5: Display surface renders sponsor in DOM
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 5: Display surface renders sponsor in banner and sidebar', async ({
    page,
    request,
  }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');

    await page.goto(displayUrl(eventId), { waitUntil: 'networkidle', timeout: TIMEOUT });
    // Wait for sponsor loading to complete
    await page.waitForTimeout(3000);

    // Banner (tvTop): our exact sponsor should appear with data-tier="gold"
    const bannerItem = await findDisplaySponsorByName(page, SPONSOR_NAME);
    expect(bannerItem, "this run's Journey Sponsor is rendered in the banner").not.toBeNull();
    expect(await bannerItem!.getAttribute('data-tier')).toBe('gold');

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

    // OSE-1310: a well-formed beacon is always `ok: true`. 201 means it became a
    // fresh row; 202 { counted: false } is the equally-legitimate "accepted but
    // filtered" shape (bot/dedup/flood heuristics) -- this step only asserts the
    // journey's endpoint call succeeds, not that a specific row was written, so
    // it must not fail merely because shared CI fixture traffic tripped a
    // cadence/dedup control on this pinned smoke event.
    expect([200, 201, 202]).toContain(res.status);
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

    // OSE-1310: see the impression-step note above -- 202 { counted: false } is
    // an equally legitimate "accepted but filtered" response.
    expect([200, 201, 202]).toContain(res.status);
    expect(res.body.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 10: Admin soft-deletes sponsor
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 10: Admin soft-deletes sponsor', async ({ page, request }) => {
    test.skip(!sponsorId, 'Sponsor not created');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await adminFetch(
      request,
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

    // OSE-944: the delete must also propagate through the SWR cache before the
    // public read reflects the absence — poll until it's gone.
    await expect(async () => {
      const res = await publicFetch(page, `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const found = res.body.items.find((s: any) => s.id === sponsorId);
      expect(found, 'deleted sponsor absent from public list after propagation').toBeUndefined();
    }).toPass({ timeout: 40000, intervals: [500, 1000, 2000, 3000, 5000] });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 12: Display surface no longer shows deleted sponsor
  // ─────────────────────────────────────────────────────────────────────────────

  test('Step 12: Display no longer renders deleted sponsor', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'Missing sponsor or event');

    await page.goto(displayUrl(eventId), { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);

    // This run's exact sponsor must no longer render (a leftover "Journey Sponsor …"
    // from another run must not fail this — match this run's name precisely).
    expect(await findDisplaySponsorByName(page, SPONSOR_NAME)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPONSOR JOURNEY: Tier upgrade path
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Sponsor Journey — Tier Upgrade', () => {
  let eventId: string;
  let sponsorId: string;
  let placementId: string;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    precondition(!ADMIN_KEY, 'ADMIN_KEY not set');
  });

  test('Step 0: Find live event', async ({ page, request }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    const res = await publicFetch(page, '/api/v2/events');
    test.skip(!res.body.ok || !res.body.items?.length, 'No events');
    const pickedEventId = await resolveJourneyEvent(page, res.body.items || []);
    expect(pickedEventId, 'an event that has not finished, so the TV can feature it').toBeTruthy();
    eventId = pickedEventId!;
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
    placementId = res.body.placement_id;
  });

  // Step 1b: strict consent (ADR-019). An organizer-created placement is PENDING and
  // hidden from every public surface (incl. Display) until the sponsor accepts. Mint
  // the sponsor-home link (brand-scoped) → the sponsor's token responds "accept".
  test('Step 1b: Sponsor accepts the placement (mint home-link → respond)', async ({ request }) => {
    test.skip(!sponsorId || !placementId, 'Sponsor/placement not created');
    const mint = await adminFetch(request, 'POST', `/api/v2/admin/sponsors/${sponsorId}/home-link`);
    precondition(
      mint.body?.code === 'CF_ACCESS_BLOCKED',
      'CF Access blocked the home-link mint — an infra block is not a pass'
    );
    expect(mint.status).toBe(200);
    expect(mint.body.ok).toBe(true);
    const token = new URL(mint.body.url).searchParams.get('t');
    expect(token, 'home-link URL carries a ?t= token').toBeTruthy();
    const res = await adminFetch(
      request,
      'POST',
      `/api/v2/sponsor/placements/${placementId}/respond`,
      { token, accepted: true }
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('Step 2: Verify bronze tier on Display', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor');
    await page.goto(displayUrl(eventId), { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);

    const item = await findDisplaySponsorByName(page, `Tier Upgrade ${timestamp}`);
    expect(item, "this run's Tier Upgrade sponsor is rendered on the display").not.toBeNull();
    expect(await item!.getAttribute('data-tier')).toBe('bronze');
  });

  test('Step 3: Upgrade to platinum tier', async ({ page, request }) => {
    test.skip(!sponsorId, 'No sponsor');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await adminFetch(
      request,
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
    test.skip(!sponsorId || !eventId, 'No sponsor');
    await page.goto(displayUrl(eventId), { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);

    const item = await findDisplaySponsorByName(page, `Tier Upgrade ${timestamp}`);
    expect(item, "this run's Tier Upgrade sponsor is rendered on the display").not.toBeNull();
    // The journey verifies the upgraded sponsor RENDERS as platinum (data-tier is
    // retained for rotation/frequency identity). The #25/OSE-878 "uniform treatment —
    // no tier accent" invariant is asserted where the fixtures are controlled — both a
    // platinum AND a base sponsor present, so borders can be compared:
    //   tests/e2e/2-pages/display-sponsor-overlay.spec.ts §"Uniform Rendering (#25/OSE-878)".
    // It does NOT belong here — a journey step can't guarantee a sibling tile on a
    // shared event, and asserting a hardcoded border value drifts with the design.
    expect(await item!.getAttribute('data-tier')).toBe('platinum');
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
  let placementId: string;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    precondition(!ADMIN_KEY, 'ADMIN_KEY not set');
  });

  test('Setup: Create sponsor with all surfaces enabled', async ({ page, request }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const evRes = await publicFetch(page, '/api/v2/events');
    test.skip(!evRes.body.ok || !evRes.body.items?.length, 'No events');
    const pickedEventId = await resolveJourneyEvent(page, evRes.body.items || []);
    expect(pickedEventId, 'an event that has not finished, so the TV can feature it').toBeTruthy();
    eventId = pickedEventId!;

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
    placementId = res.body.placement_id;
  });

  // Strict consent (ADR-019): accept the placement so it renders on every surface.
  test('Accept: sponsor accepts the placement (mint home-link → respond)', async ({ request }) => {
    test.skip(!sponsorId || !placementId, 'Sponsor/placement not created');
    const mint = await adminFetch(request, 'POST', `/api/v2/admin/sponsors/${sponsorId}/home-link`);
    precondition(
      mint.body?.code === 'CF_ACCESS_BLOCKED',
      'CF Access blocked the home-link mint — an infra block is not a pass'
    );
    expect(mint.status).toBe(200);
    expect(mint.body.ok).toBe(true);
    const token = new URL(mint.body.url).searchParams.get('t');
    expect(token, 'home-link URL carries a ?t= token').toBeTruthy();
    const res = await adminFetch(
      request,
      'POST',
      `/api/v2/sponsor/placements/${placementId}/respond`,
      { token, accepted: true }
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('Display surface: sponsor in bundle', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor/event');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // OSE-944: cache-fronted bundle read — poll until the sponsor propagates.
    await expect(async () => {
      const res = await publicFetch(
        page,
        `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=display`
      );
      const tvTop = res.body.bundle?.surface_sponsors?.tvTop || [];
      expect(tvTop.find((s: any) => s.id === sponsorId)).toBeTruthy();
    }).toPass({ timeout: 40000, intervals: [500, 1000, 2000, 3000, 5000] });
  });

  test('Poster surface: sponsor in bundle', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor/event');
    await page.goto('/poster', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // OSE-944: cache-fronted bundle read — poll until the sponsor propagates.
    await expect(async () => {
      const res = await publicFetch(
        page,
        `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=poster`
      );
      const posterTop = res.body.bundle?.surface_sponsors?.posterTop || [];
      expect(posterTop.find((s: any) => s.id === sponsorId)).toBeTruthy();
    }).toPass({ timeout: 40000, intervals: [500, 1000, 2000, 3000, 5000] });
  });

  test('Public surface: sponsor in bundle', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor/event');
    await page.goto('/public', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // OSE-944: cache-fronted bundle read — poll until the sponsor propagates.
    await expect(async () => {
      const res = await publicFetch(
        page,
        `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=public`
      );
      const mobileBanner = res.body.bundle?.surface_sponsors?.mobileBanner || [];
      expect(mobileBanner.find((s: any) => s.id === sponsorId)).toBeTruthy();
    }).toPass({ timeout: 40000, intervals: [500, 1000, 2000, 3000, 5000] });
  });

  test('SharedReport surface: sponsor in unfiltered list', async ({ page, request }) => {
    test.skip(!sponsorId || !eventId, 'No sponsor/event');
    await page.goto('/sharedReport', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // OSE-944: cache-fronted read — poll until the sponsor propagates.
    await expect(async () => {
      const res = await publicFetch(page, `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`);
      expect(res.body.items.find((s: any) => s.id === sponsorId)).toBeTruthy();
    }).toPass({ timeout: 40000, intervals: [500, 1000, 2000, 3000, 5000] });
  });

  test('Cleanup: Delete sponsor', async ({ page, request }) => {
    test.skip(!sponsorId, 'No sponsor');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await adminFetch(request, 'DELETE', `/api/v2/admin/sponsors/${encodeURIComponent(sponsorId)}`);
  });
});
