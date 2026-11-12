/**
 * Typed text on the poster page stays text.
 *
 * `poster.html` builds its markup in the browser, by joining strings and
 * assigning the result as HTML. Every value from the poster bundle therefore has
 * to be escaped for the place it lands in: element text, or the value of a
 * quoted attribute. A quote mark left alone inside an attribute value ends that
 * value, and whatever follows is read as more attributes.
 *
 * This file runs the real page (every inline script, as served) in jsdom, twice
 * per case: once with plain values and once with the same values followed by a
 * tail of `"`, `'`, `<`, `>`, `&` and a backtick. The two pages must then be the
 * same tree (same elements, same attribute names on every element) and every
 * attribute value and text must differ only by that tail. Nothing is listed by
 * hand: an element the page starts drawing tomorrow is compared the day it is
 * drawn. Both poster kinds (print, digital), with and without artwork, the
 * picker path (bare /poster) and the admin draft preview are covered.
 *
 * Who types what (read from the handlers, 2026-10-08):
 *   - an organizer: the event name (`events.title`, 200), the venue
 *     (`events.location`, 500) and the artwork address
 *     (`events.cover_image_url`, 500, free text: handlers/events.ts caps its
 *     length and checks nothing else, on create and on update);
 *   - a sponsor or an organizer: the sponsor's title (display name, else
 *     business name);
 *   - the server makes the rest: ids, each code's kind, word, label, short code,
 *     link and picture, the UEC, the tier, dates and the time zone. Those are
 *     tested too ("values the server makes today"), because the page must not
 *     depend on the server never changing.
 *
 * What this file cannot see: what a browser would then DO with an injected
 * attribute. jsdom applies no Content-Security-Policy and loads no image.
 *
 * The second half of the file reads the page's scripts instead of running them
 * (tests/helpers/markup-attribute-check.ts, shared with the report page's spec).
 *
 * @born-red | method: the page tests were written first and run on the page as
 *   it was on main (9e1f0185). An event name holding a double quote ended the
 *   aria-label on the poster card and the alt on the artwork, in both poster
 *   kinds: the card and the image each gained `style`, `id` and `srcset` from
 *   the name. An artwork address did the same in `src`, and `javascript:` and
 *   `data:` addresses were drawn as written. This finished file against main's
 *   page: 55 of 90 red (34 page and address tests, the 3 escaper tests because
 *   the function did not exist, 18 source tests). Green from the start, so
 *   guards: the accepted artwork addresses, the live and preview link rules,
 *   the picture rule, the map and calendar links | date: 2026-10-08
 *
 * Seen red afterwards (one fault put in, this file and the other jsdom poster
 * specs run, the file restored; "page" = the two-page and attribute tests,
 * "address" = the address tests, "helper" = the escaper tests, "source" = the
 * parse of the scripts):
 *   the escaper leaves both quote marks alone, or the double     21 red  page, helper
 *   the escaper leaves the single quote alone                     2 red  helper only: the page has
 *                                                                        no single-quoted attribute
 *   the escaper leaves the ampersand alone                       19 red  page, helper
 *   the escaper prints null and undefined                         1 red  helper
 *   `esc` goes back to the textContent helper                    22 red  page, source
 *   the event name raw in aria-label / in the artwork alt     16 / 14 red  page, source
 *   a code label raw in the picture alt / the link aria-label   6 / 3 red  page, source
 *   a sponsor title raw in aria-label                            13 red  page, source
 *   raw in TEXT: event name, sponsor title, venue, option,
 *     code word                                        11, 9, 4, 2, 3 red  page only: the source
 *                                                                        check does not judge text
 *   the artwork address used without its check                   14 red  address, source
 *   the artwork check lets through javascript:, another host,
 *     data:, plain http, white space                    3, 2, 2, 1, 1 red  address only: the source
 *                                                                        check does not read a maker
 *   the artwork address checked but not escaped at the write      5 red  source only: the check
 *                                                                        already refuses quote marks
 *   the preview link check dropped / a live poster takes a link
 *     with no short code / the picture check dropped        3, 4, 2 red  address (and two older specs)
 *   a code link not escaped in href                               6 red  address, source
 *   the venue escaped, not encoded, in the map link               7 red  page, source
 *   an id not encoded: calendar link / sponsor logo           5 / 8 red  page, source
 *   raw where the page has already cut the value down: a kind
 *     in a data-testid, the poster kind, the sponsor tier     3, 4, 3 red  source only
 *   the UEC name raw in TEXT                                      0 red  SURVIVED: the page cuts it
 *                                                                        to A-Z and "-" first, and
 *                                                                        text is not judged by source
 * And eleven faults put into the source check itself (it stops asking for esc;
 * any function is a maker; any start is allowed; single quotes allowed again;
 * a maker declared twice; a checked address after other text; a name checked in
 * one place only; esc declared as anything; a checked address unescaped; a
 * maker assigned; the escaper assigned twice): each turned 1 to 15 tests red
 * here, and four of them also in the report page's spec.
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import POSTER_HTML from '../src/templates/poster.html';
import { escapeHtml } from '../src/lib/html-escape';
import {
  checkMarkupCode,
  checkMarkupPage,
  type MarkupRules,
} from './helpers/markup-attribute-check';

/**
 * Appended to every typed value in the hostile run. The HTML parser lower-cases
 * attribute names, so a break-out shows up as an `x1`, `y1`, `x2` or `z1`
 * attribute, or a `<b>`. The poster's own markup has none of those.
 */
const TAIL = '" X1="1" \' Y1=\'1\' <B X2>&AMP;&#39;</B> `Z1=1';
const INJECTED = '[x1], [y1], [x2], [z1], b';

type Fill = (key: string) => string;
const plain: Fill = (key) => `ZQ${key}`;
const hostile: Fill = (key) => `ZQ${key}${TAIL}`;

/** Take the tail back out of a value read from the hostile page. */
const untail = (s: string): string =>
  s.split(TAIL).join('').split(encodeURIComponent(TAIL)).join('');

type Row = [depth: number, node: string, attrs: Array<[string, string]> | string];

