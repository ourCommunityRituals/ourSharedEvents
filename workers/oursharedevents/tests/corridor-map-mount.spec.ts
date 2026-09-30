/**
 * SharedReport corridor map: the SVG from renderCorridorMap() is rebuilt node by
 * node (mountCorridorSvg in shared-report.html), never assigned as HTML. The
 * page's own function is run in jsdom against the real renderer's output and
 * against hostile markup.
 *
 * Why: CodeQL (js/xss-more-sources) traced report.corridor_map.svg from the
 * fetched report into content.innerHTML. The renderer is ours, but the page
 * must not trust markup it did not build.
 *
 * @born-red CodeQL PR #691 | method: the "never assigned as HTML" test fails on
 *   the base template (cm.svg concatenated into the innerHTML string) and the
 *   mount tests fail to load there (no mountCorridorSvg) | date: 2026-09-30
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import SHARED_REPORT_HTML from '../src/templates/shared-report.html';
import { latLngToCell } from 'h3-js';
import { renderCorridorMap } from '../src/lib/corridor-map';

type Mount = (slot: Element, markup: string) => void;

function loadMount(): { mount: Mount; doc: Document } {
  const parsed = new JSDOM(SHARED_REPORT_HTML).window.document;
  const script = [...parsed.querySelectorAll('script')]
    .map((s) => s.textContent ?? '')
    .find((t) => t.includes('function mountCorridorSvg'));
  if (!script) throw new Error('mountCorridorSvg not found in shared-report.html');
  const fnSource = script.slice(script.indexOf('function mountCorridorSvg'));
  const dom = new JSDOM('<!doctype html><div id="slot"></div>', { runScripts: 'outside-only' });
  const w = dom.window as unknown as Window & { eval: (s: string) => unknown };
  const mount = w.eval(`(${fnSource.trim()})`) as Mount;
  return { mount, doc: dom.window.document };
}

function mounted(markup: string): Element {
  const { mount, doc } = loadMount();
  const slot = doc.getElementById('slot')!;
  mount(slot, markup);
  return slot;
}

const CELLS = [
  { cell: latLngToCell(41.6572, -87.6801, 9), count: 12, label: 'Eagles <Hall> & Bar' },
  { cell: latLngToCell(41.6612, -87.6851, 9), count: 2 },
];

describe('SharedReport corridor map is rebuilt, never assigned as HTML', () => {
  test('the template no longer concatenates cm.svg into the innerHTML string', () => {
    expect(SHARED_REPORT_HTML).not.toMatch(/:\s*cm\.svg\s*\+/);
    expect(SHARED_REPORT_HTML).toContain('data-corridor-svg');
    expect(SHARED_REPORT_HTML).toMatch(/mountCorridorSvg\(slot, cm\.svg\)/);
  });

  test("the renderer's real output mounts as SVG with its cells and titles", () => {
    const { svg } = renderCorridorMap(CELLS);
    const slot = mounted(svg);
    const root = slot.querySelector('svg')!;
    expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('data-testid')).toBe('corridor-map');
    expect(root.getAttribute('viewBox')).toBeTruthy();
    const cells = slot.querySelectorAll('polygon');
    expect(cells.length).toBeGreaterThan(0);
    expect(slot.querySelector('[data-testid="hex-cell"]')?.getAttribute('data-count')).toBe('12');
    // escXml'd label comes back as text, decoded once, never as markup.
    const titles = [...slot.querySelectorAll('title')].map((t) => t.textContent);
    expect(titles).toContain('Eagles <Hall> & Bar — 12 scans');
    expect(slot.querySelector('Hall')).toBeNull();
  });

  test('the empty-state map (a <text> element) mounts', () => {
    const { svg } = renderCorridorMap([]);
    const slot = mounted(svg);
    expect(slot.querySelector('svg text')?.textContent).toContain('Corridor data accumulates');
  });

  test.each([
    ['script element', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'],
    ['foreignObject', '<svg viewBox="0 0 1 1"><foreignObject><div>x</div></foreignObject></svg>'],
    ['image with href', '<svg viewBox="0 0 1 1"><image href="https://evil.example/x"/></svg>'],
  ])('an unknown element (%s) renders nothing', (_name, markup) => {
    const slot = mounted(markup);
    expect(slot.children.length).toBe(0);
  });

  test('event-handler and link attributes are dropped', () => {
    const slot = mounted(
      '<svg viewBox="0 0 1 1" onload="alert(1)"><polygon points="0,0 1,1" onclick="alert(2)" href="javascript:x" style="x" fill="#fff"><title>t</title></polygon></svg>'
    );
    const all = [...slot.querySelectorAll('*')];
    expect(all.length).toBe(3);
    for (const el of all) {
      for (const a of el.getAttributeNames()) {
        expect(a.startsWith('on')).toBe(false);
        expect(['href', 'style']).not.toContain(a);
      }
    }
    expect(slot.querySelector('polygon')?.getAttribute('fill')).toBe('#fff');
  });
});
