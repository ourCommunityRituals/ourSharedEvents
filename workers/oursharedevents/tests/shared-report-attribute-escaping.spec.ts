/**
 * Typed text on the SharedReport page stays text.
 *
 * `shared-report.html` builds its markup in the browser, by joining strings and
 * assigning the result as HTML. Every value from the report JSON or the events
 * list therefore has to be escaped for the place it lands in: element text, or
 * the value of a quoted attribute. A quote mark left alone inside an attribute
 * value ends that value, and whatever follows is read as more attributes.
 *
 * This file runs the real page script in jsdom, twice per view: once with plain
 * values and once with the same values followed by a tail of `"`, `'`, `<`, `>`,
 * `&` and a backtick. The two pages must then be the same tree (same elements,
 * same attribute names on every element) and every attribute value and text
 * must differ only by that tail. Nothing is listed by hand: an element the page
 * starts drawing tomorrow is compared the day it is drawn.
 *
 * Two views are covered:
 *   - the no-token view (bare /sharedReport): the events table, the sponsor
 *     cards and the funnel table, fed by the public events list;
 *   - the signed-link view (a sponsor's or bar owner's link): the report itself.
 *
 * What this file cannot see: what a browser would then DO with an injected
 * attribute. jsdom applies no Content-Security-Policy and loads no image. The
 * reach under the page's policy is described in the pull request, not measured
 * here.
 *
 * @born-red | method: the two-page tests were written first and run on the page
 *   as it was on main: 8 of 9 failed (the venue label carried `x1`, `y1` and six
 *   more attributes besides class and title; so did the map image, the status
 *   badge and the locked-section group). The ninth, numbers and dates, passed
 *   from the start and is a guard | date: 2026-10-08
 *
 * Seen red afterwards (one fault put into the page, this file run, page
 * restored; "page" = the two-page tests, "helper" = the escaper tests,
 * "source" = the parse of the scripts):
 *   main's page under the finished file                        15 red  page, helper, source
 *   the escaper leaves both quote marks alone                  10 red  page, helper
 *   the escaper leaves the single quote alone                   2 red  helper only: the page has
 *                                                                      no single-quoted attribute
 *   the escaper prints null and undefined                       1 red  helper
 *   the events table script keeps its own old helper            7 red  page, source
 *   the sponsor cards script keeps its own old helper           2 red  source only: it writes text
 *   the venue raw in title                                      6 red  page, source
 *   the venue through the old helper, inline, in alt            6 red  page, source
 *   the status raw in the badge class                           6 red  page, source
 *   the depth raw in the conditional data-next-depth            4 red  page, source (and 1 in
 *                                                                      shared-report-locked-sections)
 *   the event title raw in TEXT position                        2 red  page only: the source check
 *                                                                      does not judge text
 *   a payload value in a style and a bare number in a title     2 red  source only: no payload in
 *                                                                      the tests carries that field
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import REPORT_HTML from '../src/templates/shared-report.html';
import { escapeHtml } from '../src/lib/html-escape';
import {
  checkMarkupCode,
  checkMarkupPage,
  type MarkupRules,
} from './helpers/markup-attribute-check';

/**
 * Appended to every typed value in the hostile run. Upper case and digits only,
 * so the page's own text transforms (first-letter capitals on section names and
 * depths) leave it as written. The HTML parser lower-cases attribute names, so
 * a break-out shows up as an `x1`, `y1`, `x2` or `z1` attribute, or a `<b>`.
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

async function until(doc: Document, selectors: string[]): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (selectors.every((s) => doc.querySelector(s))) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  for (const s of selectors) expect(doc.querySelector(s), `${s} rendered`).not.toBeNull();
}

// ─── The no-token view: events table, sponsor cards, funnel ────────────────────

interface ListedEvent {
  id: string;
  title: string;
  name: string;
  location: string;
  status: string;
  start_date: string;
}

function listedEvent(fill: Fill): ListedEvent {
  return {
    id: fill('ID'),
    title: fill('TITLE'),
    name: fill('NAME'),
    location: fill('VENUE'),
    status: fill('STATUS'),
    start_date: '2026-10-24',
  };
}

/**
 * Open bare /sharedReport as the Worker serves it. `maps` mirrors
 * handleSharedReportPage(), which marks the body when the venue map is set up;
 * the page then draws a map image and a venue label for each event.
 */
