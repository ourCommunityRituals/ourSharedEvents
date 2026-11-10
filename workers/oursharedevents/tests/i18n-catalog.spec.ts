/**
 * OSE-1760 slice A — the string catalog (src/lib/i18n/catalog.ts).
 *
 * Pure, node-clean. English defines the keys; every language that has declared
 * itself finished must carry all of them. A language still being written may
 * omit keys, and the lookup then falls back to English for that key only.
 *
 * Born-red: delete any one Spanish key and "a finished language carries every
 * key" fails (and the TypeScript build does too); blank a value and "no empty
 * strings" fails.
 */
import { describe, it, expect } from 'vitest';
import { CATALOG, WHAT_TYPES, msg, msgAll, type MessageKey } from '../src/lib/i18n/catalog';
import { LANGUAGES, DEFAULT_LANG, isLang } from '../src/lib/i18n/languages';

// Languages declared complete. A new language is added here once it is finished;
// until then it may be partial and falls back to English per key.
const COMPLETE: readonly string[] = ['en', 'es', 'pl', 'ar'];

const KEYS = Object.keys(CATALOG.en) as MessageKey[];

describe('OSE-1760 catalog | the language list', () => {
  it('has English as the default and first', () => {
    expect(DEFAULT_LANG).toBe('en');
    expect(LANGUAGES[0]).toBe('en');
  });

  it('every listed language has a catalog, and no catalog is unlisted', () => {
    expect(Object.keys(CATALOG).sort()).toEqual([...LANGUAGES].sort());
  });

  it('isLang accepts the listed tags and nothing else', () => {
    expect(isLang('es')).toBe(true);
    expect(isLang('fr')).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(isLang('')).toBe(false);
  });
});

describe('OSE-1760 catalog | completeness', () => {
  for (const lang of LANGUAGES.filter((l) => COMPLETE.includes(l))) {
    it(`a finished language carries every key: ${lang}`, () => {
      const missing = KEYS.filter((k) => CATALOG[lang][k] === undefined);
      expect(missing, `${lang} is missing: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('no empty strings, in any language', () => {
    for (const lang of LANGUAGES) {
      for (const [key, value] of Object.entries(CATALOG[lang])) {
        expect((value ?? '').trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('no language declares a key English does not have', () => {
    for (const lang of LANGUAGES) {
      const extra = Object.keys(CATALOG[lang]).filter((k) => !(k in CATALOG.en));
      expect(extra, `${lang} has unknown keys: ${extra.join(', ')}`).toEqual([]);
    }
  });

  it('every WHAT link type has a label key in every finished language', () => {
    for (const type of WHAT_TYPES) {
      for (const lang of LANGUAGES.filter((l) => COMPLETE.includes(l))) {
        expect(CATALOG[lang][`what.${type}` as MessageKey], `${lang} what.${type}`).toBeTruthy();
      }
    }
  });
});

describe('OSE-1760 catalog | lookup', () => {
  it('returns the language text, and English for English', () => {
    expect(msg('en', 'share.label')).toBe('Share this event');
    expect(msg('es', 'share.label')).toBe('Compartir este evento');
  });

  it('falls back to English for one missing key, and only that key', () => {
    const es = CATALOG.es as Record<string, string | undefined>;
    const saved = es['share.label'];
    try {
      delete es['share.label'];
      expect(msg('es', 'share.label')).toBe(msg('en', 'share.label'));
      expect(msg('es', 'share.copied')).toBe('Enlace copiado');
    } finally {
      es['share.label'] = saved;
    }
  });

  it('msgAll gives every language in LANGUAGES order', () => {
    const all = msgAll('back.label');
    expect(Object.keys(all)).toEqual([...LANGUAGES]);
    expect(all.en).toBe('Back');
    expect(all.es).toBe('Volver');
  });
});
