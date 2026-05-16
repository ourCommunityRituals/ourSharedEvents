/**
 * OSE-312 — /poster print-preview flow + OSE-310 path-alias coverage.
 *
 * Fifth flow spec in the OSE-307 arc. Walks the customer journey
 * (bar owner previewing posters before printing) end-to-end:
 *   1. Land on /poster → page renders + data-poster-format="letter"
 *      attribute present (OSE-310 wiring)
 *   2. Event picker shows loading state initially
 *   3. /api/v2/events fetch completes → at least one event option
 *      appears in the picker
 *   4. Default event auto-selects → poster-card renders with the
 *      event title
 *   5. /api/v2/events/:id/poster-bundle fetch completes → all 4 QR
 *      codes (register/checkin/survey/email-signup) render as
 *      <img> not the loading placeholder
 *   6. Print button (poster-print testid) is reachable + above the
 *      fold on the entry view
 *
 * Plus OSE-310 path-alias coverage — verifies the format registry
 * is wired through to the response for all 6 alias paths:
 *   /poster      → data-poster-format="letter"
 *   /posters     → data-poster-format="letter"
 *   /tabletop    → data-poster-format="tent4x6"
 *   /tent        → data-poster-format="tent4x6"
 *   /flyers      → data-poster-format="flyer"
 *   /signage     → data-poster-format="signage"
 *
 * Failure modes this catches that existing per-surface specs don't:
 *   - Event picker stuck on "Loading events…" because /api/v2/events
 *     fails or times out (current poster-mobile-workability spec
 *     measures DOM but doesn't validate the async chain completes)
 *   - poster-bundle fetch fails → QR codes stuck as loading
 *     placeholders → bar owner can't print
 *   - One of the 4 QR codes silently missing (e.g., generation
 *     failure for survey type) — would show 3 QRs + 1 placeholder
 *   - OSE-310 path-aliased registry desynced from the actual
 *     rendered data-poster-format attribute on any of the 6 aliases
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-312 | FE | flow poster-print-preview | <assertion>`.
 *
 * **Non-mutating:** loads + waits + asserts. Does NOT call
 * window.print() — that would either dispatch a real print job in
 * headless mode (unlikely) OR open a print dialog that hangs the
 * test. Print CSS rules are validated separately by
 * poster-print-colors.spec.ts.
 */

import { test, expect } from '@playwright/test';
import {
  loadAndSettle,
  assertMobileWorkable,
  MOBILE_VIEWPORT,
} from './_helpers/mobile-workability-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

// OSE-310 path → expected data-poster-format mapping. Locked here
// matches POSTER_PRODUCTS in src/lib/poster-products.ts. If founder
// adds a new alias to the router, this map AND that registry both
// need an entry — the poster-family-foundation regression guard
// catches router/registry drift; this spec catches request-to-
// rendered-attribute drift.
const PATH_TO_FORMAT: Record<string, string> = {
  '/poster': 'letter',
  '/posters': 'letter',
  '/tabletop': 'tent4x6',
  '/tent': 'tent4x6',
  '/flyers': 'flyer',
  '/signage': 'signage',
};

