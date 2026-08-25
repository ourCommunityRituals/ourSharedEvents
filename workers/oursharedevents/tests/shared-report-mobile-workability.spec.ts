/**
 * OSE-295 — /sharedReport mobile workability (DRAIN 2/7 of OSE-292).
 *
 * Layer: API (vitest inspects the rendered shared-report HTML for the
 * mobile CSS contracts; the actual viewport-rendered behavior is
 * verified by the Playwright `mobile-workability.spec.ts` audit
 * running against staging at 375x812).
 *
 * The audit identified two violations on /sharedReport:
 *   1. `.report-table` (4-col events list) overflows 375px and forces
 *      horizontal scroll — no header / no cell labels, just a wide
 *      table with venue-cell content that can't shrink.
 *   2. `.funnel-table` (5-col advanced-metrics conversion funnel)
 *      same shape — 5 columns at 375px is unreadable.
 *
 * Fix mirrors OSE-294's admin pattern: data-label attributes on every
 * <td> + a @media (max-width: 768px) block that collapses thead and
 * stacks each row as a labeled card. Also tightens header / main
 * padding, ensures action-bar buttons hit the 44px touch-target
 * floor on mobile, and lets the venue-cell shrink.
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names follow
 *   `OSE-295 | API | GET <path> (<condition>) | <assertion>`.
 *
 * The handler is invoked directly (same shape as report-a11y.spec.ts
 * L1 Static block) so the test stays a pure HTML inspection and
 * doesn't need to seed the analytics.shared-report feature flag.
 */

import { describe, test, expect } from 'vitest';
import { handleSharedReportPage } from '../src/handlers/pages';

async function fetchSharedReportHtml(): Promise<string> {
  return handleSharedReportPage({} as never).then((r) => r.text());
}

