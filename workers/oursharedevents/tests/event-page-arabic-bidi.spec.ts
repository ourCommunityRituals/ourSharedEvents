/**
 * Part of OSE-1959 (story OSE-1966) and OSE-1942: an Arabic event page keeps
 * every left-to-right value in its own order.
 *
 * The owner's screenshot of the Arabic pre-event page on staging (2026-11-10)
 * showed "S Cicero Ave, Oak Lawn, IL 60453 9333": a sponsor's address with its
 * house number pulled to the far end by the page's right-to-left direction. The
 * title, what, where and who were already isolated (`isolateTyped`, `<bdi>`);
 * the sponsor strip, the type label, why, how, the price note and the "next at
 * this venue" list were not. The time read "10:00 ص غرينتش-6" ("GMT-6") where
 * the English page reads "10:00 AM CST".
 *
 * Three checks over the pre-event, live and recap pages in Arabic, every
 * optional part switched on, with real Latin-script values:
 *   1. every run of Latin letters a reader sees sits inside a `<bdi>`, unless
 *      it is a product name listed in NAMES (a whole link, so it has nothing to
 *      be reordered against);
 *   2. each value a test plants is found inside a `<bdi>` exactly as typed;
 *   3. the time is a 12-hour clock with ص/م and the zone named in Arabic
 *      ("توقيت شيكاغو"), never "غرينتش" or a Latin abbreviation.
 *
 * Born red: drop `isolateTyped` from any one of those renders, or put the
 * zone style back to 'short', and a test below fails, naming the page and the
 * text. Left-to-right pages are unchanged: the last block pins English.
 *
 * Node-clean: imports the exported renderers, no cloudflare:test.
 */
