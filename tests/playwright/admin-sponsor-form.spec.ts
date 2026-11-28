/**
 * The admin Create Sponsor form, in a real browser at phone size (OSE-1434).
 *
 * The jsdom specs (workers/oursharedevents/tests/sponsor-create-fields-ui.spec.ts
 * and sponsor-public-card-ui.spec.ts) run the form's real script and pin the
 * field order, the labels, the request body and the section's open/close rules.
 * What they cannot see, and this does:
 *   - the order a person actually sees, by on-screen position, at 375×812
 *   - the collapsed "Public card details" section really hides its fields, and
 *     its summary is a 44 px target
 *   - "Our own logo" reveals two fields that are 44 px+ with 16 px text, and the
 *     live hint announces them
 *   - axe finds nothing in the default, "own logo" and section-open states
 *   - a sponsor saved through the form round-trips: the server has every field,
 *     and Edit brings them back with the section open
 *   - a field the server rejects inside the collapsed section is opened and
 *     focused, so the error is never on a hidden field
 *   - no CSP violation or page error along the way
 *
 * Runs in the blocking PR phone audit (playwright.mobile.config.ts): a local
 * worker with migrations and a local admin key. Seeds its own event.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const MIN_TOUCH_TARGET_PX = 44;
const MIN_INPUT_FONT_PX = 16;
const FORM = '[data-testid="sponsor-create-form"]';

test.describe.configure({ mode: 'serial' });

let eventId = '';
let eventTitle = '';

/** CSP violations and page errors for the life of a page (favicon 404 excepted). */
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

/** /admin as the local admin, at phone size, with the Create Sponsor form open. */
async function openSponsorForm(page: Page, opts: { selectEvent?: boolean } = {}) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.click('[data-testid="admin-path-advanced"]');
  if (opts.selectEvent) {
    await page.click('[data-testid="events-filter-active"]');
    const row = page.locator(`[data-testid="event-row-${eventId}"]`);
    await expect(row, 'seeded event never showed in the Published list').toBeVisible({
      timeout: 15000,
    });
    await row.click();
    // The Sponsors card is folded to its summary line (owner 2026-10-10); the
    // summary changes once this event's sponsors have loaded.
    await expect(page.getByTestId('sponsors-summary')).not.toHaveText(/Select an event/, {
      timeout: 15000,
    });
  }
  await page.getByTestId('add-sponsor-toggle').click();
  await expect(page.locator(FORM)).toBeVisible();
}

/** A control a thumb can hit and text a phone will not zoom into. */
async function expectPhoneWorkable(el: Locator, name: string) {
  await expect(el, `${name} not visible`).toBeVisible();
  const box = await el.boundingBox();
  expect(box, `${name} has no box`).not.toBeNull();
  expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  const font = await el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  expect(font, `${name} font-size`).toBeGreaterThanOrEqual(MIN_INPUT_FONT_PX);
}

/**
 * axe over the form, in BOTH colour schemes: every surface is on @ocr/ui
 * semantic tokens, and a pair that clears 4.5:1 in one theme can miss in the
 * other. Run it against the PINNED @ocr/ui (.ocr-hub-ref), as CI does: the
 * old in-repo fork's light --surface-hover was the border colour, and muted
 * text on this form's panel measured 4.36:1 there.
 */
