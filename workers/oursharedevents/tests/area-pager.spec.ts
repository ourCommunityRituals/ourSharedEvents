/**
 * The landing's event cards, five at a time, nearest first once a distance is
 * known (owner, 2026-11-21; lib/area-pager.ts).
 *
 * What the server sends (the button hidden, its words in the page's language),
 * how the script behaves in jsdom (five, then "Click for more" five at a time
 * until the list ends; a filter starts again at five; the cards nearest first
 * once the map's list carries distances, the server's order until then), and what
 * the script may never do: read a position, ask for anything or store anything.
 * A real browser runs it in tests/e2e/2-pages/landing-pager.component.spec.ts.
 *
 * Node project: pure rendering, the script's text, and jsdom. Registered in
 * vitest.node-specs.mjs.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { latLngToCell } from 'h3-js';
import { renderLandingArea, type LandingAreaItem } from '../src/lib/landing-area';
import { areaPager, PAGE_SIZE } from '../src/lib/area-pager';
import { cellsKey } from '../src/lib/street-map';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const CHICAGO = latLngToCell(41.8781, -87.6298, 7);
const MILWAUKEE = latLngToCell(43.0389, -87.9065, 7);
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

/** `n` events, alternating between two areas (Chicago first), soonest first; some online. */
function rows(n: number, opts: { online?: number } = {}): LandingAreaItem[] {
  const out: LandingAreaItem[] = Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    name: `Event ${i}`,
    startDateISO: inDays(2 + i),
    phase: 'pre_event',
    location: 'Somewhere',
    h3_res7: i % 2 ? MILWAUKEE : CHICAGO,
  }));
  for (let i = 0; i < (opts.online ?? 0); i++)
    out.push({ id: `on${i}`, name: `Online ${i}`, startDateISO: inDays(1), phase: 'pre_event' });
  return out;
}

const layer = (cells: string[]) =>
  ({
    cellsKey: cellsKey(cells),
    svg: '<g class="amap-s" data-testid="amap-streets"></g>',
    drawn: { highway: 1, major: 0, minor: 0, water: 0, rivers: 0 },
  }) as never;

/** The area as the landing renders it, over a street layer when there is a map. */
function area(items: LandingAreaItem[], lang: 'en' | 'es' = 'en'): string {
  const first = renderLandingArea(items, { now: NOW, lang });
  if (!first.mapCells?.length) return first.html;
  return renderLandingArea(items, {
    now: NOW,
    lang,
    streets: layer(first.mapCells),
    zoomHref: (c) => `/?area=${c}`,
  }).html;
}

function open(html: string) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const doc = win.document;
  const q = <T extends Element = HTMLElement>(s: string) => doc.querySelector<T>(s)!;
  const qa = (s: string) => [...doc.querySelectorAll<HTMLElement>(s)];
  const ids = () => qa('.view-list article.event-card').map((c) => c.getAttribute('data-event-id'));
  const shown = () =>
    qa('.view-list article.event-card')
      .filter((c) => win.getComputedStyle(c).display !== 'none')
      .map((c) => c.getAttribute('data-event-id'));
  const more = () => q<HTMLButtonElement>('[data-testid="area-more"]');
  const say = () => q('[data-testid="area-more-status"]').textContent;
  /** MutationObserver callbacks run as microtasks. */
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { win, doc, q, qa, ids, shown, more, say, settle };
}

describe('the cards five at a time | what the server sends', () => {
  it('the button and its status line follow the list, the button hidden until the script shows it', () => {
    const html = area(rows(12));
    const list = html.indexOf('data-testid="area-list"');
    const button = html.indexOf('data-testid="area-more"');
    expect(button).toBeGreaterThan(list);
    expect(html).toMatch(
      /<p class="area-more" hidden><button class="btn btn-secondary" type="button" data-testid="area-more">Click for more<\/button><\/p>/
    );
    expect(html).toMatch(
      /role="status" aria-live="polite" data-testid="area-more-status" data-says="Showing %n of %t events."/
    );
    // Without the script, nothing is held back.
    expect(html).not.toMatch(/<article[^>]*data-more/);
  });

  it('speaks the page language', () => {
    const html = area(rows(12), 'es');
    expect(html).toContain('>Haz clic para ver más</button>');
    expect(html).toContain('data-says="Mostrando %n de %t eventos."');
  });

  it('the style hides only the waiting cards, with tokens and no colour of its own', () => {
    const style = areaPager('en').match(/<style>[^<]*<\/style>/)![0];
    expect(style).toContain('.view-list .event-card[data-more]{display:none}');
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(style.length - '<style></style>'.length).toBeLessThanOrEqual(400);
  });
});