/** Every element (tag, attribute names and values) and text under `root`, in order. */
function tree(root: Element, clean: (s: string) => string = (s) => s): Row[] {
  const rows: Row[] = [];
  const walk = (node: Node, depth: number): void => {
    if (node.nodeType === 3) {
      const text = clean(node.nodeValue ?? '');
      if (text.trim()) rows.push([depth, '#text', text]);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    rows.push([
      depth,
      el.tagName,
      el
        .getAttributeNames()
        .sort()
        .map((name): [string, string] => [name, clean(el.getAttribute(name) ?? '')]),
    ]);
    for (const child of el.childNodes) walk(child, depth + 1);
  };
  walk(root, 0);
  return rows;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const EVT = 'evt_1';
const ORIGIN = 'https://ose.test';
const QR = 'data:image/png;base64,iVBORw0KGgo=';
const ART = '/api/v2/uploads/events/evt_1/art.png';
type Kind = 'print' | 'digital';
const KINDS: Kind[] = ['print', 'digital'];

/**
 * The title's size step follows its length, so the plain and the hostile name
 * are both made long enough to sit on the last step: the tail must not move it.
 */
const LONG = 'Harbor County Summer Bocce League Night Fundraiser Evening ';

interface Slot {
  kind: string;
  word: string;
  label: string;
  code: string | null;
  url: string;
  qr: string;
  uec: { id: string; color: string; scan_hex: string };
}

const slot = (kind: string, word: string, label: string, code: string, uec: string): Slot => ({
  kind,
  word,
  label,
  code,
  url: `${ORIGIN}/s/${code}`,
  qr: QR,
  uec: { id: uec, color: 'Green', scan_hex: '#0A7A3D' },
});

interface BundleOptions {
  art?: string | null;
  /** Fill for what the server makes today (labels, words, ids, tier). */
  made?: Fill | null;
  slots?: Slot[];
}

/** What GET /api/v2/events/:id/poster-bundle returns, typed values from `typed`. */
function bundle(typed: Fill, opts: BundleOptions = {}): Record<string, unknown> {
  const made = opts.made ?? null;
  const art = opts.art === undefined ? ART : opts.art;
  return {
    ok: true,
    status: 200,
    eventId: EVT,
    event: {
      id: EVT,
      name: LONG + typed('NAME'),
      venue: typed('VENUE'),
      // OSE-1825: the venue's street address, shown under the name on the
      // digital poster; the map links search it.
      where_address: typed('ADDRESS'),
      startDateISO: '2026-10-24',
      starts_at: '2026-10-24T23:00:00.000Z',
      timezone: 'America/Chicago',
      ...(art === null ? {} : { cover_image_url: art }),
    },
    sponsors: [
      // A display name, a logo of its own.
      {
        id: made ? made('SPID') : 'sp_1',
        name: typed('BUSINESS'),
        title: typed('SPONSORTITLE'),
        tier: made ? made('TIER') : 'gold',
        logo_url: 'https://logo.example.org/a.png',
      },
      // No display name and no logo: the business name and the default image.
      { id: 'sp_2', name: typed('BUSINESS2'), tier: 'primary', logo_url: null },
    ],
    slots: opts.slots ?? [
      slot(
        'public',
        made ? made('WORD') : 'EVENT',
        made ? made('LABEL') : 'Event page',
        'Cd0001',
        'UTILITY'
      ),
      slot(
        'donation',
        made ? made('WORD2') : 'DONATE',
        made ? made('LABEL2') : 'Donate',
        'Cd0002',
        'SHOP'
      ),
    ],
    settings: { showQRSection: true },
  };
}

interface Opened {
  doc: Document;
  win: JSDOM['window'];
}

/**
 * Open the poster as the Worker serves it. `mode`:
 *   scoped  - /poster?event=<id>: one poster-bundle call draws everything;
 *   picker  - bare /poster: the public events list draws the card, then the
 *             bundle fills the sponsors and the codes;
 *   preview - the admin draft preview: handlers/pages.ts names the event on
 *             <body>, and the page asks the admin bundle.
 */
async function openPoster(
  kind: Kind,
  body: Record<string, unknown>,
  mode: 'scoped' | 'picker' | 'preview' = 'scoped'
): Promise<Opened> {
  const served =
    mode === 'preview'
      ? POSTER_HTML.replace('<body>', `<body data-preview-event="${EVT}">`)
      : POSTER_HTML;
  if (mode === 'preview') expect(served).toContain(`<body data-preview-event="${EVT}">`);
  const url =
    mode === 'scoped'
      ? `${ORIGIN}/poster?event=${EVT}&kind=${kind}`
      : mode === 'picker'
        ? `${ORIGIN}/poster?kind=${kind}`
        : `${ORIGIN}/api/v2/admin/events/${EVT}/poster-preview?kind=${kind}`;
  const dom = new JSDOM(served, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = async (input: string) => {
        const path = String(input);
        if (path.includes('/poster-bundle')) return json(200, body);
        if (path === '/api/v2/events') return json(200, { ok: true, items: [body.event] });
        return json(404, { ok: false });
      };
    },
  });
  const doc = dom.window.document;
  // The bundle is drawn when the sponsor strip has stopped loading.
  for (let i = 0; i < 80; i++) {
    const strip = doc.querySelector('[data-testid="poster-sponsor-strip"]');
    if (strip && strip.getAttribute('aria-busy') === 'false') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  expect(doc.querySelector('[data-testid="poster-card"]'), 'the poster card').not.toBeNull();
  return { doc, win: dom.window };
}

const card = (doc: Document): Element => doc.querySelector('[data-testid="poster-card"]')!;
const names = (el: Element | null): string[] => (el ? el.getAttributeNames().sort() : []);

// `aria-current` and `href` are not in the template: syncChrome() sets them on
// every element with a data-kind, and the card has one. Harmless on a <div>,
// present on main before this file, and listed here so the list is the truth.
const CARD_ATTRIBUTES = [
  'aria-current',
  'aria-label',
  'class',
  'data-art',
  'data-codes',
  'data-kind',
  'data-layout',
  'data-testid',
  'href',
  'role',
  'style',
];
const ART_ATTRIBUTES = [
  'alt',
  'class',
  'data-hide-on-error',
  'data-testid',
  'referrerpolicy',
  'src',
];

// ─── What an organizer or a sponsor types ──────────────────────────────────────

describe('the poster (/poster?event=): what an organizer or a sponsor types', () => {
  test.each(KINDS)(
    '%s: an event name holding quote marks stays the value of the one aria-label on the poster',
    async (kind) => {
      const { doc } = await openPoster(kind, bundle(hostile));
      const name = LONG + hostile('NAME');
      expect(names(card(doc)), 'attributes on the poster card').toEqual(CARD_ATTRIBUTES);
      expect(card(doc).getAttribute('aria-label')).toBe(`${name} event poster`);
      // The attributes the template writes around it are still the template's.
      expect(card(doc).getAttribute('role')).toBe('article');
      expect(card(doc).getAttribute('data-kind')).toBe(kind);
      expect(doc.querySelector('[data-testid="poster-title"]')!.textContent).toBe(name);
    }
  );

  test.each(KINDS)(
    '%s: an event name holding quote marks stays the value of the one alt on the artwork',
    async (kind) => {
      const { doc } = await openPoster(kind, bundle(hostile));
      const img = doc.querySelector('[data-testid="poster-art-img"]');
      expect(img, 'the artwork image').not.toBeNull();
      expect(names(img), 'attributes on the artwork image').toEqual(ART_ATTRIBUTES);
      expect(img!.getAttribute('alt')).toBe(`${LONG}${hostile('NAME')} artwork`);
      expect(img!.getAttribute('src')).toBe(ART);
      expect(img!.getAttribute('class')).toBe('poster-art-img');
    }
  );

  test('a name that tries to restyle the poster, swap the artwork or take a page name adds none of those', async () => {
    // What a break-out would be used for. Inline handlers are refused by the
    // page's policy; these are the attributes it does not refuse.
    const name =
      'Bocce Night" style="position:fixed;inset:0;z-index:99" srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw=" name="getElementById" id="poster-print-btn';
    const body = bundle(plain);
    (body.event as Record<string, unknown>).name = name;
    const { doc } = await openPoster('print', body);
    const img = doc.querySelector('[data-testid="poster-art-img"]')!;
    for (const name of ['style', 'srcset', 'name', 'id']) {
      expect(img.hasAttribute(name), `artwork ${name}`).toBe(false);
    }
    for (const name of ['srcset', 'name', 'id']) {
      expect(card(doc).hasAttribute(name), `poster ${name}`).toBe(false);
    }
    // The card's style holds the layout's own two custom properties only.
    expect(card(doc).getAttribute('style') ?? '').not.toContain('position');
    expect(doc.querySelectorAll('#poster-print-btn')).toHaveLength(1);
    expect(doc.querySelector('#poster-print-btn')!.tagName).toBe('BUTTON');
    expect(typeof doc.getElementById).toBe('function');
    expect(doc.querySelector('[data-testid="poster-title"]')!.textContent).toBe(name);
  });

  const cases: Array<[string, Kind, string | null]> = [
    ['print, with artwork', 'print', ART],
    ['print, no artwork', 'print', null],
    ['digital, with artwork', 'digital', ART],
    ['digital, no artwork', 'digital', null],
  ];
  test.each(cases)(
    '%s: every typed value lands as text or as one attribute value',
    async (_name, kind, art) => {
      const calm = (await openPoster(kind, bundle(plain, { art }))).doc;
      const wild = (await openPoster(kind, bundle(hostile, { art }))).doc;
      expect(
        wild.querySelectorAll(INJECTED),
        'elements or attributes that were typed'
      ).toHaveLength(0);
      expect(tree(wild.body, untail)).toEqual(tree(calm.body));
      // The comparison is not vacuous: the tail is on the page, and the poster
      // is the one asked for.
      expect(wild.body.textContent).toContain(TAIL);
      expect(calm.body.textContent).not.toContain(TAIL);
      expect(card(calm).getAttribute('data-kind')).toBe(kind);
      expect(card(calm).getAttribute('data-art')).toBe(art ? '1' : '0');
      expect(calm.querySelectorAll('[data-testid="poster-art-img"]')).toHaveLength(art ? 1 : 0);
      expect(calm.querySelectorAll('#poster-qr-slots .code-card')).toHaveLength(2);
      expect(calm.querySelectorAll('[data-testid="poster-sponsor-item"]')).toHaveLength(2);
    }
  );

  test('the comparison sees the typed values: the name in two attributes and two texts, the venue, the sponsors', async () => {
    const { doc } = await openPoster('digital', bundle(hostile));
    const name = LONG + hostile('NAME');
    expect(card(doc).getAttribute('aria-label')).toBe(`${name} event poster`);
    expect(doc.querySelector('[data-testid="poster-art-img"]')!.getAttribute('alt')).toBe(
      `${name} artwork`
    );
    expect(doc.querySelector('[data-testid="poster-title"]')!.textContent).toBe(name);
    expect(doc.querySelector('[data-testid="poster-page-title"]')!.textContent).toBe(
      `${name} — digital poster`
    );
    const map = doc.querySelector('[data-testid="poster-open-map"]')!;
    expect(map.getAttribute('href')).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hostile('ADDRESS'))}`
    );
    expect(map.textContent).toBe('Google Maps');
    expect(doc.querySelector('[data-testid="poster-venue-name"]')!.textContent).toBe(
      hostile('VENUE')
    );
    expect(doc.querySelector('[data-testid="poster-venue-address"]')!.textContent).toBe(
      hostile('ADDRESS')
    );
    expect(doc.querySelector('[data-testid="poster-open-map-apple"]')!.getAttribute('href')).toBe(
      `https://maps.apple.com/?q=${encodeURIComponent(hostile('ADDRESS'))}`
    );
    // The share block carries the typed name as data, never as markup.
    const share = doc.querySelector('[data-testid="poster-share"]')!;
    expect(share.getAttribute('data-share-title')).toBe(name);
    expect(share.getAttribute('data-share-url')).toBe(`${ORIGIN}/events/${EVT}`);
    const sponsors = [...doc.querySelectorAll('[data-testid="poster-sponsor-item"]')];
    expect(sponsors.map((s) => s.getAttribute('aria-label'))).toEqual([
      hostile('SPONSORTITLE'),
      hostile('BUSINESS2'),
    ]);
    expect(
      sponsors.map((s) => s.querySelector('[data-testid="poster-sponsor-name"]')!.textContent)
    ).toEqual([hostile('SPONSORTITLE'), hostile('BUSINESS2')]);
    expect(sponsors.map((s) => s.querySelector('img')!.getAttribute('alt'))).toEqual([
      hostile('SPONSORTITLE'),
      hostile('BUSINESS2'),
    ]);
    expect(sponsors.map((s) => s.querySelector('img')!.getAttribute('src'))).toEqual([
      '/api/v2/sponsors/sp_1/logo',
      '/sponsor-default-logo.svg',
    ]);
  });

  test.each(KINDS)(
    '%s, bare /poster (the picker): the list draws the card and the option, the same way',
    async (kind) => {
      const calm = (await openPoster(kind, bundle(plain), 'picker')).doc;
      const wild = (await openPoster(kind, bundle(hostile), 'picker')).doc;
      expect(wild.querySelectorAll(INJECTED)).toHaveLength(0);
      expect(tree(wild.body, untail)).toEqual(tree(calm.body));
      const option = wild.querySelector('[data-testid="poster-event-picker"] option')!;
      expect(option.textContent).toBe(LONG + hostile('NAME'));
      expect(names(option)).toEqual(['value']);
      expect(names(card(wild))).toEqual(CARD_ATTRIBUTES);
    }
  );

  test.each(KINDS)('%s, the admin draft preview: the same', async (kind) => {
    const calm = (await openPoster(kind, bundle(plain), 'preview')).doc;
    const wild = (await openPoster(kind, bundle(hostile), 'preview')).doc;
    expect(wild.querySelectorAll(INJECTED)).toHaveLength(0);
    expect(tree(wild.body, untail)).toEqual(tree(calm.body));
    expect(wild.body.textContent).toContain(TAIL);
  });
});

