/**
 * Every language on every page on the language layer, at every viewport, menu
 * state and theme (epic OSE-1959 feature OSE-1961, story OSE-1969; Polish
 * OSE-1957). Owner, 2026-11-10: "mutation executions through the all
 * permutations".
 *
 * The full set is generated, not written row by row:
 *
 *   language (LANGUAGES: en, es, pl, ar)            4
 *   page (event pre, live, post, /events, landing)  5
 *   viewport (320, 375, 640, 641, 1280 px)          5
 *   menu state (closed, wide open, phone open,
 *               phone Language open)                4
 *   theme (dark, light)                             2
 *                                                 ----
 *                                                  800 cells
 *
 * Direction is not a factor of its own: it follows the language (DIRECTION).
 * Adding a language to LANGUAGES grows the set with no edit here.
 *
 * At this layer (node, no browser) a viewport, a menu state and a theme are
 * not separate renders. Each language × page is rendered once and parsed once
 * (20 renders); each cell then reads the page's own markup and CSS for what
 * that viewport, state and theme would show: which menu layout the page's
 * breakpoint picks, which list an open `<details>` reveals, which language is
 * current, where every link leads, what each language is called, which side
 * the menu opens from, whether the panel fits the screen, and whether the menu
 * uses only token colours. A real browser runs the pairwise subset on staging
 * (OSE-1972), because 800 browser loads per run is too many.
 *
 * Scenario ids (feature OSE-1961): H1 lang, dir, og:locale, hreflang; H2 the
 * menu; H3 Arabic digits and months; N1 direction never wrong; N2 no physical
 * left/right in the menu CSS; N3 no English of ours on a pl or ar page; E1 the
 * 640/641 breakpoint and 320 px fit; E2 typed text isolated on an rtl page;
 * F1 the current language is not a link.
 *
 * Born red (each watched failing before this spec was trusted, faults listed
 * in the PR): DIRECTION.ar = 'ltr'; `inset-inline-start` put back to `left`;
 * isolateTyped returning its input; INTL_LOCALE.ar = 'ar-PS'; one Polish or
 * Arabic catalog value put back in English; the breakpoint moved to 600 px.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { CATALOG, type MessageKey } from '../src/lib/i18n/catalog';
import {
  DIRECTION,
  LANGUAGES,
  LANGUAGE_SWITCH_NAMES,
  OG_LOCALE,
  type Lang,
} from '../src/lib/i18n/languages';
import { LANGUAGE_MENU_CSS } from '../src/lib/i18n/language-menu';
import { withLangPrefix } from '../src/lib/i18n/path-prefix';
import { FEW, MANY, NOW, sentinel } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => ({ data: state.rows, source: 'live', cacheAge: null }),
  }),
}));
// Category names per language are OSE-1764; here each is a sentinel.
vi.mock('../src/lib/event-type-catalog-read', async () => {
  const { goldenCatalog } = await import('./helpers/list-landing-rows');
  const names = { REC: 'ZZCATREC', ENT: 'ZZCATENT', MKT: 'ZZCATMKT', LIT: 'ZZCATLIT' };
  return { readEventTypeCatalog: async () => goldenCatalog(names) };
});
vi.mock('../src/lib/sponsor-titles', async () => {
  const { SPONSORED_EVENT } = await import('./helpers/list-landing-rows');
  return { fetchSponsorTitles: async () => new Map([[SPONSORED_EVENT, 'ZZSPONSOR']]) };
});

import {
  handleLandingPage,
  handlePublicPage,
  renderEventLiveHtml,
  renderPostEventHtml,
  renderPreEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';

// ── The factors ──────────────────────────────────────────────────────────────

const PAGES = ['pre', 'live', 'post', 'events', 'landing'] as const;
type Page = (typeof PAGES)[number];
const VIEWPORTS = [320, 375, 640, 641, 1280] as const;
const MENU_STATES = ['closed', 'wide-open', 'phone-open', 'phone-language-open'] as const;
type MenuState = (typeof MENU_STATES)[number];
const THEMES = ['dark', 'light'] as const;

/** Each page's address without a language prefix (what the menu links to). */
const PATH: Record<Page, string> = {
  pre: '/events/evt_perm/zz-title',
  live: '/events/evt_perm/zz-title',
  post: '/events/evt_perm/zz-title',
  events: '/events',
  landing: '/',
};

