/**
 * OSE-R-006 — Playwright FE for poster print color preservation.
 *
 * Layer: FE (real browser loads /poster, switches to print-emulation
 * mode, and inspects the computed styles to confirm the brand header
 * and sponsor logos render with their colors intact).
 *
 * Companion to:
 *   - workers/oursharedevents/tests/poster-print-colors.spec.ts (vitest API)
 *   - postman/collections/ose-pages.json (Newman API — OSE-R-006 folder)
 *
 * Test names share their shape byte-for-byte across runners where the
 * scenario maps; differ only by the API/FE qualifier where the layer
 * differs.
 *
 * Backstop: a bar owner hits Cmd+P to print event posters for the venue
 * window. Pre-fix, sponsor logos went grayscale and the dark-navy poster
 * header dropped to white-on-white. Sponsors paid for color placement;
 * this spec verifies the printed output keeps that promise.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

async function gotoPosterPrint(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/poster`, { waitUntil: 'domcontentloaded' });
  // Switch the rendering pipeline to print emulation. Computed styles
  // from this point on reflect the @media print rules, not screen.
  await page.emulateMedia({ media: 'print' });
}

test.describe('OSE-R-006 — poster print colors in browser', () => {
  test('OSE-R-006 | FE | GET /poster (print emulation) | poster header keeps dark-navy background in print', async ({
    page,
  }) => {
    await gotoPosterPrint(page);
    // The poster shell renders inside the picker dropdown's first event;
    // we wait for the poster-header to exist before sampling its style.
    const header = page.locator('.poster-header').first();
    await header.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {
      /* empty admin state — skip the rest, no header to assert against */
    });
    const visible = await header.isVisible().catch(() => false);
    test.skip(!visible, 'No event seeded so the poster header never rendered');

    // The CSS `print-color-adjust: exact` must be present in the
    // computed style, OR the background-color must resolve to the
    // dark-navy value. Either signal proves the rule is in effect.
    const computed = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        printColorAdjust:
          (s as CSSStyleDeclaration & { printColorAdjust?: string }).printColorAdjust ||
          (s as CSSStyleDeclaration & { webkitPrintColorAdjust?: string }).webkitPrintColorAdjust ||
          '',
      };
    });
    expect(computed.printColorAdjust).toMatch(/exact/i);
    // Dark navy = rgb(26, 26, 46) per the #1a1a2e source.
    expect(computed.bg).toMatch(/rgb\(\s*26,\s*26,\s*46\s*\)/);
  });

  test('OSE-R-006 | FE | GET /poster (print emulation) | sponsor logo computed filter is NOT grayscale', async ({
    page,
  }) => {
    await gotoPosterPrint(page);
    const img = page.locator('.poster-sponsor img').first();
    const has = await img.isVisible().catch(() => false);
    test.skip(!has, 'No sponsor logos seeded — nothing to assert against');

    const filter = await img.evaluate((el) => getComputedStyle(el).filter || '');
    // Computed value "none" is what we want. Anything containing
    // "grayscale" is the regression we're guarding against.
    expect(filter).not.toMatch(/grayscale/i);
  });

  test('OSE-R-006 | FE | GET /poster (print emulation) | poster shell has page-break-inside: avoid', async ({
    page,
  }) => {
    await gotoPosterPrint(page);
    const poster = page.locator('.poster').first();
    const has = await poster.isVisible().catch(() => false);
    test.skip(!has, 'No event seeded');

    const pageBreak = await poster.evaluate(
      (el) => getComputedStyle(el).pageBreakInside || getComputedStyle(el).breakInside || ''
    );
    expect(pageBreak).toMatch(/avoid/);
  });

  test('OSE-R-006 | FE | GET /poster (print emulation) | QR section has page-break-inside: avoid', async ({
    page,
  }) => {
    await gotoPosterPrint(page);
    const qr = page.locator('.qr-section').first();
    const has = await qr.isVisible().catch(() => false);
    test.skip(!has, 'No QR section rendered');

    const pageBreak = await qr.evaluate(
      (el) => getComputedStyle(el).pageBreakInside || getComputedStyle(el).breakInside || ''
    );
    expect(pageBreak).toMatch(/avoid/);
  });

  test('OSE-R-006 | FE | GET /poster (print emulation) | qr-link-url hidden in print so urls do not duplicate next to scannable codes', async ({
    page,
  }) => {
    await gotoPosterPrint(page);
    const url = page.locator('.qr-link-url').first();
    const exists = await url.count();
    test.skip(exists === 0, 'No QR url labels rendered');

    // `hidden` because the rule sets display: none. In print emulation
    // computed display should be `none`.
    const display = await url.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('none');
  });

  test('OSE-R-006 | FE | GET /poster (screen mode) | sponsor logos render in COLOR (not grayscale) on screen too', async ({
    page,
  }) => {
    // Sanity: the print-mode regression must not have a screen-mode
    // counterpart. We verify the on-screen sponsor logo has no
    // grayscale filter applied either. Both surfaces matter — the bar
    // owner previews on screen before printing.
    await page.goto(`${BASE_URL}/poster`, { waitUntil: 'domcontentloaded' });
    await page.emulateMedia({ media: 'screen' });

    const img = page.locator('.poster-sponsor img').first();
    const has = await img.isVisible().catch(() => false);
    test.skip(!has, 'No sponsor logos seeded');

    const filter = await img.evaluate((el) => getComputedStyle(el).filter || '');
    expect(filter).not.toMatch(/grayscale/i);
  });
});
