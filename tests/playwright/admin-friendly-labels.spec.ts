/**
 * OSE-R-005 — Playwright FE for friendly admin tier + phase labels.
 *
 * Layer: FE (real browser opens /admin, signs in via the test bearer
 * cookie/header, and inspects the rendered DOM badges, table, and toasts).
 *
 * Companion to:
 *   - workers/oursharedevents/tests/admin-friendly-labels.spec.ts (vitest API)
 *   - bruno/ose-pages (OSE-R-005 folder)
 *
 * Test names share their shape byte-for-byte across runners where the
 * scenario maps; differ only by the API/FE qualifier where the layer
 * differs.
 *
 * The audit flagged the admin dashboard leaking internal jargon (tier
 * slugs, "Phase N", event IDs) directly to bar-owner customers. This
 * spec verifies the user-visible DOM in a real browser.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || 'test-admin-key-e2e-2026';

async function gotoAdmin(page: Page): Promise<void> {
  // The /admin route is auth-gated. In CI the admin bearer is fed via the
  // OSE_ADMIN_BEARER env var; locally the test-fixture bearer is honored
  // by the worker. Send it as Authorization on the initial request.
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
}

test.describe('OSE-R-005 — friendly admin labels in browser', () => {
  test('OSE-R-005 | FE | GET /admin (authed) | header tier badge shows "Free plan" / "Pro plan" / "Enterprise plan", not raw slug', async ({
    page,
  }) => {
    await gotoAdmin(page);
    const badge = page.locator('[data-testid="tier-badge"]');
    await expect(badge).toBeVisible();
    const text = (await badge.textContent()) ?? '';
    expect(text.trim()).toMatch(/^(Free plan|Pro plan|Enterprise plan)$/);
    // Raw slug must NOT be the visible badge text — but it is preserved on
    // data-tier so support tooling can still read it.
    const dataTier = await badge.getAttribute('data-tier');
    expect(dataTier).toMatch(/^(free|mid|enterprise)$/);
  });

  test('OSE-R-005 | FE | GET /admin (authed) | header phase badge shows friendly event-type label, not "Phase 1"', async ({
    page,
  }) => {
    await gotoAdmin(page);
    const badge = page.locator('[data-testid="phase-badge"]');
    await expect(badge).toBeVisible();
    const text = (await badge.textContent()) ?? '';
    expect(text.trim()).toMatch(
      /^(Community events|Commerce events|Licensed activities|Health events|Youth events)$/
    );
    // Raw phase number preserved as a tooltip + data-phase.
    const title = await badge.getAttribute('title');
    expect(title).toMatch(/^Internal phase [1-5]$/);
  });

  test('OSE-R-005 | FE | GET /admin (authed) | events table ID column is hidden by default', async ({
    page,
  }) => {
    await gotoAdmin(page);
    // Wait for the events table to render. If there are no events, the
    // table won't render — that's a valid empty state, skip the rest.
    const tableLocator = page.locator('table.events-table');
    const tableVisible = await tableLocator.isVisible().catch(() => false);
    test.skip(!tableVisible, 'No events table rendered (empty admin state)');

    const idCell = page.locator('[data-testid="event-id"]').first();
    await expect(idCell).toBeHidden();
  });

  test('OSE-R-005 | FE | GET /admin (authed) | "Show internal IDs" toggle reveals the ID column when checked', async ({
    page,
  }) => {
    await gotoAdmin(page);
    const tableLocator = page.locator('table.events-table');
    const tableVisible = await tableLocator.isVisible().catch(() => false);
    test.skip(!tableVisible, 'No events table rendered (empty admin state)');

    const toggle = page.locator('[data-testid="show-internal-ids-toggle"]');
    await expect(toggle).toBeVisible();
    await toggle.check();
    const idCell = page.locator('[data-testid="event-id"]').first();
    await expect(idCell).toBeVisible();
    await toggle.uncheck();
    await expect(idCell).toBeHidden();
  });

  test('OSE-R-005 | FE | GET /admin (authed) | events table phase column renders friendly labels, not "Phase N"', async ({
    page,
  }) => {
    await gotoAdmin(page);
    const tableLocator = page.locator('table.events-table');
    const tableVisible = await tableLocator.isVisible().catch(() => false);
    test.skip(!tableVisible, 'No events table rendered (empty admin state)');

    const phaseCell = page.locator('[data-testid="event-phase"]').first();
    await expect(phaseCell).toBeVisible();
    const text = (await phaseCell.textContent()) ?? '';
    expect(text.trim()).toMatch(
      /^(Community events|Commerce events|Licensed activities|Health events|Youth events)$/
    );
    expect(text).not.toMatch(/^Phase [1-5]$/);
  });

  test('OSE-R-005 | FE | POST /api/v2/admin/events (success path) | create-event toast does NOT show internal event ID', async ({
    page,
  }) => {
    await gotoAdmin(page);
    // Mock the create-event API so the test doesn't pollute real data and
    // gets a deterministic response.
    await page.route('**/api/v2/admin/events', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, id: 'evt_internal_id_for_support', warnings: [] }),
        });
      } else {
        await route.continue();
      }
    });
    const titleInput = page.locator('[data-testid="create-title"]');
    await titleInput.fill('Test Event for Friendly Toast');
    await page.locator('[data-testid="create-submit"]').click();
    // OSE-1644: with no start time or event type the form asks once; the
    // second press creates the draft.
    await page.locator('[data-testid="create-submit"]').click();

    const msg = page.locator('[data-testid="create-msg"]');
    await expect(msg).toBeVisible();
    const text = (await msg.textContent()) ?? '';
    // Visible toast must NOT contain the internal ID.
    expect(text).not.toMatch(/evt_internal_id_for_support/);
    // Visible toast IS the friendly copy.
    expect(text).toMatch(/event created/i);
    // ID is preserved on a dataset attribute for support tooling.
    await expect(msg).toHaveAttribute('data-event-id', 'evt_internal_id_for_support');
  });
});