describe('OSE-295 shared-report mobile workability — API layer', () => {
  test('OSE-295 | API | GET /sharedReport (any) | @media (max-width: 768px) block present', async () => {
    const html = await fetchSharedReportHtml();
    expect(html).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)\s*\{/);
  });

  test('OSE-295 | API | GET /sharedReport (mobile media query) | header stacks title + subtitle vertically', async () => {
    const html = await fetchSharedReportHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // The header is the dark nav bar containing the "OurSharedEvents"
    // title + "Shared Report" subtitle. Default layout is row-flex with
    // space-between. At 768px or below they MUST stack so the subtitle
    // doesn't crash into the title at 375px.
    expect(mediaBlock).toMatch(/header\s*\{[^}]*flex-direction:\s*column/);
    expect(mediaBlock).toMatch(/header\s*\{[^}]*align-items:\s*flex-start/);
  });

  test('OSE-295 | API | GET /sharedReport (mobile media query) | events report-table converts to card layout', async () => {
    const html = await fetchSharedReportHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    expect(mediaBlock).toMatch(/\.report-table\s+thead\s*\{[^}]*display:\s*none/);
    expect(mediaBlock).toMatch(/\.report-table\s+tr\s*\{[^}]*display:\s*block/);
    expect(mediaBlock).toMatch(/\.report-table\s+td\s*\{[^}]*display:\s*block/);
    // The td::before pseudo-element pulls from data-label so each row
    // remains identifiable without the thead.
    expect(mediaBlock).toMatch(
      /\.report-table\s+td::before\s*\{[^}]*content:\s*attr\(data-label\)/
    );
  });

  test('OSE-295 | API | GET /sharedReport (mobile media query) | advanced-metrics funnel-table converts to card layout', async () => {
    const html = await fetchSharedReportHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    expect(mediaBlock).toMatch(/\.funnel-table\s+thead\s*\{[^}]*display:\s*none/);
    expect(mediaBlock).toMatch(/\.funnel-table\s+tr\s*\{[^}]*display:\s*block/);
    expect(mediaBlock).toMatch(
      /\.funnel-table\s+td::before\s*\{[^}]*content:\s*attr\(data-label\)/
    );
    // The bar-cell column (sparkline) carries no data-label; ::before
    // is suppressed so we don't render an empty "Label: " prefix above
    // the visual bar.
    expect(mediaBlock).toMatch(/\.funnel-table\s+td\.bar-cell::before\s*\{[^}]*content:\s*''/);
  });

  test('OSE-295 | API | GET /sharedReport (any) | events report-table td cells carry data-label attributes', async () => {
    const html = await fetchSharedReportHtml();
    // Each rendered <td> in the events list must declare its label so
    // the mobile card layout can show `Name: Empty Bottle` instead of
    // just `Empty Bottle` (no longer paired with a header row).
    expect(html).toContain('data-label="Name"');
    expect(html).toContain('data-label="Date"');
    expect(html).toContain('data-label="Venue"');
    expect(html).toContain('data-label="Status"');
  });

  test('OSE-295 | API | GET /sharedReport (any) | funnel-table admin rows carry data-label attributes', async () => {
    const html = await fetchSharedReportHtml();
    expect(html).toContain('data-label="Event"');
    expect(html).toContain('data-label="Registrations"');
    expect(html).toContain('data-label="Check-ins"');
    expect(html).toContain('data-label="Attendance"');
  });

  test('OSE-295 | API | GET /sharedReport (any) | signed-link sponsor / poster / trend tables carry data-label attributes', async () => {
    const html = await fetchSharedReportHtml();
    // Signed-link (OSE-R-003) mode renders three funnel-table slices:
    // sponsor impressions, poster attribution, headcount trend.
    // Each row's <td> needs labels so the mobile card layout works
    // for bar owners opening the signed link on their phone.
    expect(html).toContain('data-label="Sponsor"');
    expect(html).toContain('data-label="Surface"');
    expect(html).toContain('data-label="Impressions"');
    expect(html).toContain('data-label="Location"');
    expect(html).toContain('data-label="Scans"');
    expect(html).toContain('data-label="First"');
    expect(html).toContain('data-label="Last"');
    expect(html).toContain('data-label="Unique gatherings"');
  });

  test('OSE-295 | API | GET /sharedReport (mobile media query) | main padding tightens for narrow viewports', async () => {
    const html = await fetchSharedReportHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // Default main padding is 0 1rem (16px each side). The mobile rule
    // tightens to 0 .75rem (12px each side) so the card layout has a
    // few more pixels of content width at 375px.
    expect(mediaBlock).toMatch(/main\s*\{[^}]*padding:\s*0\s+\.75rem/);
  });

  test('OSE-295 | API | GET /sharedReport (mobile media query) | action-bar buttons meet the 44px touch-target floor', async () => {
    const html = await fetchSharedReportHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // The Export JSON / Export PDF buttons default to ~32px tall (.5rem
    // padding). On mobile they must hit the 44px floor (invariant 14)
    // AND stretch to fill the action-bar width so they're easy to tap.
    expect(mediaBlock).toMatch(/\.action-bar\s+\.btn\s*\{[^}]*min-height:\s*44px/);
    expect(mediaBlock).toMatch(/\.action-bar\s+\.btn\s*\{[^}]*flex:\s*1\s+1\s+auto/);
  });
});

/**
 * Extract the contents of the @media (max-width: Npx) { ... } block at
 * the given breakpoint. Returns the body text between the opening and
 * matching closing brace. Naive but adequate — shared-report CSS
 * doesn't nest @media inside @media.
 */
function extractMediaBlock(html: string, breakpointPx: number): string {
  const opener = new RegExp(`@media\\s*\\(\\s*max-width:\\s*${breakpointPx}px\\s*\\)\\s*\\{`);
  const startMatch = html.match(opener);
  expect(
    startMatch,
    `expected @media (max-width: ${breakpointPx}px) block in shared-report HTML`
  ).toBeTruthy();
  const start = startMatch!.index! + startMatch![0].length;
  let depth = 1;
  let i = start;
  while (i < html.length && depth > 0) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return html.slice(start, i - 1);
}
