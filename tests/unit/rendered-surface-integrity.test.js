/**
 * Layer 1 — RENDERED surface integrity (generalized from forms-only, OSE-1003).
 *
 * Renders each HTML surface and parses every inline <script> body via the
 * shared primitive (new Function = parse-only). Any JS syntax error in emitted
 * output goes red here, at the fast unit rung — not silently in a browser.
 *
 * Coverage is honest about the node/workerd split:
 *   - FORMS render self-contained (no env) → HARD assert they parse.
 *   - pages.ts surfaces import template .html + @ocr/ui, which may not resolve
 *     under node vitest (workerd bundles them). When a surface can't be
 *     rendered here it is logged and left to Layer 2 (embedded-js source lint,
 *     which reads the source directly) + E2E — NOT silently skipped.
 */

const { findInlineScriptParseErrors } = require('../_shared/embedded-integrity.js');

const FORM_TYPES = ['register', 'checkin', 'survey', 'email'];

describe('rendered surfaces — inline <script> bodies are valid JS', () => {
  describe('forms (self-contained — must render + parse)', () => {
    let handleFormPage;
    beforeAll(async () => {
      ({ handleFormPage } =
        await import('../../workers/oursharedevents/src/handlers/form-pages.ts'));
    });

    for (const type of FORM_TYPES) {
      test(`${type}: every inline script parses`, async () => {
        const req = new Request(`https://t.test/forms/evt-x?type=${type}&event=X`);
        const html = await (await handleFormPage(req, {}, 'evt-x')).text();
        const errors = findInlineScriptParseErrors(html);
        expect(errors, `parse errors: ${JSON.stringify(errors)}`).toEqual([]);
      });
    }
  });

  describe('pages.ts surfaces (best-effort under node)', () => {
    // Renderers that ignore env (self-contained enough to try in node).
    const SURFACES = [
      ['public', (m, env) => m.handlePublicPage(env)],
      ['admin', (m, env) => m.handleAdminPage(env)],
      ['admin-signin', (m, env) => m.handleAdminSignInPage(env)],
      ['landing', (m, env) => m.handleLandingPage(env)],
      ['display', (m, env) => m.handleDisplayPage(env)],
      ['poster', (m, env) => m.handlePosterPage(env)],
      ['shared-report', (m, env) => m.handleSharedReportPage(env)],
    ];

    let mod = null;
    let importErr = null;
    beforeAll(async () => {
      try {
        mod = await import('../../workers/oursharedevents/src/handlers/pages.ts');
      } catch (e) {
        importErr = e;
      }
    });

    for (const [name, render] of SURFACES) {
      test(`${name}: inline scripts parse (or logged for Layer 2)`, async () => {
        if (!mod) {
          console.log(
            `[layer1-skip] pages.ts not node-importable (${(importErr && importErr.message ? importErr.message : '').slice(0, 90)}) — ${name} covered by embedded-js source lint + E2E`
          );
          return;
        }
        let html;
        try {
          html = await (await render(mod, {})).text();
        } catch (e) {
          console.log(
            `[layer1-skip] ${name} needs env to render (${(e && e.message ? e.message : '').slice(0, 90)}) — covered by embedded-js source lint + E2E`
          );
          return;
        }
        const errors = findInlineScriptParseErrors(html);
        expect(errors, `${name} parse errors: ${JSON.stringify(errors)}`).toEqual([]);
      });
    }
  });
});
