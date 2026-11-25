/**
 * OSE ADR-041: the SharedReport map is the NCR layer stack (base, hexagons,
 * corridors, rings) drawn from counts the report already publishes.
 *
 * What these hold:
 *  - the stack's ids, order and steps match the fleet registry (fleet ADR-013)
 *    and the SVG draws them in that order, one group per layer;
 *  - res 7, 6 and 5 areas are sums of published spots, never anything else;
 *  - only the counted layers carry a number: towns, corridors, nodes and rings
 *    carry none;
 *  - a surface picks its layers and gets only those;
 *  - no ring ships while OER's rings are practice data and the owner's ring
 *    decision is open;
 *  - the synced OER copy is pinned to a commit and holds no counts;
 *  - the page mounts the new marks, still drops anything else, and walks the
 *    steps (earlier faded, later hidden).
 *
 * @born-red OSE ADR-041 | method: each test was run against an injected fault
 *   (areas summed before the floor, a count on a node, layers reordered, a
 *   practice ring in OER_RINGS, `g` dropped from the mount allowlist, steps
 *   showing later layers) and failed | date: 2026-11-25
 */
import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { cellToParent, latLngToCell } from 'h3-js';
import SHARED_REPORT_HTML from '../src/templates/shared-report.html';
import {
  ALL_LAYERS,
  LAYER_STACK,
  areaCounts,
  renderLayerMap,
  type LayerId,
} from '../src/lib/ncr/layer-stack';
import { OER_GEOGRAPHIES, OER_SOURCE } from '../src/lib/ncr/oer-geographies.generated';
import { OER_RINGS } from '../src/lib/ncr/oer-rings';

// Two poster spots on 95th St in Evergreen Park and one in Beverly.
const A = latLngToCell(41.7215, -87.7017, 9);
const B = latLngToCell(41.7209, -87.693, 9);
const C = latLngToCell(41.7045, -87.6815, 9);
const SPOTS = [
  { cell: A, count: 10 },
  { cell: B, count: 15 },
  { cell: C, count: 5 },
];

function map(layers?: LayerId[]) {
  return renderLayerMap({ spots: SPOTS, geographies: OER_GEOGRAPHIES, rings: [], layers });
}

describe("the layer stack is data, in Matt's order", () => {
  test('ids, order and steps match the fleet registry', () => {
    expect(LAYER_STACK.map((l) => [l.id, l.order, l.step])).toEqual([
      ['base.towns', 10, 'base'],
      ['base.streets', 20, 'base'],
      ['hex.7', 30, 'hexagons'],
      ['hex.6', 40, 'hexagons'],
      ['hex.5', 50, 'hexagons'],
      ['corridors', 60, 'corridors'],
      ['nodes', 70, 'corridors'],
      ['rings', 80, 'rings'],
      ['report.cells', 90, 'corridors'],
    ]);
    for (const l of LAYER_STACK) expect(l.meaning.length).toBeGreaterThan(20);
  });

  test('the SVG draws one group per layer, bottom to top', () => {
    const { svg, layers } = map();
    const drawn = [
      ...svg.matchAll(/<g data-layer="([^"]+)" data-step="[^"]+" data-order="(\d+)"/g),
    ];
    expect(drawn.map((m) => m[1])).toEqual([...ALL_LAYERS]);
    const orders = drawn.map((m) => Number(m[2]));
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(layers.map((l) => l.id)).toEqual([...ALL_LAYERS]);
  });

  test('a surface gets only the layers it puts in play', () => {
    const { svg, layers } = map(['hex.7', 'base.towns']);
    expect(layers.map((l) => l.id)).toEqual(['base.towns', 'hex.7']);
    expect(svg).not.toContain('data-layer="corridors"');
    expect(svg).not.toContain('lm-spot');
  });
});

describe('counts: sums of published parts only', () => {
  test('res 7, 6 and 5 areas add up the spots inside them', () => {
    expect(new Set([A, B, C]).size).toBe(3);
    const areas = areaCounts(SPOTS);
    const sum = (res: 5 | 6 | 7, cell: string) =>
      areas.find((a) => a.res === res && a.cell === cellToParent(cell, res))!.scans;
    const sameSeven = cellToParent(A, 7) === cellToParent(B, 7);
    expect(sum(7, A)).toBe(sameSeven ? 25 : 10);
    // Every spot is in one res 5 area here, so it holds all 30.
    expect(areas.filter((a) => a.res === 5).reduce((n, a) => n + a.scans, 0)).toBe(30);
    for (const res of [5, 6, 7] as const) {
      expect(areas.filter((a) => a.res === res).reduce((n, a) => n + a.scans, 0)).toBe(30);
    }
  });

  test('towns, corridors, nodes and rings carry no number', () => {
    const { svg } = renderLayerMap({
      spots: SPOTS,
      geographies: OER_GEOGRAPHIES,
      rings: [{ id: 'r', size: 'small', cells: [cellToParent(A, 7)] }],
    });
    for (const id of ['base.towns', 'corridors', 'nodes', 'rings']) {
      const group = svg.match(
        new RegExp(`<g data-layer="${id.replace('.', '\\.')}"[^>]*>(.*?)</g>`)
      )![1]!;
      expect(group, id).not.toContain('data-count');
      expect(group.replace(/<[^>]+>/g, ' '), id).not.toMatch(/\d+ scans/);
    }
    expect(svg).toContain('lm-ring');
  });

  test('a spot with no published count is not drawn', () => {
    const { svg, areas } = renderLayerMap({
      spots: [{ cell: A, count: 0 }, ...SPOTS.slice(1)],
      geographies: [],
      rings: [],
    });
    expect(svg).not.toContain(`data-cell="${A}"`);
    expect(areas.filter((a) => a.res === 5).reduce((n, a) => n + a.scans, 0)).toBe(20);
  });

  test('with no spot, the map frames the area it is given and counts nothing', () => {
    const { svg, areas } = renderLayerMap({
      spots: [],
      around: cellToParent(A, 7),
      geographies: OER_GEOGRAPHIES,
      rings: [],
    });
    expect(areas).toEqual([]);
    expect(svg).not.toContain('data-count');
    expect(() => renderLayerMap({ spots: [], geographies: [], rings: [] })).toThrow();
  });
});

