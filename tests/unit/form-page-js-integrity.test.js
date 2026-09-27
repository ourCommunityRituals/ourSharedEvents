/**
 * OSE-1003 / FE-15 regression lock — sponsor-logo broken-image handling on form
 * pages must stay CSP-safe and never break the inline <script>.
 *
 * History:
 *  - OSE-1003 locked the sponsor-logo `onerror` against a raw quote collapsing
 *    the single-quoted JS string that built the <img> inside the FORM_JS_*
 *    backtick templates — a bare ' closed the served string early → SyntaxError
 *    that killed the whole inline <script> and stopped every form submitting.
 *    The fix at the time was the &#39; entity.
 *  - FE-15 (2026-09-27) removed the inline `onerror` entirely: the form page CSP
 *    is `script-src 'self' 'nonce-…'` (no 'unsafe-inline'), so an inline
 *    `onerror=` is CSP-BLOCKED and never fires. Broken sponsor logos now hide via
 *    `data-hide-on-error` + one capture-phase document 'error' listener. That
 *    supersedes OSE-1003's specific concern (there is no inline onerror string
 *    left to collapse) while keeping the SAME guarantee: a broken logo hides and
 *    the form still submits.
 *
 * The general "inline <script> bodies parse" coverage (all form types + page
 * surfaces) lives in rendered-surface-integrity.test.js, which consumes the
 * shared primitive in tests/_shared/embedded-integrity.js. This file keeps only
 * the narrow, named regression assertion for the sponsor-logo error handling.
 */

async function renderRegister() {
  const { handleFormPage } =
    await import('../../workers/oursharedevents/src/handlers/form-pages.ts');
  const req = new Request('https://t.test/forms/evt-lock?type=register&event=Lock');
  return (await handleFormPage(req, {}, 'evt-lock')).text();
}

describe('OSE-1003 / FE-15 regression lock — sponsor-logo broken-image handling', () => {
  test('emits no CSP-blocked inline onerror= handler on any sponsor img', async () => {
    const html = await renderRegister();
    // The FE-15 rationale comments legitimately contain the bare substring
    // "onerror=" inside the FORM_JS template, so match the inline-handler
    // ATTRIBUTE form (onerror="/onerror='), not the substring.
    expect(html).not.toMatch(/onerror\s*=\s*["']/);
    // The specific pre-OSE-1003 broken form (bare apostrophes inside the
    // single-quoted JS string) must never come back either.
    expect(html).not.toContain("this.style.display='none'");
  });

  test('hides broken sponsor logos via data-hide-on-error + a capture-phase listener', async () => {
    const html = await renderRegister();
    // Both sponsor-logo renderers mark the attribute the delegated listener keys
    // off (the success-state thanks block and the header strip).
    const marks = html.match(/data-hide-on-error="1"/g) || [];
    expect(marks.length).toBeGreaterThanOrEqual(2);
    // The 'error' event does not bubble, so the one document-level listener must
    // be registered in CAPTURE phase (the `true` 3rd arg) to catch failures on
    // the dynamically-added imgs.
    expect(html).toMatch(
      /addEventListener\(\s*['"]error['"][\s\S]*?data-hide-on-error[\s\S]*?,\s*true\s*\)/
    );
  });
});
