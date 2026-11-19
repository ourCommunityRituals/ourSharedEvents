/**
 * The landing's filter tabs and its distance choice (OSE-2156; lib/area-tabs-script.ts).
 *
 * What the server sends: each filter group as a tab panel, the "Near me" panel
 * hidden, each placed card's public cell id, and the one script, with the words in
 * the page's language. How the script behaves is run here in jsdom (tabs, keys,
 * the distance filter with a fake position) and in a real browser by
 * tests/e2e/2-pages/landing-tabs.component.spec.ts. And what the script may never
 * do: ask for anything, store anything, or send the visitor's position anywhere
 * (invariants 3 and 4; the owner's ruling of 2026-11-16, "zip finds, tap places").
 *
 * Node project: pure rendering, the script's text, and jsdom. Registered in
 * vitest.node-specs.mjs.
 */
// @born-red the landing filter tabs and distance choice | method: 19 faults put in one at a time, this file run, the source restored; each turned it red: the script sent twice; aria-selected left true on every tab; the roving tabindex left at 0; the radios of a closed tab left in the tab order; the End key not handled; the position read on load instead of on the choice; the position put in location.hash; a fetch() of the position added; localStorage.setItem of the position added; the card comparison turned around; the nearest-first sort left out; a card with no place left visible while a distance is chosen; the Near me tab offered with no geolocation; the Near me tab offered with no map centres; the refused position not reset; the changed dot left off; a coordinate written on a card; a cell id written on a card; high accuracy asked for. A twentieth, the sort's tie-break, was an equivalent mutant (sort is stable) and was removed from the source | date: 2026-11-18
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { renderLandingArea, NEAR_MILES, type LandingAreaItem } from '../src/lib/landing-area';
import { AREA_TABS_SCRIPT } from '../src/lib/area-tabs-script';
import { AREA_TABS_STYLE } from '../src/lib/area-tabs-style';
import { cellsKey } from '../src/lib/street-map';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const CHICAGO = latLngToCell(41.8781, -87.6298, 7);
const MILWAUKEE = latLngToCell(43.0389, -87.9065, 7);
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

/** Seven events in Chicago's area, four in Milwaukee's, and one online. */
function rows(): LandingAreaItem[] {
  const placed = (i: number, cell: string): LandingAreaItem => ({
    id: `e${i}`,
    name: `Event ${i}`,
    startDateISO: inDays(2 + i),
    phase: 'pre_event',
    location: 'Somewhere',
    h3_res7: cell,
  });
  return [
    ...Array.from({ length: 7 }, (_, i) => placed(i, CHICAGO)),
    ...Array.from({ length: 4 }, (_, i) => placed(7 + i, MILWAUKEE)),
    { id: 'online', name: 'Online Event', startDateISO: inDays(3), phase: 'pre_event' },
  ];
}

const layer = (cells: string[]) =>
  ({
    cellsKey: cellsKey(cells),
    svg: '<g class="amap-s" data-testid="amap-streets"></g>',
    drawn: { highway: 1, major: 0, minor: 0, water: 0, rivers: 0 },
  }) as never;

/** The area the way the landing renders it over a street layer (or without one). */
function area(opts: { streets: boolean; lang?: 'en' | 'es' } = { streets: true }): string {
  const first = renderLandingArea(rows(), { now: NOW, lang: opts.lang });
  if (!opts.streets) return first.html;
  expect(first.mapCells?.length).toBe(2);
  return renderLandingArea(rows(), {
    now: NOW,
    lang: opts.lang,
    streets: layer(first.mapCells!),
    zoomHref: (c) => `/?area=${c}`,
  }).html;
}

interface Fake {
  calls: number;
  reply: 'ok' | 'denied';
  at: [number, number];
  pending: (() => void) | null;
}

