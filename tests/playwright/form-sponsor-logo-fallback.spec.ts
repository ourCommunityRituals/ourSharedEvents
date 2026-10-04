/**
 * OSE-1566: on the form page, a sponsor logo that fails to load must swap to the
 * OSE default image, never leave a blank. The staging fixture showed the strip's
 * broken logo hidden at 0px while the event page, banner and poster swapped.
 *
 * Seeds through the admin API only, on the local worker of
 * playwright.mobile.config.ts. The logo host is a `.invalid` name, so the proxy
 * cannot fetch it and the image request fails, the same case as the staging
 * fixture's sponsor C.
 */
import { test, expect, type Page } from '@playwright/test';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const PHONE = { width: 375, height: 812 };
const DEFAULT_LOGO = '/sponsor-default-logo.svg';
const FORM_TYPES = ['register', 'checkin', 'survey', 'email'] as const;

let eventId = '';
let brokenName = '';
let plainName = '';

test.beforeAll(async ({ request }) => {
  const headers = { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' };
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  brokenName = `Broken Logo Books ${suffix}`;
  plainName = `No Logo Hardware ${suffix}`;
  eventId = (await createLiveEvent(request, ADMIN_BEARER, `Logo fallback night ${suffix}`)).id;
  for (const data of [
    { name: brokenName, tier: 'gold', event_id: eventId, logo_url: 'https://logo.invalid/x.png' },
    { name: plainName, tier: 'gold', event_id: eventId },
  ]) {
    const res = await request.post('/api/v2/admin/sponsors', { headers, data });
    expect(res.ok(), `create sponsor ${data.name}: ${await res.text()}`).toBe(true);
    const sp = (await res.json()) as { id: string };
    // Consent: the sponsor shows only after both sides agreed (ADR-019).
    const link = await request.post(`/api/v2/admin/sponsors/${sp.id}/home-link`, {
      headers,
      data: {},
    });
    const token = new URL(((await link.json()) as { url: string }).url).searchParams.get('t');
    const pl = await request.get(`/api/v2/admin/sponsors?event_id=${eventId}`, { headers });
    const placementId = (
      (await pl.json()) as { items?: Array<Record<string, string>> }
    ).items?.find((i) => i.id === sp.id)?.placement_id;
    expect(placementId, 'placement for the sponsor').toBeTruthy();
    const ok = await request.post(`/api/v2/sponsor/placements/${placementId}/respond`, {
      data: { token, accepted: true },
    });
    expect(ok.ok(), 'sponsor accepts').toBe(true);
  }
});

async function stripImages(page: Page, type: string) {
  await page.setViewportSize(PHONE);
  await page.goto(`/forms/${encodeURIComponent(eventId)}?type=${type}`);
  const strip = page.getByTestId('form-sponsor-strip');
  await expect(strip.locator('img')).toHaveCount(2, { timeout: 15_000 });
  return strip;
}

for (const type of FORM_TYPES) {
  test(`[OSE-1566] ${type} form: a logo that fails to load shows the default image`, async ({
    page,
  }) => {
    const strip = await stripImages(page, type);
    const item = (name: string) => strip.locator('.sponsor-item').filter({ hasText: name });
    for (const name of [brokenName, plainName]) {
      const img = item(name).locator('img');
      await expect
        .poll(() => img.getAttribute('src'), { message: `${name} ends on the default image` })
        .toBe(DEFAULT_LOGO);
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
          message: `${name} image is drawn`,
        })
        .toBeGreaterThan(0);
      expect(await img.isVisible(), `${name} is visible, not hidden`).toBe(true);
    }
  });
}
