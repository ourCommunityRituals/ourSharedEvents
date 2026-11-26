/**
 * The map's own tooltip (lib/map-tip-script.ts; owner, 2026-11-25: "more user
 * friendly providing space from the mouse pointer", and "what displays when I
 * hover or press and hold on a mobile?").
 *
 * What the server sends: each hexagon and each place names itself twice, in
 * its `<title>` (scripts off: the browser's own tooltip, as before) and in
 * `data-tip`; the script once per map; a style with tokens only. And what the
 * script does, run in jsdom on the map's own markup:
 *   - the `<title>`s stay, as the shapes' names (an aria-label would break
 *     WCAG 2.5.3), and are emptied only while a mouse is over their shape, so
 *     the browser's own tooltip does not show beside this one;
 *   - a mouse puts the tooltip 16 px below and right of the pointer, flipped
 *     at the screen's right and bottom edges, and hides it off the shape;
 *   - a press and hold on a phone shows it 64 px above the finger, and the
 *     link is not followed on letting go, nor the link menu opened;
 *   - a plain tap still follows the link and shows nothing; a moved finger
 *     cancels the hold; a tap on a hexagon that is not a link names it;
 *   - keyboard focus shows it, Escape hides it.
 * The script may never ask for anything or store anything.
 *
 * jsdom lays nothing out: the tooltip's size is stood in for, and the screen
 * is jsdom's 1024 by 768. jsdom has no PointerEvent, so pointer events are
 * mouse events with a `pointerType`.
 *
 * Node project: pure rendering and jsdom. Registered in vitest.node-specs.mjs.
 *
 * @born-red the map's tooltip | method: faults put in one at a time in
 *   lib/map-tip-script.ts, this file run, the source restored; each turned it
 *   red: GAP set to 0 (the tooltip back on the pointer); the right-edge flip
 *   removed; the `<title>` not emptied on hover; the `<title>` not put back; the click after a hold not
 *   prevented; the hold's timer not cancelled on a move; the tap on a plain
 *   hexagon not shown; data-tip left off the dots in attendee-map.ts |
 *   date: 2026-11-25
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { gridDisk, latLngToCell } from 'h3-js';
import { renderAttendeeMap } from '../src/lib/attendee-map';
import { TIP_SCRIPT } from '../src/lib/map-tip-script';
import { TIP_STYLE } from '../src/lib/map-tip-style';
import { cellsKey } from '../src/lib/street-map';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const CELL = latLngToCell(41.6565, -87.681, 7);
const NEAR = gridDisk(CELL, 1).find((c) => c !== CELL)!;
const ev = (id: string, cell: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Event ${id}`,
  startDateISO: new Date(NOW + 3 * 86_400_000).toISOString(),
  phase: 'pre_event',
  h3_res7: cell,
  location: 'Somewhere, Evergreen Park, IL 60805',
  ...extra,
});
const items = [ev('a', CELL), ev('b', CELL), ev('c', NEAR)];
const gate = { count: 10, min: 10 };

/** The landing's map: two large hexagons, each a link. */
const linked = () =>
  renderAttendeeMap(items, { now: NOW, area: gate, zoomHref: (c) => `/?area=${c}` }).html;
/** The same map where a hexagon is not a link (no zoom). */
const plain = () => renderAttendeeMap(items, { now: NOW, area: gate }).html;
/** Zoomed in on one area over a street layer: dots. */
const zoomed = () =>
  renderAttendeeMap([], {
    now: NOW,
    streets: {
      cellsKey: cellsKey([CELL]),
      svg: '<g class="amap-s"></g>',
      drawn: { highway: 1, major: 0, minor: 0, water: 0, rivers: 0 },
    } as never,
    zoom: {
      cell: CELL,
      backHref: '/',
      events: [
        { ...ev('a', CELL), h3_res9: latLngToCell(41.6565, -87.681, 9), classes: [] },
        { ...ev('b', CELL), h3_res9: latLngToCell(41.6565, -87.681, 9), classes: [] },
      ] as never,
    },
  }).html;

const TIP_W = 200;
const TIP_H = 40;

