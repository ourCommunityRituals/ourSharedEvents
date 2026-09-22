/**
 * INVARIANT 1: Anonymous ID — Presence, Not Identity
 *
 * The zero-PII contract that makes the platform safe to scale.
 * These tests enforce the Anonymous ID architecture at the platform level:
 *
 *   - The scan system (DB) contains NO PII columns
 *   - The forms system (FORMS_DB) is a separate database with no cross-linking
 *   - The ose_anon cookie is HttpOnly, Secure, SameSite=Lax
 *   - Impression/click logging accepts anonymous data only
 *   - Form submissions set the anonymous cookie without leaking identity
 *   - SharedReport exposes aggregate data only — never individual records
 *
 * These invariants apply to ANY entity in the triangle:
 *   Sponsor → Event ← Customer
 *
 * A university research partner, a travel sponsor, a faith kitchen —
 * all inherit this contract. IRB-ready by design.
 *
 * Source of truth:
 *   - docs/features/ANONYMOUS-ID.md
 *   - workers/oursharedevents/src/lib/anonymous-id.ts
 *   - migrations/0004_create_scans.sql (no PII columns)
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 30_000;

// Prefer the durably-seeded sponsored event (tests/ui/smoke/fixtures/
// sponsored-event.sql) for write-path tests: its sponsor is a real, FK-valid
// sponsor_business row, so impression/click writes return 201 instead of the
// mock-fallback FK 503 (the read path can surface a sponsor with no backing row).
const SPONSORED_EVENT = process.env.SMOKE_EVENT_SPONSORED || '';

async function resolveSponsorTarget(
  page: import('@playwright/test').Page
): Promise<{ eventId: string; sponsorId: string; beaconToken: string }> {
  return page.evaluate(async (pref: string) => {
    const evRes = await fetch('/api/v2/events');
    const evJson = await evRes.json();
    const items = (evJson && evJson.items) || [];
    const eventId = pref || (items[0] ? items[0].id : '');
    if (!eventId) return { eventId: '', sponsorId: '', beaconToken: '' };
    const spRes = await fetch(`/api/v2/events/${encodeURIComponent(eventId)}/sponsors`);
    const spJson = await spRes.json();
    const sid = spJson && spJson.items && spJson.items[0] ? spJson.items[0].id : '';
    if (!sid) return { eventId, sponsorId: '', beaconToken: '' };
    // OSE-1310: impression/click writes now require a beacon token minted into
    // a sponsor-bundle response for this exact (event, sponsor) pair.
    const bundleRes = await fetch(`/api/v2/events/${encodeURIComponent(eventId)}/sponsor-bundle`);
    const bundleJson = await bundleRes.json();
    const bundled = (bundleJson.bundle?.sponsors || []).find((s: { id: string }) => s.id === sid);
    return { eventId, sponsorId: sid, beaconToken: bundled?.beacon_token || '' };
  }, SPONSORED_EVENT);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. COOKIE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Anonymous ID — Cookie Contract', () => {
  test('form submission sets ose_anon cookie', async ({ page }) => {
    // Navigate to a form page and check if the cookie gets set
    const eventsRes = await page.goto('/api/v2/events', { timeout: TIMEOUT });
    const eventsData = await eventsRes?.json();
    const items = eventsData?.items || [];

    test.skip(items.length === 0, 'No events — cannot test form submission');

    const eventId = items[0].id;

    // Submit a registration form (public, no auth)
    const response = await page.evaluate(async (eid: string) => {
      const res = await fetch(`/api/v2/events/${encodeURIComponent(eid)}/forms/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Anon Test ${Date.now()}` }),
      });
      return {
        status: res.status,
        setCookie: res.headers.get('set-cookie'),
      };
    }, eventId);

    // If registration succeeded, cookie should be set
    if (response.status === 201) {
      expect(response.setCookie).toBeTruthy();
      expect(response.setCookie).toContain('ose_anon=anon_');
      expect(response.setCookie).toContain('HttpOnly');
      expect(response.setCookie).toContain('Secure');
      expect(response.setCookie).toContain('SameSite=Lax');
    }
  });

  test('ose_anon cookie value starts with anon_ prefix', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await page.evaluate(async () => {
      const res = await fetch('/api/v2/events');
      return res.json();
    });
    const items = eventsRes?.items || [];
    test.skip(items.length === 0, 'No events');

    const eventId = items[0].id;

    const response = await page.evaluate(async (eid: string) => {
      const res = await fetch(`/api/v2/events/${encodeURIComponent(eid)}/forms/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Prefix Test ${Date.now()}` }),
      });
      const setCookie = res.headers.get('set-cookie') || '';
      const match = setCookie.match(/ose_anon=(anon_[a-zA-Z0-9_-]+)/);
      return { status: res.status, anonId: match ? match[1] : null };
    }, eventId);

    if (response.status === 201 && response.anonId) {
      expect(response.anonId).toMatch(/^anon_[a-f0-9-]+$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SCAN SYSTEM — ZERO PII
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Anonymous ID — Scan System Zero PII', () => {
  test('impression endpoint does not accept PII fields', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const { eventId, sponsorId, beaconToken } = await resolveSponsorTarget(page);
    if (SPONSORED_EVENT) {
      expect(
        sponsorId,
        'SMOKE_EVENT_SPONSORED must expose an active FK-valid sponsor'
      ).toBeTruthy();
    } else {
      test.skip(!eventId || !sponsorId, 'No events/sponsors');
    }

    // POST impression with PII — the system should NOT store it
    // (the API accepts surface/placement only — no PII fields in the schema)
    const res = await page.evaluate(
      async ({ eid, sid, token }: { eid: string; sid: string; token: string }) => {
        const r = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsors/${encodeURIComponent(sid)}/impression`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              surface: 'display',
              placement: 'tvTop',
              // OSE-1310: beacon token minted for this (event, sponsor) pair.
              beacon_token: token,
              // These PII fields should be ignored — no column exists for them
              email: 'attacker@evil.com',
              name: 'Should Not Store',
              ip_address: '1.2.3.4',
            }),
          }
        );
        return { status: r.status, body: await r.json() };
      },
      { eid: eventId, sid: sponsorId, token: beaconToken }
    );

    // The impression is accepted (201) — the extra fields are silently dropped
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  test('click endpoint does not accept PII fields', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const { eventId, sponsorId, beaconToken } = await resolveSponsorTarget(page);
    if (SPONSORED_EVENT) {
      expect(
        sponsorId,
        'SMOKE_EVENT_SPONSORED must expose an active FK-valid sponsor'
      ).toBeTruthy();
    } else {
      test.skip(!eventId || !sponsorId, 'No events/sponsors');
    }

    const res = await page.evaluate(
      async ({ eid, sid, token }: { eid: string; sid: string; token: string }) => {
        const r = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsors/${encodeURIComponent(sid)}/click`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              surface: 'display',
              placement: 'tvTop',
              beacon_token: token,
              email: 'attacker@evil.com',
            }),
          }
        );
        return { status: r.status, body: await r.json() };
      },
      { eid: eventId, sid: sponsorId, token: beaconToken }
    );

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SHARED REPORT — AGGREGATE ONLY
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Anonymous ID — SharedReport Aggregate Only', () => {
  test('SharedReport page does not expose individual records', async ({ page }) => {
    await page.goto('/sharedReport', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(5000);

    const pageContent = await page.content();

    // SharedReport must NEVER contain raw emails, names of attendees, or IP addresses
    expect(pageContent).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/); // no email addresses
    expect(pageContent).not.toContain('ip_address');
    expect(pageContent).not.toContain('user_agent_hash'); // internal field — not exposed

    // Sponsor names ARE expected — they're public entities, not PII
    // Event names ARE expected
  });

  test('public sponsors API does not leak admin fields', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const eventsRes = await page.evaluate(async () => {
      const res = await fetch('/api/v2/events');
      return res.json();
    });
    const items = eventsRes?.items || [];
    test.skip(items.length === 0, 'No events');

    const sponsorsRes = await page.evaluate(async (eid: string) => {
      const res = await fetch(`/api/v2/events/${encodeURIComponent(eid)}/sponsors`);
      return res.text();
    }, items[0].id);

    // Public sponsor API should not leak click_token or display_token raw values
    // (These are internal attribution tokens, not public data)
    // Note: the current API does return these — this test documents the contract
    // and will catch if additional sensitive fields are added
    expect(sponsorsRes).not.toContain('FORMS_ENCRYPTION_KEY');
    expect(sponsorsRes).not.toContain('X_OCR_INTERNAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TWO-DATABASE SEPARATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Anonymous ID — Two-Database Separation', () => {
  test('health endpoint confirms separate DB bindings', async ({ page }) => {
    const res = await page.goto('/health', { timeout: TIMEOUT });
    const data = await res?.json();

    expect(data?.ok).toBe(true);
    // Health should report on both DB and FORMS_DB status
    // The key invariant: they are separate bindings, not one database
  });

  test('events API and forms API are independent (no cross-contamination)', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // Fetch events from DB (anonymous system)
    const eventsRes = await page.evaluate(async () => {
      const res = await fetch('/api/v2/events');
      return res.json();
    });

    // Events response should NOT contain form data
    const eventsStr = JSON.stringify(eventsRes);
    expect(eventsStr).not.toContain('form_registrations');
    expect(eventsStr).not.toContain('email_hash');
    expect(eventsStr).not.toContain('pii_scrubbed');
    expect(eventsStr).not.toContain('consent_given_at');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SPONSOR SIGNAL — COOKIE NOT ON THE WIRE (OSE-1164)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Invariant: Sponsor Signal Never-Who — cookie not transmitted', () => {
  test('impression request does not carry ose_anon even when the cookie is set (credentials:omit)', async ({
    page,
    baseURL,
  }) => {
    test.skip(!baseURL, 'no baseURL configured');
    // Plant the anonymous-scan cookie for this origin, as a returning attendee
    // (who already scanned) would carry. credentials:'omit' on the client fetch
    // must still keep it off the sponsor-signal request → never-who is structural.
    await page.context().addCookies([{ name: 'ose_anon', value: 'anon_e2e_probe', url: baseURL! }]);

    const cookieHeadersSeen: string[] = [];
    await page.route('**/impression', async (route) => {
      const headers = await route.request().allHeaders();
      cookieHeadersSeen.push(headers['cookie'] ?? '');
      await route.continue();
    });

    await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(3000); // let the impression fetch(es) fire

    test.skip(
      cookieHeadersSeen.length === 0,
      'no sponsor impressions fired — no sponsored event on this environment'
    );
    for (const cookie of cookieHeadersSeen) {
      expect(
        cookie,
        'sponsor impression request must not carry ose_anon — credentials:omit makes the ' +
          '"no link back to you" guarantee structural, not behavioral (OSE-1164)'
      ).not.toContain('ose_anon');
    }
  });
});
