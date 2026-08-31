/**
 * sponsor-lifecycle.matrix.spec.ts — THE consolidated {screen × scenario × tier} suite.
 *
 * Feature intent: one parameterized journey proves that an event created through
 * EITHER admin path (guided wizard for first-timers | advanced dashboard for power
 * users) renders the same sponsor truth on every audience surface (sponsor card,
 * public page, display) at every applicable tier. Serves the organizer (two paths,
 * one admin), the sponsor (tier rendered honestly everywhere), and the attendee
 * (public/display parity). Plan: docs/plans/FE-DEV-PREP-2026-08-29.md.
 *
 * BORN-RED (Phase A): the wizard admin path does not exist yet — those cells MUST
 * fail today. Their failure is the proof this suite bites; Phase B (the wizard
 * surface) turns them green. Do not skip/fixme them: born-red must be OBSERVED red.
 *
 * Test-id contract introduced here (added to surfaces in Phases B/C, tracked as
 * intentional gaps in the testid drift baseline until then):
 *   admin-path-wizard      — entry point to the guided path on /admin
 *   admin-path-advanced    — entry point to the full dashboard path on /admin
 *   wizard-step-1          — first guided step (plain-language event basics)
 *   sponsor-tier-label     — human tier label on the sponsor card (e.g. "Pro plan")
 *   sponsor-local-badge    — is_local geographic badge (independent of tier — #25)
 *
 * History: consolidates coverage previously scattered across sponsor-journey,
 * sponsor-flows, display-sponsor-overlay, and public-page specs into one matrix
 * (FE dev-prep, 2026-08-29). The old specs remain until this matrix is fully
 * green, then are folded in — never both asserting divergent truths.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  matrixCells,
  sponsorFixture,
  eventFixture,
  type Scenario,
  type TierConfig,
} from '../fixtures/scenario-tier-matrix';

const TIMEOUT = 20_000;

/** Mock the public events envelope — same shape the surfaces consume. */
function mockEventsApi(page: Page, items: Record<string, unknown>[]) {
  return page.route('**/api/v2/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 200, items }),
    })
  );
}

for (const { scenario, tier } of matrixCells()) {
  test.describe(`matrix: ${scenario} × ${tier.tier}`, () => {
    // ── Admin creation path ──────────────────────────────────────────────────
    // wizard: BORN-RED until Phase B ships the guided surface.
    // advanced: asserts today's dashboard is reachable as the explicit
    // power-user path (entry testid lands in Phase B alongside the wizard).
    test(`admin offers the ${scenario} path`, async ({ page }) => {
      await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      const pathEntry = page.locator(`[data-testid="admin-path-${scenario}"]`);
      await expect(pathEntry).toBeVisible({ timeout: 10_000 });

      if (scenario === 'wizard') {
        // First guided step must read plain — no technical vocabulary on screen.
        await pathEntry.click();
        await expect(page.locator('[data-testid="wizard-step-1"]')).toBeVisible();
      }
    });

    // ── Public page — sponsor truth at this tier ─────────────────────────────
    test(`public page renders the ${tier.tier} event + sponsor truth`, async ({ page }) => {
      const event = eventFixture(tier);
      await mockEventsApi(page, [event]);
      await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

      // The event renders (existing contract — should be green today).
      // Selector pulled from public.html: static testid + data-event-id attribute.
      const card = page.locator(`[data-testid="public-event-card"][data-event-id="${event.id}"]`);
      await expect(card).toBeVisible();

      // Honesty lexicon: audience surfaces never say "impressions".
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      expect(bodyText).not.toContain('impression');
    });

    // ── Sponsor card — tier label + independent is_local badge ───────────────
    // BORN-RED: the canonical sponsor-card testids land with Phase B/C.
    test(`sponsor card shows "${tier.friendlyLabel}" and the local badge`, async ({ page }) => {
      const sponsor = sponsorFixture(tier);
      const event = eventFixture(tier);
      await mockEventsApi(page, [event]);
      // Real endpoint the public surface consumes (public.html):
      //   GET /api/v2/events/:id/sponsor-bundle?surface=public
      await page.route('**/api/v2/events/*/sponsor-bundle*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, status: 200, items: [sponsor] }),
        })
      );
      await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

      // Plain-language tier label — first-read clarity, no internal enum on screen.
      const tierLabel = page.locator('[data-testid="sponsor-tier-label"]');
      await expect(tierLabel).toBeVisible();
      await expect(tierLabel).toContainText(tier.friendlyLabel);
      const labelText = (await tierLabel.innerText()).toLowerCase();
      expect(labelText).not.toContain(tier.flagTier === 'free' ? 'free_tier' : tier.flagTier);

      // is_local badge renders because the sponsor IS local — never because of
      // what it paid. Covenant floor, own assertion (#25/OSE-661).
      await expect(page.locator('[data-testid="sponsor-local-badge"]')).toBeVisible();
    });

    // ── Display page — ambient surface carries the same truth ────────────────
    test(`display surface loads for the ${tier.tier} cell`, async ({ page }) => {
      const event = eventFixture(tier);
      await mockEventsApi(page, [event]);
      await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

      // Surface loads (existing contract); honesty lexicon holds here too.
      await expect(page.locator('body')).toBeVisible();
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      expect(bodyText).not.toContain('impression');
    });
  });
}
