/**
 * L1 UNIT — Embedded-JS syntax integrity for the public form pages.
 *
 * WHY THIS EXISTS (OSE-1003):
 *   form-pages.ts serves its client behaviour as inline <script> bodies built
 *   inside backtick template literals. The pre-existing worker tests
 *   (form-sponsor-ui.spec.ts, csp-nonce.spec.ts, …) only ever assert
 *   `body.toContain('…')` — they NEVER parse the emitted JS. So a real syntax
 *   error shipped and stayed invisible to ~200 tests: the sponsor-logo string
 *   `onerror="this.style.display=\'none\'"` sat inside a single-quoted JS
 *   string within a template literal, where `\'` collapses to a bare `'`,
 *   closing the string early → `SyntaxError: Unexpected identifier 'none'`.
 *   That killed the WHOLE inline <script>, so submitForm/handleRegister/
 *   showSuccess were never defined and no form on staging could submit.
 *
 * WHAT THIS GUARDS:
 *   Renders every form type, extracts every INLINE <script> body from the
 *   emitted HTML, and compiles each via `new Function(body)` — which PARSES
 *   the body (no execution, no side effects). Any embedded-JS syntax error
 *   throws here, at the fast unit rung, instead of silently reaching a browser.
 *
 *   Runs in the node vitest surface (root `vitest run`), NOT the workerd pool
 *   — workerd blocks `new Function`/`eval`, so a genuine parse-check cannot
 *   live in workers/oursharedevents/tests/. `handleFormPage` has no runtime
 *   imports, so it renders fine under node's global Request/Response. Uses a
 *   dynamic import() so this file stays a CommonJS script (eslint sourceType).
 */

const FORM_TYPES = ['register', 'checkin', 'survey', 'email'];

/** Load the render handler from its TS source (vitest transforms on import). */
async function loadHandler() {
  const mod = await import('../../workers/oursharedevents/src/handlers/form-pages.ts');
  return mod.handleFormPage;
}

async function renderForm(handleFormPage, formType, eventId = 'evt-integrity') {
  const req = new Request(`https://t.test/forms/${eventId}?type=${formType}&event=Integrity`);
  return (await handleFormPage(req, {}, eventId)).text();
}

/** Extract the bodies of INLINE <script> tags (skip external src= scripts). */
function inlineScriptBodies(html) {
  const bodies = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs)) continue; // external — no inline body to parse
    if (body.trim().length === 0) continue;
    bodies.push(body);
  }
  return bodies;
}

describe('form pages — inline <script> bodies are syntactically valid JS', () => {
  for (const formType of FORM_TYPES) {
    test(`${formType}: every inline script parses without SyntaxError`, async () => {
      const handleFormPage = await loadHandler();
      const html = await renderForm(handleFormPage, formType);
      const bodies = inlineScriptBodies(html);

      // Sanity: the form page must actually ship inline behaviour, else the
      // guard would vacuously pass on an empty extraction.
      expect(bodies.length).toBeGreaterThan(0);

      bodies.forEach((body, i) => {
        // `new Function(body)` compiles the body as a function body (parse
        // only — it is never called), so undefined runtime globals like
        // document/window/fetch are irrelevant; only syntax is checked.
        expect(
          () => new Function(body),
          `${formType} inline <script> #${i} failed to parse`
        ).not.toThrow();
      });
    });
  }

  test('regression lock (OSE-1003): sponsor-logo onerror uses &#39; not a raw quote', async () => {
    const handleFormPage = await loadHandler();
    const html = await renderForm(handleFormPage, 'register');
    // The fixed form uses the HTML entity, which carries no quote to collapse
    // inside the single-quoted JS string that builds the <img>.
    expect(html).toContain('this.style.display=&#39;none&#39;');
    // The broken form (bare apostrophes inside the single-quoted string) must
    // never come back.
    expect(html).not.toContain("this.style.display='none'");
  });
});
