import type { Page } from '@playwright/test';

/**
 * On a phone the landing's window, type and Where rows fold behind one Filters
 * chip (workers/oursharedevents/src/lib/area-filters-style.ts, the attendee-map
 * grade of 2026-11-17). Open them once after the page loads; on a wider screen
 * the rows always show and the chip is hidden, so this does nothing. A second
 * call would close them again.
 */
export async function openAreaFilters(page: Page): Promise<void> {
  const chip = page.getByTestId('area-filters-btn');
  if (await chip.isVisible()) await chip.click();
}

/**
 * The groups are tabs now (lib/area-tabs-script.ts, OSE-2156): When shows first,
 * and Type and Near me sit behind their tab. Open filters, then a tab by name
 * ('when', 'type' or 'near').
 */
export async function openAreaTab(page: Page, name: 'when' | 'type' | 'near'): Promise<void> {
  await openAreaFilters(page);
  await page.getByTestId(`tab-${name}`).click();
}
