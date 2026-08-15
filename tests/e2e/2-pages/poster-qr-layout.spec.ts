/**
 * E2E Invariant Guard: Poster renders and its QR row stays within the poster
 * at mobile widths (375 & 390).
 *
 * Context — the staging board flagged "poster: QR legible at 390px viewport /
 * element overflows container by 24px". Investigation could NOT reproduce that
 * 24px overflow in either Chromium or WebKit (the iPhone-Safari engine): the QR
 * cells render at 100px, the uppercase labels fit within them, and flex-wrap
 * prevents document overflow — so the originally-hypothesized root cause (label
 * wider than the image driving a 3-cell row past the body) does not hold as
 * described. This spec therefore guards the two invariants that ARE real and
 * checkable rather than a mechanism we could not reproduce:
 *   1. the poster surface actually renders (it regressed to a blank "Loading…"
 *      when a JS parse error in the inline script — onerror="...'none'" — killed
 *      the whole script; that fix is what this test protects), and
 *   2. no QR cell (incl. the 4th, email-signup) overflows the QR section or the
 *      document at 375/390, in both loading and loaded states.
 * If the real 24px overflow is device/font-specific, extend VIEWPORTS / add the
 * offending brand font here once a failing artifact (screenshot/trace) is in hand.
 *
 * HERMETIC by design: the poster shell is served from the on-disk template and
 * the events/QR APIs are mocked, so this test needs no live server and cannot
 * inherit the concurrent "ENOTFOUND eventangle.com" staging/baseURL failure.
 * pages.ts serves POSTER_HTML essentially verbatim (only injects a
 * data-poster-format attr on <body>), so the served CSS/markup == this template.
 *
 * Source of truth: workers/oursharedevents/src/templates/poster.html
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TIMEOUT = 20_000;

// Cover both the canonical mobile-workability floor (375) and the exact width
// named by the failing staging case (390). The grid fix is viewport-agnostic,
// so either reproduces the pre-fix overflow.
const VIEWPORTS = [
  { name: '375px (mobile-workability floor)', width: 375, height: 812 },
  { name: '390px (staging failure width)', width: 390, height: 844 },
];

const QR_TESTIDS = [
  'poster-qr-register',
  'poster-qr-checkin',
  'poster-qr-survey',
  'poster-qr-email-signup',
];

const POSTER_HTML = readFileSync(
  resolve(__dirname, '../../../workers/oursharedevents/src/templates/poster.html'),
  'utf8'
  // mirror the only server-side mutation pages.ts makes (handlers/pages.ts:1409)
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

// A deliberately long link so the injected .qr-link-url is stressed as a
// potential second max-content driver (guards the overflow-wrap on it too).
const LONG_LINK =
  'https://stg.oursharedevents.com/e/layout-regression/email-signup?utm_source=poster&utm_campaign=qr-email-signup-legibility';

function qrBundleBody() {
  const types = ['register', 'checkin', 'survey', 'email-signup'] as const;
  const qr: Record<string, string> = {};
  const links: Record<string, string> = {};
  const labels: Record<string, string> = {};
  for (const t of types) {
    qr[t] = PNG_1PX;
    links[t] =
      t === 'email-signup' ? LONG_LINK : `https://stg.oursharedevents.com/e/layout-regression/${t}`;
    labels[t] = t.replace('-', ' ');
  }
  return { ok: true, qr, links, labels };
}

/**
 * Serve the poster shell hermetically and mock its data dependencies.
 * @param qrMode 'loading' aborts the QR bundle (cells stay in .qr-loading
 *   placeholder state) | 'loaded' fulfils it (cells become real .qr-img links).
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

/** Measure the QR section + each cell in one round trip. */
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
  test.describe(`Poster QR layout — ${mode} state`, () => {
    for (const vp of VIEWPORTS) {
      test(`no overflow & every QR cell contained at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openPoster(page, mode);

        if (mode === 'loaded') {
          // wait for the placeholders to be replaced by real QR links
          await expect(page.locator('[data-testid="qr-img-email-signup"]')).toBeVisible({
            timeout: TIMEOUT,
          });
        }

        const m = await measure(page, QR_TESTIDS);

        // (a) No document-level horizontal scroll — the exact invariant the
        // 24px overflow tripped (mirrors mobile-workability + poster-error-states).
        expect(
          m.scrollWidth,
          `document overflows viewport by ${m.scrollWidth - m.clientWidth}px`
        ).toBeLessThanOrEqual(m.clientWidth + 1);

        // (b/c/d) Per-cell containment: every QR cell (incl. the 4th,
        // email-signup) is present and sits fully within the QR section, and
        // honors the 140px cap. This catches the NEXT overflow regardless of
        // which child (label or injected URL) drives width.
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