async function expectAxeClean(page: Page, state: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    // Buttons fade their background (transition: background 0.2s). Scan only
    // once every transition has settled, or axe measures a mid-fade colour.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const results = await new AxeBuilder({ page })
      .include(FORM)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const found = results.violations.map(
      (v) =>
        `${v.id} (${v.impact}):\n` +
        v.nodes
          .map((n) => `  ${n.target.join(' ')} :: ${n.any.map((a) => a.message).join(' | ')}`)
          .join('\n')
    );
    expect(found, `axe, ${state}, ${colorScheme}:\n${found.join('\n')}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const topOf = async (el: Locator) => (await el.boundingBox())!.y;

test.beforeAll(async ({ request }) => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
  eventTitle = `Sponsor form check ${Date.now().toString(36)}`;
  eventId = (await createLiveEvent(request, ADMIN_BEARER, eventTitle)).id;
});

test('adding a sponsor is two short steps: who it is, then how often it shows', async ({
  page,
}) => {
  const problems = watchForBreakage(page);
  await openSponsorForm(page);

  // Step 1 (owner 2026-11-27): the name, the kind of business and the logo.
  await expect(page.getByTestId('sponsor-step-caption')).toHaveText(/Step 1 of 2/);
  await expectPhoneWorkable(page.getByTestId('spon-name'), 'spon-name');
  await expectPhoneWorkable(page.getByTestId('spon-image-default'), 'spon-image-default');
  await expect(page.getByTestId('spon-image-default')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('spon-image-choice')).toHaveValue('default');
  await expect(page.getByTestId('spon-logo')).toBeHidden();
  await expect(page.getByTestId('spon-sidebar-logo')).toBeHidden();
  await expect(page.getByTestId('spon-tier-picker')).toBeHidden();
  await expect(page.getByTestId('sponsor-submit')).toBeHidden();

  // Next asks for a name first.
  await page.getByTestId('sponsor-next').click();
  await expect(page.getByTestId('spon-name')).toBeFocused();
  await expect(page.getByTestId('spon-name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('spon-name').fill('Two Step Bakery');
  await page.getByTestId('sponsor-next').click();

  // Step 2: the level, the event, then the extras folded.
  await expect(page.getByTestId('sponsor-step-caption')).toHaveText(/Step 2 of 2/);
  await expect(page.getByTestId('spon-name')).toBeHidden();
  for (const id of ['spon-tier-title', 'spon-tier-gold', 'spon-tier-primary', 'spon-event']) {
    await expectPhoneWorkable(page.getByTestId(id), id);
  }
  const tops = [
    await topOf(page.getByTestId('spon-tier-picker')),
    await topOf(page.getByTestId('spon-event')),
    await topOf(page.getByTestId('spon-more-details')),
  ];
  expect(tops, 'level, then event, then the extras').toEqual([...tops].sort((x, y) => x - y));
  expect(
    await page.getByTestId('spon-more-details').evaluate((d) => (d as HTMLDetailsElement).open)
  ).toBe(false);
  for (const id of [
    'spon-website',
    'spon-display-name',
    'spon-address',
    'spon-phone',
    'spon-email',
  ]) {
    await expect(page.getByTestId(id), `${id} should be folded`).toBeHidden();
  }
  await page.getByTestId('spon-tier-gold').click();
  await expect(page.getByTestId('spon-tier')).toHaveValue('gold');
  await expect(page.getByTestId('spon-tier-gold')).toHaveAttribute('aria-pressed', 'true');

  await expectAxeClean(page, 'step 2');
  await page.getByTestId('sponsor-back').click();
  await expect(page.getByTestId('spon-name')).toHaveValue('Two Step Bakery');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('"Add their logo" reveals two phone-workable logo fields and says so', async ({ page }) => {
  const problems = watchForBreakage(page);
  await openSponsorForm(page);

  const hint = page.getByTestId('spon-image-choice-hint');
  await expect(hint).toHaveAttribute('aria-live', 'polite');
  await page.getByTestId('spon-image-own').click();

  await expect(page.getByTestId('spon-image-choice')).toHaveValue('own');
  await expect(hint).toHaveText(/wide logo and a square logo below/i);
  await expect(page.getByLabel('Wide logo (top banner)')).toBeVisible();
  await expect(page.getByLabel('Square logo (side rail)')).toBeVisible();
  await expectPhoneWorkable(page.getByTestId('spon-logo'), 'spon-logo');
  await expectPhoneWorkable(page.getByTestId('spon-sidebar-logo'), 'spon-sidebar-logo');

  // Revealed under the logo buttons, wide first.
  const pick = await topOf(page.getByTestId('spon-image-picker'));
  const wide = await topOf(page.getByTestId('spon-logo'));
  const square = await topOf(page.getByTestId('spon-sidebar-logo'));
  expect(pick).toBeLessThan(wide);
  expect(wide).toBeLessThan(square);

  await expectAxeClean(page, 'own logo');

  await page.getByTestId('spon-image-default').click();
  await expect(page.getByTestId('spon-logo')).toBeHidden();
  await expect(hint).not.toHaveText(/below/i);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the card details open to four phone-workable fields', async ({ page }) => {
  const problems = watchForBreakage(page);
  await openSponsorForm(page);
  await page.getByTestId('spon-name').fill('Card Detail Co');
  await page.getByTestId('sponsor-next').click();
  await page.getByTestId('spon-more-details').locator('summary').first().click();

  await page.getByTestId('spon-card-details-summary').click();
  expect(
    await page.getByTestId('spon-card-details').evaluate((d) => (d as HTMLDetailsElement).open)
  ).toBe(true);
  for (const id of ['spon-display-name', 'spon-address', 'spon-phone', 'spon-email']) {
    await expectPhoneWorkable(page.getByTestId(id), id);
  }
  await expectAxeClean(page, 'card details open');

  // A second tap closes it again.
  await page.getByTestId('spon-card-details-summary').click();
  await expect(page.getByTestId('spon-display-name')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a sponsor saved through the form round-trips, and Edit reopens its card details', async ({
  page,
}) => {
  const problems = watchForBreakage(page);
  await openSponsorForm(page, { selectEvent: true });

  const name = `Form Check Bakery ${Date.now().toString(36)}`;
  await page.getByTestId('spon-name').fill(name);
  await page.getByTestId('spon-image-own').click();
  await page.getByTestId('spon-logo').fill('https://cdn.example.com/wide.png');
  await page.getByTestId('spon-sidebar-logo').fill('https://cdn.example.com/square.png');
  await page.getByTestId('sponsor-next').click();
  await page.getByTestId('spon-tier-gold').click();
  await page.getByTestId('spon-event').selectOption(eventId);
  await page.getByTestId('spon-more-details').locator('summary').first().click();
  await page.getByTestId('spon-website').fill('https://bakery.example.com');
  await page.getByTestId('spon-card-details-summary').click();
  await page.getByTestId('spon-display-name').fill('Form Check Bakery');
  await page.getByTestId('spon-address').fill('Sawyer, MI');
  await page.getByTestId('spon-phone').fill('(269) 555-0100');
  await page.getByTestId('spon-email').fill('hello@bakery.example.com');
  await page.getByTestId('sponsor-submit').click();

  const msg = page.getByTestId('sponsor-form-msg');
  await expect(msg).toHaveClass(/success/, { timeout: 15000 });
  const id = (await msg.textContent())!.match(/Sponsor created — (\S+)/)?.[1];
  expect(id, `no sponsor id in "${await msg.textContent()}"`).toBeTruthy();

  // The server has every field the form showed.
  const res = await page.request.get(`/api/v2/admin/sponsors/${encodeURIComponent(id!)}`, {
    headers: { Authorization: `Bearer ${ADMIN_BEARER}` },
  });
  expect(res.ok(), `GET sponsor ${id}: ${res.status()} ${await res.text()}`).toBe(true);
  const item = ((await res.json()) as { item: Record<string, unknown> }).item;
  expect(item).toMatchObject({
    name,
    tier: 'gold',
    logo_url: 'https://cdn.example.com/wide.png',
    sidebar_logo_url: 'https://cdn.example.com/square.png',
    website_url: 'https://bakery.example.com',
    display_name: 'Form Check Bakery',
    address_line: 'Sawyer, MI',
    contact_phone: '(269) 555-0100',
    contact_email: 'hello@bakery.example.com',
  });

  // Close, then Edit from the list: the section opens with the saved values.
  await page.getByTestId('close-after-save').click();
  await expect(page.getByTestId('spon-card-details')).toBeHidden();
  await page.getByTestId(`edit-${id}`).click();
  await expect(page.getByTestId('spon-name')).toHaveValue(name, { timeout: 15000 });
  expect(
    await page.getByTestId('spon-card-details').evaluate((d) => (d as HTMLDetailsElement).open)
  ).toBe(true);
  await expect(page.getByTestId('spon-display-name')).toHaveValue('Form Check Bakery');
  await expect(page.getByTestId('spon-email')).toHaveValue('hello@bakery.example.com');
  await expect(page.getByTestId('spon-image-choice')).toHaveValue('own');
  await expect(page.getByTestId('spon-logo')).toHaveValue('https://cdn.example.com/wide.png');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('errors land on a visible field: tier first, then a rejected card field opens its section', async ({
  page,
}) => {
  const problems = watchForBreakage(page);
  await openSponsorForm(page);

  await page.getByTestId('spon-name').fill(`Bad Email Co ${Date.now().toString(36)}`);
  await page.getByTestId('sponsor-next').click();
  await page.getByTestId('sponsor-submit').click();
  await expect(page.getByTestId('sponsor-form-msg')).toHaveText(/choose how often it shows/i);
  await expect(page.getByTestId('spon-tier-title')).toBeFocused();
  await expect(page.getByTestId('spon-tier')).toHaveAttribute('aria-invalid', 'true');

  // Type an address the server rejects, then collapse the section again: the
  // server's answer must reopen it and focus the field, not focus a hidden one.
  await page.getByTestId('spon-tier-silver').click();
  await page.getByTestId('spon-more-details').locator('summary').first().click();
  await page.getByTestId('spon-card-details-summary').click();
  await page.getByTestId('spon-email').fill('not an email');
  await page.getByTestId('spon-card-details-summary').click();
  await expect(page.getByTestId('spon-email')).toBeHidden();
  await page.getByTestId('sponsor-submit').click();

  await expect(page.getByTestId('sponsor-form-msg')).toHaveClass(/error/, { timeout: 15000 });
  await expect(page.getByTestId('spon-email')).toBeVisible();
  await expect(page.getByTestId('spon-email')).toBeFocused();
  await expect(page.getByTestId('spon-email')).toHaveAttribute('aria-invalid', 'true');
  // The only error is the one the form is showing.
  expect(
    problems.filter((p) => !/\/api\/v2\/admin\/sponsors\b.*400|status of 400/.test(p)),
    problems.join('\n')
  ).toEqual([]);
});
