/**
 * Text drawn on the map, judged by arithmetic (base-map worksheet 2026-11-15,
 * slice B7, gap G17; street-map CCR 2026-11-15, R24).
 *
 * The map draws three kinds of text: the number in a hexagon (`.amap-num`), a
 * town name in the street layer (`.as-t`) and the number in a dot (`.amap-dn`).
 * Each sits on something a browser check cannot name: a hexagon at some
 * opacity over land, water, a river or a road. axe reports that as "cannot
 * decide", so nothing that can fail has judged it. This file does, with no
 * browser:
 *
 *   - which token each text and each thing under it is painted in is read from
 *     the style blocks that ship (MAP_STYLE, ZOOM_STYLE, STREET_STYLE);
 *   - how strong a hexagon's colour is drawn is read from the real map, drawn
 *     with and without a street layer;
 *   - each token's value in both themes comes from @ocr/ui, pinned in
 *     `.ocr-hub-ref`;
 *   - layers are mixed the way a browser mixes them (plain alpha, in sRGB) and
 *     the two colours are compared by the WCAG 2 contrast formula.
 *
 * The bar is 4.5:1, WCAG AA for text that is not large. Map text is sized in
 * map units and scales with the screen (13 px on a phone), so none of it is
 * held to the 3:1 of large text.
 *
 * A text with a halo (`paint-order:stroke`) is judged twice: against its halo,
 * and against each thing it can sit on as if it had none. The second is the
 * strict reading. The halo is 2 map units a side, about one screen pixel on a
 * phone, and nobody has ruled that it is enough.
 *
 * WHAT IT FOUND is in two lists below: every pair under the bar on the day
 * this was written, with its ratio. UNDER_EITHER_WAY holds the pairs that are
 * under however a halo is read; UNDER_WITHOUT_HALO holds haloed text read as
 * if it had no halo. The lists are a ratchet, not a pass. A pair on one keeps
 * its number, a pair on neither may not go under the bar, and a pair that now
 * passes must be taken off. What to change so the lists empty is a design
 * decision, and the tokens are locked: the owner's question 9 (worksheet
 * section 8), slice O6. This file changes no colour.
 *
 * The same text is measured in a browser by the staging checks' contrast spec
 * (the street-map review's R27), which takes a halo of a pixel or more for the
 * background. This file is the layer under it: it needs no page and no
 * archive, and it fails on the commit that changes a style or a token.
 *
 * How the model errs. A road or a river is a line a few units wide, and a
 * letter that crosses one is judged as if it sat on it whole: strict again.
 * The hexagon range is read from a map of two areas, one at the readiness
 * minimum beside one forty times as busy (0.16 to 0.5 over streets); the
 * formula's own floor is 0.15, and a fainter hexagon is kinder to its number.
 *
 * Not judged here: text outside the drawing (the caption, the legend, the
 * credit), which axe can decide; an area's name line where it hangs past its
 * hexagon's edge; the look on a real screen; forced colours and print.
 *
 * Node project: pure arithmetic and pure rendering. Registered in
 * vitest.node-specs.mjs.
 */
// @born-red text drawn on the map (base-map slice B7) | method: 19 faults put into the real source one at a time, the spec run, the file restored; every one turned this file red. In the styles: a block's pale dot paler (.45 to .3) and stronger (.9); a dot's number in the dot's colour; a town name in the border colour, and in a raw hex (the file stops with ".as-t sets no token for fill"); a town name's halo in the text colour; water stronger (.3 to .6); a main road in the muted text colour; the area number muted; the hexagon in the info colour; a fourth rule that sets a font; the narrow-screen block setting a colour. In attendee-map.ts: hexagons drawn stronger over streets (0.35 to 0.6) and with no streets (0.6 to 0.8). In this file: a pair taken off the list, a listed number raised, a pair on the list that nobody draws, a pair moved to the other list, and the bar lowered to 3. A token given a pale value cannot be done in the source (colours live in the spine and are locked), so it is done on a copy of the tables in "the gate can fail" | date: 2026-11-16
import { describe, expect, test } from 'vitest';
import { gridDisk, latLngToCell } from 'h3-js';
import { contrastRatio, primitives, semanticDark, semanticLight } from '@ocr/ui';
import { MAP_STYLE, ZOOM_STYLE, renderAttendeeMap } from '../src/lib/attendee-map';
import { NARROW_MAP_STYLE } from '../src/lib/map-narrow-style';
import { LINK_STYLE } from '../src/lib/map-link-style';
import { CORRIDOR_READY_MIN_EVENTS } from '../src/lib/corridor-readiness';
import { STREET_STYLE, cellsKey } from '../src/lib/street-map';
import { LABEL_STYLE } from '../src/lib/map-label-style';

