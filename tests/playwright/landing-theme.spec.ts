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