/** The area's markup in jsdom, scripts run, with a fake position (or none). */
function open(html: string, geo: Fake | null) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      if (!geo) return;
      Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(ok: (p: unknown) => void, no: () => void) {
            geo.calls += 1;
            const answer = () =>
              geo.reply === 'ok'
                ? ok({ coords: { latitude: geo.at[0], longitude: geo.at[1] } })
                : no();
            // Answered at once, as a browser does where location is already allowed.
            answer();
          },
        },
      });
    },
  });
  const doc = dom.window.document;
  const q = <T extends Element = HTMLElement>(s: string) => doc.querySelector<T>(s)!;
  const qa = (s: string) => [...doc.querySelectorAll<HTMLElement>(s)];
  return { dom, doc, q, qa, win: dom.window };
}
const fake = (over: Partial<Fake> = {}): Fake => ({
  calls: 0,
  reply: 'ok',
  at: cellToLatLng(CHICAGO),
  pending: null,
  ...over,
});
const key = (win: Window, el: Element, k: string) =>
  el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
/** Press a distance chip: the chip's radio becomes the chosen one and says so. */
const choose = (win: Window, v: string) => {
  const r = win.document.getElementById('near-' + v) as HTMLInputElement;
  r.checked = true;
  r.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const chosen = (doc: Document) =>
  doc.querySelector<HTMLInputElement>('input[name="near"]:checked')!.value;
const visibleCards = (qa: (s: string) => HTMLElement[]) =>
  qa('.view-list article.event-card').filter((c) => c.style.display !== 'none');

describe('the filter tabs | what the page carries', () => {
  it('each filter group is a tab panel with its label; the Near me panel is hidden', () => {
    const html = area();
    const dom = new JSDOM(html).window.document;
    const panels = [...dom.querySelectorAll('.area-filters > .area-tab')].map((p) =>
      p.getAttribute('data-tab')
    );
    expect(panels).toEqual(['when', 'where', 'near']);
    expect(dom.querySelector('.area-filters')!.getAttribute('data-tabs')).toBe('Filter events');
    expect(dom.querySelector('[data-tab="when"]')!.getAttribute('data-tab-label')).toBe('When');
    const near = dom.querySelector('[data-tab="near"]')!;
    expect(near.hasAttribute('hidden')).toBe(true);
    // The owner's five distances (2026-11-19: "<2, 5, 10, 25, 50"), as chips on radios:
    // "Any distance" first and checked, then "Within N mi"; the label names the unit.
    expect([...NEAR_MILES]).toEqual([2, 5, 10, 25, 50]);
    const radios = [...near.querySelectorAll<HTMLInputElement>('input[type="radio"][name="near"]')];
    expect(radios.map((r) => r.value)).toEqual(['0', '2', '5', '10', '25', '50']);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false, false, false, false]);
    expect(near.querySelector('select')).toBeNull();
    expect(radios.map((r) => near.querySelector(`label[for="${r.id}"]`)!.textContent)).toEqual([
      'Any distance',
      'Within 2 mi',
      'Within 5 mi',
      'Within 10 mi',
      'Within 25 mi',
      'Within 50 mi',
    ]);
    for (const l of near.querySelectorAll('label[for^="near-"]')) {
      expect(l.classList.contains('disc-chip'), 'the shared chip class').toBe(true);
    }
    expect(near.querySelector('legend')!.textContent).toBe('Distance from where you are, in miles');
    // The words the script says, in the page's language, with the slot it fills.
    // (`%d`, never a `{slot}`: the Spanish page test holds the page to no slot left unfilled.)
    expect(near.getAttribute('data-shown')).toContain('%d');
    expect(near.getAttribute('data-none')).toContain('%d');
    expect(near.getAttribute('data-away')).toBe('about %d mi away');
    expect(near.outerHTML).not.toMatch(/\{\{|\{[a-z]+\}/);
  });

  it('the page is as before without the script: the chips are still radios and labels', () => {
    const html = area().replace(AREA_TABS_SCRIPT, '');
    expect(html).toContain('<fieldset class="disc-chips" data-testid="toggle-window">');
    expect(html).toContain('<label class="disc-chip" for="win-next-90">Next 90 days</label>');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
  });

  it('one script and one style, after the area; the style stays in its 400-char budget', () => {
    const html = area();
    expect(html.split(AREA_TABS_SCRIPT).length - 1).toBe(1);
    expect(html.split(AREA_TABS_STYLE).length - 1).toBe(1);
    expect(html.indexOf('data-testid="area-list"')).toBeLessThan(html.indexOf(AREA_TABS_SCRIPT));
    // The design check's budget counts the rules, not the tags around them.
    expect(AREA_TABS_STYLE.replace(/<\/?style>/g, '').length).toBeLessThanOrEqual(400);
    // Colours come from the tokens, never a hex.
    expect(AREA_TABS_STYLE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('each distance chip has its chosen look and focus ring from tokens, never a hex', () => {
    const html = area();
    for (const d of [0, ...NEAR_MILES]) {
      expect(html).toContain(`#near-${d}:checked + label{background:var(--accent)`);
      expect(html).toContain(`#near-${d}:focus-visible + label{outline:3px solid var(--accent)`);
    }
    expect(html.match(/#near-[0-9]+:[^}]*}/g)!.join('')).not.toMatch(/#[0-9a-fA-F]{3,8}(?!:)/);
  });

  it('the words are in the page language', () => {
    const dom = new JSDOM(area({ streets: true, lang: 'es' })).window.document;
    const near = dom.querySelector('[data-tab="near"]')!;
    expect(near.getAttribute('data-tab-label')).toBe('Cerca de mí');
    expect(near.querySelector('label[for="near-2"]')!.textContent).toBe('A menos de 2 mi');
    expect(near.querySelector('legend')!.textContent).toBe(
      'Distancia desde donde estás, en millas'
    );
    expect(dom.querySelector('.area-filters')!.getAttribute('data-tabs')).toBe('Filtrar eventos');
  });

  it('no card carries a cell id or a coordinate: the page’s cell ids are the map’s own', () => {
    const html = area().replace(AREA_TABS_SCRIPT, '');
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelectorAll('article.event-card')).toHaveLength(12);
    expect(
      doc.querySelectorAll('article.event-card[data-cell], article.event-card [data-cell]')
    ).toHaveLength(0);
    // Two areas, two cell ids, each on the map's own hexagon and nowhere else.
    expect([...html.matchAll(/data-cell="([0-9a-f]{15})"/g)].map((m) => m[1]).sort()).toEqual(
      [CHICAGO, MILWAUKEE].sort()
    );
  });

  it('below the map’s threshold the page holds no cell id at all', () => {
    const html = renderLandingArea(rows().slice(0, 5), { now: NOW }).html;
    expect(html).not.toContain('data-cell=');
    expect(html).not.toContain('data-area=');
    expect(html).not.toMatch(/872[0-9a-f]{12}/);
  });

  it('a card says nothing finer than its cell: no coordinate, whatever the event holds', () => {
    // The event's own point is somewhere else in the same area; the card cannot tell.
    const [lat, lon] = cellToLatLng(CHICAGO);
    const moved = rows().map((r) =>
      r.h3_res7 === CHICAGO ? { ...r, lat: lat + 0.01234, lon: lon - 0.01234 } : r
    );
    // The script names `data-ll` to read the map's centres; the markup carries none.
    const html = renderLandingArea(moved, { now: NOW }).html.replace(AREA_TABS_SCRIPT, '');
    const cards = [...new JSDOM(html).window.document.querySelectorAll('article.event-card')];
    for (const c of cards) expect(c.outerHTML).not.toMatch(/\d\.\d{3,}|\d{7,}/);
    expect(html).not.toContain('data-ll');
    expect(html).not.toContain('data-lat');
    expect(html).not.toMatch(/0\.01234|87\.64/);
  });
});

describe('the filter tabs | in a browser engine (jsdom)', () => {
  it('builds a tablist: one tab per group, one selected, the rest out of the tab order', () => {
    const { q, qa } = open(area(), fake());
    const list = q('[role="tablist"]');
    expect(list.getAttribute('aria-label')).toBe('Filter events');
    const tabs = qa('[role="tab"]');
    expect(tabs.map((t) => t.textContent)).toEqual(['When', 'Where', 'Near me']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    for (const t of tabs) {
      const panel = q(`#${t.getAttribute('aria-controls')}`);
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(t.id);
      expect(panel.hidden).toBe(t.getAttribute('aria-selected') !== 'true');
    }
  });

  it('a click selects a tab and shows its panel only', () => {
    const { q, qa } = open(area(), fake());
    q('#tab-where').click();
    expect(qa('[role="tab"]').map((t) => t.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(qa('[role="tabpanel"]').map((p) => p.hidden)).toEqual([true, false, true]);
  });

  it('arrow keys, Home and End move and select; the ends wrap', () => {
    const { q, qa, win, doc } = open(area(), fake());
    const sel = () =>
      qa('[role="tab"]').findIndex((t) => t.getAttribute('aria-selected') === 'true');
    q('#tab-when').focus();
    key(win as unknown as Window, doc.activeElement!, 'ArrowRight');
    expect(sel()).toBe(1);
    expect(doc.activeElement!.id).toBe('tab-where');
    key(win as unknown as Window, doc.activeElement!, 'End');
    expect(sel()).toBe(2);
    key(win as unknown as Window, doc.activeElement!, 'ArrowRight');
    expect(sel()).toBe(0);
    key(win as unknown as Window, doc.activeElement!, 'ArrowLeft');
    expect(sel()).toBe(2);
    key(win as unknown as Window, doc.activeElement!, 'Home');
    expect(sel()).toBe(0);
    expect(qa('[role="tab"]').map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('a control whose tab is closed is hidden (no focus, no unnamed control); the open group’s are not', () => {
    const { qa, q } = open(area(), fake());
    const tab = (id: string) => (id.startsWith('win-') ? 'when' : 'where');
    const radios = qa('input[type="radio"].toggle-radio').filter((r) => /^(win|mod)-/.test(r.id));
    expect(radios.length).toBeGreaterThan(0);
    for (const r of radios) {
      expect(r.hidden).toBe(tab(r.id) !== 'when');
    }
    q('#tab-where').click();
    for (const r of radios) {
      expect(r.hidden).toBe(tab(r.id) !== 'where');
    }
  });

  it('a hidden radio keeps its state, so a chosen filter still filters', () => {
    const { q, win } = open(area(), fake());
    const online = q<HTMLInputElement>('#mod-online');
    online.checked = true;
    online.dispatchEvent(new win.Event('change', { bubbles: true }));
    q('#tab-when').click(); // closes the Where group; its radios are now hidden
    expect(online.hidden).toBe(true);
    expect(online.checked).toBe(true);
  });

  it('a value chosen on a closed tab leaves a dot on that tab, and says so', () => {
    const { q, qa, win } = open(area(), fake());
    const online = q<HTMLInputElement>('#mod-online');
    online.checked = true;
    online.dispatchEvent(new win.Event('change', { bubbles: true }));
    const where = q('#tab-where');
    expect(where.hasAttribute('data-changed')).toBe(true);
    expect(where.querySelector('.sr-only')!.textContent).toBe(' (filter on)');
    expect(q('#tab-when').hasAttribute('data-changed')).toBe(false);
    q<HTMLInputElement>('#mod-all').checked = true;
    q<HTMLInputElement>('#mod-all').dispatchEvent(new win.Event('change', { bubbles: true }));
    expect(qa('[data-changed]')).toHaveLength(0);
  });

  it('with one group only, no tabs are built and the page stays as it was', () => {
    // Without the Near me tab (no geolocation) and with no online events there is one group.
    const first = renderLandingArea(
      rows().filter((r) => r.location),
      { now: NOW }
    );
    const { qa } = open(first.html, null);
    expect(qa('[role="tablist"]')).toHaveLength(0);
    expect(qa('[role="tab"]')).toHaveLength(0);
    expect(qa('[data-tab="when"]')[0]!.hasAttribute('role')).toBe(false);
  });
});

describe('the distance choice | what the phone does with its own position', () => {
  it('is offered with a position source and the map’s area centres; not without either', () => {
    expect(open(area(), fake()).qa('#tab-near')).toHaveLength(1);
    expect(open(area(), null).qa('#tab-near')).toHaveLength(0);
    expect(open(area({ streets: false }), fake()).qa('#tab-near')).toHaveLength(0);
    // The panel stays hidden where it is not offered.
    expect(open(area(), null).q('[data-tab="near"]').hidden).toBe(true);
  });

  it('reads no position until a distance is chosen', () => {
    const geo = fake();
    const { q, qa } = open(area(), geo);
    expect(geo.calls).toBe(0);
    q('#tab-near').click();
    expect(geo.calls).toBe(0);
    expect(visibleCards(qa)).toHaveLength(12);
  });

  it('a distance keeps the events within it, nearest first, and says how far', () => {
    const geo = fake(); // standing in Chicago's area
    const { q, qa, win } = open(area(), geo);
    choose(win as unknown as Window, '10');
    expect(geo.calls).toBe(1);
    const kept = visibleCards(qa);
    expect(kept).toHaveLength(7);
    expect(kept.map((c) => c.getAttribute('data-event-id'))).toEqual([
      'e0',
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
      'e6',
    ]);
    expect(kept[0]!.querySelector('[data-testid="card-distance"]')!.textContent).toBe(
      ' · about 0.0 mi away'
    );
    // The online event has no place, so it is left out; so is Milwaukee's area.
    expect(qa('.view-list article.event-card').filter((c) => !kept.includes(c))).toHaveLength(5);
    expect(
      q('#near-radius').closest('.area-tab')!.querySelector('[role="status"]')!.textContent
    ).toBe(
      'Showing events within 10 mi, nearest first. Events with no place on the map are left out.'
    );
    // The hexagon and the list row of the far area are hidden with its events.
    const far = qa('g[data-cell]').find((g) => g.getAttribute('data-cell') === MILWAUKEE)!;
    expect(far.style.display).toBe('none');
    expect(
      qa('li[data-area]').find((l) => l.getAttribute('data-area') === MILWAUKEE)!.style.display
    ).toBe('none');
    expect(q('#tab-near').hasAttribute('data-changed')).toBe(true);
  });

  it('keeps the events near wherever the person stands, not near a fixed place', () => {
    const geo = fake({ at: cellToLatLng(MILWAUKEE) });
    const { q, qa, win } = open(area(), geo);
    choose(win as unknown as Window, '50');
    const kept = visibleCards(qa);
    expect(kept).toHaveLength(4);
    expect(kept.map((c) => c.getAttribute('data-event-id'))).toEqual(['e7', 'e8', 'e9', 'e10']);
    choose(win as unknown as Window, '0');
    expect(geo.calls).toBe(1); // the position is kept in the page for the next choice
    choose(win as unknown as Window, '50');
    expect(geo.calls).toBe(1);
  });

  it('a wide distance lists every placed event, the nearest first', () => {
    // Standing between the two areas, nearer Milwaukee's (about 37 mi) than Chicago's
    // (about 43 mi), 50 mi reaches both; Milwaukee's events come second in the page
    // and must come first in the list.
    const geo = fake({ at: [42.5, -87.8] });
    const { q, qa, win } = open(area(), geo);
    choose(win as unknown as Window, '50');
    const kept = visibleCards(qa);
    expect(kept).toHaveLength(11);
    const dists = kept.map((c) => Number(c.getAttribute('data-d')));
    expect(dists).toEqual([...dists].sort((a, b) => a - b));
  });

  it('an event is in the area its public cell names, not the one its own point is in', () => {
    // Event e0's own point is in Milwaukee; its public cell is Chicago's.
    const [lat, lon] = cellToLatLng(MILWAUKEE);
    const moved = rows().map((r) => (r.id === 'e0' ? { ...r, lat, lon } : r));
    const first = renderLandingArea(moved, { now: NOW });
    const html = renderLandingArea(moved, {
      now: NOW,
      streets: layer(first.mapCells!),
      zoomHref: (c) => `/?area=${c}`,
    }).html;
    const { q, qa, win } = open(html, fake());
    choose(win as unknown as Window, '10');
    const kept = visibleCards(qa).map((c) => c.getAttribute('data-event-id'));
    expect(kept).toContain('e0');
    expect(kept).toHaveLength(7);
  });

  it('Any distance puts every event back, in the order the page had', () => {
    const geo = fake();
    const { q, qa, win } = open(area(), geo);
    const before = qa('.view-list article.event-card').map((c) => c.getAttribute('data-event-id'));
    choose(win as unknown as Window, '10');
    choose(win as unknown as Window, '0');
    const after = qa('.view-list article.event-card');
    expect(after.map((c) => c.getAttribute('data-event-id'))).toEqual(before);
    expect(after.every((c) => c.style.display !== 'none')).toBe(true);
    expect(qa('[data-testid="card-distance"]')).toHaveLength(0);
    expect(qa('g[data-cell]').every((g) => g.style.display !== 'none')).toBe(true);
    expect(q('#tab-near').hasAttribute('data-changed')).toBe(false);
  });

  it('a refused position puts the choice back to Any distance and says why', () => {
    const geo = fake({ reply: 'denied' });
    const { q, qa, win, doc } = open(area(), geo);
    choose(win as unknown as Window, '10');
    expect(chosen(doc)).toBe('0');
    expect(qa('input[name="near"]').some((r) => (r as HTMLInputElement).disabled)).toBe(false);
    expect(
      q('#near-radius').closest('.area-tab')!.querySelector('[role="status"]')!.textContent
    ).toBe('Location is off, so distance cannot be used.');
    expect(visibleCards(qa)).toHaveLength(12);
  });

  it('a distance beyond every event says so, in the page language', () => {
    const geo = fake({ at: [35, -100] }); // nowhere near either area
    const { q, win } = open(area({ streets: true, lang: 'es' }), geo);
    choose(win as unknown as Window, '5');
    expect(
      q('#near-radius').closest('.area-tab')!.querySelector('[role="status"]')!.textContent
    ).toBe('No hay eventos con lugar en el mapa a menos de 5 mi. Prueba una distancia mayor.');
  });
});

describe('the script | what it may never do (invariants 3 and 4)', () => {
  const src = AREA_TABS_SCRIPT;

  it('makes no request, sets no cookie, writes no storage, opens no socket', () => {
    for (const banned of [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /WebSocket/,
      /EventSource/,
      /\bnew\s+Image\b/,
      /\.src\s*=/,
      /document\.cookie/,
      /localStorage/,
      /sessionStorage/,
      /indexedDB/,
      /caches\b/,
      /navigator\.serviceWorker/,
      /\bimport\s*\(/,
      /\bwindow\.open\b/,
      /\.submit\s*\(/,
      /<form/,
    ]) {
      expect(src, String(banned)).not.toMatch(banned);
    }
  });

  it('never puts the position in the address, the history or the page’s markup', () => {
    for (const banned of [/location\./, /\blocation\s*=/, /history\./, /\.hash\b/, /\.search\b/]) {
      expect(src, String(banned)).not.toMatch(banned);
    }
    // The position is used in one place: the distance sum.
    expect(src.match(/here\[/g)!.length).toBeLessThanOrEqual(4);
    expect(src).not.toMatch(/setAttribute\([^)]*here/);
    expect(src).not.toMatch(/textContent\s*=[^;]*here/);
  });

  it('asks for the position in one place only, and only from the distance choice', () => {
    expect(src.match(/getCurrentPosition\(/g)).toHaveLength(1);
    const locate = src.slice(
      src.indexOf('function locate()'),
      src.indexOf('if (canNear) {\n    chips.forEach')
    );
    expect(locate).toContain('getCurrentPosition(');
    // `locate()` is called from the change handler and nowhere else, so never on load.
    expect(src.match(/\blocate\(\)/g)).toHaveLength(2); // the definition and the one call
    expect(src).toMatch(
      /addEventListener\('change', function \(\) \{\s*if \(radius\(\) > 0 && !here\) locate\(\)/
    );
    // A coarse, cached position is enough: no high accuracy asked.
    expect(src).toContain('enableHighAccuracy: false');
    // Nothing in the script watches the position.
    expect(src).not.toContain('watchPosition');
  });

  it('does not use the permission state to read the position on its own', () => {
    expect(src).not.toContain('permissions');
  });
});
