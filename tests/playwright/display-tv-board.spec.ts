/**
 * OSE-1521 — the TV board, measured in a real browser at the sizes a venue TV is.
 *
 * The display was graded D at 1920x1080 on 2026-10-03: a 48px title, 12-13px
 * labels, a privacy line larger than the date, a clock, a scrolling ticker, no
 * QR on the featured screen. Each rule it broke is a measured assertion here:
 *
 *   - the headline is 120px at 1080p and scales with the screen at 4K
 *   - no text on any screen is under 22px (at 1080p; it scales up from there)
 *   - the privacy line is smaller than the event's date and venue
 *   - the featured screen carries a large QR with its short link
 *   - the sponsor sits by the title: below the title and date, above the QR
 *   - content is centred, inside a safe area, and nothing scrolls
 *   - no clock, no ticker, nothing numeric about sponsors or a fundraiser
 *   - the donate screen and a screen per sponsor are laid out the same way
 *   - light and dark both come from tokens (axe contrast, both schemes)
 *
 * Runs against the local worker (playwright.mobile.config.ts), which seeds its
 * own events and sponsor through the admin API. A missing admin key is a
 * failure here, not a skip: a gate that quietly measures nothing is worse than
 * no gate.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createLiveEvent, seedSponsorCard } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const HD = { width: 1920, height: 1080 };
const UHD = { width: 3840, height: 2160 };
const DONATE = 'https://donate.example/bocce-fund';

const admin = () => ({
  Authorization: `Bearer ${ADMIN_BEARER}`,
  'Content-Type': 'application/json',
});

let sponsored: { eventId: string; eventTitle: string; sponsorName: string };
let plain: { id: string; title: string };
let long: { id: string; title: string };

async function save(
  request: import('@playwright/test').APIRequestContext,
  id: string,
  settings: Record<string, unknown>
): Promise<void> {
  const res = await request.put(`/api/v2/admin/events/${encodeURIComponent(id)}`, {
    headers: admin(),
    data: { settings },
  });
  expect(res.ok(), `save settings: ${res.status()} ${await res.text()}`).toBe(true);
}

test.beforeAll(async ({ request }) => {
  expect(
    ADMIN_BEARER,
    'needs the local audit worker (playwright.mobile.config.ts sets the key)'
  ).not.toBe('');
  const s = await seedSponsorCard(request, ADMIN_BEARER, 'TV');
  sponsored = { eventId: s.eventId, eventTitle: s.eventTitle, sponsorName: s.sponsorName };
  await save(request, s.eventId, { donateLink: DONATE });
  const stamp = Date.now().toString(36);
  plain = { id: '', title: `Bocce ${stamp}` };
  plain.id = (await createLiveEvent(request, ADMIN_BEARER, plain.title)).id;
  long = {
    id: '',
    title: `The Harbor County Annual Community Bocce Tournament and Fundraiser Night ${stamp}`,
  };
  long.id = (await createLiveEvent(request, ADMIN_BEARER, long.title)).id;
});

async function open(page: Page, size: { width: number; height: number }, path: string) {
  await page.setViewportSize(size);
  await page.goto(path);
  await expect(page.getByTestId('display-panes')).toBeAttached();
  // The board is drawn three times as its data arrives (events, the saved
  // config, the sponsors). Wait for the last request, so a measurement is never
  // taken from an element the next redraw is about to replace.
  await page.waitForLoadState('networkidle');
}

/** Every visible text node's font size, with the element it belongs to. */
async function textSizes(page: Page): Promise<Array<{ px: number; where: string; text: string }>> {
  return page.evaluate(() => {
    const out: Array<{ px: number; where: string; text: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || '').trim();
      const el = n.parentElement;
      if (!text || !el) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      // Not drawn: hidden panes, the visually hidden header, the skip link.
      if (el.closest('[hidden], .vh, .skip-link')) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      out.push({
        px: parseFloat(getComputedStyle(el).fontSize),
        where: el.getAttribute('data-testid') || el.tagName.toLowerCase(),
        text: text.slice(0, 30),
      });
    }
    return out;
  });
}