describe('what comes from ourEventRings', () => {
  test('no ring ships: OER rings are practice data and the owner has not decided', () => {
    expect(OER_RINGS).toEqual([]);
  });

  test('the synced copy is pinned to a commit and holds road research, not counts', () => {
    expect(OER_SOURCE.ref).toMatch(/^[0-9a-f]{40}$/);
    const text = JSON.stringify(OER_GEOGRAPHIES);
    expect(text).not.toMatch(/"(count|scans|people|saturation|visits)"/);
    const sw = OER_GEOGRAPHIES.find((g) => g.id === 'chicago-sw')!;
    expect(sw.segments.length).toBeGreaterThan(50);
    expect(sw.towns.map((t) => t.name)).toContain('Evergreen Park');
  });

  test('Evergreen Park spots draw the Western Avenue corridor and the town', () => {
    const { svg, layers } = map();
    expect(svg).toMatch(/<title>Evergreen Park<\/title>/);
    expect(svg).toMatch(/<title>Western Avenue: /);
    expect(layers.find((l) => l.id === 'corridors')!.shown).toBeGreaterThan(0);
  });
});

// ─── The page ────────────────────────────────────────────────────────────────

function pageFunctions(dom: JSDOM) {
  const parsed = new JSDOM(SHARED_REPORT_HTML).window.document;
  const script = [...parsed.querySelectorAll('script')]
    .map((s) => s.textContent ?? '')
    .find((t) => t.includes('function mountCorridorSvg'))!;
  const pick = (name: string) => {
    const at = script.indexOf(`function ${name}`);
    let depth = 0;
    let i = script.indexOf('{', at);
    for (; i < script.length; i++) {
      if (script[i] === '{') depth++;
      else if (script[i] === '}' && --depth === 0) break;
    }
    return script.slice(at, i + 1);
  };
  const w = dom.window as unknown as { eval: (s: string) => unknown };
  return {
    mount: w.eval(`(${pick('mountCorridorSvg')})`) as (slot: Element, markup: string) => void,
    wire: w.eval(`(${pick('wireLayerSteps')})`) as (root: Element, layers: unknown[]) => void,
  };
}

describe('the report page mounts and walks the layers', () => {
  function page() {
    const dom = new JSDOM(
      '<!doctype html><div id="root"><div data-lm-steps></div><p data-lm-say></p><div data-corridor-svg></div></div>',
      { runScripts: 'outside-only' }
    );
    const { mount, wire } = pageFunctions(dom);
    const doc = dom.window.document;
    const root = doc.getElementById('root')!;
    const { svg, layers } = map();
    mount(root.querySelector('[data-corridor-svg]')!, svg);
    wire(root, layers);
    return { doc, root };
  }

  test('every layer group and mark survives the mount', () => {
    const { root } = page();
    const groups = [...root.querySelectorAll('svg > g[data-layer]')].map((g) =>
      g.getAttribute('data-layer')
    );
    expect(groups).toEqual([...ALL_LAYERS]);
    expect(root.querySelector('path.lm-town')).not.toBeNull();
    expect(root.querySelector('polyline.lm-seg')).not.toBeNull();
    expect(root.querySelector('circle.lm-spot')?.getAttribute('data-count')).toBeTruthy();
  });

  test('hostile markup is still dropped', () => {
    const dom = new JSDOM('<!doctype html><div id="s"></div>', { runScripts: 'outside-only' });
    const { mount } = pageFunctions(dom);
    const slot = dom.window.document.getElementById('s')!;
    mount(
      slot,
      '<svg viewBox="0 0 1 1"><g data-layer="x" onclick="alert(1)" style="x"><path d="M0,0" href="javascript:x"/><script>alert(1)</script></g></svg>'
    );
    expect(slot.querySelector('script')).toBeNull();
    expect(slot.innerHTML).not.toMatch(/onclick|style=|href|alert/);
  });

  test('step 1 shows the base only; later steps fade earlier ones and hide later ones', () => {
    const { root } = page();
    const shown = () =>
      [...root.querySelectorAll('svg > g[data-step]')]
        .filter((g) => g.getAttribute('display') !== 'none')
        .map((g) => `${g.getAttribute('data-layer')}@${g.getAttribute('opacity')}`);
    expect(shown()).toEqual(['base.towns@1', 'base.streets@1']);
    (root.querySelector('[data-step="corridors"]') as HTMLButtonElement).click();
    expect(shown()).toEqual([
      'base.towns@1',
      'base.streets@1',
      'hex.7@0.4',
      'hex.6@0.4',
      'hex.5@0.4',
      'corridors@1',
      'nodes@1',
      'report.cells@1',
    ]);
    (root.querySelector('[data-step="rings"]') as HTMLButtonElement).click();
    expect(root.querySelector('[data-lm-say]')!.textContent).toContain(
      'No rings are shown on reports yet'
    );
    (root.querySelector('[data-step="all"]') as HTMLButtonElement).click();
    expect(shown().every((s) => s.endsWith('@1'))).toBe(true);
    expect(shown()).toHaveLength(ALL_LAYERS.length);
  });
});