// ─── What the server makes today ───────────────────────────────────────────────

describe('values the server makes today: a code label, a word, an id, a tier', () => {
  test.each(KINDS)(
    '%s: a label and a word holding quote marks land as text or as one attribute value',
    async (kind) => {
      const calm = (await openPoster(kind, bundle(plain, { made: plain }))).doc;
      const wild = (await openPoster(kind, bundle(plain, { made: hostile }))).doc;
      expect(wild.querySelectorAll(INJECTED)).toHaveLength(0);
      expect(tree(wild.body, untail)).toEqual(tree(calm.body));
      expect(wild.body.textContent).toContain(TAIL);
      const label = hostile('LABEL');
      if (kind === 'digital') {
        const link = wild.querySelector('[data-testid="qr-slot-code-public"]')!;
        expect(names(link)).toEqual([
          'aria-label',
          'class',
          'data-testid',
          'href',
          'rel',
          'target',
        ]);
        expect(link.getAttribute('aria-label')).toBe(label);
      } else {
        const link = wild.querySelector('[data-testid="qr-link-public"]')!;
        expect(names(link)).toEqual([
          'aria-label',
          'class',
          'data-testid',
          'href',
          'rel',
          'target',
        ]);
        expect(link.getAttribute('aria-label')).toBe(`${label} QR code — tap to open`);
        const img = link.querySelector('img')!;
        expect(names(img)).toEqual(['alt', 'class', 'data-testid', 'height', 'src', 'width']);
        expect(img.getAttribute('alt')).toBe(`${label} QR code`);
        expect(img.getAttribute('src')).toBe(QR);
      }
      expect(wild.querySelector('[data-testid="poster-qr-slot-label-public"]')!.textContent).toBe(
        `★ ${hostile('WORD')} · UTILITY`
      );
    }
  );

  test.each(KINDS)(
    '%s: text where a kind, a UEC, a short code, a picture or a tier is expected adds nothing either',
    async (kind) => {
      const t = hostile('X');
      const body = bundle(plain, {
        slots: [
          // Each of these is cut down to its own alphabet, or refused, by the page.
          { ...slot('public', 'EVENT', 'Event page', 'Cd0001', 'UTILITY'), kind: t },
          {
            ...slot('donation', 'DONATE', 'Donate', 'Cd0002', 'SHOP'),
            uec: { id: t, color: t, scan_hex: t },
          },
          { ...slot('signup', 'SIGN UP', 'Sign up', 'Cd0003', 'ENTER'), qr: QR + t },
          { ...slot('tickets', 'TICKETS', 'Get tickets', 'Cd0004', 'SHOP'), qr: t },
          // No valid short code: the code is not drawn at all on a live poster.
          { ...slot('menu', 'MENU', 'Menu', 'Cd0005', 'UTILITY'), code: t, url: t },
        ],
      });
      const sponsors = body.sponsors as Array<Record<string, unknown>>;
      sponsors[0].id = t;
      sponsors[0].tier = t;
      Object.assign(body.event as Record<string, unknown>, {
        id: `evt${t}`,
        timezone: t,
        starts_at: t,
        startDateISO: t,
      });
      const { doc } = await openPoster(kind, body);
      expect(doc.querySelectorAll(INJECTED)).toHaveLength(0);
      const cards = [...doc.querySelectorAll('#poster-qr-slots .code-card')];
      expect(cards).toHaveLength(4);
      for (const c of cards) {
        expect(names(c)).toEqual(
          expect.arrayContaining(['class', 'data-spot', 'data-testid', 'data-uec'])
        );
        expect(
          names(c).filter((n) => !/^(class|data-spot|data-testid|data-uec|style)$/.test(n))
        ).toEqual([]);
        for (const a of c.querySelectorAll('a')) {
          expect(a.getAttribute('href')).toMatch(/^https:\/\/ose\.test\/s\/Cd000[1-4]$/);
        }
        for (const img of c.querySelectorAll('img')) {
          expect(names(img)).toEqual(['alt', 'class', 'data-testid', 'height', 'src', 'width']);
        }
      }
      const item = doc.querySelector('[data-testid="poster-sponsor-item"]')!;
      // The digital poster shows one sponsor at a time: its rotation sets
      // data-effect and style on the item through the DOM, not through markup.
      expect(names(item).filter((n) => n !== 'data-effect' && n !== 'style')).toEqual([
        'aria-label',
        'class',
        'data-testid',
        'data-tier',
        'role',
      ]);
      expect(item.getAttribute('data-tier')).toBe('primary');
      expect(item.querySelector('img')!.getAttribute('src')).toBe(
        `/api/v2/sponsors/${encodeURIComponent(t)}/logo`
      );
      if (kind === 'digital') {
        expect(doc.querySelector('[data-testid="poster-add-to-calendar"]')).toBeNull();
      }
    }
  );
});

