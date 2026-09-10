/**
 * OSE-300 — /poster preview mobile workability (DRAIN 7/7 of OSE-292).
 *
 * Layer: API (vitest inspects the rendered poster HTML for the
 * mobile CSS contracts; the actual viewport-rendered behavior is
 * verified by the Playwright `mobile-workability.spec.ts` audit
 * running against staging at 375x812).
 *
 * The audit identified three concerns on /poster:
 *   1. The 4-up QR row at 120px each plus 2rem gaps overflows 375px.
 *      With flex-wrap they stack 2x2, but the gap is wide enough
 *      that they crowd. Shrinking to 100px + 1rem gap keeps the
 *      "two visible per row" pattern with breathing room.
 *   2. The .page-header Print anchor was a bare inline anchor with
 *      no min-height — below the 44px touch-target floor (inv 14).
 *   3. The .event-select <select> font-size defaults to .95rem
 *      (~15.2px). Anything < 16px causes iOS to auto-zoom on tap.
 *      Bumping to 16px + 44px min-height fixes both at once.
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names follow
 *   `OSE-300 | API | GET <path> (<condition>) | <assertion>`.
 *
 * The handler is invoked directly (same shape as the L1 Static
 * blocks elsewhere in tests/) so the spec stays a pure HTML
 * inspection — no D1 / no feature flag setup required.
 */

import { describe, test, expect } from 'vitest';
import { handlePosterPage } from '../src/handlers/pages';

async function fetchPosterHtml(): Promise<string> {
  return handlePosterPage({} as never).then((r) => r.text());
}

describe('OSE-300 poster preview mobile workability — API layer', () => {
  test('OSE-300 | API | GET /poster (any) | @media (max-width: 768px) block present', async () => {
    const html = await fetchPosterHtml();
    expect(html).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)\s*\{/);
  });

  test('OSE-300 | API | GET /poster (mobile media query) | Print button in page-header meets 44px touch-target floor', async () => {
    const html = await fetchPosterHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // The page-header Print control (data-testid="poster-print") is the
    // primary CTA on this surface. As of OSE-286 it is a <button class="print-btn">
    // (was a bare anchor) so it can be disabled while QR codes load — the
    // mobile rule must still hit the 44px floor on the button.
    expect(mediaBlock).toMatch(/\.page-header\s+\.print-btn\s*\{[^}]*min-height:\s*44px/);
    expect(mediaBlock).toMatch(/\.page-header\s+\.print-btn\s*\{[^}]*display:\s*inline-flex/);
  });

  test('OSE-300 | API | GET /poster (mobile media query) | event-select select hits the 16px iOS auto-zoom floor', async () => {
    const html = await fetchPosterHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // iOS Safari auto-zooms on any input/select whose font-size is
    // below 16px. The event-picker <select> defaults to .95rem
    // (~15.2px) — must be raised on mobile.
    expect(mediaBlock).toMatch(/\.event-select\s+select\s*\{[^}]*font-size:\s*16px/);
    // Same rule also enforces the 44px touch-target floor.
    expect(mediaBlock).toMatch(/\.event-select\s+select\s*\{[^}]*min-height:\s*44px/);
  });

  test('OSE-300 | API | GET /poster (mobile media query) | QR codes shrink to 100px so two fit per row at 375px', async () => {
    const html = await fetchPosterHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // 4 QR codes at 120px + 2rem gap overflow on 375px even with
    // wrap (240 + 32 = 272 leaves only 60px of breathing room
    // inside the 311px content column). 100px + 1rem gap fits
    // cleanly (200 + 16 = 216 inside ~327 mobile container).
    expect(mediaBlock).toMatch(/\.qr-img,\s*\.qr-loading\s*\{[^}]*width:\s*100px/);
    expect(mediaBlock).toMatch(/\.qr-img,\s*\.qr-loading\s*\{[^}]*height:\s*100px/);
    expect(mediaBlock).toMatch(/\.qr-section\s*\{[^}]*gap:\s*1rem/);
  });

  test('OSE-300 | API | GET /poster (mobile media query) | container + poster-body padding tightens for narrow viewports', async () => {
    const html = await fetchPosterHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // Default container padding is 0 1rem (16px); poster-body is 2rem
    // (32px). At 375px the poster-body's 64px of horizontal padding
    // squeezes content to ~311px — tightening to 1rem (16px) reclaims
    // 32px without breaking the printed-poster aesthetic.
    expect(mediaBlock).toMatch(/\.container\s*\{[^}]*padding:\s*0\s+\.75rem/);
    expect(mediaBlock).toMatch(/\.poster-body\s*\{[^}]*padding:\s*1\.25rem\s+1rem/);
  });

  test('OSE-300 | API | GET /poster (mobile media query) | qr-link-url wraps inside its 100px column', async () => {
    const html = await fetchPosterHtml();
    const mediaBlock = extractMediaBlock(html, 768);
    // The QR link URL renders below each QR image at .6rem. The
    // mobile rule caps its width to 100px (matching the shrunk QR
    // image) and forces word-break so a long URL wraps inside the
    // column instead of pushing the QR row wider.
    expect(mediaBlock).toMatch(/\.qr-link-url\s*\{[^}]*max-width:\s*100px/);
    expect(mediaBlock).toMatch(/\.qr-link-url\s*\{[^}]*word-break:\s*break-all/);
  });
});

/**
 * Extract the contents of the @media (max-width: Npx) { ... } block at
 * the given breakpoint. Returns the body text between the opening and
 * matching closing brace. Naive but adequate — poster CSS doesn't
 * nest @media inside @media.
 */
function extractMediaBlock(html: string, breakpointPx: number): string {
  const opener = new RegExp(`@media\\s*\\(\\s*max-width:\\s*${breakpointPx}px\\s*\\)\\s*\\{`);
  const startMatch = html.match(opener);
  expect(
    startMatch,
    `expected @media (max-width: ${breakpointPx}px) block in poster HTML`
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
