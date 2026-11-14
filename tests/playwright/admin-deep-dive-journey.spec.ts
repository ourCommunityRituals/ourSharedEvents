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
  await expect(page.getByTestId('events-section')).toBeVisible();
}

/**
 * A returning host (the phone audit seeds events first) finds Your events first
 * and Create Event folded into one button (owner 2026-10-10); the button opens
 * the form.
 */
async function openCreateForm(page: Page): Promise<void> {
  await openAdvanced(page);
  const toggle = page.getByTestId('create-event-toggle');
  await expect(toggle).toBeVisible();
  await expect(page.getByTestId('create-event-form')).toBeHidden();
  await toggle.click();
  await expect(page.getByTestId('create-event-form')).toBeVisible();
  await expect(page.getByTestId('create-title')).toBeFocused();
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
  await openCreateForm(page);
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
  await openCreateForm(page);
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v2/admin/events')
  );
  await page.getByTestId('create-title').fill(title);
  const start = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
  await page.getByTestId('create-date').fill(start);
  await page.getByTestId('create-time').fill('18:30');
  await page.getByTestId('create-venue').fill('Eagles Hall');
  // OSE-1560: a new event is off the map unless the operator says otherwise; this journey puts it on.
  await page.getByTestId('create-published').check();
  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v2/admin/events')) posted = true;
  });
  await page.getByTestId('create-submit').click();

  // OSE-1644: no event type yet, so the form asks once before it creates
  // anything: it names the value, marks the field and puts focus there.
  await expect(page.getByTestId('create-msg')).toHaveText(
    'Add an event type before this event can be published. Press Create Event again to save it as a draft without it.'
  );
  await expect(page.getByTestId('create-category')).toBeFocused();
  await expect(page.getByTestId('create-category')).toHaveAttribute('aria-invalid', 'true');
  expect(posted, 'the first press sent nothing').toBe(false);

  // Asked, never required: a second press saves the draft as it is. The next
  // test relies on this draft having no event type.
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

// Another tab moved the event. Undo goes back to where the server says it was
// (PUT status answers with `from`), not to what this panel last showed.
test('a stale panel: the event moved elsewhere; the panel catches up and Undo is honest', async ({
  page,
  request,
}) => {
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

// The event is three weeks out: archived now, it never happened, and the page says so.
test('archiving an event before its date does not tell the public it happened', async ({
  page,
}) => {
  await selectEvent(page);
  await move(page, 'archived', 'Archived');
  const res = await page.request.get(`/events/${encodeURIComponent(eventId)}`);
  const html = await res.text();
  expect(html).not.toContain('Happened');
  expect(html).toContain('No longer taking place.');
});

// OSE-1560: the map is off by default, the panel says so and says it stays true,
// and the organizer adding a sponsor turns it on without a reload.
test.describe('the map setting', () => {
  const headers = () => ({
    Authorization: `Bearer ${ADMIN_BEARER}`,
    'Content-Type': 'application/json',
  });

  async function newEvent(request: import('@playwright/test').APIRequestContext, label: string) {
    const res = await request.post('/api/v2/admin/events', {
      headers: headers(),
      data: {
        attendance_mode: 'in_person',
        title: `${label} ${Date.now().toString(36)}`,
        start_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        location: 'Eagles Hall',
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { id: string; map: { on: boolean; note: string | null } };
    return { id: body.id, title: label, map: body.map };
  }

  async function open(page: Page, id: string, title: string) {
    await openAdvanced(page);
    await page.getByTestId('events-filter-all').click();
    const row = page.locator(`[data-testid="event-row-${id}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByTestId('event-status-name')).toContainText(title);
    await page.waitForLoadState('networkidle');
  }

  test('a new event is off the map; the panel says so, and Put on the map / Turn off work', async ({
    page,
    request,
  }) => {
    const ev = await newEvent(request, 'Map off');
    expect(ev.map.on).toBe(false);
    expect(ev.map.note).toBe("This event isn't on the map. You can turn that on any time.");
    await open(page, ev.id, 'Map off');

    const state = page.getByTestId('event-map-state');
    const toggle = page.getByTestId('event-map-toggle');
    await expect(state).toHaveText("This event isn't on the map. You can turn that on any time.");
    await expect(toggle).toHaveText('Put on the map');
    expect((await toggle.boundingBox())!.height, 'map toggle touch target').toBeGreaterThanOrEqual(
      MIN_TOUCH
    );

    await toggle.click();
    await expect(state).toHaveText('This event is on the map.');
    await expect(toggle).toHaveText('Turn off the map');
    const listed = await request.get('/api/v2/admin/events?limit=100', { headers: headers() });
    const row = (
      (await listed.json()) as { items: { id: string; is_published: number }[] }
    ).items.find((e) => e.id === ev.id);
    expect(row!.is_published).toBe(1);

    await toggle.click();
    await expect(state).toContainText('as you chose');
    await expect(toggle).toHaveText('Put on the map');
  });

  test('the organizer adding a sponsor turns the default map on, and the panel shows it', async ({
    page,
    request,
  }) => {
    const ev = await newEvent(request, 'Map sponsor');
    await open(page, ev.id, 'Map sponsor');
    await expect(page.getByTestId('event-map-state')).toContainText("isn't on the map");

    const sp = await request.post('/api/v2/admin/sponsors', {
      headers: headers(),
      data: { name: `Map sponsor co ${Date.now().toString(36)}`, tier: 'gold', event_id: ev.id },
    });
    expect(sp.status()).toBe(201);
    expect(((await sp.json()) as { map?: { changed: boolean } }).map?.changed).toBe(true);

    // A reload shows what the server now says (the dashboard opens straight
    // away on the second visit, so the front door is skipped).
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('events-filter-all').click();
    await page.locator(`[data-testid="event-row-${ev.id}"]`).click();
    await expect(page.getByTestId('event-status-name')).toContainText('Map sponsor');
    await expect(page.getByTestId('event-map-state')).toHaveText('This event is on the map.');
  });

  test("a sponsor never overrides the organizer's own off", async ({ page, request }) => {
    const ev = await newEvent(request, 'Map chose off');
    const off = await request.put(`/api/v2/admin/events/${encodeURIComponent(ev.id)}`, {
      headers: headers(),
      data: { is_published: false },
    });
    expect(off.status()).toBe(200);
    const sp = await request.post('/api/v2/admin/sponsors', {
      headers: headers(),
      data: { name: `Map off co ${Date.now().toString(36)}`, tier: 'gold', event_id: ev.id },
    });
    expect(sp.status()).toBe(201);
    expect(((await sp.json()) as { map?: unknown }).map).toBeUndefined();
    await open(page, ev.id, 'Map chose off');
    await expect(page.getByTestId('event-map-state')).toContainText('as you chose');
  });
});