describe('the cards five at a time | what the script does', () => {
  it(`shows ${PAGE_SIZE}, then ${PAGE_SIZE} more a tap, and the button goes when the list ends`, async () => {
    const { ids, shown, more, say, doc } = open(area(rows(12)));
    const all = ids();
    expect(shown()).toEqual(all.slice(0, 5));
    expect(more().parentElement!.hidden).toBe(false);
    expect(say()).toBe('Showing 5 of 12 events.');

    more().click();
    expect(shown()).toEqual(all.slice(0, 10));
    expect(more().parentElement!.hidden).toBe(false);
    expect(say()).toBe('Showing 10 of 12 events.');
    // Focus goes to the first card the tap brought in.
    expect(doc.activeElement!.closest('article')!.getAttribute('data-event-id')).toBe(all[5]);

    more().click();
    expect(shown()).toEqual(all);
    expect(more().parentElement!.hidden).toBe(true);
    expect(say()).toBe('Showing 12 of 12 events.');
    expect(doc.activeElement!.closest('article')!.getAttribute('data-event-id')).toBe(all[10]);
  });

  it('five or fewer: every card shows and there is no button and no status', () => {
    for (const n of [1, 5]) {
      const { ids, shown, more, say } = open(area(rows(n)));
      expect(shown()).toEqual(ids());
      expect(more().parentElement!.hidden, String(n)).toBe(true);
      expect(say()).toBe('');
    }
  });

  it('exactly ten: one tap shows the rest and the button goes', () => {
    const { ids, shown, more } = open(area(rows(10)));
    more().click();
    expect(shown()).toEqual(ids());
    expect(more().parentElement!.hidden).toBe(true);
  });

  it('counts only the cards a filter leaves, and a filter change starts again at five', async () => {
    // Twelve in person and three online: "Online" leaves three, so no button.
    const { win, ids, shown, more, say, q } = open(area(rows(12, { online: 3 })));
    more().click();
    expect(shown()).toHaveLength(10);
    const online = q<HTMLInputElement>('#mod-online');
    online.checked = true;
    online.dispatchEvent(new win.Event('change', { bubbles: true }));
    expect(shown()).toEqual(['on0', 'on1', 'on2']);
    expect(more().parentElement!.hidden).toBe(true);
    const all = q<HTMLInputElement>('#mod-all');
    all.checked = true;
    // jsdom keeps computed styles until an attribute changes, and a radio's
    // `checked` is not one; a browser restyles. Touch an attribute, as a browser would.
    q('body').setAttribute('data-restyle', '');
    all.dispatchEvent(new win.Event('change', { bubbles: true }));
    expect(shown()).toEqual(ids().slice(0, 5));
    expect(say()).toBe('Showing 5 of 15 events.');
  });

  it('keeps the order the server sent while no distance is known', async () => {
    const { ids, settle } = open(area(rows(12)));
    const before = ids();
    await settle();
    expect(ids()).toEqual(before);
    expect(before).toEqual(rows(12).map((e) => e.id));
  });

  it("puts the cards nearest first once the map's list carries distances, unplaced ones last", async () => {
    const { qa, ids, shown, settle } = open(area(rows(12, { online: 2 })));
    const rowsOf = qa('li[data-area]');
    expect(rowsOf).toHaveLength(2);
    // Milwaukee is nearer: what "Show where I am" in Milwaukee writes.
    for (const li of rowsOf)
      li.setAttribute('data-d', li.getAttribute('data-area') === MILWAUKEE ? '0.500' : '80.000');
    await settle();
    const odd = rows(12)
      .filter((_, i) => i % 2)
      .map((e) => e.id);
    const even = rows(12)
      .filter((_, i) => i % 2 === 0)
      .map((e) => e.id);
    // The online events come first from the server (soonest), and go last here.
    expect(ids()).toEqual([...odd, ...even, 'on0', 'on1']);
    expect(shown()).toEqual(odd.slice(0, 5));
  });
});

describe('the cards five at a time | what the script may never do', () => {
  const src = areaPager('en').match(/<script>([^]*)<\/script>/)![1];
  it('never reads a position, asks for anything, or stores anything', () => {
    for (const banned of [
      /geolocation/,
      /getCurrentPosition/,
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /document\.cookie/,
      /localStorage/,
      /sessionStorage/,
      /indexedDB/,
      /history\./,
      /location\./,
    ]) {
      expect(src, String(banned)).not.toMatch(banned);
    }
  });
});
