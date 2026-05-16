/**
 * OSE-312 / OSE-307 — /sharedReport signed-link mode (OSE-R-003) flow.
 *
 * The SharedReport surface has two modes:
 *   - admin mode (no query params): renders the multi-event dashboard
 *     — BLOCKED on OSE-302 admin bearer
 *   - signed-link mode (?eventId=...&token=...): renders a single
 *     event's report for a bar owner who got an emailed signed link
 *     — UNAUTH-flow-testable with any valid eventId + token shape
 *
 * This spec covers the signed-link mode at 375x812 (real bar owners
 * open these links on their phone). Validates the FLOW SHAPE without
 * needing a valid token:
 *
 *   1. Loading the URL with eventId+token activates signed-link mode
 *      (admin sections hide; signed-link section shows)
 *   2. Invalid/bad token → API returns 401 → page renders the
 *      OSE-R-002 friendly error message ("This share link has expired
 *      or isn't valid. Ask the sender for a fresh link.")
 *   3. The error state is mobile-clean at 375x812
 *   4. The error preserves data-error-code on the error element for
 *      support tooling (without leaking it to user-visible text)
 *
 * What this spec does NOT cover (deferred):
 *   - Happy-path render (requires valid signed-link token; needs
 *     founder to provide a sample token OR a test-token-mint endpoint)
 *   - Sponsor impressions / poster attribution / headcount trend
 *     tables (only render with valid data)
 *   - Admin mode rendering (BLOCKED on OSE-302)
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-312 | FE | flow sharedreport-signed-link | <assertion>`.
 */

import { test, expect } from '@playwright/test';
import { loadAndSettle, assertMobileWorkable } from './_helpers/mobile-workability-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

const TEST_EVENT_ID = 'test-event-001';
const INVALID_TOKEN = 'e2e-test-invalid-token-' + Date.now();
const SIGNED_LINK_URL = `${BASE_URL}/sharedReport?eventId=${TEST_EVENT_ID}&token=${INVALID_TOKEN}`;

test.describe('OSE-312 /sharedReport signed-link mode (OSE-R-003)', () => {
  test('OSE-312 | FE | flow sharedreport-signed-link | loading URL with eventId+token activates signed-link mode (admin sections hidden)', async ({
    page,
  }) => {
    await loadAndSettle(page, SIGNED_LINK_URL);
    // Admin sections — the multi-event dashboard pieces — must be
    // hidden when signed-link mode is active. Per pages.ts the JS
    // sets `el.hidden = true` on these IDs:
    //   admin-action-bar, admin-section-stats, admin-section-events,
    //   report-sponsor-section, advanced-metrics-section
    for (const id of ['admin-action-bar', 'admin-section-stats', 'admin-section-events']) {
      const adminSection = page.locator(`#${id}`);
      // After signed-link mode activates, these should not be visible
      // to the user (either hidden attribute set OR display:none).
      const isVisible = await adminSection.isVisible().catch(() => false);
      expect(
        isVisible,
        `#${id} still visible in signed-link mode — admin sections should be hidden when ?eventId+&token are present`
      ).toBe(false);
    }
  });

  test('OSE-312 | FE | flow sharedreport-signed-link | signed-link-section unhides for the report content', async ({
    page,
  }) => {
    await loadAndSettle(page, SIGNED_LINK_URL);
    // The signed-link section (#signed-link-section) starts `hidden`
    // by default; the JS removes the attribute when signed-link mode
    // activates so the section can render content (or error state).
    await expect(
      page.locator('#signed-link-section'),
      'signed-link-section never unhid — signed-link mode JS may not have fired'
    ).toBeVisible({ timeout: 5000 });
  });

  test('OSE-312 | FE | flow sharedreport-signed-link | invalid token → friendly OSE-R-002 error renders (no jargon leak)', async ({
    page,
  }) => {
    await loadAndSettle(page, SIGNED_LINK_URL);
    // The API returns 401 for an unknown token. The page maps that
    // to the UNAUTHORIZED friendly copy per SHARED_REPORT_ERROR_COPY:
    //   "This share link has expired or isn't valid. Ask the sender
    //    for a fresh link."
    const errorEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errorEl, 'signed-link-error element never visible').toBeVisible({
      timeout: 5000,
    });
    const errorText = (await errorEl.textContent())?.trim() ?? '';
    expect(errorText.length, 'signed-link-error visible but empty').toBeGreaterThan(0);
    // Friendly-copy guard: must NOT leak raw error codes or HTTP
    // status numbers to user-visible text.
    expect(errorText, 'error text leaks raw code').not.toMatch(
      /UNAUTHORIZED|HTTP_4\d{2}|NOT_FOUND/
    );
    expect(errorText, 'error text leaks HTTP status digits').not.toMatch(/\b4\d{2}\b/);
  });

  test('OSE-312 | FE | flow sharedreport-signed-link | data-error-code preserved on element (support-tool readable, not user-visible)', async ({
    page,
  }) => {
    await loadAndSettle(page, SIGNED_LINK_URL);
    const errorEl = page.locator('[data-testid="signed-link-error"]');
    await expect(errorEl).toBeVisible({ timeout: 5000 });
    const code = await errorEl.getAttribute('data-error-code');
    expect(
      code,
      'data-error-code attribute missing — support tooling needs it to triage user reports'
    ).toBeTruthy();
    // Per pages.ts: code is set to body.code OR `HTTP_<status>` fallback.
    // For an unknown token the server returns 401 → either 'UNAUTHORIZED'
    // OR 'HTTP_401'. Either is acceptable.
    expect(code).toMatch(/UNAUTHORIZED|HTTP_4\d{2}|FORBIDDEN|NOT_FOUND/);
  });

  test('OSE-312 | FE | flow sharedreport-signed-link | error state is mobile-clean at 375x812', async ({
    page,
  }) => {
    await loadAndSettle(page, SIGNED_LINK_URL);
    // Wait for the signed-link section to render before measuring
    // mobile workability (otherwise we'd measure the loading
    // placeholder state, not the steady-state error UI).
    await expect(page.locator('[data-testid="signed-link-error"]')).toBeVisible({ timeout: 5000 });
    await assertMobileWorkable(page, '/sharedReport (signed-link error state)', {
      // The signed-link error UI doesn't have a primary CTA — the
      // recovery action is "ask the sender for a fresh link" which
      // isn't a clickable element. Skip the CTA assertion.
    });
  });
});
