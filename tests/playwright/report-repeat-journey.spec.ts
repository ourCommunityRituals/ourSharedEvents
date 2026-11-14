/**
 * The report ends with what to do next, and "Repeat this event" works end to end
 * (OSE-1531), in a real browser at phone and tablet size.
 *
 * jsdom (workers/oursharedevents/tests/shared-report-actions.spec.ts) runs the
 * page's logic and the Worker spec runs the route. This adds what only a browser
 * shows: that the row is laid out, every control is at least 44px tall and wide,
 * the page does not scroll sideways, and a click really leads from the report to
 * the new draft selected in the admin.
 *
 * And the other side of the wall: the same report opened through a signed link
 * (a sponsor, a bar owner: no admin session) shows no action row. That link's
 * token leaves the address bar once the page has read it, and a refresh then
 * shows the page's no-token view, not the report.
 *
 * Runs against the local worker of playwright.mobile.config.ts.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const MIN_TOUCH = 44;
const SIZES = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 820, height: 1180 },
];

test.describe.configure({ mode: 'serial' });

let eventId = '';
let eventTitle = '';
let signedLink = '';

async function expectTouchable(page: Page, testid: string): Promise<void> {
  const box = await page.getByTestId(testid).boundingBox();
  expect(box, `${testid} is laid out`).not.toBeNull();
  expect(box!.height, `${testid} height`).toBeGreaterThanOrEqual(MIN_TOUCH);
  expect(box!.width, `${testid} width`).toBeGreaterThanOrEqual(MIN_TOUCH);
}

test.beforeAll(async ({ request }) => {
  // Not a skip: a gate that goes green by not running is the thing this repo guards against.
  expect(ADMIN_BEARER, 'needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts)').not.toBe('');
  const headers = { Authorization: `Bearer ${ADMIN_BEARER}` };
  const flag = await request.put('/api/v2/admin/flags/analytics.shared-report', {
    headers,
    data: { enabled: true },
  });
  expect(flag.status()).toBe(200);

  eventTitle = `Repeat journey ${Date.now()}`;
  const created = await request.post('/api/v2/admin/events', {
    headers,
    data: {
      attendance_mode: 'in_person',
      title: eventTitle,
      location: 'Eagles Hall',
      start_date: '2026-09-26',
      start_time: '18:00',
      timezone: 'America/Chicago',
    },
  });
  expect(created.status()).toBe(201);
  eventId = ((await created.json()) as { id: string }).id;

  const minted = await request.post(
    `/api/v2/admin/events/${encodeURIComponent(eventId)}/shared-report/mint-link`,
    { headers, data: { role: 'admin', ttl_days: 7 } }
  );
  expect(minted.status()).toBe(200);
  const { token } = (await minted.json()) as { token: string };
  signedLink = `/sharedReport?eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
});

for (const size of SIZES) {
  test(`${size.name}: the organizer's report ends with next actions that fit a thumb`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
    await page.goto(`/sharedReport?event=${encodeURIComponent(eventId)}`);

    await expect(page.getByTestId('report-actions')).toBeVisible();
    for (const id of [
      'report-action-repeat',
      'report-action-create-next',
      'report-action-share',
      'report-action-invite',
    ]) {
      await expectTouchable(page, id);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(1);
    expect(await page.locator('h1').count()).toBe(1);
  });
}

test('Repeat this event: a draft copy appears, and the admin opens on it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto(`/sharedReport?event=${encodeURIComponent(eventId)}`);

  const repeat = page.getByTestId('report-action-repeat');
  await repeat.click();
  const status = page.getByTestId('report-action-status');
  await expect(status).toContainText(eventTitle);
  await expect(status).toContainText('draft');
  await expect(repeat).toBeDisabled();
  await expectTouchable(page, 'report-action-open-draft');

  const copyId = await page.evaluate(() => sessionStorage.getItem('ose_selected_event_id'));
  expect(copyId).toBeTruthy();
  expect(copyId).not.toBe(eventId);

  await page.getByTestId('report-action-open-draft').click();
  await expect(page).toHaveURL(/\/admin/);
  const row = page.getByTestId(`event-row-${copyId}`);
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/selected/);
  await expect(row).toContainText(eventTitle);
});

test('a signed-link viewer gets the report and no action row', async ({ browser }) => {
  // A fresh context: no admin header, no admin session, only the link.
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const adminRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v2/admin/')) adminRequests.push(r.url());
  });
  await page.goto(signedLink);
  await expect(page.getByTestId('signed-link-event-title')).toHaveText(eventTitle);
  await expect(page.getByTestId('report-actions')).toBeHidden();
  expect(adminRequests, 'a signed-link visit never calls an admin route').toEqual([]);
  await context.close();
});

test('a signed link leaves the address bar once read, and a refresh does not bring the report back', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const res = await page.goto(signedLink);
  expect(res?.headers()['cache-control']).toBe('no-store');
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByTestId('signed-link-event-title')).toHaveText(eventTitle);

  // Only the token is dropped: the address still names the event.
  const left = new URL(page.url()).searchParams;
  expect([...left.keys()]).toEqual(['eventId']);
  expect(left.get('eventId')).toBe(eventId);

  // The token is kept in the page only: no cookie, nothing in browser storage.
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

  // A refresh asks for the address left behind. No token, so no report.
  const reportReads: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/shared-report')) reportReads.push(r.url());
  });
  await page.reload();
  await expect(page.locator('#events-list')).toBeAttached();
  await expect(page.getByTestId('signed-link-section')).toBeHidden();
  await expect(page.getByTestId('signed-link-event-title')).toHaveCount(0);
  expect(reportReads, 'a refresh has no token to read the report with').toEqual([]);

  // The same link, opened again, is the report.
  await page.goto(signedLink);
  await expect(page.getByTestId('signed-link-event-title')).toHaveText(eventTitle);
  await context.close();
});
