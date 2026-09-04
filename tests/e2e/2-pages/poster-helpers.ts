/**
 * Shared helpers for the poster-page specs (OSE-1228 split).
 *
 * Not a *.spec.ts, so no config's testMatch picks it up as a test file — it is
 * imported by both poster-print.spec.ts (data-less layout, runs in the COMPONENT
 * tier) and poster-print.data.spec.ts (data-dependent, runs only where real
 * seeded data exists: the staging E2E tier).
 */
import { Page } from '@playwright/test';

export async function navigateToPoster(page: Page) {
  await page.goto('/poster', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

export async function hasEvents(page: Page): Promise<boolean> {
  const picker = page.locator('[data-testid="poster-event-picker"]');
  const text = await picker.textContent();
  return !text?.includes('No events') && !text?.includes('Loading');
}

export async function selectEvent(page: Page, index: number) {
  const picker = page.locator('[data-testid="poster-event-picker"]');
  await picker.selectOption({ index });
  // Wait for poster to re-render
  await page.waitForTimeout(500);
}
