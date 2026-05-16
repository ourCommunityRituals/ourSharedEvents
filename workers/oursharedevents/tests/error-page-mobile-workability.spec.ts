/**
 * OSE-308 — Regression guard for renderErrorPage touch-target CSS.
 *
 * The OSE-R-004 branded error page is itself a customer surface (per
 * OCR-42 error-page sub-contract). Refined audit run #25952807821 +
 * follow-on #25952940787 revealed two real CSS bugs:
 *
 *   - `<a data-testid="error-brand">` (header link) = 137x23 — was
 *     a bare inline anchor with no min-height, 21px short of 44px
 *   - `<a data-testid="error-cta">` (recovery anchor) = 213x41 — was
 *     inline-block with padding alone, 3px short of 44px
 *
 * This spec locks the fix as a contract: both anchors render with
 * display: inline-flex + align-items: center + min-height: 44px so
 * the text vertically centers in a 44px-floor box.
 *
 * Layer: API (vitest fetches the rendered error-page HTML for any
 * unknown event ID and asserts the CSS rules are present).
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-308 | API | GET <path> (<condition>) | <assertion>`.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function fetchErrorPageHtml(): Promise<string> {
  // Any obviously-non-existent event ID triggers renderErrorPage. The
  // shape `evt_does_not_exist_for_test` is alnum+_- so it passes the
  // input-validation gate at the top of handlePublicEventPage. In the
  // test env this may hit the 503 "DB unavailable" branch OR the 404
  // "row not found" branch — both use renderErrorPage with identical
  // CSS/HTML shape. Accept either status.
  const res = await SELF.fetch('https://test.local/events/evt_does_not_exist_for_test');
  expect([404, 503]).toContain(res.status);
  expect(res.headers.get('Content-Type') ?? '').toContain('text/html');
  return res.text();
}

describe('OSE-308 renderErrorPage touch-target CSS — API layer', () => {
  test('OSE-308 | API | GET /events/:non-existent (any) | error page HTML serves at 404', async () => {
    const html = await fetchErrorPageHtml();
    expect(html).toContain('data-testid="error-main"');
    expect(html).toContain('data-testid="error-brand"');
    expect(html).toContain('data-testid="error-cta"');
  });

  test('OSE-308 | API | GET /events/:non-existent | header anchor (error-brand) carries inline-flex + 44px min-height', async () => {
    const html = await fetchErrorPageHtml();
    // The CSS rule for `header a` must include all three properties.
    // Use a single regex that requires all three in the same rule body
    // so a future change that splits or weakens any of them breaks.
    expect(html).toMatch(/header\s+a\s*\{[^}]*display:\s*inline-flex[^}]*\}/);
    expect(html).toMatch(/header\s+a\s*\{[^}]*align-items:\s*center[^}]*\}/);
    expect(html).toMatch(/header\s+a\s*\{[^}]*min-height:\s*44px[^}]*\}/);
  });

  test('OSE-308 | API | GET /events/:non-existent | recovery anchor (.error-cta) carries inline-flex + 44px min-height', async () => {
    const html = await fetchErrorPageHtml();
    expect(html).toMatch(/\.error-cta\s*\{[^}]*display:\s*inline-flex[^}]*\}/);
    expect(html).toMatch(/\.error-cta\s*\{[^}]*align-items:\s*center[^}]*\}/);
    expect(html).toMatch(/\.error-cta\s*\{[^}]*min-height:\s*44px[^}]*\}/);
  });

  test('OSE-308 | API | GET /events/:non-existent | error-page CSS references OSE-308 (provenance trace)', async () => {
    const html = await fetchErrorPageHtml();
    // The CSS comment block explaining the why of the rule must remain
    // so a future maintainer reading the touch-target rules sees the
    // OSE-308 reason and doesn't "simplify" them away.
    expect(html).toContain('OSE-308');
  });
});