async function openList(event: Partial<ListedEvent>, maps: boolean): Promise<Document> {
  const served = maps
    ? REPORT_HTML.replace('<body>', '<body data-maps-configured="1">')
    : REPORT_HTML;
  if (maps) expect(served).toContain('<body data-maps-configured="1">');
  const dom = new JSDOM(served, {
    url: 'https://ose.test/sharedReport',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = async (input: string) => {
        const url = String(input);
        if (url === '/api/v2/events') return json(200, { ok: true, items: [event] });
        if (url.endsWith('/sponsors')) {
          const fill = event.title === plain('TITLE') ? plain : hostile;
          return json(200, {
            ok: true,
            items: [{ id: 'sp_1', name: fill('SPONSOR'), tier: fill('TIER'), is_active: 1 }],
          });
        }
        if (url.includes('/flags/current-tier')) return json(200, { ok: true, tier: 'mid' });
        if (url.endsWith('/forms/registrations')) return json(200, { ok: true, count: 8 });
        if (url.endsWith('/forms/checkin-count')) return json(200, { ok: true, count: 4 });
        return json(404, { ok: false });
      };
    },
  });
  const doc = dom.window.document;
  await until(doc, [
    '[data-testid="events-table"]',
    '[data-testid="report-sponsor-card"]',
    '[data-testid="funnel-table"]',
  ]);
  return doc;
}

describe('the no-token view (bare /sharedReport): the events table', () => {
  test('a venue holding quote marks stays the value of the one title attribute', async () => {
    const venue = hostile('VENUE');
    const doc = await openList({ ...listedEvent(plain), location: venue }, true);
    const label = doc.querySelector('[data-testid="report-event-venue"] span')!;
    expect(label, 'the venue label').not.toBeNull();
    expect(label.getAttributeNames().sort(), 'attributes on the venue label').toEqual([
      'class',
      'title',
    ]);
    expect(label.getAttribute('title')).toBe(venue);
    expect(label.textContent).toBe(venue);
  });

  test('a venue holding quote marks stays the value of the one alt attribute on the map image', async () => {
    const venue = hostile('VENUE');
    const doc = await openList({ ...listedEvent(plain), location: venue }, true);
    const img = doc.querySelector('[data-testid="report-event-venue"] img')!;
    expect(img, 'the map image').not.toBeNull();
    expect(img.getAttributeNames().sort(), 'attributes on the map image').toEqual([
      'alt',
      'class',
      'height',
      'loading',
      'src',
      'width',
    ]);
    expect(img.getAttribute('alt')).toBe(`Map: ${venue}`);
    // The attributes the template writes after `alt` are still the template's.
    expect(img.getAttribute('class')).toBe('venue-map');
    expect(img.getAttribute('width')).toBe('200');
    expect(img.getAttribute('height')).toBe('80');
  });

  test('a venue that tries to restyle the page, swap the picture or take a page name adds none of those', async () => {
    // What a break-out would be used for. Inline handlers are refused by the
    // page's policy; these are the attributes it does not refuse.
    const venue =
      'The Dock" style="position:fixed;inset:0;z-index:99" srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw=" name="getElementById" id="report-action-repeat';
    const doc = await openList({ ...listedEvent(plain), location: venue }, true);
    const cell = doc.querySelector('[data-testid="report-event-venue"]')!;
    for (const el of cell.querySelectorAll('img, span')) {
      for (const name of ['style', 'srcset', 'name', 'id']) {
        expect(el.hasAttribute(name), `${el.tagName} ${name}`).toBe(false);
      }
    }
    expect(doc.querySelectorAll('#report-action-repeat')).toHaveLength(1);
    expect(doc.querySelector('#report-action-repeat')!.tagName).toBe('BUTTON');
    expect(typeof doc.getElementById).toBe('function');
    expect(cell.querySelector('span')!.textContent).toBe(venue);
  });

  test.each([
    ['with the venue map set up', true],
    ['with no venue map', false],
  ])('%s: every typed value lands as text or as one attribute value', async (_name, maps) => {
    const calm = await openList(listedEvent(plain), maps);
    const wild = await openList(listedEvent(hostile), maps);
    expect(wild.querySelectorAll(INJECTED), 'elements or attributes that were typed').toHaveLength(
      0
    );
    expect(tree(wild.body, untail)).toEqual(tree(calm.body));
    // The comparison is not vacuous: the tail is on the page, as text.
    expect(wild.body.textContent).toContain(TAIL);
    expect(calm.body.textContent).not.toContain(TAIL);
  });

  test('the comparison sees the typed values: venue in two attributes and the cell, status in the badge class', async () => {
    const wild = await openList(listedEvent(hostile), true);
    const cell = wild.querySelector('[data-testid="report-event-venue"]')!;
    expect(cell.querySelector('span')!.getAttribute('title')).toBe(hostile('VENUE'));
    expect(cell.querySelector('img')!.getAttribute('alt')).toBe(`Map: ${hostile('VENUE')}`);
    expect(cell.querySelector('img')!.getAttribute('src')).toBe(
      `/api/v2/maps/venue-image?event=${encodeURIComponent(hostile('ID'))}`
    );
    const badge = wild.querySelector('[data-testid="report-event-status"]')!;
    expect(badge.getAttribute('class')).toBe(`badge ${hostile('STATUS')}`);
    expect(badge.getAttributeNames().sort()).toEqual(['class', 'data-testid']);
    expect(wild.querySelector('[data-testid="report-event-name"]')!.textContent).toBe(
      hostile('TITLE')
    );
    expect(wild.querySelector('[data-testid="funnel-event-name"]')!.textContent).toBe(
      hostile('NAME')
    );
    expect(wild.querySelector('.sponsor-name')!.textContent).toBe(hostile('SPONSOR'));
  });
});

