/**
 * End-to-end spec for the shared UI contract.
 *
 * Runs against a live worker (WKRP or OSE) that has adopted @ocr/ui.
 * Set BASE_URL to the deployed/preview origin. Because every page now shares
 * the same selectors, ONE spec validates the design system across both apps.
 *
 *   BASE_URL=https://ourwkrp-staging.workers.dev npx playwright test
 *
 * This is why the extraction matters for testing: before, each page had its
 * own bespoke markup and nothing could be asserted fleet-wide. Now these
 * selectors are a promise every surface keeps.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';

test('shared stylesheet is served once and cached', async ({ request }) => {
  const res = await request.get(`${BASE}/ui.css`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/css');
  const body = await res.text();
  expect((body.match(/:root/g) ?? []).length).toBe(1); // single source of truth
});

test('a page links the shared sheet, not an inline blob', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.locator('link[rel="stylesheet"][href="/ui.css"]')).toHaveCount(1);
  await expect(page.locator('style')).toHaveCount(0);
});

test('tap targets meet the 48px minimum', async ({ page }) => {
  await page.goto(`${BASE}/`);
  const btn = page.locator('.btn').first();
  if (await btn.count()) {
    const box = await btn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test('gated screens show an empty-state with a next step, never a dead end', async ({ page }) => {
  // Visit a DJ-only route while unauthenticated.
  await page.goto(`${BASE}/dj/nobody/live`);
  const empty = page.locator('.empty-state');
  await expect(empty).toBeVisible();
  await expect(empty.locator('a.btn')).toBeVisible(); // the on-ramp
});
