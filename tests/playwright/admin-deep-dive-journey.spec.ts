/**
 * The organizer's deep dive (flows O5 + O6 of docs/ops/E2E-FLOWS-MAP): the
 * advanced Create Event form, then the status panel, back and forth, in a real
 * browser at phone size.
 *
 * publish-loop-journey.spec.ts covers the wizard. This is the other door: the
 * full form an anchor or returning organizer uses, and the panel that moves an
 * event Draft → Ready → Published and back, with Undo after every move. After
 * each move the public page is fetched as a stranger, because the panel's
 * words are only true if the public side agrees.
 *
 * Runs against the local worker of playwright.mobile.config.ts.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const PHONE = { width: 375, height: 812 };
const MIN_TOUCH = 44;

test.describe.configure({ mode: 'serial' });

const title = `Deep dive ${Date.now().toString(36)}`;
let eventId = '';

async function openAdvanced(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-path-advanced').click();
  await expect(page.getByTestId('create-event-form')).toBeVisible();
}

async function selectEvent(page: Page): Promise<void> {
  await openAdvanced(page);
  await page.getByTestId('events-filter-all').click();
  const row = page.locator(`[data-testid="event-row-${eventId}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByTestId('event-status-name')).toHaveText(title);
  // Let the list finish loading: a refresh that lands after a status tap
  // repaints the panel with the status from before the tap.
  await page.waitForLoadState('networkidle');
}

/** Tap a status action, then wait for the badge to say where the event is now. */
async function move(page: Page, action: string, badge: string): Promise<void> {
  const btn = page.getByTestId(`event-status-${action}`);
  expect((await btn.boundingBox())!.height, `${action} touch target`).toBeGreaterThanOrEqual(
    MIN_TOUCH
  );
  await btn.click();
  await expect(page.getByTestId('event-status-badge')).toHaveText(badge);
}

async function undo(page: Page, badge: string): Promise<void> {
  await page.getByTestId('event-status-msg').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('event-status-badge')).toHaveText(badge);
}

const publicStatus = async (page: Page) =>
  (await page.request.get(`/events/${encodeURIComponent(eventId)}`, { headers: {} })).status();

test.beforeAll(() => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
});

test('fat finger: Create with no name says what is missing and creates nothing', async ({
  page,
}) => {
  await openAdvanced(page);
  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v2/admin/events')) posted = true;
  });
  await page.getByTestId('create-venue').fill('Eagles Hall');
  await page.getByTestId('create-submit').click();
  await expect(page.getByTestId('create-msg')).toHaveText('Event name is required.');
  expect(posted, 'nothing was sent').toBe(false);
  await expect(page.getByTestId('create-venue')).toHaveValue('Eagles Hall');
});

test('create from the full form: the event is a draft only the organizer can see', async ({
  page,
  request,
}) => {
  await openAdvanced(page);
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v2/admin/events')
  );
  await page.getByTestId('create-title').fill(title);
  const start = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
  await page.getByTestId('create-date').fill(start);
  await page.getByTestId('create-time').fill('18:30');
  await page.getByTestId('create-venue').fill('Eagles Hall');
  await page.getByTestId('create-submit').click();

  expect((await created).status()).toBe(201);
  // The page moves on as soon as the event exists, so the id is read back
  // from the organizer's own list rather than from that response.
  await expect(page.getByTestId('event-status-name')).toHaveText(title);
  const list = await request.get('/api/v2/admin/events?status=draft', {
    headers: { Authorization: `Bearer ${ADMIN_BEARER}` },
  });
  const mine = ((await list.json()) as { items: { id: string; title: string }[] }).items.find(
    (e) => e.title === title
  );
  expect(mine, 'the new event is in the Drafts list').toBeTruthy();
  eventId = mine!.id;

  await expect(page.getByTestId('event-status-name')).toHaveText(title);
  await expect(page.getByTestId('event-status-badge')).toHaveText('Draft');
  await expect(page.getByTestId('event-status-explain')).toContainText('Only you can see this');
  expect(await publicStatus(page)).toBe(404);
});

test('Mark ready without an event type says what is missing and changes nothing', async ({
  page,
  request,
}) => {
  await selectEvent(page);
  await page.getByTestId('event-status-ready').click();
  const msg = page.getByTestId('event-status-msg');
  await expect(msg).toContainText('event type');
  await expect(msg).toHaveAttribute('data-missing', 'event_type');
  await expect(page.getByTestId('event-status-badge')).toHaveText('Draft');
  // Give it a type the way the form would (OSE-1344), then the rest of the journey can go on.
  const catalog = await request.get('/api/v2/admin/event-types', {
    headers: { Authorization: `Bearer ${ADMIN_BEARER}` },
  });
  const typeId = ((await catalog.json()) as { categories: { types: { id: string }[] }[] })
    .categories[0]?.types[0]?.id;
  const put = await request.put(`/api/v2/admin/events/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${ADMIN_BEARER}` },
    data: { event_type_id: typeId },
  });
  expect(put.status()).toBe(200);
});

test('Mark ready → Undo → Mark ready: each move is one tap and reversible', async ({ page }) => {
  await selectEvent(page);
  await move(page, 'ready', 'Ready');
  await undo(page, 'Draft');
  await move(page, 'ready', 'Ready');
  expect(await publicStatus(page)).toBe(404);
});

test('Publish says when it lists; Undo inside the window leaves no public page', async ({
  page,
}) => {
  await selectEvent(page);
  await move(page, 'active', 'Published');
  await expect(page.getByTestId('event-status-msg')).toContainText('goes on the map and list at');
  expect(await publicStatus(page)).toBe(200);

  await undo(page, 'Ready');
  expect(await publicStatus(page)).toBe(404);
});

test('Publish → Take offline → Publish → Back to draft: the public page follows every move', async ({
  page,
}) => {
  await selectEvent(page);
  await move(page, 'active', 'Published');
  expect(await publicStatus(page)).toBe(200);
  await move(page, 'ready', 'Ready');
  expect(await publicStatus(page)).toBe(404);
  await move(page, 'active', 'Published');
  expect(await publicStatus(page)).toBe(200);
  await move(page, 'draft', 'Draft');
  expect(await publicStatus(page)).toBe(404);
});

// Known defect, stated as the behaviour we want. Goes red the day it is fixed.
test('a stale panel: the event moved elsewhere; the panel catches up and Undo is honest', async ({
  page,
  request,
}) => {
  test.fail(
    true,
    'Defect: Undo returns the event to the status the stale panel showed (Draft), not the one it had (Ready).'
  );
  await selectEvent(page);
  await expect(page.getByTestId('event-status-badge')).toHaveText('Draft');
  // Someone else (another tab, another organizer) marks it ready.
  const elsewhere = await request.put(`/api/v2/admin/events/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${ADMIN_BEARER}` },
    data: { status: 'ready' },
  });
  expect(elsewhere.status()).toBe(200);

  // This panel still says Draft. Archive is allowed from Ready too, so it lands.
  await move(page, 'archived', 'Archived');

  // Undo goes back to where the event really was (Ready), not to the stale Draft.
  await undo(page, 'Ready');
});

// Known defect, stated as the behaviour we want. Goes red the day it is fixed.
test('archiving an event before its date does not tell the public it happened', async ({
  page,
}) => {
  test.fail(
    true,
    'Defect: an archived event dated three weeks from now has a public page reading "Happened <future date>".'
  );
  await selectEvent(page);
  await move(page, 'archived', 'Archived');
  const res = await page.request.get(`/events/${encodeURIComponent(eventId)}`);
  expect(await res.text()).not.toContain('Happened');
});
