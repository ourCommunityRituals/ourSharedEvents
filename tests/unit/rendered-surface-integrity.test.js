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

const fs = require('fs');
const path = require('path');
const { findInlineScriptParseErrors } = require('../_shared/embedded-integrity.js');

const FORM_TYPES = ['register', 'checkin', 'survey', 'email'];
const TEMPLATE_DIR = path.join(__dirname, '../../workers/oursharedevents/src/templates');

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

// ── Template SOURCE parse (OSE-1158) ─────────────────────────────────────────
// The best-effort pages.ts block above SKIPS admin/pages surfaces under node
// (pages.ts not importable), leaving admin.html's inline <script> bodies
// UNPARSED — that vacuous skip is why a broken onclick concat (the embedded-JS
// -parse-guard class, sibling of OSE-1003) shipped and only T4d caught it. This
// block parses the TEMPLATE SOURCE files directly (fs read — no render/import
// needed) so every surface's inline JS is proven to parse at the fast unit rung.
// Born-red: on the broken admin.html this failed with "Unexpected string"
// (script blocks 6 + 8, the sponsor + forms cards); green after the fix.
describe('template source — inline <script> bodies are valid JS (OSE-1158)', () => {
  const htmlFiles = fs.readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.html'));

  test('template dir has .html surfaces (guard is not vacuous)', () => {
    expect(htmlFiles.length).toBeGreaterThan(0);
  });

  for (const file of htmlFiles) {
    test(`${file}: every inline script parses`, () => {
      const html = fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8');
      const errors = findInlineScriptParseErrors(html);
      expect(errors, `${file} parse errors: ${JSON.stringify(errors)}`).toEqual([]);
    });
  }
});
