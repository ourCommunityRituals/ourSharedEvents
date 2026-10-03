/**
 * OSE-1514 — the accessibility checks a low-vision, motion-sensitive or
 * dark-mode visitor hits first, kept as a blocking part of the phone audit.
 *
 * These were a one-off profile run on 2026-10-02 (never committed). Each check
 * here was red before its fix:
 *   1. No sideways scroll at 320px with normal text (WCAG 1.4.10 Reflow).
 *   2. axe WCAG 2.1 AA: no serious or critical finding, in light and in dark.
 *   3. Nothing keeps moving on the TV when the system asks for reduced motion.
 *   4. At 200% text the header and its navigation still fit a 320px screen
 *      (WCAG 1.4.4 with 1.4.10). Body content at 200% text is a separate,
 *      harsher bar than either criterion alone and is tracked on its own.
 *
 * The dark-mode contrast of the landing map's legend links needs ten mapped
 * events to draw, so that check lives beside the map seed in
 * landing-theme.spec.ts.
 *
 * Runs against the local worker (playwright.mobile.config.ts). The sponsor
 * surfaces come from the audit's global setup.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const SPONSOR_HOME_TOKEN = process.env.OSE_SPONSOR_HOME_TOKEN || '';
const SPONSOR_CARD_ID = process.env.OSE_SPONSOR_CARD_ID || '';

test.skip(
  !ADMIN_BEARER || !SPONSOR_HOME_TOKEN || !SPONSOR_CARD_ID,
  'needs the local audit worker (playwright.mobile.config.ts seeds the bearer and sponsor)'
);

let eventId = '';

test.beforeAll(async ({ request }) => {
  const ev = await createLiveEvent(request, ADMIN_BEARER, `A11y profile ${Date.now()}`);
  eventId = ev.id;
});

interface Surface {
  name: string;
  path: () => string;
  admin?: boolean;
}

const SURFACES: Surface[] = [
  { name: 'landing', path: () => '/' },
  { name: 'events list', path: () => '/events' },
  { name: 'event page', path: () => `/events/${eventId}` },
  { name: 'poster', path: () => `/poster?event=${eventId}` },
  { name: 'register form', path: () => `/forms/${eventId}?type=register` },
  { name: 'sponsor home', path: () => `/sponsor?t=${SPONSOR_HOME_TOKEN}` },
  { name: 'sponsor card', path: () => `/sponsors/${SPONSOR_CARD_ID}` },
  { name: 'admin', path: () => '/admin', admin: true },
];

async function open(page: Page, surface: Surface): Promise<void> {
  if (surface.admin) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto(surface.path());
  await page.waitForLoadState('networkidle');
}

/** The widest thing on the page, for the failure message. */
async function overflow(
  page: Page
): Promise<{ scrollWidth: number; clientWidth: number; widest: string }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    let widest = '';
    let max = doc.clientWidth;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > max + 1) {
        max = r.right;
        widest = `${el.tagName.toLowerCase()}[data-testid="${el.dataset.testid ?? ''}"] right=${Math.round(r.right)}`;
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, widest };
  });
}

for (const surface of SURFACES) {
  test.describe(`a11y profile: ${surface.name}`, () => {
    test('320px, normal text: no sideways scroll', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await open(page, surface);
      const o = await overflow(page);
      expect(
        o.scrollWidth,
        `${surface.name}: ${o.scrollWidth}px wide on a ${o.clientWidth}px screen (${o.widest})`
      ).toBeLessThanOrEqual(o.clientWidth + 1);
    });

    test('320px, 200% text: the header and its navigation wrap', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await open(page, surface);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const offEdge = await page.evaluate(() => {
        const max = document.documentElement.clientWidth + 1;
        const out: string[] = [];
        for (const el of Array.from(
          document.querySelectorAll<HTMLElement>('header, header *, nav, nav *')
        )) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > max) {
            out.push(
              `${el.tagName.toLowerCase()}[${el.dataset.testid ?? ''}] right=${Math.round(r.right)}`
            );
          }
        }
        return out;
      });
      expect(
        offEdge,
        `${surface.name} at 200% text runs off the edge: ${offEdge.join(', ')}`
      ).toEqual([]);
    });

    for (const colorScheme of ['light', 'dark'] as const) {
      test(`axe WCAG 2.1 AA, ${colorScheme}: nothing serious`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.emulateMedia({ colorScheme });
        await open(page, surface);
        // Scan once every transition has settled, or axe measures a mid-fade colour.
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
              .map((a) => a.finished)
          )
        );
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const found = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map(
            (v) =>
              `${v.id} (${v.impact}):\n` +
              v.nodes
                .map((n) => `  ${n.target.join(' ')} :: ${n.any.map((a) => a.message).join(' | ')}`)
                .join('\n')
          );
        expect(found, `${surface.name}, ${colorScheme}:\n${found.join('\n')}`).toEqual([]);
      });
    }
  });
}

test('the TV holds still when the system asks for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/display?event=${eventId}`);
  await expect(page.getByTestId('display-ticker-text')).toBeAttached();
  await page.waitForTimeout(500);
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
        return target?.dataset.testid || target?.className || target?.tagName || 'unknown';
      })
  );
  expect(running, `still moving under reduced motion: ${running.join(', ')}`).toEqual([]);
});
