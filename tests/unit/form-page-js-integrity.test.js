/**
 * OSE-1003 regression lock — the sponsor-logo onerror must not reintroduce a
 * raw quote inside the single-quoted JS string that builds the <img>.
 *
 * The general "inline <script> bodies parse" coverage (all form types + page
 * surfaces) now lives in rendered-surface-integrity.test.js, which consumes the
 * shared primitive in tests/_shared/embedded-integrity.js. This file keeps only
 * the narrow, named regression assertion for the specific bug that shipped.
 *
 * Background: onerror="this.style.display=\'none\'" sat inside the FORM_JS_*
 * backtick template literals, where \' collapses to a bare ' — closing the
 * served single-quoted string early → SyntaxError that killed the whole inline
 * <script> and stopped every form from submitting. Fixed with the &#39; entity.
 */

async function renderRegister() {
  const { handleFormPage } =
    await import('../../workers/oursharedevents/src/handlers/form-pages.ts');
  const req = new Request('https://t.test/forms/evt-lock?type=register&event=Lock');
  return (await handleFormPage(req, {}, 'evt-lock')).text();
}

describe('OSE-1003 regression lock — sponsor-logo onerror', () => {
  test('uses the &#39; entity, never a raw quote inside the JS string', async () => {
    const html = await renderRegister();
    // Fixed form: entity carries no quote to collapse in the template literal;
    // the browser decodes &#39;→' when parsing onerror from innerHTML.
    expect(html).toContain('this.style.display=&#39;none&#39;');
    // Broken form (bare apostrophes inside the single-quoted string) must never
    // come back.
    expect(html).not.toContain("this.style.display='none'");
  });
});
