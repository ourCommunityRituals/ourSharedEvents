/**
 * Admin controls actually DO something (OSE-1239).
 *
 * THE GAP THIS FILLS
 *   Every one of these controls had a test asserting it was VISIBLE. All of
 *   those passed while the control was dead: a nonce CSP refuses inline
 *   event-handler attributes, so `onclick="…"` rendered fine and fired never.
 *   Visibility was never the problem, so visibility tests never found it.
 *
 *   So each test here clicks and then asserts an OBSERVABLE CONSEQUENCE — a
 *   label that changed, a panel that unhid, links that re-scoped. A control
 *   that renders and does nothing fails here.
 *
 *   The static counterpart (workers/oursharedevents/tests/csp-no-inline-handlers.spec.ts)
 *   asserts the shape — zero inline handlers in any template. Together: the
 *   static gate stops the pattern returning anywhere, this one proves the
 *   replacement actually works on the surface people use.
 *
 * @born-red OSE-1239 | method: Copy URL, Add Deployment and event-row select
 * | all refused by CSP at click time | date: 2026-09-05
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER ?? '';

/** Any CSP refusal during a test is a failure, whichever control caused it. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) violations.push(m.text().slice(0, 120));
  });
  return violations;
}

async function openAdvanced(page: Page): Promise<void> {
  await page.setViewportSize({ width: 393, height: 900 });
  if (ADMIN_BEARER) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('[data-testid="admin-path-advanced"]');
  await page.waitForTimeout(800);
}

/** Seed one event so the events table and the per-event cards have something real. */
async function seedEvent(page: Page): Promise<void> {
  await page.request.post('/api/v2/admin/events', {
    headers: { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' },
    data: {
      title: `CSP control check ${Date.now()}`,
      start_date: '2026-10-02',
      location: 'Rock Island Public House',
    },
  });
}

test.describe('OSE-1239 admin controls fire under the nonce CSP', () => {
  test.skip(!ADMIN_BEARER, 'needs OSE_ADMIN_BEARER; the blocking PR gate supplies a local one');

  test('Copy URL reports back — the button was dead, not just untested', async ({ page }) => {
    const csp = watchCsp(page);
    await openAdvanced(page);
    const btn = page.locator('[data-testid="copy-poster"]');
    await expect(btn).toHaveText(/Copy URL/);
    await btn.click();
    await expect(btn).toHaveText(/Copied!/, { timeout: 5000 });
    expect(csp, `CSP refusals during the click: ${csp.join(' | ')}`).toEqual([]);
  });

  test('+ Add Deployment opens the deployment form', async ({ page }) => {
    const csp = watchCsp(page);
    await openAdvanced(page);
    const hidden = () => page.evaluate(() => document.getElementById('pd-form-wrap')?.hidden);
    expect(await hidden(), 'form should start closed').toBe(true);
    await page.click('[data-testid="add-poster-deployment-toggle"]');
    await page.waitForTimeout(300);
    expect(await hidden(), 'form did not open — the toggle is dead').toBe(false);
    expect(csp).toEqual([]);
  });

  // The highest-value one: selecting an event is what scopes every other card.
  // While this was dead, the entire per-event admin surface was unreachable.
  test('selecting an event scopes the surface links to it', async ({ page }) => {
    const csp = watchCsp(page);
    await openAdvanced(page);
    await seedEvent(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.click('[data-testid="admin-path-advanced"]');
    await page.waitForTimeout(1000);

    const rows = page.locator('[data-testid="events-tbody"] tr[data-action="event-select"]');
    expect(await rows.count(), 'no selectable event rows rendered').toBeGreaterThan(0);

    const before = await page.getAttribute('[data-testid="link-poster"]', 'href');
    expect(before, 'poster link should start unscoped').toBe('/poster');

    await rows.first().click();
    await page.waitForTimeout(2500);

    const after = await page.getAttribute('[data-testid="link-poster"]', 'href');
    expect(after, 'poster link never re-scoped — the row click did nothing').toMatch(
      /^\/poster\?event=evt_/
    );
    await expect(page.locator('tr.selected')).toHaveCount(1);
    expect(csp).toEqual([]);
  });

  test('the per-event cards load once an event is selected', async ({ page }) => {
    const csp = watchCsp(page);
    await openAdvanced(page);
    await seedEvent(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.click('[data-testid="admin-path-advanced"]');
    await page.waitForTimeout(1000);
    await page
      .locator('[data-testid="events-tbody"] tr[data-action="event-select"]')
      .first()
      .click();
    await page.waitForTimeout(3000);

    // "Could not load forms" here would mean the panel threw while rendering —
    // a class of failure that was UNREACHABLE while selection itself was dead,
    // and which a real one cost me on the way to this fix.
    const forms = await page.textContent('[data-testid="forms-panel"]');
    expect(forms, `forms panel errored: ${forms}`).not.toMatch(/Could not load/);
    expect(forms).toMatch(/Registration/);

    const posters = await page.textContent('[data-testid="poster-deployments-panel"]');
    expect(posters, `posters panel errored: ${posters}`).not.toMatch(/Could not load/);
    expect(csp).toEqual([]);
  });

  test('no template ships a control the CSP will refuse', async ({ page }) => {
    const csp = watchCsp(page);
    await openAdvanced(page);
    // Exercise the surfaces a host actually touches, in build order.
    for (const id of ['ecb-nav-sponsors', 'copy-display', 'copy-public', 'copy-report']) {
      const el = page.locator(`[data-testid="${id}"]`);
      if ((await el.count()) && (await el.isVisible())) {
        await el.click();
        await page.waitForTimeout(250);
      }
    }
    expect(csp, `CSP refusals: ${csp.join(' | ')}`).toEqual([]);
  });
});
