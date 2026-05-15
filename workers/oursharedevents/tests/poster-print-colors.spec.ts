/**
 * OSE-R-006 — poster print CSS must preserve sponsor logo color and brand
 * header background, must enforce page-break boundaries, and must NEVER
 * grayscale sponsor imagery.
 *
 * Layer: API (vitest inspects the rendered poster HTML for the CSS rules
 * that govern @media print behavior; companion FE test in Playwright
 * verifies real-browser print-emulation rendering).
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names share their shape
 * byte-for-byte with the Playwright FE spec at
 * tests/playwright/poster-print-colors.spec.ts.
 *
 * Format: `OSE-R-006 | API | <method + path> (<condition>) | <assertion>`.
 *
 * The audit (REFINEMENT-BACKLOG-2026-05-15.md OSE-R-006) found that the
 * poster page's @media print block:
 *   1. Applied `filter: grayscale(1)` to sponsor logos — sponsors paid for
 *      full-color placement; black-and-white logos break the value promise.
 *   2. Lacked `print-color-adjust: exact` on the dark-navy poster header,
 *      so the brand chrome dropped to white-on-white when a bar owner hit
 *      Cmd+P.
 *   3. Lacked `page-break-inside: avoid` on the poster shell + QR section,
 *      so a single-event poster could split across two A4 pages.
 *
 * This spec locks the fix: grayscale gone, print-color-adjust everywhere
 * it matters, page-break rules in place.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function fetchPosterHtml(): Promise<string> {
  const res = await SELF.fetch('https://test.local/poster', {
    headers: { Accept: 'text/html' },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type') ?? '').toContain('text/html');
  return res.text();
}

// The @media print block lives inside the rendered HTML between the
// `@media print {` opener and its matching closing brace. Tests pull
// that block out so assertions are scoped to print-only rules and
// can't false-pass against screen-mode CSS.
function extractPrintBlock(html: string): string {
  const match = html.match(/@media\s+print\s*\{([\s\S]*?)\}\s*<\/style>/);
  expect(match, 'poster HTML must contain an @media print block').toBeTruthy();
  return match![1];
}

describe('OSE-R-006 poster print colors — API layer', () => {
  test('OSE-R-006 | API | GET /poster (any visitor) | @media print block exists in rendered HTML', async () => {
    const html = await fetchPosterHtml();
    expect(html).toMatch(/@media\s+print\s*\{/);
  });

  test('OSE-R-006 | API | GET /poster (any visitor) | sponsor logos are NOT grayscaled in print rule', async () => {
    // The audit-flagged regression: `filter: grayscale(1)` on
    // `.poster-sponsor img` in the print block. Sponsors paid for full
    // color; this lock holds the contract.
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    expect(printBlock).not.toMatch(/\.poster-sponsor\s+img\s*\{[^}]*filter:\s*grayscale/);
    // Defensive: also forbid the bare grayscale filter anywhere in the
    // print block — protects against a future refactor that moves the
    // rule to a different selector but keeps the grayscale.
    expect(printBlock).not.toMatch(/filter:\s*grayscale/);
  });

  test('OSE-R-006 | API | GET /poster (any visitor) | print-color-adjust: exact applied to brand header and sponsor surfaces', async () => {
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    // The standard `print-color-adjust` property MUST appear so modern
    // browsers honor the dark-navy header background and sponsor logo
    // colors when printing. The `-webkit-` prefix covers older
    // WebKit/Blink that hasn't standardized yet.
    expect(printBlock).toMatch(/-webkit-print-color-adjust:\s*exact/);
    expect(printBlock).toMatch(/print-color-adjust:\s*exact/);
    // The rule must scope to (at minimum) the brand header + sponsor
    // surfaces. We assert by checking the selectors appear in the same
    // print-block context.
    expect(printBlock).toMatch(/\.poster-header[\s\S]*print-color-adjust:\s*exact/);
    expect(printBlock).toMatch(/\.poster-sponsor[\s\S]*print-color-adjust:\s*exact/);
  });

  test('OSE-R-006 | API | GET /poster (any visitor) | page-break-inside: avoid applied to .poster shell', async () => {
    // Single-event poster should not split across A4 pages. The shell-level
    // rule keeps the whole poster on one page when it fits.
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    expect(printBlock).toMatch(/\.poster\s*\{[^}]*page-break-inside:\s*avoid/);
  });

  test('OSE-R-006 | API | GET /poster (any visitor) | page-break-inside: avoid applied to QR section', async () => {
    // If the QR section is split mid-code, scanners fail. Hard requirement
    // for printed posters that get taped up at venues.
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    expect(printBlock).toMatch(/\.qr-section\s*\{[^}]*page-break-inside:\s*avoid/);
  });

  test('OSE-R-006 | API | GET /poster (any visitor) | page-break-inside: avoid retained on sponsor band', async () => {
    // Existing behavior we must preserve through the refactor — sponsor
    // band is a logical unit; splitting it mid-tier breaks the visual
    // hierarchy the sponsor tier system implies.
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    expect(printBlock).toMatch(/\.poster-sponsors\s*\{[^}]*page-break-inside:\s*avoid/);
  });

  test('OSE-R-006 | API | GET /poster (any visitor) | sponsor logo size clamp survives the refactor', async () => {
    // Layout decision (separate from the color fix): logos clamp to 20px
    // max-height in print so they fit a printed A4 page. Removing the
    // grayscale must NOT also remove this clamp.
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    expect(printBlock).toMatch(/\.poster-sponsor\s+img\s*\{[^}]*max-height:\s*20px/);
  });

  test('OSE-R-006 | API | GET /poster (any visitor) | poster-sponsor-name and label render in black ink', async () => {
    // Existing contract preserved. Sponsor name/label text was dark navy
    // on screen but rendered black on print so it survives without
    // print-color-adjust. Holds through this fix.
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    expect(printBlock).toMatch(
      /\.poster-sponsor-name,\s*\.poster-sponsor-label\s*\{[^}]*color:\s*#000/
    );
  });

  test('OSE-R-006 | API | GET /poster (any visitor) | qr-loading placeholder is hidden in print', async () => {
    // Print-time UX: the dashed-border "loading" placeholder must not
    // appear on paper. Existing rule preserved.
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    expect(printBlock).toMatch(/\.qr-loading\s*\{[^}]*display:\s*none\s*!important/);
  });
});
