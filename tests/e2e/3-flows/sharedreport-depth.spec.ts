/**
 * SharedReport depth gate — E2E contract tests (S-3.3.2)
 *
 * Exercises the /api/v2/events/:id/shared-report endpoint with tokens of
 * different roles and depth claims. Confirms:
 *   - Auth boundaries (no token → 401, wrong-event token → 403)
 *   - Admin/bar_owner always receives premium depth
 *   - LOCAL sponsor: limited sections + upgrade hint + slice isolation
 *   - MID sponsor: correct sections
 *   - Live equity check: no tier vocabulary leaks from collection path
 *
 * Fixture env vars (seeded by CI before T4 Functional runs):
 *   SMOKE_EVENT_POST            — event ID of a post-event fixture
 *   SMOKE_RPT_ADMIN_TOKEN       — mintSignedLinkToken(eventId, 'admin')
 *   SMOKE_RPT_LOCAL_TOKEN       — mintSignedLinkToken(eventId, 'sponsor', depth:'local', sponsor_id:'sp_test')
 *   SMOKE_RPT_MID_TOKEN         — mintSignedLinkToken(eventId, 'sponsor', depth:'mid')
 *   SMOKE_RPT_OTHER_EVENT_TOKEN — token scoped to a different event ID
 *
 * All tests skip cleanly when tokens are absent (pre-seeding CI runs).
 *
 * File: tests/e2e/3-flows/sharedreport-depth.spec.ts
 */

import { test, expect } from '@playwright/test';

const POST = process.env.SMOKE_EVENT_POST;
const ADMIN_TOKEN = process.env.SMOKE_RPT_ADMIN_TOKEN;
const LOCAL_TOKEN = process.env.SMOKE_RPT_LOCAL_TOKEN;
const MID_TOKEN = process.env.SMOKE_RPT_MID_TOKEN;
const OTHER_TOKEN = process.env.SMOKE_RPT_OTHER_EVENT_TOKEN;

const BASE = process.env.BASE_URL ?? '';

function reportUrl(eventId: string) {
  return `${BASE}/api/v2/events/${eventId}/shared-report`;
}

