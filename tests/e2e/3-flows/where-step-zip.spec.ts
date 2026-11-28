/**
 * W1 (OSE-2095; owner 2026-11-16): the wizard's Where step, in a real browser,
 * against staging (T4b), at phone and desktop width.
 *
 *   - three boxes: place name, street address, ZIP code; each is 44px or more
 *     tall with input text of 16px or more;
 *   - leaving the address box fills the ZIP from the address (the server's own
 *     rule, POST /api/v2/admin/zip-suggest), ZIP+4 kept to five;
 *   - a ZIP the organizer typed is kept when the address changes;
 *   - the create sends location = name, where_address = address and
 *     zip_code = ZIP. The create is answered here (route.fulfill), so this spec
 *     writes no event to staging: the API side is Bruno folder 21.
 *
 * Auth, sent on every request the page makes: Authorization: Bearer with the
 * admin key (OSE_ADMIN_BEARER on a local worker, ADMIN_KEY in T4b), plus the CF
 * Access service token and X-OCR-Internal when given. Staging needs the Access
 * token and the Bearer key together: the token alone passes the edge and is then
 * refused by the worker (401; T4d's admin sign-in gate test holds that). Same
 * headers as sponsor-journey and launch-story-smoke. An unmet precondition is a
 * failure, not a skip.
 *
 * Mock-layer twin: workers/oursharedevents/tests/admin-wizard-where-zip.spec.ts.
 *
 * @born-red where-step-zip | method: run against a template with (1) the
 *   fill-in removed and (2) the create without zip_code; each failed here
 *   | date: 2026-11-16
 */
import { test, expect, type Page } from '@playwright/test';

const BEARER = process.env.OSE_ADMIN_BEARER || process.env.ADMIN_KEY || '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';
const CF_ID = process.env.CF_ACCESS_CLIENT_ID ?? '';
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET ?? '';
const MIN_TOUCH = 44;
const MIN_FONT = 16;

const SIZES = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${BEARER}` };
  if (X_OCR_INTERNAL) headers['X-OCR-Internal'] = X_OCR_INTERNAL;
  if (CF_ID) headers['CF-Access-Client-Id'] = CF_ID;
  if (CF_SECRET) headers['CF-Access-Client-Secret'] = CF_SECRET;
  return headers;
}

async function openWizard(page: Page, size: { width: number; height: number }): Promise<void> {
  expect(BEARER, 'the admin key (OSE_ADMIN_BEARER or ADMIN_KEY) is required').toBeTruthy();
  await page.setViewportSize(size);
  await page.setExtraHTTPHeaders(authHeaders());
  const res = await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  expect(res?.status(), 'the admin page answers').toBe(200);
  await page.getByTestId('admin-path-wizard').click();
  await expect(page.getByTestId('wizard-step-1')).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`W1 the Where step at ${size.name} width`, () => {
    test('three boxes, each a full-size target with 16px text', async ({ page }) => {
      await openWizard(page, size);
      // Owner 2026-11-27: the address and ZIP sit in step 1's "More details" fold.
      await page.getByTestId('wizard-more-details').locator('summary').click();
      for (const id of ['wizard-event-venue', 'wizard-event-address', 'wizard-event-zip']) {
        const box = page.getByTestId(id);
        await expect(box, id).toBeVisible();
        const bb = await box.boundingBox();
        expect(bb?.height ?? 0, `${id} is ${MIN_TOUCH}px or taller`).toBeGreaterThanOrEqual(
          MIN_TOUCH
        );
        const font = await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(font, `${id} text is ${MIN_FONT}px or more`).toBeGreaterThanOrEqual(MIN_FONT);
      }
      await expect(page.locator('label[for="wizard-event-zip"]')).toHaveText('ZIP code');
      expect(await page.locator('h1').count(), 'one h1').toBe(1);
    });

    test('the ZIP fills in from the address; a typed ZIP is kept; create sends all three', async ({
      page,
    }) => {
      await openWizard(page, size);
      await page.getByTestId('wizard-event-name').fill('OSE-2095 Playwright Where Step');
      await page.getByTestId('wizard-event-venue').fill('Eagles Hall');
      await page.getByTestId('wizard-more-details').locator('summary').click();
      const asked = page.waitForResponse(
        (r) => r.url().endsWith('/api/v2/admin/zip-suggest') && r.request().method() === 'POST'
      );
      await page.getByTestId('wizard-event-address').fill('1 Main St, Blue Island, IL 60406-1234');
      await page.getByTestId('wizard-event-address').press('Tab');
      const suggest = await asked;
      expect(suggest.status(), 'the fill-in answers').toBe(200);
      expect(suggest.url(), 'the address is in the body, never the URL').not.toContain('Main');
      await expect(page.getByTestId('wizard-event-zip')).toHaveValue('60406');

      // The organizer's own ZIP wins over a changed address.
      await page.getByTestId('wizard-event-zip').fill('60643');
      await page.getByTestId('wizard-event-address').fill('2 Main St, Blue Island, IL 60406');
      await page.getByTestId('wizard-event-address').press('Tab');
      await expect(page.getByTestId('wizard-event-zip')).toHaveValue('60643');

      // The create is answered here: nothing is written to staging by this spec.
      let sent: Record<string, unknown> | null = null;
      await page.route('**/api/v2/admin/events', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        sent = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, status: 201, id: 'evt_w1_playwright', warnings: [] }),
        });
      });
      const start = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
      await page.getByTestId('wizard-event-date').fill(start);
      await page.getByTestId('wizard-next-btn').click();
      await expect(page.getByTestId('wizard-step-2')).toBeVisible();
      await page.getByTestId('wizard-save-draft-btn').click();
      await expect.poll(() => sent, { message: 'the create was sent' }).not.toBeNull();
      expect(sent).toMatchObject({
        location: 'Eagles Hall',
        where_address: '2 Main St, Blue Island, IL 60406',
        zip_code: '60643',
        attendance_mode: 'in_person',
      });
    });
  });
}
