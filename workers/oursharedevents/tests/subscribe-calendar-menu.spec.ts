/**
 * OSE-2045 — "Subscribe to calendar" on the public event page.
 *
 * Owner, 2026-11-14: a subscription offers the online calendars first, then the
 * .ics address. The menu subscribes to the event's brand feed
 * (/brands/<brand>/calendar.ics, OSE-2013) and shows only on an event that is
 * itself in that feed.
 *
 * Node-clean render test (same seam as calendar-action.spec.ts): it imports the
 * renderers and the link builder and asserts their output. No cloudflare:test.
 *
 * Born red, each watched failing on an injected fault:
 *   1. the order (the .ics link moved first);
 *   2. the listed rule (the menu shown for an event that is not in the feed);
 *   3. the links (a tracking parameter added; an organizer's text reaching one).
 */
import { describe, it, expect } from 'vitest';
import {
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  renderSubscribeMenu,
  type PublicEventRow,
} from '../src/handlers/pages';
import { buildBrandSubscribeLinks } from '../src/lib/calendar-links';
import type { Lang } from '../src/lib/i18n/catalog';

function row(overrides: Partial<PublicEventRow> = {}): PublicEventRow {
  return {
    id: 'evt_x',
    brand_id: 'riverside-arts',
    title: 'Parish Spring Fundraiser',
    slug: 'parish-spring-fundraiser',
    status: 'active',
    is_published: 1,
    description: 'A neighborhood fundraiser.',
    location: 'St. Barnabas Hall',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    what_short: 'Come support the cause.',
    who_host: 'The Parish Council',
    why_purpose: null,
    how_details: null,
    where_address: '123 Main St',
    who_story: null,
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: null,
    lon: null,
    price_cents: null,
    price_model: null,
    price_note: null,
    ...overrides,
  } as PublicEventRow;
}

const ORIGIN = 'https://oursharedevents.com';
const SHARE = `${ORIGIN}/events/evt_x`;
const FEED = `${ORIGIN}/brands/riverside-arts/calendar.ics`;
const WEBCAL = 'webcal://oursharedevents.com/brands/riverside-arts/calendar.ics';
const NOW = new Date('2026-10-01T12:00:00Z');

/** The hrefs of the menu's options, in the order they are written. */
function optionHrefs(html: string): { testid: string; href: string }[] {
  const menu =
    /<details class="ose-calendar-menu" data-testid="subscribe-calendar">[\s\S]*?<\/details>/.exec(
      html
    )?.[0];
  if (!menu) return [];
  return [...menu.matchAll(/data-testid="(subscribe-calendar-[a-z]+)" href="([^"]*)"/g)].map(
    (m) => ({
      testid: m[1],
      href: m[2].replace(/&amp;/g, '&'),
    })
  );
}