/**
 * The direction a language is written in, from ICU (CLDR), not from our own
 * DIRECTION map: a test that read DIRECTION would agree with any mistake in it.
 */
function icuDirection(lang: string): 'ltr' | 'rtl' {
  const locale = new Intl.Locale(lang) as Intl.Locale & {
    getTextInfo?: () => { direction: 'ltr' | 'rtl' };
    textInfo?: { direction: 'ltr' | 'rtl' };
  };
  const info = locale.getTextInfo ? locale.getTextInfo() : locale.textInfo;
  if (!info) throw new Error('this Node has no Intl.Locale text info');
  return info.direction;
}

// An organizer typed this in English. On an Arabic page its "#3!" must stay
// with it (E2), so it sits in <bdi>. The ZZ prefix keeps it out of N3.
const TYPED_TITLE = 'ZZTITLE Bocce Night #3!';

function row(): PublicEventRow {
  return {
    id: 'evt_perm',
    brand_id: 'root',
    title: TYPED_TITLE,
    slug: 'zz-title',
    status: 'active',
    description: 'ZZDESCRIPTION',
    location: 'ZZVENUE',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    what_short: 'ZZWHAT',
    who_host: 'ZZHOST',
    why_purpose: 'ZZWHY',
    how_details: 'ZZHOW',
    where_address: 'ZZADDRESS',
    who_story: 'ZZSTORY',
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: 41.7,
    lon: -87.7,
    price_cents: null,
    price_model: 'free',
    price_note: null,
    is_published: 1,
    event_type_id: null,
    event_type_name: 'ZZTYPE',
  } as PublicEventRow;
}

const SOCIAL = {
  sponsors: [],
  regCount: 40,
  checkinCount: 30,
  walkInCount: 10,
  surveyCount: 2,
  emailCount: 0,
};

async function render(lang: Lang, page: Page): Promise<string> {
  const prefix = withLangPrefix(lang, '');
  const share = `https://oursharedevents.com${withLangPrefix(lang, PATH.pre)}`;
  const opts = { lang, pageQuery: '' };
  switch (page) {
    case 'pre':
      return renderPreEventHtml(row(), share, undefined, opts);
    case 'live':
      return renderEventLiveHtml(row(), share, undefined, opts);
    case 'post':
      return renderPostEventHtml(row(), share, [], SOCIAL as never, opts);
    case 'events': {
      state.rows = sentinel(MANY);
      const req = new Request(`https://oursharedevents.com${prefix}/events`);
      return (await handlePublicPage({} as never, null, req, lang)).text();
    }
    case 'landing': {
      state.rows = sentinel(FEW);
      const req = new Request(`https://oursharedevents.com${prefix}/`);
      return (await handleLandingPage({} as never, null, req, lang)).text();
    }
  }
}

// ── Reading a page ───────────────────────────────────────────────────────────

interface Parsed {
  html: string;
  doc: Document;
}

const PARSED = new Map<string, Parsed>();
const key = (lang: Lang, page: Page) => `${lang}|${page}`;

