/**
 * E2E Flow: Public Events — render pipeline after OSE-1243
 *
 * ─── WHY THIS FILE CHANGED SHAPE ──────────────────────────────────────────────
 *
 * The pipeline this file was written to validate was:
 *
 *     page loads → loading state → API fetch → cards render
 *
 * There is no such pipeline any more. OSE-1243 server-rendered the list, so
 * the sequence is: page loads, cards are already there. The first test in this
 * file was literally named "loading → fetch → cards appear" and asserted the
 * loading state was visible before the fetch resolved — it was testing the
 * round trip that the change deleted.
 *
 * The content assertions (order, date + venue in meta, a card with only a name)
 * were driven by intercepting `**\/api/v2/events`, which no longer feeds the
 * page. They moved to `tests/unit/public-events-phase.test.ts`, where they run
 * against `renderEventList()` — with more cases and without a browser.
 *
 * What stays here is what a browser is actually needed for: that every alias
 * renders the same surface, and that it survives real viewports.
 */

import { test, expect } from '@playwright/test';

const ALIASES = ['/events', '/public', '/schedule', '/calendar', '/agenda', '/lineup'];

test.describe('Public Events Flow — Alias Equivalence', () => {
  test('all aliases render the same surface', async ({ page }) => {
    const shapes: string[] = [];
    for (const path of ALIASES) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should be 200`).toBe(200);
      // Compare structure, not content: two aliases loaded a moment apart can
      // legitimately differ in data, and asserting equal HTML would make this
      // test fail for the wrong reason.
      shapes.push(
        (
          await page.evaluate(() =>
            [...document.querySelectorAll('[data-testid]')]
              .map((n) => n.getAttribute('data-testid'))
              .sort()
              .join(',')
          )
        ).toString()
      );
    }
    expect(new Set(shapes).size, `aliases diverged: ${ALIASES.join(', ')}`).toBe(1);
  });

  test('every alias serves the list server-side, not as a redirect to one that does', async ({
    page,
  }) => {
    for (const path of ALIASES) {
      await page.goto(path);
      const container = page.locator('[data-testid="public-events"]');
      await expect(container, `${path} should render the events container`).toBeVisible();
      expect(await page.content()).not.toContain('Loading events');
    }
  });
});

test.describe('Public Events Flow — Responsive', () => {
  test('no horizontal overflow on a 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/events', { waitUntil: 'networkidle' });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflows).toBe(false);
  });

  test('the events heading is readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/events', { waitUntil: 'networkidle' });
    const heading = page.locator('[data-testid="public-events-heading"]');
    await expect(heading).toBeVisible();
    const size = await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});