// Read in one page task, so a redraw cannot land between finding and measuring.
const fontPx = (page: Page, testid: string) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el ? parseFloat(getComputedStyle(el).fontSize) : NaN;
  }, testid);
const boxOf = (page: Page, testid: string) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, testid);

test.describe('TV board at 1920x1080', () => {
  test('the headline is 120px and the date and venue are larger than the privacy line', async ({
    page,
  }) => {
    await open(page, HD, `/display?event=${plain.id}&panes=event`);
    await expect(page.getByTestId('display-featured-title')).toHaveText(plain.title);
    // The saved config arrives after the events and redraws the screen; measure
    // once it has, or the element read can be the one that was just replaced.
    await expect(page.getByTestId('display-featured-qr')).toBeVisible();
    expect(await fontPx(page, 'display-featured-title')).toBeGreaterThanOrEqual(120);
    const meta = await fontPx(page, 'display-featured-meta');
    const consent = await fontPx(page, 'display-consent');
    expect(meta, 'date and venue lead').toBeGreaterThan(consent);
    expect(consent, 'the privacy line is still readable from the couch').toBeGreaterThanOrEqual(22);
  });

  test('no text on the screen is under 22px, on every screen of the rotation', async ({
    page,
    request,
  }) => {
    await save(request, sponsored.eventId, {
      displayPanes: ['event', 'upcoming', 'sponsors', 'donate', 'sponsor'],
    });
    await open(page, HD, `/display?event=${sponsored.eventId}`);
    await expect(page.getByTestId('display-featured-qr')).toBeVisible();
    // Step through every screen with the remote's arrow key, so each is measured drawn.
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const shown = await page.evaluate(
        () => document.querySelector<HTMLElement>('[data-pane]:not([hidden])')?.dataset.pane || ''
      );
      seen.add(shown);
      const small = (await textSizes(page)).filter((t) => t.px < 22);
      expect(small, `under 22px on "${shown}": ${JSON.stringify(small)}`).toEqual([]);
      await page.keyboard.press('ArrowRight');
    }
    // event, upcoming?, sponsors, donate, sponsor-0: at least event, sponsors, donate, sponsor.
    for (const pane of ['event', 'sponsors', 'donate', 'sponsor-0']) {
      expect([...seen], `the ${pane} screen was measured`).toContain(pane);
    }
  });

  test('the featured screen has a large QR and its short link', async ({ page }) => {
    await open(page, HD, `/display?event=${plain.id}&panes=event`);
    const qr = page.getByTestId('display-featured-qr');
    await expect(qr).toBeVisible();
    const box = (await boxOf(page, 'display-featured-qr'))!;
    expect(box.width, 'a QR a room can scan').toBeGreaterThanOrEqual(240);
    expect(box.height).toBeGreaterThanOrEqual(240);
    const link = page.getByTestId('display-featured-link');
    await expect(link).toContainText(`/events/${plain.id}`);
    expect(await fontPx(page, 'display-featured-link')).toBeGreaterThanOrEqual(30);
  });

  test('the sponsor sits by the title: below the title and date, above the QR', async ({
    page,
  }) => {
    await open(page, HD, `/display?event=${sponsored.eventId}&panes=event`);
    const name = page.getByTestId('display-sponsor-name').first();
    await expect(name).toHaveText(sponsored.sponsorName);
    const title = (await boxOf(page, 'display-featured-title'))!;
    const meta = (await boxOf(page, 'display-featured-meta'))!;
    const strip = (await boxOf(page, 'display-sponsor-banner'))!;
    const qr = (await boxOf(page, 'display-featured-qr'))!;
    expect(strip.y, 'below the title').toBeGreaterThanOrEqual(title.y + title.height - 1);
    expect(strip.y, 'below the date and venue').toBeGreaterThanOrEqual(meta.y + meta.height - 1);
    expect(strip.y + strip.height, 'above the QR').toBeLessThanOrEqual(qr.y + 1);
  });

  test('content is centred, inside the safe area, and nothing scrolls', async ({ page }) => {
    await open(page, HD, `/display?event=${plain.id}&panes=event`);
    await expect(page.getByTestId('display-featured-qr')).toBeVisible();
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const rects = [...document.querySelectorAll('[data-pane]:not([hidden]) *')].map((e) =>
        e.getBoundingClientRect()
      );
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return {
        vw,
        vh,
        left,
        right,
        top,
        bottom,
        scrollW: document.documentElement.scrollWidth,
        scrollH: document.documentElement.scrollHeight,
      };
    });
    expect(m.scrollW, 'no sideways scroll').toBeLessThanOrEqual(m.vw);
    expect(m.scrollH, 'no vertical scroll').toBeLessThanOrEqual(m.vh);
    // Safe area: 5% each side, the margin TV overscan can eat.
    expect(m.left).toBeGreaterThanOrEqual(m.vw * 0.04);
    expect(m.vw - m.right).toBeGreaterThanOrEqual(m.vw * 0.04);
    expect(m.top).toBeGreaterThanOrEqual(m.vh * 0.04);
    // Centred: the left and right margins agree to within 2% of the width.
    expect(Math.abs(m.left - (m.vw - m.right))).toBeLessThanOrEqual(m.vw * 0.02);
  });

  test('the content stays centred on the screen when a side sponsor is showing', async ({
    page,
  }) => {
    await open(page, HD, `/display?event=${sponsored.eventId}&panes=event`);
    await expect(page.getByTestId('display-featured-qr')).toBeVisible();
    await expect(page.getByTestId('display-sponsor-rotate')).toBeVisible();
    const qr = (await boxOf(page, 'display-featured-qr'))!;
    const centre = qr.x + qr.width / 2;
    expect(
      Math.abs(centre - HD.width / 2),
      'the QR is on the screen centre line'
    ).toBeLessThanOrEqual(HD.width * 0.02);
  });

  test('a very long title steps down and still fits the screen', async ({ page }) => {
    await open(page, HD, `/display?event=${long.id}&panes=event`);
    await expect(page.getByTestId('display-featured-qr')).toBeVisible();
    const size = await fontPx(page, 'display-featured-title');
    expect(size, 'smaller than the full headline').toBeLessThan(120);
    expect(size, 'but still a headline').toBeGreaterThanOrEqual(60);
    const m = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      vh: document.documentElement.clientHeight,
      scrollW: document.documentElement.scrollWidth,
      vw: document.documentElement.clientWidth,
    }));
    expect(m.scrollH).toBeLessThanOrEqual(m.vh);
    expect(m.scrollW).toBeLessThanOrEqual(m.vw);
  });

  test('no clock, no ticker, nothing moving, and no number about sponsors', async ({ page }) => {
    await open(page, HD, `/display?event=${sponsored.eventId}`);
    await expect(page.getByTestId('display-featured-qr')).toBeVisible();
    await expect(page.getByTestId('display-clock')).toHaveCount(0);
    await expect(page.getByTestId('display-ticker')).toHaveCount(0);
    await expect(page.getByTestId('display-sponsor-counter')).toHaveCount(0);
    const moving = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations === Infinity)
        .map((a) => a.id || 'animation')
    );
    expect(moving, 'nothing loops').toEqual([]);
    expect(await page.locator('h1').count()).toBe(1);
  });
});

