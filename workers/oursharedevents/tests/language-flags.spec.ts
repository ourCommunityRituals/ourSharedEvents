/**
 * The flag or letter badge beside each language's name (owner 2026-11-28:
 * "flags plus letter badges", 22 languages). Self-hosted SVGs, because flag
 * emoji do not draw on Windows.
 *
 * @born-red language flags | method: the route cases seen failing (404) before the route was added; then 4 faults injected one at a time in src/lib/i18n/language-flags.ts (an outside href in one picture, a script in the badge, a missing CSP header, any tag accepted as a language); each turned cases here red | date: 2026-11-28
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { renderLanguageMenu } from '../src/lib/i18n/language-menu';
import {
  flagLangFromPath,
  languageFlagPath,
  languageFlagSvg,
} from '../src/lib/i18n/language-flags';
import { LANGUAGES, LANGUAGE_MARK, LANGUAGE_NAMES } from '../src/lib/i18n/languages';

describe('language flags | the pictures', () => {
  it('Arabic, Russian and Persian get a letter badge; every other language a flag', () => {
    const badges = LANGUAGES.filter((l) => LANGUAGE_MARK[l].kind === 'badge');
    expect(badges).toEqual(['ar', 'ru', 'fa']);
    expect(badges.map((l) => languageFlagSvg(l))).toEqual([
      expect.stringContaining('>AR</text>'),
      expect.stringContaining('>RU</text>'),
      expect.stringContaining('>FA</text>'),
    ]);
  });

  it.each(LANGUAGES)('%s: a small static SVG with nothing that runs or reaches out', (lang) => {
    const svg = languageFlagSvg(lang);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="30" height="20"/);
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg).not.toMatch(/<script|on[a-z]+=|href|url\(|<image|<foreignObject/i);
    expect(svg, 'no raw hex colour').not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(svg.length).toBeLessThan(2000);
  });

  it('a path names a listed language or nothing', () => {
    for (const lang of LANGUAGES) expect(flagLangFromPath(languageFlagPath(lang))).toBe(lang);
    for (const path of [
      '/flags/nl.svg',
      '/flags/.svg',
      '/flags/en',
      '/flags/en.svg/x',
      '/flags/../en.svg',
      '/flags/EN.svg',
    ]) {
      expect(flagLangFromPath(path), path).toBeNull();
    }
  });
});

describe('language flags | the route', () => {
  it.each(LANGUAGES)('GET /flags/%s.svg is a static, locked-down SVG', async (lang) => {
    const res = await SELF.fetch(`https://t.test/flags/${lang}.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'"
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(await res.text()).toBe(languageFlagSvg(lang));
  });

  it('an unlisted language has no picture', async () => {
    const res = await SELF.fetch('https://t.test/flags/nl.svg');
    expect(res.status).not.toBe(200);
    expect(res.headers.get('content-type') ?? '').not.toContain('image/svg+xml');
    await res.arrayBuffer();
  });
});

describe('language flags | in the menu', () => {
  it('each language has its picture beside its name, and the name is still the whole text', () => {
    const html = renderLanguageMenu({ lang: 'en', path: '/events' });
    for (const lang of LANGUAGES) {
      const img = `<img class="ose-langmenu-flag" src="/flags/${lang}.svg" alt="" width="21" height="14" loading="lazy">`;
      // Once in the wide-screen list and once in the phone menu.
      expect(html.split(img), lang).toHaveLength(3);
      expect(html).toContain(`${img}${LANGUAGE_NAMES[lang]}`);
    }
  });
});
