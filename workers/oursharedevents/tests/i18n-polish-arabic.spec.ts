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
import type { Lang } from '../src/lib/i18n/languages';
import { CATALOG, fmt, fmtCount, msg, type MessageKey } from '../src/lib/i18n/catalog';
import {
  DIRECTION,
  INTL_LOCALE,
  LANGUAGES,
  LANGUAGE_MARK,
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
  it('is the 22 languages, in the owner’s order (2026-11-28)', () => {
    expect([...LANGUAGES]).toEqual([
      'en',
      'es',
      'zh-hans',
      'zh-hant',
      'hi',
      'ar',
      'pt',
      'bn',
      'ru',
      'ja',
      'fr',
      'de',
      'ur',
      'id',
      'ko',
      'vi',
      'tr',
      'it',
      'tl',
      'pl',
      'uk',
      'fa',
    ]);
    expect(isLang('pl')).toBe(true);
    expect(isLang('ar')).toBe(true);
    expect(isLang('ar-PS')).toBe(false);
    expect(isLang('PL')).toBe(false);
  });

  it('pins the direction, locale, og:locale and own name of each language', () => {
    const RTL = ['ar', 'ur', 'fa'];
    expect(DIRECTION).toEqual(
      Object.fromEntries(LANGUAGES.map((l) => [l, RTL.includes(l) ? 'rtl' : 'ltr']))
    );
    expect(INTL_LOCALE).toEqual({
      en: 'en-US',
      es: 'es-US',
      'zh-hans': 'zh-Hans-CN',
      'zh-hant': 'zh-Hant-TW',
      hi: 'hi-IN',
      ar: 'ar-u-nu-latn',
      pt: 'pt-BR',
      bn: 'bn-BD-u-nu-latn',
      ru: 'ru-RU',
      ja: 'ja-JP',
      fr: 'fr-FR',
      de: 'de-DE',
      ur: 'ur-PK-u-nu-latn',
      id: 'id-ID',
      ko: 'ko-KR',
      vi: 'vi-VN',
      tr: 'tr-TR',
      it: 'it-IT',
      tl: 'fil-PH',
      pl: 'pl-PL',
      uk: 'uk-UA',
      fa: 'fa-IR-u-nu-latn',
    });
    expect(OG_LOCALE).toEqual({
      en: 'en_US',
      es: 'es_US',
      'zh-hans': 'zh_CN',
      'zh-hant': 'zh_TW',
      hi: 'hi_IN',
      ar: 'ar_AR',
      pt: 'pt_BR',
      bn: 'bn_BD',
      ru: 'ru_RU',
      ja: 'ja_JP',
      fr: 'fr_FR',
      de: 'de_DE',
      ur: 'ur_PK',
      id: 'id_ID',
      ko: 'ko_KR',
      vi: 'vi_VN',
      tr: 'tr_TR',
      it: 'it_IT',
      tl: 'tl_PH',
      pl: 'pl_PL',
      uk: 'uk_UA',
      fa: 'fa_IR',
    });
    expect(LANGUAGE_NAMES).toEqual({
      en: 'English',
      es: 'Español',
      'zh-hans': '简体中文',
      'zh-hant': '繁體中文',
      hi: 'हिन्दी',
      ar: 'العربية',
      pt: 'Português',
      bn: 'বাংলা',
      ru: 'Русский',
      ja: '日本語',
      fr: 'Français',
      de: 'Deutsch',
      ur: 'اردو',
      id: 'Bahasa Indonesia',
      ko: '한국어',
      vi: 'Tiếng Việt',
      tr: 'Türkçe',
      it: 'Italiano',
      tl: 'Tagalog',
      pl: 'Polski',
      uk: 'Українська',
      fa: 'فارسی',
    });
  });

  it('names every language the page’s way, and each by its own name on the English page', () => {
    const pick = (row: Lang) => {
      const { en, es, pl, ar } = LANGUAGE_SWITCH_NAMES[row];
      return { en, es, pl, ar };
    };
    expect(pick('en')).toEqual({ en: 'English', es: 'Español', pl: 'Polski', ar: 'العربية' });
    expect(pick('es')).toEqual({ en: 'Inglés', es: 'Español', pl: 'Polaco', ar: 'Árabe' });
    expect(pick('pl')).toEqual({ en: 'Angielski', es: 'Hiszpański', pl: 'Polski', ar: 'Arabski' });
    expect(pick('ar')).toEqual({
      en: 'الإنجليزية',
      es: 'الإسبانية',
      pl: 'البولندية',
      ar: 'العربية',
    });
    // Every page names every language; its own row's diagonal and the English
    // row are the own names; no other cell is empty or an own name copied in.
    expect(LANGUAGE_SWITCH_NAMES.en).toEqual(LANGUAGE_NAMES);
    for (const page of LANGUAGES) {
      expect(Object.keys(LANGUAGE_SWITCH_NAMES[page]).sort(), page).toEqual([...LANGUAGES].sort());
      expect(LANGUAGE_SWITCH_NAMES[page][page], page).toBe(LANGUAGE_NAMES[page]);
      for (const l of LANGUAGES) {
        expect(LANGUAGE_SWITCH_NAMES[page][l].trim(), `${page}.${l}`).not.toBe('');
      }
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
    ['nl,pl;q=0.3', 'pl'],
    ['fr-CA,fr;q=0.9', 'fr'],
    ['zh-Hant', 'zh-hant'],
    ['zh-TW,zh;q=0.9', 'zh-hant'],
    ['zh-HK', 'zh-hant'],
    ['zh-CN,zh;q=0.9', 'zh-hans'],
    ['zh', 'zh-hans'],
    ['fil-PH', 'tl'],
    ['pt-PT', 'pt'],
    ['ar;q=0', 'en'],
    ['he,fa', 'fa'],
    ['he,sw', 'en'],
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

// Words that are the same as the English, by language: a unit, a slot pair,
// or a word the language borrowed. Anything else the same is English left over.
const SAME_AS_ENGLISH: Partial<Record<Lang, MessageKey[]>> = {
  es: ['err.status', 'map.miles', 'map.openNamed'],
  hi: ['map.openNamed'],
  pt: ['map.miles'],
  bn: ['map.openNamed'],
  fr: ['countdown.minute', 'countdown.minutes', 'map.miles'],
  de: ['map.openNamed'],
  ko: ['map.openNamed'],
  it: ['map.miles', 'map.openNamed'],
  pl: ['menu.label', 'mode.online', 'area.online', 'provenance.demoChip'],
};

describe('every catalog but English', () => {
  const KEYS = Object.keys(CATALOG.en) as MessageKey[];
  const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const lang of LANGUAGES.filter((l) => l !== 'en')) {
    it(`${lang} has every key, none empty, none left in English`, () => {
      const missing = KEYS.filter((k) => !CATALOG[lang][k]?.trim());
      expect(missing).toEqual([]);
      const same = KEYS.filter((k) => CATALOG[lang][k] === CATALOG.en[k]);
      expect(same).toEqual(SAME_AS_ENGLISH[lang] ?? []);
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
        // The language's own plural rule picks the form (French says "0 événement").
        const one = new Intl.PluralRules(INTL_LOCALE[lang]).select(n) === 'one';
        expect(text).toBe(fmt(lang, one ? keys.one : keys.other, { n }));
      }
    });
  }

  for (const rtl of ['ar', 'ur', 'fa'] as const) {
    it(`${rtl}: arrows point the reading way: on is ←, back is →`, () => {
      for (const k of KEYS) {
        const en = CATALOG.en[k] as string;
        const ar = CATALOG[rtl][k] as string;
        if (/→|&rarr;/.test(en)) expect(ar, k).toMatch(/←|&larr;/);
        if (/&larr;/.test(en)) expect(ar, k).toMatch(/&rarr;/);
        expect(ar, k).not.toMatch(/→/);
      }
    });

    it(`${rtl}: no Latin letters but the names it must keep`, () => {
      // OSE-1850: a product name (Google Calendar), the PCI DSS standard's name
      // (owner 2026-11-28, the privacy notice), and the example address in an
      // email field's placeholder, which is Latin by the nature of an address.
      // Markup, slots and entities are allowed too. Each Latin word must sit
      // inside one of these; the check lists the words that do not (nothing is
      // stripped from the text, it is only read).
      const NAMES =
        /OurSharedEvents|Cloudflare Access|Apple|Outlook|Google|PCI DSS|\b[a-z]+@example\.com\b|<[^>]+>|\{\w+\}|&\w+;/g;
      const latinOutsideNames = (text: string): string[] => {
        const allowed = [...text.matchAll(NAMES)].map((m) => [m.index, m.index + m[0].length]);
        return [...text.matchAll(/[A-Za-z]+/g)]
          .filter((w) => !allowed.some(([a, b]) => w.index >= a && w.index + w[0].length <= b))
          .map((w) => w[0]);
      };
      for (const k of KEYS) {
        expect(latinOutsideNames(CATALOG[rtl][k] as string), `${rtl}.${k}`).toEqual([]);
      }
    });
  }

  it('every translated catalog is marked as a machine draft awaiting a native read (OSE-1968)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of LANGUAGES.filter((l) => l !== 'en' && l !== 'es').map(
      (l) => `catalog-${l}.ts`
    )) {
      const src = readFileSync(new URL(`../src/lib/i18n/${f}`, import.meta.url), 'utf8');
      expect(src, f).toMatch(/MACHINE DRAFT/);
      expect(src, f).toMatch(/OSE-1968/);
    }
  });
});

describe('the picture beside each language name (owner 2026-11-28)', () => {
  it('is one country flag per language, or a letter badge for Arabic, Russian and Persian', () => {
    const flag = (country: string) => ({ kind: 'flag', country });
    const badge = (letters: string) => ({ kind: 'badge', letters });
    expect(LANGUAGE_MARK).toEqual({
      en: flag('us'),
      es: flag('mx'),
      'zh-hans': flag('cn'),
      'zh-hant': flag('tw'),
      hi: flag('in'),
      ar: badge('AR'),
      pt: flag('br'),
      bn: flag('bd'),
      ru: badge('RU'),
      ja: flag('jp'),
      fr: flag('fr'),
      de: flag('de'),
      ur: flag('pk'),
      id: flag('id'),
      ko: flag('kr'),
      vi: flag('vn'),
      tr: flag('tr'),
      it: flag('it'),
      tl: flag('ph'),
      pl: flag('pl'),
      uk: flag('ua'),
      fa: badge('FA'),
    });
  });
});
