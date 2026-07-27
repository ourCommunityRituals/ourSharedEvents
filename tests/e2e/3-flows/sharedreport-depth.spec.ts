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
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.depth).toBe('premium');
    // Premium sections must all be present (if materialized)
    const report = body.report as Record<string, unknown>;
    expect('event_id' in report).toBe(true);
    expect('unique_gatherings' in report).toBe(true);
    // No upgrade hint at premium
    expect('upgrade' in body).toBe(false);
  });

  test('LOCAL sponsor token → limited sections + upgrade hint', async ({ request }) => {
    test.skip(!POST || !LOCAL_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, LOCAL_TOKEN!);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.depth).toBe('local');
    const report = body.report as Record<string, unknown>;
    // Mid-only sections must be absent
    expect('poster_attribution' in report).toBe(false);
    expect('return_rate' in report).toBe(false);
    expect('headcount_trend' in report).toBe(false);
    // Upgrade hint must point to 'mid'
    expect(body.upgrade).toBeDefined();
    expect(body.upgrade.next_depth).toBe('mid');
    expect(Array.isArray(body.upgrade.locked_sections)).toBe(true);
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
      // The fixture token was minted with sponsor_id='sp_test'
      expect(ids.has('sp_test')).toBe(true);
    }
  });

  test('MID sponsor token → mid sections visible, premium absent', async ({ request }) => {
    test.skip(!POST || !MID_TOKEN, 'fixtures not seeded');
    const res = await fetchReport(request, POST!, MID_TOKEN!);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.depth).toBe('mid');
    const report = body.report as Record<string, unknown>;
    expect('poster_attribution' in report || 'return_rate' in report).toBe(true);
    expect('headcount_trend' in report).toBe(false);
    if (body.upgrade) {
      expect(body.upgrade.next_depth).toBe('premium');
    }
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
