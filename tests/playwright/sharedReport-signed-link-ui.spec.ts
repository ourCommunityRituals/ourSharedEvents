/**
 * OSE-R-003 — Playwright FE for the /sharedReport signed-link UI.
 *
 * Layer: FE (real browser opens the SharedReport page with the share-link
 * URL shape, intercepts the OSE-272 Session 5 API call, and verifies the
 * rendered DOM — content on success, friendly copy on errors).
 *
 * Companion to:
 *   - workers/oursharedevents/tests/sharedReport-signed-link-ui.spec.ts (vitest API)
 *   - postman/collections/ose-api.json (Newman API — OSE-R-003 folder)
 *
 * Test names share their shape byte-for-byte across runners where the
 * scenario maps; differ only by the API/FE qualifier where the layer
 * differs.
 *
 * Backstop: The Session 5 SharedReport feature shipped a signed-link API
 * but no customer surface (audit REFINEMENT-BACKLOG-2026-05-15.md
 * OSE-R-003). This spec uses Playwright route interception so we don't
 * need a real signed token + real materialized event — we own the wire
 * response and verify the page wires up correctly.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const TEST_EVENT_ID = 'evt_test_2026';
const TEST_TOKEN = 'sig.test.token.value';

interface SharedReportFixture {
  event_id: string;
  event_title: string;
  event_start_date: string;
  event_end_date: string | null;
  unique_gatherings: number | null;
  return_rate: {
    venue_pct: number | null;
    corridor_pct: number | null;
    sample_size: number | null;
  };
  corridor_density: {
    this_event_count: number | null;
    baseline_30d: number | null;
    baseline_90d: number | null;
    density_ratio_30d: number | null;
    density_ratio_90d: number | null;
  };
  sponsor_impressions: Array<{
    sponsor_id: string;
    sponsor_name: string;
    surface: string;
    count: number;
  }>;
  poster_attribution: Array<{
    poster_deployment_id: string;
    location: string;
    scan_count: number;
    first_scan_at: string;
    last_scan_at: string;
  }>;
  headcount_trend: {
    series_id: string | null;
    series_name: string | null;
    instances: Array<{
      event_id: string;
      start_date: string;
      unique_gatherings: number | null;
    }>;
  };
  _meta: {
    materialized_at: string | null;
    suppression_reasons: Array<{ field: string; reason: string; detail?: string }>;
  };
}

function makeReportFixture(overrides: Partial<SharedReportFixture> = {}): SharedReportFixture {
  return {
    event_id: TEST_EVENT_ID,
    event_title: 'Empty Bottle — Thursday Jazz',
    event_start_date: '2026-05-14T20:00:00Z',
    event_end_date: '2026-05-14T23:30:00Z',
    unique_gatherings: 84,
    return_rate: { venue_pct: 31.4, corridor_pct: 19.2, sample_size: 84 },
    corridor_density: {
      this_event_count: 84,
      baseline_30d: 62,
      baseline_90d: 71,
      density_ratio_30d: 1.35,
      density_ratio_90d: 1.18,
    },
    sponsor_impressions: [
      {
        sponsor_id: 'sp_1',
        sponsor_name: 'Reckless Records',
        surface: 'poster',
        count: 42,
      },
      {
        sponsor_id: 'sp_2',
        sponsor_name: 'Half Acre',
        surface: 'tabletop',
        count: 18,
      },
    ],
    poster_attribution: [
      {
        poster_deployment_id: 'pd_1',
        location: 'Wicker Park — N Damen & W Milwaukee',
        scan_count: 27,
        first_scan_at: '2026-05-13T19:14:00Z',
        last_scan_at: '2026-05-14T21:02:00Z',
      },
    ],
    headcount_trend: {
      series_id: 'srs_1',
      series_name: 'Thursday Jazz',
      instances: [
        { event_id: 'evt_test_2024', start_date: '2026-05-07T20:00:00Z', unique_gatherings: 64 },
        { event_id: 'evt_test_2025', start_date: '2026-04-30T20:00:00Z', unique_gatherings: 71 },
        { event_id: TEST_EVENT_ID, start_date: '2026-05-14T20:00:00Z', unique_gatherings: 84 },
      ],
    },
    _meta: {
      materialized_at: '2026-05-15T03:14:00Z',
      suppression_reasons: [],
    },
    ...overrides,
  };
}

async function loadSharedReportWithMockedResponse(
  page: Page,
  responseShape: { status: number; body: unknown; contentType?: string }
): Promise<void> {
  await page.route(`**/api/v2/events/${TEST_EVENT_ID}/shared-report`, async (route) => {
    await route.fulfill({
      status: responseShape.status,
      contentType: responseShape.contentType ?? 'application/json',
      body:
        typeof responseShape.body === 'string'
          ? responseShape.body
          : JSON.stringify(responseShape.body),
    });
  });
  await page.goto(
    `${BASE_URL}/sharedReport?eventId=${TEST_EVENT_ID}&token=${encodeURIComponent(TEST_TOKEN)}`,
    { waitUntil: 'domcontentloaded' }
  );
}

test.describe('OSE-R-003 — signed-link SharedReport page in browser', () => {
  test('OSE-R-003 | FE | GET /sharedReport (signed-link with valid token) | renders the event title, unique gatherings, and return rate', async ({
    page,
  }) => {
    await loadSharedReportWithMockedResponse(page, {
      status: 200,
      body: { ok: true, report: makeReportFixture() },
    });

    await expect(page.locator('[data-testid="signed-link-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="signed-link-event-title"]')).toHaveText(
      /Empty Bottle/
    );
    await expect(page.locator('[data-testid="signed-link-unique-gatherings"]')).toContainText('84');
    await expect(page.locator('[data-testid="signed-link-return-rate"]')).toContainText('31.4%');
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link with valid token) | admin sections are hidden so the page shows ONLY the customer report', async ({
    page,
  }) => {
    await loadSharedReportWithMockedResponse(page, {
      status: 200,
      body: { ok: true, report: makeReportFixture() },
    });

    // Admin dashboard sections must NOT be visible — the customer is on
    // their signed-link share view, not the multi-event admin dashboard.
    for (const id of [
      'admin-action-bar',
      'admin-section-stats',
      'admin-section-events',
      'report-sponsor-section',
      'advanced-metrics-section',
    ]) {
      await expect(page.locator(`#${id}`)).toBeHidden();
    }
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link with valid token) | admin endpoints are NOT called when signed-link mode is active', async ({
    page,
  }) => {
    // Defensive: a signed-link visitor must never trigger admin-endpoint
    // fetches from the page (would either 401 in their face or, worse,
    // succeed if they're logged in as admin and leak unrelated event data).
    const adminCalls: string[] = [];
    await page.route('**/api/v2/events', async (route) => {
      adminCalls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true,"items":[]}',
      });
    });
    await page.route('**/api/v2/admin/**', async (route) => {
      adminCalls.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await loadSharedReportWithMockedResponse(page, {
      status: 200,
      body: { ok: true, report: makeReportFixture() },
    });
    // Give any straggler async fetches a beat to fire.
    await page.waitForTimeout(250);

    expect(
      adminCalls,
      `signed-link visit must not trigger admin endpoints, but got: ${adminCalls.join(', ')}`
    ).toHaveLength(0);
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link, server returns UNAUTHORIZED) | renders friendly "share link expired" copy', async ({
    page,
  }) => {
    await loadSharedReportWithMockedResponse(page, {
      status: 401,
      body: { ok: false, code: 'UNAUTHORIZED', error: 'invalid or expired token' },
    });

    const errEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/share link has expired|isn.t valid|fresh link/i);
    // Raw server strings must NOT reach the user.
    expect(text).not.toMatch(/UNAUTHORIZED/);
    expect(text).not.toMatch(/invalid or expired token/);
    // But the code IS preserved for support visibility.
    await expect(errEl).toHaveAttribute('data-error-code', 'UNAUTHORIZED');
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link, server returns FORBIDDEN) | renders friendly "different event" copy', async ({
    page,
  }) => {
    await loadSharedReportWithMockedResponse(page, {
      status: 403,
      body: {
        ok: false,
        code: 'FORBIDDEN',
        error: 'token event_id claim does not match path :id',
      },
    });

    const errEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/different event/i);
    expect(text).not.toMatch(/FORBIDDEN/);
    expect(text).not.toMatch(/event_id claim/);
    await expect(errEl).toHaveAttribute('data-error-code', 'FORBIDDEN');
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link, server returns NOT_FOUND) | renders friendly "couldn\'t find that event" copy', async ({
    page,
  }) => {
    await loadSharedReportWithMockedResponse(page, {
      status: 404,
      body: { ok: false, code: 'NOT_FOUND' },
    });

    const errEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/couldn.t find that event report/i);
    expect(text).not.toMatch(/NOT_FOUND/);
    await expect(errEl).toHaveAttribute('data-error-code', 'NOT_FOUND');
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link, server returns MATERIALIZATION_PENDING) | renders friendly "almost ready, refresh in a moment" copy', async ({
    page,
  }) => {
    // The most jargon-leaking pre-fix error: the API said "event exists but
    // has no materialized signal yet; retry after next cron tick". OSE-R-049
    // polish item lives inside this fix — the page now substitutes friendly
    // copy and the raw phrase never reaches the bar owner.
    await loadSharedReportWithMockedResponse(page, {
      status: 409,
      body: {
        ok: false,
        code: 'MATERIALIZATION_PENDING',
        error: 'event exists but has no materialized signal yet; retry after next cron tick',
      },
    });

    const errEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/almost ready|few minutes|refresh in a moment/i);
    // Dev jargon must NEVER appear.
    expect(text).not.toMatch(/materialized signal/);
    expect(text).not.toMatch(/cron tick/);
    expect(text).not.toMatch(/MATERIALIZATION_PENDING/);
    await expect(errEl).toHaveAttribute('data-error-code', 'MATERIALIZATION_PENDING');
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link, server returns unknown code) | renders generic friendly fallback', async ({
    page,
  }) => {
    await loadSharedReportWithMockedResponse(page, {
      status: 400,
      body: {
        ok: false,
        code: 'BRAND_NEW_FUTURE_CODE',
        error: "some new server-side state that hasn't been mapped",
      },
    });

    const errEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/something went wrong|try again/i);
    expect(text).not.toMatch(/BRAND_NEW_FUTURE_CODE/);
    expect(text).not.toMatch(/hasn.t been mapped/);
    // Code preserved for support.
    await expect(errEl).toHaveAttribute('data-error-code', 'BRAND_NEW_FUTURE_CODE');
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link, network failure) | renders generic friendly fallback with NETWORK_ERROR support code', async ({
    page,
  }) => {
    await page.route(`**/api/v2/events/${TEST_EVENT_ID}/shared-report`, async (route) => {
      await route.abort('failed');
    });
    await page.goto(
      `${BASE_URL}/sharedReport?eventId=${TEST_EVENT_ID}&token=${encodeURIComponent(TEST_TOKEN)}`,
      { waitUntil: 'domcontentloaded' }
    );

    const errEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/couldn.t reach|check your connection|try again/i);
    await expect(errEl).toHaveAttribute('data-error-code', 'NETWORK_ERROR');
  });

  test('OSE-R-003 | FE | GET /sharedReport (signed-link, server returns non-JSON 502) | renders generic friendly fallback with NON_JSON_RESPONSE support code', async ({
    page,
  }) => {
    await loadSharedReportWithMockedResponse(page, {
      status: 502,
      body: '<html><body>Bad Gateway</body></html>',
      contentType: 'text/html',
    });

    const errEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/having trouble reaching|try again/i);
    // The HTML gateway response must NOT reach the user.
    expect(text).not.toMatch(/Bad Gateway/);
    await expect(errEl).toHaveAttribute('data-error-code', 'NON_JSON_RESPONSE');
  });

  test('OSE-R-003 | FE | GET /sharedReport (no signed-link params) | falls back to admin dashboard behavior (signed-link section stays hidden)', async ({
    page,
  }) => {
    // A user landing on bare /sharedReport (the admin dashboard URL) MUST
    // see the admin sections, NOT the signed-link section. Critical for
    // back-compat: the page existed before signed-link mode shipped.
    await page.goto(`${BASE_URL}/sharedReport`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-testid="signed-link-section"]')).toBeHidden();
    await expect(page.locator('[data-testid="signed-link-error"]')).toBeHidden();
    // The admin events list is the section the user expects to see on the
    // bare /sharedReport URL — it remains present in the DOM.
    await expect(page.locator('#events-list')).toBeAttached();
  });
});
