/**
 * OSE-1760 slice A — the Accept-Language resolver (src/lib/i18n/resolve-language.ts).
 *
 * Pure function, node-clean. It replaces `preferredLang()`, which read only the
 * first token of the header and ignored quality values. The table below keeps
 * every ordinary header the old code got right, and pins the cases it got wrong.
 *
 * Born-red: take the sort out of `parse()` and "quality value, not position"
 * fails; drop the `q <= 0` check and "q=0 is not acceptable" fails; drop the
 * length and entry caps and the two bound tests fail.
 */
import { describe, it, expect } from 'vitest';
import { resolveLanguage } from '../src/lib/i18n/resolve-language';

// The previous implementation, kept here only to prove the ordinary headers
// resolve exactly as they did before this change.
function oldPreferredLang(al: string): 'en' | 'es' {
  return /^es\b/i.test(al.split(',')[0].trim()) ? 'es' : 'en';
}

describe('OSE-1760 resolveLanguage | ordinary headers resolve as they always did', () => {
  const ordinary = [
    'en',
    'en-US,en;q=0.9',
    'en-GB,en;q=0.9,es;q=0.8',
    'es',
    'es-MX',
    'es-ES,es;q=0.9,en;q=0.8',
    'es-419,es;q=0.9,en;q=0.5',
    'ES',
    'fr-FR,fr;q=0.9',
    '',
  ];
  for (const header of ordinary) {
    it(`"${header}" matches the old result`, () => {
      expect(resolveLanguage(header)).toBe(oldPreferredLang(header));
    });
  }
});

describe('OSE-1760 resolveLanguage | what it does better', () => {
  it('quality value, not position, decides', () => {
    expect(resolveLanguage('en;q=0.5, es;q=0.9')).toBe('es');
    expect(resolveLanguage('es;q=0.5, en;q=0.9')).toBe('en');
  });

  it('the best language we render wins, even when it is not listed first', () => {
    expect(resolveLanguage('fr, es;q=0.5')).toBe('es');
    expect(oldPreferredLang('fr, es;q=0.5')).toBe('en'); // the old behavior, for the record
  });

  it('a tie keeps the order the browser listed', () => {
    expect(resolveLanguage('es, en')).toBe('es');
    expect(resolveLanguage('en, es')).toBe('en');
  });

  it('a regional tag matches its base language, case-insensitively', () => {
    expect(resolveLanguage('es-MX')).toBe('es');
    expect(resolveLanguage('ES-mx')).toBe('es');
    expect(resolveLanguage('es-419')).toBe('es');
    expect(resolveLanguage('en-AU')).toBe('en');
  });

  it('q=0 means not acceptable', () => {
    expect(resolveLanguage('es;q=0')).toBe('en');
    expect(resolveLanguage('es;q=0, en')).toBe('en');
  });

  it('a language we do not render, or a wildcard, falls back to English', () => {
    expect(resolveLanguage('fr, de')).toBe('en');
    expect(resolveLanguage('*')).toBe('en');
    expect(resolveLanguage('esperanto')).toBe('en'); // not Spanish
  });

  it('an invalid q value skips that entry, it does not count as top priority', () => {
    expect(resolveLanguage('es;q=abc')).toBe('en');
    expect(resolveLanguage('es;q=')).toBe('en');
    expect(resolveLanguage('es;q=2')).toBe('en');
    expect(resolveLanguage('es;q=abc, en;q=0.5')).toBe('en');
    expect(resolveLanguage('fr;q=abc, es;q=0.1')).toBe('es');
  });

  it('no header falls back to English', () => {
    expect(resolveLanguage(undefined)).toBe('en');
    expect(resolveLanguage(null)).toBe('en');
    expect(resolveLanguage('')).toBe('en');
  });
});

describe('OSE-1760 resolveLanguage | untrusted input never throws and is bounded', () => {
  const malformed = [
    ';;;',
    ',,,',
    'es;q=abc',
    'es;q=2',
    'es;q=-1',
    'es;q=',
    ';q=0.9',
    '=',
    'es;q=0.5;q=0.9',
    '\u0000\u0001es',
    '😀',
  ];
  for (const header of malformed) {
    it(`does not throw on ${JSON.stringify(header)}`, () => {
      expect(() => resolveLanguage(header)).not.toThrow();
      expect(['en', 'es']).toContain(resolveLanguage(header));
    });
  }

  it('ignores a language placed past the first 512 characters', () => {
    expect(resolveLanguage(`${'x'.repeat(600)},es`)).toBe('en');
  });

  it('ignores a language placed past the 32nd entry', () => {
    const entries = Array.from({ length: 40 }, (_, i) => `x${i};q=0.5`);
    entries.splice(33, 0, 'es;q=0.5');
    expect(resolveLanguage(entries.join(','))).toBe('en');
  });

  it('a 100 KB header is read quickly and safely', () => {
    const t = Date.now();
    expect(resolveLanguage('es,'.repeat(50_000))).toBe('es');
    expect(Date.now() - t).toBeLessThan(250);
  });
});
