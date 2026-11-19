/**
 * The "primary action above the fold" gate, as one function (OSE-2160, F-45).
 *
 * It used to sit inside the test body of mobile-workability.spec.ts, so nothing
 * else could call it. Its selectors for the landing matched nothing on staging
 * and fell through to the first link in the header (the brand link), which is
 * always above the fold: the gate measured the logo and could not fail.
 *
 * Now the surface names the real action (the landing's `where-submit`, the map's
 * `area-map`) and there is no fallback to a header link. A surface's list is a
 * priority list: the first entry that matches AND is rendered wins; an entry
 * that matches only hidden elements falls through to the next, which is what a
 * list of alternatives is for (OSE-1236).
 *
 * Two failure messages, on purpose, so a meta-test can tell them apart:
 *   FOLD_NO_MATCH  the selector matched nothing: the gate is pointed at air
 *   FOLD_BELOW     the action exists and sits at or below the fold
 * fold-gate-meta.spec.ts plants a 600 px spacer and expects FOLD_BELOW, not
 * FOLD_NO_MATCH, so the gate cannot go red for the wrong reason.
 */
import type { Page } from '@playwright/test';

export const FOLD_NO_MATCH = 'matched 0 elements';
export const FOLD_BELOW = 'is below the fold';

export interface FoldResult {
  /** Which entry of the list was measured. */
  selector: string;
  /** Top of the action, in CSS px from the top of the viewport. */
  top: number;
}

/**
 * Measure the first rendered action in `selectorList` (comma separated, in
 * priority order) and throw if there is none or it is not above `height`.
 * Returns what was measured, so a caller can say it.
 */
export async function assertActionAboveFold(
  page: Page,
  name: string,
  selectorList: string,
  height: number
): Promise<FoldResult> {
  const candidates = selectorList
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  let chosen: { selector: string; box: { y: number } | null } | null = null;
  for (const selector of candidates) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) === 0) continue;
    const box = await loc.boundingBox().catch(() => null);
    // Remember the first entry that matches anything, so an action that exists
    // but is hidden still says so rather than "matched 0 elements".
    if (!chosen) chosen = { selector, box };
    if (box) {
      chosen = { selector, box };
      break;
    }
  }
  if (!chosen) {
    throw new Error(
      `${name}: primary action selector '${selectorList}' ${FOLD_NO_MATCH}. Either the selector needs updating for this surface, or the surface is genuinely missing its primary action.`
    );
  }
  if (!chosen.box) {
    throw new Error(`${name}: primary action '${chosen.selector}' has no bounding box (hidden)`);
  }
  if (!(chosen.box.y < height)) {
    throw new Error(
      `${name}: primary action '${chosen.selector}' top = ${Math.round(chosen.box.y)}px ${FOLD_BELOW} (viewport height ${height}px): needs a scroll-then-tap`
    );
  }
  return { selector: chosen.selector, top: chosen.box.y };
}