test.describe('the donate screen and a screen per sponsor', () => {
  test('donate: a large QR, the short link, no amount, no goal, no progress', async ({ page }) => {
    await open(page, HD, `/display?event=${sponsored.eventId}&panes=donate`);
    const qr = page.getByTestId('display-donate-qr');
    await expect(qr).toBeVisible();
    expect((await boxOf(page, 'display-donate-qr'))!.width).toBeGreaterThanOrEqual(240);
    await expect(page.getByTestId('display-donate-link')).toHaveText('donate.example/bocce-fund');
    const text = (await page.getByTestId('display-pane-donate').innerText()) || '';
    expect(text).not.toMatch(/raised|goal|progress|\$\s*\d|\d+\s*%/i);
    expect(await fontPx(page, 'display-donate-heading')).toBeGreaterThanOrEqual(120);
  });

  test('a sponsor gets a whole screen, by its title, with a large logo', async ({ page }) => {
    await open(page, HD, `/display?event=${sponsored.eventId}&panes=sponsor`);
    const title = page.getByTestId('display-sponsor-screen-title').first();
    await expect(title).toHaveText(sponsored.sponsorName);
    const logo = (await boxOf(page, 'display-sponsor-screen-logo'))!;
    expect(logo.height, 'a logo a room can read').toBeGreaterThanOrEqual(200);
    expect(await fontPx(page, 'display-sponsor-screen-title')).toBeGreaterThanOrEqual(60);
  });
});

