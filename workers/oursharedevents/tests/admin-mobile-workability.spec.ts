/**
 * OSE-294 — admin dashboard mobile workability (DRAIN 1/7 of OSE-292).
 *
 * Layer: API (vitest inspects the rendered admin HTML for the mobile
 * CSS contracts; the actual viewport-rendered behavior is verified by
 * the Playwright `mobile-workability.spec.ts` audit running against
 * staging).
 *
 * Closes the long-standing OSE-R-027 trust-breaker audit row:
 * "Header h1 contains tier badge + phase badge + 'Admin' subtitle
 * crammed inline; 360px breaks the layout; event/sponsor tables are
 * 6-col with no mobile reorg."
 *
 * This spec asserts the markup + CSS rules that close the contract.
 * The actual layout proof comes from the Playwright audit at 375×812
 * once staging deploys this fix.
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names follow
 *   `OSE-294 | API | GET <path> (<condition>) | <assertion>`.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const ADMIN_KEY = 'test-admin-key-e2e-2026';

async function fetchAdminHtml(): Promise<string> {
  const res = await SELF.fetch('https://test.local/admin', {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  expect(res.status).toBe(200);
  return res.text();
}

describe('OSE-294 admin mobile workability — API layer', () => {
  test('OSE-294 | API | GET /admin (any) | @media (max-width: 768px) block present', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)\s*\{/);
  });

  test('OSE-294 | API | GET /admin (mobile media query) | header h1 stacks badges vertically', async () => {
    const html = await fetchAdminHtml();
    // The header h1 contains the tier-badge + phase-badge inline by
    // default. At 768px or below they MUST stack so they don't wrap
    // and overflow on a 375px screen.
    const mediaBlock = extractMediaBlock(html, 768);
    expect(mediaBlock).toMatch(/header\s+h1\s*\{[^}]*flex-direction:\s*column/);
    expect(mediaBlock).toMatch(/header\s+h1\s*\{[^}]*align-items:\s*flex-start/);
  });

  test('OSE-294 | API | GET /admin (mobile media query) | events table converts to card layout', async () => {
    const html = await fetchAdminHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // The 6-col events-table must collapse: thead hidden, tr becomes
    // a stacked card, each td becomes a labeled row.
    expect(mediaBlock).toMatch(/table\.events-table\s+thead\s*\{[^}]*display:\s*none/);
    expect(mediaBlock).toMatch(/table\.events-table\s+tr\s*\{[^}]*display:\s*block/);
    expect(mediaBlock).toMatch(/table\.events-table\s+td\s*\{[^}]*display:\s*block/);
    // The td::before pseudo-element pulls from data-label so each row
    // remains identifiable without the thead.
    expect(mediaBlock).toMatch(
      /table\.events-table\s+td::before\s*\{[^}]*content:\s*attr\(data-label\)/
    );
  });

  test('OSE-294 | API | GET /admin (mobile media query) | sponsors table converts to card layout', async () => {
    const html = await fetchAdminHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    expect(mediaBlock).toMatch(/#sponsors-list\s+table\s+thead\s*\{[^}]*display:\s*none/);
    expect(mediaBlock).toMatch(/#sponsors-list\s+table\s+tr\s*\{[^}]*display:\s*block/);
    expect(mediaBlock).toMatch(
      /#sponsors-list\s+table\s+td::before\s*\{[^}]*content:\s*attr\(data-label\)/
    );
    // Actions column shouldn't get a label prefix — the buttons are
    // self-descriptive (Edit / Deactivate).
    expect(mediaBlock).toMatch(/td\[data-label="Actions"\]::before\s*\{[^}]*content:\s*''/);
  });

  test('OSE-294 | API | GET /admin (any) | events-table td cells carry data-label attributes', async () => {
    const html = await fetchAdminHtml();
    // Each td in the events table must declare its label so the mobile
    // card layout can render `Name: Empty Bottle` instead of just
    // `Empty Bottle` (no longer paired with a header row).
    expect(html).toContain('data-label="Name"');
    expect(html).toContain('data-label="Date"');
    expect(html).toContain('data-label="Venue"');
    expect(html).toContain('data-label="Status"');
    expect(html).toContain('data-label="Event type"');
  });

  test('OSE-294 | API | GET /admin (any) | sponsors-table td cells carry data-label attributes', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-label="Tier"');
    expect(html).toContain('data-label="Event"');
    expect(html).toContain('data-label="Placements"');
    expect(html).toContain('data-label="Actions"');
  });

  test('OSE-294 | API | GET /admin (mobile media query) | main padding tightens for narrow viewports', async () => {
    const html = await fetchAdminHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // Default main padding is 0 2rem (32px each side) — too aggressive
    // on a 375px screen where every pixel of content space matters.
    // The mobile rule tightens to 0 .75rem (12px each side).
    expect(mediaBlock).toMatch(/main\s*\{[^}]*padding:\s*0\s+\.75rem/);
  });

  test('OSE-294 | API | GET /admin (mobile media query) | internal-id column stays hidden by default in card mode', async () => {
    const html = await fetchAdminHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // Per OSE-R-005, internal IDs are hidden behind the "Show internal
    // IDs" toggle. The mobile card layout must preserve that — the
    // toggle still controls visibility when checked.
    expect(mediaBlock).toMatch(
      /table\.events-table\s+td\.col-internal-id\s*\{[^}]*display:\s*none/
    );
    expect(mediaBlock).toMatch(
      /table\.events-table\.show-internal-ids\s+td\.col-internal-id\s*\{[^}]*display:\s*block/
    );
  });

  test('OSE-294 | API | GET /admin (mobile media query) | form-count boxes collapse to 2x2 on a phone', async () => {
    const html = await fetchAdminHtml();
    // The four count boxes are a fixed 4-across grid by default; on a 375px
    // screen that squeezes each to ~80px. The ≤480px rule collapses them to 2x2.
    const mediaBlock = extractMediaBlock(html, 480);
    expect(mediaBlock).toMatch(
      /\.form-counts\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OSE-585 — TL-049: Mobile workability conformance gate
// Extends OSE-294 coverage with the threat ledger cross-reference.
// These tests are born-red: they prove the mobile contract has enforcement.
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-585 — TL-049: mobile workability conformance gate', () => {
  // @born-red TL-049 | method: historical-ci-failure | date: 2026-08-03
  test('admin page includes @media (max-width: 768px) block (mobile layout is present)', async () => {
    const html = await fetchAdminHtml();
    expect(html, '@media (max-width: 768px) block must exist in admin HTML').toMatch(
      /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{/
    );
  });

  // @born-red TL-049 | method: historical-ci-failure | date: 2026-08-03
  test('admin page events table has mobile card layout (display:block on tr/td)', async () => {
    const html = await fetchAdminHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    expect(
      mediaBlock,
      'events-table tr must display:block in mobile (card layout prevents horizontal scroll)'
    ).toMatch(/table\.events-table\s+tr\s*\{[^}]*display:\s*block/);
  });

  test('admin page has at least one data-label attribute (touch-friendly card labeling)', async () => {
    const html = await fetchAdminHtml();
    expect(
      html,
      'data-label attributes must exist so mobile card layout can render field labels'
    ).toMatch(/data-label=/);
  });
});

/**
 * Extract the contents of the @media (max-width: Npx) { ... } block at
 * the given breakpoint. Returns the body text between the opening and
 * matching closing brace. Naive but adequate — admin page CSS doesn't
 * nest @media inside @media.
 */
function extractMediaBlock(html: string, breakpointPx: number): string {
  const opener = new RegExp(`@media\\s*\\(\\s*max-width:\\s*${breakpointPx}px\\s*\\)\\s*\\{`);
  const startMatch = html.match(opener);
  expect(
    startMatch,
    `expected @media (max-width: ${breakpointPx}px) block in admin HTML`
  ).toBeTruthy();
  const start = startMatch!.index! + startMatch![0].length;
  // Match braces to find the closing }.
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