/** WCAG 2.2, 1.4.3 (AA), text that is not large. */
const AA_TEXT = 4.5;

// ── colour arithmetic ────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `top` drawn at `alpha` over `under`: what a browser shows (source-over, sRGB). */
function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  return [0, 1, 2].map((i) => alpha * top[i]! + (1 - alpha) * under[i]!) as unknown as Rgb;
}

function luminance(c: Rgb): number {
  const lin = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ── the tokens, in both themes ───────────────────────────────────────────────

type Theme = 'light' | 'dark';
const THEMES: readonly Theme[] = ['light', 'dark'];
const SEMANTIC: Record<Theme, Record<string, string>> = {
  light: semanticLight,
  dark: semanticDark,
};

/** A token's hex in a theme, through @ocr/ui's own tables. Throws by name. */
function tokenHex(
  theme: Theme,
  token: string,
  tables: Record<Theme, Record<string, string>> = SEMANTIC
): string {
  const ref = tables[theme][token];
  if (!ref) throw new Error(`@ocr/ui has no token ${token} in the ${theme} theme`);
  const prim = /^var\((--[a-z0-9-]+)\)$/.exec(ref)?.[1];
  const hex = prim ? (primitives as Record<string, string>)[prim] : ref;
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`${token} in the ${theme} theme is ${ref}, which names no hex colour`);
  }
  return hex;
}

// ── what the style blocks say ────────────────────────────────────────────────

/** Every `selector{declarations}` of the blocks, a selector list split, later rules winning. */
function styleRules(...blocks: string[]): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const block of blocks) {
    for (const m of block.matchAll(/([^{}<>]+)\{([^{}]*)\}/g)) {
      const decls: Record<string, string> = {};
      for (const d of m[2]!.split(';')) {
        const at = d.indexOf(':');
        if (at > 0) decls[d.slice(0, at).trim()] = d.slice(at + 1).trim();
      }
      for (const sel of m[1]!.split(',')) {
        out.set(sel.trim(), { ...out.get(sel.trim()), ...decls });
      }
    }
  }
  return out;
}

/** The token a rule paints a property in. A raw colour, or no colour, throws by name. */
function tokenOf(rules: Map<string, Record<string, string>>, sel: string, prop: string): string {
  const value = rules.get(sel)?.[prop];
  const token = value ? /^var\((--[a-z-]+)\)$/.exec(value)?.[1] : undefined;
  if (!token) throw new Error(`${sel} sets no token for ${prop} (found: ${value ?? 'nothing'})`);
  return token;
}

/** A rule's opacity for a property; 1 when it sets none. */
function alphaOf(rules: Map<string, Record<string, string>>, sel: string, prop: string): number {
  const value = rules.get(sel)?.[prop];
  if (value === undefined) return 1;
  const n = Number(value);
  if (!(n > 0 && n <= 1)) throw new Error(`${sel} sets ${prop} to ${value}`);
  return n;
}

// ── how strong a hexagon is drawn, read from the real map ────────────────────

const NOW = Date.parse('2026-11-16T12:00:00Z');
const A7 = latLngToCell(41.6565, -87.681, 7);
const B7 = gridDisk(A7, 1).find((c) => c !== A7)!;

