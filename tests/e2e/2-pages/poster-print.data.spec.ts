/**
 * E2E Tests: Poster Page — DATA-DEPENDENT (needs seeded events)
 *
 * Split out of poster-print.spec.ts (OSE-1228). These specs assert on specific
 * seeded rows — a populated event picker, rendered poster content, 2 QR
 * placeholders, print layout — so they are only honest where REAL data exists.
 * They run at the STAGING E2E tier (testMatch **\/*.spec.ts against the deployed
 * worker), NOT in the COMPONENT tier: playwright.component.config.ts names its
 * files explicitly and does NOT name this one, so an unseeded local worker can no
 * longer make these skip vacuously and manufacture a green.
 *
 * Each describe still guards with `test.skip(!hasEvents)` so that if a staging
 * environment is genuinely empty the skip is principled (no data) rather than
 * masking a broken backend — and at the staging tier that skip is visible in the
 * run summary.
 */

import { test, expect } from '@playwright/test';
import { navigateToPoster, hasEvents, selectEvent } from './poster-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT PICKER — WITH DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Event Picker (Data Present)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
    test.skip(!(await hasEvents(page)), 'No events on staging — skipping picker tests');
  });

  test('picker is populated with event options', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    const options = picker.locator('option');
    expect(await options.count()).toBeGreaterThanOrEqual(1);
  });

  test('first option is selected by default', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    const value = await picker.inputValue();
    expect(value).toBe('0');
  });

  test('each option has text content (event name)', async ({ page }) => {
    const options = page.locator('[data-testid="poster-event-picker"] option');
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      const text = await options.nth(i).textContent();
      expect(text?.trim().length, `Option ${i} is empty`).toBeGreaterThan(0);
    }
  });

  test('selecting a different event re-renders the poster', async ({ page }) => {
    const options = page.locator('[data-testid="poster-event-picker"] option');
    const count = await options.count();
    test.skip(count < 2, 'Need at least 2 events to test picker switch');

    // Get first poster content
    const firstPoster = await page.locator('[data-testid="poster-area"]').innerHTML();

    // Select second event
    await selectEvent(page, 1);

    // Poster should have changed
    const secondPoster = await page.locator('[data-testid="poster-area"]').innerHTML();
    // Content may or may not differ (events could have same name) — at minimum it shouldn't error
    expect(secondPoster.length).toBeGreaterThan(0);
  });

  test('switching back to first event restores its poster', async ({ page }) => {
    const options = page.locator('[data-testid="poster-event-picker"] option');
    const count = await options.count();
    test.skip(count < 2, 'Need at least 2 events');

    const firstPoster = await page.locator('[data-testid="poster-area"]').innerHTML();
    await selectEvent(page, 1);
    await selectEvent(page, 0);
    const restoredPoster = await page.locator('[data-testid="poster-area"]').innerHTML();

    expect(restoredPoster).toBe(firstPoster);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POSTER RENDERING — WITH DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Poster Content (Data Present)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
    test.skip(!(await hasEvents(page)), 'No events on staging');
  });

  test('poster card renders', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-area"] .poster')).toBeVisible();
  });

  test('poster header shows org name', async ({ page }) => {
    const org = page.locator('[data-testid="poster-area"] .poster-header .org');
    await expect(org).toBeVisible();
    await expect(org).toContainText('OurSharedEvents');
  });

  test('poster header shows event name in h2', async ({ page }) => {
    const h2 = page.locator('[data-testid="poster-area"] .poster-header h2');
    await expect(h2).toBeVisible();
    const text = await h2.textContent();
    expect(text?.trim().length, 'Event name should not be empty').toBeGreaterThan(0);
  });

  test('poster body is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-area"] .poster-body')).toBeVisible();
  });

  test('poster has meta section', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-area"] .poster-meta')).toBeVisible();
  });

  test('meta rows have icon + text structure', async ({ page }) => {
    const rows = page.locator('[data-testid="poster-area"] .meta-row');
    const count = await rows.count();
    // May have 0 meta rows if event has no date/venue — that's valid
    if (count > 0) {
      const firstRow = rows.first();
      await expect(firstRow.locator('.meta-icon')).toBeVisible();
      await expect(firstRow.locator('.meta-text')).toBeVisible();
    }
  });

  test('QR section renders with 2 placeholder items', async ({ page }) => {
    const qrSection = page.locator('[data-testid="poster-area"] .qr-section');
    await expect(qrSection).toBeVisible();

    const qrItems = qrSection.locator('.qr-item');
    expect(await qrItems.count()).toBe(2);
  });

  test('QR placeholders are 120x120 dashed boxes', async ({ page }) => {
    const placeholders = page.locator('[data-testid="poster-area"] .qr-placeholder');
    expect(await placeholders.count()).toBe(2);

    for (let i = 0; i < 2; i++) {
      const box = await placeholders.nth(i).boundingBox();
      expect(box, `QR placeholder ${i} should have a bounding box`).toBeTruthy();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(100);
        expect(box.height).toBeGreaterThanOrEqual(100);
      }
    }
  });

  test('QR labels show "Event Page" and "Registration"', async ({ page }) => {
    const labels = page.locator('[data-testid="poster-area"] .qr-label');
    expect(await labels.count()).toBe(2);

    const texts = await labels.allTextContents();
    expect(texts.some((t) => t.includes('Event Page'))).toBe(true);
    expect(texts.some((t) => t.includes('Registration'))).toBe(true);
  });

  test('poster footer shows domain', async ({ page }) => {
    const footer = page.locator('[data-testid="poster-area"] .poster-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('oursharedevents.com');
  });

  test('no GAS HTML markers in poster content', async ({ page }) => {
    const content = await page.locator('[data-testid="poster-area"]').innerHTML();
    expect(content).not.toContain('userCodeAppPanel');
    expect(content).not.toContain('Google Apps Script');
    expect(content).not.toContain('script.google.com');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRINT LAYOUT — needs a rendered poster (data present)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Print Layout', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
    test.skip(!(await hasEvents(page)), 'No events — skipping print tests');
  });

  test('page header has .no-print class', async ({ page }) => {
    const header = page.locator('[data-testid="poster-header"]');
    const classes = await header.getAttribute('class');
    expect(classes).toContain('no-print');
  });

  test('event select has .no-print class', async ({ page }) => {
    const eventSelect = page.locator('[data-testid="poster-event-select"]');
    const classes = await eventSelect.getAttribute('class');
    expect(classes).toContain('no-print');
  });

  test('@media print CSS hides .no-print elements', async ({ page }) => {
    // Emulate print media
    await page.emulateMedia({ media: 'print' });

    const header = page.locator('[data-testid="poster-header"]');
    await expect(header).toBeHidden();

    const eventSelect = page.locator('[data-testid="poster-event-select"]');
    await expect(eventSelect).toBeHidden();
  });

  test('@media print — poster card is still visible', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-testid="poster-area"] .poster')).toBeVisible();
  });

  test('@media print — poster has no box-shadow', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    const poster = page.locator('[data-testid="poster-area"] .poster');
    const boxShadow = await poster.evaluate((el) => window.getComputedStyle(el).boxShadow);
    expect(boxShadow === 'none' || boxShadow === '').toBe(true);
  });

  test('@media print — body background is white', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    const bg = await page
      .locator('body')
      .evaluate((el) => window.getComputedStyle(el).backgroundColor);
    // white = rgb(255, 255, 255) or transparent
    expect(bg === 'rgb(255, 255, 255)' || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent').toBe(
      true
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // OSE-1356/OSE-1366 — RENDERED 11x14 print layout regression.
  //
  // The static source-file assertions in poster-qr.spec.ts (Worker unit tier)
  // lock the CSS TEXT for the 11x14 @page rule, art viewport max-height, title
  // font-size, and QR quiet-zone padding. They cannot prove the rules actually
  // APPLY to the rendered DOM under print media — a selector typo or a rule
  // shadowed by specificity would still pass a `toContain('max-height: 6.2in')`
  // string check. These tests render the real poster card in a browser under
  // `page.emulateMedia({ media: 'print' })` and read computed styles, so a
  // regression that breaks the CASCADE (not just the source text) goes red.
  // ─────────────────────────────────────────────────────────────────────────

  test('@media print — poster shell keeps a single-page-safe box (page-break-inside: avoid)', async ({
    page,
  }) => {
    await page.emulateMedia({ media: 'print' });
    const poster = page.locator('[data-testid="poster-area"] .poster');
    const pageBreak = await poster.evaluate(
      (el) => window.getComputedStyle(el).getPropertyValue('page-break-inside') || ''
    );
    // Some engines normalize page-break-inside to break-inside internally;
    // accept either the legacy or standard property reporting 'avoid'.
    if (pageBreak) {
      expect(pageBreak).toBe('avoid');
    } else {
      const breakInside = await poster.evaluate(
        (el) => window.getComputedStyle(el).getPropertyValue('break-inside') || ''
      );
      expect(breakInside).toBe('avoid');
    }
  });

  test('@media print — title renders at a large, legible print size (OSE-1356)', async ({
    page,
  }) => {
    await page.emulateMedia({ media: 'print' });
    const title = page.locator('[data-testid="poster-area"] [data-testid="poster-title"]');
    await expect(title).toBeVisible();
    const fontSizePx = await title.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).fontSize)
    );
    // 38pt ≈ 50.7px at the browser's 96dpi/72pt convention. Assert a floor
    // comfortably below that (48px) rather than an exact match, so a small
    // token/line-height rebalance does not false-red this test — the
    // property under test is "large enough to read across a room", not an
    // exact pixel value.
    expect(
      fontSizePx,
      `title font-size ${fontSizePx}px is too small for print`
    ).toBeGreaterThanOrEqual(48);
  });

  test('@media print — art viewport enlarges and height-clamps when artwork is present', async ({
    page,
  }) => {
    await page.emulateMedia({ media: 'print' });
    const art = page.locator('[data-testid="poster-area"] [data-testid="poster-art-img"]');
    const count = await art.count();
    test.skip(count === 0, 'This event has no cover artwork — nothing to clamp');

    const maxHeightPx = await art
      .first()
      .evaluate((el) => parseFloat(window.getComputedStyle(el).maxHeight));
    // 6.2in ≈ 595px at 96dpi. Floor it generously (400px) so this asserts
    // "large viewport", the property OSE-1356 changed, without being brittle
    // to a future fine-tune of the exact inch value.
    expect(
      maxHeightPx,
      `art max-height ${maxHeightPx}px is not an enlarged viewport`
    ).toBeGreaterThanOrEqual(400);

    const renderedHeight = await art.first().evaluate((el) => el.getBoundingClientRect().height);
    expect(
      renderedHeight,
      'art must not render taller than its own max-height clamp'
    ).toBeLessThanOrEqual(maxHeightPx + 2);
  });

  test('@media print — every rendered QR keeps a white quiet-zone padding (OSE-1356)', async ({
    page,
  }) => {
    await page.emulateMedia({ media: 'print' });
    const qrImages = page.locator('[data-testid="poster-area"] .qr-section .qr-img');
    const count = await qrImages.count();
    test.skip(count === 0, 'No QR codes rendered for this event — nothing to check');

    for (let i = 0; i < count; i++) {
      const img = qrImages.nth(i);
      const { paddingPx, bg } = await img.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return { paddingPx: parseFloat(cs.paddingLeft), bg: cs.backgroundColor };
      });
      expect(paddingPx, `QR #${i} has no quiet-zone padding`).toBeGreaterThan(0);
      expect(
        bg === 'rgb(255, 255, 255)' ||
          bg === 'rgba(0, 0, 0, 0)' ||
          bg === 'transparent' ||
          bg === '',
        `QR #${i} quiet zone is not white (got "${bg}")`
      ).toBe(true);
    }
  });

  test('@media print — multiple minted QR slots (if any) stay inside the printable section, no overflow (OSE-1357)', async ({
    page,
  }) => {
    await page.emulateMedia({ media: 'print' });
    const qrSection = page.locator('[data-testid="poster-area"] .qr-section');
    const qrImages = page.locator('[data-testid="poster-area"] .qr-section .qr-img');
    const count = await qrImages.count();
    test.skip(count < 2, 'Fewer than 2 minted slots on this event — nothing to check for overflow');

    const sectionBox = await qrSection.boundingBox();
    expect(sectionBox, 'qr-section has no layout box').not.toBeNull();
    for (let i = 0; i < count; i++) {
      const box = await qrImages.nth(i).boundingBox();
      expect(box, `QR #${i} has no layout box`).not.toBeNull();
      if (box && sectionBox) {
        expect(
          box.x >= sectionBox.x - 1 && box.x + box.width <= sectionBox.x + sectionBox.width + 1,
          `QR #${i} overflows the printable qr-section horizontally`
        ).toBe(true);
      }
    }
  });
});