import { describe, it, expect } from 'vitest';
import {
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';
import { formatEventTime } from '../src/lib/event-datetime';
import { formatEventPriceParts, formatEventPrice } from '../src/lib/event-price';

const SHARE = 'https://oursharedevents.com/ar/events/evt_ar/turkey-hoops';
const NONCE = 'arnonce';
const HOUR = 3_600_000;

/** Every value an organizer or sponsor typed, or catalog data still in English. */
const TYPED = {
  title: 'Turkey Hoops skills challenge',
  type: 'Pickup Basketball',
  what: 'Basketball shooting and skills contest at the pavilion.',
  venue: 'Community Pavilion',
  address: '9401 S Oak Park Ave, Oak Lawn, IL 60453',
  host: 'Oak Lawn Park District',
  story: 'We run 12 courts (indoor + outdoor).',
  why: 'Raise $500 for the food pantry!',
  how: 'Bring sneakers; sign-in at 9:30 AM.',
  priceNote: 'cash only',
  sponsor: 'Hilton Chicago/Oak Lawn',
  sponsorAddress: '9333 S Cicero Ave, Oak Lawn, IL 60453',
  sponsor2: 'Acorn to Oak Studios',
  sponsor2Address: '9411 S 51st Ave, Oak Lawn, IL 60453',
  next: 'Winter 3-on-3 #2',
};

function row(overrides: Partial<PublicEventRow> = {}): PublicEventRow {
  return {
    id: 'evt_ar',
    brand_id: 'root',
    title: TYPED.title,
    slug: 'turkey-hoops',
    status: 'active',
    description: null,
    location: TYPED.venue,
    start_date: '2026-11-26',
    end_date: '2026-11-26',
    timezone: 'America/Chicago',
    starts_at: '2026-11-26T16:00:00Z',
    what_short: TYPED.what,
    who_host: TYPED.host,
    why_purpose: TYPED.why,
    how_details: TYPED.how,
    where_address: TYPED.address,
    who_story: TYPED.story,
    who_image_url: 'https://example.org/host.jpg',
    what_video_url: 'https://example.org/video',
    what_url: 'https://example.org/go',
    what_url_enabled: 1,
    what_url_type: 'tickets',
    lat: 41.72,
    lon: -87.78,
    price_cents: 2500,
    price_model: 'fixed',
    price_note: TYPED.priceNote,
    is_published: 1,
    event_type_id: 'etr-rec-pickup',
    event_type_name: TYPED.type,
    ...overrides,
  };
}

const SOCIAL = {
  sponsors: [
    {
      id: 'sp1',
      name: TYPED.sponsor,
      website_url: null,
      address_line: TYPED.sponsorAddress,
    },
    {
      id: 'sp2',
      name: TYPED.sponsor2,
      website_url: 'https://example.org/acorn',
      address_line: TYPED.sponsor2Address,
    },
  ],
  regCount: 40,
  checkinCount: 30,
  walkInCount: 10,
  surveyCount: 6,
  emailCount: 7,
};

const NEXT = [
  { id: 'evt_next', title: TYPED.next, start_date: '2026-12-05', location: TYPED.venue },
];

/**
 * Product names: each is a whole link or option on its own ("Google Maps"), so
 * nothing of the page's sits beside it to be reordered. "Apple أو Outlook"
 * puts an Arabic word between two names and reads right in either order.
 */
const NAMES = [
  'Google Maps',
  'Apple Maps',
  'Google Calendar',
  'Apple',
  'Outlook',
  'OurSharedEvents',
];

const soon = () => new Date(Date.now() + 3 * HOUR).toISOString();

const PAGES: { name: string; html: () => string }[] = [
  {
    name: 'pre-event',
    html: () =>
      renderPreEventHtml(
        row({ starts_at: soon(), start_date: soon().slice(0, 10) }),
        SHARE,
        SOCIAL,
        {
          nonce: NONCE,
          lang: 'ar',
          nextEvents: NEXT,
        }
      ),
  },
  {
    name: 'live',
    html: () =>
      renderEventLiveHtml(row(), SHARE, SOCIAL, { nonce: NONCE, lang: 'ar', nextEvents: NEXT }),
  },
  {
    name: 'recap',
    html: () => renderPostEventHtml(row(), SHARE, NEXT, SOCIAL, { nonce: NONCE, lang: 'ar' }),
  },
];

/** The page body as a reader sees it, with each `<bdi>…</bdi>` taken out. */
function textOutsideBdi(html: string): string {
  const body = (/<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?--!?>/g, ' ')
    .replace(/<bdi>[\s\S]*?<\/bdi>/g, ' ');
  // The language menu and switch name each language in its own script, each in
  // its own element with its own `lang`: "English", "Español", "Polski".
  const noAutonyms = body.replace(
    /<(a|span)\b[^>]*\slang="(?:en|es|pl)"[^>]*>[\s\S]*?<\/\1>/g,
    ' '
  );
  let text = noAutonyms.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  for (const name of NAMES) text = text.split(name).join(' ');
  return text.replace(/\s+/g, ' ');
}

/** The escaped form a value takes in the page. */
function escaped(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

describe('Arabic event pages: no Latin-script run outside a <bdi>', () => {
  for (const page of PAGES) {
    it(`${page.name}: every Latin run a reader sees is isolated`, () => {
      const html = page.html();
      expect(html).toContain('dir="rtl"');
      const loose = textOutsideBdi(html).match(/[A-Za-z][A-Za-z0-9.,'’&$#/ -]*/g) ?? [];
      expect(loose, `${page.name}: Latin text outside <bdi>`).toEqual([]);
    });
  }
});

describe('Arabic event pages: each typed value is isolated as typed', () => {
  const EXPECT: Record<string, (keyof typeof TYPED)[]> = {
    'pre-event': [
      'title',
      'type',
      'what',
      'venue',
      'address',
      'host',
      'story',
      'why',
      'how',
      'priceNote',
      'sponsor',
      'sponsorAddress',
      'sponsor2',
      'sponsor2Address',
      'next',
    ],
    live: [
      'title',
      'type',
      'what',
      'venue',
      'address',
      'host',
      'why',
      'how',
      'priceNote',
      'sponsor',
      'sponsorAddress',
      'next',
    ],
    recap: [
      'title',
      'type',
      'what',
      'venue',
      'address',
      'host',
      'story',
      'priceNote',
      'sponsor',
      'sponsorAddress',
      'next',
    ],
  };
  for (const page of PAGES) {
    for (const key of EXPECT[page.name]) {
      it(`${page.name}: ${key} sits in its own <bdi>`, () => {
        expect(page.html()).toContain(`<bdi>${escaped(TYPED[key])}</bdi>`);
      });
    }
  }

  it('the house number stays at the front of the sponsor address', () => {
    const html = PAGES[0].html();
    expect(html).toMatch(
      /data-testid="sponsor-item-address"><bdi>9333 S Cicero Ave, Oak Lawn, IL 60453<\/bdi><\/small>/
    );
  });

  it('the type label is the Arabic word, then the isolated English name (OSE-1764 open)', () => {
    expect(PAGES[0].html()).toContain('النوع: <bdi>Pickup Basketball</bdi>');
  });

  it('the price keeps its amount and isolates only the typed note', () => {
    const html = PAGES[0].html();
    expect(html).toContain('<p>$25 (<bdi>cash only</bdi>)</p>');
  });

  it('a typed value with markup is escaped inside its <bdi>', () => {
    const html = renderPreEventHtml(
      row({ why_purpose: '<img src=x onerror=alert(1)>', price_note: '"><b>x' }),
      SHARE,
      SOCIAL,
      { nonce: NONCE, lang: 'ar' }
    );
    expect(html).toContain('<bdi>&lt;img src=x onerror=alert(1)&gt;</bdi>');
    expect(html).toContain('(<bdi>&quot;&gt;&lt;b&gt;x</bdi>)');
    expect(html).not.toContain('<img src=x');
  });
});

describe('Arabic time: 12-hour clock, zone named in Arabic', () => {
  it('reads "10:00 ص توقيت شيكاغو" for 10 AM in Chicago', () => {
    expect(formatEventTime('2026-11-26T16:00:00Z', 'America/Chicago', 'ar')).toBe(
      '10:00 ص توقيت شيكاغو'
    );
  });

  it('reads م for the afternoon, in summer time too', () => {
    expect(formatEventTime('2026-07-04T23:00:00Z', 'America/Chicago', 'ar')).toBe(
      '6:00 م توقيت شيكاغو'
    );
  });

  it('names another zone by its own city', () => {
    expect(formatEventTime('2026-11-26T18:00:00Z', 'America/Los_Angeles', 'ar')).toBe(
      '10:00 ص توقيت لوس انجلوس'
    );
  });

  for (const page of PAGES.slice(0, 2)) {
    it(`${page.name}: the when line has no GMT offset and no Latin abbreviation`, () => {
      const html = page.html();
      const when = /data-testid="event-when(?:-live)?">([^<]*)/.exec(html)?.[1] ?? '';
      expect(when).toMatch(/\d{1,2}:\d{2} [صم] توقيت شيكاغو/);
      expect(when).not.toMatch(/غرينتش|GMT|C[SD]T/);
    });
  }
});

describe('left-to-right pages are unchanged', () => {
  it('English keeps "CST" and no <bdi>', () => {
    expect(formatEventTime('2026-11-26T16:00:00Z', 'America/Chicago', 'en')).toBe('10:00 AM CST');
    const html = renderPreEventHtml(row(), SHARE, SOCIAL, {
      nonce: NONCE,
      lang: 'en',
      nextEvents: NEXT,
    });
    expect(html).not.toContain('<bdi>');
    expect(html).toContain('<p>$25 (cash only)</p>');
  });

  it('Spanish and Polish keep their zone style', () => {
    expect(formatEventTime('2026-11-26T16:00:00Z', 'America/Chicago', 'es')).toBe('10:00 a.m. CST');
    expect(formatEventTime('2026-11-26T16:00:00Z', 'America/Chicago', 'pl')).toBe('10:00 GMT-6');
  });

  it('formatEventPrice is still the plain text of its parts', () => {
    const p = { price_cents: 2500, price_model: 'fixed', price_note: ' cash only ' };
    expect(formatEventPriceParts(p, 'en')).toEqual({ base: '$25', note: 'cash only' });
    expect(formatEventPrice(p, 'en')).toBe('$25 (cash only)');
    expect(
      formatEventPriceParts({ price_cents: null, price_model: null, price_note: 'x' }, 'en')
    ).toBeNull();
  });
});

describe('direction glyphs on a right-to-left page', () => {
  it('the never-who disclosure points to the reading start when closed (◂), down when open', async () => {
    const { NEVER_WHO_CSS } = await import('../src/lib/never-who');
    // The CSS escapes: backslash, then the code point (◂ U+25C2, ▾ U+25BE).
    const rtl = NEVER_WHO_CSS.indexOf(
      '[dir="rtl"] .ose-never-who-trigger::after { content: " \\25C2"; }'
    );
    const open = NEVER_WHO_CSS.indexOf(
      '.ose-never-who[open] .ose-never-who-trigger::after { content: " \\25BE"; }'
    );
    expect(rtl, 'rtl marker rule').toBeGreaterThan(-1);
    expect(open, 'open marker rule').toBeGreaterThan(-1);
    // The page carries the rule, and the root says rtl, so the rule applies.
    const html = PAGES[0].html();
    expect(html).toContain('<html lang="ar" dir="rtl"');
    expect(html).toContain('[dir="rtl"] .ose-never-who-trigger::after');
  });

  it('"all events" points back toward the reading start (→ in rtl)', () => {
    expect(PAGES[0].html()).toMatch(/&rarr; كل الفعاليات/);
  });
});