function open(html: string) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const doc = win.document;
  const tip = doc.querySelector('[data-testid="amap-tip"]') as HTMLElement;
  if (tip) {
    Object.defineProperty(tip, 'offsetWidth', { value: TIP_W });
    Object.defineProperty(tip, 'offsetHeight', { value: TIP_H });
  }
  /** A pointer event: jsdom has no PointerEvent, so a mouse event with a pointerType. */
  const ptr = (type: string, target: Element, x: number, y: number, kind = 'mouse') => {
    const e = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerType', { value: kind });
    target.dispatchEvent(e);
    return e;
  };
  const click = (target: Element) => {
    const e = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  const px = (v: string) => Number(v.replace('px', ''));
  return { win, doc, tip, ptr, click, at: () => [px(tip.style.left), px(tip.style.top)] };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the map tooltip | what the server sends', () => {
  it('each hexagon names itself in data-tip, the same words as its <title>', () => {
    const html = linked();
    const areas = [
      ...html.matchAll(/<g[^>]*data-testid="amap-area"[^>]*data-tip="([^"]+)">(.*?)<\/g>/g),
    ];
    expect(areas).toHaveLength(2);
    for (const [, tip, body] of areas) {
      expect(tip).toMatch(/^Area \d, Evergreen Park: \d events?$/);
      expect(body).toContain(`<title>${tip}</title>`);
    }
  });

  it('each place on the zoomed map names itself in data-tip, as its <title> does', () => {
    const html = zoomed();
    const dots = [
      ...html.matchAll(
        /<a [^>]*data-testid="amap-dot"[^>]*data-tip="([^"]+)"><title>([^<]+)<\/title>/g
      ),
    ];
    expect(dots.length).toBeGreaterThan(0);
    for (const [, tip, title] of dots) expect(tip).toBe(title);
  });

  it('the script once on each map, with or without a street map; the style with it', () => {
    for (const html of [linked(), plain(), zoomed()]) {
      expect(html.split(TIP_SCRIPT).length - 1).toBe(1);
      expect(html).toContain(TIP_STYLE);
    }
  });

  it('a name is escaped in data-tip as in <title>', () => {
    const html = renderAttendeeMap(
      [ev('x', CELL, { location: 'A "B" <C> & D, Evergreen Park, IL 60805' })],
      { now: NOW, area: gate }
    ).html;
    expect(html).not.toMatch(/data-tip="[^"]*<C>/);
  });

  it('the style uses tokens only, fits the inline budget, and takes no pointer', () => {
    expect(TIP_STYLE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(TIP_STYLE).not.toMatch(/rgba?\(/);
    expect(TIP_STYLE.replace(/<\/?style>/g, '').length).toBeLessThanOrEqual(400);
    expect(TIP_STYLE).toContain('pointer-events:none');
    expect(TIP_STYLE).toContain('font:16px');
  });

  it('the script asks for nothing, stores nothing and reads no position', () => {
    for (const bad of [
      'fetch(',
      'XMLHttpRequest',
      'sendBeacon',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
      'geolocation',
      'location.hash',
      'new Image',
      'import(',
    ]) {
      expect(TIP_SCRIPT).not.toContain(bad);
    }
  });
});

