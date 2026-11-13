/**
 * Online or in person, in a real browser (OSE-2012, owner decision 2026-11-12).
 *
 * Against the local worker (playwright.mobile.config.ts):
 *   - the create flow asks how people take part, with three choices and no
 *     field for a meeting link;
 *   - choosing Online takes the place field away, and the event is created
 *     with no place;
 *   - its public page says "Online", has one <h1> and shows no place or map;
 *   - an in-person event says "In person" beside its place;
 *   - an online event that is live and listed is on no list: /events and the
 *     landing page leave it out while its in-person twin is there, and the
 *     brand API still returns it;
 *   - the question's control is 44px or more and nothing runs off the side at
 *     320px.
 *
 * The rules themselves are held by workers/oursharedevents/tests/
 * attendance-mode.spec.ts; on staging by Bruno folder 18.
 *
 * @born-red OSE-2012 | method: watched failing with the mode select removed
 * from the wizard, with the page label removed, and with the /events filter
 * removed (the list is in the PR) | date: 2026-11-13
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER ?? '';
const MIN_TOUCH = 44;
const PHONE = { width: 375, height: 812 };

async function openWizard(page: Page, size = PHONE): Promise<void> {
  expect(ADMIN_BEARER, 'the local audit worker supplies OSE_ADMIN_BEARER').not.toBe('');
  await page.setViewportSize(size);
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-path-wizard').click();
  await expect(page.getByTestId('wizard-step-1')).toBeVisible();
}

/** Fill step 1, pick a type, create. Returns the new event's id. */
async function createInWizard(
  page: Page,
  o: { title: string; mode: 'in_person' | 'online' | 'both'; venue?: string }
): Promise<string> {
  await page.getByTestId('wizard-event-name').fill(o.title);
  await page.getByTestId('wizard-event-mode').selectOption(o.mode);
  if (o.venue) await page.getByTestId('wizard-event-venue').fill(o.venue);
  const start = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  await page.getByTestId('wizard-event-date').fill(start);
  await page.getByTestId('wizard-event-time').fill('18:30');
  await page.getByTestId('wizard-next-btn').click();
  await page.getByTestId('wizard-category').selectOption({ index: 1 });
  await page.getByTestId('wizard-event-type').selectOption({ index: 1 });
  await page.getByTestId('wizard-next-btn').click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/v2/admin/events') && r.request().method() === 'POST'
  );
  await page.getByTestId('wizard-next-btn').click();
  const res = await created;
  expect(res.status(), await res.text()).toBe(201);
  const sent = res.request().postDataJSON() as Record<string, unknown>;
  expect(sent.attendance_mode, 'the create names the mode').toBe(o.mode);
  if (o.mode === 'online') {
    expect(sent, 'an online create sends no place').not.toHaveProperty('location');
    expect(sent).not.toHaveProperty('where_address');
  }
  return ((await res.json()) as { id: string }).id;
}