test.describe('OSE-312 /poster print-preview flow — end-to-end picker → QR-bundle render', () => {
  test('OSE-312 | FE | flow poster-print-preview | step 1: /poster renders + data-poster-format="letter" + mobile-clean', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/poster`);
    await assertMobileWorkable(page, '/poster', {
      primaryCtaSelector: '[data-testid="poster-print"]',
      // /poster has a <select> for event picker — skip the input-
      // font-size check since the picker is intentionally <16px
      // styled chrome (not a text input customers type into).
      skipInputFontSize: true,
    });
    const bodyFormat = await page.locator('body').getAttribute('data-poster-format');
    expect(bodyFormat).toBe('letter');
  });

  test('OSE-312 | FE | flow poster-print-preview | step 2: event picker populates with at least one option (async /api/v2/events chain)', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/poster`);
    // Wait for the picker to have at least one <option> beyond the
    // placeholder. The JS fetches /api/v2/events and populates the
    // <select> with one <option> per event. If the fetch fails or
    // times out, the picker stays empty → bar owner can't preview
    // any poster.
    const picker = page.locator('[data-testid="poster-event-picker"]');
    await expect(picker).toBeVisible();
    await page.waitForFunction(
      () => {
        const sel = document.querySelector(
          '[data-testid="poster-event-picker"]'
        ) as HTMLSelectElement | null;
        if (!sel) return false;
        // Filter out placeholder option (typically empty value).
        const real = Array.from(sel.options).filter((o) => o.value && o.value.length > 0);
        return real.length >= 1;
      },
      { timeout: 8000 }
    );
  });

  test('OSE-312 | FE | flow poster-print-preview | step 3: default event auto-selects → poster-card renders with title', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/poster`);
    // After picker populates, the first event auto-selects and
    // renderPoster() injects the poster-card into #poster-area.
    await expect(
      page.locator('[data-testid="poster-card"]'),
      'poster-card never rendered — default-event auto-select chain broken'
    ).toBeVisible({ timeout: 8000 });
    const title = await page.locator('[data-testid="poster-title"]').textContent();
    expect(title, 'poster-title empty — event data not flowing into the render').toBeTruthy();
    expect(title!.trim().length).toBeGreaterThan(0);
  });

  test('OSE-312 | FE | flow poster-print-preview | step 4: all 4 QR codes render as <img> (poster-bundle fetch completes)', async ({
    page,
  }) => {
    // OSE-103 poster-bundle endpoint generates QR codes for the 4
    // form types. The page JS swaps the loading placeholders for
    // <img> tags once /api/v2/events/:id/poster-bundle resolves.
    // If any QR fails to load, the bar owner gets a half-broken
    // poster.
    await loadAndSettle(page, `${BASE_URL}/poster`);
    await expect(page.locator('[data-testid="poster-card"]')).toBeVisible({ timeout: 8000 });
    for (const type of ['register', 'checkin', 'survey', 'email-signup']) {
      const qrImg = page.locator(`[data-testid="qr-img-${type}"]`);
      await expect(
        qrImg,
        `qr-img-${type} never rendered — poster-bundle fetch failed OR ${type} QR generation broke`
      ).toBeVisible({ timeout: 8000 });
      const src = await qrImg.getAttribute('src');
      expect(
        src,
        `qr-img-${type} src empty — QR data URI not flowing from poster-bundle response`
      ).toBeTruthy();
      expect(src!.length).toBeGreaterThan(10);
    }
  });

  test('OSE-312 | FE | flow poster-print-preview | step 5: poster-print button reachable above the fold on entry', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/poster`);
    const printBtn = page.locator('[data-testid="poster-print"]');
    await expect(printBtn).toBeVisible();
    const box = await printBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(
      box!.y,
      `poster-print top = ${Math.round(box!.y)}px > viewport ${MOBILE_VIEWPORT.height}px`
    ).toBeLessThan(MOBILE_VIEWPORT.height);
  });
});

// ─── OSE-310 path-alias coverage ────────────────────────────────────────────

test.describe('OSE-312 /poster path-alias coverage — OSE-310 registry wired end-to-end', () => {
  for (const [path, expectedFormat] of Object.entries(PATH_TO_FORMAT)) {
    test(`OSE-312 | FE | flow poster-aliases | ${path} → data-poster-format="${expectedFormat}"`, async ({
      page,
    }) => {
      await loadAndSettle(page, `${BASE_URL}${path}`);
      const actual = await page.locator('body').getAttribute('data-poster-format');
      expect(
        actual,
        `${path} body data-poster-format = "${actual}"; expected "${expectedFormat}" per POSTER_PRODUCTS registry`
      ).toBe(expectedFormat);
    });
  }
});