/** One busy area and one at the readiness minimum: the two ends of the range. */
function hexagonAlphas(withStreets: boolean): { low: number; high: number } {
  const ev = (i: number, cell: string) => ({
    id: `e${i}`,
    name: `Event ${i}`,
    startDateISO: new Date(NOW + (1 + (i % 20)) * 86_400_000).toISOString(),
    phase: 'pre_event',
    h3_res7: cell,
  });
  const busy = 40 * CORRIDOR_READY_MIN_EVENTS;
  const items = [
    ...Array.from({ length: busy }, (_, i) => ev(i, A7)),
    ...Array.from({ length: CORRIDOR_READY_MIN_EVENTS }, (_, i) => ev(busy + i, B7)),
  ];
  const streets = withStreets
    ? { cellsKey: cellsKey([A7, B7]), svg: '<g data-testid="amap-streets"></g>', drawn: {} }
    : null;
  const html = renderAttendeeMap(items, { now: NOW, streets: streets as never }).html;
  if (withStreets !== html.includes('amap-streets')) {
    throw new Error('the fixture map did not draw the way it was asked to');
  }
  const alphas = [...html.matchAll(/class="amap-cell"[^>]*fill-opacity="([0-9.]+)"/g)].map((m) =>
    Number(m[1])
  );
  if (alphas.length !== 2) throw new Error(`expected two hexagons, found ${alphas.length}`);
  return { low: Math.min(...alphas), high: Math.max(...alphas) };
}

/** From low to high in steps of 0.01, both ends in. */
function sweep(low: number, high: number): number[] {
  const out: number[] = [];
  for (let a = low; a < high - 1e-9; a += 0.01) out.push(Number(a.toFixed(2)));
  out.push(high);
  return out;
}

// ── the model: every text, on everything it can sit on ───────────────────────

interface Pair {
  /** The name a failure is reported under. */
  name: string;
  /** The lowest ratio over everything the pair covers. */
  ratio: number;
  /** Haloed text against what is under it, read as if it had no halo. */
  withoutHalo: boolean;
}

interface Styles {
  map: string;
  zoom: string;
  street: string;
  labels: string;
}
const SHIPPED: Styles = {
  map: MAP_STYLE,
  zoom: ZOOM_STYLE,
  street: STREET_STYLE,
  labels: LABEL_STYLE,
};

/** The names the street layer draws, and the rule each is painted by. */
const NAME_KINDS: readonly (readonly [string, string])[] = [
  ['town name', '.as-t'],
  ['street name', '.as-n'],
  ['landmark name', '.as-p'],
];

