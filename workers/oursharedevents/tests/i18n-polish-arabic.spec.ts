/**
 * Polish (OSE-1957) and Arabic (epic OSE-1959): the language list, the values
 * the owner's research chose, the address prefix, header negotiation, the
 * `{{dir}}` slot, `<bdi>` isolation and the catalogs.
 *
 * The values are written out here on purpose. A test that read them from
 * languages.ts would agree with any mistake in it; these pin what was decided
 * (research note 2026-11-10: plain `ar`, `ar-u-nu-latn` for Western digits,
 * `ar_AR`, the name "العربية", no flags; Polish `pl-PL`, "Polski").
 *
 * Born red: change any value in languages.ts, drop `pl` or `ar` from the
 * prefix parser, make isolateTyped wrap on an ltr page or skip an rtl one,
 * fill `{{dir}}` with a constant, or drop a `{slot}` from one catalog value,
 * and a case here fails.
 */
import { describe, it, expect } from 'vitest';
import { CATALOG, fmt, fmtCount, msg, type MessageKey } from '../src/lib/i18n/catalog';
import {
  DIRECTION,
  INTL_LOCALE,
  LANGUAGES,
  LANGUAGE_NAMES,
  LANGUAGE_SWITCH_NAMES,
  OG_LOCALE,
  isLang,
} from '../src/lib/i18n/languages';
import { matchLanguagePage, parseLangPrefix, withLangPrefix } from '../src/lib/i18n/path-prefix';
import { resolveLanguage } from '../src/lib/i18n/resolve-language';
import { fillTemplate } from '../src/lib/i18n/template';
import { isolateTyped } from '../src/lib/i18n/bidi';
import { renderLanguageSwitch } from '../src/lib/i18n/language-switch';
import { formatHumanDate } from '../src/lib/event-datetime';

describe('the language list and the chosen values', () => {
  it('is English, Spanish, Polish, Arabic, in that order', () => {
    expect([...LANGUAGES]).toEqual(['en', 'es', 'pl', 'ar']);
    expect(isLang('pl')).toBe(true);
    expect(isLang('ar')).toBe(true);
    expect(isLang('ar-PS')).toBe(false);
    expect(isLang('PL')).toBe(false);
  });

  it('pins the direction, locale, og:locale and own name of each language', () => {
    expect(DIRECTION).toEqual({ en: 'ltr', es: 'ltr', pl: 'ltr', ar: 'rtl' });
    expect(INTL_LOCALE).toEqual({ en: 'en-US', es: 'es-US', pl: 'pl-PL', ar: 'ar-u-nu-latn' });
    expect(OG_LOCALE).toEqual({ en: 'en_US', es: 'es_US', pl: 'pl_PL', ar: 'ar_AR' });
    expect(LANGUAGE_NAMES).toEqual({ en: 'English', es: 'Español', pl: 'Polski', ar: 'العربية' });
  });

  it('names every language the page’s way, and each by its own name on the English page', () => {
    expect(LANGUAGE_SWITCH_NAMES).toEqual({
      en: { en: 'English', es: 'Español', pl: 'Polski', ar: 'العربية' },
      es: { en: 'Inglés', es: 'Español', pl: 'Polaco', ar: 'Árabe' },
      pl: { en: 'Angielski', es: 'Hiszpański', pl: 'Polski', ar: 'Arabski' },
      ar: { en: 'الإنجليزية', es: 'الإسبانية', pl: 'البولندية', ar: 'العربية' },
    });
    for (const lang of LANGUAGES) {
      expect(LANGUAGE_SWITCH_NAMES[lang][lang], lang).toBe(LANGUAGE_NAMES[lang]);
    }
  });

  it('the footer switch marks a page-language name with the page’s lang, an own name with its own', () => {
    const html = renderLanguageSwitch({ lang: 'ar', path: '/events' });
    expect(html).toContain(
      '<a lang="ar" hreflang="en" data-testid="language-switch-en" href="/events">الإنجليزية</a>'
    );
    expect(html).toContain('href="/pl/events">البولندية</a>');
    const en = renderLanguageSwitch({ lang: 'en', path: '/events' });
    expect(en).toContain(
      '<a lang="ar" hreflang="ar" data-testid="language-switch-ar" href="/ar/events">العربية</a>'
    );
    expect(en).toContain(
      '<a lang="pl" hreflang="pl" data-testid="language-switch-pl" href="/pl/events">Polski</a>'
    );
  });
});

