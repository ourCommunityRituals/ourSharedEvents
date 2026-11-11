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
 *
 * Polish (`pl`, OSE-1957) and Arabic (`ar`, epic OSE-1959) were added
 * 2026-11-10 for Oak Lawn, IL. Arabic is written as Modern Standard Arabic and
 * tagged plain `ar`, not `ar-PS` or `ar-JO`: those switch ICU to Arabic-Indic
 * digits (research note, 2026-11-10).
 */
export const LANGUAGES = ['en', 'es', 'pl', 'ar'] as const;

export type Lang = (typeof LANGUAGES)[number];

export const DEFAULT_LANG: Lang = 'en';

/**
 * The direction each language is written in (epic OSE-1959). A page writes it
 * as `<html dir>`, and its CSS uses logical properties (`inset-inline-start`,
 * `margin-inline-end`), so an `rtl` page lays itself out from the right with no
 * second stylesheet. A new language must state its direction here: the type
 * makes a missing entry a compile error.
 */
export type Direction = 'ltr' | 'rtl';

export const DIRECTION: Record<Lang, Direction> = {
  en: 'ltr',
  es: 'ltr',
  pl: 'ltr',
  ar: 'rtl',
};

/**
 * Each language's name in that language (OSE-1761). A language switch shows
 * these, so a reader finds their own language whatever the page is in. They are
 * names, not translations, and are not part of the message catalog.
 */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: 'English',
  es: 'Español',
  pl: 'Polski',
  ar: 'العربية',
};

/**
 * The locale each language formats dates, times and zone names in. `es-US`, not
 * plain `es`: it keeps the 12-hour clock and the zone abbreviation ("6:00 p.m.
 * CDT") that the English page shows, for an event in a US zone.
 *
 * Polish uses `pl-PL`: the 24-hour clock a Polish reader expects ("18:00").
 * Arabic uses `ar-u-nu-latn`: Arabic month and weekday names with Western
 * digits (0-9), which local readers use on phones and the web. The `nu-latn`
 * is stated, not left to the runtime: an older ICU gives plain `ar` the
 * Arabic-Indic digits. Month-name style is the native reader's call (OSE-1968).
 */
export const INTL_LOCALE: Record<Lang, string> = {
  en: 'en-US',
  es: 'es-US',
  pl: 'pl-PL',
  ar: 'ar-u-nu-latn',
};

/**
 * How an event's time names its zone, by language (OSE-1966). English and
 * Spanish use the abbreviation ("10:00 AM CST", "10:00 a.m. CST"). Arabic has
 * no such abbreviation: `short` gives the offset "غرينتش-6" ("GMT-6"), which an
 * Oak Lawn reader does not say and which sits beside "CST" on the English page.
 * `shortGeneric` names the zone by its city, "10:00 ص توقيت شيكاغو" ("Chicago
 * time"), right for standard and summer time alike. Polish keeps `short` for
 * now ("10:00 GMT-6"); its reader decides (OSE-1968).
 */
export const ZONE_NAME_STYLE: Record<Lang, 'short' | 'shortGeneric'> = {
  en: 'short',
  es: 'short',
  pl: 'short',
  ar: 'shortGeneric',
};

/** The `og:locale` value of a page in each language. */
export const OG_LOCALE: Record<Lang, string> = {
  en: 'en_US',
  es: 'es_US',
  pl: 'pl_PL',
  ar: 'ar_AR',
};

/**
 * What the language switch calls each language, by the page it is on (owner
 * 2026-11-05: on a Spanish page the English link reads "Inglés"). A Spanish
 * page is all Spanish, so it names English in Spanish. An English page names
 * Spanish by its own name, "Español", so a Spanish reader finds it there.
 *
 * The same holds for every page (OSE-1941: no mixed-language page). On a
 * Spanish, Polish or Arabic page every other language is named in that page's
 * language; on the English page each language goes by its own name.
 * MACHINE DRAFT (the pl and ar rows, and the Spanish names of Polish and
 * Arabic): awaiting the native read (OSE-1968).
 */
export const LANGUAGE_SWITCH_NAMES: Record<Lang, Record<Lang, string>> = {
  en: { en: 'English', es: 'Español', pl: 'Polski', ar: 'العربية' },
  es: { en: 'Inglés', es: 'Español', pl: 'Polaco', ar: 'Árabe' },
  pl: { en: 'Angielski', es: 'Hiszpański', pl: 'Polski', ar: 'Arabski' },
  ar: { en: 'الإنجليزية', es: 'الإسبانية', pl: 'البولندية', ar: 'العربية' },
};

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