function mapTextPairs(
  styles: Styles = SHIPPED,
  tables: Record<Theme, Record<string, string>> = SEMANTIC
): Pair[] {
  const rules = styleRules(styles.map, styles.zoom, styles.street, styles.labels);
  const withStreets = hexagonAlphas(true);
  const plain = hexagonAlphas(false);
  const pairs: Pair[] = [];

  for (const theme of THEMES) {
    const rgb = (sel: string, prop: string) =>
      hexToRgb(tokenHex(theme, tokenOf(rules, sel, prop), tables));
    const lowest = (name: string, ratios: number[], withoutHalo = false) =>
      pairs.push({ name: `${theme}: ${name}`, ratio: Math.min(...ratios), withoutHalo });

    // What the street layer paints, bottom up (lib/street-map.ts, the layer's markup).
    const land = rgb('.as-l', 'fill');
    const water = over(rgb('.as-w', 'fill'), alphaOf(rules, '.as-w', 'opacity'), land);
    const river = rgb('.as-v', 'stroke');
    const riverAlpha = alphaOf(rules, '.as-v', 'opacity');
    const grounds: [string, Rgb][] = [
      ['land', land],
      ['water', water],
      ['a river', over(river, riverAlpha, land)],
      ['a river in water', over(river, riverAlpha, water)],
      ['a main road', rgb('.as-r', 'stroke')],
      ['a small road', rgb('.as-1', 'stroke')],
    ];
    const page = hexToRgb(tokenHex(theme, '--bg', tables));

    const cell = rgb('.amap-cell', 'fill');
    const num = rgb('.amap-num', 'fill');
    const numHalo = rgb('.amap-num', 'stroke');
    const zone = rgb('.amap-zone', 'fill');
    const zoneAlpha = alphaOf(rules, '.amap-zone', 'fill-opacity');
    const dot = rgb('.amap-dot', 'fill');
    const paleAlpha = alphaOf(rules, '.amap-blk .amap-dot', 'fill-opacity');
    const dotNum = rgb('.amap-dn', 'fill');

    // 1. The number in a hexagon. It is drawn over its hexagon, never under one.
    lowest('area number against its halo', [ratio(num, numHalo)]);
    lowest(
      'area number on a hexagon, no street map',
      sweep(plain.low, plain.high).map((a) => ratio(num, over(cell, a, page))),
      true
    );
    for (const [what, ground] of grounds) {
      lowest(
        `area number on a hexagon over ${what}`,
        sweep(withStreets.low, withStreets.high).map((a) => ratio(num, over(cell, a, ground))),
        true
      );
    }

    // 2. The names in the street layer: a town, a major street, a landmark
    //    (lib/street-labels.ts). Since 2026-11-18 they are drawn over the
    //    hexagons and the zoomed area's outline, not under them, so nothing
    //    tints a name and its halo: it sits on a ground, a hexagon over a
    //    ground, or the outline's fill over a ground.
    for (const [kind, sel] of NAME_KINDS) {
      const text = rgb(sel, 'fill');
      lowest(`${kind} against its halo`, [ratio(text, rgb(sel, 'stroke'))]);
      for (const [what, ground] of grounds) {
        lowest(`${kind} on ${what}`, [ratio(text, ground)], true);
        lowest(
          `${kind} over a hexagon, on ${what}`,
          sweep(withStreets.low, withStreets.high).map((a) => ratio(text, over(cell, a, ground))),
          true
        );
        lowest(
          `${kind} over the zoomed area, on ${what}`,
          [ratio(text, over(zone, zoneAlpha, ground))],
          true
        );
      }
    }

    // 3. The number in a dot. A dot is drawn over the zoomed area's fill.
    lowest('dot number on a marked place', [ratio(dotNum, dot)]);
    for (const [what, ground] of grounds) {
      lowest(`dot number on a block's pale dot over ${what}`, [
        ratio(dotNum, over(dot, paleAlpha, over(zone, zoneAlpha, ground))),
      ]);
    }
  }
  return pairs;
}

// ── the ratchet ──────────────────────────────────────────────────────────────

/**
 * Pairs under 4.5:1 on 2026-11-16, at @ocr/ui `4a82902e`, each with its ratio
 * cut to two places, in two lists. The owner's question 9 (worksheet section 8)
 * decides what changes. Until then a pair keeps its number and no pair joins.
 *
 * UNDER_EITHER_WAY: under the bar however a halo is read. The text has no
 * halo, or the text and its halo are under the same tint.
 */
const UNDER_EITHER_WAY: Readonly<Record<string, number>> = {
  // The number in a block's pale dot. It has no halo, so this is how it reads.
  "light: dot number on a block's pale dot over land": 2.2,
  "light: dot number on a block's pale dot over water": 2.94,
  "light: dot number on a block's pale dot over a river": 3.6,
  "light: dot number on a block's pale dot over a river in water": 4.18,
  "light: dot number on a block's pale dot over a small road": 2.8,
  "dark: dot number on a block's pale dot over land": 2.48,
  "dark: dot number on a block's pale dot over water": 3.58,
  "dark: dot number on a block's pale dot over a small road": 3.07,
};

/**
 * UNDER_WITHOUT_HALO: haloed text against what is under it, read as if it had
 * no halo. Each of these texts passes against its own halo, except a town name
 * under a hexagon (above). If a halo is ruled to be the background (WCAG
 * technique G18 reads a wide enough outline that way), these are not failures
 * and the list goes; the halo is 2 map units a side, under one screen pixel on
 * a 320 px phone. Until someone rules, the numbers are kept from getting worse.
 */
