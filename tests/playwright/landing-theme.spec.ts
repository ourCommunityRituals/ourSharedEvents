/**
 * The landing page's colour tokens resolve, in light AND dark (CCR PR 700).
 *
 * landing.html used to re-declare --bg/--surface/--text/--accent/--on-accent as
 * `var(--x, fallback)` on the same element that /ui.css themes. A custom
 * property that refers to itself is a cycle, so all five computed to nothing:
 * the accent vanished, the selected filter pill lost its highlight, dark mode
 * rendered a white page, and the attendee map's density shading went black.
 * Every existing test asserted markup, not computed style, so none noticed.
 *
 * This measures the computed values in a real engine. Runs in the blocking
 * phone audit (playwright.mobile.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { createLiveEvent, waitUntilListed } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';

async function tokens(page: Page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const pill = document.querySelector('label[for="view-list"], label[for="view-map"]');
    const checked = document.querySelector<HTMLInputElement>('input.toggle-radio:checked');
    const selected = checked
      ? document.querySelector(`label[for="${checked.id}"]`)
      : (pill as Element | null);
    return {
      accent: cs.getPropertyValue('--accent').trim(),
      bg: cs.getPropertyValue('--bg').trim(),
      text: cs.getPropertyValue('--text').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      pillBg: selected ? getComputedStyle(selected).backgroundColor : null,
    };
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`landing tokens resolve in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    const t = await tokens(page);
    expect(t.accent, '--accent computed to nothing (token cycle?)').not.toBe('');
    expect(t.bg, '--bg computed to nothing').not.toBe('');
    expect(t.text, '--text computed to nothing').not.toBe('');
    // A resolved body background is a real colour, not the transparent default.
    expect(t.bodyBg).not.toBe('rgba(0, 0, 0, 0)');
    // The selected toggle pill carries the accent, not a transparent background.
    if (t.pillBg !== null) expect(t.pillBg).not.toBe('rgba(0, 0, 0, 0)');
  });
}

test('light and dark actually differ (dark mode is not a white page)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const light = (await tokens(page)).bodyBg;
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const dark = (await tokens(page)).bodyBg;
  expect(dark).not.toBe(light);
});

// The map state in a real browser (CCR PR 700, QA M1): CI's other seeded
// events have no coordinates, so nothing ever drew a hex. Five upcoming events
// in ONE corridor (Blue Island, H3 res 7) meet the per-corridor gate.
test('the attendee map draws coloured hexes with 44px legend links', async ({ page, request }) => {
  test.skip(!ADMIN_BEARER, 'needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts)');
  test.setTimeout(150_000);
  const stamp = Date.now();
  let lastListedFrom: string | null = null;
  for (let i = 0; i < 5; i++) {
    const ev = await createLiveEvent(request, ADMIN_BEARER, `Map corridor ${stamp}-${i}`, 3 + i, {
      lat: 41.657731,
      lon: -87.680213,
    });
    lastListedFrom = ev.listedFrom;
  }
  // Just published: inside the publish grace window they are not on the map yet.
  await waitUntilListed(lastListedFrom);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.click('label[for="view-map"]');
    const svg = page.getByTestId('amap-svg');
    await expect(svg).toBeVisible();
    const fill = await page
      .locator('.amap-cell')
      .first()
      .evaluate((el) => getComputedStyle(el).fill);
    expect(fill, `${scheme}: hex fill is black (token cycle?)`).not.toBe('rgb(0, 0, 0)');
    const links = page.getByTestId('amap-event');
    expect(await links.count()).toBeGreaterThanOrEqual(5);
    const box = await links.first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
