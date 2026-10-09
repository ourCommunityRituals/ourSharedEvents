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

/** Seed one event so the events table and the per-event cards have something real.
 *  Returns the created event id so the caller can wait on the DATA being visible
 *  to the list-read path (below) before it ever waits on the DOM. */
async function seedEvent(page: Page): Promise<string> {
  const res = await page.request.post('/api/v2/admin/events', {
    headers: { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' },
    data: {
      title: `CSP control check ${Date.now()}`,
      start_date: '2026-10-02',
      location: 'Rock Island Public House',
    },
  });
  // A silent non-2xx here would surface downstream as an empty table ("0 rows"),
  // which reads as a flake — fail loudly at the real cause instead.
  expect(res.ok(), `seed POST failed: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { id?: string };
  expect(body.id, `seed response carried no event id: ${JSON.stringify(body)}`).toBeTruthy();
  return body.id as string;
}

/**
 * Wait until the seeded event is visible to the ADMIN LIST READ PATH — polling
 * the API, not the DOM.
 *
 * WHY THIS EXISTS (#545 flaked twice more after its "wait for the row" fix).
 *   The surface renders its events table from an async `GET /api/v2/admin/events`
 *   after DOMContentLoaded. On a cold CI worker the seed WRITE and that first
 *   LIST READ race, so the row can be genuinely absent when the DOM wait starts —
 *   and a DOM-visibility timeout reports that as the ambiguous "no selectable
 *   event rows rendered", conflating "the data isn't there yet" with "the data is
 *   there but didn't render". This splits the two: we assert the DATA condition
 *   here (deterministically, at the API, with a clear message), so the later DOM
 *   wait is only ever waiting on client fetch+render — never on a cold DB write.
 *   The admin list has no is_published filter and orders created_at DESC, so a
 *   just-seeded event is always on page one — its absence here is pure lag, and
 *   polling is the right tool for lag.
 */
async function waitForEventInAdminList(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/v2/admin/events?limit=100', {
          headers: { Authorization: `Bearer ${ADMIN_BEARER}` },
        });
        if (!res.ok()) return false;
        const body = (await res.json()) as { items?: Array<{ id?: string }> };
        return (body.items ?? []).some((e) => e.id === id);
      },
      {
        message: `seeded event ${id} never appeared in the admin list API`,
        timeout: 15000,
        intervals: [250, 500, 1000],
      }
    )
    .toBe(true);
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
    const id = await seedEvent(page);
    // Gate on the DATA being readable before we reload into the render path.
    await waitForEventInAdminList(page, id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.click('[data-testid="admin-path-advanced"]');
    await page.waitForTimeout(1000);

    // The events list loads via an async fetch after DOMContentLoaded. The data
    // is already confirmed present (waitForEventInAdminList above), so this wait
    // is only for client fetch+render — never a cold DB write. Wait for the row
    // to attach, THEN snapshot the count deterministically.
    const rows = page.locator('[data-testid="events-tbody"] tr[data-action="event-select"]');
    await expect(rows.first(), 'no selectable event rows rendered').toBeVisible({ timeout: 15000 });
    expect(await rows.count()).toBeGreaterThan(0);

    const before = await page.getAttribute('[data-testid="link-poster"]', 'href');
    expect(before, 'poster link should start unscoped').toBe('/poster');

    await rows.first().click();
    await page.waitForTimeout(2500);

    const after = await page.getAttribute('[data-testid="link-poster"]', 'href');
    // Each event's poster has its own address under /events/<id>/.
    expect(after, 'poster link never re-scoped — the row click did nothing').toMatch(
      /^\/events\/evt_[^/?#]+\/poster$/
    );
    await expect(page.locator('tr.selected')).toHaveCount(1);
    expect(csp).toEqual([]);
  });

  test('the per-event cards load once an event is selected', async ({ page }) => {
    const csp = watchCsp(page);
    await openAdvanced(page);
    const id = await seedEvent(page);
    await waitForEventInAdminList(page, id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.click('[data-testid="admin-path-advanced"]');
    await page.waitForTimeout(1000);
    const seededRow = page.locator('[data-testid="events-tbody"] tr[data-action="event-select"]');
    await expect(seededRow.first(), 'no selectable event rows rendered').toBeVisible({
      timeout: 15000,
    });
    await seededRow.first().click();
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

  // TRIANGLE slice #4: the toggle asks the server for ?sort=upcoming and the
  // table follows the server's order (a nearer event above a later one, even
  // though the later one was created last).
  test('Soonest first reorders the list by start date', async ({ page }) => {
    const csp = watchCsp(page);
    await openAdvanced(page);
    const seedDated = async (label: string, daysOut: number): Promise<string> => {
      const res = await page.request.post('/api/v2/admin/events', {
        headers: { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' },
        data: {
          title: `Soonest ${label} ${Date.now()}`,
          start_date: new Date(Date.now() + daysOut * 86_400_000).toISOString().slice(0, 10),
          location: 'Eagles Hall',
        },
      });
      expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
      return ((await res.json()) as { id: string }).id;
    };
    const near = await seedDated('near', 2);
    const far = await seedDated('far', 300); // created LAST → first under the default sort
    await waitForEventInAdminList(page, far);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.click('[data-testid="admin-path-advanced"]');

    const listed = page.waitForRequest(
      (r) => r.url().includes('/api/v2/admin/events?') && r.url().includes('sort=upcoming')
    );
    await page.check('[data-testid="events-sort-upcoming"]');
    await listed;
    // Wait for the SORTED list first: `near` is on the default page too, so
    // checking its row before the label flips could pass on the stale list.
    await expect(page.getByTestId('events-count')).toContainText('soonest first', {
      timeout: 15000,
    });
    const nearRow = page.locator(`[data-testid="event-row-${near}"]`);
    await expect(nearRow).toBeVisible({ timeout: 15000 });
    const order = await page.$$eval(
      '[data-testid="events-tbody"] tr[data-action="event-select"]',
      (rows) => rows.map((r) => r.getAttribute('data-event-id'))
    );
    const iNear = order.indexOf(near);
    const iFar = order.indexOf(far);
    expect(iNear, 'near event not in the list').toBeGreaterThan(-1);
    // On CI's fresh D1 both are on page one; a locally reused worker may have
    // pushed the 300-days-out event past the first page, which still proves it
    // sorts after the near one.
    if (process.env.CI) expect(iFar, 'far event not on page one').toBeGreaterThan(-1);
    if (iFar > -1) expect(iNear).toBeLessThan(iFar);
    expect(csp).toEqual([]);
  });

  // CCR PR 700 (QA H2): a filter tapped while the list is still loading. The
  // in-flight response must not render under the new label, and the final rows
  // must be the new filter's. The unfiltered first page is held for 4 s and the
  // chip is tapped immediately, so the tap lands mid-flight by construction
  // (openAdvanced's 2 s settle wait is deliberately not used here).
  test('a filter tapped mid-load: final rows and label match the filter', async ({ page }) => {
    const csp = watchCsp(page);
    const id = await seedEvent(page);
    await waitForEventInAdminList(page, id);
    // Hold only the unfiltered LIST request (not /admin/events/:id/... calls).
    let holding = false;
    await page.route(
      (u) => u.pathname === '/api/v2/admin/events' && !u.searchParams.has('status'),
      async (route) => {
        holding = true;
        await new Promise((r) => setTimeout(r, 4000));
        holding = false;
        await route.continue();
      }
    );
    // Record every moment the list is labelled "Draft" while showing a non-draft
    // row: the stale-render window this test exists to close, not just the end state.
    await page.addInitScript(() => {
      const w = window as unknown as { __mislabelled: number };
      w.__mislabelled = 0;
      new MutationObserver(() => {
        const count = document.querySelector('[data-testid="events-count"]');
        if (!count || !/Draft/.test(count.textContent || '')) return;
        const rows = document.querySelectorAll('[data-testid="events-tbody"] tr[data-status]');
        rows.forEach((r) => {
          if (r.getAttribute('data-status') !== 'draft') w.__mislabelled += 1;
        });
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.setViewportSize({ width: 393, height: 900 });
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.click('[data-testid="admin-path-advanced"]');
    await expect.poll(() => holding, { timeout: 5000 }).toBe(true);
    await page.click('[data-testid="events-filter-draft"]');
    expect(holding, 'the tap must land while the first page is held').toBe(true);
    await expect(page.getByTestId('events-count')).toContainText('Draft', { timeout: 15000 });
    // Wait until the held response has had its chance to (wrongly) render.
    await page.waitForTimeout(4500);
    const statuses = await page.$$eval(
      '[data-testid="events-tbody"] tr[data-action="event-select"]',
      (rows) => rows.map((r) => r.getAttribute('data-status'))
    );
    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses)).toEqual(new Set(['draft']));
    await expect(page.getByTestId('events-count')).toContainText('Draft');
    const mislabelled = await page.evaluate(
      () => (window as unknown as { __mislabelled: number }).__mislabelled
    );
    expect(mislabelled, 'a non-draft row was shown under the "Draft" label').toBe(0);
    expect(csp).toEqual([]);
  });
});