const UNDER_WITHOUT_HALO: Readonly<Record<string, number>> = {
  // 2026-11-18: the names moved over the hexagons (lib/street-labels.ts). The
  // town-name pairs "under a hexagon" are gone, with the two that failed
  // against their own halo; every name now passes against its halo. Street and
  // landmark names joined, in the text colour. Each line below is a name read
  // as if it had no halo, on a road, river or water it may cross. Listed with
  // the owner's review of that change (PR "Make the event map easier to read").
  'light: area number on a hexagon, no street map': 3.91,
  'light: area number on a hexagon over a river': 4.4,
  'light: area number on a hexagon over a river in water': 3.81,
  'light: area number on a hexagon over a main road': 3.17,
  'light: town name over a hexagon, on land': 2.83,
  'light: town name on water': 4.04,
  'light: town name over a hexagon, on water': 2.13,
  'light: town name over the zoomed area, on water': 3.86,
  'light: town name on a river': 2.83,
  'light: town name over a hexagon, on a river': 1.76,
  'light: town name over the zoomed area, on a river': 2.75,
  'light: town name on a river in water': 2.13,
  'light: town name over a hexagon, on a river in water': 1.52,
  'light: town name over the zoomed area, on a river in water': 2.09,
  'light: town name on a main road': 1.71,
  'light: town name over a hexagon, on a main road': 1.27,
  'light: town name over the zoomed area, on a main road': 1.71,
  'light: town name over a hexagon, on a small road': 2.23,
  'light: town name over the zoomed area, on a small road': 4.33,
  'light: street name over a hexagon, on a river': 4.4,
  'light: street name over a hexagon, on a river in water': 3.81,
  'light: street name on a main road': 4.27,
  'light: street name over a hexagon, on a main road': 3.17,
  'light: street name over the zoomed area, on a main road': 4.27,
  'light: landmark name over a hexagon, on a river': 4.4,
  'light: landmark name over a hexagon, on a river in water': 3.81,
  'light: landmark name on a main road': 4.27,
  'light: landmark name over a hexagon, on a main road': 3.17,
  'light: landmark name over the zoomed area, on a main road': 4.27,
  'dark: area number on a hexagon, no street map': 3.48,
  'dark: area number on a hexagon over water': 4.08,
  'dark: area number on a hexagon over a river': 3.28,
  'dark: area number on a hexagon over a river in water': 2.8,
  'dark: area number on a hexagon over a main road': 3.15,
  'dark: town name over a hexagon, on land': 2.49,
  'dark: town name on water': 3,
  'dark: town name over a hexagon, on water': 1.75,
  'dark: town name over the zoomed area, on water': 2.89,
  'dark: town name on a river': 1.86,
  'dark: town name over a hexagon, on a river': 1.4,
  'dark: town name over the zoomed area, on a river': 1.85,
  'dark: town name on a river in water': 1.34,
  'dark: town name over a hexagon, on a river in water': 1.2,
  'dark: town name over the zoomed area, on a river in water': 1.36,
  'dark: town name on a main road': 1.62,
  'dark: town name over a hexagon, on a main road': 1.35,
  'dark: town name over the zoomed area, on a main road': 1.62,
  'dark: town name on a small road': 4.01,
  'dark: town name over a hexagon, on a small road': 2.03,
  'dark: town name over the zoomed area, on a small road': 3.79,
  'dark: street name over a hexagon, on water': 4.08,
  'dark: street name on a river': 4.34,
  'dark: street name over a hexagon, on a river': 3.28,
  'dark: street name over the zoomed area, on a river': 4.31,
  'dark: street name on a river in water': 3.12,
  'dark: street name over a hexagon, on a river in water': 2.8,
  'dark: street name over the zoomed area, on a river in water': 3.16,
  'dark: street name on a main road': 3.77,
  'dark: street name over a hexagon, on a main road': 3.15,
  'dark: street name over the zoomed area, on a main road': 3.77,
  'dark: landmark name over a hexagon, on water': 4.08,
  'dark: landmark name on a river': 4.34,
  'dark: landmark name over a hexagon, on a river': 3.28,
  'dark: landmark name over the zoomed area, on a river': 4.31,
  'dark: landmark name on a river in water': 3.12,
  'dark: landmark name over a hexagon, on a river in water': 2.8,
  'dark: landmark name over the zoomed area, on a river in water': 3.16,
  'dark: landmark name on a main road': 3.77,
  'dark: landmark name over a hexagon, on a main road': 3.15,
  'dark: landmark name over the zoomed area, on a main road': 3.77,
};

