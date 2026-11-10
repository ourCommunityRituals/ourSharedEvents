/**
 * Part of OSE-1762 — /es/events and /es/ show no English of ours.
 *
 * Renders the Spanish event list and landing in every state (each window, a
 * search, a place, a zip, every empty and error state, the map leading and the
 * example map) and fails if any English we wrote is left. Modelled on
 * event-page-spanish.spec.ts, and stricter in one way: it also reads the
 * placeholder and the meta description, and the landing's location script.
 *
 * Organizer-entered text shows as typed, so every organizer field here is a ZZ
 * sentinel and is taken out before the check (helpers/list-landing-rows.ts).
 * So are names: the product, the sign-in service, and place names (a town the
 * map names an area by, a place a visitor searched for). The language switch
 * says "Inglés" on a Spanish page, so "English" is not excused.
 *
 * Two checks, so a new hard-coded string is caught as well as an old one:
 *   1. no English value from the catalog (a Spanish value left in English is
 *      caught too, unless its key is listed in SAME_IN_BOTH);
 *   2. no common English word ("the", "of", "your", ...).
 *
 * Born red: put any one English literal back in a render (or drop one Spanish
 * catalog value) and a test below fails, naming the page and the text.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { CATALOG, type MessageKey } from '../src/lib/i18n/catalog';
import { FEW, MANY, NOW, sentinel } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false }));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => {
      if (state.fail) throw new Error('read failed');
      return { data: state.rows, source: 'live', cacheAge: null };
    },
  }),
}));
// Category names per language are OSE-1764; until then each is a sentinel here.
vi.mock('../src/lib/event-type-catalog-read', async () => {
  const { goldenCatalog } = await import('./helpers/list-landing-rows');
  const names = { REC: 'ZZCATREC', ENT: 'ZZCATENT', MKT: 'ZZCATMKT', LIT: 'ZZCATLIT' };
  return { readEventTypeCatalog: async () => goldenCatalog(names) };
});
vi.mock('../src/lib/sponsor-titles', async () => {
  const { SPONSORED_EVENT } = await import('./helpers/list-landing-rows');
  return { fetchSponsorTitles: async () => new Map([[SPONSORED_EVENT, 'ZZSPONSOR']]) };
});

import { handlePublicPage, handleLandingPage } from '../src/handlers/pages';

/** Names, not English prose: they read the same on a Spanish page. */
// GeoNames and its licence, CC BY 4.0, are credited by name under the town box.
const NAMES = [
  'OurSharedEvents',
  'Cloudflare Access',
  'GeoNames',
  'CC BY 4.0',
  'Blue Island',
  'Oak Lawn',
  'Chicago',
];

/** The text a reader sees or hears: element text plus the attributes read aloud or shown. */
function readerText(html: string): string {
  const body = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?--!?>/g, ' ');
  const attrs = [...body.matchAll(/\s(?:alt|aria-label|title|placeholder)="([^"]*)"/g)].map(
    (m) => m[1]
  );
  const description = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '';
  let text = [title, description, body.replace(/<[^>]+>/g, ' '), ...attrs].join(' \n ');
  text = text.replace(/\bzz\w*/gi, ' ');
  for (const name of NAMES) text = text.split(name).join(' ');
  return text.replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ').replace(/\s+/g, ' ');
}

/**
 * Keys whose Spanish may be the same as the English (a name, a symbol). Empty
 * today. A key left out of this list that has the same text in both languages
 * is a Spanish value still in English, and is caught below.
 */
const SAME_IN_BOTH: readonly MessageKey[] = [];