async function fetchReport(
  request: import('@playwright/test').APIRequestContext,
  eventId: string,
  token: string
) {
  return request.get(reportUrl(eventId), {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test.describe('SharedReport depth gate', () => {
  test('no token → 401', async ({ request }) => {
    test.skip(!POST, 'SMOKE_EVENT_POST not seeded');
    const res = await request.get(reportUrl(POST!));
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  test('wrong-event token → 403', async ({ request }) => {
    test.skip(!POST || !OTHER_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, OTHER_TOKEN!);
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('FORBIDDEN');
  });

  test('admin token → premium depth, all sections present', async ({ request }) => {
    test.skip(!POST || !ADMIN_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, ADMIN_TOKEN!);
    expect(res.status()).toBe(200);
    // Read with a signed link, so the browser is told not to keep a copy.
    expect(res.headers()['cache-control']).toBe('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Depth is expressed by section presence, not a top-level label — the wire
    // contract (ADR-017 / REPORT-DEPTH.md) has no `body.depth`. Premium = every
    // section present, including the two above Mid.
    const report = body.report as Record<string, unknown>;
    expect('event_id' in report).toBe(true);
    expect('unique_gatherings' in report).toBe(true);
    // corridor_map key present at premium (value may be null if no h3 data).
    expect('corridor_map' in report).toBe(true);
    // headcount_trend is the genuinely premium-only section — present here.
    expect('headcount_trend' in report).toBe(true);
    // No upgrade hint at premium: nothing is withheld (upgrade lives at
    // report.upgrade and is omitted entirely for premium/admin/bar_owner).
    expect('upgrade' in report).toBe(false);
  });

  test('LOCAL sponsor token → limited sections + upgrade hint', async ({ request }) => {
    test.skip(!POST || !LOCAL_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, LOCAL_TOKEN!);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const report = body.report as Record<string, unknown>;
    // Local depth = the Mid+ sections are omitted (depth by omission, not a label).
    expect('campaign_summary' in report).toBe(false);
    expect('poster_attribution' in report).toBe(false);
    expect('return_rate' in report).toBe(false);
    expect('corridor_map' in report).toBe(false);
    expect('headcount_trend' in report).toBe(false);
    // The refusal is printed on the wire at report.upgrade (ADR-017), pointing
    // one rung up to 'mid'.
    const upgrade = report.upgrade as { next_depth?: string; locked_sections?: unknown };
    expect(upgrade).toBeDefined();
    expect(upgrade.next_depth).toBe('mid');
    expect(Array.isArray(upgrade.locked_sections)).toBe(true);
  });

  test('LOCAL sponsor token → sponsor slice isolated (no cross-contamination)', async ({
    request,
  }) => {
    test.skip(!POST || !LOCAL_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, LOCAL_TOKEN!);
    const body = await res.json();
    const impressions = body.report?.sponsor_impressions;
    if (Array.isArray(impressions) && impressions.length > 0) {
      // Every row must belong to the token's sponsor_id claim
      const ids = new Set(impressions.map((r: { sponsor_id: string }) => r.sponsor_id));
      expect(ids.size).toBe(1);
      // The slice must be isolated to the token's OWN sponsor. OSE-1389 mints the
      // token per-run against a real seeded sponsor and exports its id as
      // SMOKE_RPT_SPONSOR_ID; the legacy static token defaulted to 'sp_test'.
      const expectedSponsor = process.env.SMOKE_RPT_SPONSOR_ID ?? 'sp_test';
      expect(ids.has(expectedSponsor)).toBe(true);
    }
  });

  test('MID sponsor token → mid sections visible, premium absent', async ({ request }) => {
    test.skip(!POST || !MID_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, MID_TOKEN!);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const report = body.report as Record<string, unknown>;
    // Mid depth = the Mid sections are present (corridor_map is a MID section —
    // the paid value line, OSE-682 — NOT premium-only), and the single
    // premium-only section (headcount_trend) is omitted.
    expect('corridor_map' in report).toBe(true);
    expect('campaign_summary' in report).toBe(true);
    expect('headcount_trend' in report).toBe(false);
    // Below premium → the refusal is printed at report.upgrade, next rung 'premium'.
    const upgrade = report.upgrade as { next_depth?: string } | undefined;
    expect(upgrade).toBeDefined();
    expect(upgrade?.next_depth).toBe('premium');
  });

  test('LOCAL sponsor token → no corridor_map section (Mid+ delivery gate)', async ({
    request,
  }) => {
    test.skip(!POST || !LOCAL_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, LOCAL_TOKEN!);
    const body = await res.json();
    const report = body.report as Record<string, unknown>;
    // The corridor_map *section* is the paid value line — delivered at Mid+
    // (OSE-682), so it is omitted at local depth (below mid). This gates the
    // DELIVERED section only; the base h3 substrate the whole report is built
    // from stays universal and tier-blind (ADR-017 / invariant #5).
    expect('corridor_map' in report).toBe(false);
    // Sanity: no SVG corridor map markup leaking in the JSON text
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/corridor-map/);
    expect(text).not.toMatch(/hex-cell/);
  });

  test('MID sponsor token → no headcount_trend (the premium-only section)', async ({ request }) => {
    test.skip(!POST || !MID_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, MID_TOKEN!);
    const body = await res.json();
    const report = body.report as Record<string, unknown>;
    // headcount_trend (cross-event) is the ONLY genuinely premium-only section —
    // withheld at mid. corridor_map is a Mid section and IS present here (asserted
    // in the mid-sections test above); do not confuse the two.
    expect('headcount_trend' in report).toBe(false);
    expect('corridor_map' in report).toBe(true);
  });

  test('live equity check: response shape never exposes raw tier vocabulary', async ({
    request,
  }) => {
    test.skip(!POST || !ADMIN_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, ADMIN_TOKEN!);
    const text = await res.text();
    // The response JSON must not leak ingest-path tier fields
    expect(text).not.toMatch(/"sponsor_tier"/);
    expect(text).not.toMatch(/"flag_tier"/);
    // depth is a valid field, but 'free'/'mid'/'enterprise' are flag-tier vocab — not depth vocab
    expect(text).not.toMatch(/"free"|"enterprise"/);
  });
});
