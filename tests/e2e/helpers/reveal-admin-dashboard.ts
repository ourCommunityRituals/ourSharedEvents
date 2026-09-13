import type { Page } from '@playwright/test';

/**
 * The admin surface now opens on the front-door chooser ("What are you
 * making?") with the full dashboard hidden behind it (see
 * fix/ose-admin-frontdoor-exclusive). Dashboard-facing E2E specs must reveal it
 * first by taking the "Show me everything — the full dashboard" path. Guarded on
 * visibility so it's a no-op if the chooser isn't shown (e.g. an unauthenticated
 * challenge page or a deep link that already reveals the dashboard).
 */
export async function revealAdminDashboard(page: Page): Promise<void> {
  const advanced = page.locator('[data-testid="admin-path-advanced"]');
  if (await advanced.isVisible().catch(() => false)) {
    await advanced.click();
    await page
      .locator('[data-testid="admin-path-chooser"]')
      .waitFor({ state: 'hidden' })
      .catch(() => {});
  }
}