/** Each English catalog value, cut at its `{slots}`. */
function englishFragments(): { key: MessageKey; fragment: string }[] {
  const out: { key: MessageKey; fragment: string }[] = [];
  for (const key of Object.keys(CATALOG.en) as MessageKey[]) {
    if (SAME_IN_BOTH.includes(key)) continue;
    const en = CATALOG.en[key] as string;
    for (const part of en.replace(/<[^>]+>/g, ' ').split(/\{\w+\}/)) {
      let fragment = part
        .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
        .replace(/[→▶“”]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      for (const name of NAMES) fragment = fragment.split(name).join(' ').trim();
      if (fragment.length >= 3) out.push({ key, fragment });
    }
  }
  return out;
}

const ENGLISH_WORDS = [
  'the',
  'of',
  'and',
  'this',
  'that',
  'your',
  'you',
  'at',
  'by',
  'with',
  'is',
  'are',
  'was',
  'were',
  'for',
  'on',
  'from',
  'here',
  'now',
  'more',
  'next',
  'what',
  'where',
  'who',
  'how',
  'why',
  'event',
  'events',
  'live',
  'register',
  'search',
  'clear',
  'nothing',
  'yet',
  'near',
  'zip',
  'map',
  'list',
  'all',
  'online',
  'type',
  'wrapped',
  'upcoming',
  'sign',
  'location',
  'sponsors',
  'privacy',
  'english',
];

function englishLeft(text: string): string[] {
  const found: string[] = [];
  for (const { key, fragment } of englishFragments()) {
    const re = new RegExp(
      `(^|[^\\p{L}])${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`,
      'u'
    );
    if (re.test(text)) found.push(`catalog ${key}: "${fragment}"`);
  }
  for (const word of ENGLISH_WORDS) {
    if (new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, 'iu').test(text))
      found.push(`word: "${word}"`);
  }
  return found;
}

const ROWS = sentinel(MANY);
const FEW_ROWS = sentinel(FEW);

type Page = { name: string; html: () => Promise<string> };

async function events(query: string, rows: Record<string, unknown>[], lang: 'en' | 'es' = 'es') {
  state.rows = rows;
  const prefix = lang === 'es' ? '/es' : '';
  const request = new Request(`https://oursharedevents.com${prefix}/events${query}`);
  const res = await handlePublicPage({} as never, null, request, lang === 'es' ? 'es' : undefined);
  return res.text();
}

async function landing(query: string, rows: Record<string, unknown>[], lang: 'en' | 'es' = 'es') {
  state.rows = rows;
  const prefix = lang === 'es' ? '/es' : '';
  const request = new Request(`https://oursharedevents.com${prefix}/${query}`);
  const res = await handleLandingPage({} as never, null, request, lang === 'es' ? 'es' : undefined);
  return res.text();
}

const PAGES: Page[] = [
  ...[
    '',
    '?when=today',
    '?when=weekend',
    '?when=week',
    '?when=month',
    '?when=next-month',
    '?when=next-90',
    '?when=past',
    '?q=zzquery',
    '?when=month&q=zzquery',
    '?q=Blue+Island',
    '?q=Oak+Lawn',
    '?q=60643',
  ].map((q) => ({ name: `/es/events${q}`, html: () => events(q, ROWS) })),
  { name: '/es/events, a search that matches', html: () => events('?q=zztitle01', ROWS) },
  { name: '/es/events, an empty window', html: () => events('?when=today', FEW_ROWS) },
  { name: '/es/events, only wrapped', html: () => events('', [ROWS[11]]) },
  { name: '/es/events, no events', html: () => events('', []) },
  {
    name: '/es/events, the read failed',
    html: async () => {
      state.fail = true;
      try {
        return await events('', ROWS);
      } finally {
        state.fail = false;
      }
    },
  },
  { name: '/es/, the map leads', html: () => landing('', ROWS) },
  { name: '/es/, the list leads, example map', html: () => landing('', FEW_ROWS) },
  { name: '/es/, no events', html: () => landing('', []) },
  { name: '/es/, a zip with events', html: () => landing('?zip=60406', ROWS) },
  { name: '/es/, a zip with nothing near', html: () => landing('?zip=60453', ROWS) },
  { name: '/es/, a zip we do not know', html: () => landing('?zip=00000', ROWS) },
  // The town box (#1118): one town, one with nothing, a name that is many
  // places (with and without events), and a name that is no place.
  { name: '/es/, a town', html: () => landing('?where=Blue+Island', ROWS) },
  { name: '/es/, a town with nothing', html: () => landing('?where=Oak+Lawn', ROWS) },
  { name: '/es/, a name that is many places', html: () => landing('?where=Beverly', ROWS) },
  { name: '/es/, many places with nothing', html: () => landing('?where=Springfield', ROWS) },
  { name: '/es/, a place we do not know', html: () => landing('?where=Nowhereville', ROWS) },
  { name: '/es/, no US zip', html: () => landing('?nozip=1', ROWS) },
];

