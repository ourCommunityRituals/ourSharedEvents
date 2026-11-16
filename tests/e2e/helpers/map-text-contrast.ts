/**
 * The contrast of the text drawn on the map, read from a live page and judged
 * by measurement (street-map CCR 2026-11-15, R27 and R38).
 *
 * axe cannot decide text drawn over the street layer: town names and dot
 * numbers come back "incomplete". This reads, for every `<text>` in the map's
 * `<svg>`, the colours the browser resolved from the tokens in the theme on
 * screen: the text's own fill, its halo (a stroke painted under the fill), the
 * shape it sits on (a dot under its number), every paint drawn before it, and
 * every translucent shape drawn over it. scripts/ci/map-text-contrast.mjs turns
 * that into a WCAG ratio and a verdict; the rule it judges by is written there.
 *
 * Two specs call it, so one judge decides at both layers:
 *   tests/e2e/2-pages/street-map-contrast.component.spec.ts   the mock layer
 *     (the real landing handler over a synthetic archive, both themes, on every PR)
 *   tests/e2e/3-flows/map-place-panel.spec.ts                 staging (T4k)
 */
import type { Page } from '@playwright/test';
import { judgeMapText, verdictLine } from '../../../scripts/ci/map-text-contrast.mjs';

export interface PaintRead {
  what: string;
  /** A computed colour, as the browser gives it. */
  color: string;
  /** What the element adds: its fill or stroke opacity times its group opacity. */
  alpha: number;
  /** An opaque shape over the whole frame: nothing before it shows. */
  whole?: boolean;
}

export interface MapTextRead {
  kind: 'town name' | 'dot number' | 'pale dot number' | 'area number' | 'other';
  text: string;
  /** Font size on screen, in CSS px. */
  px: number;
  weight: number;
  /** Its middle is inside the map's box: a name the frame cuts off is not read. */
  shown: boolean;
  fill: { color: string; alpha: number };
  /** A stroke painted under the fill; `px` is what shows outside the letter on screen. */
  halo: { color: string; alpha: number; px: number } | null;
  /** The text's own shape under it: the dot under a dot number. */
  plate: PaintRead | null;
  ground: string;
  under: PaintRead[][];
  over: PaintRead[];
}

