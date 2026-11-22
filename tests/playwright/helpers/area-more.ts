import type { Page } from '@playwright/test';

/**
 * The landing shows its event cards five at a time, with "Click for more"
 * under them (workers/oursharedevents/src/lib/area-pager.ts; owner, 2026-11-21).
 * A check that looks for one particular card taps the button until every card
 * the filters leave is showing. A filter change starts again at five, so call
 * this again after one.
 */
export async function showAllCards(page: Page): Promise<void> {
  const more = page.getByTestId('area-more');
  // Each tap shows five more; a list is never longer than this many taps.
  for (let i = 0; i < 200 && (await more.isVisible()); i++) await more.click();
}