describe('Spanish /events and landing | no English of ours', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('the checks can fail: the English pages are caught', async () => {
    const list = englishLeft(readerText(await events('', ROWS, 'en')));
    expect(list).toContain('catalog when.all.chip: "Everything"');
    expect(list).toContain('word: "the"');
    const home = englishLeft(readerText(await landing('', ROWS, 'en')));
    expect(home).toContain('catalog landing.nearMe: "Use my location"');
  });

  for (const page of PAGES) {
    it(`${page.name}: every word of ours is Spanish`, async () => {
      const html = await page.html();
      expect(html).toContain('<html lang="es"');
      expect(html, 'an unfilled page slot').not.toMatch(/\{\{|\{[a-z]+\}/);
      expect(englishLeft(readerText(html))).toEqual([]);
    });
  }

  it('the landing location script speaks Spanish', async () => {
    const html = await landing('', ROWS);
    expect(html).toContain("note.textContent = 'La ubicación está desactivada.");
    expect(html).toContain("note.textContent = 'Buscando tu código postal…'");
    expect(html).not.toContain('Location is off');
    expect(html).not.toContain('Finding your zip');
  });

  /**
   * Every link of ours stays in Spanish, but for the pages not on the language
   * layer yet: sign-in (admin), the privacy page, and an event's registration
   * form (forms are surface 4 of OSE-1762). The language switch's link to the
   * English page, and the head's alternate link to it, lead to English on purpose.
   */
  function englishLinks(html: string): string[] {
    const hrefs = [...html.matchAll(/<(?:a|link)\b([^>]*)>/g)]
      .map((m) => m[1])
      // A language link (switch, menu, alternate) leads to another language on
      // purpose; only a link with no hreflang, or to Spanish, must stay Spanish.
      .filter((attrs) => !/\shreflang="(?!es")[^"]*"/.test(attrs))
      .map((attrs) => /\shref="([^"]*)"/.exec(attrs)?.[1])
      .filter((h): h is string => h !== undefined);
    return hrefs
      .filter((h) => h.startsWith('/') && !h.startsWith('//'))
      .filter((h) => !/^\/(es\/|es$|es\?|ui\.css|admin|privacy)/.test(h))
      .filter((h) => !/^\/events\/[^/]+\/register$/.test(h));
  }

  it('the cards read their dates in Spanish and link to the Spanish pages', async () => {
    const html = await events('', ROWS);
    expect(html).toContain('viernes, 23 de octubre de 2026');
    expect(html).toContain('href="/es/events/evt_g01/golden-1"');
    expect(englishLinks(html)).toEqual([]);
  });

  it('every link on the Spanish landing stays in Spanish', async () => {
    for (const q of ['', '?zip=60406', '?zip=60453']) {
      expect(englishLinks(await landing(q, q ? ROWS : FEW_ROWS)), q).toEqual([]);
    }
    expect(englishLinks(await landing('', ROWS))).toEqual([]);
  });

  it('every link on the Spanish list stays in Spanish, in every state', async () => {
    for (const q of ['?when=today', '?q=zzquery', '?q=Oak+Lawn', '?when=past']) {
      expect(englishLinks(await events(q, ROWS)), q).toEqual([]);
    }
  });

  it('the language switch names English in Spanish and keeps the filters', async () => {
    const list = await events('?when=weekend&q=zzquery', ROWS);
    expect(list).toContain(
      '<a lang="es" hreflang="en" data-testid="language-switch-en" href="/events?when=weekend&amp;q=zzquery">Inglés</a>'
    );
    expect(list).toContain('aria-label="Idioma"');
    const home = await landing('?zip=60406', ROWS);
    expect(home).toContain(
      '<a lang="es" hreflang="en" data-testid="language-switch-en" href="/?zip=60406">Inglés</a>'
    );
    // A zip we could not find is not carried over.
    expect(await landing('?zip=00000', ROWS)).toContain(
      'data-testid="language-switch-en" href="/">'
    );
  });

  it('the header carries the Language menu on its left, the page language marked (owner 2026-11-10)', async () => {
    for (const [html, header, first] of [
      [await events('?when=weekend', ROWS), 'public-header', 'data-testid="public-title"'],
      [await landing('?zip=60406', ROWS), 'landing-header', 'data-testid="landing-logo"'],
    ] as const) {
      const bar =
        html.match(new RegExp(`<header data-testid="${header}"[\\s\\S]*?</header>`))?.[0] ?? '';
      const menuAt = bar.indexOf('data-testid="language-menu"');
      expect(menuAt, `${header}: menu in the header`).toBeGreaterThan(-1);
      expect(menuAt, `${header}: menu on the left`).toBeLessThan(bar.indexOf(first));
      expect(bar).toMatch(/aria-current="true" lang="es" data-testid="language-menu-es"/);
      expect(bar).toContain('<span>Idioma</span>');
      expect(bar).toContain('aria-label="Menú"');
      expect(html, `${header}: the menu's styles`).toContain(
        '.ose-langmenu-mobile { display: block; }'
      );
      expect(html, 'no marker left behind').not.toContain('OCR_LANGUAGE_MENU');
    }
    // The links keep the filters, as the footer switch does.
    expect(await events('?when=weekend', ROWS)).toContain(
      'data-testid="language-menu-en" href="/events?when=weekend">'
    );
  });

  it('the English pages offer Spanish by its own name', async () => {
    const list = await events('?when=past', ROWS, 'en');
    expect(list).toContain(
      '<a lang="es" hreflang="es" data-testid="language-switch-es" href="/es/events?when=past">Español</a>'
    );
    expect(await landing('', ROWS, 'en')).toContain(
      '<a lang="es" hreflang="es" data-testid="language-switch-es" href="/es/">Español</a>'
    );
  });

  it('each page names its siblings for search engines, without its filters', async () => {
    for (const [html, path] of [
      [await events('?when=today', ROWS), '/events'],
      [await events('', ROWS, 'en'), '/events'],
      [await landing('?zip=60406', ROWS), '/'],
      [await landing('', ROWS, 'en'), '/'],
    ] as const) {
      const es = path === '/' ? '/es/' : `/es${path}`;
      expect(html).toContain(
        `<link rel="alternate" hreflang="en" href="https://oursharedevents.com${path}" />`
      );
      expect(html).toContain(
        `<link rel="alternate" hreflang="es" href="https://oursharedevents.com${es}" />`
      );
      expect(html).toContain(
        `<link rel="alternate" hreflang="x-default" href="https://oursharedevents.com${path}" />`
      );
    }
  });

  it('the phone location form asks for the Spanish landing back', async () => {
    const html = await landing('', ROWS);
    expect(html).toContain('<input type="hidden" name="lang" value="es" />');
    expect(await landing('', ROWS, 'en')).not.toContain('name="lang"');
  });

  it('the page tells link previews and search engines it is the Spanish page', async () => {
    for (const html of [await events('', ROWS), await landing('', ROWS)]) {
      expect(html).toContain('<meta property="og:locale" content="es_US" />');
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/oursharedevents\.com\/es\//);
    }
  });

  it('the English pages carry no og:locale, as before (Open Graph reads none as en_US)', async () => {
    for (const html of [await events('', ROWS, 'en'), await landing('', ROWS, 'en')]) {
      expect(html).not.toContain('og:locale');
    }
  });

  it('a bare address follows the Accept-Language header, and says it varies by it', async () => {
    state.rows = ROWS;
    const headers = { 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.5' };
    const list = await handlePublicPage(
      {} as never,
      null,
      new Request('https://oursharedevents.com/events', { headers })
    );
    expect(list.headers.get('Vary')).toBe('Accept-Language');
    expect(await list.text()).toContain('<html lang="es"');
    const home = await handleLandingPage(
      {} as never,
      null,
      new Request('https://oursharedevents.com/', { headers })
    );
    expect(home.headers.get('Vary')).toBe('Accept-Language');
    expect(await home.text()).toContain('<html lang="es"');
  });

  it('under /es the address alone decides: no Vary, and an English header is ignored', async () => {
    state.rows = ROWS;
    const res = await handlePublicPage(
      {} as never,
      null,
      new Request('https://oursharedevents.com/es/events', {
        headers: { 'Accept-Language': 'en-US' },
      }),
      'es'
    );
    expect(res.headers.get('Vary')).toBeNull();
    expect(await res.text()).toContain('<html lang="es"');
  });
});
