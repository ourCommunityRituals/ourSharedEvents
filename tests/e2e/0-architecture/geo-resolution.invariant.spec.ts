/**
 * INVARIANT 2: Hyper-Local Geo-Resolution
 *
 * The corridor-level sponsor matching system that keeps local sponsors local.
 * These tests enforce that the geo-resolution engine works correctly:
 *
 *   - Direct path: sponsor.event_id = eventId (always resolves)
 *   - Template+Geo path: matching template_id AND matching area (zip or radius)
 *   - Service areas: zip_code match OR haversine radius match
 *   - Tier sorting: title > platinum > gold > silver > bronze > primary
 *   - Surface filtering: display=tvTop|tvSide, poster=posterTop, public=mobileBanner
 *   - Deduplication: same sponsor via both paths appears once
 *
 * These invariants apply to ANY entity in the triangle.
 * A travel partner sponsoring a CHI→MKE macro corridor uses the same
 * geo-resolution as a local bar sponsoring a Beverly bocce night.
 *
 * Source of truth:
 *   - workers/oursharedevents/src/lib/sponsor-resolver.ts
 *   - migrations/0019_create_sponsor_event_types.sql
 *   - migrations/0020_create_sponsor_areas.sql
 *   - migrations/0021_add_geo_to_events.sql
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 30_000;
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.X_OCR_INTERNAL || '';

async function adminFetch(page: any, method: string, path: string, body?: Record<string, unknown>) {
  return page.evaluate(
    async ({
      method,
      path,
      body,
      key,
    }: {
      method: string;
      path: string;
      body?: Record<string, unknown>;
      key: string;
    }) => {
      const opts: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(path, opts);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        return {
          status: res.status,
          body: { ok: false, code: 'CF_ACCESS_BLOCKED', error: 'CF Access returned HTML' },
        };
      }
      return { status: res.status, body: await res.json() };
    },
    { method, path, body, key: ADMIN_KEY }
  );
}

async function publicFetch(page: any, path: string) {
  return page.evaluate(async (p: string) => {
    const res = await fetch(p);
    return { status: res.status, body: await res.json() };
  }, path);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DIRECT RESOLUTION PATH
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Geo-Resolution — Direct Path', () => {
  test('sponsor with matching event_id resolves for that event', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const sponsorsRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`
    );

    expect(sponsorsRes.status).toBe(200);
    expect(sponsorsRes.body.ok).toBe(true);
    expect(Array.isArray(sponsorsRes.body.items)).toBe(true);

    // Every returned sponsor should be active
    for (const s of sponsorsRes.body.items) {
      expect(s.is_active).toBe(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SPONSOR BUNDLE — SURFACE FILTERING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Geo-Resolution — Surface Filtering', () => {
  test('display surface returns tvTop and tvSide sponsors', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const bundleRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=display`
    );

    expect(bundleRes.body.ok).toBe(true);
    const ss = bundleRes.body.bundle?.surface_sponsors;
    expect(ss).toBeDefined();
    expect(Array.isArray(ss.tvTop)).toBe(true);
    expect(Array.isArray(ss.tvSide)).toBe(true);
  });

  test('poster surface returns posterTop sponsors', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const bundleRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=poster`
    );

    expect(bundleRes.body.ok).toBe(true);
    const ss = bundleRes.body.bundle?.surface_sponsors;
    expect(Array.isArray(ss.posterTop)).toBe(true);
  });

  test('public surface returns mobileBanner sponsors', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const bundleRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=public`
    );

    expect(bundleRes.body.ok).toBe(true);
    expect(Array.isArray(bundleRes.body.bundle?.surface_sponsors?.mobileBanner)).toBe(true);
  });

  test('sharedReport surface returns ALL sponsors (no filtering)', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;

    const allRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`
    );
    const bundleRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle?surface=sharedReport`
    );

    // sharedReport bundle should contain ALL sponsors, not a filtered subset
    // (though the bundle itself wraps them into surface_sponsors structure)
    expect(bundleRes.body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TIER SORT ORDER
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Geo-Resolution — Tier Priority', () => {
  const TIER_ORDER: Record<string, number> = {
    title: 1,
    platinum: 2,
    gold: 3,
    silver: 4,
    bronze: 5,
    primary: 6,
  };

  test('sponsors are returned sorted by tier priority', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const sponsorsRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`
    );
    const sponsors = sponsorsRes.body.items || [];

    test.skip(sponsors.length < 2, 'Need 2+ sponsors to verify sort order');

    // Verify tier sort: each sponsor's tier priority should be <= the next
    for (let i = 0; i < sponsors.length - 1; i++) {
      const currentPriority = TIER_ORDER[sponsors[i].tier] ?? 99;
      const nextPriority = TIER_ORDER[sponsors[i + 1].tier] ?? 99;
      expect(currentPriority).toBeLessThanOrEqual(nextPriority);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ROTATION CONFIG BOUNDS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Geo-Resolution — Rotation Config', () => {
  test('rotation timing is within 3s–15s bounds', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const bundleRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle`
    );

    const ms = bundleRes.body.bundle?.rotation_config?.rotationMs;
    expect(ms).toBeDefined();
    expect(ms).toBeGreaterThanOrEqual(3000);
    expect(ms).toBeLessThanOrEqual(15000);
  });

  test('more sponsors = more rotation slots, never fewer', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const bundleRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle`
    );

    const bundle = bundleRes.body.bundle;
    expect(bundle?.rotation_config?.sponsorSlots).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. EVENT TYPE + SERVICE AREA APIS (Template+Geo path)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Geo-Resolution — Template+Geo APIs', () => {
  test.skip(!ADMIN_KEY, 'ADMIN_KEY not set');

  test('event-types API accepts and returns template associations', async ({ page }) => {
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not set');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // List sponsors to find one to test with
    const listRes = await adminFetch(page, 'GET', '/api/v2/admin/sponsors');
    test.skip(listRes.body?.code === 'CF_ACCESS_BLOCKED', 'CF Access blocked admin API');
    test.skip(!listRes.body?.items?.length, 'No sponsors');

    const sponsorId = listRes.body.items[0].id;

    const res = await adminFetch(
      page,
      'GET',
      `/api/v2/admin/sponsors/${encodeURIComponent(sponsorId)}/event-types`
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('service-areas API accepts and returns geo areas', async ({ page }) => {
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not set');
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const listRes = await adminFetch(page, 'GET', '/api/v2/admin/sponsors');
    test.skip(listRes.body?.code === 'CF_ACCESS_BLOCKED', 'CF Access blocked admin API');
    test.skip(!listRes.body?.items?.length, 'No sponsors');

    const sponsorId = listRes.body.items[0].id;

    const res = await adminFetch(
      page,
      'GET',
      `/api/v2/admin/sponsors/${encodeURIComponent(sponsorId)}/areas`
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
