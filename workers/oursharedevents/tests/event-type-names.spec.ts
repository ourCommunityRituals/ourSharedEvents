/**
 * Category and type names in every page language (lib/i18n/event-type-names.ts).
 *
 * Buckets (migration 0126, owner approval 2026-11-28): the landing row shows the
 * 9 buckets by their short names, so every bucket needs a full and a short name
 * in every language too.
 *
 * Owner, 2026-11-28: "My category cards do not translate to the selected
 * language ... this applies to all selected, available languages." The landing's
 * "Kinds of events" cards printed the registry's English name on every page.
 *
 * Born red: delete any one category or type from any language's table and the
 * completeness tests fail; point landing-area.ts back at `cat.name` and the
 * rendered-cards test fails for every non-English language.
 *
 * The codes and ids are read from the migrations, not copied, so a new category
 * or type added in a migration fails here until every language names it.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  BUCKET_NAMES,
  BUCKET_SHORT_NAMES,
  CATEGORY_NAMES,
  TYPE_NAMES,
  categoryName,
  eventTypeName,
  rowLabel,
} from '../src/lib/i18n/event-type-names';
import { LANGUAGES, type Lang } from '../src/lib/i18n/languages';
import { renderPreEventHtml, type PublicEventRow } from '../src/handlers/pages';
import { renderLandingArea, type LandingAreaItem } from '../src/lib/landing-area';
import type { TypeCategory } from '../src/lib/event-type-catalog';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const sql = (f: string): string => readFileSync(new URL(f, MIGRATIONS), 'utf8');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));

/** category_code → registry display_name, from every migration that seeds the lookup. */
const CATEGORIES = new Map<string, string>();
/** bucket_code → [display_name, short_name], from every migration that seeds the buckets. */
const BUCKETS = new Map<string, [string, string]>();
/** type id → registry name, from every migration that inserts a type. */
const TYPES = new Map<string, string>();
for (const f of files) {
  const text = sql(f);
  if (/INSERT[^;]*INTO\s+event_type_category_registry/i.test(text)) {
    for (const m of text.matchAll(/\('([A-Z]{3})',\s*'([^']+)',\s*\d+\)/g))
      CATEGORIES.set(m[1], m[2]);
  }
  if (/INSERT[^;]*INTO\s+event_type_bucket/i.test(text)) {
    for (const m of text.matchAll(/\('([A-Z]{3})',\s*'([^']+)',\s*'([^']+)',\s*\d+\)/g))
      BUCKETS.set(m[1], [m[2], m[3]]);
  }
  if (/INSERT[^;]*INTO\s+event_type_registry/i.test(text)) {
    for (const m of text.matchAll(/\('(etr-[a-z0-9_-]+)',\s*'[A-Z0-9-]+',\s*'([^']+)'/g)) {
      TYPES.set(m[1], m[2]);
    }
  }
}

describe('what the migrations seed', () => {
  it('finds the 9 buckets, 15 categories and 69 types', () => {
    expect(BUCKETS.size).toBe(9);
    expect(CATEGORIES.size).toBe(15);
    expect(TYPES.size).toBe(69);
  });

  it('English is the registry name itself, so its tables stay empty', () => {
    expect(Object.keys(CATEGORY_NAMES.en)).toEqual([]);
    expect(Object.keys(BUCKET_NAMES.en)).toEqual([]);
    expect(Object.keys(BUCKET_SHORT_NAMES.en)).toEqual([]);
    expect(Object.keys(TYPE_NAMES.en)).toEqual([]);
    expect(rowLabel('en', 'SPT', 'Sports & Recreation', 'Sports & Rec')).toBe('Sports & Rec');
    expect(categoryName('en', 'REC', 'Sports & Recreation')).toBe('Sports & Recreation');
  });
});

const TRANSLATED = LANGUAGES.filter((l) => l !== 'en');

describe.each(TRANSLATED)('every name in %s', (lang) => {
  it('names every bucket, full and short, with nothing extra and nothing blank', () => {
    for (const table of [BUCKET_NAMES[lang], BUCKET_SHORT_NAMES[lang]]) {
      expect(Object.keys(table).sort()).toEqual([...BUCKETS.keys()].sort());
      for (const [code, name] of Object.entries(table)) {
        expect(name.trim(), `${lang} ${code}`).not.toBe('');
      }
    }
    const english = [...BUCKETS].filter(([c, [full]]) => BUCKET_NAMES[lang][c] === full);
    expect(english, `${lang} buckets left in English`).toEqual([]);
  });

  it('names every category, with nothing extra and nothing blank', () => {
    expect(Object.keys(CATEGORY_NAMES[lang]).sort()).toEqual([...CATEGORIES.keys()].sort());
    for (const [code, name] of Object.entries(CATEGORY_NAMES[lang])) {
      expect(name.trim(), `${lang} ${code}`).not.toBe('');
    }
  });

  it('names every type, with nothing extra and nothing blank', () => {
    expect(Object.keys(TYPE_NAMES[lang]).sort()).toEqual([...TYPES.keys()].sort());
    for (const [id, name] of Object.entries(TYPE_NAMES[lang])) {
      expect(name.trim(), `${lang} ${id}`).not.toBe('');
    }
  });

  it('is translated, not English copied over', () => {
    const sameCats = [...CATEGORIES].filter(([c, en]) => CATEGORY_NAMES[lang][c] === en);
    expect(sameCats, `${lang} categories left in English`).toEqual([]);
    // A type may keep a borrowed word (karaoke), so only a third may match.
    const sameTypes = [...TYPES].filter(([t, en]) => TYPE_NAMES[lang][t] === en);
    expect(sameTypes.length).toBeLessThan(TYPES.size / 3);
  });
});

describe('lookups', () => {
  it('the row shows the short bucket name in the page language', () => {
    expect(rowLabel('es', 'BGN', 'Bargains', 'Bargains')).toBe(BUCKET_SHORT_NAMES.es.BGN);
    expect(categoryName('es', 'SPT', 'Sports & Recreation')).toBe(BUCKET_NAMES.es.SPT);
    expect(rowLabel('pl', 'ZZZ', 'Registry name', 'Short')).toBe('Short');
    expect(rowLabel('ar', 'ZZZ', 'Registry name')).toBe('Registry name');
  });

  it('give the page language, and fall back to the registry name for an unknown key', () => {
    expect(categoryName('es', 'REC', 'Sports & Recreation')).toBe('Deportes y recreación');
    expect(categoryName('es', 'ZZZ', 'Registry name')).toBe('Registry name');
    expect(eventTypeName('pl', 'etr-mkt-flea', 'Flea Market')).toBe('Pchli targ');
    expect(eventTypeName('ar', 'etr-none', 'Registry name')).toBe('Registry name');
  });
});

describe('the landing cards use the page language', () => {
  const NOW = Date.parse('2026-11-22T12:00:00Z');
  const cats = new Map<string, TypeCategory>([
    [
      'etr-rec-bocce',
      { code: 'SPT', name: 'Sports & Recreation', short: 'Sports & Rec', order: 0 },
    ],
    ['etr-biz-network', { code: 'LRN', name: 'Learn & Connect', short: 'Learn', order: 6 }],
  ]);
  const ev = (id: string, type: string): LandingAreaItem =>
    ({
      id,
      slug: id,
      name: `Event ${id}`,
      status: 'published',
      starts_at: '2026-11-23T18:00:00Z',
      ends_at: '2026-11-23T20:00:00Z',
      venue: 'Hall',
      event_type_id: type,
    }) as unknown as LandingAreaItem;

  it.each(LANGUAGES)('%s', (lang) => {
    const html = renderLandingArea([ev('a', 'etr-rec-bocce'), ev('b', 'etr-biz-network')], {
      now: NOW,
      typeCategories: cats,
      lang,
    }).html;
    const texts = [...html.matchAll(/<span class="icon-slider-text">([^<]*)<\/span>/g)].map(
      (m) => m[1]
    );
    const esc = (s: string): string => s.replace(/&/g, '&amp;');
    const name = (code: string, en: string): string => BUCKET_SHORT_NAMES[lang][code] ?? en;
    expect(texts).toContain(esc(name('SPT', 'Sports & Rec')));
    expect(texts).toContain(esc(name('LRN', 'Learn')));
    if (lang !== 'en') {
      expect(texts).not.toContain(esc('Sports & Rec'));
      expect(texts).not.toContain(esc('Learn'));
    }
  });
});

describe('the event page type line uses the page language', () => {
  const row = {
    id: 'evt_t',
    brand_id: 'root',
    title: 'ZZTITLE',
    slug: 'zz-title',
    status: 'active',
    description: 'ZZDESCRIPTION',
    location: 'ZZVENUE',
    start_date: '2099-10-24',
    end_date: '2099-10-24',
    timezone: 'America/Chicago',
    starts_at: '2099-10-24T23:00:00Z',
    event_type_id: 'etr-vol-mutual',
    event_type_name: 'Mutual Aid Distribution',
  } as unknown as PublicEventRow;
  const typeLine = (lang: Lang): string => {
    const html = renderPreEventHtml(row, 'https://oursharedevents.com/e/x', undefined, { lang });
    return html.match(/data-testid="event-type">([^<]*)</)?.[1] ?? '';
  };

  it.each(LANGUAGES)('%s', (lang) => {
    const line = typeLine(lang);
    expect(line).toContain(TYPE_NAMES[lang]['etr-vol-mutual'] ?? 'Mutual Aid Distribution');
    if (lang !== 'en') expect(line).not.toContain('Mutual Aid Distribution');
  });
});