describe('OSE-2045 subscribe links', () => {
  it('builds the four links from the origin and the brand id alone', () => {
    expect(buildBrandSubscribeLinks(ORIGIN, 'riverside-arts')).toEqual({
      google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(WEBCAL)}`,
      outlook:
        'https://outlook.live.com/calendar/0/addfromweb' +
        `?url=${encodeURIComponent(FEED)}&name=${encodeURIComponent('OurSharedEvents: riverside-arts')}`,
      webcal: WEBCAL,
      ics: FEED,
    });
  });

  it('BORN RED 3: a link carries the feed address and nothing else', () => {
    const links = buildBrandSubscribeLinks(ORIGIN, 'riverside-arts');
    expect(links).not.toBeNull();
    if (!links) return;
    // Exactly the parameters each calendar needs.
    expect([...new URL(links.google).searchParams.keys()]).toEqual(['cid']);
    expect([...new URL(links.outlook).searchParams.keys()]).toEqual(['url', 'name']);
    expect(new URL(links.ics).search).toBe('');
    expect(new URL(links.webcal).search).toBe('');
    for (const link of Object.values(links)) {
      expect(link).not.toMatch(/utm_|ref=|source=|fbclid|gclid/);
    }
    // The feed address each online calendar is handed is this site's own feed.
    expect(new URL(links.google).searchParams.get('cid')).toBe(WEBCAL);
    expect(new URL(links.outlook).searchParams.get('url')).toBe(FEED);
  });

  it('refuses a brand id the feed route would not accept, and a non-web origin', () => {
    for (const bad of ['', 'UPPER', 'a b', 'a/b', '../root', 'x"onclick="y', 'a'.repeat(65), 'ñ']) {
      expect(buildBrandSubscribeLinks(ORIGIN, bad), bad).toBeNull();
    }
    expect(buildBrandSubscribeLinks('javascript:alert(1)', 'root')).toBeNull();
    expect(buildBrandSubscribeLinks('not a url', 'root')).toBeNull();
  });

  it('keeps the host and port of a local origin, and never upgrades the feed scheme', () => {
    const links = buildBrandSubscribeLinks('http://127.0.0.1:8787', 'root');
    expect(links?.ics).toBe('http://127.0.0.1:8787/brands/root/calendar.ics');
    expect(links?.webcal).toBe('webcal://127.0.0.1:8787/brands/root/calendar.ics');
  });
});

describe('OSE-2045 subscribe menu: order and content', () => {
  it('BORN RED 1: online calendars first, then Apple, then the .ics address', () => {
    const options = optionHrefs(renderSubscribeMenu(row(), ORIGIN, 'en', NOW));
    expect(options.map((o) => o.testid)).toEqual([
      'subscribe-calendar-google',
      'subscribe-calendar-outlook',
      'subscribe-calendar-apple',
      'subscribe-calendar-ics',
    ]);
    expect(options[0].href.startsWith('https://calendar.google.com/')).toBe(true);
    expect(options[1].href.startsWith('https://outlook.live.com/')).toBe(true);
    expect(options[2].href).toBe(WEBCAL);
    expect(options[3].href).toBe(FEED);
  });

  it('is the same CSP-safe disclosure as Add to calendar: no script, no inline handler', () => {
    const html = renderSubscribeMenu(row(), ORIGIN, 'en', NOW);
    expect(html).toContain('<details class="ose-calendar-menu" data-testid="subscribe-calendar">');
    expect(html).toContain('data-testid="subscribe-calendar-summary"');
    expect(html).toContain('role="group" aria-label="Subscribe to calendar"');
    expect(html).not.toMatch(/<script|onclick=|style=/i);
    // The two links that leave the site open in a new tab without handing over this page.
    for (const testid of ['subscribe-calendar-google', 'subscribe-calendar-outlook']) {
      expect(html).toMatch(
        new RegExp(`data-testid="${testid}"[^>]*target="_blank" rel="noopener noreferrer"`)
      );
    }
  });

  it('nothing an organizer typed reaches the menu', () => {
    const html = renderSubscribeMenu(
      row({
        title: 'TITLE-MARKER "><script>',
        description: 'DESCRIPTION-MARKER',
        location: 'LOCATION-MARKER',
        who_host: 'HOST-MARKER',
        slug: 'slug-marker',
      }),
      ORIGIN,
      'en',
      NOW
    );
    expect(html).not.toMatch(/MARKER|slug-marker|<script/);
  });

  for (const [lang, label, apple, ics] of [
    ['en', 'Subscribe to calendar', 'Apple Calendar', 'Calendar address (.ics)'],
    ['es', 'Suscribirse al calendario', 'Calendario de Apple', 'Dirección del calendario (.ics)'],
    ['pl', 'Subskrybuj kalendarz', 'Kalendarz Apple', 'Adres kalendarza (.ics)'],
    ['ar', 'اشترك في التقويم', 'تقويم Apple', 'عنوان التقويم'],
  ] as const) {
    it(`renders in ${lang}, with the same four links`, () => {
      const html = renderSubscribeMenu(row(), ORIGIN, lang as Lang, NOW);
      expect(html).toContain(`>${label}</summary>`);
      expect(html).toContain(`>${apple}</a>`);
      expect(html).toContain(`>${ics}</a>`);
      expect(optionHrefs(html).map((o) => o.href)).toEqual(
        optionHrefs(renderSubscribeMenu(row(), ORIGIN, 'en', NOW)).map((o) => o.href)
      );
    });
  }
});

describe('OSE-2045 subscribe menu: only for an event that is in the feed', () => {
  it('BORN RED 2: absent when the event is not published, not active, or still in its publish grace', () => {
    const notInFeed: [string, Partial<PublicEventRow>][] = [
      ['off the map', { is_published: 0 }],
      ['is_published unset', { is_published: null }],
      ['draft', { status: 'draft' }],
      ['ready', { status: 'ready' }],
      ['archived', { status: 'archived' }],
      ['in its publish grace', { listed_from: '2026-10-01T12:05:00.000Z' }],
      ['an unreadable listed_from', { listed_from: 'soon' }],
      ['a brand id the feed would refuse', { brand_id: 'Not A Brand' }],
    ];
    for (const [name, overrides] of notInFeed) {
      expect(renderSubscribeMenu(row(overrides), ORIGIN, 'en', NOW), name).toBe('');
    }
  });

  it('present once the publish grace is over, and when there was none', () => {
    expect(
      renderSubscribeMenu(row({ listed_from: '2026-10-01T11:59:00.000Z' }), ORIGIN, 'en', NOW)
    ).not.toBe('');
    expect(renderSubscribeMenu(row({ listed_from: null }), ORIGIN, 'en', NOW)).not.toBe('');
  });
});

describe('OSE-2045 subscribe menu on the page, every phase', () => {
  for (const [phase, render] of [
    ['pre', (r: PublicEventRow) => renderPreEventHtml(r, SHARE)],
    ['live', (r: PublicEventRow) => renderEventLiveHtml(r, SHARE)],
    ['post', (r: PublicEventRow) => renderPostEventHtml(r, SHARE, [])],
  ] as const) {
    it(`${phase}: a listed event offers it once, inside the actions row`, () => {
      const html = render(row());
      expect(html.match(/data-testid="subscribe-calendar"/g)).toHaveLength(1);
      const actions = html.slice(html.indexOf('data-testid="event-actions"'));
      expect(actions.indexOf('data-testid="subscribe-calendar"')).toBeGreaterThan(0);
      expect(optionHrefs(html).map((o) => o.href)[3]).toBe(FEED);
    });

    it(`${phase}: an event that opens by link only does not offer it`, () => {
      expect(render(row({ is_published: 0 }))).not.toContain('subscribe-calendar');
    });
  }

  it('the page still has one h1 and the Add to calendar menu is unchanged', () => {
    const html = renderPreEventHtml(row(), SHARE);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('data-testid="add-to-calendar"');
    expect(html).toContain('href="/events/evt_x/calendar.ics"');
  });
});