const KNOWN_UNDER: Readonly<Record<string, number>> = {
  ...UNDER_EITHER_WAY,
  ...UNDER_WITHOUT_HALO,
};

const cut = (r: number) => Math.floor(r * 100) / 100;

interface Verdict {
  /** Under the bar and not on the list. */
  under: string[];
  /** On the list, and its ratio is no longer the one written there. */
  moved: string[];
  /** On the list, and now at or over the bar: take it off. */
  passing: string[];
  /** On the list, and no longer a pair the model makes. */
  gone: string[];
}

function judge(pairs: readonly Pair[], known: Readonly<Record<string, number>>): Verdict {
  const v: Verdict = { under: [], moved: [], passing: [], gone: [] };
  const names = new Set(pairs.map((p) => p.name));
  for (const p of pairs) {
    const was = known[p.name];
    const now = cut(p.ratio);
    if (p.ratio >= AA_TEXT) {
      if (was !== undefined) v.passing.push(`${p.name}: ${now}`);
    } else if (was === undefined) {
      v.under.push(`${p.name}: ${now}`);
    } else if (now !== was) {
      v.moved.push(`${p.name}: ${now}, ${now < was ? 'worse' : 'better'} than the ${was} recorded`);
    }
  }
  for (const name of Object.keys(known)) if (!names.has(name)) v.gone.push(name);
  return v;
}

const CLEAN: Verdict = { under: [], moved: [], passing: [], gone: [] };

// ── tests ────────────────────────────────────────────────────────────────────

describe('text drawn on the map | the arithmetic', () => {
  test('agrees with @ocr/ui on whole colours', () => {
    for (const [a, b] of [
      ['#000000', '#FFFFFF'],
      ['#1785FB', '#FAF6EE'],
      ['#A39D94', '#1A1918'],
    ] as const) {
      expect(ratio(hexToRgb(a), hexToRgb(b))).toBeCloseTo(contrastRatio(a, b), 10);
    }
    expect(ratio(hexToRgb('#000000'), hexToRgb('#FFFFFF'))).toBeCloseTo(21, 10);
    expect(ratio(hexToRgb('#777777'), hexToRgb('#777777'))).toBe(1);
  });

  test('a layer at an opacity is mixed the way a browser mixes it', () => {
    expect(over([255, 255, 255], 0.5, [0, 0, 0])).toEqual([127.5, 127.5, 127.5]);
    expect(over([10, 20, 30], 1, [200, 200, 200])).toEqual([10, 20, 30]);
    expect(over([10, 20, 30], 0, [200, 100, 50])).toEqual([200, 100, 50]);
  });

  test('a ratio is cut, never rounded up to the bar', () => {
    expect(cut(4.499)).toBe(4.49);
    expect(cut(2.2)).toBe(2.2);
  });
});

