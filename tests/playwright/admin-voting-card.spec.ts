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
 *   2. Open voting, open the song ("Open until …"), close it, reopen it, close
 *      voting, reopen voting. The summary follows each step.
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
 *   8. OSE-2224 (ADR-040 decision 12): the card offers "Entry (anything you
 *      name)"; an entry is added, listed as an Entry, and the kind then stays
 *      fixed for the set.
 *   9. OSE-2225 (ADR-040 decision 12): under the label box the card says "Name
 *      the work, not the person who made it."; a label the off-limits list
 *      refuses says which rule refused it, in plain words, from the server.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts), against the
 * local worker that config starts with a local pepper. The event is made here.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const AUTH = { Authorization: `Bearer ${ADMIN_BEARER}` };

test.describe.configure({ mode: 'serial' });

test.describe('admin: the Voting card', () => {
  let eventId = '';

  test.beforeAll(async ({ request }) => {
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    const res = await request.post('/api/v2/admin/events', {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {
        attendance_mode: 'in_person',
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
  });

  async function makeEvent(
    request: import('@playwright/test').APIRequestContext,
    title: string,
    status: 'draft' | 'active' = 'draft'
  ): Promise<string> {
    const res = await request.post('/api/v2/admin/events', {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {
        attendance_mode: 'in_person',
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
    return ((await res.json()) as { id: string }).id;
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
      /\/q\/qrt_[0-9a-f]{32}\?type=vote$/
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
      /\/q\/qrt_[0-9a-f]{32}\?type=vote$/
    );
  });

  test('open, close and reopen voting and the song; the summary follows', async ({ page }) => {
    await openCard(page);
    // The song cannot open before voting does: its only button appears once voting is open.
    await expect(rows(page).first().getByTestId('vote-row-open')).toHaveCount(0);
    await page.getByTestId('votes-open').click();
    await expect(summary(page)).toHaveText('Voting is open.');

    await rows(page).first().getByTestId('vote-row-open').click();
    await expect(rows(page).first().getByTestId('vote-row-state')).toHaveText(/^Open until /);
    await rows(page).first().getByTestId('vote-row-close').click();
    await expect(rows(page).first().getByTestId('vote-row-state')).toHaveText('Closed');
    await rows(page).first().getByTestId('vote-row-reopen').click();
    await expect(rows(page).first().getByTestId('vote-row-state')).toHaveText(/^Open until /);

    await page.getByTestId('votes-close').click();
    await expect(summary(page)).toHaveText(
      'Voting is closed. You can reopen it while the event is on.'
    );
    await page.getByTestId('votes-reopen').click();
    await expect(summary(page)).toHaveText('Voting is open.');
    await expect(page.getByTestId('votes-msg')).toHaveText('Voting is open again.');
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

  test('an entry, anything the host names, is added from the card (OSE-2224)', async ({
    page,
    request,
  }) => {
    const id = await makeEvent(request, `Chili cook-off ${Date.now()}`);
    await openCard(page);
    await selectEvent(page, id);
    await expect(page.getByTestId('votes-card')).toBeVisible();
    if (!(await page.getByTestId('votes-body').isVisible()))
      await page.getByTestId('votes-toggle').click();
    await page.getByTestId('votes-make-btn').click();
    await expect(summary(page)).toHaveText('Voting is set up, not open yet.');

    const kind = page.getByTestId('vote-kind-input');
    await expect(kind.locator('option[value="entry"]')).toHaveText('Entry (anything you name)');
    await kind.selectOption('entry');
    await page.getByTestId('vote-label-input').fill('Best chili');
    await page.getByTestId('vote-add-btn').click();
    await expect(page.getByTestId('votes-msg')).toHaveText('Entry added.');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByTestId('vote-row-label')).toHaveText('Best chili');
    await expect(rows(page).first().getByTestId('vote-row-kind')).toHaveText('Entry');
    await expect(kind).toHaveValue('entry');
    await expect(kind).toBeDisabled();
  });

  test('the warning sits under the label box, and a refusal names its rule (OSE-2225)', async ({
    page,
    request,
  }) => {
    const id = await makeEvent(request, `Art walk ${Date.now()}`);
    await openCard(page);
    await selectEvent(page, id);
    await expect(page.getByTestId('votes-card')).toBeVisible();
    if (!(await page.getByTestId('votes-body').isVisible()))
      await page.getByTestId('votes-toggle').click();
    await page.getByTestId('votes-make-btn').click();
    await expect(summary(page)).toHaveText('Voting is set up, not open yet.');

    const input = page.getByTestId('vote-label-input');
    const warning = page.getByTestId('vote-label-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toHaveText('Name the work, not the person who made it.');
    await expect(input).toHaveAttribute('aria-describedby', /\bvote-label-warning\b/);
    const [inputBox, warningBox] = [await input.boundingBox(), await warning.boundingBox()];
    expect(warningBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);

    await input.fill('Painting, call 555 123 4567');
    await page.getByTestId('vote-add-btn').click();
    await expect(page.getByTestId('vote-label-error')).toContainText('a phone number');
    await expect(page.getByTestId('vote-label-error')).toContainText('off limits');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(rows(page)).toHaveCount(0);
  });
});
