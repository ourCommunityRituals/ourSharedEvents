/**
 * The language choice at the foot of a page, as one chip (owner 2026-11-28:
 * "The bottom languages need a component to condense to choice to card or chip
 * in the same UI design format").
 *
 * Unit layer, in node: `renderLanguageSwitch` and its CSS on their own, with
 * the markup parsed in jsdom. The pages that carry it are covered in
 * language-path-prefix.spec.ts (workers pool), a11y-axe.spec.ts (axe with the
 * chip open) and tests/e2e/3-flows/language-path-prefix.spec.ts (staging).
 *
 * - Shape: one "Language" landmark; one closed `<details>`; a chip with the
 *   page's flag and its language's own name; a card with every other language.
 * - Security: names and addresses are escaped; every link stays on this site;
 *   a path that would leave the site gives no switch at all; no script, no
 *   inline handler, nothing stored.
 * - Design: 44 px targets or more, 16 px text, colours as tokens only, logical
 *   properties only, so a right-to-left page mirrors it.
 *
 * @born-red language chip | method: this spec run against language-switch.ts
 *   as on main (76e44ba, the row of links): the shape, flag, card, CSS and
 *   off-site path cases fail; escaping and query cases pass there too |
 *   date: 2026-11-28
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { LANGUAGE_SWITCH_CSS, renderLanguageSwitch } from '../src/lib/i18n/language-switch';
import {
  LANGUAGES,
  LANGUAGE_NAMES,
  LANGUAGE_SWITCH_NAMES,
  type Lang,
} from '../src/lib/i18n/languages';
import { withLangPrefix } from '../src/lib/i18n/path-prefix';

const PATH = '/events/evt_1/spring-fair';

function parse(html: string): Document {
  return new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
}

function switchFor(lang: Lang, path = PATH, query?: string): Document {
  return parse(renderLanguageSwitch({ lang, path, query }));
}

describe('the language chip | shape', () => {
  it.each(LANGUAGES.map((l) => [l] as const))('%s: one landmark, one closed choice', (lang) => {
    const doc = switchFor(lang);
    const navs = doc.querySelectorAll('nav');
    expect(navs.length).toBe(1);
    expect(navs[0].getAttribute('data-testid')).toBe('language-switch');
    expect(navs[0].getAttribute('class')).toBe('ose-lang');
    const details = doc.querySelectorAll('details');
    expect(details.length).toBe(1);
    // Closed until tapped: the bottom of the page shows one chip, not a list.
    expect(details[0].hasAttribute('open')).toBe(false);
    expect(details[0].getAttribute('data-testid')).toBe('language-switch-choice');
  });

  it.each(LANGUAGES.map((l) => [l] as const))(
    '%s: the chip shows the page’s flag and its language’s own name',
    (lang) => {
      const chip = switchFor(lang).querySelector('summary');
      expect(chip?.getAttribute('data-testid')).toBe('language-switch-chip');
      expect(chip?.getAttribute('class')).toBe('ose-lang-chip');
      const img = chip?.querySelector('img');
      expect(img?.getAttribute('src')).toBe(`/flags/${lang}.svg`);
      expect(img?.getAttribute('alt')).toBe('');
      const name = chip?.querySelector('span[lang]');
      expect(name?.getAttribute('lang')).toBe(lang);
      expect(name?.textContent).toBe(LANGUAGE_NAMES[lang]);
      const caret = chip?.querySelector('.ose-lang-caret');
      expect(caret?.getAttribute('aria-hidden')).toBe('true');
      expect(caret?.textContent).toBe('▾');
    }
  );

  it('the chip and the landmark are named in the page’s language', () => {
    const es = switchFor('es');
    expect(es.querySelector('nav')?.getAttribute('aria-label')).toBe('Idioma');
    expect(es.querySelector('summary')?.getAttribute('aria-label')).toBe('Idioma: Español');
    const en = switchFor('en');
    expect(en.querySelector('nav')?.getAttribute('aria-label')).toBe('Language');
    expect(en.querySelector('summary')?.getAttribute('aria-label')).toBe('Language: English');
  });

  it.each(LANGUAGES.map((l) => [l] as const))(
    '%s: the card lists every other language once, each with its flag',
    (lang) => {
      const doc = switchFor(lang);
      const card = doc.querySelector('ul');
      expect(card?.getAttribute('data-testid')).toBe('language-switch-card');
      expect(card?.getAttribute('class')).toBe('ose-lang-card');
      // The card sits inside the choice, so it is hidden until the chip is tapped.
      expect(card?.parentElement?.tagName).toBe('DETAILS');
      const links = [...doc.querySelectorAll('ul > li > a')];
      const others = LANGUAGES.filter((l) => l !== lang);
      expect(links.map((a) => a.getAttribute('hreflang'))).toEqual(others);
      for (const [i, l] of others.entries()) {
        const a = links[i];
        expect(a.getAttribute('data-testid')).toBe(`language-switch-${l}`);
        expect(a.getAttribute('href')).toBe(withLangPrefix(l, PATH));
        expect(a.textContent).toBe(LANGUAGE_SWITCH_NAMES[lang][l]);
        const name = LANGUAGE_SWITCH_NAMES[lang][l];
        expect(a.getAttribute('lang')).toBe(name === LANGUAGE_NAMES[l] ? l : lang);
        const img = a.querySelector('img');
        expect(img?.getAttribute('src')).toBe(`/flags/${l}.svg`);
        expect(img?.getAttribute('alt')).toBe('');
        expect(img?.getAttribute('width')).toBe('21');
        expect(img?.getAttribute('height')).toBe('14');
        expect(img?.getAttribute('class')).toBe('ose-lang-flag');
      }
      // The page's own language is the chip, never a link to itself.
      expect(doc.querySelector(`[data-testid="language-switch-${lang}"]`)).toBeNull();
    }
  );

  it('carries the vetted query to every choice', () => {
    const doc = switchFor('es', '/events', '?when=weekend&q=fair');
    for (const a of doc.querySelectorAll('ul a')) {
      const l = a.getAttribute('hreflang') as Lang;
      expect(a.getAttribute('href')).toBe(`${withLangPrefix(l, '/events')}?when=weekend&q=fair`);
    }
  });
});

describe('the language chip | security', () => {
  it('escapes a hostile path and query in every link', () => {
    const html = renderLanguageSwitch({
      lang: 'en',
      path: '/events/"><script>alert(1)</script>',
      query: '?q="><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    const doc = parse(html);
    expect(doc.querySelectorAll('script').length).toBe(0);
    for (const el of doc.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) {
        expect(attr.startsWith('on'), `${el.tagName} ${attr}`).toBe(false);
      }
    }
  });

  it.each([
    ['protocol-relative', '//evil.example/x'],
    ['backslash', '/\\evil.example/x'],
    ['absolute URL', 'https://evil.example/x'],
    ['script URL', 'javascript:alert(1)'],
    ['no leading slash', 'events'],
    ['empty', ''],
  ])('a %s path gives no switch, so no link can leave the site', (_why, path) => {
    for (const lang of ['en', 'es', 'ar'] as const) {
      expect(renderLanguageSwitch({ lang, path })).toBe('');
    }
  });

  it.each(LANGUAGES.map((l) => [l] as const))(
    '%s: every link and picture is a local path on this site',
    (lang) => {
      const doc = switchFor(lang, '/');
      for (const a of doc.querySelectorAll('a')) {
        expect(a.getAttribute('href')).toMatch(/^\/(?![/\\])/);
        expect(a.hasAttribute('target')).toBe(false);
      }
      for (const img of doc.querySelectorAll('img')) {
        expect(img.getAttribute('src')).toMatch(/^\/flags\/[a-z-]+\.svg$/);
      }
    }
  );

  it('needs no script and stores nothing: no cookie, storage or form', () => {
    const html = renderLanguageSwitch({ lang: 'es', path: PATH, query: '' });
    expect(html).not.toMatch(/<script|<form|<input|cookie|localStorage|sessionStorage/i);
  });
});

describe('the language chip | design', () => {
  const rule = (selector: string): string => {
    const at = LANGUAGE_SWITCH_CSS.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return LANGUAGE_SWITCH_CSS.slice(at, LANGUAGE_SWITCH_CSS.indexOf('}', at));
  };

  it('the chip is a 48 px pill in the shared chip style', () => {
    const chip = rule('.ose-lang-chip');
    expect(chip).toContain('min-height: 48px');
    expect(chip).toContain('min-width: 44px');
    expect(chip).toContain('font-size: 1rem');
    expect(chip).toContain('border-radius: 999px');
    expect(chip).toContain('border: 1.5px solid var(--border-strong)');
    expect(chip).toContain('background: var(--surface)');
    expect(chip).toContain('color: var(--text)');
    expect(chip).toContain('list-style: none');
    expect(LANGUAGE_SWITCH_CSS).toContain(
      '.ose-lang-chip::-webkit-details-marker { display: none; }'
    );
  });

  it('each choice is a 44 px target with 16 px text, two to a row in a card', () => {
    const link = rule('.ose-lang a');
    expect(link).toContain('min-height: 44px');
    expect(link).toContain('min-width: 44px');
    expect(link).toContain('font-size: 1rem');
    const card = rule('.ose-lang-card');
    expect(card).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(card).toContain('background: var(--surface)');
    expect(card).toContain('border: 1.5px solid var(--border-strong)');
    expect(card).toContain('list-style: none');
  });

  it('keeps a visible focus ring and turns the caret when open', () => {
    expect(LANGUAGE_SWITCH_CSS).toMatch(
      /\.ose-lang-chip:focus-visible, \.ose-lang a:focus-visible \{ outline: 3px solid/
    );
    expect(LANGUAGE_SWITCH_CSS).toContain(
      '.ose-lang details[open] > .ose-lang-chip .ose-lang-caret { transform: rotate(180deg); }'
    );
  });

  it('uses colour tokens only and logical sides only', () => {
    expect(LANGUAGE_SWITCH_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(LANGUAGE_SWITCH_CSS).not.toMatch(/\b(left|right)\b/);
  });
});
