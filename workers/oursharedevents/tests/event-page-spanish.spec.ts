/**
 * Part of OSE-1760 / OSE-1762 — a Spanish event page shows no English of ours.
 *
 * Staging's /es/ recap was almost all English ("This one's a wrap", "By the
 * numbers", "Hear about the next one", the dates, the privacy footer), because
 * only the strings slice A moved into the catalog were translated. This spec
 * renders every phase of the event page in Spanish, with every optional part
 * switched on (sponsors, counts, next events, price, host photo, why, how, the
 * countdown), and fails if any English we wrote is left.
 *
 * Organizer-entered text shows as typed, so every organizer field here is a
 * ZZ sentinel and is taken out before the check. So are product and language
 * names ("Google Maps", "English" in the language switch), which are names,
 * not English text.
 *
 * Two checks, so a new hard-coded string is caught as well as an old one:
 *   1. no English value from the catalog (a Spanish value left in English is
 *      caught too, unless its key is listed in SAME_IN_BOTH);
 *   2. no common English word ("the", "of", "your", ...).
 *
 * Born red: put any one English literal back in a render (or drop one Spanish
 * catalog value) and a test below fails, naming the phase and the text.
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
import { CATALOG, type MessageKey } from '../src/lib/i18n/catalog';
import { countdownClientScript, COUNTDOWN_CLIENT_SCRIPT } from '../src/lib/event-countdown';
import { formatEventPrice } from '../src/lib/event-price';
import { statLine } from '../src/lib/recap-stat-lines';

const SHARE = 'https://oursharedevents.com/es/events/evt_es/zz-title';
const NONCE = 'esnonce';
const HOUR = 3_600_000;

function row(overrides: Partial<PublicEventRow> = {}): PublicEventRow {
  return {
    id: 'evt_es',
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
    who_image_url: 'https://example.org/host.jpg',
    what_video_url: 'https://example.org/video',
    what_url: 'https://example.org/go',
    what_url_enabled: 1,
    what_url_type: 'tickets',
    lat: 41.7,
    lon: -87.7,
    price_cents: null,
    price_model: 'sliding',
    price_note: null,
    is_published: 1,
    event_type_id: null,
    event_type_name: 'ZZTYPE',
    ...overrides,
  };
}

// Big enough to clear the floor, small ones to draw "Fewer than 5" lines.
const SOCIAL = {
  sponsors: [{ id: 'sp1', name: 'ZZSPONSOR', website_url: null }],
  regCount: 40,
  checkinCount: 30,
  walkInCount: 10,
  surveyCount: 2,
  emailCount: 0,
};

const NEXT = [{ id: 'evt_next', title: 'ZZNEXT', start_date: '2026-12-05', location: 'ZZVENUE' }];

/** Names, not English prose: they read the same on a Spanish page. */
const NAMES = [
  'OurSharedEvents',
  'Google Maps',
  'Apple Maps',
  'Google Calendar',
  'Outlook',
  'English',
];

