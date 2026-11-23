import type { Page } from '@playwright/test';

/**
 * Every list of cards shows five at a time, with "Click for more" under it
 * (workers/oursharedevents/src/lib/card-pager.ts; owner, 2026-11-21 for the
 * landing and 2026-11-22 for every list). A check that looks for one particular
 * card taps every such button on the page until every card the filters leave is
 * showing. A filter change starts again at five, so call this again after one.
 */
export async function showAllCards(page: Page): Promise<void> {
  const more = page.locator('.card-more:not([hidden]) button');
  // Each tap shows five more; a list is never longer than this many taps.
  for (let i = 0; i < 200 && (await more.count()) > 0; i++) await more.first().click();
}
