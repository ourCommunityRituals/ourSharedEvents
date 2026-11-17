/**
 * The place panel's layout, measured in a real browser on each device profile
 * (epic OSE-1880; CI/CD ticket OSE-1891, "button grid").
 *
 * One Playwright project per profile, and only this file runs on them
 * (playwright.e2e-smoke.config.ts: `map-phone` 375, `map-tablet` 768,
 * `map-desktop` 1280, `map-tv` 1920). The behaviour suite
 * (tests/e2e/3-flows/map-place-panel.spec.ts) stays on one profile: the owner's
 * rule is a layout contract per device, never the whole suite times the devices.
 * The profile is the project's viewport; no test here resizes the page, so a
 * project that did not set its size cannot pass as another one.
 *
 * What is measured, per card of every place (owner, 2026-11-09, "buttons in a
 * grid, phone first"; lib/event-list.ts PLACE_PANEL_CSS):
 *   - every button at least 48 px tall, and at least 12 px from the next one;
 *   - no sideways scroll;
 *   - on a phone (under 600 px): "Open event" spans the row, the rest sit two to
 *     a row with equal widths, and a last button left alone spans the row;
 *   - from 600 px up: as many equal columns as fit (140 px at least), so one row
 *     wherever the buttons fit;
 *   - a tap in the gap between two buttons does nothing;
 *   - the place rows and the Prev / Next chips are at least 44 px tall.
 *
 * Fixture: bruno/fixtures/map-zoom-area-seed.sql (see helpers/map-zoom-area.ts).
 * Card buttons: map-zoom-a 5 (Open, Register, Tickets, Donate, Share),
 * map-zoom-b 4 (Share alone on the last row of a phone), the others 3.
 *
 * BORN RED (2026-11-14, local Worker on this branch rebased on main; one fault at
 * a time, the tests run on all four projects, the fault taken out). L1 to L7 are
 * in PLACE_PANEL_CSS (workers/oursharedevents/src/lib/event-list.ts). What is
 * written is what was seen:
 *   L1  the buttons 40 px tall
 *         -> "every button is at least 48 px tall and 12 px from the next" fails
 *            on all four profiles
 *   L2  8 px between the buttons
 *         -> the same test fails on all four profiles
 *   L3  nothing spans the row (`grid-column: auto` for Open event and a lone last button)
 *         -> "the grid fits the screen…" fails on all four profiles
 *   L4  no auto-fit from 600 px (two columns everywhere)
 *         -> "the grid fits the screen…" fails on map-tablet, map-desktop and
 *            map-tv; map-phone stays green, as it should
 *   L5  the map block at least 520 px wide
 *         -> "no sideways scroll…" fails on all four profiles
 *   L6  the buttons' grid drops under the whole-card link (`z-index: 0`)
 *         -> "a tap in the gap between two buttons does nothing" fails on all four
 *   L7  the Prev / Next chips 30 px tall
 *   L8  ZOOM_STYLE (lib/map-zoom-style.ts): place rows and the way back 20 px tall
 *         -> each: "the place rows and the Prev / Next chips are at least 44 px
 *            tall" fails on all four profiles
 *   U19 playwright.e2e-smoke.config.ts: the map-tv project set to 1600 px wide
 *         -> "the profile is the one its project names" fails on map-tv only
 *   D3  data: the fixture is unpublished
 *         -> "the profile is the one its project names" fails on all four (the
 *            zoomed page is not there to load)
 * Every test in this file failed under at least one fault.
 */
import { test, expect, type Page } from '@playwright/test';
import { EVENTS_AT, PLACES, card, gotoArea, openPanels, panel } from '../helpers/map-zoom-area';

test.use({ locale: 'en-US' });

const TAP_MIN = 48;
const TAP_GAP = 12;
const TARGET_MIN = 44;
const PHONE_MAX = 600;
/** The auto-fit column minimum from 600 px up (PLACE_PANEL_CSS). */
const AUTO_FIT_MIN = 140;
// Sub-pixel layout: a 12 px gap can measure 11.99.
const EPS = 0.5;

interface Box {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The buttons of one card, in order, with where each one sits. */
async function buttons(page: Page, eventId: string): Promise<{ boxes: Box[]; width: number }> {
  return card(page, eventId)
    .getByTestId('amap-acts')
    .evaluate((acts) => {
      const boxes = [...acts.children].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.textContent ?? '').trim(),
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
        };
      });
      return { boxes, width: acts.getBoundingClientRect().width };
    });
}