describe('Arabic dates: Western digits, Arabic months (research note §3)', () => {
  it('formats with 0-9, never ٠-٩, and an Arabic month name', () => {
    const at = new Date('2026-11-14T00:00:00Z');
    const text = new Intl.DateTimeFormat(INTL_LOCALE.ar, {
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Chicago',
    }).format(at);
    expect(text).toBe('13 نوفمبر');
    expect(new Intl.NumberFormat(INTL_LOCALE.ar).format(1234.5)).toBe('1,234.5');
  });

  it('the event date line reads in Arabic on an Arabic page, in Polish on a Polish one', () => {
    const ar = formatHumanDate('2026-10-24', 'ar');
    const pl = formatHumanDate('2026-10-24', 'pl');
    expect(ar).toMatch(/أكتوبر/);
    expect(ar).not.toMatch(/[٠-٩]/);
    expect(pl).toMatch(/października/);
  });
});

describe('the address prefix', () => {
  it('takes /pl and /ar, whole segments, lower case only', () => {
    expect(parseLangPrefix('/pl/events/abc')).toEqual({ lang: 'pl', rest: '/events/abc' });
    expect(parseLangPrefix('/ar/')).toEqual({ lang: 'ar', rest: '/' });
    expect(parseLangPrefix('/ar')).toEqual({ lang: 'ar', rest: '/' });
    expect(parseLangPrefix('/PL/events')).toBeNull();
    expect(parseLangPrefix('/ara/events')).toBeNull();
    expect(parseLangPrefix('/ar-PS/events')).toBeNull();
    expect(parseLangPrefix('/en/events')).toBeNull();
    expect(parseLangPrefix('/xx/events')).toBeNull();
  });

  it('writes /pl and /ar prefixes and leaves English bare', () => {
    expect(withLangPrefix('pl', '/events')).toBe('/pl/events');
    expect(withLangPrefix('ar', '/')).toBe('/ar/');
    expect(withLangPrefix('en', '/events')).toBe('/events');
  });

  it('an Arabic prefix reaches only a page on the layer', () => {
    const rest = parseLangPrefix('/ar/events/abc/spring')?.rest ?? '';
    expect(matchLanguagePage(rest)).toEqual({ kind: 'event', id: 'abc', name: 'spring' });
    expect(matchLanguagePage(parseLangPrefix('/ar/admin')?.rest ?? '')).toBeNull();
    expect(matchLanguagePage(parseLangPrefix('/pl/events/abc/poster')?.rest ?? '')).toBeNull();
  });
});

describe('Accept-Language', () => {
  it.each([
    ['pl', 'pl'],
    ['pl-PL,pl;q=0.9,en;q=0.5', 'pl'],
    ['ar', 'ar'],
    ['ar-PS', 'ar'],
    ['ar-JO,ar;q=0.9,en;q=0.8', 'ar'],
    ['en;q=0.5,ar;q=0.9', 'ar'],
    ['fr,pl;q=0.3', 'pl'],
    ['ar;q=0', 'en'],
    ['he,fa', 'en'],
  ] as const)('%s -> %s', (header, lang) => {
    expect(resolveLanguage(header)).toBe(lang);
  });
});

describe('the {{dir}} slot', () => {
  it('fills the direction of the page language', () => {
    const shell = '<html lang="{{lang}}" dir="{{dir}}">';
    expect(fillTemplate(shell, 'ar')).toBe('<html lang="ar" dir="rtl">');
    expect(fillTemplate(shell, 'pl')).toBe('<html lang="pl" dir="ltr">');
    expect(fillTemplate(shell, 'en')).toBe('<html lang="en" dir="ltr">');
  });

  it('fills the folder of each new language', () => {
    expect(fillTemplate('href="/{{langdir}}events"', 'ar')).toBe('href="/ar/events"');
    expect(fillTemplate('href="/{{langdir}}events"', 'pl')).toBe('href="/pl/events"');
  });
});

