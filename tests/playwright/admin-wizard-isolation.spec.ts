/**
 * The launch wizard owns the screen while it is open (OSE-1237).
 *
 * REPORTED FROM A PHONE, 2026-09-05
 *   "the wizard mode renders first, but the advanced admin screen continues to
 *   display underneath."
 *
 * Measured on a 375×812 viewport with the wizard open:
 *
 *   document height          4748px  (~6 screens)
 *   advanced create form     visible, at y=640
 *   Forms card (Card 2)      visible, 560px
 *   Poster Deployments (3)   visible, 547px
 *   Sponsors                 visible, 587px
 *   Surface cards            visible, 596px
 *
 * The path chooser asks the operator to pick guided or advanced. Rendering
 * both afterwards makes the question pointless and the answer ambiguous —
 * scrolling past the wizard drops you into a SECOND create form for the same
 * event. On a phone there is no visual cue that you have left the wizard.
 *
 * WHY THIS SPEC AND NOT A UNIT TEST
 *   The defect is a stacking/visibility fact, so it only exists once CSS,
 *   the class toggle and the DOM are all applied together. A source grep would
 *   have passed against the half-fix below.
 *
 * THE HALF-FIX THIS GUARDS AGAINST
 *   The first fix scoped the rule to `#main-content > *` and looked correct:
 *   the create card and events list disappeared. But FOUR cards — forms,
 *   poster deployments, sponsors, surface cards — are direct children of
 *   <body>, after </main>. 2,290px of dashboard survived, and the wizard state
 *   still measured 3117px. Asserting the page fits ONE viewport is what caught
 *   it; asserting "the create card is hidden" would not have.
 *
 * @born-red OSE-1237 | method: dashboard rendered under the open wizard
 * | date: 2026-09-05
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER ?? '';
const MOBILE = { width: 375, height: 812 };

/** Every advanced-dashboard panel, wherever it sits in the document. */
const DASHBOARD_PANELS = [
  'create-event-card',
  'forms-card',
  'poster-deployments-card',
  'sponsors-card',
  'surface-cards',
] as const;

async function openAdmin(page: Page): Promise<void> {
  await page.setViewportSize(MOBILE);
  if (ADMIN_BEARER) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

/** Rendered height, not `hidden` — the bug was about what a thumb can scroll to. */
async function rendered(page: Page, testid: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return !!el && el.getBoundingClientRect().height > 0;
  }, testid);
}

test.describe('OSE-1237 admin launch wizard — owns the screen', () => {
  test.skip(!ADMIN_BEARER, 'needs OSE_ADMIN_BEARER; the blocking PR gate supplies a local one');

  test('the path chooser is the entry view, and it offers both paths', async ({ page }) => {
    await openAdmin(page);
    await expect(page.locator('[data-testid="admin-path-wizard"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-path-advanced"]')).toBeVisible();
  });

  test('choosing the wizard hides every advanced dashboard panel', async ({ page }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-wizard"]');
    await page.waitForTimeout(400);

    await expect(page.locator('#launch-wizard')).toBeVisible();
    for (const panel of DASHBOARD_PANELS) {
      expect(await rendered(page, panel), `${panel} still rendered under the wizard`).toBe(false);
    }
  });

  // The assertion that caught the half-fix. Panel-by-panel checks passed while
  // 2,290px of out-of-<main> cards were still scrollable.
  test('the wizard state fits one viewport — no dashboard left below it', async ({ page }) => {
    await openAdmin(page);
    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.click('[data-testid="admin-path-wizard"]');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.documentElement.scrollHeight);

    expect(before, 'entry view should be the tall one').toBeGreaterThan(MOBILE.height);
    expect(
      after,
      `wizard state is ${after}px on a ${MOBILE.height}px screen (was ${before}px at entry) — ` +
        `dashboard content is still rendering below the wizard`
    ).toBeLessThanOrEqual(MOBILE.height * 2);
  });

  test('header and legal footer survive — chrome is not dashboard', async ({ page }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-wizard"]');
    await page.waitForTimeout(400);
    await expect(page.locator('header').first()).toBeVisible();
    // OSE-1232: legal has to stay reachable from every surface that carries it.
    await expect(page.locator('[data-testid="admin-footer"]')).toBeVisible();
  });

  test('the aria-live status region stays in the DOM so wizard errors are announced', async ({
    page,
  }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-wizard"]');
    await page.waitForTimeout(400);
    await expect(page.locator('#admin-status')).toHaveCount(1);
  });

  // Reported from a phone: the date field rendered wider than the fields above
  // and below it, breaking the right margin. iOS Safari sizes input[type=date]
  // from its rendered value and centres the text; Chromium does not, so this
  // assertion passes trivially in the blocking gate and exists to stop a future
  // CSS change from re-introducing a per-field width. The Safari-specific
  // remedy (-webkit-appearance:none, min-width:0, text-align:left) could not be
  // verified in-engine here — this container cannot install WebKit.
  test('step 1 fields share one right edge — no field sets its own width', async ({ page }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-wizard"]');
    await page.waitForTimeout(400);

    const edges = await page.evaluate(() =>
      ['wizard-event-name', 'wizard-event-date', 'wizard-event-venue'].map((id) => {
        const el = document.getElementById(id)!;
        const r = el.getBoundingClientRect();
        return { id, right: Math.round(r.right), width: Math.round(r.width) };
      })
    );
    const rights = new Set(edges.map((e) => e.right));
    expect(rights.size, `step-1 inputs do not share a right edge: ${JSON.stringify(edges)}`).toBe(
      1
    );
  });

  test('choosing advanced leaves the dashboard intact', async ({ page }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-advanced"]');
    await page.waitForTimeout(400);

    expect(await rendered(page, 'create-event-card')).toBe(true);
    expect(await rendered(page, 'forms-card')).toBe(true);
    expect(await rendered(page, 'sponsors-card')).toBe(true);
    await expect(page.locator('#launch-wizard')).toBeHidden();
  });
});