// ─── The signed-link view: the report a sponsor or bar owner opens ─────────────

function report(fill: Fill): Record<string, unknown> {
  return {
    event_id: 'evt_1',
    event_title: fill('EVENT'),
    event_start_date: '2026-09-26T23:00:00Z',
    distinct_scanners: 84,
    return_rate: { venue_pct: 31.4, corridor_pct: 50, sample_size: 84 },
    corridor_density: { this_event_count: 84, density_ratio_30d: 2.1, density_ratio_90d: 1.05 },
    sponsor_impressions: [
      {
        sponsor_id: 'sp_1',
        sponsor_name: fill('BUSINESS'),
        sponsor_title: fill('SPONSORTITLE'),
        surface: fill('SURFACE'),
        count: 12,
      },
      // No display name: the business name is shown.
      { sponsor_id: 'sp_2', sponsor_name: fill('BUSINESS2'), surface: 'poster', count: 3 },
    ],
    sponsor_class_breakdown: {
      local: { sponsor_count: 1, total_impressions: 3 },
      mid: { sponsor_count: 0, total_impressions: 0 },
      premium: { sponsor_count: 1, total_impressions: 12 },
    },
    poster_attribution: [
      {
        poster_deployment_id: 'pd_1',
        location: fill('POSTERPLACE'),
        h3_res9: fill('CELL'),
        scan_count: 14,
        first_scan_at: '2026-09-26T23:00:00Z',
        last_scan_at: '2026-09-27T01:00:00Z',
        first_scan_label: fill('FIRSTLABEL'),
        last_scan_label: fill('LASTLABEL'),
      },
    ],
    headcount_trend: {
      instances: [{ event_id: 'evt_1', start_date: '2026-09-26T23:00:00Z', distinct_scanners: 84 }],
    },
    corridor_map: {
      svg: '<svg viewBox="0 0 10 10" role="img" aria-label="Corridor map"><polygon points="1,1 9,1 5,9" fill="#888"/></svg>',
      suppressed: [],
      cell_count: 1,
      source: 'live',
    },
    upgrade: { locked_sections: [fill('SECTION'), fill('SECTION2')], next_depth: fill('DEPTH') },
    _meta: {
      materialized_at: '2026-09-27T04:00:00Z',
      suppression_reasons: [{ field: 'distinct_scanners', reason: 'below_min_sample_size' }],
      timezone: { zone: fill('ZONE'), source: 'event' },
    },
  };
}

async function openReport(body: Record<string, unknown>): Promise<Document> {
  const dom = new JSDOM(REPORT_HTML, {
    url: 'https://ose.test/sharedReport?eventId=evt_1&token=t0ken',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = async (input: string) =>
        String(input).includes('/shared-report')
          ? json(200, { ok: true, report: body })
          : json(401, { ok: false });
    },
  });
  const doc = dom.window.document;
  await until(doc, ['[data-testid="signed-link-report-article"]']);
  return doc;
}

