/**
 * SharedReport counts, end to end: a sponsor is placed and accepts, TV screens
 * show it, the organizer makes a report link in /admin, and the report's
 * sponsor table says how many displays there were — or says nothing while the
 * number is under the count floor of 5.
 *
 * Every display here is a real page load of /display in a browser: the page
 * fetches its sponsor bundle, receives a beacon token, and posts the
 * impression itself. The spec counts the beacons the server accepted (201) and
 * expects the report to show exactly that number.
 *
 * One caller counts once per placement per hour (lib/invalid-traffic),
 * so each "screen" is a browser context with its own forwarded address. That
 * header is honoured here only because nothing sits in front of the local
 * worker; behind Cloudflare the edge sets the caller's address.
 *
 * Runs against the local worker of playwright.mobile.config.ts.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { seedSponsorHome, type SeededSponsorHome } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const PHONE = { width: 375, height: 812 };
// The default headless user agent is classed as automated and never counted.
const TV_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FLOOR = 5;

test.describe.configure({ mode: 'serial' });

let seeded: SeededSponsorHome;
let reportUrl = '';
let counted = 0;
let nextScreen = 1;
const run = Math.floor(Math.random() * 200) + 20;

/** One TV screen loads /display once. Returns how many beacons the server counted. */
async function oneScreen(browser: Browser, n: number): Promise<number> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: TV_UA,
    extraHTTPHeaders: { 'CF-Connecting-IP': `198.51.${run}.${n}` },
  });
  const page = await context.newPage();
  const statuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes(`/sponsors/${seeded.sponsorId}/impression`)) statuses.push(r.status());
  });
  await page.goto(`/display?event=${encodeURIComponent(seeded.eventId)}`);
  await expect(page.getByTestId('display-sponsor-name').first()).toHaveText(seeded.sponsorName);
  await expect.poll(() => statuses.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await context.close();
  return statuses.filter((s) => s === 201).length;
}

async function openReport(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto(reportUrl);
  await expect(page.getByTestId('signed-link-event-title')).toHaveText(seeded.eventTitle);
}

test.beforeAll(async ({ request }) => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
  const headers = { Authorization: `Bearer ${ADMIN_BEARER}` };
  // Shared reports are a plan feature and off by default.
  const flag = await request.put('/api/v2/admin/flags/analytics.shared-report', {
    headers,
    data: { enabled: true },
  });
  expect(flag.status()).toBe(200);

  seeded = await seedSponsorHome(request, ADMIN_BEARER, 'Report');
  const accepted = await request.post(
    `/api/v2/sponsor/placements/${encodeURIComponent(seeded.placementId)}/respond`,
    { data: { token: seeded.token, accepted: true } }
  );
  expect(accepted.status()).toBe(200);

  // The link itself comes from the same endpoint the admin page calls.
  const minted = await request.post(
    `/api/v2/admin/events/${encodeURIComponent(seeded.eventId)}/shared-report/mint-link`,
    { headers, data: { role: 'admin', ttl_days: 7 } }
  );
  expect(minted.status()).toBe(200);
  const { token } = (await minted.json()) as { token: string };
  reportUrl = `/sharedReport?eventId=${encodeURIComponent(seeded.eventId)}&token=${encodeURIComponent(token)}`;
});

// Known defect, stated as the behaviour we want. Goes red the day it is fixed.
test('the organizer makes a report link in /admin', async ({ page }) => {
  test.fail(true, 'Defect: Generate Link answers "esc is not defined" and shows no link.');
  await page.setViewportSize(PHONE);
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-path-advanced').click();
  await page.getByTestId('events-filter-active').click();
  await page.locator(`[data-testid="event-row-${seeded.eventId}"]`).click();

  await page.getByTestId('mint-role').selectOption('admin');
  await page.getByTestId('mint-link-btn').click();
  await expect(page.getByTestId('mint-report-url')).toHaveAttribute(
    'href',
    new RegExp(`eventId=${seeded.eventId}`),
    { timeout: 5000 }
  );
});

test('the report link opens the report for this event', async ({ page }) => {
  await openReport(page);
});

test('before any screen has shown the sponsor, the report counts nothing', async ({ page }) => {
  await openReport(page);
  await expect(page.getByTestId('premium-sponsor-count')).toHaveText('0');
  await expect(page.getByTestId('premium-displays')).toHaveText('0');
});

test('displays under the floor of 5: the report still shows no number', async ({
  page,
  browser,
}) => {
  // One screen load shows the sponsor in two places (top banner, side rail) and
  // each is counted as a display, so two screens are four displays.
  counted += await oneScreen(browser, nextScreen++);
  counted += await oneScreen(browser, nextScreen++);
  expect(counted, 'displays the server counted').toBeGreaterThan(0);
  expect(counted, 'still under the floor').toBeLessThan(FLOOR);

  await openReport(page);
  await expect(page.getByTestId('premium-sponsor-count')).toHaveText('0');
  await expect(page.getByTestId('premium-displays')).toHaveText('0');
});

test('the same screen reloading is not counted again', async ({ browser }) => {
  expect(await oneScreen(browser, 1)).toBe(0);
});

test('past the floor: one premium sponsor, and exactly the displays the server counted', async ({
  page,
  browser,
}) => {
  while (counted < FLOOR) counted += await oneScreen(browser, nextScreen++);

  await openReport(page);
  await expect(page.getByTestId('premium-sponsor-count')).toHaveText('1');
  await expect(page.getByTestId('premium-displays')).toHaveText(String(counted));
  await expect(page.getByTestId('local-sponsor-count')).toHaveText('0');
  await expect(page.getByTestId('mid-sponsor-count')).toHaveText('0');
  await expect(page.getByTestId('paid-displays-total')).toContainText(String(counted));
});

test("the organizer's report names the sponsor beside the same count", async ({ page }) => {
  await openReport(page);
  const main = page.getByTestId('report-main');
  await expect(main).toContainText(seeded.sponsorName);
  await expect(page.getByTestId('local-vs-paid-delta')).toContainText(`Paid: ${counted} displays`);
});

test('a link that was tampered with shows a plain message and no event', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const bad = reportUrl.replace(/token=([^&]{6})/, 'token=AAAAAA');
  await page.goto(bad);
  await expect(page.getByTestId('signed-link-error')).toContainText(
    /expired or isn.t valid. Ask the sender for a fresh link/
  );
  await expect(page.getByTestId('report-main')).not.toContainText(seeded.eventTitle);
});

test('a link for one event does not open another event', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const other = reportUrl.replace(/eventId=[^&]+/, 'eventId=evt_some_other_event');
  await page.goto(other);
  await expect(page.getByTestId('signed-link-error')).toBeVisible();
  await expect(page.getByTestId('report-main')).not.toContainText(seeded.eventTitle);
});