/** The phone breakpoint the page's own CSS sets for the menu. */
function phoneMaxWidth(html: string): number {
  const m = /@media \(max-width: (\d+)px\) \{\s*\.ose-langmenu-desktop \{ display: none; \}/.exec(
    html
  );
  if (!m) throw new Error('no phone breakpoint for the menu in the page');
  return Number(m[1]);
}

/**
 * The language items a reader can see in one cell. The page decides it: its
 * breakpoint picks a layout, and an item shows only when every `<details>`
 * around it is open (the state opens them).
 */
function visibleItems(p: Parsed, viewport: number, menu: MenuState): Element[] {
  const phone = viewport <= phoneMaxWidth(p.html);
  const wide = p.doc.querySelector('[data-testid="language-menu-desktop"]');
  const phoneMenu = p.doc.querySelector('[data-testid="site-menu"]');
  const sub = p.doc.querySelector('[data-testid="site-menu-language"]');
  if (!wide || !phoneMenu || !sub) throw new Error('menu parts missing');
  // Nothing on the server is opened: every state starts closed.
  for (const d of [wide, phoneMenu, sub]) expect(d.hasAttribute('open')).toBe(false);
  const open = new Set<Element>();
  if (menu === 'wide-open') open.add(wide);
  if (menu === 'phone-open') open.add(phoneMenu);
  if (menu === 'phone-language-open') (open.add(phoneMenu), open.add(sub));
  const shown = (el: Element): boolean => {
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) {
      if (!open.has(d)) return false;
    }
    const inWide = wide.contains(el);
    return inWide ? !phone : phone;
  };
  return [...p.doc.querySelectorAll('.ose-langmenu-item')].filter(shown);
}

/** The text a reader sees or hears. */
const NAMES = [
  // OSE-2045: the online calendar's own name. Listed before 'Outlook' so the
  // whole name is taken out, not only its first word.
  'Outlook.com',
  'OurSharedEvents',
  'Cloudflare Access',
  'GeoNames',
  'CC BY 4.0',
  'OpenStreetMap',
  'Google Maps',
  'Apple Maps',
  'Google Calendar',
  'Apple',
  'Outlook',
  'Blue Island',
  'Oak Lawn',
  'Chicago',
];
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
  text = text.replace(/\bzz[\w-]*/gi, ' ').replace(/Bocce Night #3!/g, ' ');
  for (const name of NAMES) text = text.split(name).join(' ');
  return text.replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ').replace(/\s+/g, ' ');
}

/** Keys whose text is the same word in English and in that language. */
const SAME_AS_ENGLISH: Partial<Record<Lang, readonly MessageKey[]>> = {
  pl: ['menu.label', 'area.online', 'provenance.demoChip'],
};

/** English catalog text, cut at its `{slots}`, that the language has replaced. */
function englishFragments(lang: Lang): { key: MessageKey; fragment: string }[] {
  const out: { key: MessageKey; fragment: string }[] = [];
  for (const k of Object.keys(CATALOG.en) as MessageKey[]) {
    if (SAME_AS_ENGLISH[lang]?.includes(k)) continue;
    for (const part of (CATALOG.en[k] as string).replace(/<[^>]+>/g, ' ').split(/\{\w+\}/)) {
      let fragment = part
        .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
        .replace(/[→▶“”‹›]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      for (const name of NAMES) fragment = fragment.split(name).join(' ').trim();
      if (fragment.length >= 3) out.push({ key: k, fragment });
    }
  }
  return out;
}

function englishLeft(lang: Lang, text: string): string[] {
  const found: string[] = [];
  for (const { key: k, fragment } of englishFragments(lang)) {
    const re = new RegExp(
      `(^|[^\\p{L}])${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`,
      'u'
    );
    if (re.test(text)) found.push(`catalog ${k}: "${fragment}"`);
  }
  return found;
}

// ── Setup: 20 renders ────────────────────────────────────────────────────────

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const lang of LANGUAGES) {
    for (const page of PAGES) {
      const html = await render(lang, page);
      PARSED.set(key(lang, page), { html, doc: new JSDOM(html).window.document });
    }
  }
});

afterAll(() => {
  vi.useRealTimers();
});

const get = (lang: Lang, page: Page): Parsed => {
  const p = PARSED.get(key(lang, page));
  if (!p) throw new Error(`not rendered: ${lang} ${page}`);
  return p;
};

// ── Per render: 4 languages × 5 pages ────────────────────────────────────────

const RENDERS = LANGUAGES.flatMap((lang) => PAGES.map((page) => ({ lang, page })));

