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

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
