/**
 * No English of ours left on a page in another language, on every page of the
 * language layer (owner 2026-11-28: "this applies to all selected, available
 * languages").
 *
 * The permutation spec (language-permutations.spec.ts, N3) looks for the
 * catalog's English on five pages. It cannot see a word that never went
 * through the catalog: a label typed straight into a render function stays
 * English in every language and N3 has nothing to look for. This spec looks
 * from the other side. It renders each page twice, in English and in the other
 * language, from the same rows, and reads both the way a reader does (text,
 * alt, aria-label, title, placeholder, the <title> and the meta description).
 * Any piece of text that is word for word the same on both renders, and is not
 * the host's own words or a name, is English we forgot to translate.
 *
 * What the host typed (title, description, venue, address, host name) is a ZZ
 * sentinel and is taken out, as are proper names (NAMES). Category and event
 * type names are sentinels here: their per-language names have their own spec.
 *
 * Pages: the landing, the map (/map), /events, an event before, during and
 * after, the four form screens, and the sponsor card. A page that joins the
 * language layer joins this list.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { LANGUAGES, LANGUAGE_NAMES, DEFAULT_LANG, type Lang } from '../src/lib/i18n/languages';
import { withLangPrefix } from '../src/lib/i18n/path-prefix';
import { FEW, MANY, NOW, sentinel } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => ({ data: state.rows, source: 'live', cacheAge: null }),
  }),
}));
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
import { handleFormPage, type FormPagesEnv } from '../src/handlers/form-pages';
import { renderSponsorCardPage } from '../src/lib/sponsor-card-render';
import type { EventFormScreen } from '../src/lib/canonical';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

function row(): PublicEventRow {
  return {
    id: 'evt_perm',
    brand_id: 'root',
    title: 'ZZTITLE',
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

const FORM_EVENT = {
  id: 'evt_form',
  brand_id: 'brand_x',
  title: 'ZZTITLE',
  slug: 'zz-title',
  status: 'active',
  description: null,
  location: 'ZZVENUE',
  where_address: 'ZZADDRESS',
  start_date: '2026-12-05',
  end_date: null,
  starts_at: '2026-12-06T00:00:00Z',
  timezone: 'America/Chicago',
};

function formDb(): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => (sql.includes('WHERE id = ?') ? FORM_EVENT : null),
        all: async () => ({
          results: [
            {
              id: 'evt_n',
              title: 'ZZNEXT',
              slug: 'zz',
              start_date: '2026-12-12',
              location: 'ZZVENUE',
            },
          ],
        }),
      }),
    }),
  } as unknown as D1Database;
}

const SPONSOR = {
  id: 'sp_x',
  name: 'ZZSPONSORNAME',
  display_name: null,
  address_line: 'ZZADDRESS',
  contact_phone: '708-555-0100',
  contact_email: 'zz@zz.test',
  website_url: 'https://zz.test',
  has_logo: false,
};

const FORMS: EventFormScreen[] = ['register', 'checkin', 'survey', 'updates'];
const PAGES = [
  'landing',
  'map',
  'events',
  'pre',
  'live',
  'post',
  ...FORMS.map((f) => `form-${f}`),
  'sponsor',
] as const;
type Page = (typeof PAGES)[number];

async function render(lang: Lang, page: Page): Promise<string> {
  const prefix = withLangPrefix(lang, '');
  const share = `https://oursharedevents.com${withLangPrefix(lang, '/events/evt_perm/zz-title')}`;
  const opts = { lang, pageQuery: '' };
  const pathLang = lang === DEFAULT_LANG ? undefined : lang;
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
    case 'map': {
      state.rows = sentinel(MANY);
      const req = new Request(`https://oursharedevents.com${prefix}/map`);
      return (await handleLandingPage({} as never, null, req, lang, { mapFirst: true })).text();
    }
    case 'sponsor':
      return renderSponsorCardPage(SPONSOR, lang);
    default: {
      const screen = page.slice('form-'.length) as EventFormScreen;
      const path = withLangPrefix(lang, `/events/${FORM_EVENT.id}/${screen}`);
      const res = await handleFormPage(
        new Request(`https://t.test${path}?deployment=dep_x1`),
        { DB: formDb() } as FormPagesEnv,
        FORM_EVENT.id,
        1,
        screen,
        pathLang
      );
      return res.text();
    }
  }
}

/** Proper names and words that are the same in every language. */
const NAMES = [
  'Outlook.com',
  'OurSharedEvents',
  'ourCommunityRituals',
  'Cloudflare Access',
  'GeoNames',
  'CC BY 4.0',
  'OpenStreetMap',
  'Google Maps',
  'Apple Maps',
  'Google Calendar',
  'Waze',
  'Apple',
  'Outlook',
  'Blue Island',
  'Oak Lawn',
  'Beverly',
  'Chicago',
  'English',
  'Español',
  'Polski',
];

/** Every piece of text a reader sees or hears, one entry per text node or attribute. */
function pieces(html: string): string[] {
  const doc = new JSDOM(html).window.document;
  for (const el of doc.querySelectorAll('script, style, noscript, template')) el.remove();
  // Text marked as English on a page in another language is English on
  // purpose (the official privacy text, a language's own name in the menu).
  if (doc.documentElement.lang !== 'en') {
    for (const el of doc.querySelectorAll('[lang="en"]')) el.remove();
  }
  const out: string[] = [];
  out.push(doc.title);
  const meta = doc.querySelector('meta[name="description"]')?.getAttribute('content');
  if (meta) out.push(meta);
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.textContent ?? '');
  for (const el of doc.body.querySelectorAll('[alt],[aria-label],[title],[placeholder]')) {
    for (const a of ['alt', 'aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    }
  }
  return out;
}

function clean(s: string): string {
  let t = s.replace(/\bzz[\w@.-]*/gi, ' ');
  for (const name of NAMES) t = t.split(name).join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** A piece worth checking: it has a word of three or more letters. */
const WORDY = /\p{L}{3,}/u;

/**
 * Words that are the same in English and in that language (Polish says
 * "Menu" and "Online" too), and each language's own name, which the
 * language menu shows in that language on every page.
 */
const SAME_WORD: Partial<Record<Lang, readonly string[]>> = {
  pl: ['Menu', 'Online'],
};
const OWN_NAMES = new Set(Object.values(LANGUAGE_NAMES));

function englishLeft(lang: Lang, en: string[], other: string[]): string[] {
  const english = new Set(en.map(clean).filter((t) => WORDY.test(t)));
  const same = new Set(SAME_WORD[lang] ?? []);
  const left = new Set<string>();
  for (const p of other) {
    const t = clean(p);
    if (!WORDY.test(t) || same.has(t) || OWN_NAMES.has(t)) continue;
    if (english.has(t)) left.add(t);
  }
  return [...left].sort();
}

const RENDERS = new Map<string, string[]>();

describe('every page | no English of ours left in another language', () => {
  beforeAll(async () => {
    for (const lang of LANGUAGES) {
      for (const page of PAGES) RENDERS.set(`${lang}|${page}`, pieces(await render(lang, page)));
    }
  });

  for (const lang of LANGUAGES.filter((l) => l !== DEFAULT_LANG)) {
    for (const page of PAGES) {
      it(`${lang} ${page}`, () => {
        const left = englishLeft(lang, RENDERS.get(`en|${page}`)!, RENDERS.get(`${lang}|${page}`)!);
        expect(left, `${lang} ${page}: English left on the page`).toEqual([]);
      });
    }
  }
});