describe.each(RENDERS)('$lang $page | the page', ({ lang, page }) => {
  it('H1 / N1: <html> carries the language and its direction, and no other direction', () => {
    const { html, doc } = get(lang, page);
    expect(doc.documentElement.getAttribute('lang')).toBe(lang);
    expect(doc.documentElement.getAttribute('dir')).toBe(icuDirection(lang));
    const other = icuDirection(lang) === 'rtl' ? 'ltr' : 'rtl';
    expect(html).not.toMatch(new RegExp(`<html[^>]*dir="${other}"`));
  });

  it('H1: og:locale is the language’s, and hreflang names every language once', () => {
    const { doc } = get(lang, page);
    const og = doc.querySelector('meta[property="og:locale"]');
    // The English landing and /events leave og:locale to its default (en_US).
    if (og || lang !== 'en') expect(og?.getAttribute('content')).toBe(OG_LOCALE[lang]);
    const tags = [...doc.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) =>
      l.getAttribute('hreflang')
    );
    expect(tags.sort()).toEqual([...LANGUAGES, 'x-default'].sort());
    for (const l of LANGUAGES) {
      const href = doc
        .querySelector(`link[rel="alternate"][hreflang="${l}"]`)
        ?.getAttribute('href');
      expect(new URL(href ?? '').pathname).toBe(withLangPrefix(l, PATH[page]));
    }
  });

  it('H2: the footer switch names every other language the page’s way', () => {
    const { doc } = get(lang, page);
    for (const l of LANGUAGES.filter((x) => x !== lang)) {
      const a = doc.querySelector(`[data-testid="language-switch-${l}"]`);
      expect(a?.textContent).toBe(LANGUAGE_SWITCH_NAMES[lang][l]);
      expect(a?.getAttribute('hreflang')).toBe(l);
    }
    expect(doc.querySelector(`[data-testid="language-switch-${lang}"]`)).toBeNull();
  });

  it('E2: typed text is isolated with <bdi> on a right-to-left page, and only there', () => {
    const { html } = get(lang, page);
    if (page === 'events' || page === 'landing') {
      // The cards are not wrapped yet: OSE-1966 lists them. Nothing to isolate here.
      return;
    }
    if (icuDirection(lang) === 'rtl') {
      expect(html).toContain(`<bdi>${TYPED_TITLE}</bdi></h1>`);
      expect(html).toContain('<bdi>ZZHOST</bdi>');
      expect(html).toContain('<bdi>ZZVENUE</bdi>');
      // Never inside an attribute.
      expect(html).not.toMatch(/="[^"]*<bdi>/);
    } else {
      expect(html).not.toContain('<bdi>');
      expect(html).toContain(`>${TYPED_TITLE}</h1>`);
    }
  });

  if (lang !== 'en') {
    it('N3: no English of ours is left on the page', () => {
      const left = englishLeft(lang, readerText(get(lang, page).html));
      expect(left, `${lang} ${page}`).toEqual([]);
    });
  }

  if (icuDirection(lang) === 'rtl') {
    it('N3: no Latin-script word of ours on a right-to-left page', () => {
      const words = readerText(get(lang, page).html).match(/\b[A-Za-z]{2,}\b/g) ?? [];
      expect(words, `${lang} ${page}`).toEqual([]);
    });
  }

  if (lang === 'ar') {
    it('H3: dates use Western digits and Arabic month names', () => {
      const text = readerText(get(lang, page).html);
      expect(text).not.toMatch(/[٠-٩۰-۹]/);
      if (page !== 'landing') expect(text).toMatch(/أكتوبر|نوفمبر|ديسمبر/);
    });
  }
});

// ── Per cell: 4 × 5 × 5 × 4 × 2 = 800 ────────────────────────────────────────

const CELLS = LANGUAGES.flatMap((lang) =>
  PAGES.flatMap((page) =>
    VIEWPORTS.flatMap((viewport) =>
      MENU_STATES.flatMap((menu) => THEMES.map((theme) => ({ lang, page, viewport, menu, theme })))
    )
  )
);

describe('the full permutation set', () => {
  it('is every combination, once', () => {
    expect(CELLS.length).toBe(
      LANGUAGES.length * PAGES.length * VIEWPORTS.length * MENU_STATES.length * THEMES.length
    );
    expect(new Set(CELLS.map((c) => JSON.stringify(c))).size).toBe(CELLS.length);
  });

  it('N1: our DIRECTION map agrees with ICU for every language, and Arabic is rtl', () => {
    for (const lang of LANGUAGES) expect(DIRECTION[lang], lang).toBe(icuDirection(lang));
    expect(DIRECTION.ar).toBe('rtl');
  });
});

