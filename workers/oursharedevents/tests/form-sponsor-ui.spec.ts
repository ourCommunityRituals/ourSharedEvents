/**
 * OSE-222 + OSE-223 — Sponsor UX on form pages
 *
 * Two surgical additions to the attendee-form surface (form-pages.ts):
 *
 *   - OSE-222: sponsor logo strip in the form header. Hidden by default;
 *     populated by JS on page load from /api/v2/events/:id/sponsor-bundle
 *     ?surface=public (mobileBanner slot). Silently absent when no sponsors
 *     are configured for the event.
 *   - OSE-223: sponsor acknowledgment in the success state. Reads from
 *     the same cache populated by the strip loader; appends a thanks block
 *     below the "you can close this page" line on submit success.
 *
 * Pyramid coverage:
 *
 *   L1 Static — HTML template contains:
 *               - the form-sponsor-strip container with proper testid + ARIA
 *               - the sponsor CSS classes (.form-sponsor-strip, .form-sponsor-thanks)
 *               - the inlined sponsor-loader script that fetches the bundle
 *               - the showSuccess() modification reading window.__formSponsorCache
 *
 *   Anonymity guarantee:
 *
 *               handleFormPage itself remains under the anonymity static gate
 *               (anonymity-gate.spec.ts, OSE-274). The sponsor-loader script
 *               runs client-side only and reads NO per-attendee identity.
 *               This file's tests verify the rendered HTML — separate from
 *               the source-static anonymity gate.
 */

import { describe, test, expect } from 'vitest';
import { handleFormPage } from '../src/handlers/form-pages';

async function html(eventId = 'evt-test', formType = 'register'): Promise<string> {
  const req = new Request(`https://t.test/forms/${eventId}?type=${formType}&event=Test`);
  return (await handleFormPage(req, {}, eventId)).text();
}

// ─── OSE-222 — sponsor logo strip in header ─────────────────────────────────

describe('OSE-222: sponsor logo strip in form page header', () => {
  test('strip container present with data-testid + ARIA', async () => {
    const body = await html();
    expect(body).toContain('id="form-sponsor-strip"');
    expect(body).toContain('data-testid="form-sponsor-strip"');
    expect(body).toContain('role="complementary"');
    expect(body).toContain('aria-label="Event sponsors"');
  });

  test('strip starts visually hidden — only .has-sponsors makes it appear', async () => {
    const body = await html();
    // Base class hides via `display: none`; .has-sponsors enables flex layout.
    expect(body).toMatch(/\.form-sponsor-strip\s*\{[^}]*display:\s*none/);
    expect(body).toMatch(/\.form-sponsor-strip\.has-sponsors\s*\{[^}]*display:\s*flex/);
  });

  test('strip CSS classes defined (label, item, name, image sizing)', async () => {
    const body = await html();
    expect(body).toContain('.form-sponsor-strip .strip-label');
    expect(body).toContain('.form-sponsor-strip .sponsor-item');
    expect(body).toContain('.form-sponsor-strip .sponsor-name');
    expect(body).toContain('.form-sponsor-strip img');
    // 24px logo height per the design spec in OSE-222
    expect(body).toMatch(/\.form-sponsor-strip img\s*\{[^}]*height:\s*24px/);
  });

  test('sponsor loader script fetches surface=public bundle for this event', async () => {
    const body = await html('evt-loader-test');
    // The loader fetches the public-surface sponsor bundle scoped to this event
    expect(body).toContain('/api/v2/events/');
    expect(body).toContain('/sponsor-bundle?surface=public');
    // EventId is template-injected via JSON.stringify(eventId) — verify the
    // exact eventId from this test is present (proves the substitution works)
    expect(body).toContain('"evt-loader-test"');
  });

  test('sponsor loader reads mobileBanner slot from the bundle', async () => {
    const body = await html();
    // The bundle's surface_sponsors.mobileBanner is the canonical slot
    // for the form-surface ("public" surface from API perspective)
    expect(body).toContain('surface_sponsors');
    expect(body).toContain('mobileBanner');
  });

  test('sponsor loader caches the bundle for showSuccess (cross-script handoff)', async () => {
    const body = await html();
    // The strip loader sets window.__formSponsorCache; showSuccess reads it.
    // Both names must be present and identical for the cross-script handoff.
    expect(body).toContain('window.__formSponsorCache');
  });

  test('sponsor loader silently no-ops on fetch failure (non-critical surface)', async () => {
    const body = await html();
    // The .catch handler must be a no-op — sponsor strip is brand presence,
    // not core functionality. Form submission MUST NOT fail because the
    // sponsor bundle failed to load.
    expect(body).toMatch(/\.catch\(function\(\)\s*\{[^}]*\}\)/);
  });

  test('strip renders for all four form types (register / checkin / survey / email)', async () => {
    for (const formType of ['register', 'checkin', 'survey', 'email']) {
      const body = await html('evt-multi', formType);
      expect(body, `${formType} form missing sponsor strip`).toContain(
        'data-testid="form-sponsor-strip"'
      );
    }
  });
});

// ─── OSE-223 — sponsor acknowledgment on success state ──────────────────────