async function publish(page: Page, id: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${ADMIN_BEARER}`,
    'Content-Type': 'application/json',
  };
  const base = `/api/v2/admin/events/${id}`;
  expect((await page.request.put(base, { headers, data: { status: 'ready' } })).status()).toBe(200);
  expect((await page.request.post(`${base}/verify-qr`, { headers })).status()).toBe(200);
  expect((await page.request.put(base, { headers, data: { is_published: true } })).status()).toBe(
    200
  );
}

test.describe('online or in person', () => {
  test('the create flow asks, with three choices, a 44px control and no meeting-link field', async ({
    page,
  }) => {
    await openWizard(page);
    const mode = page.getByTestId('wizard-event-mode');
    await expect(mode).toBeVisible();
    await expect(mode).toHaveAttribute('aria-required', 'true');
    expect(
      await mode
        .locator('option')
        .evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent]))
    ).toEqual([
      ['in_person', 'In person'],
      ['online', 'Online'],
      ['both', 'Online and in person'],
    ]);
    const b = await mode.boundingBox();
    expect(b!.height, 'the control is a full touch target').toBeGreaterThanOrEqual(MIN_TOUCH);
    // No field anywhere in the admin asks for a meeting link.
    const linkFields = await page
      .locator('input, textarea, select')
      .evaluateAll((els) =>
        els
          .map(
            (e) => `${e.id} ${e.getAttribute('name') ?? ''} ${e.getAttribute('placeholder') ?? ''}`
          )
          .filter((s) => /meeting|zoom|join link|stream/i.test(s))
      );
    expect(linkFields).toEqual([]);

    // Online: the place goes away, and comes back for the other two.
    await page.getByTestId('wizard-event-venue').fill('Eagles Hall');
    await mode.selectOption('online');
    await expect(page.getByTestId('wizard-event-venue')).toBeHidden();
    await expect(page.getByTestId('wizard-event-mode-note')).toBeVisible();
    await expect(page.getByTestId('wizard-event-venue')).toHaveValue('');
    await mode.selectOption('both');
    await expect(page.getByTestId('wizard-event-venue')).toBeVisible();
    await expect(page.getByTestId('wizard-event-mode-note')).toBeHidden();

    await page.setViewportSize({ width: 320, height: 700 });
    const o = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(o.sw, `${o.sw}px wide on a ${o.cw}px screen`).toBeLessThanOrEqual(o.cw + 1);
  });

  test('in person still needs a place; online does not', async ({ page }) => {
    await openWizard(page);
    await page.getByTestId('wizard-event-name').fill('No place yet');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();
    await expect(page.locator('#wizard-msg')).toHaveText('Add a place to continue');
    await page.getByTestId('wizard-event-mode').selectOption('online');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();
  });

  test('an online event made in the create flow has no place, and its page says Online', async ({
    page,
  }) => {
    await openWizard(page);
    const title = `Online class ${Date.now()}`;
    const id = await createInWizard(page, { title, mode: 'online' });
    await publish(page, id);
    await page.setExtraHTTPHeaders({});

    await page.goto(`/events/${id}`, { waitUntil: 'domcontentloaded' });
    const line = page.getByTestId('event-mode');
    await expect(line).toHaveCount(1);
    await expect(line).toHaveText('Online');
    await expect(line).toHaveAttribute('data-mode', 'online');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('venue-map')).toHaveCount(0);
    // The public page never prints the word the lexicon bans.
    expect(await page.content()).not.toMatch(/attendance/i);
  });

  test('an in-person event made in the create flow says In person beside its place', async ({
    page,
  }) => {
    await openWizard(page);
    const title = `Hall night ${Date.now()}`;
    const id = await createInWizard(page, { title, mode: 'in_person', venue: 'Eagles Hall' });
    await publish(page, id);
    await page.setExtraHTTPHeaders({});

    await page.goto(`/events/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('event-mode')).toHaveText('In person');
    await expect(page.getByTestId('event-where')).toContainText('Eagles Hall');
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('link only: a live, listed online event is on no list, and the brand API still returns it', async ({
    page,
  }) => {
    expect(ADMIN_BEARER).not.toBe('');
    const headers = {
      Authorization: `Bearer ${ADMIN_BEARER}`,
      'Content-Type': 'application/json',
    };
    // Created live by automation, so both are listed at once (no publish grace).
    const live = async (mode: string, title: string, place: Record<string, unknown>) => {
      const res = await page.request.post('/api/v2/admin/events', {
        headers,
        data: {
          title,
          attendance_mode: mode,
          brand_id: 'root',
          status: 'active',
          is_published: true,
          start_date: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
          ...place,
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const stamp = Date.now();
    const onlineTitle = `Link only class ${stamp}`;
    const hallTitle = `Listed hall night ${stamp}`;
    const online = await live('online', onlineTitle, {});
    const hall = await live('in_person', hallTitle, { location: 'Eagles Hall' });

    const api = await page.request.get('/api/v2/events?brand=root');
    const items = ((await api.json()) as { items: Record<string, unknown>[] }).items;
    const byId = (id: string) => items.find((i) => i.id === id);
    expect(byId(hall)?.attendance_mode).toBe('in_person');
    const item = byId(online);
    expect(item, 'the brand API returns the online event').toBeTruthy();
    expect([item!.attendance_mode, item!.location, item!.lat, item!.h3_res7]).toEqual([
      'online',
      null,
      null,
      null,
    ]);

    for (const path of ['/events', '/', '/?view=list']) {
      const body = await (await page.request.get(path)).text();
      expect(body, `${path} names the online event`).not.toContain(onlineTitle);
      expect(body, `${path} links the online event`).not.toContain(online);
    }
    // The in-person twin, made the same way at the same time, is listed.
    expect(await (await page.request.get('/events')).text()).toContain(hallTitle);
  });
});
