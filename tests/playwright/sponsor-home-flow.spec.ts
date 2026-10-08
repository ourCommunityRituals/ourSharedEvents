/**
 * Sponsor home — end to end, in a real browser, at phone size.
 *
 * Stitch #3 → #4 of the Triangle screen map (docs/ops/TRIANGLE-SCREEN-MAP-2026-09-16):
 * the organizer mints a sponsor link, the business owner opens it on a phone,
 * answers the placement, and the answer shows (or stops showing) on the public
 * event page.
 *
 * The workers-pool suite (workers/oursharedevents/tests/sponsor-home.spec.ts)
 * already proves the token, the SQL ownership check and the render. What it
 * cannot prove, and this does:
 *   - the page's one inline script actually runs under the nonce CSP and the
 *     Accept / Decline taps reach the server (no CSP violation, no console error)
 *   - the answer is still there when the link is opened again (the server, not
 *     the DOM, holds it)
 *   - the link's token leaves the address bar once the page has read it, the
 *     page keeps working without it there, and a refresh then shows "open your
 *     link again" (the token is not in the address any more, and is stored
 *     nowhere), after which the same link still opens the page
 *   - the public event page follows the answer — accepted shows the sponsor,
 *     declined removes it (ADR-019 consent; the respond handler busts the cache)
 *   - the controls are ≥ 44 px at 375×812
 *   - a tampered link shows the invalid-link page and leaks no sponsor data
 *   - the organizer's Event checklist inbox follows the sponsor's answer
 *     (waiting → declined), TRIANGLE slice #3
 *   - sponsor discovery: the sponsor asks to back another published event, the
 *     organizer sees "asked to join" and approves, and only THEN is the sponsor
 *     on that event's public page (ADR-019 two-sided consent)
 *
 * Runs in the blocking PR phone audit (playwright.mobile.config.ts): a local
 * worker with migrations, a local admin key and a local signing secret. Seeds
 * its own sponsor, so it never depends on (or disturbs) the audit's one.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  createLiveEvent,
  waitUntilListed,
  seedSponsorHome,
  type SeededSponsorHome,
} from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const MIN_TOUCH_TARGET_PX = 44;

test.describe.configure({ mode: 'serial' });

let seeded: SeededSponsorHome;

/**
 * Collect CSP violations and page errors for the life of a page.
 *
 * The one tolerated error is the browser's own /favicon.ico fetch: no OSE
 * surface declares an icon or serves that path yet, so it 404s on every page.
 * That is a site-wide gap, not this surface's — filtered by URL, never by text,
 * so any other failed load still fails the test.
 */
function watchForBreakage(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/\/favicon\.ico(\?|$)/.test(msg.location().url)) return;
    if (msg.type() === 'error' || /Content Security Policy/i.test(t)) {
      problems.push(`${t} @ ${msg.location().url}`);
    }
  });
  page.on('pageerror', (err) => problems.push(String(err)));
  return problems;
}

const sponsorPath = () => `/sponsor?t=${encodeURIComponent(seeded.token)}`;

async function publicPageShowsSponsor(page: Page): Promise<boolean> {
  const res = await page.request.get(`/events/${encodeURIComponent(seeded.eventId)}`);
  expect(res.status()).toBe(200);
  return (await res.text()).includes(seeded.sponsorName);
}

/**
 * The organizer's side of the same placement: open /admin as the local admin,
 * show Published events, select the seeded one, and return its Event checklist
 * card once it has rendered. The inbox on that card is TRIANGLE slice #3.
 */
async function openOrganizerChecklist(page: Page, eventId = seeded.eventId) {
  await page.setViewportSize({ width: 393, height: 900 });
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.click('[data-testid="admin-path-advanced"]');
  await page.click('[data-testid="events-filter-active"]');
  const row = page.locator(`[data-testid="event-row-${eventId}"]`);
  await expect(row, 'seeded event never showed in the Published list').toBeVisible({
    timeout: 15000,
  });
  await row.click();
  const card = page.getByTestId('event-timeline-card');
  await expect(card).toBeVisible({ timeout: 15000 });
  return card;
}

test.beforeAll(async ({ request }) => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
  seeded = await seedSponsorHome(request, ADMIN_BEARER, 'Flow');
});

