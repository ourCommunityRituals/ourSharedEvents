/**
 * OSE-1312 slice 2 — landing area renderer.
 *
 * Node-clean: imports the pure renderer and asserts its string output. No DOM,
 * no cloudflare:test, no D1 — runs in the node vitest project (registered in
 * vitest.node-specs.mjs).
 *
 * The area is the CSS-only filter mechanism, so these tests pin the exact tags a
 * card carries (window / type / product / modality) and the default-view rule —
 * the tags ARE the behaviour, and a browser can prove nothing the string can't.
 */

import { describe, it, expect } from 'vitest';
import {
  renderLandingArea,
  renderEmptyLandingArea,
  injectLandingArea,
  LANDING_AREA_MARKER,
  DEFAULT_WINDOW,
  LIST_MAX,
  type LandingAreaItem,
} from '../src/lib/landing-area';
import { buildEventTypeCatalog, categoryByTypeId } from '../src/lib/event-type-catalog';

// A fixed clock so window math is deterministic.
const NOW = Date.parse('2026-09-13T00:00:00.000Z');
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

function ev(overrides: Partial<LandingAreaItem> = {}): LandingAreaItem {
  return {
    id: 'e1',
    name: 'Neighborhood Thing',
    startDateISO: inDays(3),
    phase: 'pre_event',
    venue: 'The Corner Bar',
    lat: 41.9,
    lon: -87.6,
    template_id: 'bar_night',
    ...overrides,
  };
}

const render = (items: LandingAreaItem[]) => renderLandingArea(items, { now: NOW });

// OSE-1362 changed these deliberately: the landing's private 7/30/90-day windows
// (`within-*`, ms-since-now) were replaced by the SHARED /events `when` windows
// (`when-week|month|next-90`, event-local calendar day, lib/event-discovery), so a
// label means the same window on every surface. Same intent, shared definition.
// Assert on the card's class attribute: the window <style> names every class.
const cardClass = (html: string) => html.match(/class="(event-card[^"]*)"/)?.[1] ?? '';

describe('OSE-1312 | window tagging', () => {
  it('tags each shared `when` window the event falls in', () => {
    // NOW = Sep 13 00:00Z = Sep 12 in the home zone.
    const soon = cardClass(render([ev({ id: 's', startDateISO: inDays(3) })]).html);
    expect(soon).toContain('when-week');
    expect(soon).toContain('when-month');
    expect(soon).toContain('when-next-90');

    const mid = cardClass(render([ev({ id: 'm', startDateISO: inDays(20) })]).html);
    expect(mid).not.toContain('when-week');
    expect(mid).not.toContain('when-month'); // Oct 3 is next month
    expect(mid).toContain('when-next-90');

    const far = cardClass(render([ev({ id: 'f', startDateISO: inDays(60) })]).html);
    expect(far).not.toContain('when-week');
    expect(far).toContain('when-next-90');
  });

  it('a live event (phase event) sits in every window', () => {
    const cls = cardClass(
      render([ev({ id: 'live', phase: 'event', startDateISO: inDays(-1) })]).html
    );
    expect(cls).toContain('when-week');
    expect(cls).toContain('when-month');
    expect(cls).toContain('when-next-90');
  });

  it('an event >90 days out carries no window class (hidden until in range)', () => {
    const html = render([ev({ id: 'x', startDateISO: inDays(120) })]).html;
    // still a card, but with no when-* tag
    expect(html).toContain('data-testid="area-card"');
    expect(cardClass(html)).not.toContain('when-');
  });

  it('wrapped (post_event) events are excluded from the area', () => {
    const html = render([ev({ id: 'w', phase: 'post_event' })]).html;
    expect(html).toContain('area-empty'); // nothing forward-looking to show
    expect(html).not.toContain('data-testid="area-card"');
  });
});

// Owner 2026-11-09: "Event Types should be Categories. When clicked you get all
// the event types under this category". The catalog is built by the same pure
// grouping the Create Event picker uses; the rows are a slice of 0024/0076.
// @born-red landing-category-chips | method: the chip named and slugged by the raw
//   type id; the row sorted by label instead of catalog order; the catalog's own
//   "Other" bucket kept as a category (English name on a Spanish page); template_id
//   allowed to decide — each turned a test red | date: 2026-11-09
const CATALOG = categoryByTypeId(
  buildEventTypeCatalog(
    [
      { category_code: 'REC', display_name: 'Sports & Recreation', display_order: 10 },
      { category_code: 'ART', display_name: 'Arts, Culture & Live Music', display_order: 50 },
      { category_code: 'BIZ', display_name: 'Business & Networking', display_order: 80 },
    ],
    [
      {
        id: 'etr-art-music',
        uec_code: 'ART-MUSIC-001',
        name: 'Live Music Event',
        description: null,
        category_code: 'ART',
      },
      {
        id: 'etr-art-gallery',
        uec_code: 'ART-GALLERY-001',
        name: 'Art Show & Gallery Opening',
        description: null,
        category_code: 'ART',
      },
      {
        id: 'etr-biz-mixer',
        uec_code: 'BIZ-MIXER-001',
        name: 'Business Mixer',
        description: null,
        category_code: 'BIZ',
      },
      {
        id: 'etr-rec-bocce',
        uec_code: 'REC-BOCCE-001',
        name: 'Bocce',
        description: null,
        category_code: 'REC',
      },
      // A seed mistake: a cluster with no category row. The catalog puts it in "Other".
      {
        id: 'etr-zzz-orphan',
        uec_code: 'ZZZ-ORPHAN-001',
        name: 'Orphan',
        description: null,
        category_code: 'ZZZ',
      },
    ]
  )
);
const renderCats = (items: LandingAreaItem[]) =>
  renderLandingArea(items, { now: NOW, typeCategories: CATALOG });
