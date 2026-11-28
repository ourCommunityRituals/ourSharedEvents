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
 *   poster deployments, sponsors, surface cards — were direct children of
 *   <body>, after </main>. 2,290px of dashboard survived, and the wizard state
 *   still measured 3117px. Asserting the page fits ONE viewport is what caught
 *   it; asserting "the create card is hidden" would not have.
 *
 *   OSE-1238 has since moved those four inside <main>, so that specific escape
 *   is closed at the source. The one-viewport assertion stays: it is the check
 *   that does not depend on knowing where the next panel will be added.
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

  // OSE-1240: the front door asks WHAT you came to make, not how you want to
  // be walked through it. Two primary paths, plus the full dashboard as a
  // quiet third option rather than a third question.
  test('the front door offers Create Event and Create Sponsor, plus a way to the dashboard', async ({
    page,
  }) => {
    await openAdmin(page);
    await expect(page.locator('[data-testid="admin-path-wizard"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-path-sponsor"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-path-advanced"]')).toBeVisible();
  });

  // The shape the owner described: side by side on a wide screen, stacked on a
  // phone. Asserted as geometry, because "side by side" is a fact about
  // rendered boxes and a CSS grid rule can be right while the result is not.
  test('the two paths sit side by side on a wide screen', async ({ page }) => {
    if (ADMIN_BEARER) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const ev = await page.locator('[data-testid="admin-path-wizard"]').boundingBox();
    const sp = await page.locator('[data-testid="admin-path-sponsor"]').boundingBox();
    expect(ev && sp, 'both paths should render').toBeTruthy();
    expect(Math.round(ev!.y), 'same row').toBe(Math.round(sp!.y));
    // Sponsor first (owner decision 2026-09-05) — the same order the public
    // front door uses, so the two surfaces do not rank the choice differently.
    expect(sp!.x, 'sponsor on the left').toBeLessThan(ev!.x);
    // Neither path is the small one: equal weight is the point of the choice.
    expect(Math.abs(ev!.width - sp!.width)).toBeLessThanOrEqual(2);
  });

  test('the two paths stack on a phone, sponsor first', async ({ page }) => {
    await openAdmin(page); // 375x812
    const ev = await page.locator('[data-testid="admin-path-wizard"]').boundingBox();
    const sp = await page.locator('[data-testid="admin-path-sponsor"]').boundingBox();
    expect(Math.round(ev!.x), 'same column').toBe(Math.round(sp!.x));
    expect(sp!.y, 'sponsor on top — "we always want the sponsors to sign up"').toBeLessThan(ev!.y);
  });

  // Quiet is a visual weight, not a smaller tap target.
  test('the dashboard link stays a 44px target despite being de-emphasised', async ({ page }) => {
    await openAdmin(page);
    const box = await page.locator('[data-testid="admin-path-advanced"]').boundingBox();
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
  });

  test('Create a sponsor lands on the sponsor form, open and focused', async ({ page }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-sponsor"]');
    await page.waitForTimeout(900);

    const state = await page.evaluate(() => ({
      chooserHidden: document.getElementById('admin-path-chooser')!.hidden,
      wizardHidden: document.getElementById('launch-wizard')!.hidden,
      formOpen: !document.getElementById('spon-form-wrap')!.hasAttribute('hidden'),
      focused: document.activeElement?.id,
      cardRendered:
        document.querySelector('[data-testid="sponsors-card"]')!.getBoundingClientRect().height > 0,
    }));

    expect(state.chooserHidden, 'doorway should clear').toBe(true);
    expect(state.wizardHidden, 'the event wizard is not part of this path').toBe(true);
    expect(state.formOpen, 'the sponsor form should be open, not just scrolled to').toBe(true);
    expect(state.cardRendered).toBe(true);
    // Landing someone on a form and making them hunt for the first field is
    // the difference between a path and a signpost.
    expect(state.focused, 'focus should be in the first field').toBe('spon-name');
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
    // The full dashboard is taller than a viewport — that's the content the
    // wizard must not leave scrollable below it. Since the admin now opens on
    // the front-door chooser (dashboard hidden by default), reveal the
    // dashboard first to establish that tall baseline.
    await openAdmin(page);
    await page.click('[data-testid="admin-path-advanced"]');
    await page.waitForTimeout(400);
    const dashboard = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(dashboard, 'the full dashboard should exceed one viewport').toBeGreaterThan(
      MOBILE.height
    );

    // Enter the wizard from a fresh front door; its state must fit ~one viewport
    // with none of that tall dashboard scrollable underneath.
    await openAdmin(page);
    await page.click('[data-testid="admin-path-wizard"]');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.documentElement.scrollHeight);
    // Two screens for the form, plus half of one for the foldable preview that sits
    // below it on a phone (OSE-1528), plus a quarter since the Where step asks for
    // the street address and the ZIP in boxes of their own (W1, OSE-2095: 2,084px at
    // 375x812, over the old 2,030). The dashboard leak this guards is ~15,000px.
    expect(
      after,
      `wizard state is ${after}px on a ${MOBILE.height}px screen (dashboard is ${dashboard}px) — ` +
        `dashboard content is still rendering below the wizard`
    ).toBeLessThanOrEqual(MOBILE.height * 2.75);
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
  test('step 1 fields share their column edges — no field sets its own width', async ({ page }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-wizard"]');
    await page.waitForTimeout(400);

    // Owner 2026-11-27: step 1 packs two boxes to a row (date | time,
    // how | place). The right column shares one edge with the name, and the
    // date box is exactly as wide as the place box: no field sizes itself.
    const edges = await page.evaluate(() =>
      ['wizard-event-name', 'wizard-event-time', 'wizard-event-venue', 'wizard-event-date'].map(
        (id) => {
          const el = document.getElementById(id)!;
          const r = el.getBoundingClientRect();
          return { id, right: Math.round(r.right), width: Math.round(r.width) };
        }
      )
    );
    const rights = new Set(edges.slice(0, 3).map((e) => e.right));
    expect(rights.size, `step-1 inputs do not share a right edge: ${JSON.stringify(edges)}`).toBe(
      1
    );
    expect(edges[3]!.width, `the date box sizes itself: ${JSON.stringify(edges)}`).toBe(
      edges[2]!.width
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

  /**
   * Owner 2026-11-27: "Do not scroll." Every create screen fits one phone
   * screen: what a step asks ends above the bottom bar, at 375×812 (the smallest
   * phone this audit measures), with nothing to scroll to inside the card.
   *
   * @born-red no-scroll | method: run against the 2026-11-27 two-step build
   *   before the compact layout: step 1 ended at 1247px, the share screen at
   *   1801px and sponsor step 2 at 953px | date: 2026-11-28
   */
  test.describe('every create screen fits one phone screen', () => {
    /** Bottom of what the screen asks vs the top of its bottom bar (or the screen's foot). */
    async function fits(page: Page, contentSel: string, barSel: string | null, label: string) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const m = await page.evaluate(
        ([c, b]) => {
          const content = document.querySelector(c as string)!.getBoundingClientRect();
          const bar = b ? document.querySelector(b)!.getBoundingClientRect() : null;
          return { bottom: content.bottom, limit: bar ? bar.top : innerHeight };
        },
        [contentSel, barSel]
      );
      expect(
        m.bottom,
        `${label}: ends at ${Math.round(m.bottom)}px, past ${Math.round(m.limit)}px`
      ).toBeLessThanOrEqual(m.limit + 1);
    }

    test('the event flow: step 1, step 2 and the share screen', async ({ page }) => {
      await openAdmin(page);
      await page.click('[data-testid="admin-path-wizard"]');
      await expect(page.getByTestId('wizard-step-1')).toBeVisible();
      await fits(page, '#wizard-step-1', '.wizard-nav', 'step 1');
      await page.getByTestId('wizard-event-name').fill('Thursday Trivia');
      await page.getByTestId('wizard-event-venue').fill('Eagles Hall');
      await page.getByTestId('wizard-next-btn').click();
      await expect(page.getByTestId('wizard-step-2')).toBeVisible();
      await fits(page, '#wizard-step-2', '.wizard-nav', 'step 2');
      await page.getByTestId('wizard-save-draft-btn').click();
      await expect(page.getByTestId('wizard-step-3')).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(500);
      await fits(page, '#wizard-step-3', '.wizard-nav', 'share screen');
    });

    test('the sponsor flow: step 1 and step 2', async ({ page }) => {
      await openAdmin(page);
      await page.click('[data-testid="admin-path-sponsor"]');
      await expect(page.getByTestId('sponsor-step-1')).toBeVisible();
      await fits(page, '[data-testid="sponsor-create-form"]', null, 'sponsor step 1');
      await page.getByTestId('spon-name').fill('Acme');
      await page.getByTestId('sponsor-next').click();
      await expect(page.getByTestId('sponsor-step-2')).toBeVisible();
      await fits(page, '[data-testid="sponsor-create-form"]', null, 'sponsor step 2');
    });
  });
});
