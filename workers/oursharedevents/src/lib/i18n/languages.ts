/**
 * The languages the public pages can render (OSE-1760).
 *
 * One list. The `Lang` type comes from it, so a render function never carries
 * its own `'en' | 'es'` union: adding a language is adding it here and adding a
 * catalog for it, with no change to render code.
 *
 * English is the default and the fallback for any key a language has not got.
 * Tags are lower-case, the plain two-letter code where it is unambiguous, and a
 * script or region only where it must be (`zh-hans`, `pt-br`).
 */
export const LANGUAGES = ['en', 'es'] as const;

export type Lang = (typeof LANGUAGES)[number];

export const DEFAULT_LANG: Lang = 'en';

/**
 * Each language's name in that language (OSE-1761). A language switch shows
 * these, so a reader finds their own language whatever the page is in. They are
 * names, not translations, and are not part of the message catalog.
 */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: 'English',
  es: 'Español',
};

/**
 * The locale each language formats dates, times and zone names in. `es-US`, not
 * plain `es`: it keeps the 12-hour clock and the zone abbreviation ("6:00 p.m.
 * CDT") that the English page shows, for an event in a US zone.
 */
export const INTL_LOCALE: Record<Lang, string> = {
  en: 'en-US',
  es: 'es-US',
};

/** The `og:locale` value of a page in each language. */
export const OG_LOCALE: Record<Lang, string> = {
  en: 'en_US',
  es: 'es_US',
};

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