describe('OSE-223: sponsor acknowledgment on form success state', () => {
  test('showSuccess reads cached sponsor data for the thanks block', async () => {
    const body = await html();
    // The success handler must reference the same cache the strip loader populates
    expect(body).toContain('window.__formSponsorCache');
    // The thanks block is appended ONLY when cache is populated — empty/missing
    // cache must result in the original (no-thanks) success state.
    expect(body).toMatch(/cache\s*&&\s*cache\.length/);
  });

  test('thanks block CSS classes defined', async () => {
    const body = await html();
    expect(body).toContain('.form-sponsor-thanks');
    expect(body).toContain('.form-sponsor-thanks .thanks-label');
    expect(body).toContain('.form-sponsor-thanks .sponsor-row');
    expect(body).toContain('.form-sponsor-thanks .sponsor-name');
    expect(body).toContain('.form-sponsor-thanks img');
  });

  test('thanks block rendering produces expected data-testid', async () => {
    const body = await html();
    // The rendered HTML in showSuccess must include the testid so E2E tests
    // can target the post-submit sponsor acknowledgment
    expect(body).toContain('data-testid="form-sponsor-thanks"');
  });

  test('thanks block uses "Event supported by" label (per OSE-223 spec)', async () => {
    const body = await html();
    expect(body).toContain('Event supported by');
  });

  test('thanks block is rendered INSIDE the success div (not separate)', async () => {
    const body = await html();
    // In source, the `thanks` JS variable is built BEFORE the success wrapper
    // string (so the thanks testid appears first in source text). At runtime,
    // the concatenation order in showSuccess is:
    //   '<div class="success"...>' + msg + '</p>' + thanks + '</div>'
    // which yields runtime DOM with thanks INSIDE the success div.
    // Static-source assertion of that contract: the success-HTML wrapper
    // concatenates `thanks` BEFORE its closing `</div>` (not after).
    expect(body).toMatch(/data-testid="form-success"[^']*[\s\S]*?'\s*\+\s*thanks\s*\+\s*'<\/div>'/);
  });

  test('sponsor name and logo are XSS-escaped in both strip and thanks renderers', async () => {
    const body = await html();
    // Both renderers escape sponsor.name with the same character map.
    // Verify the escape map is present (the same replacement pattern appears
    // twice — once in the strip loader, once in showSuccess).
    const matches = body.match(/'<':\s*'&lt;'/g) || [];
    expect(
      matches.length,
      'XSS escape map missing or appears in only one renderer'
    ).toBeGreaterThanOrEqual(2);
  });
});

// ─── FE-15 — CSP-safe broken-logo hiding (no inline onerror=) ───────────────

describe('FE-15: sponsor logos hide gracefully without CSP-blocked inline onerror', () => {
  test('no inline onerror= handler is emitted on any sponsor img', async () => {
    const body = await html();
    // The form page CSP is `script-src 'self' 'nonce-…'` (no 'unsafe-inline'),
    // so an inline `onerror="…"` attribute would be BLOCKED by the browser and
    // the broken-image would never hide. Assert the inline-handler ATTRIBUTE is
    // absent. NB: the FE-15 rationale comments legitimately contain the bare
    // substring "onerror=" (inside the FORM_JS template literal), so match the
    // attribute form `onerror="`/`onerror='` specifically, not the substring.
    expect(body).not.toMatch(/onerror\s*=\s*["']/);
  });

  test('both sponsor-logo renderers mark data-hide-on-error on the img', async () => {
    const body = await html();
    // Two renderers emit a sponsor <img>: the success-state thanks block
    // (FORM_JS_SUBMIT) and the header strip (FORM_JS_SPONSOR). Both must carry
    // the attribute the capture-phase listener keys off.
    const marks = body.match(/data-hide-on-error="1"/g) || [];
    expect(
      marks.length,
      'expected both the thanks-block and strip img renderers to mark data-hide-on-error'
    ).toBeGreaterThanOrEqual(2);
  });

  test('one capture-phase document error listener hides marked broken imgs', async () => {
    const body = await html();
    // The 'error' event does NOT bubble, so a delegated listener MUST use
    // capture phase (the `true` 3rd arg) to catch failures on the dynamically
    // added sponsor imgs. Assert the listener exists, gates on the
    // data-hide-on-error attribute, and is registered in capture phase.
    expect(body).toMatch(
      /addEventListener\(\s*['"]error['"][\s\S]*?data-hide-on-error[\s\S]*?,\s*true\s*\)/
    );
  });

  test('listener hides the img (display:none), matching the removed inline behavior', async () => {
    const body = await html();
    // The listener must reproduce what the old inline onerror did:
    // hide the broken <img>. Assert the effect is present in the handler.
    expect(body).toMatch(/tagName\s*===\s*['"]IMG['"]/);
    expect(body).toMatch(/style\.display\s*=\s*['"]none['"]/);
  });
});

// ─── Cross-cutting: applies to all 4 form types ─────────────────────────────

describe('OSE-222 + OSE-223: applies to all 4 form types', () => {
  const types = ['register', 'checkin', 'survey', 'email'] as const;

  for (const formType of types) {
    test(`${formType} form has both sponsor strip + thanks block infrastructure`, async () => {
      const body = await html('evt-cross', formType);
      // Strip (OSE-222) — header overlay
      expect(body).toContain('data-testid="form-sponsor-strip"');
      // Thanks block (OSE-223) — success-state acknowledgment, rendered
      // by the same shared showSuccess function in FORM_JS_SUBMIT
      expect(body).toContain('data-testid="form-sponsor-thanks"');
      expect(body).toContain('window.__formSponsorCache');
    });
  }
});