describe('text drawn on the map | what is read from the source', () => {
  const rules = styleRules(MAP_STYLE, ZOOM_STYLE, STREET_STYLE, LABEL_STYLE);

  test('the three kinds of text are the only text the style blocks set', () => {
    // A fourth kind of map text has to be added to the model before it ships.
    const withFont = [...rules].filter(([, d]) => 'font' in d || 'font-size' in d).map(([s]) => s);
    expect(withFont.sort()).toEqual(['.amap-dn', '.amap-num', '.as-n', '.as-p', '.as-t']);
  });

  test('the narrow-screen block and the link block set no colour', () => {
    // They are not in the model. The day one of them paints, it has to be.
    for (const block of [NARROW_MAP_STYLE, LINK_STYLE]) {
      expect(block).not.toMatch(/var\(--|#[0-9a-f]{3}|fill|stroke|color|opacity/i);
    }
  });

  test('a hexagon is drawn lighter over a street map, and the range is the one read', () => {
    const streets = hexagonAlphas(true);
    const plain = hexagonAlphas(false);
    expect(streets).toEqual({ low: 0.16, high: 0.5 });
    expect(plain).toEqual({ low: 0.22, high: 0.8 });
    expect(sweep(0.16, 0.5)).toHaveLength(35);
    expect(sweep(0.16, 0.5)[0]).toBe(0.16);
    expect(sweep(0.16, 0.5).at(-1)).toBe(0.5);
  });

  test('every token the map paints in has a hex value in both themes', () => {
    const tokens = new Set(
      [...rules.values()].flatMap((d) =>
        Object.values(d).flatMap((v) => [...v.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]!))
      )
    );
    expect([...tokens].sort()).toEqual([
      '--accent',
      '--bg',
      '--border',
      '--border-strong',
      '--info',
      '--on-accent',
      '--surface',
      '--text',
      '--text-muted',
    ]);
    for (const theme of THEMES) {
      for (const token of tokens) expect(tokenHex(theme, token)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('text drawn on the map | contrast in both themes', () => {
  // The map is drawn inside each test, never as the file loads: source run under
  // no test makes its mutants "static", and the mutation pass then reruns every
  // spec for each of them (attendee-map.ts and street-map.ts are mutated whole).

  test('the model judges every pair in both themes', () => {
    const pairs = mapTextPairs();
    expect(pairs).toHaveLength(144);
    expect(pairs.filter((p) => p.name.startsWith('light: '))).toHaveLength(72);
    expect(new Set(pairs.map((p) => p.name)).size).toBe(144);
    for (const p of pairs) expect(p.ratio).toBeGreaterThanOrEqual(1);
  });

  test('no pair is under 4.5:1 unless it is on the list, and the list is exact', () => {
    const pairs = mapTextPairs();
    // Each line of a failure is one pair by name with its ratio. `under` is a
    // new failure: fix it, never add it to the list without the owner.
    expect(judge(pairs, KNOWN_UNDER)).toEqual(CLEAN);
  });

  test('each listed pair is on the list that says how it was read', () => {
    const pairs = mapTextPairs();
    const read = new Map(pairs.map((p) => [p.name, p.withoutHalo]));
    for (const name of Object.keys(UNDER_EITHER_WAY)) expect(read.get(name), name).toBe(false);
    for (const name of Object.keys(UNDER_WITHOUT_HALO)) expect(read.get(name), name).toBe(true);
    expect(Object.keys(UNDER_EITHER_WAY)).toHaveLength(8);
    expect(Object.keys(UNDER_WITHOUT_HALO)).toHaveLength(70);
    expect(Object.keys(KNOWN_UNDER)).toHaveLength(78);
    expect(pairs.filter((p) => p.withoutHalo)).toHaveLength(122);
  });

  test('text with no halo passes on a marked place, and every halo passes on its own text', () => {
    const pairs = mapTextPairs();
    // The pairs nothing is drawn between. These have never been on the list.
    for (const theme of THEMES) {
      for (const name of [
        'area number against its halo',
        'town name against its halo',
        'street name against its halo',
        'landmark name against its halo',
        'street name on land',
        'landmark name on land',
        'dot number on a marked place',
        'town name on land',
        'area number on a hexagon over land',
      ]) {
        const pair = pairs.find((p) => p.name === `${theme}: ${name}`)!;
        expect(pair.ratio, pair.name).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

describe('text drawn on the map | the gate can fail', () => {
  const pale = (theme: Theme, token: string, hex: string) => ({
    ...SEMANTIC,
    [theme]: { ...SEMANTIC[theme], [token]: hex },
  });
  const names = (lines: string[]) => lines.map((l) => l.replace(/: [0-9.]+.*$/, ''));

  test('a token changed to a pale value fails by name, in that theme only', () => {
    // The light theme's text colour set to the light theme's page colour.
    const v = judge(mapTextPairs(SHIPPED, pale('light', '--text', '#FAF6EE')), KNOWN_UNDER);
    expect(names(v.under)).toContain('light: area number against its halo');
    expect(names(v.under)).toContain('light: area number on a hexagon over land');
    expect(names([...v.under, ...v.moved]).filter((n) => n.startsWith('dark: '))).toEqual([]);
  });

  test('a paler number in a dot fails by name in both themes', () => {
    const zoom = ZOOM_STYLE.replace(
      '.amap-dn{fill:var(--on-accent)',
      '.amap-dn{fill:var(--accent)'
    );
    expect(zoom).not.toBe(ZOOM_STYLE);
    const v = judge(mapTextPairs({ ...SHIPPED, zoom }), KNOWN_UNDER);
    expect(names(v.under)).toContain('light: dot number on a marked place');
    expect(names(v.under)).toContain('dark: dot number on a marked place');
  });

  test('a listed pair that gets worse is reported as moved, with both numbers', () => {
    const zoom = ZOOM_STYLE.replace('fill-opacity:.45', 'fill-opacity:.3');
    expect(zoom).not.toBe(ZOOM_STYLE);
    const v = judge(mapTextPairs({ ...SHIPPED, zoom }), KNOWN_UNDER);
    const line = v.moved.find((l) =>
      l.startsWith("light: dot number on a block's pale dot over land")
    );
    expect(line).toMatch(/worse than the 2\.2 recorded$/);
  });

  test('a listed pair that now passes, or no longer exists, has to come off the list', () => {
    const land = mapTextPairs().find((p) => p.name === 'light: town name on land')!;
    expect(judge([land], { [land.name]: 4.1 }).passing).toEqual([
      `${land.name}: ${cut(land.ratio)}`,
    ]);
    expect(judge([land], { 'light: a pair nobody draws': 2 }).gone).toEqual([
      'light: a pair nobody draws',
    ]);
    expect(judge([{ name: 'x', ratio: 3 }], { x: 2.5 }).moved).toEqual([
      'x: 3, better than the 2.5 recorded',
    ]);
    expect(judge([{ name: 'x', ratio: 4.499 }], {}).under).toEqual(['x: 4.49']);
    expect(judge([{ name: 'x', ratio: 4.5 }], {})).toEqual(CLEAN);
  });

  test('a raw colour, a missing token and a broken opacity are refused by name', () => {
    const hex = STREET_STYLE.replace('.as-t{fill:var(--text-muted)', '.as-t{fill:#777777');
    expect(hex).not.toBe(STREET_STYLE);
    expect(() => mapTextPairs({ ...SHIPPED, street: hex })).toThrow(
      '.as-t sets no token for fill (found: #777777)'
    );
    const gone = MAP_STYLE.replace('.amap-num{fill:var(--text)', '.amap-num{fill:var(--no-such)');
    expect(gone).not.toBe(MAP_STYLE);
    expect(() => mapTextPairs({ ...SHIPPED, map: gone })).toThrow(
      '@ocr/ui has no token --no-such in the light theme'
    );
    const alpha = STREET_STYLE.replace('opacity:.3}', 'opacity:3}');
    expect(alpha).not.toBe(STREET_STYLE);
    expect(() => mapTextPairs({ ...SHIPPED, street: alpha })).toThrow('.as-w sets opacity to 3');
    expect(() => tokenHex('dark', '--text', pale('dark', '--text', 'var(--ocr-nothing)'))).toThrow(
      '--text in the dark theme is var(--ocr-nothing), which names no hex colour'
    );
    expect(() => hexToRgb('#fff')).toThrow('not a six-digit hex colour: #fff');
  });
});
