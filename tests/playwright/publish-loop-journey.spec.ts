/**
 * The publish loop, in a real browser at phone size (OSE-1508).
 *
 * An organizer who is not a web designer: makes an event in the wizard, looks
 * at the real page and poster while it is a draft, sets the TV, publishes,
 * changes their mind, undoes, goes back, changes the TV, publishes again.
 * Over and over, without getting lost.
 *
 * Unit and jsdom specs already run the logic (tests/admin-wizard-tv.spec.ts,
 * admin-poster-preview.spec.ts, publish-grace.spec.ts). This adds what only a
 * browser can show: layout (44px targets on step 4), real navigation, and the
 * publish grace window respected end to end on the local worker
 * (PUBLISH_GRACE_MINUTES=1, playwright.mobile.config.ts).
 *
 * Runs in the blocking phone audit on Chromium AND WebKit (mobile-webkit
 * project), since three of four phones in the nightly matrix are WebKit.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER ?? '';
const MOBILE = { width: 375, height: 812 };
const MIN_TOUCH = 44;

async function tall(page: Page, testid: string): Promise<number> {
  const box = await page.getByTestId(testid).first().boundingBox();
  expect(box, `${testid} is rendered`).not.toBeNull();
  return Math.round(box!.height);
}

test.describe('publish loop: draft → preview → publish → undo → republish', () => {
  test.skip(!ADMIN_BEARER, 'needs OSE_ADMIN_BEARER; the blocking PR gate supplies a local one');

  // OSE-1515: the keyboard-only path from the front door to step 4. Buttons
  // are focused directly (WebKit's Tab skips them unless the system setting is
  // on) and pressed with Enter; the fields move on with Enter.
  test('keyboard only: front door to the share screen, and step 1 says why it will not move on', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(MOBILE);
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('admin-path-wizard').focus();
    await page.keyboard.press('Enter');
    const name = page.getByTestId('wizard-event-name');
    const venue = page.getByTestId('wizard-event-venue');
    await expect(name).toBeFocused();

    // Next is reachable and enabled with nothing filled in.
    await expect(page.getByTestId('wizard-next-btn')).toBeEnabled();

    // Name only, Enter: the wizard says why and puts focus on the place.
    await page.keyboard.type(`Keyboard night ${Date.now()}`);
    await page.keyboard.press('Enter');
    // OSE-2012: the message names what is missing; here only the place is.
    await expect(page.getByTestId('wizard-msg')).toHaveText('Add a place to continue');
    await expect(venue).toHaveAttribute('aria-invalid', 'true');
    await expect(venue).toBeFocused();
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();

    // Place filled, Enter: step 2.
    await page.keyboard.type('Eagles Hall');
    await expect(venue).not.toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();

    // Step 2 with the keyboard: Save draft creates the draft (owner 2026-11-27: two steps).
    await page.getByTestId('wizard-save-draft-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();
    await expect(page.getByTestId('wizard-preview-public')).toBeVisible();
    expect(pageErrors, 'no script error on the way').toEqual([]);
  });

  test('a first-time organizer can go back and forth without getting lost', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const auth = { Authorization: `Bearer ${ADMIN_BEARER}` };
    await page.setViewportSize(MOBILE);
    await page.setExtraHTTPHeaders(auth);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // ── Step 1: name, place, when, what kind ────────────────────────────────
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('admin-path-wizard').click();
    const title = `Loop night ${Date.now()}`;
    await page.getByTestId('wizard-event-name').fill(title);
    await page.locator('#wizard-event-venue').fill('Eagles Hall');
    const start = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    await page.getByTestId('wizard-event-date').fill(start);
    // OSE-1560: leaving draft needs a start time and an event type.
    await page.getByTestId('wizard-event-time').fill('18:30');
    await page.getByTestId('wizard-category').selectOption({ index: 1 });
    await page.getByTestId('wizard-event-type').selectOption({ index: 1 });
    await page.getByTestId('wizard-next-btn').click();
    // ── Step 2: OSE-1560, a new event is off the map unless the organizer says otherwise; this journey puts it on.
    await page.getByTestId('wizard-publish-yes').click();
    await page.getByTestId('wizard-save-draft-btn').click();

    // ── Share screen: the event exists as a draft; see it before publishing ─
    const previewPublic = page.getByTestId('wizard-preview-public');
    await expect(previewPublic).toBeVisible();
    const href = await previewPublic.getAttribute('href');
    const id = /\/events\/([^/]+)\/preview$/.exec(href ?? '')?.[1];
    expect(id, `preview href ${href}`).toBeTruthy();

    // The TV settings are folded on the share screen.
    await page.getByTestId('wizard-tv-details').locator('summary').click();
    for (const t of ['wizard-preview-public', 'wizard-preview-poster', 'wizard-tv-demo-toggle']) {
      expect(await tall(page, t), `${t} touch target`).toBeGreaterThanOrEqual(MIN_TOUCH);
    }

    // The previews are the real page and poster, for admins only.
    const pv = await request.get(href!, { headers: auth });
    expect(pv.status()).toBe(200);
    expect(await pv.text()).toContain(title);
    const pp = await request.get(`/api/v2/admin/events/${id}/poster-preview`, { headers: auth });
    expect(pp.status()).toBe(200);
    expect(await pp.text()).toContain('poster-draft-mark');
    // Strangers see nothing yet.
    expect((await request.get(`/events/${id}`)).status()).toBe(404);

    // The TV: the summary follows the choice, and it saves.
    await expect(page.getByTestId('wizard-tv-summary')).toContainText('This event');
    await page.locator('label[for="wizard-tv-speed-30"]').click();
    await expect(page.getByTestId('wizard-tv-summary')).toContainText('30 seconds');
    await expect(page.getByTestId('wizard-tv-msg')).toContainText(/saved/i);

    // ── Publish, on the same screen ─────────────────────────────────────────
    const goLive = page.getByTestId('wizard-go-live-btn');
    await expect(goLive).toBeVisible();
    expect(await tall(page, 'wizard-go-live-btn')).toBeGreaterThanOrEqual(MIN_TOUCH);
    await goLive.click();
    const msg = page.getByTestId('wizard-go-live-msg');
    await expect(msg).toContainText('published');
    // The grace window, said plainly.
    await expect(msg).toContainText('goes on the map and list at');

    // Live by link at once; not on the list yet (grace window respected).
    expect((await request.get(`/events/${id}`)).status()).toBe(200);
    // The poll below waits 5 s between calls, which is also when a keep-alive socket goes idle;
    // a request that lands on a socket the server just closed gets ECONNRESET before it reaches the
    // worker (no server log line). That is a transport race, not an answer, so retry once.
    const get = async (url: string) => {
      try {
        return await request.get(url);
      } catch (e) {
        if (!/ECONNRESET/.test(String(e))) throw e;
        return await request.get(url);
      }
    };
    const listed = async () => {
      const r = await get('/api/v2/events?brand=root');
      const items = ((await r.json()) as { items: { id: string }[] }).items;
      return items.some((e) => e.id === id);
    };
    expect(await listed()).toBe(false);

    // ── Changed my mind: Undo, inside the window ────────────────────────────
    await page.getByTestId('wizard-undo-live-btn').click();
    await expect(msg).toContainText('Back to a draft');
    expect((await request.get(`/events/${id}`)).status()).toBe(404);
    expect(await listed()).toBe(false);

    // ── Change the TV on the same screen, publish again ─────────────────────
    await expect(page.getByTestId('wizard-back-btn')).toBeHidden();
    await expect(page.getByTestId('wizard-tv-summary')).toBeVisible();
    await page.locator('label[for="wizard-tv-speed-8"]').click();
    await expect(page.getByTestId('wizard-tv-summary')).toContainText('8 seconds');
    await goLive.click();
    await expect(msg).toContainText('published');

    // A second round, because "over and over" is the point.
    await page.getByTestId('wizard-undo-live-btn').click();
    await expect(msg).toContainText('Back to a draft');
    await goLive.click();
    await expect(msg).toContainText('published');

    // The TV kept the last choice.
    const cfg = await request.get(`/api/v2/admin/events/${id}/display-config`, { headers: auth });
    expect(cfg.status()).toBe(200);
    expect(JSON.stringify(await cfg.json())).toMatch(/"dwell_seconds":8\b/);

    // ── The window ends; the event lists itself ─────────────────────────────
    await expect.poll(listed, { timeout: 90_000, intervals: [5_000] }).toBe(true);

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('Publish on step 2 saves and publishes in one tap', async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(MOBILE);
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('admin-path-wizard').click();
    await page.getByTestId('wizard-event-name').fill(`One tap night ${Date.now()}`);
    await page.getByTestId('wizard-event-venue').fill('Eagles Hall');
    await page.getByTestId('wizard-when-tomorrow').click();
    await page.getByTestId('wizard-event-time').fill('19:00');
    await page.getByTestId('wizard-category').selectOption({ index: 1 });
    await page.getByTestId('wizard-event-type').selectOption({ index: 1 });
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('wizard-next-btn')).toHaveText('Publish');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();
    await expect(page.getByTestId('wizard-go-live-msg')).toContainText('published');
    const href = await page.getByTestId('wizard-preview-public').getAttribute('href');
    const id = /\/events\/([^/]+)\/preview$/.exec(href ?? '')?.[1];
    expect(id, `preview href ${href}`).toBeTruthy();
    expect((await request.get(`/events/${id}`)).status()).toBe(200);
  });

  test('Publish without a time or type goes back to step 1 and saves nothing', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('admin-path-wizard').click();
    await page.getByTestId('wizard-event-name').fill(`No time night ${Date.now()}`);
    await page.getByTestId('wizard-event-venue').fill('Eagles Hall');
    await page.getByTestId('wizard-next-btn').click();
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/v2/admin/events')) sent.push(r.url());
    });
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();
    await expect(page.getByTestId('wizard-msg')).toContainText(
      'Add a start time and an event type'
    );
    await expect(page.getByTestId('wizard-event-time')).toBeFocused();
    await expect(page.getByTestId('wizard-event-time')).toHaveAttribute('aria-invalid', 'true');
    expect(sent, 'nothing was saved').toEqual([]);
  });
});