/** The text a reader sees or hears: element text plus alt / aria-label / title. */
function readerText(html: string): string {
  // Any case, any attributes, and a closing tag with trailing junk (`</script >`),
  // the way a browser reads them; a comment may also close with `--!>`.
  const body = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?--!?>/g, ' ');
  const attrs = [...body.matchAll(/\s(?:alt|aria-label|title)="([^"]*)"/g)].map((m) => m[1]);
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '';
  let text = [title, body.replace(/<[^>]+>/g, ' '), ...attrs].join(' \n ');
  text = text.replace(/ZZ[A-Z]+/g, ' ');
  for (const name of NAMES) text = text.split(name).join(' ');
  return text.replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
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
    const en = CATALOG.en[key] as string;
    if (SAME_IN_BOTH.includes(key)) continue;
    for (const part of en.replace(/<[^>]+>/g, ' ').split(/\{\w+\}/)) {
      const fragment = part
        .replace(/&[a-z]+;/g, ' ')
        .replace(/[→▶]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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
  'hosted',
  'live',
  'register',
  'share',
  'back',
  'fewer',
  'than',
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

const soon = () => new Date(Date.now() + 3 * HOUR).toISOString();

const PAGES: { name: string; html: () => string }[] = [
  {
    name: 'pre-event, with a countdown',
    html: () =>
      renderPreEventHtml(
        row({ starts_at: soon(), start_date: soon().slice(0, 10) }),
        SHARE,
        SOCIAL,
        {
          nonce: NONCE,
          lang: 'es',
          nextEvents: NEXT,
        }
      ),
  },
  {
    name: 'live',
    html: () =>
      renderEventLiveHtml(row(), SHARE, SOCIAL, { nonce: NONCE, lang: 'es', nextEvents: NEXT }),
  },
  {
    name: 'recap, with counts and next events',
    html: () => renderPostEventHtml(row(), SHARE, NEXT, SOCIAL, { nonce: NONCE, lang: 'es' }),
  },
  {
    name: 'recap, nothing written up and nothing next',
    html: () =>
      renderPostEventHtml(
        row({
          what_short: null,
          description: null,
          who_host: null,
          why_purpose: null,
          who_story: null,
          who_image_url: null,
        }),
        SHARE,
        [],
        SOCIAL,
        { nonce: NONCE, lang: 'es' }
      ),
  },
  {
    name: 'recap of an event called off before its day',
    html: () =>
      renderPostEventHtml(
        row({
          status: 'archived',
          starts_at: '2099-01-01T18:00:00Z',
          start_date: '2099-01-01',
          end_date: '2099-01-01',
        }),
        SHARE,
        [],
        SOCIAL,
        { nonce: NONCE, lang: 'es' }
      ),
  },
];

describe('Spanish event page | no English of ours on any phase', () => {
  it('the checks can fail: an English page is caught', () => {
    const english = renderPostEventHtml(row(), SHARE, NEXT, SOCIAL, { nonce: NONCE, lang: 'en' });
    const found = englishLeft(readerText(english));
    expect(found).toContain('catalog recap.chip: "This one\'s a wrap"');
    expect(found).toContain('word: "the"');
  });

  for (const page of PAGES) {
    it(`${page.name}: every word of ours is Spanish`, () => {
      const html = page.html();
      expect(html).toContain('<html lang="es"');
      expect(englishLeft(readerText(html))).toEqual([]);
    });
  }

  it('the recap reads its date, counts and floor in Spanish', () => {
    const text = readerText(
      renderPostEventHtml(row(), SHARE, NEXT, SOCIAL, { nonce: NONCE, lang: 'es' })
    );
    expect(text).toContain('Se realizó el sábado, 24 de octubre de 2026 · 6:00 p.m. CDT');
    expect(text).toContain('40 inscritos');
    expect(text).toContain('Menos de 5 encuestas enviadas');
    expect(text).toContain('Llegó el 75% de los inscritos');
  });

  it('the page tells link previews it is Spanish', () => {
    const html = renderPostEventHtml(row(), SHARE, NEXT, SOCIAL, { nonce: NONCE, lang: 'es' });
    expect(html).toContain('<meta property="og:locale" content="es_US" />');
  });

  it('a next event links to its Spanish page', () => {
    const html = renderPostEventHtml(row(), SHARE, NEXT, SOCIAL, { nonce: NONCE, lang: 'es' });
    expect(html).toContain('href="/es/events/evt_next"');
    expect(html).not.toContain('href="/events/evt_next"');
  });

  it('the countdown script the browser runs speaks Spanish too', () => {
    const html = PAGES[0].html();
    expect(html).toContain(countdownClientScript('es'));
    expect(html).not.toContain(COUNTDOWN_CLIENT_SCRIPT);
    // The script's string literals, quoted, so its `days()` function is not a hit.
    for (const english of ["'Starts", "'Starting", "' minute", "' hour", "' days'"]) {
      expect(countdownClientScript('es')).not.toContain(english);
    }
  });

  it('helpers stay English when no language is given', () => {
    expect(formatEventPrice({ price_cents: 0, price_model: null, price_note: null })).toBe('Free');
    expect(formatEventPrice({ price_cents: 0, price_model: null, price_note: null }, 'es')).toBe(
      'Gratis'
    );
    expect(statLine(2, 'Registered', 'x')).toBe('<p data-testid="x">Fewer than 5 Registered</p>');
    expect(statLine(2, 'inscritos', 'x', 'es')).toBe('<p data-testid="x">Menos de 5 inscritos</p>');
  });
});