const typeCss = (html: string) =>
  html.match(/<style data-testid="area-type-css">([\s\S]*?)<\/style>/)?.[1] ?? '';
const typeChips = (html: string) =>
  [
    ...(html.match(/data-testid="toggle-type">([\s\S]*?)<\/fieldset>/)?.[1] ?? '').matchAll(
      /<label class="disc-chip" for="([^"]+)">([^<]*)<\/label>/g
    ),
  ].map((m) => [m[1], m[2]]);

describe('the Type row is the event-type categories (owner 2026-11-09)', () => {
  it('one chip per category present, with its catalog name, All types first', () => {
    const out = renderCats([
      ev({ id: 'a', event_type_id: 'etr-art-music' }),
      ev({ id: 'b', event_type_id: 'etr-art-gallery' }),
      ev({ id: 'c', event_type_id: 'etr-biz-mixer' }),
    ]);
    expect(out.categories).toEqual([
      { slug: 'cat-art', label: 'Arts, Culture & Live Music' },
      { slug: 'cat-biz', label: 'Business & Networking' },
    ]);
    expect(typeChips(out.html)).toEqual([
      ['type-all', 'All types'],
      ['cat-art', 'Arts, Culture &amp; Live Music'],
      ['cat-biz', 'Business &amp; Networking'],
    ]);
    expect(out.html).toContain('id="type-all" class="toggle-radio" checked');
    expect(out.html).not.toMatch(/Etr |Live Music Event<\/label>/);
  });

  it("a category's rule keeps every card of every type in it, and only those", () => {
    const html = renderCats([
      ev({ id: 'a', event_type_id: 'etr-art-music' }),
      ev({ id: 'b', event_type_id: 'etr-art-gallery' }),
      ev({ id: 'c', event_type_id: 'etr-biz-mixer' }),
    ]).html;
    const cls = (id: string) =>
      html
        .match(
          new RegExp(`<article class="([^"]*)" data-testid="area-card" data-event-id="${id}"`)
        )?.[1]
        ?.split(' ') ?? [];
    expect(typeCss(html)).toContain(
      '#cat-art:checked ~ .area .event-card:not(.cat-art){display:none}'
    );
    expect(typeCss(html)).toContain(
      '#cat-biz:checked ~ .area .event-card:not(.cat-biz){display:none}'
    );
    // Both Arts types carry .cat-art, so #cat-art hides neither; the mixer does not.
    expect(cls('a')).toContain('cat-art');
    expect(cls('b')).toContain('cat-art');
    expect(cls('c')).not.toContain('cat-art');
    expect(cls('c')).toContain('cat-biz');
    // One category per card: no type id leaks in as a class.
    for (const id of ['a', 'b', 'c']) {
      expect(cls(id).filter((k) => k.startsWith('cat-') || k.startsWith('type-'))).toHaveLength(1);
    }
  });

  it('a category with no listed event has no chip, and catalog order wins over the alphabet', () => {
    const out = renderCats([
      ev({ id: 'c', event_type_id: 'etr-biz-mixer' }),
      ev({ id: 'r', event_type_id: 'etr-rec-bocce' }),
    ]);
    // Sports (10) before Business (80), though "B" sorts first; no Arts chip.
    expect(out.categories.map((c) => c.slug)).toEqual(['cat-rec', 'cat-biz']);
    expect(out.html).not.toContain('cat-art');
  });

  it('no type, an unknown type and an orphan type are one "Other", always last', () => {
    const out = renderCats([
      ev({ id: 'o1', event_type_id: null }),
      ev({ id: 'o2', event_type_id: 'not-in-the-catalog' }),
      ev({ id: 'o3', event_type_id: 'etr-zzz-orphan' }),
      ev({ id: 'r', event_type_id: 'etr-rec-bocce' }),
    ]);
    expect(out.categories).toEqual([
      { slug: 'cat-rec', label: 'Sports & Recreation' },
      { slug: 'cat-other', label: 'Other' },
    ]);
  });

  it('"Other" speaks the page language', () => {
    const out = renderLandingArea(
      [ev({ id: 'o', event_type_id: null }), ev({ id: 'r', event_type_id: 'etr-rec-bocce' })],
      { now: NOW, typeCategories: CATALOG, lang: 'es' }
    );
    expect(out.categories.at(-1)).toEqual({ slug: 'cat-other', label: 'Otro' });
    // The catalog's own "Other" bucket (an orphan type) is ours too, not its English name.
    const orphan = renderLandingArea(
      [
        ev({ id: 'o', event_type_id: 'etr-zzz-orphan' }),
        ev({ id: 'r', event_type_id: 'etr-rec-bocce' }),
      ],
      { now: NOW, typeCategories: CATALOG, lang: 'es' }
    );
    expect(orphan.categories.at(-1)).toEqual({ slug: 'cat-other', label: 'Otro' });
  });

  it('template_id never decides the category; without a catalog every event is "Other" and the row is not offered', () => {
    const out = renderCats([ev({ id: 'a', template_id: 'bar_night', event_type_id: null })]);
    expect(out.categories).toEqual([{ slug: 'cat-other', label: 'Other' }]);
    const bare = renderLandingArea(
      [
        ev({ id: 'a', event_type_id: 'etr-art-music' }),
        ev({ id: 'b', event_type_id: 'etr-biz-mixer' }),
      ],
      { now: NOW }
    );
    expect(bare.categories).toEqual([{ slug: 'cat-other', label: 'Other' }]);
    expect(bare.html).not.toContain('data-testid="toggle-type"');
  });

  it('escapes a category name', () => {
    const hostile = new Map([
      ['etr-x', { code: 'XSS', name: '<img src=x onerror=alert(1)>', order: 0 }],
    ]);
    const html = renderLandingArea(
      [ev({ id: 'a', event_type_id: 'etr-x' }), ev({ id: 'b', event_type_id: null })],
      { now: NOW, typeCategories: hostile }
    ).html;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('OSE-1312 | modality derivation (no column — geo/location heuristic)', () => {
  it('in-person when geo present', () => {
    expect(render([ev({ lat: 41.9, lon: -87.6, venue: '' })]).html).toContain('modality-inperson');
  });
  it('in-person when a venue/location string is present', () => {
    expect(render([ev({ lat: null, lon: null, venue: 'Town Hall' })]).html).toContain(
      'modality-inperson'
    );
  });
  it('online when neither geo nor place is present', () => {
    const html = render([ev({ lat: null, lon: null, venue: '', location: '' })]).html;
    expect(html).toContain('modality-online');
    expect(html).not.toContain('modality-inperson');
  });
});

describe('OSE-1312 | product tagging (anon pole; hybrid inert)', () => {
  it('every OSE event is product-ose', () => {
    expect(render([ev()]).html).toContain('product-ose');
  });
  it('no Kind control (OSE-1520: its only possible answer was "all"), and no card carries product-hybrid', () => {
    const html = render([ev(), ev({ id: 'e2' })]).html;
    expect(html).not.toContain('data-testid="toggle-product"');
    expect(html).not.toContain('id="prod-hybrid"');
    expect(html).not.toContain(' product-hybrid'); // leading space = the card class, not the radio id
  });
});

describe('the landing threshold (LIST_MAX): doors lead below it, the map leads at it', () => {
  it('the threshold is 10', () => {
    expect(LIST_MAX).toBe(10);
  });

  it('below it: the doors lead (list view opens), and the map view is the note with the real count plus the example', () => {
    const items = Array.from({ length: LIST_MAX - 1 }, (_, i) => ev({ id: `e${i}` }));
    const out = render(items);
    expect(out.leadsWithMap).toBe(false);
    expect(out.defaultView).toBe('list');
    expect(out.html).toContain('id="view-list" class="toggle-radio" checked');
    expect(out.html).toContain(`once this area has ${LIST_MAX} events`);
    expect(out.html).toContain(`There are ${LIST_MAX - 1} so far`);
    expect(out.html).toContain('data-testid="amap-example"');
    expect(out.html).not.toContain('data-testid="amap-svg"');
    // The events themselves are still listed.
    expect(out.html.split('data-testid="area-card"').length - 1).toBe(LIST_MAX - 1);
  });

  it('below it but latched: the map still leads and the note is gone (no flapping)', () => {
    const items = Array.from({ length: 3 }, (_, i) => ev({ id: `e${i}` }));
    const out = renderLandingArea(items, { now: NOW, areaLatched: true });
    expect(out.windowCount).toBe(3);
    expect(out.leadsWithMap).toBe(true);
    expect(out.defaultView).toBe('map');
    expect(out.html).not.toContain('once this area has');
  });

  it('a latched area with nothing to show is the plain empty state, doors first', () => {
    const out = renderLandingArea([], { now: NOW, areaLatched: true });
    expect(out.leadsWithMap).toBe(false);
    expect(out).toEqual(renderEmptyLandingArea());
  });

  it('at it: the map leads — counted at the widest window', () => {
    const items = Array.from({ length: LIST_MAX }, (_, i) => ev({ id: `e${i}` }));
    const out = render(items);
    expect(out.windowCount).toBe(LIST_MAX);
    expect(out.leadsWithMap).toBe(true);
    expect(out.defaultView).toBe('map');
    expect(out.html).toContain('id="view-map" class="toggle-radio" checked');
    expect(out.html).not.toContain('once this area has');
  });

  it('events beyond the widest window do not count toward the crossover', () => {
    const near = Array.from({ length: 3 }, (_, i) => ev({ id: `n${i}`, startDateISO: inDays(5) }));
    const far = Array.from({ length: 20 }, (_, i) =>
      ev({ id: `f${i}`, startDateISO: inDays(200) })
    );
    const out = render([...near, ...far]);
    expect(out.windowCount).toBe(3);
    expect(out.leadsWithMap).toBe(false);
    expect(out.html).toContain('There are 3 so far');
  });
});

describe('OSE-1312 | window default is configured', () => {
  it('checks the DEFAULT_WINDOW radio', () => {
    const html = render([ev()]).html;
    expect(html).toContain(`id="win-${DEFAULT_WINDOW}" class="toggle-radio" checked`);
  });
});

describe('OSE-1312 | empty + injection', () => {
  it('empty input renders the empty state, no toggles', () => {
    const out = renderLandingArea([]);
    expect(out.html).toContain('area-empty');
    expect(out.html).not.toContain('area-toggles');
    expect(out).toEqual(renderEmptyLandingArea());
  });

  it('injectLandingArea replaces the marker; a template without it is untouched', () => {
    const area = render([ev()]);
    const shell = `<section><!--OCR_LANDING_AREA--></section>`;
    const out = injectLandingArea(shell, area);
    expect(out).not.toContain(LANDING_AREA_MARKER);
    expect(out).toContain('data-testid="area-card"');
    expect(injectLandingArea('<p>no marker</p>', area)).toBe('<p>no marker</p>');
  });

  it('escapes hostile event names', () => {
    const html = render([ev({ name: '<img src=x onerror=alert(1)>' })]).html;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

// A chosen window that holds no events used to leave a blank list: the filter is
// CSS-only, so it hid every card and said nothing. The server now writes one
// message per empty window (the /events copy, with its link to a wider range)
// and the same CSS that hides the cards shows the matching message.
describe('an empty time window says so and links to a wider range', () => {
  const message = (html: string, w: string) =>
    html.match(new RegExp(`<p[^>]*data-testid="area-window-empty-${w}"[^>]*>(.*?)</p>`, 's'))?.[0];

  // NOW = Sat Sep 12 in the home zone. An event 20 days out is inside the next
  // 90 days and outside both this weekend and the next 7 days.
  const midOnly = () => render([ev({ id: 'm', startDateISO: inDays(20) })]).html;

  it('writes the /events message for a window with no events', () => {
    const p = message(midOnly(), 'weekend');
    expect(p, 'weekend message').toBeDefined();
    expect(p).toContain('Nothing this weekend yet.');
    expect(p).toContain('href="/events?when=week"');
    expect(p).toContain('Try the next 7 days');
  });

  it('writes none for a window that has events', () => {
    const html = midOnly();
    expect(message(html, 'next-90')).toBeUndefined();
  });

  it('the widest window, when empty, links to everything', () => {
    // 120 days out: listed on the page, outside every landing window.
    const p = message(render([ev({ id: 'far', startDateISO: inDays(120) })]).html, 'next-90');
    expect(p, 'next-90 message').toBeDefined();
    expect(p).toContain('Nothing in the next 90 days yet.');
    expect(p).toContain('href="/events"');
  });

  it('a message is hidden until its own window is chosen', () => {
    const html = midOnly();
    const css = html.match(/<style data-testid="area-window-css">([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(css).toContain('.area-window-empty{display:none}');
    expect(css).toContain('#win-weekend:checked ~ .area .win-empty-weekend{display:block}');
    // No rule can show the weekend message under another window.
    expect(css).not.toMatch(/#win-(week|month|next-90):checked ~ \.area \.win-empty-weekend/);
  });

  it('the message sits in the list, so it shows in the list view and under the map', () => {
    const html = midOnly();
    const list = html.slice(html.indexOf('data-testid="area-list"'));
    expect(list).toContain('data-testid="area-window-empty-weekend"');
  });
});
