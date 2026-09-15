/**
 * E2E Invariant Guard: Poster renders and its QR row stays within the poster
 * at mobile widths (375 & 390).
 *
 * Context — the staging board flagged "poster: QR legible at 390px viewport /
 * element overflows container by 24px". Investigation could NOT reproduce that
 * 24px overflow in either Chromium or WebKit: the QR cells render at 100px and
 * flex-wrap prevents document overflow. This spec guards the two invariants that
 * ARE real and checkable:
 *   1. the poster surface actually renders (it regressed to a blank "Loading…"
 *      when a JS parse error in the inline script killed the whole script), and
 *   2. no QR cell overflows the QR section or the document at 375/390.
 *
 * P2 (OSE-1319) rebuilt the QR row: it is now DYNAMIC /q+/s destination slots
 * (Public + the event's typed outbound link), rendered client-side by
 * loadPosterQR from bundle.slots, NOT the four fixed form QRs. Each slot card
 * also prints its /s shortlink (.qr-slot-code) — a NEW potential overflow driver,
 * so we stress it with a deliberately long shortlink. Slot testids are built at
 * runtime (poster-qr-slot-<kind>), so this spec references them via variables,
 * never static literals — the same way it always handled the per-cell ids, and
 * what keeps the testid-drift scanner honest.
 *
 * HERMETIC by design: the poster shell is served from the on-disk template and
 * the events/QR APIs are mocked, so this test needs no live server. pages.ts
 * serves POSTER_HTML essentially verbatim (only injects a data-poster-format
 * attr on <body>), so the served CSS/markup == this template.
 *
 * Source of truth: workers/oursharedevents/src/templates/poster.html
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TIMEOUT = 20_000;

const VIEWPORTS = [
  { name: '375px (mobile-workability floor)', width: 375, height: 812 },
  { name: '390px (staging failure width)', width: 390, height: 844 },
];

// The poster carries the always-present Public slot plus the event's typed link
// (here: donation). Kinds drive the runtime testids poster-qr-slot-<kind> /
// qr-img-slot-<kind>; built as data, referenced only via `${…}` interpolation.
const SLOT_KINDS = ['public', 'donation'] as const;
const SLOT_CARD_IDS = SLOT_KINDS.map((k) => `poster-qr-slot-${k}`);
const WAIT_IMG_ID = `qr-img-slot-${SLOT_KINDS[1]}`; // the typed slot img settles last

const POSTER_HTML = readFileSync(
  resolve(__dirname, '../../../workers/oursharedevents/src/templates/poster.html'),
  'utf8'
  // mirror the only server-side mutation pages.ts makes (handlers/pages.ts)
).replace('<body>', '<body data-poster-format="letter">');

// 1x1 transparent PNG — the QR <img> is CSS-sized (100px on mobile), so the
// intrinsic pixels are irrelevant; we only need a non-network src.
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const EVENTS_BODY = {
  ok: true,
  items: [
    {
      id: 'evt_layout_test',
      name: 'Layout Regression Event',
      title: 'Layout Regression Event',
      slug: 'layout-regression',
      status: 'active',
      brand_id: 'root',
    },
  ],
};

// A deliberately long /s shortlink so the PRINTED shortlink (.qr-slot-code, new
// in P2) is stressed as an overflow driver alongside the QR image — it must wrap
// (word-break) inside the card, never widen it past the section.
const LONG_SHORTLINK =
  'https://stg.oursharedevents.com/s/aVeryLongShortcodeThatMustWrapNotOverflowTheCardOrSection0123456789';

function qrBundleBody() {
  const slots = SLOT_KINDS.map((kind) => ({
    kind,
    label: kind === 'public' ? 'Event page' : 'Donate',
    code: kind === 'public' ? 'pub123' : 'don456',
    url: kind === 'donation' ? LONG_SHORTLINK : 'https://stg.oursharedevents.com/s/pub123',
    qr: PNG_1PX,
  }));
  return { ok: true, slots };
}

/**
 * Serve the poster shell hermetically and mock its data dependencies.
 * @param qrMode 'loading' aborts the QR bundle (the single .qr-loading
 *   placeholder stays, no slot cards) | 'loaded' fulfils it (slot cards render).
 */
async function openPoster(page: any, qrMode: 'loading' | 'loaded') {
  await page.route('**/api/v2/events/*/poster-bundle', (route: any) =>
    qrMode === 'loaded'
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(qrBundleBody()) })
      : route.abort('failed')
  );
  // Sponsor strip is non-critical to layout — keep it empty & deterministic.
  await page.route('**/sponsor-bundle*', (route: any) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
  await page.route('**/api/v2/events', (route: any) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(EVENTS_BODY) })
  );
  await page.route('**/poster', (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: POSTER_HTML })
  );
  await page.goto('http://poster.test/poster', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await expect(page.locator('[data-testid="poster-qr-section"]')).toBeVisible({ timeout: TIMEOUT });
}

/** Measure the QR section + each named cell in one round trip. */
async function measure(page: any, testids: string[]) {
  return page.evaluate((ids: string[]) => {
    const doc = document.documentElement;
    const section = document.querySelector('[data-testid="poster-qr-section"]') as HTMLElement;
    const sr = section.getBoundingClientRect();
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      section: { left: sr.left, right: sr.right },
      cells: ids.map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        if (!el) return { id, present: false, left: 0, right: 0, width: 0 };
        const r = el.getBoundingClientRect();
        return { id, present: true, left: r.left, right: r.right, width: r.width };
      }),
    };
  }, testids);
}

for (const mode of ['loading', 'loaded'] as const) {
  test.describe(`Poster QR slot layout — ${mode} state`, () => {
    for (const vp of VIEWPORTS) {
      test(`no overflow & every slot card contained at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openPoster(page, mode);

        // In loaded mode wait for the slot cards to replace the placeholder; in
        // loading mode there are no slot cards, only the .qr-loading placeholder.
        const cellIds = mode === 'loaded' ? SLOT_CARD_IDS : [];
        if (mode === 'loaded') {
          await expect(page.locator(`[data-testid="${WAIT_IMG_ID}"]`)).toBeVisible({
            timeout: TIMEOUT,
          });
        }

        const m = await measure(page, cellIds);

        // (a) No document-level horizontal scroll — the exact invariant the 24px
        // overflow tripped. Holds in BOTH states (the loading placeholder must
        // not overflow either).
        expect(
          m.scrollWidth,
          `document overflows viewport by ${m.scrollWidth - m.clientWidth}px`
        ).toBeLessThanOrEqual(m.clientWidth + 1);

        // (b/c/d) Per-slot containment (loaded only): every slot card — incl. the
        // one carrying the LONG printed /s shortlink — sits fully within the QR
        // section and honors the ~140px card cap. Catches the next overflow
        // regardless of which child (QR image or printed shortlink) drives width.
        for (const cell of m.cells) {
          expect(cell.present, `${cell.id} missing`).toBe(true);
          expect(
            cell.right,
            `${cell.id} right edge ${cell.right} exceeds QR section right ${m.section.right}`
          ).toBeLessThanOrEqual(m.section.right + 1);
          expect(
            cell.left,
            `${cell.id} left edge ${cell.left} is left of QR section ${m.section.left}`
          ).toBeGreaterThanOrEqual(m.section.left - 1);
          expect(
            cell.width,
            `${cell.id} width ${cell.width} exceeds max-width 140px`
          ).toBeLessThanOrEqual(141);
        }
      });
    }
  });
}
