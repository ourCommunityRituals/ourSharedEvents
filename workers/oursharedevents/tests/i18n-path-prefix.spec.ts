/**
 * OSE-1761 slice B — the language in the URL path (src/lib/i18n/path-prefix.ts)
 * and the visible language switch (src/lib/i18n/language-switch.ts).
 *
 * Pure functions, node-clean. The parser decides what is a language prefix; the
 * page matcher decides which pages exist under one. Everything else is left for
 * the router to 404, so these two functions are what keep a prefix away from the
 * admin, API and short-link routes.
 *
 * Born-red: let `parseLangPrefix` accept the default language and "English is
 * never a prefix" fails; let `matchLanguagePage` return `{ kind: 'event' }` for
 * any `/events/...` and "an event's screens are not event pages" fails; take the
 * `lang` attribute off the switch link and "the link carries its own language"
 * fails.
 */
import { describe, it, expect } from 'vitest';
import {
  languageAlternates,
  matchLanguagePage,
  parseLangPrefix,
  withLangPrefix,
} from '../src/lib/i18n/path-prefix';
import { renderLanguageSwitch } from '../src/lib/i18n/language-switch';

describe('OSE-1761 parseLangPrefix | what is a prefix', () => {
  it('splits a supported prefix from the rest of the path', () => {
    expect(parseLangPrefix('/es/events/abc')).toEqual({ lang: 'es', rest: '/events/abc' });
    expect(parseLangPrefix('/es/events/abc/spring-fair')).toEqual({
      lang: 'es',
      rest: '/events/abc/spring-fair',
    });
  });

  it('a bare prefix has the root as its rest', () => {
    expect(parseLangPrefix('/es')).toEqual({ lang: 'es', rest: '/' });
    expect(parseLangPrefix('/es/')).toEqual({ lang: 'es', rest: '/' });
  });

  it('English is the default and is never a prefix', () => {
    expect(parseLangPrefix('/en/events/abc')).toBeNull();
    expect(parseLangPrefix('/en')).toBeNull();
  });

  it('an unsupported or unlisted language is not a prefix', () => {
    expect(parseLangPrefix('/fr/events/abc')).toBeNull();
    expect(parseLangPrefix('/zh-hans/events/abc')).toBeNull();
    expect(parseLangPrefix('/xx/events/abc')).toBeNull();
  });

  it('the tag is matched exactly: lower-case, and a whole path segment', () => {
    expect(parseLangPrefix('/ES/events/abc')).toBeNull();
    expect(parseLangPrefix('/Es/events/abc')).toBeNull();
    expect(parseLangPrefix('/espanol/events/abc')).toBeNull();
    expect(parseLangPrefix('/es-MX/events/abc')).toBeNull();
    expect(parseLangPrefix('/esx')).toBeNull();
  });

  it('a path with no prefix, or not a path, is not a prefix', () => {
    expect(parseLangPrefix('/events/abc')).toBeNull();
    expect(parseLangPrefix('/')).toBeNull();
    expect(parseLangPrefix('')).toBeNull();
    expect(parseLangPrefix('es/events/abc')).toBeNull();
    expect(parseLangPrefix('//es/events/abc')).toBeNull();
  });

  it('a prefix later in the path is not a prefix', () => {
    expect(parseLangPrefix('/events/es/abc')).toBeNull();
    expect(parseLangPrefix('/api/v2/es/events')).toBeNull();
  });

  it('keeps a trailing slash in the rest, for the matcher to refuse', () => {
    expect(parseLangPrefix('/es/events/abc/')).toEqual({ lang: 'es', rest: '/events/abc/' });
  });
});

describe('OSE-1761 withLangPrefix', () => {
  it('prefixes a language other than the default, and leaves English alone', () => {
    expect(withLangPrefix('es', '/events/abc')).toBe('/es/events/abc');
    expect(withLangPrefix('en', '/events/abc')).toBe('/events/abc');
  });

  it('round-trips with the parser', () => {
    const parsed = parseLangPrefix(withLangPrefix('es', '/events/abc/spring'));
    expect(parsed).toEqual({ lang: 'es', rest: '/events/abc/spring' });
  });
});