/** Every `<text>` of the map on this page, with the colours around it. */
export async function readMapText(page: Page): Promise<MapTextRead[]> {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="amap-svg"]');
    if (!svg) return [];
    const box = svg.getBoundingClientRect();
    const scale = svg.getScreenCTM()!.a;

    /** The opacity of an element and of every group round it, up to the drawing. */
    const groupOpacity = (el: Element): number => {
      let o = 1;
      for (let e: Element | null = el; e && e !== svg.parentElement; e = e.parentElement) {
        o *= parseFloat(getComputedStyle(e).opacity);
      }
      return o;
    };
    const NAMES: [string, string][] = [
      ['as-l', 'land'],
      ['as-w', 'water'],
      ['as-v', 'a river'],
      ['as-1', 'a minor road'],
      ['as-2', 'a major road'],
      ['as-3', 'a highway'],
      ['amap-zone', "the area's outline"],
      ['amap-cell', 'a hexagon'],
      ['amap-dot', 'its dot'],
    ];
    const nameOf = (el: Element): string =>
      NAMES.find(([cls]) => el.classList.contains(cls))?.[1] ??
      `<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">`;

    interface Shape {
      el: SVGGeometryElement;
      layer: string;
      dot: Element | null;
      paints: {
        part: 'fill' | 'stroke';
        what: string;
        color: string;
        alpha: number;
        whole: boolean;
      }[];
    }
    const view = svg.viewBox.baseVal;
    const shapes: Shape[] = [
      ...svg.querySelectorAll<SVGGeometryElement>('rect,path,polygon,polyline,circle,ellipse,line'),
    ].map((el) => {
      const cs = getComputedStyle(el);
      const group = groupOpacity(el);
      const paints: Shape['paints'] = [];
      const what = nameOf(el);
      if (cs.fill !== 'none') {
        const alpha = parseFloat(cs.fillOpacity) * group;
        const b = el.getBBox();
        const whole =
          el.tagName.toLowerCase() === 'rect' &&
          b.x <= view.x &&
          b.y <= view.y &&
          b.x + b.width >= view.x + view.width &&
          b.y + b.height >= view.y + view.height;
        if (alpha > 0) paints.push({ part: 'fill', what, color: cs.fill, alpha, whole });
      }
      if (cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0) {
        const alpha = parseFloat(cs.strokeOpacity) * group;
        if (alpha > 0) {
          paints.push({
            part: 'stroke',
            what: `the edge of ${what}`,
            color: cs.stroke,
            alpha,
            whole: false,
          });
        }
      }
      return {
        el,
        layer: el.getAttribute('class') ?? el.tagName,
        dot: el.closest('[data-testid="amap-dot"]'),
        paints,
      };
    });

    const ground =
      [svg.parentElement, document.body, document.documentElement]
        .flatMap((start) => {
          const out: string[] = [];
          for (let e: Element | null = start; e; e = e.parentElement) {
            out.push(getComputedStyle(e).backgroundColor);
          }
          return out;
        })
        .find((c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') ?? 'rgb(255, 255, 255)';

    const kindOf = (el: Element): MapTextRead['kind'] =>
      el.closest('.as-t')
        ? 'town name'
        : el.closest('.amap-dn')
          ? el.closest('.amap-blk')
            ? 'pale dot number'
            : 'dot number'
          : el.closest('.amap-num')
            ? 'area number'
            : 'other';

    return [...svg.querySelectorAll<SVGTextElement>('text')].map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const mid = [r.left + r.width / 2, r.top + r.height / 2] as const;
      const group = groupOpacity(el);
      const before = (s: Shape) =>
        Boolean(s.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      const own = el.closest('[data-testid="amap-dot"]');

      // What is drawn before the text, by layer, in paint order. A dot belongs
      // to its own number only: dots are kept apart, so none lies under another.
      const under: PaintRead[][] = [];
      const layers = new Map<string, PaintRead[]>();
      for (const s of shapes) {
        if (!before(s) || s.dot) continue;
        for (const p of s.paints) {
          const key = `${s.layer}/${p.part}`;
          let layer = layers.get(key);
          if (!layer) {
            layer = [];
            layers.set(key, layer);
            under.push(layer);
          }
          if (!layer.some((q) => q.color === p.color && q.alpha === p.alpha)) {
            layer.push({ what: p.what, color: p.color, alpha: p.alpha, whole: p.whole });
          }
        }
      }

      // Its own dot, under its number.
      const plateShape = own
        ? shapes
            .filter((s) => s.dot === own && before(s) && s.paints.some((p) => p.part === 'fill'))
            .pop()
        : undefined;
      const plateFill = plateShape?.paints.find((p) => p.part === 'fill');
      const plate = plateFill
        ? { what: plateFill.what, color: plateFill.color, alpha: plateFill.alpha }
        : null;

      // Translucent fills drawn after the text and lying over it: nine points
      // of the text's box are asked of each shape's own outline.
      const points = [0.1, 0.5, 0.9].flatMap((fx) =>
        [0.1, 0.5, 0.9].map((fy) => [r.left + r.width * fx, r.top + r.height * fy] as const)
      );
      const covers = (s: Shape): boolean => {
        const m = s.el.getScreenCTM()?.inverse();
        if (!m) return false;
        return points.some(([x, y]) => s.el.isPointInFill(new DOMPoint(x, y).matrixTransform(m)));
      };
      const over: PaintRead[] = [];
      for (const s of shapes) {
        if (before(s) || s.dot) continue;
        const f = s.paints.find((p) => p.part === 'fill');
        if (!f || f.alpha >= 0.999 || !covers(s)) continue;
        if (!over.some((q) => q.color === f.color && q.alpha === f.alpha)) {
          over.push({ what: f.what, color: f.color, alpha: f.alpha });
        }
      }

      const strokeFirst = cs.paintOrder.trim().startsWith('stroke');
      const strokeWidth = parseFloat(cs.strokeWidth);
      const halo =
        strokeFirst && cs.stroke !== 'none' && strokeWidth > 0
          ? {
              color: cs.stroke,
              alpha: parseFloat(cs.strokeOpacity) * group,
              // Half the stroke lies outside the letter's edge.
              px: (strokeWidth / 2) * scale,
            }
          : null;

      return {
        kind: kindOf(el),
        text: (el.textContent ?? '').trim(),
        px: parseFloat(cs.fontSize) * scale,
        weight: Number(cs.fontWeight),
        shown: mid[0] > box.left && mid[0] < box.right && mid[1] > box.top && mid[1] < box.bottom,
        fill: { color: cs.fill, alpha: parseFloat(cs.fillOpacity) * group },
        halo,
        plate,
        ground,
        under,
        over,
      };
    });
  });
}

export interface MapTextJudged {
  /** Every text that is on screen, as read. */
  texts: MapTextRead[];
  /** One line a text: the ratio, what it was taken against, what it needs. */
  lines: string[];
  /** The lines of the texts under their ratio. */
  failures: string[];
  /** The kinds of text with a failure, sorted. */
  failedKinds: string[];
  /** One line a kind: its worst text. */
  summary: string[];
}

/** Read the map's text from the page and judge it. */
export async function judgeMapTextOn(page: Page): Promise<MapTextJudged> {
  const texts = (await readMapText(page)).filter((t) => t.shown);
  const judged = judgeMapText(texts) as {
    verdicts: { pass: boolean }[];
    failures: string[];
    failedKinds: string[];
    kinds: { kind: string; count: number; worst: Record<string, unknown> }[];
  };
  return {
    texts,
    lines: judged.verdicts.map((v) => verdictLine(v)),
    failures: judged.failures,
    failedKinds: judged.failedKinds,
    summary: judged.kinds.map((k) => `${k.count} x ${verdictLine(k.worst)}`),
  };
}
