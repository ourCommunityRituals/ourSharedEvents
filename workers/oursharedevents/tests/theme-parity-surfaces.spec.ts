/**
 * Theme parity — every surface follows the viewer's light/dark theme.
 *
 * A rendered audit (2026-09-29, 22 surface states x phone/laptop x light/dark)
 * found elements that vanish in one theme and whole surfaces that ignore the
 * theme entirely. Each block below pins the fix against the RENDERED output:
 *
 *   Invisible in one theme
 *     - /display  .display-consent was rgba(255,255,255,.85) on var(--surface):
 *       1:1 in light.
 *     - /admin    the wizard's selected option (OSE-1340) was a fixed #f0fdf4
 *       fill under var(--text): 1.06:1 in dark. Its focus ring was suppressed.
 *       The Shared Report Links result box was fixed light colours too.
 *     - /sponsor  the header "What's on" link had no rule at all — UA #0000ee,
 *       1.76:1 in dark, 71x18px.
 *
 *   Surfaces that ignored the theme (never loaded /ui.css, literal colours)
 *     - /forms/:id (FORM_CSS), renderErrorPage(), /privacy.
 *
 * These are source-shape assertions on served HTML — the colour arithmetic is
 * proven by the rendered audit; these keep the literals from coming back.
 * Born red: every test here fails against the pre-change templates (verified
 * by running this file against commit b13aa9b before the fix).
 */
import { SELF, env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { renderErrorPage } from '../src/handlers/pages';

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

/** Concatenated <style> bodies with CSS comments removed. */
function cssOf(html: string): string {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Colour literals that do not go through a token (var() fallbacks are stripped). */
function literalColours(css: string): string[] {
  const noVars = css.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, 'var()');
  return noVars.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(?:white|black)\b/gi) ?? [];
}

/** Declarations of every rule whose selector list contains `selector` exactly. */
function ruleBodies(css: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out;
}

function decl(css: string, selector: string, prop: string): string | undefined {
  let found: string | undefined;
  for (const body of ruleBodies(css, selector)) {
    for (const d of body.split(';')) {
      const i = d.indexOf(':');
      if (i > 0 && d.slice(0, i).trim() === prop) found = d.slice(i + 1).trim();
    }
  }
  return found;
}

function templateSource(name: string): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON
  );
  const hit = Object.entries(sources).find(([p]) =>
    p.replaceAll('\\', '/').endsWith(`templates/${name}`)
  );
  expect(hit, `${name} in TEST_SOURCE_FILES_JSON`).toBeDefined();
  return hit![1];
}

const UI_CSS = /<link rel="stylesheet" href="\/ui\.css"/;

describe('invisible in one theme', () => {
  test('/display consent line uses a text token, not white', async () => {
    const css = cssOf(await (await SELF.fetch('https://t.test/display')).text());
    expect(decl(css, '.display-consent', 'color')).toBe('var(--text)');
    expect(css).not.toMatch(/\.display-consent\s*\{[^}]*rgba\(255,\s*255,\s*255/);
  });

  test('/admin wizard selected option is token-based and marked beyond colour (OSE-1340)', async () => {
    const html = await (await SELF.fetch('https://t.test/admin', { headers: ADMIN })).text();
    const css = cssOf(html);
    const bg = decl(css, '.wizard-publish-option.selected', 'background');
    expect(bg, 'selected fill').toBeDefined();
    expect(literalColours(bg!)).toEqual([]);
    expect(bg).toContain('var(--surface)');
    expect(decl(css, '.wizard-publish-option.selected', 'border-color')).toBe('var(--success)');
    expect(css).not.toMatch(/#f0fdf4/i);
    // A check glyph and aria-pressed carry the state, not colour alone.
    expect(decl(css, '.selected > .wizard-card-title::before', 'content')).toBeDefined();
    expect(html).toMatch(/aria-pressed="true"\s+class="wizard-publish-option selected"/);
    expect(html).toMatch(/aria-pressed="false"\s+class="wizard-publish-option"/);
    // Focus is not suppressed: no rule for the option's :focus-visible sets outline none.
    for (const s of [
      '.wizard-publish-option:focus-visible',
      '.wizard-template-card:focus-visible',
      '.wizard-signup-option:focus-visible',
      '.path-option:focus-visible',
    ]) {
      expect(decl(css, s, 'outline'), s).not.toBe('none');
    }
  });

  test('/admin Shared Report Links result and card errors use tokens', async () => {
    const html = await (await SELF.fetch('https://t.test/admin', { headers: ADMIN })).text();
    expect(html).not.toMatch(/#f0faf0|#fff0f0|#c0392b|#b6e2b6|#e2b6b6|#5a5a5a|#f5f5f5/i);
    const css = cssOf(html);
    expect(literalColours(decl(css, '.copy-btn', 'background') ?? '#')).toEqual([]);
    expect(literalColours(ruleBodies(css, '.card-error').join(';'))).toEqual([]);
  });

  test('/sponsor header link has a token colour and a 44px target', async () => {
    // Read the template: without a signed link the route serves the error page.
    const css = cssOf(templateSource('sponsor-home.html'));
    expect(decl(css, '.header a', 'color')).toMatch(/^var\(--/);
    expect(decl(css, '.header a', 'min-height')).toBe('44px');
  });
});

describe('forms, error page and /privacy follow the theme', () => {
  for (const type of ['register', 'checkin', 'survey', 'email-signup']) {
    test(`/forms ?type=${type}: links /ui.css, no literal colours`, async () => {
      const res = await SELF.fetch(`https://t.test/forms/evt-theme-parity?type=${type}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toMatch(UI_CSS);
      expect(literalColours(cssOf(html))).toEqual([]);
      // inline style="" attributes too
      const attrs = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]).join(';');
      expect(literalColours(attrs)).toEqual([]);
    });
  }

  test('/forms controls: 16px text, 44px, --border-strong edge; rating buttons have an edge', async () => {
    const html = await (
      await SELF.fetch('https://t.test/forms/evt-theme-parity?type=survey')
    ).text();
    const css = cssOf(html);
    expect(decl(css, 'input', 'font-size')).toBe('16px');
    expect(decl(css, 'input', 'min-height')).toBe('44px');
    expect(decl(css, 'input', 'border')).toMatch(/var\(--border-strong\)/);
    expect(decl(css, '.rating-row button', 'border')).toMatch(/var\(--border-strong\)/);
    expect(decl(css, '.privacy-notice', 'color')).toBe('var(--text-muted)');
  });

  test('renderErrorPage: links /ui.css, no literal colours, no private --err-* palette', async () => {
    const html = await renderErrorPage(404, 'Not found', 'Nothing here.').text();
    expect(html).toMatch(UI_CSS);
    const css = cssOf(html);
    expect(literalColours(css)).toEqual([]);
    expect(css).not.toMatch(/--err-/);
    expect(decl(css, '.error-cta', 'color')).toBe('var(--on-accent)');
  });

  test('/privacy: links /ui.css, no literal colours, 44px back link', async () => {
    const html = await (await SELF.fetch('https://t.test/privacy')).text();
    expect(html).toMatch(UI_CSS);
    const css = cssOf(html);
    expect(literalColours(css)).toEqual([]);
    expect(decl(css, '.back', 'min-height')).toBe('44px');
    expect(decl(css, '.updated', 'color')).toBe('var(--text-muted)');
  });
});