describe.each(CELLS)('$lang $page $viewport px $menu $theme', ({ lang, page, viewport, menu }) => {
  it('shows the right list, with the current language marked and every link right', () => {
    const p = get(lang, page);
    const items = visibleItems(p, viewport, menu);
    const phone = viewport <= phoneMaxWidth(p.html);
    const listOpen = (menu === 'wide-open' && !phone) || (menu === 'phone-language-open' && phone);
    // E1: the breakpoint is 640 px; 640 is a phone, 641 is not.
    if (viewport === 640) expect(phone).toBe(true);
    if (viewport === 641) expect(phone).toBe(false);
    if (!listOpen) {
      expect(items).toEqual([]);
      // The phone menu open shows its Language row, closed, and no list.
      if (menu === 'phone-open' && phone) {
        expect(p.doc.querySelector('[data-testid="site-menu-language-button"]')).not.toBeNull();
      }
      return;
    }
    // H2: every language, in LANGUAGES order, named the page's way.
    expect(items.map((el) => el.textContent)).toEqual(
      LANGUAGES.map((l) => `${l === lang ? '✓' : ''}${LANGUAGE_SWITCH_NAMES[lang][l]}`)
    );
    for (const [i, l] of LANGUAGES.entries()) {
      const el = items[i];
      if (l === lang) {
        // F1: the current language is marked and is not a link, so a double
        // tap on it goes nowhere.
        expect(el.tagName).toBe('SPAN');
        expect(el.getAttribute('aria-current')).toBe('true');
      } else {
        expect(el.tagName).toBe('A');
        expect(el.getAttribute('href')).toBe(withLangPrefix(l, PATH[page]));
        expect(el.getAttribute('hreflang')).toBe(l);
        expect(el.hasAttribute('aria-current')).toBe(false);
      }
    }
  });

  it('opens from the reading start, fits the screen, and uses token colours only', () => {
    const { html, doc } = get(lang, page);
    // N2: the menu's CSS is in the page and has no physical side, so <html dir>
    // alone puts it on the left (ltr) or the right (rtl).
    expect(html).toContain(LANGUAGE_MENU_CSS);
    expect(LANGUAGE_MENU_CSS).not.toMatch(/(^|[\s;{-])(left|right)\s*:/);
    expect(LANGUAGE_MENU_CSS).not.toMatch(/(margin|padding|border)-(left|right)\b/);
    const anchor = /\.ose-langmenu-panel \{[^}]*\}/.exec(LANGUAGE_MENU_CSS);
    expect(
      /inset-inline-start: 0/.test(
        /\.ose-langmenu-desktop > \.ose-langmenu-list, \.ose-langmenu-panel \{[^}]*\}/.exec(
          LANGUAGE_MENU_CSS
        )?.[0] ?? ''
      )
    ).toBe(true);
    expect(anchor).not.toBeNull();
    const side = doc.documentElement.getAttribute('dir') === 'rtl' ? 'right' : 'left';
    expect(side).toBe(icuDirection(lang) === 'rtl' ? 'right' : 'left');
    // E1: the phone panel is min(18rem, 100vw - 2rem) wide, so with the 1rem
    // gutter on each side it never runs off a phone screen.
    const w = /width: min\((\d+)rem, calc\(100vw - (\d+)rem\)\)/.exec(LANGUAGE_MENU_CSS);
    expect(w).not.toBeNull();
    const panel = Math.min(Number(w?.[1]) * 16, viewport - Number(w?.[2]) * 16);
    expect(panel + 16).toBeLessThanOrEqual(viewport);
    // Both themes: every colour in the menu is a token from /ui.css.
    const colours = LANGUAGE_MENU_CSS.match(/(?:color|background|border)[^;:]*:\s*[^;]+/g) ?? [];
    for (const c of colours) expect(c, c).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
  });
});