test('the minted link opens the sponsor page with one placement waiting for an answer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const problems = watchForBreakage(page);

  const res = await page.goto(sponsorPath());
  expect(res?.status()).toBe(200);
  expect(res?.headers()['cache-control']).toContain('no-store');
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');

  await expect(page.getByTestId('sponsor-home-name')).toHaveText(seeded.sponsorName);
  // The link is the credential: once read, it is gone from the address bar.
  expect(new URL(page.url()).pathname).toBe('/sponsor');
  expect(new URL(page.url()).search).toBe('');
  expect(page.url()).not.toContain(seeded.token);
  await expect(page.getByTestId('sponsor-home-count-pending')).toHaveText('1');

  const card = page.locator(
    `[data-testid="placement-card"][data-placement-id="${seeded.placementId}"]`
  );
  await expect(card).toBeVisible();
  await expect(card.getByTestId('placement-title')).toHaveText(seeded.eventTitle);
  await expect(card.getByTestId('placement-accept')).toBeVisible();
  await expect(card.getByTestId('placement-decline')).toBeVisible();

  // Pending placements are NOT public yet (ADR-019).
  expect(await publicPageShowsSponsor(page)).toBe(false);

  for (const id of ['placement-accept', 'placement-decline']) {
    const box = await card.getByTestId(id).boundingBox();
    expect(box, `${id} has no box`).not.toBeNull();
    expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(box!.width, `${id} width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  }

  expect(problems, problems.join('\n')).toEqual([]);
});

test('organizer inbox: the checklist says the sponsor has not answered yet', async ({ page }) => {
  const problems = watchForBreakage(page);
  const card = await openOrganizerChecklist(page);
  const waiting = card.getByTestId('inbox-sponsors-waiting');
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText('1 sponsor has not answered');
  await expect(waiting).toContainText(seeded.sponsorName);
  await expect(card.getByTestId('inbox-sponsors-declined')).toHaveCount(0);
  // Next stays in chain order (no poster yet → "print a poster" first); the
  // inbox is what surfaces the sponsor, whatever Next says. The sponsor-specific
  // Next is unit-tested in admin-organizer-inbox.spec.ts.
  const action = await card.getByTestId('inbox-sponsors-waiting-action').boundingBox();
  expect(action!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Accept: the card updates, the answer is there when the link is opened again, and the event page shows the sponsor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const problems = watchForBreakage(page);
  await page.goto(sponsorPath());

  const card = page.locator(
    `[data-testid="placement-card"][data-placement-id="${seeded.placementId}"]`
  );
  const respond = page.waitForResponse(
    (r) =>
      r.url().includes(`/placements/${seeded.placementId}/respond`) &&
      r.request().method() === 'POST'
  );
  await card.getByTestId('placement-accept').click();
  expect((await respond).status()).toBe(200);

  await expect(card.getByTestId('placement-state')).toHaveText('Accepted');
  await expect(card).toHaveAttribute('data-sponsor-accepted', '1');
  await expect(card.getByTestId('placement-accept')).toBeHidden();
  await expect(card.getByTestId('placement-decline')).toBeVisible();
  await expect(page.getByTestId('sponsor-home-count-pending')).toHaveText('0');

  // Opening the link again, not a refresh: the token has left the address bar,
  // so a refresh asks for /sponsor with no token (its own test below).
  await page.goto(sponsorPath());
  await expect(card.getByTestId('placement-state')).toHaveText('Accepted');
  await expect(page.getByTestId('sponsor-home-count-pending')).toHaveText('0');

  expect(await publicPageShowsSponsor(page)).toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Decline (changing their mind): the card updates and the event page drops the sponsor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const problems = watchForBreakage(page);
  await page.goto(sponsorPath());

  const card = page.locator(
    `[data-testid="placement-card"][data-placement-id="${seeded.placementId}"]`
  );
  await card.getByTestId('placement-decline').click();

  await expect(card.getByTestId('placement-state')).toHaveText('Declined');
  await expect(card).toHaveAttribute('data-sponsor-accepted', '0');
  await expect(card.getByTestId('placement-accept')).toBeVisible();
  await expect(card.getByTestId('placement-decline')).toBeHidden();

  await page.goto(sponsorPath());
  await expect(card.getByTestId('placement-state')).toHaveText('Declined');

  expect(await publicPageShowsSponsor(page)).toBe(false);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('organizer inbox: after the decline the checklist says so, and nothing is waiting', async ({
  page,
}) => {
  const card = await openOrganizerChecklist(page);
  const declined = card.getByTestId('inbox-sponsors-declined');
  await expect(declined).toBeVisible();
  await expect(declined).toContainText('1 sponsor declined');
  await expect(declined).toContainText(seeded.sponsorName);
  await expect(card.getByTestId('inbox-sponsors-waiting')).toHaveCount(0);
});

test('a refresh after the token has left the address bar says to open the link again, and the link still works', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const problems = watchForBreakage(page);
  await page.goto(sponsorPath());
  await expect(page.getByTestId('sponsor-home-name')).toHaveText(seeded.sponsorName);
  expect(page.url()).not.toContain(seeded.token);

  // The token is kept in the page only: no cookie, nothing in browser storage.
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(problems, problems.join('\n')).toEqual([]);

  const res = await page.reload();
  expect(res?.status()).toBe(401);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByTestId('error-title')).toHaveText('Open your sponsor link again');
  await expect(page.getByTestId('error-body')).toContainText('It still works');
  const body = await page.content();
  expect(body).not.toContain(seeded.sponsorName);
  expect(body).not.toContain(seeded.eventTitle);
  await expect(page.getByTestId('placement-card')).toHaveCount(0);

  // The same link, opened again, is the sponsor's page.
  const again = await page.goto(sponsorPath());
  expect(again?.status()).toBe(200);
  await expect(page.getByTestId('sponsor-home-name')).toHaveText(seeded.sponsorName);
});

test('a tampered link shows the invalid-link page and no sponsor data', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const [payload, sig] = seeded.token.split('.');
  const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  const res = await page.goto(`/sponsor?t=${encodeURIComponent(`${payload}.${flipped}`)}`);
  expect(res?.status()).toBe(401);
  const body = await page.content();
  expect(body).not.toContain(seeded.sponsorName);
  expect(body).not.toContain(seeded.eventTitle);
  await expect(page.getByTestId('placement-card')).toHaveCount(0);
});

test.describe('sponsor discovery: ask to join → organizer approves', () => {
  let otherEventId = '';
  let otherListedFrom: string | null = null;
  test.beforeAll(async ({ request }) => {
    // Dated today: "Events you could back" lists the soonest MAX_DISCOVERABLE
    // (20), and the shared local worker holds every other spec's events too.
    const ev = await createLiveEvent(request, ADMIN_BEARER, `Discover ${Date.now()}`, 0);
    otherEventId = ev.id;
    otherListedFrom = ev.listedFrom;
  });

  test('the sponsor asks from their page; the event page still does not show them', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 812 });
    const problems = watchForBreakage(page);
    const card = page.locator(`[data-testid="discover-card"][data-event-id="${otherEventId}"]`);
    // Publish grace window: just published, so sponsors cannot find it yet.
    expect(otherListedFrom, 'publish should start a grace window').not.toBeNull();
    await page.goto(sponsorPath());
    await expect(card).toHaveCount(0);
    await waitUntilListed(otherListedFrom);
    await page.goto(sponsorPath());
    await expect(card).toBeVisible();
    const askBtn = card.getByTestId('discover-ask');
    const box = await askBtn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    await askBtn.click();
    await expect(card).toHaveAttribute('data-requested', '1');
    await expect(askBtn).toBeHidden();

    await page.goto(sponsorPath());
    await expect(
      page.locator(`[data-testid="request-card"][data-event-id="${otherEventId}"]`)
    ).toContainText('Waiting for the organizer');

    const pub = await page.request.get(`/events/${encodeURIComponent(otherEventId)}`);
    expect(await pub.text()).not.toContain(seeded.sponsorName);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the organizer sees the request, approves it, and the sponsor goes public', async ({
    page,
  }) => {
    const problems = watchForBreakage(page);
    const card = await openOrganizerChecklist(page, otherEventId);
    const asked = card.getByTestId('inbox-sponsors-asked');
    await expect(asked).toBeVisible();
    await expect(asked).toContainText('1 sponsor asked to join');
    await expect(asked).toContainText(seeded.sponsorName);

    const approve = page.getByTestId(`request-approve-${seeded.sponsorId}`);
    await expect(approve).toBeVisible({ timeout: 15000 });
    await approve.click();
    await expect(page.getByTestId(`spon-status-${seeded.sponsorId}`)).toHaveText('Active', {
      timeout: 15000,
    });
    await expect(card.getByTestId('inbox-sponsors-asked')).toHaveCount(0);

    const pub = await page.request.get(`/events/${encodeURIComponent(otherEventId)}`);
    expect(await pub.text()).toContain(seeded.sponsorName);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