/** Group boxes into rows by their top edge. */
function rows(boxes: Box[]): Box[][] {
  const out: Box[][] = [];
  for (const b of [...boxes].sort((p, q) => p.y - q.y || p.x - q.x)) {
    const row = out.find((r) => Math.abs(r[0]!.y - b.y) < 2);
    if (row) row.push(b);
    else out.push([b]);
  }
  return out;
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < PHONE_MAX;

/** Every card of every place, with its panel open. */
async function eachCard(
  page: Page,
  check: (eventId: string, n: number) => Promise<void>
): Promise<void> {
  for (const n of PLACES) {
    await gotoArea(page, `#amap-dot-${n}`);
    await expect.poll(() => openPanels(page)).toEqual([n]);
    for (const id of EVENTS_AT[n]) await check(id, n);
  }
}

test.describe('Place panel layout on this device profile (OSE-1891)', () => {
  test('the profile is the one its project names', async ({ page }, testInfo) => {
    const want: Record<string, number> = {
      'map-phone': 375,
      'map-tablet': 768,
      'map-desktop': 1280,
      'map-tv': 1920,
    };
    expect(Object.keys(want), 'this file runs only on the map-* projects').toContain(
      testInfo.project.name
    );
    await gotoArea(page);
    expect(await page.evaluate(() => window.innerWidth)).toBe(want[testInfo.project.name]);
  });

  test('every button is at least 48 px tall and 12 px from the next', async ({ page }) => {
    let measured = 0;
    await eachCard(page, async (id) => {
      const { boxes } = await buttons(page, id);
      expect(boxes.length, `${id}: Open event, Register and Share at least`).toBeGreaterThanOrEqual(
        3
      );
      for (const b of boxes) {
        expect(b.h, `${id} "${b.label}" height`).toBeGreaterThanOrEqual(TAP_MIN - EPS);
        expect(b.w, `${id} "${b.label}" width`).toBeGreaterThanOrEqual(TAP_MIN - EPS);
      }
      const grid = rows(boxes);
      for (const row of grid) {
        for (let i = 1; i < row.length; i++) {
          const gap = row[i]!.x - (row[i - 1]!.x + row[i - 1]!.w);
          expect(
            gap,
            `${id}: gap between "${row[i - 1]!.label}" and "${row[i]!.label}"`
          ).toBeGreaterThanOrEqual(TAP_GAP - EPS);
        }
      }
      for (let r = 1; r < grid.length; r++) {
        const above = Math.max(...grid[r - 1]!.map((b) => b.y + b.h));
        const gap = grid[r]![0]!.y - above;
        expect(gap, `${id}: gap between rows ${r} and ${r + 1}`).toBeGreaterThanOrEqual(
          TAP_GAP - EPS
        );
      }
      measured += boxes.length;
    });
    // 5 + 4 + 3 x 8: a run that measured fewer buttons did not see every card.
    expect(measured).toBe(33);
  });

  test('no sideways scroll, with the list and with each panel open', async ({ page }) => {
    for (const hash of ['', '#amap-dot-1', '#amap-dot-2', '#amap-dot-3']) {
      await gotoArea(page, hash);
      const m = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        inner: window.innerWidth,
      }));
      expect(m.scroll, `scrollWidth with ${hash || 'the list'}`).toBe(m.client);
      expect(
        m.scroll,
        `scrollWidth against innerWidth with ${hash || 'the list'}`
      ).toBeLessThanOrEqual(m.inner);
      // And nothing of the zoomed part pokes out to the right.
      const right = await page
        .getByTestId('amap-wrap')
        .evaluate((el) => el.getBoundingClientRect().right);
      expect(right).toBeLessThanOrEqual(m.inner + EPS);
    }
  });

  test('the grid fits the screen: two columns on a phone, as many as fit from 600 px', async ({
    page,
  }) => {
    const phone = isPhone(page);
    await eachCard(page, async (id) => {
      const { boxes, width } = await buttons(page, id);
      const grid = rows(boxes);
      expect(boxes[0]!.label, `${id}: Open event comes first`).toBe('Open event');
      expect(boxes[boxes.length - 1]!.label, `${id}: Share comes last`).toBe('Share this event');
      if (phone) {
        // Open event across the top; the rest two to a row; a lone last one spans.
        const full = (b: Box) => Math.abs(b.w - width) <= 1;
        const half = (b: Box) => Math.abs(b.w - (width - TAP_GAP) / 2) <= 1;
        expect(grid[0]!.length, `${id}: Open event has its own row`).toBe(1);
        expect(full(grid[0]![0]!), `${id}: Open event is as wide as the grid (${width})`).toBe(
          true
        );
        const rest = boxes.slice(1);
        const pairs = Math.floor(rest.length / 2);
        for (let r = 1; r <= pairs; r++) {
          expect(grid[r]!.length, `${id}: row ${r + 1} holds two buttons`).toBe(2);
          for (const b of grid[r]!) {
            expect(half(b), `${id} "${b.label}" is half the grid`).toBe(true);
          }
        }
        if (rest.length % 2 === 1) {
          const last = grid[grid.length - 1]!;
          expect(last.length, `${id}: the last button is alone on its row`).toBe(1);
          expect(full(last[0]!), `${id}: a lone last button spans the row`).toBe(true);
        }
      } else {
        // auto-fit, 140 px at least: as many equal columns as fit, one row if all fit.
        const fit = Math.max(1, Math.floor((width + TAP_GAP) / (AUTO_FIT_MIN + TAP_GAP)));
        const cols = Math.min(boxes.length, fit);
        expect(grid[0]!.length, `${id}: ${cols} of ${boxes.length} buttons on the first row`).toBe(
          cols
        );
        expect(grid.length, `${id}: rows`).toBe(Math.ceil(boxes.length / cols));
        const widths = boxes.map((b) => b.w);
        expect(
          Math.max(...widths) - Math.min(...widths),
          `${id}: equal widths`
        ).toBeLessThanOrEqual(1);
        expect(Math.min(...widths), `${id}: no button under 140 px`).toBeGreaterThanOrEqual(
          AUTO_FIT_MIN - EPS
        );
        const first = grid[0]!;
        const end = first[first.length - 1]!;
        expect(end.x + end.w - first[0]!.x, `${id}: the first row fills the grid`).toBeGreaterThan(
          width - 2
        );
      }
    });
  });

  test('a tap in the gap between two buttons does nothing', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: number };
      w.__shared = 0;
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        writable: true,
        value: () => {
          w.__shared += 1;
          return Promise.resolve();
        },
      });
    });
    await gotoArea(page, '#amap-dot-2');
    await expect.poll(() => openPanels(page)).toEqual([2]);
    // map-zoom-b: Register and "Get tickets" sit side by side on every profile.
    const { boxes } = await buttons(page, 'map-zoom-b');
    const left = boxes.find((b) => b.label === 'Register')!;
    const right = boxes.find((b) => b.label.startsWith('Get tickets'))!;
    expect(Math.abs(left.y - right.y), 'Register and Get tickets share a row').toBeLessThan(2);
    const gapX = (left.x + left.w + right.x) / 2;
    const gapY = left.y + left.h / 2;
    expect(right.x - (left.x + left.w), 'there is a gap to tap in').toBeGreaterThanOrEqual(
      TAP_GAP - EPS
    );
    const url = page.url();
    const popups: string[] = [];
    page.context().on('page', (p) => popups.push(p.url()));

    await page.mouse.click(gapX, gapY);
    await page.waitForTimeout(300);

    expect(page.url(), 'the tap did not navigate').toBe(url);
    expect(popups, 'the tap opened nothing').toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __shared: number }).__shared)).toBe(0);
    expect(await openPanels(page)).toEqual([2]);
  });

  test('the Prev / Next chips are at least 44 px tall, and no text list of places sits above the cards', async ({
    page,
  }) => {
    await gotoArea(page);
    await expect(page.getByTestId('amap-place-link')).toHaveCount(0);
    await expect(page.getByTestId('amap-legend')).toHaveCount(0);
    const back = await page
      .getByTestId('amap-back')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(back, 'Back to all areas').toBeGreaterThanOrEqual(TARGET_MIN - EPS);

    await gotoArea(page, '#amap-dot-2');
    await expect.poll(() => openPanels(page)).toEqual([2]);
    const chips = await panel(page, 2)
      .locator('[data-testid="amap-prev"], [data-testid="amap-next"], [data-testid="amap-all"]')
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.getAttribute('data-testid'), x: r.left, w: r.width, h: r.height };
        })
      );
    expect(chips.map((c) => c.id)).toEqual(['amap-prev', 'amap-next', 'amap-all']);
    for (const c of chips) expect(c.h, `${c.id} height`).toBeGreaterThanOrEqual(TARGET_MIN - EPS);
    const [prev, next] = chips;
    expect(next!.x - (prev!.x + prev!.w), 'gap between Prev and Next').toBeGreaterThanOrEqual(
      TAP_GAP - EPS
    );
  });
});
