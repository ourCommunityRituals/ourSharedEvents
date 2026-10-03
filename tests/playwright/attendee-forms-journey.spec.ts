/**
 * The attendee's path, in a real browser at phone size: event page → register
 * → back → check in. With the mistakes a person on a phone makes (empty name,
 * a mistyped email, a server hiccup) and what the page says when they do.
 *
 * The workers-pool form specs prove the handlers. This proves what only a
 * browser shows: the tap reaches the server, the page says so, a mistake keeps
 * the person on the form with what they typed, and Back goes where it should.
 *
 * Three tests are marked `test.fail()`: they state how the form should behave
 * and fail today. Each goes red the day its defect is fixed, which is the cue
 * to drop the marker.
 *
 * Runs against the local worker of playwright.mobile.config.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const PHONE = { width: 375, height: 812 };
const MIN_TOUCH = 44;

test.describe.configure({ mode: 'serial' });

let eventId = '';
let eventTitle = '';
const admin = () => ({ Authorization: `Bearer ${ADMIN_BEARER}` });
const formUrl = (type: string, id = eventId) => `/forms/${encodeURIComponent(id)}?type=${type}`;

function countPosts(page: Page, path: string): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(path)) n++;
  });
  return () => n;
}

test.beforeAll(async ({ request }) => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
  eventTitle = `Forms night ${Date.now().toString(36)}`;
  eventId = (await createLiveEvent(request, ADMIN_BEARER, eventTitle)).id;
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
});

test('event page → Register is one tap, and Back returns to the event page', async ({ page }) => {
  await page.goto(`/events/${encodeURIComponent(eventId)}`);
  const rsvp = page.getByTestId('event-rsvp');
  expect((await rsvp.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TOUCH);
  await rsvp.click();
  await expect(page.getByTestId('form-event-name')).toHaveText(eventTitle);
  await expect(page.getByTestId('register-name-input')).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId('event-title')).toHaveText(eventTitle);
});

test('fat finger: an empty name or a mistyped email sends nothing and keeps what was typed', async ({
  page,
}) => {
  const posts = countPosts(page, '/forms/register');
  await page.goto(formUrl('register'));
  const name = page.getByTestId('register-name-input');
  const email = page.getByTestId('register-email-input');

  await page.getByTestId('register-submit').click();
  expect(await name.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);

  await name.fill('Pat Tester');
  await email.fill('pat@');
  await page.getByTestId('register-submit').click();
  expect(await email.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);

  expect(posts(), 'nothing was sent').toBe(0);
  await expect(name).toHaveValue('Pat Tester');
  await expect(page.getByTestId('form-success')).toBeHidden();
});

test('register: the page confirms it, and the organizer count goes up by one', async ({
  page,
  request,
}) => {
  const before = await request.get(
    `/api/v2/admin/events/${encodeURIComponent(eventId)}/forms/registrations`,
    { headers: admin() }
  );
  const countBefore = ((await before.json()) as { items?: unknown[] }).items?.length ?? 0;

  await page.goto(formUrl('register'));
  await page.getByTestId('register-name-input').fill('Pat Tester');
  await page.getByTestId('register-email-input').fill('pat.tester@example.com');
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('form-success')).toContainText("You're registered");

  const after = await request.get(
    `/api/v2/admin/events/${encodeURIComponent(eventId)}/forms/registrations`,
    { headers: admin() }
  );
  expect(after.status()).toBe(200);
  const countAfter = ((await after.json()) as { items?: unknown[] }).items?.length ?? 0;
  expect(countAfter).toBe(countBefore + 1);
});

test('a server hiccup says so, keeps the name, and a second tap works', async ({ page }) => {
  await page.goto(formUrl('register'));
  await page.route('**/forms/register', (route) => route.fulfill({ status: 500, body: '{}' }), {
    times: 1,
  });
  await page.getByTestId('register-name-input').fill('Pat Retry');
  await page.getByTestId('register-submit').click();

  const error = page.getByTestId('form-error').first();
  await expect(error).toBeVisible();
  await expect(error).not.toContainText(/500|error code|undefined|null/i);
  await expect(page.getByTestId('register-name-input')).toHaveValue('Pat Retry');
  await expect(page.getByTestId('register-submit')).toBeEnabled();

  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('form-success')).toContainText("You're registered");
});

test('check in: one tap, the count shows, and a walk-in adds one more', async ({
  page,
  request,
}) => {
  await page.goto(formUrl('checkin'));
  const tap = page.getByTestId('checkin-submit');
  expect((await tap.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TOUCH);
  await tap.click();
  await expect(page.getByTestId('checkin-count')).toHaveText('1 checked in');

  await page.goto(formUrl('checkin'));
  await page.getByTestId('checkin-walk-in-submit').click();
  await expect(page.getByTestId('checkin-count')).toHaveText('2 checked in');

  // Two people is under the count floor of 5: the organizer is told the count
  // is withheld, not shown a small number.
  const res = await request.get(
    `/api/v2/admin/events/${encodeURIComponent(eventId)}/forms/checkin-count`,
    { headers: admin() }
  );
  expect(await res.json()).toMatchObject({ suppressed: true, floor: 5 });
});

// ── Known defects, stated as the behaviour we want ───────────────────────────

test('a second tap on the same phone does not check the same person in twice', async ({ page }) => {
  test.fail(true, 'Defect: the button stays live after a check-in, so every extra tap adds one.');
  await page.goto(formUrl('checkin'));
  const tap = page.getByTestId('checkin-submit');
  await tap.click();
  const count = page.getByTestId('checkin-count');
  await expect(count).toContainText('checked in');
  const first = await count.innerText();
  await tap.click({ timeout: 3000 });
  await page.waitForTimeout(1000);
  await expect(count).toHaveText(first);
});

test('a form link for an event that does not exist does not take a registration', async ({
  page,
}) => {
  test.fail(true, 'Defect: /forms/<unknown id> renders a form and confirms "You\'re registered!".');
  const res = await page.goto(formUrl('register', 'evt_no_such_event'));
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId('register-submit')).toHaveCount(0);
});

test('a survey that is switched off is not offered', async ({ page }) => {
  test.fail(
    true,
    'Defect: the survey form renders while surveys are off; Submit answers "something went wrong".'
  );
  await page.goto(formUrl('survey'));
  await expect(page.locator('button[type="submit"]')).toHaveCount(0);
});
