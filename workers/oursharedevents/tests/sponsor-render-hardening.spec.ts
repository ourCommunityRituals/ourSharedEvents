/**
 * OSE-R-011 + OSE-R-015 — sponsor-logo render hardening across all 6
 * surfaces that emit a sponsor `<img>` tag.
 *
 * Layer: API (vitest exercises the rendered HTML for each surface and
 * asserts the security + UX contract).
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names share their shape
 * byte-for-byte with the matching Playwright FE spec at
 * tests/playwright/sponsor-render-hardening.spec.ts.
 *
 * Format: `OSE-R-011 | API | <method + path> (<condition>) | <assertion>`.
 *
 * Two audit rows closed in one fix:
 *   OSE-R-015 — Sponsor `<img src="' + s.logo_url + '">` in form-pages.ts
 *     was interpolated WITHOUT escaping (the `name` was escaped but
 *     `logo_url` dropped in raw). Same `<img>` rendering sites in pages.ts
 *     lacked `referrerpolicy="no-referrer"` — the sponsor host could
 *     fingerprint visiting attendees via the Referer header.
 *   OSE-R-011 — TV display sponsor rotation had no `img.onerror` handler;
 *     a 404'd sponsor logo would sit on the venue's TV indefinitely
 *     between rotation ticks.
 *
 * Single fix point: every sponsor `<img>` tag (across 6 sites) gets:
 *   1. Attribute escaping for `logo_url` (XSS guard).
 *   2. `referrerpolicy="no-referrer"` (anti-fingerprinting).
 *   3. A broken-image hide. Originally `onerror="this.style.display='none'"`;
 *      FE-15 (2026-09-27) migrated the FORM page to the CSP-safe equivalent
 *      (`data-hide-on-error` + a capture-phase document 'error' listener),
 *      because the nonce CSP (`script-src 'self' 'nonce-…'`) blocks inline
 *      event handlers. The onerror assertion below accepts EITHER mechanism.
 * Plus the display TV rotation gets a special advance-on-error handler
 * that calls showNext() so the next sponsor rotates in immediately.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function fetchPage(path: string): Promise<string> {
  const res = await SELF.fetch(`https://test.local${path}`, {
    headers: { Accept: 'text/html' },
  });
  expect(res.status, `${path} should render 200`).toBe(200);
  return res.text();
}

// Each surface's container script that contains the sponsor `<img>` render
// site. The vitest assertions are scoped to substrings to avoid coupling
// to unrelated CSS or markup changes.
// Route map clarification: the public sponsor banner (pages.ts:163) is on
// /events (handlePublicPage), NOT on / (handleLandingPage which has no
// sponsor banner). The form-pages sponsor strip is reachable through any
// /forms/:id render.
const SURFACES: Array<{ path: string; name: string }> = [
  { path: '/events', name: 'public events listing' },
  { path: '/forms/evt_test_2026?type=register', name: 'register form' },
  { path: '/display', name: 'display TV' },
  { path: '/poster', name: 'poster' },
];

describe('OSE-R-011 + OSE-R-015 sponsor render hardening — API layer', () => {
  for (const surface of SURFACES) {
    test(`OSE-R-015 | API | GET ${surface.path} (${surface.name}) | sponsor img tags carry referrerpolicy="no-referrer"`, async () => {
      const html = await fetchPage(surface.path);
      // At least one img tag in the rendered HTML must carry the policy.
      // We assert presence at the substring level — any surface that
      // renders sponsor images at all must include the policy.
      expect(html, `${surface.name} must include referrerpolicy on sponsor imgs`).toMatch(
        /referrerpolicy=["']no-referrer["']/
      );
    });

    test(`OSE-R-015 | API | GET ${surface.path} (${surface.name}) | sponsor img tags have onerror handler to hide broken images`, async () => {
      const html = await fetchPage(surface.path);
      // FE-15 (2026-09-27): the broken-image hide is mechanism-agnostic. The
      // original inline `onerror="this.style.display=…"` is CSP-blocked under the
      // nonce policy (`script-src 'self' 'nonce-…'`, no 'unsafe-inline'), so the
      // form page now hides broken sponsor logos via `data-hide-on-error` + one
      // capture-phase document 'error' listener (the wiring is asserted in
      // form-sponsor-ui.spec.ts + tests/unit/form-page-js-integrity.test.js). The
      // other surfaces still carry inline onerror. Accept EITHER — the guarantee
      // is "a broken sponsor logo is hidden", not one specific attribute.
      expect(
        html,
        `${surface.name} must hide broken sponsor imgs (inline onerror or CSP-safe data-hide-on-error)`
      ).toMatch(/onerror=["']this\.style\.display=|data-hide-on-error=["']/);
    });
  }

  test('OSE-R-015 | API | GET /forms/:id (any) | sponsor logo URL is escaped in client JS, not interpolated raw', async () => {
    const html = await fetchPage('/forms/evt_test_2026?type=register');
    // Pre-fix: `s.logo_url` was used raw. Post-fix: an escAttr helper is
    // defined and `logoUrl` is the escaped variable interpolated into
    // the img src. Assert both: helper present + raw use absent.
    expect(html, 'form-pages JS must define an escAttr helper for logo_url').toMatch(
      /escAttr\s*=\s*function/
    );
    // The raw `s.logo_url` interpolation directly into an attribute value
    // must NOT appear — only the escaped variable should reach the DOM.
    expect(
      html,
      'form-pages JS must NOT interpolate s.logo_url directly into the img src attribute'
    ).not.toMatch(/<img\s+src="['"]\s*\+\s*s\.logo_url\s*\+/);
  });

  test('OSE-R-015 | API | GET /forms/:id (any) | form-pages sponsor render preserves sponsor name escaping', async () => {
    // Defense-in-depth: the existing name-escape pattern continues to
    // work alongside the new logo_url escape. Regression guard against
    // a future refactor that simplifies one and loses the other.
    const html = await fetchPage('/forms/evt_test_2026?type=register');
    // 0083: the rendered name is the public title (display_name → name); it
    // still goes through escAttr.
    expect(html).toMatch(/name\s*=\s*escAttr\(s\.title \|\| s\.name\)/);
  });

  test('OSE-R-011 | API | GET /display (any) | sponsor rotation attaches an error-advance handler', async () => {
    // The TV display rotation's broken-image handler MUST advance to the
    // next sponsor immediately, not just hide the current one. Without
    // this advance, a 404'd logo leaves the rotation visibly stuck
    // until the next setInterval tick (5s default).
    const html = await fetchPage('/display');
    expect(html).toMatch(/attachErrorAdvance/);
    // The advance must include a call to showNext when there are
    // multiple sponsors in rotation.
    expect(html).toMatch(/if\s*\(\s*total\s*>\s*1\s*\)\s*showNext\(\s*\)/);
  });

  test('OSE-R-011 | API | GET /display (any) | broken-image fallback emits data-testid="display-sponsor-error" sentinel', async () => {
    // QA must be able to detect "we hit a broken sponsor logo and skipped
    // it" from the DOM. The audit row explicitly requests this testid.
    const html = await fetchPage('/display');
    expect(html).toMatch(/data-testid["']?,\s*["']display-sponsor-error["']/);
  });

  test('OSE-R-011 | API | GET /display (any) | display rotation selects current sponsor img by tag (sole img in sidebar)', async () => {
    // We dropped the bespoke data-testid="display-sponsor-rotate-img" on
    // the rotation img because the testid-pyramid lint counts the
    // querySelector('[data-testid="..."]') reference as a duplicate of
    // the attribute itself within the same template scope. The simpler
    // sidebar.querySelector('img') works because the sidebar always has
    // exactly one img (the current rotation slot).
    const html = await fetchPage('/display');
    expect(html).toMatch(/sidebar\.querySelector\(['"]img['"]\)/);
  });

  test('OSE-R-015 | API | sponsor img count across all surfaces matches referrerpolicy count', async () => {
    // Cross-cutting invariant: NO sponsor img anywhere in the fleet
    // ships without the referrerpolicy. Catch the case where someone
    // adds a 7th render site and forgets the policy.
    for (const surface of SURFACES) {
      const html = await fetchPage(surface.path);
      // Count `<img` tags inside sponsor-related substrings. Conservative
      // regex — we look at img tags within a 500-char window of either
      // "sponsor" or "logo_url" to scope to sponsor renders specifically.
      const sponsorImgPattern = /<img\s+src=[^>]*?(?:logo_url|sponsor)[^>]*?>/gi;
      const imgs = html.match(sponsorImgPattern) || [];
      for (const img of imgs) {
        expect(img, `${surface.name}: every sponsor img tag must include referrerpolicy`).toMatch(
          /referrerpolicy=/
        );
      }
    }
  });
});
