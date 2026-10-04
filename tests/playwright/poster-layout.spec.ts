/**
 * OSE-1516 — the poster arranges itself from what the event has, measured in
 * a real browser: where the codes sit, that none is under 100px, that the title
 * stays on one line, that nothing scrolls sideways, and that every combination
 * still fits the one printed sheet.
 *
 * The rules themselves (which layout for which count) are unit-tested in
 * workers/oursharedevents/tests/poster-layout.spec.ts; the page script in
 * jsdom there cannot lay anything out, so this spec is the half that can.
 *
 * No seeded data: the poster's one data call (the poster-bundle) is answered
 * from the test, and the artwork is a same-origin SVG (CSP img-src 'self').
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const EVT = 'evt-layout-1516';
const QR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const KINDS = ['public', 'checkin', 'register', 'donation', 'signup', 'tickets', 'ow', 'league'];
const ART_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1100" viewBox="0 0 850 1100"><rect width="850" height="1100" fill="#4a7"/><circle cx="425" cy="500" r="300" fill="#fc3"/></svg>';

type Opts = {
  n: number;
  art?: boolean;
  sponsors?: boolean;
  kind?: 'print' | 'digital';
  name?: string;
};

async function load(page: Page, o: Opts) {
  const art = o.art !== false;
  await page.route(`**/api/v2/events/${EVT}/poster-bundle`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        event: {
          id: EVT,
          name: o.name ?? 'Harbor County Bocce',
          venue: 'Harbor Hall, Sawyer',
          startDateISO: '2026-10-24',
          starts_at: '2026-10-24T23:00:00.000Z',
          timezone: 'America/Chicago',
          ...(art ? { cover_image_url: '/art-1516.svg' } : {}),
        },
        sponsors:
          o.sponsors === false ? [] : [{ id: 'sp1', name: 'Sawyer Hardware', tier: 'primary' }],
        slots: Array.from({ length: o.n }, (_, i) => ({
          kind: KINDS[i],
          word: KINDS[i].toUpperCase(),
          label: KINDS[i],
          code: `Cd${String(i).padStart(4, '0')}`,
          qr: QR,
        })),
      }),
    })
  );
  await page.route('**/art-1516.svg', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: ART_SVG })
  );
  await page.goto(`/poster?event=${EVT}&kind=${o.kind ?? 'print'}`, {
    waitUntil: 'domcontentloaded',
  });
  const card = page.getByTestId('poster-card');
  await expect(card).toHaveAttribute('data-codes', String(o.n));
  await page.waitForFunction(() =>
    Array.from(document.images).every((i) => i.complete && (i.naturalWidth > 0 || i.hidden))
  );
  return card;
}

type Box = { x: number; y: number; w: number; h: number };
const box = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height };
  }, sel) as Promise<Box | null>;
const boxes = (page: Page, sel: string) =>
  page.evaluate((s) => {
    return Array.from(document.querySelectorAll(s)).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height };
    });
  }, sel) as Promise<Box[]>;
const overlap = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 820, height: 1180 },
  { width: 1280, height: 900 },
];

async function expectBasics(page: Page, n: number, kind: string) {
  // Nothing scrolls sideways.
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(over, 'horizontal overflow').toBeLessThanOrEqual(1);
  // The title is one line (the last step may wrap; none of these names needs it).
  const title = await page.evaluate(() => {
    const h = document.querySelector('[data-testid="poster-title"]') as HTMLElement;
    const fs = parseFloat(getComputedStyle(h).fontSize);
    return { h: h.getBoundingClientRect().height, fs, step: h.getAttribute('data-title-step') };
  });
  expect(title.h, `title height ${title.h} at ${title.fs}px, step ${title.step}`).toBeLessThan(
    title.fs * 1.4
  );
  // Codes keep their size: a printed code is never under 100px.
  if (kind === 'print' && n > 0) {
    for (const b of await boxes(page, '#poster-qr-slots .qr-img')) {
      expect(b.w, 'code width').toBeGreaterThanOrEqual(99.5);
      expect(b.h, 'code height').toBeGreaterThanOrEqual(99.5);
    }
  }
  // No two codes overlap each other.
  const cards = await boxes(page, '#poster-qr-slots .code-card');
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++)
      expect(overlap(cards[i], cards[j]), `cards ${i} and ${j} overlap`).toBe(false);
}

test.describe('OSE-1516 poster layout, measured', () => {
  // Words on the white tiles over the artwork, the side column and the grid:
  // dark on white in both themes, so nothing serious in either.
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const n of [2, 3, 8]) {
      test(`axe WCAG 2.1 AA, ${colorScheme}, ${n} codes: nothing serious`, async ({ page }) => {
        await page.setViewportSize(VIEWPORTS[1]);
        await page.emulateMedia({ colorScheme });
        await load(page, { n });
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const found = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);
        expect(found, found.join(' | ')).toEqual([]);
      });
    }
  }

  // Every count on the phone; the boundaries (1, 2, 3, 4, 8) on every width.
  for (const vp of VIEWPORTS) {
    for (let n = 1; n <= 8; n++) {
      if (vp.width !== 375 && ![1, 2, 3, 4, 8].includes(n)) continue;
      test(`print, ${n} code(s) with artwork at ${vp.width}px`, async ({ page }) => {
        await page.setViewportSize(vp);
        await load(page, { n });
        await expectBasics(page, n, 'print');

        const art = await box(page, '[data-testid="poster-art-viewport"]');
        const cards = await boxes(page, '#poster-qr-slots .code-card');
        expect(art, 'artwork is drawn').not.toBeNull();
        expect(art!.w).toBeGreaterThan(80);
        expect(cards).toHaveLength(n);

        if (n <= 2) {
          // On top of the artwork, bottom corners, left then right.
          for (const c of cards) {
            expect(c.x).toBeGreaterThanOrEqual(art!.x - 1);
            expect(c.x + c.w).toBeLessThanOrEqual(art!.x + art!.w + 1);
            expect(c.y + c.h).toBeLessThanOrEqual(art!.y + art!.h + 1);
            expect(c.y).toBeGreaterThanOrEqual(art!.y - 1);
          }
          expect(cards[0].x).toBeLessThan(art!.x + art!.w / 2);
          if (n === 2) expect(cards[1].x + cards[1].w).toBeGreaterThan(art!.x + art!.w / 2);
          // Full width artwork: the codes cost it nothing.
          const stage = await box(page, '[data-testid="poster-stage"]');
          expect(Math.abs(art!.w - stage!.w)).toBeLessThanOrEqual(1);
        } else if (n === 3) {
          // A column beside the artwork.
          for (const c of cards) expect(c.x).toBeGreaterThanOrEqual(art!.x + art!.w - 1);
          expect(Math.abs(cards[0].x - cards[2].x)).toBeLessThanOrEqual(2);
        } else {
          // Two columns under the artwork.
          for (const c of cards) expect(c.y).toBeGreaterThanOrEqual(art!.y + art!.h - 1);
          const xs = Array.from(new Set(cards.map((c) => Math.round(c.x / 4))));
          expect(xs.length, 'two columns').toBe(n === 1 ? 1 : 2);
        }
      });
    }
  }

  for (const vp of [VIEWPORTS[1], VIEWPORTS[3]]) {
    test(`print, no artwork at ${vp.width}px: no art area, codes in a row, nothing dashed`, async ({
      page,
    }) => {
      await page.setViewportSize(vp);
      for (const n of [1, 3, 4, 8]) {
        await page.unrouteAll();
        await load(page, { n, art: false });
        await expectBasics(page, n, 'print');
        expect(await box(page, '[data-testid="poster-art-viewport"]')).toBeNull();
        expect(await box(page, '[data-testid="poster-art-empty"]')).toBeNull();
        const cards = await boxes(page, '#poster-qr-slots .code-card');
        expect(cards).toHaveLength(n);
        // The first row of codes is one line (same top).
        const firstRow = cards.filter((c) => Math.abs(c.y - cards[0].y) < 4);
        expect(firstRow.length).toBeGreaterThanOrEqual(Math.min(n, vp.width > 600 ? 3 : 2));
      }
    });
  }

  for (const vp of [VIEWPORTS[1], VIEWPORTS[3]]) {
    for (const n of [1, 3, 5, 8]) {
      test(`digital, ${n} code(s) at ${vp.width}px: same layout, tappable links, 44px targets`, async ({
        page,
      }) => {
        await page.setViewportSize(vp);
        await load(page, { n, kind: 'digital' });
        await expectBasics(page, n, 'digital');
        for (const b of await boxes(page, '#poster-qr-slots a.qr-slot-code')) {
          expect(b.h).toBeGreaterThanOrEqual(43.5);
        }
        await expect(page.getByTestId('poster-qr-slot-action-public')).toHaveText(
          'Tap to see the event'
        );
      });
    }
  }

  test('a title that fits keeps its full size; with no artwork it grows', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[3]);
    const size = () =>
      page.evaluate(() => {
        const h = document.querySelector('[data-testid="poster-title"]') as HTMLElement;
        return {
          fs: parseFloat(getComputedStyle(h).fontSize),
          step: Number(h.getAttribute('data-title-step')),
        };
      });
    await load(page, { n: 2, name: 'Bocce' });
    const withArt = await size();
    // 2.75rem is the full size beside artwork; a short name must not step down.
    expect(withArt.step).toBe(0);
    expect(withArt.fs).toBeCloseTo(44, 0);
    await page.unrouteAll();
    await load(page, { n: 2, art: false, name: 'Bocce' });
    const noArt = await size();
    expect(noArt.step).toBe(0);
    expect(noArt.fs).toBeGreaterThan(withArt.fs);
  });

  test('a long title steps down and stays on one line at phone width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[1]);
    await load(page, {
      n: 2,
      name: 'The Annual Harbor County Summer Bocce League Night Fundraiser',
    });
    const t = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="poster-title"]') as HTMLElement;
      return {
        step: Number(h.getAttribute('data-title-step')),
        over: (() => {
          const r = document.createRange();
          r.selectNodeContents(h);
          return r.getBoundingClientRect().width - h.clientWidth;
        })(),
        fs: parseFloat(getComputedStyle(h).fontSize),
      };
    });
    expect(t.step).toBeGreaterThan(0);
    // Either it fits one line, or it is on the last step (the only one that wraps).
    if (t.step < 4) expect(t.over).toBeLessThanOrEqual(1);
  });

  test('date, start time and venue are one line on a desktop screen', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[3]);
    await load(page, { n: 2 });
    const d = await box(page, '[data-testid="poster-meta-date"]');
    const v = await box(page, '[data-testid="poster-meta-venue"]');
    expect(Math.abs(d!.y - v!.y)).toBeLessThan(6);
    await expect(page.getByTestId('poster-meta-date')).toContainText('6:00 PM CDT');
  });

  test('artwork that fails to load drops out and the poster is laid out again', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS[3]);
    await page.route('**/art-1516.svg', (route) => route.fulfill({ status: 404, body: 'no' }));
    await page.route(`**/api/v2/events/${EVT}/poster-bundle`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          event: { id: EVT, name: 'Bocce', venue: 'Hall', cover_image_url: '/art-1516.svg' },
          sponsors: [],
          slots: [{ kind: 'public', word: 'EVENT', code: 'Cd0000', qr: QR }],
        }),
      })
    );
    await page.goto(`/poster?event=${EVT}&kind=print`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('poster-card')).toHaveAttribute('data-layout', 'row');
    await expect(page.getByTestId('poster-art-viewport')).toHaveCount(0);
  });
});

// The printed sheet: 11in x 14in with 0.35in margins = 10.3in x 13.3in of poster.
// Whatever the count, with or without artwork and sponsors, it is one sheet.
test.describe('OSE-1516 poster layout, on the printed sheet', () => {
  const SHEET = { width: Math.round(10.3 * 96), height: Math.round(13.3 * 96) };
  for (const art of [true, false]) {
    for (const sponsors of [true, false]) {
      for (let n = 1; n <= 8; n++) {
        // With artwork: every count, with and without sponsors. Without:
        // the boundaries, with sponsors (the tallest case).
        if (!art && !(sponsors && [1, 4, 8].includes(n))) continue;
        test(`print sheet: ${n} code(s), artwork ${art}, sponsors ${sponsors}: one sheet, codes at size`, async ({
          page,
        }) => {
          await page.setViewportSize(SHEET);
          await load(page, { n, art, sponsors });
          await page.emulateMedia({ media: 'print' });
          const m = await page.evaluate(() => {
            const p = document.querySelector('[data-testid="poster-card"]') as HTMLElement;
            const h = document.querySelector('[data-testid="poster-title"]') as HTMLElement;
            const fs = parseFloat(getComputedStyle(h).fontSize);
            return {
              h: p.getBoundingClientRect().height,
              titleH: h.getBoundingClientRect().height,
              fs,
              over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          });
          expect(m.h, 'poster height in px (sheet is 1277)').toBeLessThanOrEqual(SHEET.height + 1);
          expect(m.over).toBeLessThanOrEqual(1);
          expect(m.titleH).toBeLessThan(m.fs * 1.4);
          for (const b of await boxes(page, '#poster-qr-slots .qr-img')) {
            expect(b.w).toBeGreaterThanOrEqual(99.5);
            expect(b.h).toBeGreaterThanOrEqual(99.5);
          }
          const cards = await boxes(page, '#poster-qr-slots .code-card');
          for (let i = 0; i < cards.length; i++)
            for (let j = i + 1; j < cards.length; j++)
              expect(overlap(cards[i], cards[j])).toBe(false);
          if (art && n <= 2) {
            // About 1.9in tiles.
            for (const c of cards) expect(Math.abs(c.w - 1.9 * 96)).toBeLessThanOrEqual(8);
          }
          if (art && n >= 4) {
            const a = await box(page, '[data-testid="poster-art-img"]');
            expect(a!.h, 'artwork is never dropped').toBeGreaterThan(1.4 * 96);
          }
        });
      }
    }
  }
});
