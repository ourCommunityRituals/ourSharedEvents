/**
 * One event card, one filter control, upcoming first (OSE-1520), and the consented
 * sponsor beside every event title the card shows (OSE-1522).
 *
 * Layers: pure renderers (string in, string out) and the served pages through
 * SELF with a real D1. Each test here was seen red before the change it guards;
 * the born-red notes sit beside the guards that are easy to get wrong.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  renderEventList,
  renderEventCard,
  EVENT_CARD_CSS,
  EVENT_CARD_CSS_MARKER,
  injectEventCardCss,
} from '../src/lib/event-list';
import {
  renderDiscoveryFilters,
  discoveryHeading,
  discoveryEmptyCopy,
  discoverySummaryText,
  orderUpcomingFirst,
  DISCOVERY_CHIPS,
} from '../src/lib/event-discovery';
import { renderLandingArea, LANDING_WINDOWS } from '../src/lib/landing-area';

// Two categories, so the Type row (one chip per category, owner 2026-11-09) is offered.
const TWO_CATEGORIES = new Map([
  ['etr-ent-trivia', { code: 'ENT', name: 'Entertainment & Trivia', order: 0 }],
  ['etr-soc-dinner', { code: 'SOC', name: 'Social & Community Dining', order: 1 }],
]);
import { seedSplitSponsor } from './helpers/seed-sponsor';

const NOW = new Date('2026-09-16T20:00:00Z'); // Wed Sep 16, 3pm Chicago
const tz = 'America/Chicago';
const ev = (id: string, date: string | null, phase = 'pre_event', name = id) => ({
  id,
  name,
  venue: 'Eagles Hall',
  startDateISO: date,
  phase,
  timezone: tz,
});

const ids = (html: string) => [...html.matchAll(/data-event-id="([^"]*)"/g)].map((m) => m[1]);

describe('OSE-1520 | one card component', () => {
  test('renderEventCard is the markup /events renders (date, venue, state-aware button)', () => {
    const card = renderEventCard(ev('a', '2026-10-24'));
    expect(card).toContain('data-testid="public-event-card"');
    expect(card).toContain('data-testid="public-event-date"');
    expect(card).toContain('data-testid="public-event-venue"');
    expect(card).toContain('data-cta="register"');
    expect(renderEventCard(ev('w', '2026-08-01', 'post_event'))).toContain('data-cta="recap"');
    expect(renderEventList([ev('a', '2026-10-24')]).html).toContain(card.trim());
  });

  test('a landing card is the same card: date, venue and a Register button, not name and venue only', () => {
    const html = renderLandingArea([ev('a', '2026-09-18')], { now: NOW.getTime() }).html;
    expect(html).toMatch(/<article class="event-card [^"]*"[^>]*data-testid="area-card"/);
    expect(html).toContain('data-testid="public-event-date"');
    expect(html).toContain('data-cta="register"');
    expect(html).toContain('data-testid="area-card-name"');
  });

  test('a landing card carries the consented sponsor by the title, the same line as /events', () => {
    const html = renderLandingArea([ev('a', '2026-09-18'), ev('b', '2026-09-19')], {
      now: NOW.getTime(),
      sponsorTitles: new Map([['a', 'Hall Bakery <b>']]),
    }).html;
    const a = html.split('data-event-id="a"')[1].split('</article>')[0];
    const b = html.split('data-event-id="b"')[1].split('</article>')[0];
    expect(a).toContain('Supported by Hall Bakery &lt;b&gt;');
    expect(b).not.toContain('Supported by');
  });

  test('landing and /events order cards upcoming first, undated last', () => {
    const items = [
      ev('late', '2026-10-30'),
      ev('undated', null),
      ev('soon', '2026-09-18'),
      ev('mid', '2026-10-05'),
    ];
    const landing = renderLandingArea(items, { now: NOW.getTime() }).html;
    expect(ids(landing)).toEqual(['soon', 'mid', 'late', 'undated']);
    expect(ids(renderEventList(items).html)).toEqual(['soon', 'mid', 'late', 'undated']);
  });
});

describe('OSE-1520 | upcoming first, wrapped under its own heading', () => {
  test('orderUpcomingFirst: soonest first; a live event that began earlier leads; wrapped most recent first', () => {
    const { upcoming, wrapped } = orderUpcomingFirst([
      ev('w-old', '2026-05-01', 'post_event'),
      ev('later', '2026-09-30'),
      ev('live', '2026-09-14', 'event'),
      ev('w-new', '2026-09-01', 'post_event'),
      ev('tonight', '2026-09-16'),
      ev('undated', null),
    ]);
    expect(upcoming.map((e) => e.id)).toEqual(['live', 'tonight', 'later', 'undated']);
    expect(wrapped.map((e) => e.id)).toEqual(['w-new', 'w-old']);
  });

  test('a wrapped event never leads the list (the staging bug: a wrapped May event first)', () => {
    const html = renderEventList([
      ev('may', '2026-05-01', 'post_event'),
      ev('oct', '2026-10-24'),
    ]).html;
    expect(ids(html)).toEqual(['oct', 'may']);
    expect(html.indexOf('data-testid="public-events-wrapped-heading"')).toBeGreaterThan(
      html.indexOf('data-event-id="oct"')
    );
    expect(html.indexOf('data-testid="public-events-wrapped-heading"')).toBeLessThan(
      html.indexOf('data-event-id="may"')
    );
  });

  test('no wrapped events: no wrapped heading; only wrapped events: says nothing is coming up first', () => {
    expect(renderEventList([ev('oct', '2026-10-24')]).html).not.toContain(
      'public-events-wrapped-heading'
    );
    const only = renderEventList([ev('may', '2026-05-01', 'post_event')]).html;
    expect(only).toContain('data-testid="public-events-none-upcoming"');
    expect(only.indexOf('none-upcoming')).toBeLessThan(only.indexOf('wrapped-heading'));
  });

  test('on the wrapped filter the page heading already says so: no second heading', () => {
    const html = renderEventList([ev('may', '2026-05-01', 'post_event')], undefined, {
      wrappedHeading: false,
    }).html;
    expect(html).not.toContain('wrapped-heading');
    expect(html).not.toContain('none-upcoming');
  });
});

describe('OSE-1520 | one filter control, four or five chips', () => {
  test('/events offers exactly five chips, in the landing order of windows', () => {
    expect([...DISCOVERY_CHIPS]).toEqual(['all', 'weekend', 'week', 'month', 'past']);
    const bar = renderDiscoveryFilters({ when: 'all', q: '' }, 3);
    const labels = [...bar.matchAll(/class="disc-chip[^"]*"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Everything',
      'This weekend',
      'Next 7 days',
      'This month',
      'Recently wrapped',
    ]);
  });

  test('a link to a window that is not a chip still shows as the active choice (six, never silently none)', () => {
    const bar = renderDiscoveryFilters({ when: 'today', q: '' }, 1);
    expect(bar).toMatch(/disc-when-today"[^>]*aria-current="true"/);
    expect((bar.match(/class="disc-chip[ "]/g) ?? []).length).toBe(6);
  });

  test('the landing offers the same labels for the same windows (weekend, 7 days, month, 90 days)', () => {
    expect([...LANDING_WINDOWS]).toEqual(['weekend', 'week', 'month', 'next-90']);
    const html = renderLandingArea([ev('a', '2026-09-18')], { now: NOW.getTime() }).html;
    const group = html.match(/data-testid="toggle-window">([^]*?)<\/fieldset>/)?.[1] ?? '';
    expect(group).toContain('class="disc-chip"');
    expect(group).toContain('>This weekend<');
  });

  test('the landing filter shrinks: no inert Kind group, Where and Type only when they can differ', () => {
    const html = renderLandingArea([ev('a', '2026-09-18'), ev('b', '2026-09-19')], {
      now: NOW.getTime(),
    }).html;
    expect(html).not.toContain('toggle-product');
    expect(html).not.toContain('prod-hybrid');
    // all in person, one category (Other): neither refinement is offered
    expect(html).not.toContain('toggle-modality');
    expect(html).not.toContain('toggle-type');
    const mixed = renderLandingArea(
      [
        { ...ev('a', '2026-09-18'), event_type_id: 'etr-soc-dinner' },
        { ...ev('b', '2026-09-19'), event_type_id: 'etr-ent-trivia', venue: '', location: '' },
      ],
      { now: NOW.getTime(), typeCategories: TWO_CATEGORIES }
    ).html;
    expect(mixed).toContain('toggle-modality');
    expect(mixed).toContain('toggle-type');
  });

  test('landing filter groups say what they are, visibly', () => {
    const mixed = renderLandingArea(
      [
        { ...ev('a', '2026-09-18'), event_type_id: 'etr-soc-dinner' },
        { ...ev('b', '2026-09-19'), event_type_id: 'etr-ent-trivia', venue: '', location: '' },
      ],
      { now: NOW.getTime(), typeCategories: TWO_CATEGORIES }
    ).html;
    const legend = (testid: string) =>
      mixed.match(new RegExp(`data-testid="${testid}"><legend[^>]*>([^<]*)<`))?.[1] ?? '';
    expect(legend('toggle-type')).toBe('Type');
    expect(legend('toggle-modality')).toBe('Where');
    expect(mixed).not.toMatch(/data-testid="toggle-type"><legend>/); // a class, not the sr-only default
  });

  test('keyboard focus is visible on a landing filter (the radios are not next to their labels)', () => {
    const html = renderLandingArea([ev('a', '2026-09-18')], { now: NOW.getTime() }).html;
    expect(html).toContain("#win-week:focus-visible ~ .toggles label[for='win-week']");
    expect(html).toContain("#view-map:focus-visible ~ .toggles label[for='view-map']");
  });

  test('heading follows the filter', () => {
    expect(discoveryHeading({ when: 'all', q: '' })).toBe('Upcoming events');
    expect(discoveryHeading({ when: 'weekend', q: '' })).toBe('This weekend');
    expect(discoveryHeading({ when: 'week', q: '' })).toBe('In the next 7 days');
    expect(discoveryHeading({ when: 'past', q: '' })).toBe('Recently wrapped');
    expect(discoveryHeading({ when: 'all', q: 'bocce' })).toBe('Matches for “bocce”');
  });

  test('the visible count and the screen-reader count are one sentence that cannot disagree', () => {
    // staging: hidden "1 upcoming event" beside visible "2 events"
    expect(discoverySummaryText({ when: 'all', q: '' }, 2, 1)).toBe('1 upcoming event, 1 wrapped');
    expect(discoverySummaryText({ when: 'all', q: '' }, 3, 0)).toBe('3 upcoming events');
    expect(discoverySummaryText({ when: 'month', q: '' }, 2)).toBe('2 events this month');
    expect(discoverySummaryText({ when: 'all', q: 'x' }, 1)).toBe('1 match for “x”');
    const bar = renderDiscoveryFilters({ when: 'all', q: '' }, 2, 1);
    expect(bar).toContain('data-testid="disc-summary">1 upcoming event, 1 wrapped<');
  });

  test('every empty state links to a wider range, as a link (OSE-1520: "Nothing in the next 7 days yet." was a dead end)', () => {
    const week = discoveryEmptyCopy({ when: 'week', q: '' });
    expect(week).toContain('Nothing in the next 7 days yet.');
    expect(week).toContain('<a href="/events?when=month"');
    expect(discoveryEmptyCopy({ when: 'weekend', q: '' })).toContain('href="/events?when=week"');
    expect(discoveryEmptyCopy({ when: 'today', q: '' })).toContain('href="/events?when=weekend"');
    expect(discoveryEmptyCopy({ when: 'month', q: '' })).toContain('href="/events?when=next-90"');
    expect(discoveryEmptyCopy({ when: 'next-month', q: '' })).toContain(
      'href="/events?when=next-90"'
    );
    expect(discoveryEmptyCopy({ when: 'next-90', q: '' })).toContain('href="/events"');
    expect(discoveryEmptyCopy({ when: 'past', q: '' })).toContain('href="/events"');
    // a search with no hit offers the same search without the words
    expect(discoveryEmptyCopy({ when: 'week', q: 'zzz' })).toContain('href="/events?when=week"');
  });
});

describe('OSE-1520 | the card and chips stylesheet (one copy, served to both pages)', () => {
  const css = EVENT_CARD_CSS;
  const rule = (selector: string): string => {
    const i = css.indexOf(`${selector} {`);
    expect(i, selector).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };

  test('below ~480px the button drops under the text and takes the card width', () => {
    const m = css.match(/@media \(max-width: 480px\) \{([^]*?)\n\s*\}/)?.[1] ?? '';
    const cta = m.match(/\.event-card \.cta \{([^}]*)\}/)?.[1] ?? '';
    expect(cta, 'the button rule inside the 480px query').toMatch(/flex: 1 1 100%/);
  });

  test('the info block keeps most of the card (the title was squeezed to 137px beside the button)', () => {
    expect(rule('.event-card')).toMatch(/flex-wrap: wrap/);
    expect(rule('.event-card .event-info')).toMatch(/flex: 1 1 \d+(\.\d+)?rem/);
  });

  test('search box, Search and the share button inherit the page font (they rendered in Arial)', () => {
    expect(rule('.disc-q')).toMatch(/font: inherit|font-family: inherit/);
    expect(rule('.disc-go')).toMatch(/font: inherit|font-family: inherit/);
  });

  test('card text and tag are not tiny: meta and button at least 0.95rem, wrapped tag at least 0.8rem', () => {
    const size = (sel: string) => Number(/font-size: ([\d.]+)rem/.exec(rule(sel))?.[1] ?? '0');
    expect(size('.event-card .meta')).toBeGreaterThanOrEqual(0.95);
    expect(size('.event-card .cta')).toBeGreaterThanOrEqual(0.95);
    expect(size('.tag-wrapped')).toBeGreaterThanOrEqual(0.8);
  });

  test('the segmented wrapper no longer leaves a 10px strip around 44px labels: chips are the controls themselves', () => {
    expect(rule('.disc-chip, .disc-clear')).toMatch(/min-height: 44px/);
    expect(css).not.toContain('.toggle-group {');
  });

  test('every colour is a token (no raw hex)', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test('the marker is replaced by the stylesheet, once', () => {
    const out = injectEventCardCss(`<style>a{}\n${EVENT_CARD_CSS_MARKER}</style>`);
    expect(out).not.toContain(EVENT_CARD_CSS_MARKER);
    expect(out).toContain('.event-card-link');
    expect(injectEventCardCss('<p>none</p>')).toBe('<p>none</p>');
  });
});

// ─── The served pages ───────────────────────────────────────────────────────────

const E = env as unknown as { DB: D1Database; TEST_MIGRATION_STATEMENTS: string };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function seedEvent(id: string, title: string, startDate: string): Promise<void> {
  await E.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, is_published, start_date,
            location, created_at, updated_at)
     VALUES (?, 'root', ?, ?, 'active', 1, ?, 'The Venue', datetime('now'), datetime('now'))`
  )
    .bind(id, title, id, startDate)
    .run();
}

describe('served pages', () => {
  beforeAll(async () => {
    for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
      try {
        await E.DB.prepare(stmt).run();
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.includes('duplicate column name') || m.includes('already exists')) continue;
        throw e;
      }
    }
    await seedEvent('evt_ecf_far', 'ECF Far Night', inDays(40));
    await seedEvent('evt_ecf_soon', 'ECF Soon Night', inDays(2));
    await seedEvent('evt_ecf_wrapped', 'ECF Wrapped Night', inDays(-30));
    await seedEvent('evt_ecf_landing', 'ECF Landing Night', inDays(3));
    await seedSplitSponsor(E.DB, {
      id: 'sp_ecf_landing',
      eventId: 'evt_ecf_landing',
      name: 'ECF Landing Sponsor',
      brandId: 'root',
    });
    // A draft is not on any list, so a sponsor consent on it must not surface either.
    await seedEvent('evt_ecf_draft', 'ECF Draft Night', inDays(5));
    await E.DB.prepare("UPDATE events SET status = 'draft' WHERE id = 'evt_ecf_draft'").run();
    await seedSplitSponsor(E.DB, {
      id: 'sp_ecf_draft',
      eventId: 'evt_ecf_draft',
      name: 'ECF Draft Sponsor',
      brandId: 'root',
    });
    // Live by link but off the list (is_published = 0): not listed, so not named here.
    await seedEvent('evt_ecf_unlisted', 'ECF Unlisted Night', inDays(6));
    await E.DB.prepare('UPDATE events SET is_published = 0 WHERE id = ?')
      .bind('evt_ecf_unlisted')
      .run();
    await seedSplitSponsor(E.DB, {
      id: 'sp_ecf_unlisted',
      eventId: 'evt_ecf_unlisted',
      name: 'ECF Unlisted Sponsor',
      brandId: 'root',
    });
    await seedEvent('evt_ecf_pending', 'ECF Pending Night', inDays(4));
    await seedSplitSponsor(E.DB, {
      id: 'sp_ecf_pending',
      eventId: 'evt_ecf_pending',
      name: 'ECF Pending Sponsor',
      brandId: 'root',
      sponsorAccepted: 0,
    });
  });

  const page = async (path: string) => (await SELF.fetch(`https://t.test${path}`)).text();

  test('/events: the stylesheet is in the page, the marker is gone, and the heading follows the filter', async () => {
    const html = await page('/events');
    expect(html).not.toContain(EVENT_CARD_CSS_MARKER);
    expect(html).not.toContain('<!--OCR_EVENTS_HEADING-->');
    expect(html).toContain('@media (max-width: 480px)');
    expect(html).toMatch(/data-testid="public-events-heading"[^>]*>Upcoming events</);
    expect(await page('/events?when=past')).toMatch(
      /data-testid="public-events-heading"[^>]*>Recently wrapped</
    );
  });

  test('/events: soonest first, the wrapped event under its own heading after every upcoming one', async () => {
    const html = await page('/events');
    const order = ids(html).filter((i) => i.startsWith('evt_ecf_'));
    const wrapped = order.indexOf('evt_ecf_wrapped');
    expect(wrapped).toBe(order.length - 1);
    expect(order.indexOf('evt_ecf_soon')).toBeLessThan(order.indexOf('evt_ecf_far'));
    expect(html).toContain('data-testid="public-events-wrapped-heading"');
  });

  test('/events: the visible count and the screen-reader count are the same sentence', async () => {
    const html = await page('/events');
    const visible = html.match(/data-testid="disc-summary">([^<]*)</)?.[1] ?? '';
    const live = html.match(/data-testid="public-events-count"[^>]*>([^<]*)</)?.[1] ?? '';
    expect(visible).toMatch(/upcoming event/);
    expect(visible).toContain('wrapped'); // this DB holds a wrapped event
    expect(live).toBe(visible);
  });

  test('/events: an empty window links to a wider one', async () => {
    const html = await page('/events?when=today&q=zzzz-no-such');
    expect(html).toContain('<a href="/events?when=today"');
  });

  test('landing: a listed event is a full card with its date and Register, and the consented sponsor shows', async () => {
    const html = await page('/');
    const card = html.split('data-event-id="evt_ecf_landing"')[1]?.split('</article>')[0] ?? '';
    expect(card, 'the event is on the landing').not.toBe('');
    expect(card).toContain('data-testid="public-event-date"');
    expect(card).toContain('data-cta="register"');
    expect(card).toContain('Supported by ECF Landing Sponsor');
    expect(html).not.toContain(EVENT_CARD_CSS_MARKER);
  });

  test('landing: a sponsor that has not said yes (ADR-019) is not on the card', async () => {
    const html = await page('/');
    expect(html).toContain('ECF Pending Night');
    expect(html).not.toContain('ECF Pending Sponsor');
  });

  test('GET /api/v2/events carries consented sponsor titles by event id, for the TV', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events');
    const body = (await res.json()) as {
      items: { id: string }[];
      sponsor_titles?: Record<string, string>;
    };
    expect(body.sponsor_titles?.['evt_ecf_landing']).toBe('ECF Landing Sponsor');
    expect(body.sponsor_titles?.['evt_ecf_pending']).toBeUndefined();
    // A sponsor consent on an event that is not listed (a draft) is not published here either.
    expect(body.sponsor_titles?.['evt_ecf_draft']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('ECF Draft Sponsor');
    expect(body.sponsor_titles?.['evt_ecf_unlisted']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('ECF Unlisted Sponsor');
    // Titles belong to listed events only; the items themselves are unchanged.
    for (const k of Object.keys(body.sponsor_titles ?? {})) {
      expect(body.items.map((i) => i.id)).toContain(k);
    }
  });
});
