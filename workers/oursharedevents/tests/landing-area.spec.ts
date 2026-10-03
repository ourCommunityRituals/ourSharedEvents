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

describe('OSE-1312 | type tagging', () => {
  it('slugs template_id and emits one pill + hide rule per present type', () => {
    const out = render([
      ev({ id: 'a', template_id: 'bar_night' }),
      ev({ id: 'b', template_id: 'trivia_night' }),
    ]);
    expect(out.types.map((t) => t.slug)).toEqual(['type-bar-night', 'type-trivia-night']);
    expect(out.html).toContain(
      'class="event-card when-week when-month when-next-90 type-bar-night'
    );
    // dynamic hide rule for a type
    expect(out.html).toContain('#type-bar-night:checked ~ .area .event-card:not(.type-bar-night)');
    // readable label
    expect(out.html).toContain('Bar Night');
  });

  it('falls back to event_type_id, then to "Other"', () => {
    const byType = render([ev({ id: 'a', template_id: null, event_type_id: 'farmers_market' })]);
    expect(byType.types[0].slug).toBe('type-farmers-market');

    const untyped = render([ev({ id: 'a', template_id: null, event_type_id: null })]);
    expect(untyped.types[0].slug).toBe('type-other');
    expect(untyped.types[0].label).toBe('Other');
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
  it('renders the product toggle but no card carries product-hybrid yet', () => {
    const html = render([ev(), ev({ id: 'e2' })]).html;
    expect(html).toContain('data-testid="toggle-product"');
    expect(html).toContain('id="prod-hybrid"');
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
