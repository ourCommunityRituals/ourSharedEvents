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
        location: 'Eagles Hall',
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    eventId = ((await res.json()) as { id?: string }).id ?? '';
    expect(eventId).not.toBe('');
  });

  async function openCard(page: Page): Promise<void> {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setExtraHTTPHeaders(AUTH);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.click('[data-testid="admin-path-events"]');
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
});
