/**
 * Admin: the Stalls card (OSE-1998), driven in a browser at phone width.
 *
 * The card's rules and wording are unit-tested in
 * workers/oursharedevents/tests/admin-stalls-card.spec.ts (jsdom). This spec
 * proves the same card works on the page as served: its buttons answer
 * through the page's delegated action table under the CSP nonce, its writes
 * pass the admin write guard, and what it saves is what the server holds.
 *
 *   1. Add one stall; a refusal shows at its field.
 *   2. Check a pasted list with one bad line: the line is named and nothing is
 *      sent; fixed, the list is added in one request.
 *   3. Take a stall out of use after a plain question; it stays on the list.
 *   4. Make a code for a stall; it is listed under the stall with Print.
 *   5. At 375px: no sideways scroll, every control in the card is 44px or
 *      more, every field's text is 16px or more, and axe finds nothing serious.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts), against the
 * local worker that config starts. The event is made here; nothing is assumed.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const AUTH = { Authorization: `Bearer ${ADMIN_BEARER}` };

test.describe.configure({ mode: 'serial' });

test.describe('admin: the Stalls card', () => {
  let eventId = '';

  test.beforeAll(async ({ request }) => {
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    const res = await request.post('/api/v2/admin/events', {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {
        attendance_mode: 'in_person',
        title: `Stalls fair ${Date.now()}`,
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
    const card = page.getByTestId('stalls-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('stalls-summary')).not.toHaveText('');
    await page.getByTestId('stalls-toggle').click();
    await expect(page.getByTestId('stalls-body')).toBeVisible();
  }

  const rows = (page: Page) => page.locator('#stalls-list [data-testid="stall-row"]');

  test('add one stall; a refusal shows at its field', async ({ page }) => {
    await openCard(page);
    await expect(page.getByTestId('stalls-summary')).toHaveText('No stalls yet.');
    await page.getByTestId('stall-number-input').fill('1');
    await page.getByTestId('stall-name-input').fill('rosa@example.com');
    await page.getByTestId('stall-add-btn').click();
    await expect(page.getByTestId('stall-name-error')).toContainText('email address');
    await expect(page.getByTestId('stall-name-input')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('stall-name-input')).toBeFocused();

    await page.getByTestId('stall-name-input').fill('Rosa Bakery');
    await page.getByTestId('stall-category-input').selectOption('food');
    await page.getByTestId('stall-add-btn').click();
    await expect(page.getByTestId('stalls-msg')).toHaveText('Stall 1 is added.');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByTestId('stall-row-name')).toHaveText('Rosa Bakery');
    await expect(rows(page).first().getByTestId('stall-row-category')).toHaveText('Food and drink');
    // The fair is a draft: no public page yet, and the card says when.
    await expect(page.getByTestId('stalls-public-note')).toBeVisible();
    await expect(rows(page).first().getByTestId('stall-row-public-link')).toHaveCount(0);

    // The server refuses a number this fair already has; the card says so at the field.
    await page.getByTestId('stall-number-input').fill('1');
    await page.getByTestId('stall-name-input').fill('Second bakery');
    await page.getByTestId('stall-add-btn').click();
    await expect(page.getByTestId('stall-number-error')).toHaveText(
      'Another stall of this fair has that number. A stall out of use keeps its number.'
    );
  });

  test('a pasted list is checked before it is sent, then added in one request', async ({
    page,
  }) => {
    await openCard(page);
    // Only the stall routes are watched. Opening an event makes the page's own
    // background writes (its short link, for one), which land at any moment and
    // are not this card's.
    const sent: string[] = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (r.method() !== 'GET' && path.includes('/booths')) sent.push(`${r.method()} ${path}`);
    });
    const text = page.getByTestId('stalls-bulk-text');
    await text.fill('2, Pine Crafts, craft\n3, call 312 555 0199\n4, "Smith, Jones & Co", art');
    await page.getByTestId('stalls-bulk-check').click();
    await expect(page.getByTestId('stalls-bulk-ok-title')).toHaveText('Ready to add: 2 stalls.');
    await expect(page.getByTestId('stalls-bulk-refused-list')).toContainText('Line 2:');
    await expect(page.getByTestId('stalls-bulk-save')).toBeHidden();
    expect(sent, 'Check sends nothing to the stall routes').toEqual([]);

    await text.fill('2, Pine Crafts, craft\n3, Old Books, books\n4, "Smith, Jones & Co", art');
    await page.getByTestId('stalls-bulk-check').click();
    await expect(page.getByTestId('stalls-bulk-refused-title')).toBeHidden();
    await expect(page.getByTestId('stalls-bulk-ok-list').locator('li')).toHaveText([
      'Line 1: stall 2, Pine Crafts (Craft)',
      'Line 2: stall 3, Old Books (Books)',
      'Line 3: stall 4, Smith, Jones & Co (Art)',
    ]);
    await page.getByTestId('stalls-bulk-save').click();
    await expect(page.getByTestId('stalls-msg')).toHaveText('Added 3 stalls.');
    expect(sent).toEqual([`POST /api/v2/admin/events/${eventId}/booths/bulk`]);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByTestId('stalls-summary')).toHaveText('4 stalls in use.');
  });

  test('a stall taken out of use stays on the list, as such', async ({ page }) => {
    await openCard(page);
    const third = rows(page).filter({ hasText: 'Old Books' });
    await third.getByTestId('stall-row-out').click();
    await expect(third.getByTestId('stall-out-text')).toHaveText(
      'Take stall 3 out of use? Its codes keep pointing at it and its past scans still count. It is not deleted, and you can put it back in use.'
    );
    await expect(third.getByTestId('stall-out-yes')).toBeFocused();
    await third.getByTestId('stall-out-yes').click();
    await expect(page.getByTestId('stalls-msg')).toHaveText(
      'Stall 3 is out of use. Nothing was deleted.'
    );
    await expect(page.getByTestId('stalls-summary')).toHaveText('3 stalls in use, 1 out of use.');
    const out = rows(page).last();
    await expect(out.getByTestId('stall-row-name')).toHaveText('Old Books');
    await expect(out.getByTestId('stall-row-state')).toContainText('Out of use.');
    await expect(out.getByTestId('stall-row-back')).toBeVisible();
  });

  test('a code made for a stall is an ordinary placement, listed under it with Print', async ({
    page,
    request,
  }) => {
    await openCard(page);
    const first = rows(page).first();
    await first.getByTestId('stall-row-code').click();
    await expect(page.getByTestId('stalls-msg')).toHaveText(
      'A code for stall 1 is made. Print it here, or find it under Posters.'
    );
    const code = rows(page).first().getByTestId('stall-code');
    await expect(code).toHaveCount(1);
    await expect(code.getByTestId('stall-code-label')).toHaveText('Stall 1 · Rosa Bakery');
    await expect(code.getByTestId('stall-code-print')).toBeVisible();
    const list = await request.get(`/api/v2/admin/events/${eventId}/poster-deployments`, {
      headers: AUTH,
    });
    const items = ((await list.json()) as { items: { booth_id: string | null }[] }).items;
    expect(items.filter((p) => p.booth_id)).toHaveLength(1);
  });

  test('at 375px the card fits, its controls are 44px, its fields 16px, and axe is clean', async ({
    page,
  }) => {
    await openCard(page);
    await rows(page).first().getByTestId('stall-row-edit').click();
    await expect(page.getByTestId('stall-edit-form')).toBeVisible();
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(wide, 'no sideways scroll').toBeLessThanOrEqual(0);
    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '#stalls-card button, #stalls-card input, #stalls-card select, #stalls-card textarea, #stalls-card a'
        )
      )
        .filter((el) => el.offsetParent !== null)
        .flatMap((el) => {
          const box = el.getBoundingClientRect();
          const font = parseFloat(getComputedStyle(el).fontSize);
          const name = el.getAttribute('data-testid') || el.tagName;
          const out: string[] = [];
          if (el.tagName !== 'A' && box.height < 44) out.push(`${name} is ${box.height}px tall`);
          if (/INPUT|SELECT|TEXTAREA/.test(el.tagName) && font < 16)
            out.push(`${name} text ${font}px`);
          return out;
        })
    );
    expect(small).toEqual([]);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const results = await new AxeBuilder({ page })
        .include('[data-testid="stalls-card"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found, `${colorScheme}:\n${found.join('\n')}`).toEqual([]);
    }
  });
});