describe('the map tooltip | in a browser (jsdom)', () => {
  it('the <title>s stay (the shapes keep their names), and the tooltip starts hidden from sight and from screen readers', () => {
    const { doc, tip } = open(linked());
    const titles = doc.querySelectorAll('[data-tip] title');
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) {
      expect(t.textContent).toBe(t.closest('[data-tip]')!.getAttribute('data-tip'));
    }
    // An aria-label would break WCAG 2.5.3 (the name must hold the number shown).
    expect(doc.querySelector('[data-testid="amap-area-link"][aria-label]')).toBe(null);
    expect(tip.hidden).toBe(true);
    expect(tip.getAttribute('aria-hidden')).toBe('true');
    expect(doc.querySelector('figure.amap')!.classList.contains('amap-tips')).toBe(true);
  });

  it('while a mouse is over a shape its <title> is empty (no second, browser tooltip), and it comes back', () => {
    const { doc, ptr } = open(linked());
    const area = doc.querySelector('[data-testid="amap-area"]')!;
    const words = area.getAttribute('data-tip');
    ptr('pointermove', area.querySelector('polygon')!, 300, 200);
    for (const t of area.querySelectorAll('title')) expect(t.textContent).toBe('');
    ptr('pointermove', doc.body, 600, 600);
    for (const t of area.querySelectorAll('title')) expect(t.textContent).toBe(words);
    expect(area.querySelector('title[data-t]')).toBe(null);
  });

  it('a mouse: 16 px below and right of the pointer, following it, never on it', () => {
    const { doc, tip, ptr, at } = open(linked());
    const poly = doc.querySelector('[data-testid="amap-area"] polygon')!;
    ptr('pointermove', poly, 300, 200);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe(poly.closest('[data-tip]')!.getAttribute('data-tip'));
    expect(at()).toEqual([316, 216]);
    ptr('pointermove', poly, 320, 210);
    expect(at()).toEqual([336, 226]);
  });

  it('a mouse near the right or bottom edge: the tooltip flips to the other side and stays on screen', () => {
    const { doc, ptr, at } = open(linked());
    const poly = doc.querySelector('[data-testid="amap-area"] polygon')!;
    ptr('pointermove', poly, 1000, 200);
    expect(at()).toEqual([1000 - 16 - TIP_W, 216]);
    ptr('pointermove', poly, 300, 760);
    expect(at()).toEqual([316, 760 - 16 - TIP_H]);
  });

  it('off the shape, it goes', () => {
    const { doc, tip, ptr } = open(linked());
    ptr('pointermove', doc.querySelector('[data-testid="amap-area"] polygon')!, 300, 200);
    ptr('pointermove', doc.body, 600, 600);
    expect(tip.hidden).toBe(true);
  });

  it('a press and hold on a phone: above the finger, no link menu, and letting go does not open the link', async () => {
    const { doc, tip, ptr, click, at, win } = open(linked());
    const link = doc.querySelector('[data-testid="amap-area-link"]')!;
    const poly = link.querySelector('polygon')!;
    ptr('pointerdown', poly, 300, 400, 'touch');
    await wait(500);
    expect(tip.hidden).toBe(false);
    expect(at()).toEqual([300 - TIP_W / 2, 400 - 64 - TIP_H]);
    const menu = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    poly.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    ptr('pointerup', poly, 300, 400, 'touch');
    expect(click(poly).defaultPrevented).toBe(true);
  });

  it('near the top of the screen the held tooltip goes below the finger instead', async () => {
    const { doc, ptr, at } = open(linked());
    ptr('pointerdown', doc.querySelector('[data-testid="amap-area"] polygon')!, 300, 60, 'touch');
    await wait(500);
    expect(at()).toEqual([300 - TIP_W / 2, 60 + 64]);
  });

  it('a plain tap still opens the area and shows nothing', async () => {
    const { doc, tip, ptr, click } = open(linked());
    const poly = doc.querySelector('[data-testid="amap-area-link"] polygon')!;
    ptr('pointerdown', poly, 300, 400, 'touch');
    ptr('pointerup', poly, 300, 400, 'touch');
    expect(click(poly).defaultPrevented).toBe(false);
    await wait(500);
    expect(tip.hidden).toBe(true);
  });

  it('a finger that moves (a scroll or a drag) cancels the hold', async () => {
    const { doc, tip, ptr } = open(linked());
    const poly = doc.querySelector('[data-testid="amap-area"] polygon')!;
    ptr('pointerdown', poly, 300, 400, 'touch');
    ptr('pointermove', poly, 300, 430, 'touch');
    await wait(500);
    expect(tip.hidden).toBe(true);
  });

  it('a tap on a hexagon that is not a link names it, where before it did nothing', () => {
    const { doc, tip, ptr } = open(plain());
    expect(doc.querySelector('[data-testid="amap-area-link"]')).toBe(null);
    const poly = doc.querySelector('[data-testid="amap-area"] polygon')!;
    ptr('pointerdown', poly, 300, 400, 'touch');
    ptr('pointerup', poly, 300, 400, 'touch');
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toMatch(/^Area \d, Evergreen Park/);
  });

  it('a place on the zoomed map: hover names it beside the pointer', () => {
    const { doc, tip, ptr, at } = open(zoomed());
    const dot = doc.querySelector('[data-testid="amap-dot"] circle')!;
    ptr('pointermove', dot, 200, 150);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe('Spot 1: 2 events');
    expect(at()).toEqual([216, 166]);
  });

  it('keyboard focus shows it, Escape hides it', () => {
    const { doc, tip, win } = open(linked());
    const link = doc.querySelector('[data-testid="amap-area-link"]') as unknown as HTMLElement;
    link.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }));
    expect(tip.hidden).toBe(false);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tip.hidden).toBe(true);
  });
});