test.describe('a 4K TV', () => {
  test('everything scales with the screen: headline, QR and body text double', async ({ page }) => {
    await open(page, UHD, `/display?event=${plain.id}&panes=event`);
    await expect(page.getByTestId('display-featured-qr')).toBeVisible();
    expect(await fontPx(page, 'display-featured-title')).toBeGreaterThanOrEqual(238);
    expect(await fontPx(page, 'display-consent')).toBeGreaterThanOrEqual(43);
    const qr = (await boxOf(page, 'display-featured-qr'))!;
    expect(qr.width).toBeGreaterThanOrEqual(480);
    const m = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      vh: document.documentElement.clientHeight,
    }));
    expect(m.scrollH).toBeLessThanOrEqual(m.vh);
  });
});

// OSE-1678: each "Also coming up" card leads with a picture (the event's poster
// art, else the Ring), one size for every card, at 720p and at 4K.
for (const [label, size] of [
  ['720p', { width: 1280, height: 720 }],
  ['4K', UHD],
] as const) {
  test(`"Also coming up" at ${label}: every card has its picture, all one size, inside the card`, async ({
    page,
  }) => {
    await open(page, size, `/display?event=${plain.id}&panes=upcoming`);
    const thumbs = page.getByTestId('display-upcoming-thumb');
    await expect(thumbs.first()).toBeVisible();
    const m = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('[data-testid="display-upcoming-card"]')].map(
        (card) => {
          const img = card.querySelector<HTMLImageElement>(
            '[data-testid="display-upcoming-thumb"]'
          );
          const c = card.getBoundingClientRect();
          const b = img ? img.getBoundingClientRect() : null;
          return {
            has: !!img,
            loaded: !!img && img.complete && img.naturalWidth > 0,
            w: b ? Math.round(b.width) : 0,
            h: b ? Math.round(b.height) : 0,
            inside:
              !!b &&
              b.left >= c.left &&
              b.right <= c.right &&
              b.top >= c.top &&
              b.bottom <= c.bottom,
          };
        }
      )
    );
    expect(m.length, 'the screen lists upcoming events').toBeGreaterThan(0);
    for (const card of m) {
      expect(card.has && card.loaded, 'each card shows a loaded picture').toBe(true);
      expect(card.inside, 'the picture sits inside its card').toBe(true);
      expect(card.w, 'square').toBe(card.h);
    }
    expect(new Set(m.map((c) => c.w)).size, 'one size for every card').toBe(1);
    // Two text lines tall: 7vh, never under 56px.
    expect(m[0].w).toBeGreaterThanOrEqual(Math.max(56, Math.floor(size.height * 0.07)) - 1);
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe WCAG 2.1 AA at 1080p, ${colorScheme}: nothing serious on any screen`, async ({
    page,
    request,
  }) => {
    await save(request, sponsored.eventId, {
      displayPanes: ['event', 'sponsors', 'donate', 'sponsor'],
    });
    await page.emulateMedia({ colorScheme });
    await open(page, HD, `/display?event=${sponsored.eventId}`);
    await expect(page.getByTestId('display-featured-qr')).toBeVisible();
    const found: string[] = [];
    for (let i = 0; i < 5; i++) {
      const shown = await page.evaluate(
        () => document.querySelector<HTMLElement>('[data-pane]:not([hidden])')?.dataset.pane || ''
      );
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      for (const v of results.violations) {
        if (v.impact === 'serious' || v.impact === 'critical') {
          found.push(
            `${shown}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`
          );
        }
      }
      await page.keyboard.press('ArrowRight');
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}