// ─── Addresses: what may reach src and href ────────────────────────────────────
//
// Escaping keeps an address inside its attribute. It does not decide what the
// address is: `javascript:` and `data:` survive escaping unchanged. So every
// address the page draws is either built on the page from a fixed start, or
// passes a check on the page first.

describe('the artwork address (typed, with no check when it is saved)', () => {
  const art = (doc: Document): Element | null =>
    doc.querySelector('[data-testid="poster-art-img"]');

  test.each([
    ['a file this Worker serves', '/api/v2/uploads/events/evt_1/art.png'],
    ['another path on this site', '/art-1516.svg'],
    ['an https address', 'https://img.example.org/poster-art.png'],
    ['an https address with a query', 'https://img.example.org/a.png?w=800&h=600'],
  ])('%s is drawn, as the one src', async (_name, address) => {
    for (const kind of KINDS) {
      const { doc } = await openPoster(kind, bundle(plain, { art: address }));
      expect(art(doc), kind).not.toBeNull();
      expect(names(art(doc))).toEqual(ART_ATTRIBUTES);
      expect(art(doc)!.getAttribute('src')).toBe(address);
      expect(card(doc).getAttribute('data-art')).toBe('1');
    }
  });

  test.each([
    ['javascript:', 'javascript:alert(1)'],
    ['javascript:, mixed case and padded', '  JaVaScRiPt:alert(1)'],
    ['an inline picture', 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['an inline page', 'data:text/html,<p>x</p>'],
    ['plain http', 'http://img.example.org/a.png'],
    ['another host with no scheme', '//img.example.org/a.png'],
    ['another host behind a backslash', '/\\img.example.org/a.png'],
    ['a tab hiding a second slash', '/\t/img.example.org/a.png'],
    ['blob:', 'blob:https://ose.test/0d1e'],
    ['a bare word', 'art.png'],
    ['an https address after a space', ' https://img.example.org/a.png'],
    ['an https address holding a space', 'https://img.example.org/a b.png'],
  ])('%s is not drawn: the poster is laid out as one with no artwork', async (_name, address) => {
    for (const kind of KINDS) {
      const { doc } = await openPoster(kind, bundle(plain, { art: address }));
      expect(art(doc), `${kind}: ${address}`).toBeNull();
      expect(doc.querySelector('.poster-art')).toBeNull();
      expect(card(doc).getAttribute('data-art')).toBe('0');
      expect(card(doc).getAttribute('data-layout')).toBe('row');
      expect(
        doc.querySelectorAll('img[src^="javascript:" i], img[src^="data:text" i]')
      ).toHaveLength(0);
    }
  });

  test.each([
    ['a path holding quote marks', `/api/v2/uploads/a.png${TAIL}`],
    ['an https address holding quote marks', `https://img.example.org/a.png${TAIL}`],
    ['a path holding a double quote only', '/api/v2/uploads/a.png" X1="1'],
    ['a path holding a single quote only', "/api/v2/uploads/a.png' Y1='1"],
  ])('%s adds no attribute and no element', async (_name, address) => {
    for (const kind of KINDS) {
      const { doc } = await openPoster(kind, bundle(plain, { art: address }));
      expect(doc.querySelectorAll(INJECTED), kind).toHaveLength(0);
      // Either it is not drawn, or it is the one src of an image with the
      // template's own attributes.
      if (art(doc)) {
        expect(names(art(doc))).toEqual(ART_ATTRIBUTES);
        expect(art(doc)!.getAttribute('src')).toBe(address);
      }
    }
  });
});

describe("a code's link and picture (made by the server; checked on the page all the same)", () => {
  const bad = [
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'http://ose.test.example.org/s/Cd0001',
    '//example.org/x',
    '/events/evt_1',
    'https://give.example.org/a b',
    'HTTPS://give.example.org/x',
  ];

  test.each(KINDS)(
    '%s, live poster: a code with no valid short code is not drawn',
    async (kind) => {
      const slots = bad.map((url, i) => ({
        ...slot('public', 'EVENT', 'Event page', `Cd000${i}`, 'UTILITY'),
        code: null,
        url,
      }));
      slots.push({ ...slot('menu', 'MENU', 'Menu', 'Cd0009', 'UTILITY'), code: 'Cd0009"x' });
      slots.push(slot('donation', 'DONATE', 'Donate', 'Cd0002', 'SHOP'));
      const { doc } = await openPoster(kind, bundle(plain, { slots }));
      const cards = [...doc.querySelectorAll('#poster-qr-slots .code-card')];
      expect(cards).toHaveLength(1);
      expect(
        [...doc.querySelectorAll('#poster-qr-slots a')].map((a) => a.getAttribute('href'))
      ).toEqual([`${ORIGIN}/s/Cd0002`]);
    }
  );

  test.each(KINDS)(
    '%s, draft preview: a code with no short code yet links only to this site or an https address',
    async (kind) => {
      const good = [`${ORIGIN}/events/evt_1`, 'https://give.example.org/harbor?x=1&y=2'];
      const slots = [...bad, ...good].map((url, i) => ({
        ...slot(['public', 'donation'][i % 2], 'EVENT', 'Event page', `Cd000${i}`, 'UTILITY'),
        code: null,
        url,
      }));
      const { doc } = await openPoster(kind, bundle(plain, { slots }), 'preview');
      expect(
        [...doc.querySelectorAll('#poster-qr-slots a')].map((a) => a.getAttribute('href'))
      ).toEqual(good);
      expect(doc.querySelectorAll('#poster-qr-slots .code-card')).toHaveLength(2);
    }
  );

  test.each(KINDS)(
    '%s, draft preview: a link on this site that holds quote marks stays the one href',
    async (kind) => {
      const url = `${ORIGIN}/events/evt_1${TAIL}`;
      const slots = [
        { ...slot('public', 'EVENT', 'Event page', 'Cd0001', 'UTILITY'), code: null, url },
      ];
      const { doc } = await openPoster(kind, bundle(plain, { slots }), 'preview');
      expect(doc.querySelectorAll(INJECTED)).toHaveLength(0);
      const link = doc.querySelector('#poster-qr-slots a')!;
      expect(link, 'the code link').not.toBeNull();
      expect(names(link)).toEqual(['aria-label', 'class', 'data-testid', 'href', 'rel', 'target']);
      expect(link.getAttribute('href')).toBe(url);
    }
  );

  test('print: a picture is drawn only from an inline PNG or GIF; anything else leaves the src empty', async () => {
    const pictures = [
      QR,
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:text/html;base64,PHA+',
      'javascript:alert(1)',
      'https://img.example.org/qr.png',
      '/qr.png',
    ];
    const slots = pictures.map((qr, i) => ({
      ...slot(
        ['public', 'donation', 'signup', 'tickets', 'menu', 'league', 'website'][i],
        'W',
        'L',
        `Cd000${i}`,
        'UTILITY'
      ),
      qr,
    }));
    const { doc } = await openPoster('print', bundle(plain, { slots }));
    expect(
      [...doc.querySelectorAll('#poster-qr-slots img')].map((i) => i.getAttribute('src'))
    ).toEqual([pictures[0], pictures[1], '', '', '', '', '']);
  });

  test('digital: the map links search the street address (else the venue), whatever it holds', async () => {
    for (const where of [
      'Harbor Hall, Sawyer',
      hostile('VENUE'),
      'javascript:alert(1)',
      '" href="javascript:alert(1)',
    ]) {
      // With an address the links search it; with none, the venue name.
      for (const withAddress of [true, false]) {
        const body = bundle(plain);
        const ev = body.event as Record<string, unknown>;
        if (withAddress) ev.where_address = where;
        else {
          delete ev.where_address;
          ev.venue = where;
        }
        const { doc } = await openPoster('digital', body);
        const map = doc.querySelector('[data-testid="poster-open-map"]')!;
        expect(names(map)).toEqual(['class', 'data-testid', 'href', 'rel', 'target']);
        expect(map.getAttribute('href')).toBe(
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`
        );
        const apple = doc.querySelector('[data-testid="poster-open-map-apple"]')!;
        expect(names(apple)).toEqual(['class', 'data-testid', 'href', 'rel', 'target']);
        expect(apple.getAttribute('href')).toBe(
          `https://maps.apple.com/?q=${encodeURIComponent(where)}`
        );
      }
    }
  });

  test('digital: the calendar link is this event’s own file, whatever the id holds', async () => {
    const body = bundle(plain);
    const id = `evt${TAIL}/../x`;
    (body.event as Record<string, unknown>).id = id;
    const { doc } = await openPoster('digital', body);
    const link = doc.querySelector('[data-testid="poster-add-to-calendar"]')!;
    expect(names(link)).toEqual(['class', 'data-testid', 'download', 'href']);
    expect(link.getAttribute('href')).toBe(`/events/${encodeURIComponent(id)}/calendar.ics`);
  });
});

// ─── The page's one escaper ────────────────────────────────────────────────────

describe('the page has one escaper, and it escapes quote marks', () => {
  async function pageEscaper(): Promise<(s: unknown) => string> {
    const { win } = await openPoster('print', bundle(plain));
    const fn = (win as unknown as { escapePosterHtml?: (s: unknown) => string }).escapePosterHtml;
    expect(typeof fn, 'window.escapePosterHtml').toBe('function');
    return fn!;
  }

  test('it gives what the server escaper (lib/html-escape) gives', async () => {
    const esc = await pageEscaper();
    const corpus = [
      '',
      'Harbor Bar',
      `O'Brien's "Back Room"`,
      '<b>&amp;</b>',
      '& < > " \'',
      '&&&"""\'\'\'<<<>>>',
      '&quot;&#39;&lt;',
      TAIL,
      'café   日本 🎳',
      'a\nb\tc',
      '`${x}`',
    ];
    for (const s of corpus) expect(esc(s), JSON.stringify(s)).toBe(escapeHtml(s));
    expect(esc(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  test('nothing comes back as "null" or "undefined", and a number is its digits', async () => {
    const esc = await pageEscaper();
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(0)).toBe('0');
    expect(esc(41.5)).toBe('41.5');
  });

  test('what it returns can sit in a double-quoted or a single-quoted attribute, or in text', async () => {
    const esc = await pageEscaper();
    const typed = `Harbor Bar${TAIL}`;
    const doc = new JSDOM(
      `<p id="dq" title="${esc(typed)}"></p><p id="sq" title='${esc(typed)}'></p><p id="tx">${esc(typed)}</p>`
    ).window.document;
    for (const id of ['dq', 'sq']) {
      const el = doc.getElementById(id)!;
      expect(el.getAttributeNames().sort()).toEqual(['id', 'title']);
      expect(el.getAttribute('title')).toBe(typed);
    }
    expect(doc.getElementById('tx')!.textContent).toBe(typed);
    expect(doc.getElementById('tx')!.children).toHaveLength(0);
    expect(doc.querySelectorAll('p')).toHaveLength(3);
  });
});

// ─── The source: every value written into an attribute goes through it ─────────
//
// The tests above show what the page draws today. This part reads the page's
// scripts and follows every string the page joins into markup, so that a NEW
// attribute write through anything but the escaper fails here, before there is a
// bundle that reaches it. The reader is tests/helpers/markup-attribute-check.ts,
// the one the report page is held to; what it checks and what it does not is
// written at the top of that file.
//
// This page needs two things the report page does not, and names both here:
//   - two addresses that leave the site: the venue's map searches, Google Maps
//     and Apple Maps (owner 2026-10-11). Each start is fixed text and the venue
//     follows it through encodeURIComponent;
//   - four addresses that come whole from the bundle. Each passes a function
//     on the page first (posterArtAddress, slotLink, slotPicture, and, OSE-1991,
//     posterSponsorSite for a sponsor's own site or card page) and is then
//     escaped. The source check only sees THAT each address goes through its
//     function; WHAT each function lets through is tested above, by address
//     (posterSponsorSite: poster-sponsor-header.spec.ts).

const HELPER = 'escapePosterHtml';
const MAP_START = 'https://www.google.com/maps/search/?api=1&amp;query=';
const APPLE_MAP_START = 'https://maps.apple.com/?q=';
// OSE-1825 / OSE-1371: the share links (owner 2026-09-28: plain share-intent
// addresses, no SDK). Each is fixed text, then the share text or the event's
// public address through encodeURIComponent.
const SHARE_STARTS = [
  'mailto:?body=',
  'sms:?&amp;body=',
  'https://wa.me/?text=',
  'https://www.facebook.com/sharer/sharer.php?u=',
  'https://twitter.com/intent/tweet?text=',
  'https://www.linkedin.com/sharing/share-offsite/?url=',
  'https://www.reddit.com/submit?url=',
  'https://t.me/share/url?url=',
];
const RULES: MarkupRules = {
  helper: HELPER,
  addressStarts: [MAP_START, APPLE_MAP_START, ...SHARE_STARTS],
  addressMakers: ['posterArtAddress', 'slotLink', 'slotPicture', 'posterSponsorSite'],
};
const checkPage = (page: string) => checkMarkupPage(page, RULES);
/** A piece of code on a page that has this page's escaper and address makers. */
const checkCode = (code: string) =>
  checkMarkupCode(
    `function posterArtAddress(raw) { return ''; }\nfunction slotLink(s) { return ''; }\nfunction slotPicture(s) { return ''; }\nfunction posterSponsorSite(s) { return ''; }\n${code}`,
    RULES
  );

describe('the source: every value written into an attribute goes through the escaper', () => {
  test('the check reads the page: its scripts, its escaper and the attribute writes it is there for', () => {
    const page = checkPage(POSTER_HTML);
    expect(page.scripts).toBe(2);
    // One script builds markup, and it has the page's one `esc`.
    expect(page.escDeclarations).toBe(1);
    const inAttribute = page.holes
      .filter((h) => h.mode === 'dq' || h.mode === 'sq')
      .map((h) => `${h.tag}[${h.attr}] ${h.expr.replace(/\s+/g, ' ')}`);
    expect(inAttribute).toEqual(
      expect.arrayContaining([
        'div[aria-label] esc(name)',
        'div[data-kind] esc(KIND)',
        'div[data-layout] esc(first.layout)',
        'img[alt] esc(name)',
        'img[src] esc(artAddress)',
        'a[href] encodeURIComponent(event.id)',
        'a[href] encodeURIComponent(where)',
        'a[href] encodeURIComponent(shareText)',
        'a[href] encodeURIComponent(shareUrl)',
        'div[data-share-url] esc(shareUrl)',
        'div[data-share-title] esc(name)',
        'div[data-share-text] esc(shareLine)',
        'option[value] esc(i)',
        'img[src] encodeURIComponent(s.id)',
        'img[alt] esc(title)',
        'div[aria-label] esc(title)',
        'div[data-tier] esc(tier)',
        'div[data-uec] esc(uecId)',
        'div[data-testid] esc(kind)',
        'a[href] esc(link)',
        'a[href] esc(site)',
        'a[aria-label] esc(title)',
        'span[data-testid] esc(testid)',
        'a[aria-label] esc(label)',
        'img[src] esc(picture)',
        'img[alt] esc(label)',
      ])
    );
    // No attribute on this page is written in single quotes.
    expect(page.holes.filter((h) => h.mode === 'sq')).toEqual([]);
    // And values in text position are seen too (they are not judged here).
    expect(page.holes.filter((h) => h.mode === 'text').length).toBeGreaterThan(15);
  });

  test('the page keeps the rule: nothing is written into an attribute any other way', () => {
    expect(checkPage(POSTER_HTML).findings).toEqual([]);
  });

  test('the same check, with only the report page’s rules, refuses this page’s own addresses and nothing else', () => {
    // The negative control for the two extra rules: take them away and exactly
    // the writes they are there for are named.
    const { findings } = checkMarkupPage(POSTER_HTML, { helper: HELPER });
    expect(findings.map((f) => f.replace(/^line \d+: /, '')).sort()).toEqual(
      [
        '`encodeURIComponent(where)` is written into an address, <a href="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed',
        '`encodeURIComponent(where)` is written into an address, <a href="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed',
        ...[
          'shareText',
          'shareText',
          'shareText',
          'shareText',
          'shareUrl',
          'shareUrl',
          'shareUrl',
          'shareUrl',
        ].map(
          (v) =>
            '`encodeURIComponent(' +
            v +
            ')` is written into an address, <a href="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed'
        ),
        '`esc(artAddress)` is written into an address, <img src="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed',
        '`esc(link)` is written into an address, <a href="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed',
        '`esc(link)` is written into an address, <a href="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed',
        '`esc(picture)` is written into an address, <img src="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed',
        // OSE-1991: a sponsor's own site, and its card page.
        '`esc(site)` is written into an address, <a href="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed',
        '`esc(site)` is written into an address, <a href="…">: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed',
      ].sort()
    );
  });

  // Each of these is the page with one fault put in. The check must name it.
  test.each<[string, (page: string) => string, RegExp]>([
    [
      'the event name written into the poster’s aria-label without the escaper',
      (p) =>
        p.replace(
          'aria-label="\' + esc(name) + \' event poster"',
          'aria-label="\' + name + \' event poster"'
        ),
      /`name` is written into <div aria-label="…"> without esc/,
    ],
    [
      'the event name written into the artwork’s alt without the escaper',
      (p) => p.replace('alt="\' + esc(name) + \' artwork"', 'alt="\' + name + \' artwork"'),
      /`name` is written into <img alt="…"> without esc/,
    ],
    [
      'a code’s label written into the picture’s alt without the escaper',
      (p) => p.replace('alt="\' + esc(label) + \' QR code"', 'alt="\' + label + \' QR code"'),
      /`label` is written into <img alt="…"> without esc/,
    ],
    [
      'a code’s label written into the link’s aria-label without the escaper',
      (p) => p.split("aria-label=\"' + esc(label) + '").join("aria-label=\"' + label + '"),
      /`label` is written into <a aria-label="…"> without esc/,
    ],
    [
      'a sponsor’s title written into aria-label through a second helper',
      (p) =>
        p.replace(
          'role="listitem" aria-label="\' + esc(title) + \'"',
          'role="listitem" aria-label="\' + attr(title) + \'"'
        ),
      /`attr\(title\)` is written into <div aria-label="…"> without esc/,
    ],
    [
      'the page goes back to its textContent-based helper',
      (p) =>
        p.replace(
          `const esc = window.${HELPER};`,
          "const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };"
        ),
      /`esc` is declared as something other than/,
    ],
    [
      'the escaper is replaced later in the page',
      (p) => p.replace('init();', `window.${HELPER} = (s) => s; init();`),
      /assigned 2 times/,
    ],
    [
      'the artwork address written without its check',
      (p) =>
        p.replace(
          'const artAddress = posterArtAddress(event.cover_image_url || event.coverImageUrl);',
          "const artAddress = event.cover_image_url || event.coverImageUrl || '';"
        ),
      /`esc\(artAddress\)` is written into an address, <img src="…">/,
    ],
    [
      'the artwork address checked but not escaped',
      (p) => p.replace('src="\' + esc(artAddress) + \'"', 'src="\' + artAddress + \'"'),
      /`artAddress` is written into an address, <img src="…">/,
    ],
    [
      'a code’s link taken from the bundle without its check',
      (p) => p.replace('const link = slotLink(s);', 'const link = s.url;'),
      /`esc\(link\)` is written into an address, <a href="…">/,
    ],
    [
      'a code’s picture taken from the bundle without its check',
      (p) => p.replace('src="\' + esc(picture) + \'"', 'src="\' + esc(s.qr) + \'"'),
      /`esc\(s\.qr\)` is written into an address, <img src="…">/,
    ],
    [
      'a second function with an address maker’s name',
      (p) => p.replace('init();', 'function slotLink(s) { return s.url; } init();'),
      /the address maker `slotLink` is declared 2 times/,
    ],
    [
      'an address maker replaced later in the page',
      (p) => p.replace('init();', 'posterArtAddress = function (raw) { return raw; }; init();'),
      /`posterArtAddress` is assigned; an address maker is one function/,
    ],
    [
      'the map link moved to another start',
      (p) => p.replace(MAP_START, 'https://maps.example.org/?q='),
      /`encodeURIComponent\(where\)` is written into an address, <a href="…">/,
    ],
    [
      'the venue escaped, not encoded, in the map link',
      (p) => p.replace(MAP_START + "' + encodeURIComponent(where)", MAP_START + "' + esc(where)"),
      /`esc\(where\)` is written into an address, <a href="…">/,
    ],
    [
      'the venue escaped, not encoded, in the Apple Maps link',
      (p) =>
        p.replace(
          APPLE_MAP_START + "' + encodeURIComponent(where)",
          APPLE_MAP_START + "' + esc(where)"
        ),
      /`esc\(where\)` is written into an address, <a href="…">/,
    ],
    [
      'a share link moved to another start',
      (p) => p.replace('https://wa.me/?text=', 'https://share.example.org/?text='),
      /`encodeURIComponent\(shareText\)` is written into an address, <a href="…">/,
    ],
    [
      'the event address escaped, not encoded, in a share link',
      (p) =>
        p.replace(
          "sharer.php?u=' + encodeURIComponent(shareUrl)",
          "sharer.php?u=' + esc(shareUrl)"
        ),
      /`esc\(shareUrl\)` is written into an address, <a href="…">/,
    ],
    [
      'the share title written into its data attribute without the escaper',
      (p) =>
        p.replace('data-share-title="\' + esc(name) + \'"', 'data-share-title="\' + name + \'"'),
      /`name` is written into <div data-share-title="…"> without esc/,
    ],
    [
      'the event id escaped, not encoded, in the calendar link',
      (p) =>
        p.replace(
          'href="/events/\' + encodeURIComponent(event.id) + \'/calendar.ics"',
          'href="/events/\' + esc(event.id) + \'/calendar.ics"'
        ),
      /`esc\(event\.id\)` is written into an address, <a href="…">/,
    ],
    [
      'a sponsor id written into the logo address without encodeURIComponent',
      (p) =>
        p.replace(
          "'/api/v2/sponsors/' + encodeURIComponent(s.id) + '/logo'",
          "'/api/v2/sponsors/' + s.id + '/logo'"
        ),
      /`s\.id` is written into an address, <img src="…">/,
    ],
    [
      'the poster kind written into data-kind unescaped',
      (p) => p.replace('data-kind="\' + esc(KIND) + \'"', 'data-kind="\' + KIND + \'"'),
      /`KIND` is written into <div data-kind="…"> without esc/,
    ],
    [
      'a code’s kind written into a data-testid unescaped',
      (p) =>
        p.replace(
          'data-testid="qr-img-slot-\' + esc(kind) + \'"',
          'data-testid="qr-img-slot-\' + kind + \'"'
        ),
      /`kind` is written into <img data-testid="…"> without esc/,
    ],
  ])('a planted fault is named: %s', (_name, plant, expected) => {
    const page = POSTER_HTML.split('\r\n').join('\n');
    const faulty = plant(page);
    expect(faulty, 'the fault was planted').not.toBe(page);
    const { findings } = checkPage(faulty);
    expect(findings.length, findings.join('\n')).toBeGreaterThan(0);
    expect(findings.join('\n')).toMatch(expected);
  });

  // The same, on small pieces of code: the ways a future edit could misuse the
  // two rules this page adds. (The report page's spec plants the rest.)
  test.each<[string, string, RegExp]>([
    [
      'a checked address written without the escaper',
      `el.innerHTML = '<a href="' + slotLink(s) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'a checked address after text of the page’s own',
      `el.innerHTML = '<a href="javascript:' + esc(slotLink(s)) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'a second value after a checked address',
      `el.innerHTML = '<a href="' + esc(slotLink(s)) + esc(more) + '">x</a>';`,
      /`esc\(more\)` is written into an address/,
    ],
    [
      'an address from a function that is not on the list',
      `function anyLink(s) { return s.url; } el.innerHTML = '<a href="' + esc(anyLink(s)) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'an address from a method with a listed name',
      `el.innerHTML = '<a href="' + esc(s.slotLink(s)) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'a checked address kept in a let',
      `let link = slotLink(s); el.innerHTML = '<a href="' + esc(link) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'a name that is a checked address in one place and a parameter in another',
      `const link = slotLink(s); function row(link) { return '<a href="' + esc(link) + '">x</a>'; }`,
      /written into an address/,
    ],
    [
      'a name that is a checked address in one place and raw in another',
      `function a(s) { const link = slotLink(s); return link; } function b(s) { const link = s.url; return '<a href="' + esc(link) + '">x</a>'; }`,
      /written into an address/,
    ],
    [
      'an address maker taken as a parameter',
      `function row(slotPicture, s) { return '<img src="' + esc(slotPicture(s)) + '">'; }`,
      /the address maker `slotPicture` is declared 2 times/,
    ],
    [
      'an encoded value after a start that is not listed',
      `el.innerHTML = '<a href="https://maps.example.org/?q=' + encodeURIComponent(v) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'the listed start written with a bare ampersand',
      `el.innerHTML = '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'a value before the listed start is complete',
      `el.innerHTML = '<a href="https://www.google.com/maps/' + encodeURIComponent(v) + '">x</a>';`,
      /written into an address/,
    ],
    [
      "an encoded value in a single-quoted address (encodeURIComponent leaves ' alone)",
      `el.innerHTML = "<a href='/events/" + encodeURIComponent(id) + "'>x</a>";`,
      /in single quotes/,
    ],
  ])('a planted fault is named: %s', (_name, code, expected) => {
    const { findings } = checkCode(code);
    expect(findings.join('\n')).toMatch(expected);
  });

  // The other direction: the two rules allow what they are there for.
  test.each<[string, string]>([
    ['a checked address, escaped', `el.innerHTML = '<a href="' + esc(slotLink(s)) + '">x</a>';`],
    [
      'a checked address held in a const, escaped',
      `const link = slotLink(s); el.innerHTML = '<a href="' + esc(link) + '">' + esc(link) + '</a>';`,
    ],
    [
      'the same in single quotes (the escaper covers both quote marks)',
      `const artAddress = posterArtAddress(e.cover); el.innerHTML = "<img src='" + esc(artAddress) + "' alt='" + esc(e.name) + "'>";`,
    ],
    [
      'the listed start with one encoded value',
      `el.innerHTML = '<a href="${MAP_START}' + encodeURIComponent(venue) + '">' + esc(venue) + '</a>';`,
    ],
    [
      'a fixed path with an encoded id, or a fixed file',
      `el.innerHTML = '<img src="' + (s.logo ? '/api/v2/sponsors/' + encodeURIComponent(s.id) + '/logo' : '/default.svg') + '" alt="' + esc(s.title) + '">';`,
    ],
  ])('nothing to report: %s', (_name, code) => {
    expect(checkCode(code).findings).toEqual([]);
  });
});
