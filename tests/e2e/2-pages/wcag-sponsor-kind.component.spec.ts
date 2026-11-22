/**
 * The kind-of-business slider in the admin's sponsor form (OSE-2207; owner,
 * 2026-11-22, on the decision card: in Create Sponsor the icon slider picks the
 * sponsor's kind of business), against WCAG 2.0, 2.1 and 2.2, levels A and AA,
 * and against what it is for.
 *
 * The page is the admin page as the Worker renders it (with its own
 * Content-Security-Policy, so the slider's script must carry the nonce to run),
 * with the sponsor form shown on its own. Phone first: 320 px (400% zoom) and
 * 390 px, then 1280 px, light and dark.
 *
 *   - axe (every WCAG A/AA rule) on the field; 2.5.8 target size of the
 *     slider's targets; each kind a 44 px target with 16 px text;
 *   - the form stays as wide as the phone (1.4.10 reflow): the row of 20 kinds
 *     scrolls inside its column, and its arrows show;
 *   - a tap picks a kind (aria-pressed, the hidden field), a second tap on it
 *     clears it, and picking another moves the choice;
 *   - the slider asks for nothing (no request while it is used).
 *
 * The "mutation" block injects one fault per check and requires the check to
 * report it.
 *
 * Mandatory in the T0 Gate (component) step and in the "WCAG audit" workflow;
 * on call with `npm run test:wcag`.
 *
 * Born red (2026-11-22, Chromium): before @ocr/ui gave .icon-slider
 * contain:inline-size, the 20-item row set the two-column form about 2,000 px
 * wide at 390 px, the reflow case failed and the arrows never showed.
 */
import { test, expect, type Page } from '@playwright/test';
import { renderAdmin } from '../helpers/render-admin-page';
import { axeWcag, reflow, targetSize } from '../helpers/wcag';

/**
 * 2.5.8 for the slider's own targets. The form around it has one older finding
 * of its own (the "Public card details" summary is 20 px tall beside the poster
 * header image), outside this story, so the check is read for the slider only.
 */
const kindTargets = async (page: Page) =>
  (await targetSize(page)).filter((l) => l.includes('spon-kind'));

const ORIGIN = 'http://admin.component.test';
const FIELD = '[data-testid="spon-kind-field"]';
const SLIDER = '[data-testid="spon-kind"]';
const VALUE = `${SLIDER} input[name="business_kind"]`;

async function open(page: Page, requests: string[] = []): Promise<void> {
  const { html, csp, css } = await renderAdmin();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/admin`) {
      return route.fulfill({
        body: html,
        contentType: 'text/html',
        headers: { 'Content-Security-Policy': csp },
      });
    }
    if (url === `${ORIGIN}/ui.css`) return route.fulfill({ body: css, contentType: 'text/css' });
    requests.push(url);
    return route.fulfill({ status: 200, body: '{}', contentType: 'application/json' });
  });
  await page.goto(`${ORIGIN}/admin`);
  // Show the sponsor form on its own, as an organizer sees it after "Add sponsor".
  await page.evaluate(() => {
    const wrap = document.getElementById('spon-form-wrap')!;
    for (let el: HTMLElement | null = wrap; el; el = el.parentElement) el.hidden = false;
    const main = document.createElement('main');
    main.appendChild(wrap);
    document.body.replaceChildren(main);
    window.dispatchEvent(new Event('resize'));
  });
  await page.locator(FIELD).scrollIntoViewIfNeeded();
}

const item = (page: Page, v: string) => page.locator(`[data-testid="spon-kind-${v}"]`);
const next = (page: Page) => page.locator(`${SLIDER} .icon-slider-arrow[data-step="1"]`);

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 1280]) {
    test(`${width} px ${scheme}: no WCAG A/AA failure, every kind a 44 px target with 16 px text`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      expect(await axeWcag(page, FIELD)).toEqual([]);
      expect(await kindTargets(page)).toEqual([]);
      const sizes = await page
        .locator(`${SLIDER} .icon-slider-item`)
        .evaluateAll((els) =>
          els.map((e) => [
            e.getBoundingClientRect().height,
            parseFloat(getComputedStyle(e).fontSize),
          ])
        );
      expect(sizes).toHaveLength(20);
      for (const [h, f] of sizes) {
        expect(h).toBeGreaterThanOrEqual(44);
        expect(f).toBeGreaterThanOrEqual(16);
      }
    });
  }
}

for (const width of [320, 390]) {
  test(`${width} px: the form stays phone-wide; the row scrolls in its column and its arrows show`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    expect(await reflow(page)).toEqual([]);
    const name = await page.locator('#spon-name').boundingBox();
    expect(name!.x + name!.width).toBeLessThanOrEqual(width);
    await expect(next(page)).toBeVisible();
    const before = await page.locator(`${SLIDER} .icon-slider-track`).evaluate((t) => t.scrollLeft);
    await next(page).click();
    await expect
      .poll(() => page.locator(`${SLIDER} .icon-slider-track`).evaluate((t) => t.scrollLeft))
      .toBeGreaterThan(before);
  });
}

test('390 px: a tap picks a kind, a second tap clears it, another tap moves it; nothing is sent', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true });
  const page = await ctx.newPage();
  const requests: string[] = [];
  await open(page, requests);
  const sent = requests.length;
  await expect(page.locator(VALUE)).toHaveValue('');
  await item(page, 'bar').tap();
  await expect(item(page, 'bar')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(VALUE)).toHaveValue('bar');
  await item(page, 'cafe').tap();
  await expect(item(page, 'bar')).toHaveAttribute('aria-pressed', 'false');
  await expect(item(page, 'cafe')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(VALUE)).toHaveValue('cafe');
  await item(page, 'cafe').tap();
  await expect(item(page, 'cafe')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(VALUE)).toHaveValue('');
  expect(requests.slice(sent)).toEqual([]);
  await ctx.close();
});

test.describe('mutation: each check reports its own fault', () => {
  test('a kind with no name fails axe', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page);
    await item(page, 'pets').evaluate((b) => {
      b.textContent = '';
    });
    expect((await axeWcag(page, FIELD)).join('\n')).toContain('button-name');
  });

  test('a row that sizes its holder fails reflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page);
    await page.addStyleTag({ content: '.icon-slider{contain:none!important}' });
    expect(await reflow(page)).not.toEqual([]);
  });

  test('a 16 px kind crowding its neighbour fails the target-size check', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page);
    await page.addStyleTag({
      content:
        '[data-testid="spon-kind"] [data-value="auto"]{min-height:0!important;height:16px!important;width:16px!important;padding:0!important;overflow:hidden;margin-right:-14px}',
    });
    expect((await kindTargets(page)).join('\n')).toContain('spon-kind-auto');
  });
});
