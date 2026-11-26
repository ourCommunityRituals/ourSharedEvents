/**
 * The host's vote screen (OSE-2226) and the admin "Page layouts" card (OSE-2232).
 *
 * Rules held here, each named after the fault it was watched failing on:
 *   1. on a TV the screen shows only the room's vote code, large, and "Scan to
 *      vote" as the one h1; its QR is the Voting card's QR [another code drawn];
 *   2. a phone that follows the code lands on the event's vote page with a
 *      pass [the screen pointed at a poster code];
 *   3. the card saves a skin and a moved layout reads "custom"
 *      [the custom rule removed from the card].
 *
 * Placement: the mobile Playwright project (playwright.mobile.config.ts), run
 * locally in CI and on staging. Voting must be on (staging: on).
 *
 * @born-red OSE-2226, OSE-2232 | method: injected-fault, each removed after;
 * listed in the PR body | date: 2026-11-25
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const AUTH = { Authorization: `Bearer ${ADMIN_BEARER}` };

test.describe.configure({ mode: 'serial' });

test.describe('the host vote screen and page layouts', () => {
  let eventId = '';
  let code = { url: '', qr: '' };

  test.beforeAll(async ({ request }) => {
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    const json = { ...AUTH, 'Content-Type': 'application/json' };
    const made = await request.post('/api/v2/admin/events', {
      headers: json,
      data: {
        attendance_mode: 'in_person',
        title: `Vote screen night ${Date.now()}`,
        start_date: '2027-05-15',
        start_time: '19:00',
        timezone: 'America/Chicago',
        event_type_id: 'etr-rec-bocce',
        location: 'Eagles Hall',
      },
    });
    expect(made.ok(), await made.text()).toBe(true);
    eventId = ((await made.json()) as { id: string }).id;
    // A look other than standard is the skins add-on; only the platform key
    // turns it on. The key actor creates events in the 'root' brand.
    const addon = await request.put('/api/v2/admin/addons', {
      headers: json,
      data: { brand_id: 'root', addon: 'skins', on: true },
    });
    expect(addon.ok(), await addon.text()).toBe(true);
    for (const status of ['ready', 'active']) {
      const put = await request.put(`/api/v2/admin/events/${eventId}`, {
        headers: json,
        data: { status },
      });
      expect(put.ok(), await put.text()).toBe(true);
    }
    const vp = (tail = '') => `/api/v2/admin/events/${eventId}/votables${tail}`;
    expect(
      (await request.post(vp(), { headers: json, data: { played_by: 'object' } })).status()
    ).toBe(201);
    const song = await request.post(vp('/objects'), {
      headers: json,
      data: { kind: 'entry', label: 'The blue float' },
    });
    expect(song.status()).toBe(201);
    expect((await request.post(vp('/open'), { headers: json, data: {} })).ok()).toBe(true);
    const c = await request.post(vp('/code'), { headers: json, data: {} });
    expect(c.ok(), await c.text()).toBe(true);
    code = ((await c.json()) as { code: { url: string; qr: string } }).code;
    expect(code.url).toMatch(/\/q\/qrt_[0-9a-f]{32}\?type=vote$/);
  });

  test('1. on a TV it shows only the code, large, and "Scan to vote"', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders(AUTH);
    await page.goto(`/api/v2/admin/events/${eventId}/vote-screen`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('vote-screen-line')).toHaveText('Scan to vote');
    const qr = page.getByTestId('vote-screen-qr');
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute('src')).toBe(code.qr);
    const box = await qr.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(500);
    await expect(page.locator('body')).not.toContainText(/\d+\s+votes?/i);
    await expect(page.locator('body')).not.toContainText('Vote screen night');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

  test('2. a phone that follows the code lands on the vote page with a pass', async ({
    browser,
  }) => {
    const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
    // The pass rides in the redirect's fragment. The vote page reads it and
    // then clears it from the address bar (lib/vote-page-render.ts), so the
    // pass is checked on the redirect itself, not on the final URL.
    const hop = await phone.request.get(code.url, { maxRedirects: 0 });
    expect(hop.status()).toBe(302);
    expect(hop.headers()['location'] ?? '').toMatch(
      new RegExp(`/events/${eventId}/vote#t=[^&#]+$`)
    );
    const page = await phone.newPage();
    await page.goto(code.url, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}/vote$`));
    await phone.close();
  });

  test('3. the Page layouts card saves a skin, and a moved layout reads custom', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setExtraHTTPHeaders(AUTH);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.click('[data-testid="admin-path-events"]');
    await page.getByTestId('events-filter-all').click();
    const row = page.locator(`[data-testid="event-row-${eventId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    const card = page.getByTestId('layouts-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('layout-report-part')).toHaveCount(7);

    await page.getByTestId('layout-report-skin').selectOption('map_first');
    await expect(page.getByTestId('layout-report-part').first()).toHaveAttribute(
      'data-region',
      'map'
    );
    await page.getByTestId('layout-vote-skin').selectOption('side_by_side');
    await page.getByTestId('layout-save').click();
    await expect(page.getByTestId('layout-msg')).toHaveText(/^Saved\./);
    const read = async () =>
      (await (
        await request.get(`/api/v2/admin/events/${eventId}/layouts`, { headers: AUTH })
      ).json()) as { layouts: Record<string, { skin: string; order: string[] }> };
    expect((await read()).layouts.report.skin).toBe('map_first');
    expect((await read()).layouts.vote_screen.skin).toBe('side_by_side');

    // Move the scan trend up one: the layout is now the organizer's own.
    await page
      .locator(
        '[data-testid="layout-report-part"][data-region="trend"] [data-testid="layout-report-up"]'
      )
      .click();
    await expect(page.getByTestId('layout-report-skin')).toHaveValue('custom');
    await page.getByTestId('layout-save').click();
    await expect(page.getByTestId('layout-msg')).toHaveText(/^Saved\./);
    const after = await read();
    expect(after.layouts.report.skin).toBe('custom');
    expect(after.layouts.report.order.indexOf('trend')).toBeLessThan(
      after.layouts.report.order.indexOf('posters')
    );
  });
});