describe('isolateTyped (<bdi>)', () => {
  it('wraps typed text on a right-to-left page', () => {
    expect(isolateTyped('ar', 'Bocce Night #3!')).toBe('<bdi>Bocce Night #3!</bdi>');
  });

  it('leaves a left-to-right page byte for byte as it was', () => {
    for (const lang of ['en', 'es', 'pl'] as const) {
      expect(isolateTyped(lang, 'Bocce Night #3!')).toBe('Bocce Night #3!');
    }
  });

  it('adds nothing for empty text, and never unescapes', () => {
    expect(isolateTyped('ar', '')).toBe('');
    expect(isolateTyped('ar', '&lt;script&gt;')).toBe('<bdi>&lt;script&gt;</bdi>');
  });
});

describe('the Polish and Arabic catalogs', () => {
  const KEYS = Object.keys(CATALOG.en) as MessageKey[];
  const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const lang of ['pl', 'ar'] as const) {
    it(`${lang} has every key, none empty, none left in English`, () => {
      const missing = KEYS.filter((k) => !CATALOG[lang][k]?.trim());
      expect(missing).toEqual([]);
      const same = KEYS.filter((k) => CATALOG[lang][k] === CATALOG.en[k]);
      // Words that are the same in Polish and English; nothing in Arabic.
      expect(same).toEqual(
        lang === 'pl' ? ['menu.label', 'area.online', 'provenance.demoChip'] : []
      );
    });

    it(`${lang} keeps every {slot} of the English, no more, no fewer`, () => {
      for (const k of KEYS) {
        expect(slots(CATALOG[lang][k] as string), `${lang}.${k}`).toEqual(
          slots(CATALOG.en[k] as string)
        );
      }
    });

    it(`${lang} keeps the never-who link to the event list`, () => {
      expect(msg(lang, 'neverWho.landing')).toContain(
        '<a href="{events}" data-testid="privacy-more">'
      );
    });

    it(`${lang} counts read right for 1 and for any other number`, () => {
      const keys = { one: 'when.all.countOne', other: 'when.all.count' } as const;
      for (const n of [0, 1, 2, 5, 11, 22, 100]) {
        const text = fmtCount(lang, n, keys);
        expect(text, `${lang} ${n}`).toContain(String(n));
        expect(text).toBe(fmt(lang, n === 1 ? keys.one : keys.other, { n }));
      }
    });
  }

  it('Arabic arrows point the reading way: on is ←, back is →', () => {
    for (const k of KEYS) {
      const en = CATALOG.en[k] as string;
      const ar = CATALOG.ar[k] as string;
      if (/→|&rarr;/.test(en)) expect(ar, k).toMatch(/←|&larr;/);
      if (/&larr;/.test(en)) expect(ar, k).toMatch(/&rarr;/);
      expect(ar, k).not.toMatch(/→/);
    }
  });

  it('Arabic has no Latin letters but the names it must keep', () => {
    // OSE-1850: a product name (Google Calendar) and the example address in an
    // email field's placeholder, which is Latin by the nature of an address.
    // Markup, slots and entities are allowed too. Each Latin word must sit
    // inside one of these; the check lists the words that do not (nothing is
    // stripped from the text, it is only read).
    const NAMES =
      /OurSharedEvents|Cloudflare Access|Apple|Outlook|Google|\b[a-z]+@example\.com\b|<[^>]+>|\{\w+\}|&\w+;/g;
    const latinOutsideNames = (text: string): string[] => {
      const allowed = [...text.matchAll(NAMES)].map((m) => [m.index, m.index + m[0].length]);
      return [...text.matchAll(/[A-Za-z]+/g)]
        .filter((w) => !allowed.some(([a, b]) => w.index >= a && w.index + w[0].length <= b))
        .map((w) => w[0]);
    };
    for (const k of KEYS) {
      expect(latinOutsideNames(CATALOG.ar[k] as string), k).toEqual([]);
    }
  });

  it('both are marked as machine drafts awaiting a native read (OSE-1968)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['catalog-pl.ts', 'catalog-ar.ts']) {
      const src = readFileSync(new URL(`../src/lib/i18n/${f}`, import.meta.url), 'utf8');
      expect(src, f).toMatch(/MACHINE DRAFT/);
      expect(src, f).toMatch(/OSE-1968/);
    }
  });
});