describe('OSE-1761 matchLanguagePage | the pages that exist under a prefix', () => {
  it('the event page, with or without its readable name', () => {
    expect(matchLanguagePage('/events/abc')).toEqual({ kind: 'event', id: 'abc' });
    expect(matchLanguagePage('/events/abc_12-X/spring-fair')).toEqual({
      kind: 'event',
      id: 'abc_12-X',
      name: 'spring-fair',
    });
  });

  it('the share link', () => {
    expect(matchLanguagePage('/e/K7M2QX')).toEqual({ kind: 'share', code: 'K7M2QX' });
  });

  it('an event’s screens are not event pages', () => {
    for (const screen of ['tv', 'poster', 'register', 'checkin', 'survey', 'updates', 'calendar']) {
      expect(matchLanguagePage(`/events/abc/${screen}`), screen).toBeNull();
    }
    expect(matchLanguagePage('/events/abc/calendar.ics')).toBeNull();
  });

  it('the other short links are not pages under a prefix', () => {
    for (const p of ['/p/K7M2QX', '/r/K7M2QX', '/c/K7M2QX', '/tv/K7M2QX', '/q/token', '/s/code']) {
      expect(matchLanguagePage(p), p).toBeNull();
    }
  });

  it('nothing else is a page under a prefix', () => {
    const others = [
      '/',
      '/events',
      '/events/',
      '/display',
      '/poster',
      '/privacy',
      '/sponsors/abc',
      '/forms/abc',
      '/admin',
      '/api/v2/events',
      '/api/v2/admin/events/abc',
      '/ui.css',
      '/sitemap.xml',
    ];
    for (const p of others) expect(matchLanguagePage(p), p).toBeNull();
  });

  it('refuses a malformed id, a trailing slash and extra segments', () => {
    expect(matchLanguagePage('/events/abc/')).toBeNull();
    expect(matchLanguagePage('/events/a b')).toBeNull();
    expect(matchLanguagePage('/events/abc/def/ghi')).toBeNull();
    expect(matchLanguagePage(`/events/${'a'.repeat(129)}`)).toBeNull();
    expect(matchLanguagePage('/events/abc/Spring')).toBeNull();
    expect(matchLanguagePage('/e/')).toBeNull();
    expect(matchLanguagePage('/e/a/b')).toBeNull();
  });
});

describe('OSE-1761 languageAlternates', () => {
  it('names the page in every language, and the unprefixed address as the default', () => {
    expect(languageAlternates('https://oursharedevents.com', '/events/abc/spring')).toEqual([
      { hreflang: 'en', href: 'https://oursharedevents.com/events/abc/spring' },
      { hreflang: 'es', href: 'https://oursharedevents.com/es/events/abc/spring' },
      { hreflang: 'x-default', href: 'https://oursharedevents.com/events/abc/spring' },
    ]);
  });
});

describe('OSE-1761 renderLanguageSwitch', () => {
  it('on an English page links to Spanish, in Spanish', () => {
    const html = renderLanguageSwitch({ lang: 'en', path: '/events/abc/spring' });
    expect(html).toContain('href="/es/events/abc/spring"');
    expect(html).toContain('>Español</a>');
    expect(html).toContain('aria-label="Language"');
    expect(html).not.toContain('>English</a>');
  });

  it('on a Spanish page links to the unprefixed English page, named in the page language', () => {
    const html = renderLanguageSwitch({ lang: 'es', path: '/events/abc/spring' });
    expect(html).toContain('href="/events/abc/spring"');
    // English, named in Spanish (owner 2026-11-05); the word is Spanish, the target English.
    expect(html).toContain('lang="es" hreflang="en"');
    expect(html).toContain('>Inglés</a>');
    expect(html).not.toContain('>English</a>');
    expect(html).toContain('aria-label="Idioma"');
    expect(html).not.toContain('>Español</a>');
  });

  it('the link carries its own language, for a screen reader and for crawlers', () => {
    const html = renderLanguageSwitch({ lang: 'en', path: '/events/abc' });
    expect(html).toContain('lang="es" hreflang="es"');
  });

  it('is plain markup: no script, no form, no cookie', () => {
    const html = renderLanguageSwitch({ lang: 'en', path: '/events/abc' });
    expect(html).not.toMatch(/<script|<form|<button|onclick|cookie/i);
  });

  it('carries the query it is given, escaped, onto the link', () => {
    const html = renderLanguageSwitch({
      lang: 'en',
      path: '/events/abc',
      query: '?type=checkin&deployment=dep_1',
    });
    expect(html).toContain('href="/es/events/abc?type=checkin&amp;deployment=dep_1"');
  });

  it('escapes a path it is handed, so it can never break out of the attribute', () => {
    const html = renderLanguageSwitch({ lang: 'en', path: '/events/"><script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });
});
