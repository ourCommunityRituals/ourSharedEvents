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

describe('OSE-1312 | window tagging', () => {
  it('nests within-7 ⊂ within-30 ⊂ within-90 by days-until-start', () => {
    const soon = render([ev({ id: 's', startDateISO: inDays(3) })]).html;
    expect(soon).toContain('within-7');
    expect(soon).toContain('within-30');
    expect(soon).toContain('within-90');

    const mid = render([ev({ id: 'm', startDateISO: inDays(20) })]).html;
    expect(mid).not.toContain('within-7');
    expect(mid).toContain('within-30');
    expect(mid).toContain('within-90');

    const far = render([ev({ id: 'f', startDateISO: inDays(60) })]).html;
    expect(far).not.toContain('within-7');
    expect(far).not.toContain('within-30');
    expect(far).toContain('within-90');
  });

  it('a live event (phase event) sits in every window', () => {
    const html = render([ev({ id: 'live', phase: 'event', startDateISO: inDays(-1) })]).html;
    expect(html).toContain('within-7');
    expect(html).toContain('within-30');
    expect(html).toContain('within-90');
  });

  it('an event >90 days out carries no window class (hidden until in range)', () => {
    const html = render([ev({ id: 'x', startDateISO: inDays(120) })]).html;
    // still a card, but with no within-* tag
    expect(html).toContain('data-testid="area-card"');
    expect(html).not.toContain('within-90');
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
    expect(out.html).toContain('class="event-card within-7 within-30 within-90 type-bar-night');
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

describe('OSE-1312 | default view by count (list < LIST_MAX ≤ map)', () => {
  it('defaults to list below the crossover', () => {
    const items = Array.from({ length: LIST_MAX - 1 }, (_, i) => ev({ id: `e${i}` }));
    const out = render(items);
    expect(out.defaultView).toBe('list');
    expect(out.html).toContain('id="view-list" class="toggle-radio" checked');
  });

  it('defaults to map at/above the crossover — counted at the widest window', () => {
    const items = Array.from({ length: LIST_MAX }, (_, i) => ev({ id: `e${i}` }));
    const out = render(items);
    expect(out.windowCount).toBe(LIST_MAX);
    expect(out.defaultView).toBe('map');
    expect(out.html).toContain('id="view-map" class="toggle-radio" checked');
  });

  it('events beyond the widest window do not count toward the crossover', () => {
    const near = Array.from({ length: 3 }, (_, i) => ev({ id: `n${i}`, startDateISO: inDays(5) }));
    const far = Array.from({ length: 20 }, (_, i) =>
      ev({ id: `f${i}`, startDateISO: inDays(200) })
    );
    const out = render([...near, ...far]);
    expect(out.windowCount).toBe(3);
    expect(out.defaultView).toBe('list');
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