describe('the signed-link view: the report a sponsor or bar owner opens', () => {
  test('every value from the report lands as text or as one attribute value', async () => {
    const calm = await openReport(report(plain));
    const wild = await openReport(report(hostile));
    expect(wild.querySelectorAll(INJECTED), 'elements or attributes that were typed').toHaveLength(
      0
    );
    expect(tree(wild.body, untail)).toEqual(tree(calm.body));
    expect(wild.body.textContent).toContain(TAIL);
  });

  test('the comparison sees the values: names and depth in attributes, the rest as text', async () => {
    const wild = await openReport(report(hostile));
    const text = (testid: string): string[] =>
      [...wild.querySelectorAll(`[data-testid="${testid}"]`)].map((el) => el.textContent ?? '');
    expect(text('signed-link-event-title')).toEqual([hostile('EVENT')]);
    expect(
      [...wild.querySelectorAll('[data-testid="signed-link-sponsor-row"] td:first-child')].map(
        (td) => td.textContent
      )
    ).toEqual([hostile('SPONSORTITLE'), hostile('BUSINESS2')]);
    expect(text('poster-row-first-scan')).toEqual([hostile('FIRSTLABEL')]);
    expect(text('poster-row-h3-res9')).toEqual([hostile('CELL')]);
    expect(text('report-timezone-note')[0]).toContain(hostile('ZONE'));

    const group = wild.querySelector('[data-testid="signed-link-locked-sections"]')!;
    expect(group.getAttributeNames().sort()).toEqual(['class', 'data-next-depth', 'data-testid']);
    expect(group.getAttribute('data-next-depth')).toBe(hostile('DEPTH'));
    const heading = group.querySelector('h3')!;
    expect(heading.getAttributeNames().sort()).toEqual(['data-depth', 'data-testid']);
    expect(heading.getAttribute('data-depth')).toBe(hostile('DEPTH'));
    const cards = [...group.querySelectorAll('[data-testid="signed-link-locked-section"]')];
    expect(cards.map((c) => c.getAttribute('data-section-name'))).toEqual([
      hostile('SECTION'),
      hostile('SECTION2'),
    ]);
    for (const card of cards) {
      expect(card.getAttributeNames().sort()).toEqual([
        'class',
        'data-section-name',
        'data-testid',
      ]);
      const label = card.querySelector('strong')!;
      expect(label.getAttributeNames()).toEqual(['data-testid']);
      expect(label.getAttribute('data-testid')).toBe(
        `upgrade-prompt-${card.getAttribute('data-section-name')}`
      );
    }
  });

  test('text where a number, a date or a fixed word is expected adds nothing either', async () => {
    const wild = report(plain);
    const t = hostile('NUM');
    Object.assign(wild, {
      event_start_date: t,
      distinct_scanners: t,
      return_rate: { venue_pct: t, corridor_pct: t, sample_size: t },
      corridor_density: { this_event_count: t, density_ratio_30d: t, density_ratio_90d: t },
      sponsor_impressions: [{ sponsor_name: plain('BUSINESS'), surface: 'poster', count: t }],
      sponsor_class_breakdown: {
        local: { sponsor_count: t, total_impressions: t },
        mid: { sponsor_count: t, total_impressions: t },
        premium: { sponsor_count: t, total_impressions: t },
      },
      poster_attribution: [
        { location: plain('POSTERPLACE'), scan_count: t, first_scan_at: t, last_scan_at: t },
      ],
      headcount_trend: { instances: [{ start_date: t, distinct_scanners: t }] },
      corridor_map: { svg: '', suppressed: [], cell_count: t, source: t },
      _meta: {
        suppression_reasons: [
          { field: 'distinct_scanners', reason: t },
          { field: t, reason: t },
        ],
        timezone: { zone: plain('ZONE'), source: t },
      },
    });
    const doc = await openReport(wild);
    expect(doc.querySelectorAll(INJECTED)).toHaveLength(0);
    const bar = doc.querySelector('[data-testid="local-vs-paid-bar"]')!;
    expect(bar.getAttributeNames().sort()).toEqual(['aria-label', 'class', 'data-testid']);
    for (const part of bar.children) {
      expect(part.getAttributeNames().sort()).toEqual(['class', 'data-testid', 'style', 'title']);
      expect(part.getAttribute('style')).toMatch(/^width:(NaN|\d+)%$/);
    }
    const chip = doc.querySelector('[data-testid="corridor-map-cell-count"]')!;
    expect(chip.getAttributeNames().sort()).toEqual(['aria-label', 'class', 'data-testid']);
  });
});

