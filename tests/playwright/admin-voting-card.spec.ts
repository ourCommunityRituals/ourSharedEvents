/**
 * Admin: the Voting card (OSE-2127, OSE ADR-040), driven in a browser at phone width.
 *
 * The routes are tested in workers/oursharedevents/tests/vote-set-admin.spec.ts.
 * This spec proves the card works on the page as served: its buttons answer
 * through the page's delegated action table under the CSP nonce, its writes
 * pass the admin write guard, and the list shows what the server holds.
 *
 *   1. Set up voting; a label with an email address is refused at its field;
 *      a song is added and listed.
 *   2. Open voting, open the song ("Open until …"); the song has no Close or
 *      Reopen (a window runs its full length); close voting, and a reopen is
 *      refused once a window has run. The summary follows each step.
 *   3. The card never shows a count: no "vote" or "votes" next to a number.
 *   4. At 375px: no sideways scroll, every control 44px or more, every field's
 *      text 16px or more, and axe finds nothing serious, light and dark.
 *   5. A write that finishes after another event is selected leaves the new
 *      event's card alone, and the next action goes to the new event (PR #1432
 *      review).
 *   6. OSE-2142: on a draft event Open is greyed out and the card says
 *      "Publish the event to open voting."; once the event is Published it opens.
 *   7. OSE-2140: the room's vote code is made from the card, which shows its
 *      `/q` URL (asking for a pass) and its QR, and is replaced from it.
 *   8. OSE-2234: the room check warning and the host-only burst warning are
 *      hidden on a normal night and show, with no number, when the set says so.
 *   9. The room size: voting does not open without it, and once open it is
 *      shown as fixed and no longer asked for (2026-11-26).
 *  10. OSE ADR-040 decision 13: an Access Pass is given from the card, its
 *      link shown once; it is taken back and the place is not freed; the
 *      Online Pick is turned on and off; its host-only swarm warning shows
 *      only when the server says so.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts), against the
 * local worker that config starts with a local pepper. The event is made here.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const AUTH = { Authorization: `Bearer ${ADMIN_BEARER}` };
const VOTE_BRAND = 'pw-vote-night';

test.describe.configure({ mode: 'serial' });

test.describe('admin: the Voting card', () => {
  let eventId = '';

  test.beforeAll(async ({ request }) => {
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    const res = await request.post('/api/v2/admin/events', {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {
        attendance_mode: 'in_person',
        brand_id: VOTE_BRAND,
        title: `Vote night ${Date.now()}`,
        start_date: '2027-05-15',
        start_time: '19:00',
        timezone: 'America/Chicago',
        event_type_id: 'etr-rec-bocce',
        location: 'Eagles Hall',
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    eventId = ((await res.json()) as { id?: string }).id ?? '';
    expect(eventId).not.toBe('');
    await linkVenue(request, eventId);
  });

  /**
   * Voting opens only on an event linked to its venue (owner card 2026-11-26,
   * VENUE_NEEDED). The shared public brand holds no venue, so the events here
   * get a brand of their own and a venue it owns.
   */
  async function linkVenue(
    request: import('@playwright/test').APIRequestContext,
    id: string
  ): Promise<void> {
    const venue = await request.post('/api/v2/admin/venues', {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: { brand_id: VOTE_BRAND, name: 'Eagles Hall' },
    });
    expect(venue.status(), await venue.text()).toBe(201);
    const venueId = ((await venue.json()) as { id: string }).id;
    const linked = await request.put(`/api/v2/admin/events/${id}/venue`, {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: { venue_id: venueId },
    });
    expect(linked.status(), await linked.text()).toBe(200);
  }

  async function makeEvent(
    request: import('@playwright/test').APIRequestContext,
    title: string,
    status: 'draft' | 'active' = 'draft'
  ): Promise<string> {
    const res = await request.post('/api/v2/admin/events', {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {
        attendance_mode: 'in_person',
        brand_id: VOTE_BRAND,
        title,
        status,
        is_published: false,
        start_date: '2027-05-15',
        start_time: '19:00',
        timezone: 'America/Chicago',
        event_type_id: 'etr-rec-bocce',
        location: 'Eagles Hall',
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const id = ((await res.json()) as { id: string }).id;
    await linkVenue(request, id);
    return id;
  }

  async function selectEvent(page: Page, id: string): Promise<void> {
    // From an event's view the way back is "Your events"; from the start, the path chip.
    const back = page.getByTestId('ecb-nav-your-events');
    if (await back.isVisible()) await back.click();
    else await page.click('[data-testid="admin-path-events"]');
    // The list opens on Drafts; a Published night (OSE-2142) is under All.
    await page.getByTestId('events-filter-all').click();
    const row = page.locator(`[data-testid="event-row-${id}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
  }

  async function openCard(page: Page): Promise<void> {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setExtraHTTPHeaders(AUTH);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.click('[data-testid="admin-path-events"]');
    // The list opens on Drafts; the night is Published from the second case on.
    await page.getByTestId('events-filter-all').click();
    const row = page.locator(`[data-testid="event-row-${eventId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByTestId('votes-card')).toBeVisible();
    await expect(page.getByTestId('votes-summary')).not.toHaveText('');
    await page.getByTestId('votes-toggle').click();
    await expect(page.getByTestId('votes-body')).toBeVisible();
  }

  const rows = (page: Page) => page.locator('#votes-list [data-testid="vote-row"]');
  const summary = (page: Page) => page.getByTestId('votes-summary');

  test('set up voting and add a song; an email address is refused at its field', async ({
    page,
  }) => {
    await openCard(page);
    await expect(summary(page)).toHaveText('Voting is not set up for this event.');
    await page.getByTestId('votes-make-btn').click();
    await expect(summary(page)).toHaveText('Voting is set up, not open yet.');
    await expect(page.getByTestId('votes-empty')).toBeVisible();

    await page.getByTestId('vote-label-input').fill('rosa@example.com');
    await page.getByTestId('vote-add-btn').click();
    await expect(page.getByTestId('vote-label-error')).toContainText('email address');
    await expect(page.getByTestId('vote-label-input')).toHaveAttribute('aria-invalid', 'true');

    await page.getByTestId('vote-label-input').fill('Song one');
    await page.getByTestId('vote-add-btn').click();
    await expect(page.getByTestId('votes-msg')).toHaveText('Song added.');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByTestId('vote-row-label')).toHaveText('Song one');
    await expect(rows(page).first().getByTestId('vote-row-state')).toHaveText('Not opened yet');
    await expect(page.getByTestId('vote-kind-input')).toBeDisabled();
  });

  test('an entry can be added, under the warning to name the work (OSE-2224, OSE-2225)', async ({
    page,
    request,
  }) => {
    // Its own event: the night above already holds songs, and a set holds one kind.
    const fair = await makeEvent(request, `Art fair ${Date.now()}`);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setExtraHTTPHeaders(AUTH);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await selectEvent(page, fair);
    await page.getByTestId('votes-toggle').click();
    await page.getByTestId('votes-make-btn').click();
    await expect(page.getByTestId('vote-label-warning')).toHaveText(
      'Name the work, not the person who made it.'
    );
    await page.getByTestId('vote-kind-input').selectOption('entry');
    await page.getByTestId('vote-label-input').fill('Call 312 555 0199');
    await page.getByTestId('vote-add-btn').click();
    await expect(page.getByTestId('vote-label-error')).toContainText('phone number');

    await page.getByTestId('vote-label-input').fill('The blue float');
    await page.getByTestId('vote-add-btn').click();
    await expect(page.getByTestId('votes-msg')).toHaveText('Entry added.');
    await expect(rows(page).first().getByTestId('vote-row-label')).toHaveText('The blue float');
    await expect(rows(page).first().getByTestId('vote-row-kind')).toHaveText('Entry');
  });

  test('a draft event: Open is greyed out and the card says to publish (OSE-2142)', async ({
    page,
    request,
  }) => {
    await openCard(page);
    await expect(page.getByTestId('votes-open')).toBeDisabled();
    await expect(page.getByTestId('votes-publish-hint')).toHaveText(
      'Publish the event to open voting.'
    );
    await expect(page.getByTestId('votes-open')).toHaveAttribute(
      'aria-describedby',
      'votes-publish-hint'
    );
    // Published (unlisted), the card offers Open.
    for (const status of ['ready', 'active']) {
      const put = await request.put(`/api/v2/admin/events/${eventId}`, {
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        data: { status },
      });
      expect(put.ok(), await put.text()).toBe(true);
    }
    await page.evaluate(
      (id) => (window as unknown as { loadVotes: (x: string) => Promise<void> }).loadVotes(id),
      eventId
    );
    await expect(page.getByTestId('votes-publish-hint')).toBeHidden();
    await expect(page.getByTestId('votes-open')).toBeEnabled();
  });

  test('make the room vote code: its /q URL and QR show on the card (OSE-2140)', async ({
    page,
  }) => {
    await openCard(page);
    await expect(page.getByTestId('votes-code')).toBeVisible();
    await expect(page.getByTestId('votes-code-show')).toBeHidden();
    await page.getByTestId('votes-code-make').click();
    await expect(page.getByTestId('votes-msg')).toHaveText(
      'The vote code is ready. Show it on the room screen.'
    );
    await expect(page.getByTestId('votes-code-url')).toHaveText(
      /\/q\/qrt_[0-9a-f]{32}\?type=vote&w=\d+\.[0-9a-f]{32}$/
    );
    await expect(page.getByTestId('votes-code-qr')).toBeVisible();
    await expect(page.getByTestId('votes-code-make')).toBeHidden();
    // A photographed code is replaced: a new token, the old one retired.
    const first = await page.getByTestId('votes-code-url').innerText();
    await page.getByTestId('votes-code-replace').click();
    await expect(page.getByTestId('votes-msg')).toHaveText(
      'The old code no longer works. Show the new one on the room screen.'
    );
    await expect(page.getByTestId('votes-code-url')).not.toHaveText(first);
    await expect(page.getByTestId('votes-code-url')).toHaveText(
      /\/q\/qrt_[0-9a-f]{32}\?type=vote&w=\d+\.[0-9a-f]{32}$/
    );
  });

  test('open voting and the song, then close voting for good; the summary follows', async ({
    page,
  }) => {
    await openCard(page);
    // The song cannot open before voting does: its only button appears once voting is open.
    await expect(rows(page).first().getByTestId('vote-row-open')).toHaveCount(0);
    // No room size: voting does not open, and the card says what is missing.
    await expect(page.getByTestId('votes-room-field')).toBeVisible();
    await page.getByTestId('votes-open').click();
    await expect(page.getByTestId('votes-msg')).toHaveText(
      'Say how many the room can hold, then open voting.'
    );
    await expect(summary(page)).toHaveText('Voting is set up, not open yet.');
    await page.getByTestId('votes-room-size').fill('120');
    await page.getByTestId('votes-open').click();
    await expect(summary(page)).toHaveText('Voting is open.');
    // The room size is fixed once voting opens: shown, and no longer asked for.
    await expect(page.getByTestId('votes-room-field')).toBeHidden();
    await expect(page.getByTestId('votes-room')).toHaveText('Room size: 120. It cannot change.');

    await rows(page).first().getByTestId('vote-row-open').click();
    await expect(rows(page).first().getByTestId('vote-row-state')).toHaveText(/^Open until /);
    // A window runs its full length (owner, 2026-11-26): no Close, no Reopen on the row.
    await expect(rows(page).first().getByTestId('vote-row-close')).toHaveCount(0);
    await expect(rows(page).first().getByTestId('vote-row-reopen')).toHaveCount(0);

    // Closing voting is an emergency stop: once a window has run it stays closed.
    await page.getByTestId('votes-close').click();
    await expect(summary(page)).toHaveText('Voting is closed.');
    await page.getByTestId('votes-reopen').click();
    await expect(page.getByTestId('votes-msg')).toHaveText(
      'Voting already ran here, so once closed it stays closed. Finish the vote to see the result.'
    );
    await expect(summary(page)).toHaveText('Voting is closed.');
  });

  test('Access Pass and Online Pick: give, take back, on and off (ADR-040 decision 13)', async ({
    page,
  }) => {
    await openCard(page);
    await expect(page.getByTestId('votes-away')).toBeVisible();
    await expect(page.getByTestId('votes-access-left')).toHaveText('4 Access Passes left to give.');
    await page.getByTestId('votes-access-give').click();
    await expect(page.getByTestId('votes-access-new')).toBeVisible();
    await expect(page.getByTestId('votes-access-url')).toHaveText(/\/access#[A-Za-z0-9_-]{43}$/);
    await expect(page.getByTestId('votes-access-left')).toHaveText('3 Access Passes left to give.');
    const passRows = page.locator('[data-testid="vote-access-row"]');
    await expect(passRows).toHaveCount(1);
    await expect(passRows.first().getByTestId('vote-access-row-state')).toHaveText('Can vote');
    // Taking it back is for good, and does not free a place.
    await passRows.first().getByTestId('vote-access-row-revoke').click();
    await expect(passRows.first().getByTestId('vote-access-row-state')).toHaveText('Taken back');
    await expect(passRows.first().getByTestId('vote-access-row-revoke')).toHaveCount(0);
    await expect(page.getByTestId('votes-access-left')).toHaveText('3 Access Passes left to give.');
    // The link is shown once: opening the admin again never shows it.
    // A new browser, as the next test would get: the admin would otherwise reopen the event it remembers.
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await openCard(page);
    await expect(page.getByTestId('votes-access-new')).toBeHidden();
    expect(await page.getByTestId('votes-card').innerText()).not.toMatch(/\/access#/);

    await expect(page.getByTestId('votes-online-state')).toHaveText('The Online Pick is off.');
    await expect(page.getByTestId('votes-online-burst')).toBeHidden();
    await page.getByTestId('votes-online-on').click();
    await expect(page.getByTestId('votes-online-state')).toHaveText('The Online Pick is on.');
    await page.getByTestId('votes-online-off').click();
    await expect(page.getByTestId('votes-online-state')).toHaveText('The Online Pick is off.');
  });

  test('the Online Pick swarm warning shows only when the server says so, with no number', async ({
    page,
  }) => {
    await page.route(`**/api/v2/admin/events/${eventId}/votables`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { online_pick?: Record<string, unknown> };
      body.online_pick = { on: true, final: false, burst_seen: true };
      await route.fulfill({ response: res, json: body });
    });
    await openCard(page);
    const burst = page.getByTestId('votes-online-burst');
    await expect(burst).toBeVisible();
    await expect(burst).toContainText('Only you see this');
    expect(await burst.innerText()).not.toMatch(/\d/);
  });

  test('a write that ends after another event is selected leaves the new card alone', async ({
    page,
    request,
  }) => {
    const first = await makeEvent(request, `Vote night A ${Date.now()}`, 'active');
    const second = await makeEvent(request, `Vote night B ${Date.now()}`);
    const made = await request.post(`/api/v2/admin/events/${first}/votables`, {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {},
    });
    expect(made.status()).toBe(201);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.setExtraHTTPHeaders(AUTH);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await selectEvent(page, first);
    await page.getByTestId('votes-toggle').click();
    await expect(summary(page)).toHaveText('Voting is set up, not open yet.');

    // Hold the open request for the first event until the second is on screen.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(`**/api/v2/admin/events/${first}/votables/open`, async (route) => {
      await held;
      await route.continue();
    });
    await page.getByTestId('votes-room-size').fill('80');
    await page.getByTestId('votes-open').click();
    await selectEvent(page, second);
    await expect(summary(page)).toHaveText('Voting is not set up for this event.');

    const answered = page.waitForResponse(`**/api/v2/admin/events/${first}/votables/open`);
    release();
    await answered;
    await page.waitForTimeout(500);
    await expect(summary(page)).toHaveText('Voting is not set up for this event.');
    await expect(page.getByTestId('votes-msg')).toHaveText('');
    expect(
      await page.evaluate(() => (window as unknown as { _votesEventId: string })._votesEventId)
    ).toBe(second);

    // The next action goes to the event on screen.
    await page.getByTestId('votes-make-btn').click();
    await expect(summary(page)).toHaveText('Voting is set up, not open yet.');
    const read = await request.get(`/api/v2/admin/events/${second}/votables`, { headers: AUTH });
    expect(((await read.json()) as { set: { event_id: string } | null }).set?.event_id).toBe(
      second
    );
  });

  test('the card never shows a count', async ({ page }) => {
    await openCard(page);
    const text = (await page.getByTestId('votes-card').innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/\d+\s*votes?\b/i);
    expect(text).not.toMatch(/\bvotes?\s*:\s*\d/i);
    expect(text).not.toMatch(/fewer than 5|withheld|margin|floor/i);
    // OSE-2234: a night with no flag shows neither warning.
    await expect(page.getByTestId('votes-flood')).toBeHidden();
    await expect(page.getByTestId('votes-burst')).toBeHidden();
  });

  test('the flood warning: shown, with no number, when the set says a flood was seen (OSE-2234)', async ({
    page,
  }) => {
    // The flag cannot be raised from a browser here (it needs a burst of vote
    // passes), so the set answer is changed on its way to the page: the card
    // must show what the server says, and only a flag, never a number. A
    // normal night's card hides it ("the card never shows a count", above).
    await page.route(`**/api/v2/admin/events/${eventId}/votables`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { set?: Record<string, unknown> };
      if (body.set) {
        body.set.flood_seen = true;
        body.set.burst_seen = true;
      }
      await route.fulfill({ response: res, json: body });
    });
    await openCard(page);
    const warn = page.getByTestId('votes-flood');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('the result says it may be padded');
    expect(await warn.innerText()).not.toMatch(/\d/);
    // The burst alarm is the host's only (owner, 2026-11-26).
    const burst = page.getByTestId('votes-burst');
    await expect(burst).toBeVisible();
    await expect(burst).toContainText('Only you see this');
    expect(await burst.innerText()).not.toMatch(/\d/);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const results = await new AxeBuilder({ page })
        .include('[data-testid="votes-card"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found, `${colorScheme}:\n${found.join('\n')}`).toEqual([]);
    }
  });

  test('at 375px the card fits, its controls are 44px, its fields 16px, and axe is clean', async ({
    page,
  }) => {
    await openCard(page);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(wide, 'no sideways scroll').toBeLessThanOrEqual(0);
    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '#votes-card button, #votes-card input, #votes-card select, #votes-card a'
        )
      )
        .filter((el) => el.offsetParent !== null)
        .flatMap((el) => {
          const box = el.getBoundingClientRect();
          const font = parseFloat(getComputedStyle(el).fontSize);
          const name = el.getAttribute('data-testid') || el.tagName;
          const out: string[] = [];
          if (el.tagName !== 'A' && box.height < 44) out.push(`${name} is ${box.height}px tall`);
          if (/INPUT|SELECT/.test(el.tagName) && font < 16) out.push(`${name} text ${font}px`);
          return out;
        })
    );
    expect(small).toEqual([]);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const results = await new AxeBuilder({ page })
        .include('[data-testid="votes-card"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found, `${colorScheme}:\n${found.join('\n')}`).toEqual([]);
    }
  });
});
