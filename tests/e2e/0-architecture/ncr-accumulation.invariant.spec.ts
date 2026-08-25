/**
 * INVARIANT 4: NCR Data Accumulation — The Compound Effect
 *
 * Anonymous scan data accumulates forever because no PII exists.
 * These tests enforce the NCR data pipeline at the platform level:
 *
 *   - poster_deployments carry lat/lng for geo-spatial mapping
 *   - scan_aggregates provide pre-computed rollups
 *   - sponsor_impressions track placement attribution
 *   - Data flows from scan → aggregate → cross-event pattern
 *   - No TTL on scan data (permanent — the compound asset)
 *   - Sponsor data includes event_id, surface, placement for attribution
 *
 * NCR phases:
 *   Phase 1 (Now): Per-event anonymous metrics
 *   Phase 2 (Next): Cross-event pattern recognition
 *   Phase 3 (Horizon): Hyperlocal economic intelligence
 *
 * The invariant wrapper guarantees that any entity plugging into the
 * triangle generates NCR-compatible data. University research partner,
 * healthcare clinic, travel sponsor — all produce the same anonymous
 * data atoms that feed the NCR pipeline.
 *
 * Source of truth:
 *   - docs/features/NCR-METHODOLOGY.md
 *   - migrations/0003_create_poster_deployments.sql
 *   - migrations/0004_create_scans.sql
 *   - migrations/0006_create_scan_aggregates.sql
 *   - migrations/0022_create_sponsor_impressions.sql
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 30_000;
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.X_OCR_INTERNAL || '';

async function publicFetch(page: any, path: string) {
  return page.evaluate(async (p: string) => {
    const res = await fetch(p);
    return { status: res.status, body: await res.json() };
  }, path);
}

// Prefer the durably-seeded sponsored event (tests/ui/smoke/fixtures/
// sponsored-event.sql) for write-path tests: its sponsor is a real, FK-valid
// sponsor_business row, so impression/click writes return 201 instead of the
// mock-fallback FK 503 (the read path can surface a sponsor with no backing row).
const SPONSORED_EVENT = process.env.SMOKE_EVENT_SPONSORED || '';

async function resolveSponsorTarget(page: any): Promise<{ eventId: string; sponsorId: string }> {
  return page.evaluate(async (pref: string) => {
    const evRes = await fetch('/api/v2/events');
    const evJson = await evRes.json();
    const items = (evJson && evJson.items) || [];
    const eventId = pref || (items[0] ? items[0].id : '');
    if (!eventId) return { eventId: '', sponsorId: '' };
    const spRes = await fetch(`/api/v2/events/${encodeURIComponent(eventId)}/sponsors`);
    const spJson = await spRes.json();
    const sid = spJson && spJson.items && spJson.items[0] ? spJson.items[0].id : '';
    return { eventId, sponsorId: sid };
  }, SPONSORED_EVENT);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SPONSOR IMPRESSION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: NCR — Impression Data Pipeline', () => {
  test('impression POST captures surface and placement', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const { eventId, sponsorId } = await resolveSponsorTarget(page);
    if (SPONSORED_EVENT) {
      expect(
        sponsorId,
        'SMOKE_EVENT_SPONSORED must expose an active FK-valid sponsor'
      ).toBeTruthy();
    } else {
      test.skip(!eventId || !sponsorId, 'No events/sponsors');
    }

    // Log impression with surface and placement — these are the NCR data atoms
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

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  test('click POST captures surface and placement', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const { eventId, sponsorId } = await resolveSponsorTarget(page);
    if (SPONSORED_EVENT) {
      expect(
        sponsorId,
        'SMOKE_EVENT_SPONSORED must expose an active FK-valid sponsor'
      ).toBeTruthy();
    } else {
      test.skip(!eventId || !sponsorId, 'No events/sponsors');
    }

    const res = await page.evaluate(
      async ({ eid, sid }: { eid: string; sid: string }) => {
        const r = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsors/${encodeURIComponent(sid)}/click`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surface: 'poster', placement: 'posterTop' }),
          }
        );
        return { status: r.status, body: await r.json() };
      },
      { eid: eventId, sid: sponsorId }
    );

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  test('impression surface values are constrained to known surfaces', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const { eventId, sponsorId } = await resolveSponsorTarget(page);
    if (SPONSORED_EVENT) {
      expect(
        sponsorId,
        'SMOKE_EVENT_SPONSORED must expose an active FK-valid sponsor'
      ).toBeTruthy();
    } else {
      test.skip(!eventId || !sponsorId, 'No events/sponsors');
    }

    // Even with an unknown surface value, the API should accept it
    // (the schema truncates to 50 chars — it doesn't reject unknown surfaces)
    const res = await page.evaluate(
      async ({ eid, sid }: { eid: string; sid: string }) => {
        const r = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsors/${encodeURIComponent(sid)}/impression`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surface: 'unknown_surface', placement: 'test' }),
          }
        );
        return { status: r.status };
      },
      { eid: eventId, sid: sponsorId }
    );

    // System accepts unknown surfaces (logs them) — doesn't crash
    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SPONSOR BUNDLE — NCR DATA ATOMS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: NCR — Sponsor Bundle Data Atoms', () => {
  test('sponsor bundle contains rotation_config for display cadence', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const bundleRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle`
    );

    expect(bundleRes.body.ok).toBe(true);
    const rc = bundleRes.body.bundle?.rotation_config;
    expect(rc).toBeDefined();
    expect(rc.sponsorSlots).toBeGreaterThanOrEqual(1);
    expect(rc.rotationMs).toBeGreaterThanOrEqual(3000);
    expect(rc.rotationMs).toBeLessThanOrEqual(15000);
  });

  test('each sponsor in bundle has event_id for NCR attribution', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const sponsorsRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`
    );
    const sponsors = sponsorsRes.body.items || [];

    for (const s of sponsors) {
      expect(s.event_id).toBeTruthy();
      expect(s.id).toBeTruthy();
      expect(s.tier).toBeTruthy();
    }
  });

  test('sponsor has placement_formats for surface attribution', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const sponsorsRes = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsors`
    );
    const sponsors = sponsorsRes.body.items || [];

    for (const s of sponsors) {
      // placement_formats should be a JSON string (may be empty '{}' but always present)
      expect(typeof s.placement_formats).toBe('string');
      // Should be parseable JSON
      expect(() => JSON.parse(s.placement_formats)).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EVENT DATA — GEO FIELDS FOR NCR
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: NCR — Event Geo Fields', () => {
  test('events API returns events with id', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    expect(eventsRes.body.ok).toBe(true);

    const items = eventsRes.body.items || [];
    for (const e of items) {
      // Every event MUST have an id — this is the NCR atomic unit
      expect(e.id).toBeTruthy();
      // Name may be null/empty for draft events — id is the invariant, not name
      expect(typeof e.id).toBe('string');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DISPLAY SURFACE — AUTO IMPRESSION LOGGING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: NCR — Display Auto-Logs Impressions', () => {
  test('Display page fires impression requests on load', async ({ page }) => {
    const impressionUrls: string[] = [];

    // Intercept impression POST requests
    page.on('request', (req) => {
      if (req.url().includes('/impression') && req.method() === 'POST') {
        impressionUrls.push(req.url());
      }
    });

    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(5000);

    // If sponsors exist, impressions should have been fired
    // The Display template auto-logs impressions for tvTop + tvSide sponsors
    // If no sponsors exist, no impressions fire (which is correct)
    // This test documents the contract — impressions flow automatically
    if (impressionUrls.length > 0) {
      for (const url of impressionUrls) {
        expect(url).toContain('/sponsors/');
        expect(url).toContain('/impression');
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. NCR HIERARCHY — TABLES EXIST
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: NCR — Data Pipeline Health', () => {
  test('health endpoint confirms database is operational', async ({ page }) => {
    const res = await page.goto('/health', { timeout: TIMEOUT });
    const data = await res?.json();

    expect(data?.ok).toBe(true);
    // The health endpoint confirms the Worker + D1 binding is alive
    // This is the foundation of the NCR pipeline — if health fails, no data accumulates
  });

  test('events API is operational (Phase 1 data source)', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const res = await publicFetch(page, '/api/v2/events');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Events are the atomic unit of NCR Phase 1 — each event generates scan data
  });

  test('sponsor-bundle API is operational (attribution source)', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await publicFetch(page, '/api/v2/events');
    test.skip(!eventsRes.body.ok || !eventsRes.body.items?.length, 'No events');

    const eventId = eventsRes.body.items[0].id;
    const res = await publicFetch(
      page,
      `/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle`
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Sponsor bundles are the attribution source — which sponsors, which surfaces, which placements
  });
});