// ─── The page's one escaper ────────────────────────────────────────────────────

describe('the page has one escaper, and it escapes quote marks', () => {
  function pageEscaper(): (s: unknown) => string {
    const dom = new JSDOM(REPORT_HTML, {
      url: 'https://ose.test/sharedReport?eventId=evt_1&token=t0ken',
      runScripts: 'dangerously',
      beforeParse(w) {
        (w as unknown as { fetch: unknown }).fetch = async () => json(401, { ok: false });
      },
    });
    const fn = (dom.window as unknown as { escapeReportHtml?: (s: unknown) => string })
      .escapeReportHtml;
    expect(typeof fn, 'window.escapeReportHtml').toBe('function');
    return fn!;
  }

  test('it gives what the server escaper (lib/html-escape) gives', () => {
    const esc = pageEscaper();
    const corpus = [
      '',
      'Harbor Bar',
      `O'Brien's "Back Room"`,
      '<b>&amp;</b>',
      '& < > " \'',
      '&&&"""\'\'\'<<<>>>',
      '&quot;&#39;&lt;',
      TAIL,
      'café   日本 🎳',
      'a\nb\tc',
      '`${x}`',
    ];
    for (const s of corpus) expect(esc(s), JSON.stringify(s)).toBe(escapeHtml(s));
    expect(esc(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  test('nothing comes back as "null" or "undefined", and a number is its digits', () => {
    const esc = pageEscaper();
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(0)).toBe('0');
    expect(esc(41.5)).toBe('41.5');
  });

  test('what it returns can sit in a double-quoted or a single-quoted attribute, or in text', () => {
    const esc = pageEscaper();
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
// payload that reaches it.
//
// How: each inline script is parsed (TypeScript's parser, as JavaScript). Every
// chain of `'...' + value + '...'` (and every template literal) is walked left
// to right with a small HTML reader that knows whether it is in text, inside a
// tag, or inside an attribute value, and which attribute. Each value met along
// the way is judged by where it lands:
//
//   in a quoted attribute value   must be `esc(...)`
//   in `src`, `href` and the like must be `encodeURIComponent(...)` after a
//                                 fixed same-origin path (escaping does not stop
//                                 a `javascript:` address)
//   in `style`                    must be a number by construction (a `const`
//                                 made by Math.round or by arithmetic); escaping
//                                 is not a defence inside a style
//   in an event-handler attribute, an unquoted attribute, a tag name, or inside
//   a tag but outside any value   never
//
// It fails closed on what it cannot follow: a string that ends inside a tag or
// an attribute value (markup split across variables or an array), and a
// conditional whose two sides leave the markup in different places.
//
// What it does NOT check: a value written in TEXT position (the two-page
// comparison above covers what is drawn there), values set through DOM calls
// (`setAttribute`, `textContent`, which need no escaping), and markup assembled
// in a way that never puts the attribute's opening quote and its value in the
// same expression AND still ends each piece in text. It is a check on this
// page's way of writing markup, not a proof about every way there is.
//
// The reader and the judging live in tests/helpers/markup-attribute-check.ts,
// moved there so the poster page (poster-attribute-escaping.spec.ts) is held to
// the same rule by the same code. Nothing this file refuses changed in the move;
// one refusal was added (an encoded value in a single-quoted address).

const HELPER = 'escapeReportHtml';
/** This page: one escaper, and no address but a fixed path with one encoded value. */
const RULES: MarkupRules = { helper: HELPER };
const checkPage = (page: string) => checkMarkupPage(page, RULES);
const checkCode = (code: string) => checkMarkupCode(code, RULES);

describe('the source: every value written into an attribute goes through the escaper', () => {
  test('the check reads the page: its scripts, its escaper and the attribute writes it is there for', () => {
    const page = checkPage(REPORT_HTML);
    expect(page.scripts).toBeGreaterThanOrEqual(6);
    // One `const esc = window.escapeReportHtml` per script that builds markup.
    expect(page.escDeclarations).toBe(4);
    const inAttribute = page.holes
      .filter((h) => h.mode === 'dq' || h.mode === 'sq')
      .map((h) => `${h.tag}[${h.attr}] ${h.expr.replace(/\s+/g, ' ')}`);
    expect(inAttribute).toEqual(
      expect.arrayContaining([
        'span[title] esc(venue)',
        'img[alt] esc(venue)',
        'img[src] encodeURIComponent(e.id)',
        "span[class] esc(e.status || '')",
        'section[data-next-depth] esc(report.upgrade.next_depth)',
        "h3[data-depth] esc(report.upgrade.next_depth || '')",
        'div[data-section-name] esc(name)',
        'strong[data-testid] esc(name)',
        'p[data-field] esc(field)',
        'span[aria-label] esc(fmtInt(cm.cell_count))',
        'div[style] localPct',
        'div[style] paidPct',
        'div[style] barW',
      ])
    );
    // And values in text position are seen too (they are not judged here).
    expect(page.holes.filter((h) => h.mode === 'text').length).toBeGreaterThan(20);
  });

  test('the page keeps the rule: nothing is written into an attribute any other way', () => {
    expect(checkPage(REPORT_HTML).findings).toEqual([]);
  });

  // Each of these is the page with one fault put in. The check must name it.
  test.each<[string, (page: string) => string, RegExp]>([
    [
      'the venue written into title and alt without the escaper',
      (p) => p.split('esc(venue)').join('venue'),
      /`venue` is written into <(span title|img alt)="…"> without esc/,
    ],
    [
      'one script goes back to its own textContent-based helper',
      (p) =>
        p.replace(
          `const esc = window.${HELPER};\n          const allSponsors`,
          "const esc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };\n          const allSponsors"
        ),
      /`esc` is declared as something other than/,
    ],
    [
      'the shared escaper is replaced later in the page',
      (p) =>
        p.replace(
          'window.__signedLinkMode = true;',
          `window.${HELPER} = (s) => s; window.__signedLinkMode = true;`
        ),
      /assigned 2 times/,
    ],
    [
      'a section name written into data-section-name through another function',
      (p) =>
        p.replace(
          'data-section-name="\' +\n                    esc(name)',
          'data-section-name="\' +\n                    humanizeSection(name)'
        ),
      /`humanizeSection\(name\)` is written into <div data-section-name="…"> without esc/,
    ],
    [
      'the bar width taken from the payload instead of computed',
      (p) =>
        p.replace(
          'const barW = Math.round(((num(r.reg) || 0) / maxReg) * 100);',
          'const barW = r.width;'
        ),
      /`barW` is written into <div style="…">/,
    ],
    [
      'the status written into the class attribute unescaped',
      (p) =>
        p.replace(
          "'<td data-label=\"Status\"><span class=\"badge ' +\n                  esc(e.status || '')",
          "'<td data-label=\"Status\"><span class=\"badge ' +\n                  (e.status || '')"
        ),
      /is written into <span class="…"> without esc/,
    ],
    [
      'the event id written into the image address without encodeURIComponent',
      (p) =>
        p.replace(
          'encodeURIComponent(e.id) +\n                      \'" alt="Map: \'',
          'esc(e.id) +\n                      \'" alt="Map: \''
        ),
      /`esc\(e\.id\)` is written into an address, <img src="…">/,
    ],
  ])('a planted fault is named: %s', (_name, plant, expected) => {
    const page = REPORT_HTML.split('\r\n').join('\n');
    const faulty = plant(page);
    expect(faulty, 'the fault was planted').not.toBe(page);
    const { findings } = checkPage(faulty);
    expect(findings.length, findings.join('\n')).toBeGreaterThan(0);
    expect(findings.join('\n')).toMatch(expected);
  });

  // The same, on small pieces of code: the ways a future edit could write an
  // attribute that the page does not use today.
  test.each<[string, string, RegExp]>([
    [
      'a raw value in a double-quoted attribute',
      `el.innerHTML = '<span title="' + venue + '">x</span>';`,
      /without esc/,
    ],
    [
      'a raw value in a single-quoted attribute',
      `el.innerHTML = "<span title='" + venue + "'>x</span>";`,
      /without esc/,
    ],
    [
      'a raw value in a template literal',
      'el.innerHTML = `<span title="${venue}">x</span>`;',
      /without esc/,
    ],
    [
      'an escaped value in an unquoted attribute',
      `el.innerHTML = '<span title=' + esc(venue) + '>x</span>';`,
      /unquoted attribute/,
    ],
    [
      'a value between attributes',
      `el.innerHTML = '<span ' + extra + '>x</span>';`,
      /outside any attribute value/,
    ],
    [
      'a tag name from a value',
      `el.innerHTML = '<' + tagName + ' title="' + esc(venue) + '">x';`,
      /tag name/,
    ],
    [
      'an escaped value in an inline handler',
      `el.innerHTML = '<span onclick="go(' + esc(id) + ')">x</span>';`,
      /event-handler attribute/,
    ],
    [
      'an escaped value as a link address',
      `el.innerHTML = '<a href="' + esc(url) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'an encoded value as a whole link address (no fixed path in front)',
      `el.innerHTML = '<a href="' + encodeURIComponent(url) + '">x</a>';`,
      /written into an address/,
    ],
    [
      'an encoded value after a path that names another host',
      `el.innerHTML = '<img src="//' + encodeURIComponent(host) + '/x.png">';`,
      /written into an address/,
    ],
    [
      'an escaped value in srcset',
      `el.innerHTML = '<img src="/a.png" srcset="' + esc(set) + '">';`,
      /takes no value from data/,
    ],
    [
      'an escaped string in a style',
      `el.innerHTML = '<div style="width:' + esc(w) + '">x</div>';`,
      /allowed in a style/,
    ],
    [
      'a style number that is not a const',
      `let w = Math.round(n); el.innerHTML = '<div style="width:' + w + '%">x</div>';`,
      /allowed in a style/,
    ],
    [
      'a second helper that keeps the old name pattern',
      `const escText = (s) => s; el.innerHTML = '<span title="' + escText(venue) + '">x</span>';`,
      /without esc/,
    ],
    [
      'esc taken as a parameter',
      `function row(esc, v) { return '<span title="' + esc(v) + '">x</span>'; }`,
      /declared as something other than/,
    ],
    [
      'markup split across two strings',
      `const open = '<span title="'; el.innerHTML = open + venue + '">x</span>';`,
      /ends inside the value of title/,
    ],
    [
      'markup joined from an array',
      `el.innerHTML = ['<span class="', cls, '">x</span>'].join('');`,
      /ends inside the value of class/,
    ],
    [
      'a conditional that opens an attribute on one side only',
      `el.innerHTML = '<span' + (on ? ' title="' : '') + esc(venue) + '">x</span>';`,
      /leave the markup in different places/,
    ],
    [
      'a raw value inside a conditional attribute',
      `el.innerHTML = '<span' + (v ? ' title="' + v + '"' : '') + '>x</span>';`,
      /without esc/,
    ],
  ])('a planted fault is named: %s', (_name, code, expected) => {
    const { findings } = checkCode(code);
    expect(findings.join('\n')).toMatch(expected);
  });

  // The other direction: the check is not simply refusing everything.
  test.each<[string, string]>([
    [
      'an escaped value in a quoted attribute',
      `el.innerHTML = '<span title="' + esc(venue) + '">' + esc(venue) + '</span>';`,
    ],
    [
      'the same in a template literal',
      'el.innerHTML = `<span title="${esc(venue)}">${esc(venue)}</span>`;',
    ],
    [
      'a fixed path with an encoded id',
      `el.innerHTML = '<img src="/api/v2/x?event=' + encodeURIComponent(id) + '" alt="' + esc(a) + '">';`,
    ],
    [
      'a computed width',
      `const w = Math.round(n * 100); const rest = 100 - w; el.innerHTML = '<i style="width:' + w + '%"></i><i style="width:' + rest + '%"></i>';`,
    ],
    [
      'a conditional attribute, escaped',
      `el.innerHTML = '<span' + (v ? ' title="' + esc(v) + '"' : '') + '>x</span>';`,
    ],
    [
      'a conditional inside a value',
      `el.innerHTML = '<span class="badge ' + (on ? 'live' : 'off') + '">x</span>';`,
    ],
    [
      'fragments and raw values in text position',
      `el.innerHTML = '<ul>' + rows.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' + note;`,
    ],
    [
      'strings that are not markup',
      `const a = 'x < y'; const m = { '<': '&lt;', '>': '&gt;' }; fetch('/api/' + encodeURIComponent(id) + '/z'); const lt = '<';`,
    ],
  ])('nothing to report: %s', (_name, code) => {
    expect(checkCode(code).findings).toEqual([]);
  });
});
