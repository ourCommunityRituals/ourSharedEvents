/**
 * E5 (OSE-1935): a third language reaches the header Language menu with no
 * change to the menu.
 *
 * The plan is many languages beyond English and Spanish (owner 2026-11-10). The
 * menu reads `LANGUAGES`, so adding one there is all it takes. This spec swaps
 * in a three-language list (French as a stand-in; it is not a shipped language)
 * and checks both layouts list all three, in order, with the right one current.
 *
 * Its own file: `vi.mock` replaces the languages module for the whole file.
 *
 * Born red: hard-code two languages in the menu, or drop the current-language
 * test, and a case here fails.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/i18n/languages', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/i18n/languages')>();
  const LANGUAGES = ['en', 'es', 'fr'] as const;
  return {
    ...real,
    LANGUAGES,
    LANGUAGE_NAMES: { ...real.LANGUAGE_NAMES, fr: 'Français' },
    LANGUAGE_SWITCH_NAMES: {
      en: { ...real.LANGUAGE_SWITCH_NAMES.en, fr: 'Français' },
      es: { ...real.LANGUAGE_SWITCH_NAMES.es, fr: 'Francés' },
      fr: { en: 'Anglais', es: 'Espagnol', fr: 'Français' },
    },
    isLang: (v: unknown) => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v),
  };
});

// Adding a language means adding its catalog too (`Record<Lang, …>` makes that a
// compile error otherwise). The stand-in catalog reads the English one.
vi.mock('../src/lib/i18n/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/i18n/catalog')>();
  return {
    ...real,
    msg: (lang: string, key: Parameters<typeof real.msg>[1]) =>
      real.msg((lang === 'fr' ? 'en' : lang) as Parameters<typeof real.msg>[0], key),
  };
});

const { renderLanguageMenu } = await import('../src/lib/i18n/language-menu');

/** The language codes of one list's entries, in order (two-letter ids only). */
function ids(html: string, prefix: string): string[] {
  return [...html.matchAll(new RegExp(`data-testid="${prefix}-([a-z]{2})"`, 'g'))].map((m) => m[1]);
}

describe('E5 | a third language in LANGUAGES', () => {
  it('appears in both lists, in order, on an English page', () => {
    const html = renderLanguageMenu({ lang: 'en' as never, path: '/events/abc/fair' });
    expect(ids(html, 'language-menu')).toEqual(['en', 'es', 'fr']);
    expect(ids(html, 'site-menu-language')).toEqual(['en', 'es', 'fr']);
    expect(html).toContain('data-testid="language-menu-fr" href="/fr/events/abc/fair">');
    expect(html).toMatch(/lang="fr" hreflang="fr"[^>]*>[\s\S]*?Français<\/a>/);
  });

  it("on the third language's own page, marks it current and links the other two", () => {
    const html = renderLanguageMenu({ lang: 'fr' as never, path: '/events/abc/fair' });
    expect(
      html.match(
        /aria-current="true" lang="fr" data-testid="(language-menu|site-menu-language)-fr"/g
      )?.length
    ).toBe(2);
    expect(html).toContain('data-testid="language-menu-en" href="/events/abc/fair">');
    expect(html).toContain('data-testid="language-menu-es" href="/es/events/abc/fair">');
    expect(html).toMatch(/Anglais<\/a>/);
  });
});
