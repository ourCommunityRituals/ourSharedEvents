/**
 * The arithmetic of the map-text contrast judge (scripts/ci/map-text-contrast.mjs),
 * held to WCAG's own figures and to the colours the tokens resolve to.
 *
 * The judge has two halves. A page is read in a browser by
 * tests/e2e/helpers/map-text-contrast.ts; what it read is judged here, with no
 * browser. tests/e2e/2-pages/street-map-contrast.component.spec.ts runs the two
 * together on the real page in both themes. This file is the half that can be
 * checked against published numbers.
 *
 * The colours below are what `getComputedStyle` gave on the component page on
 * 2026-11-15 (hub pin in .ocr-hub-ref), copied here as plain values: this file
 * proves the arithmetic, and the component spec proves what the tokens are.
 *
 * WHAT THE ARITHMETIC FINDS THAT NO PAGE HERE DRAWS. A town name under a
 * hexagon of the landing map: the hexagon is painted over the street layer, so
 * it tints the name and its halo alike. The component fixture happens to put no
 * name under a hexagon, so this is computed, not rendered ("a town name under a
 * hexagon" below): 2.76:1 light and 2.48:1 dark under the busiest area (50%),
 * and under 4.5:1 from a strength of about 22%.
 *
 * BORN RED (2026-11-15). The module was faulted, one fault at a time, this file
 * run, and the fault taken out. What is written is what was seen:
 *   __BORN_RED__
 */
const LIGHT = {
  bg: 'rgb(244, 238, 226)',
  surface: 'rgb(250, 246, 238)',
  border: 'rgb(217, 207, 188)',
  road: 'rgb(133, 124, 111)',
  text: 'rgb(26, 25, 24)',
  muted: 'rgb(94, 88, 79)',
  accent: 'rgb(0, 87, 214)',
  onAccent: 'rgb(250, 246, 238)',
};
const DARK = {
  bg: 'rgb(26, 25, 24)',
  surface: 'rgb(35, 33, 32)',
  border: 'rgb(64, 61, 58)',
  road: 'rgb(126, 120, 113)',
  text: 'rgb(244, 238, 226)',
  muted: 'rgb(163, 157, 148)',
  accent: 'rgb(61, 155, 255)',
  onAccent: 'rgb(26, 25, 24)',
};

let m;
beforeAll(async () => {
  m = await import('../../../scripts/ci/map-text-contrast.mjs');
});

/** The street layer as the page draws it, in this theme. */
const streets = (c) => [
  [{ what: 'land', color: c.surface, alpha: 1, whole: true }],
  [{ what: 'water', color: c.accent, alpha: 0.3 }],
  [{ what: 'the edge of a minor road', color: c.border, alpha: 1 }],
  [{ what: 'the edge of a highway', color: c.road, alpha: 1 }],
];
const townName = (c, over = {}) => ({
  kind: 'town name',
  text: 'Blue Island',
  px: 16,
  weight: 600,
  fill: { color: c.muted, alpha: 1 },
  halo: { color: c.bg, alpha: 1, px: 1.2 },
  plate: null,
  ground: c.bg,
  under: streets(c),
  over: [],
  ...over,
});
const dotNumber = (c, plateAlpha, over = {}) => ({
  kind: plateAlpha < 1 ? 'pale dot number' : 'dot number',
  text: '2',
  px: 16,
  weight: 700,
  fill: { color: c.onAccent, alpha: 1 },
  halo: null,
  plate: { what: 'its dot', color: c.accent, alpha: plateAlpha },
  ground: c.bg,
  under: streets(c),
  over: [],
  ...over,
});

describe('the WCAG arithmetic', () => {
  test('luminance: black is 0, white is 1, and the published mid grey', () => {
    expect(m.luminance([0, 0, 0])).toBe(0);
    expect(m.luminance([255, 255, 255])).toBeCloseTo(1, 10);
    // #808080: 0.2159 (WCAG's worked example for 50% grey).
    expect(m.luminance([128, 128, 128])).toBeCloseTo(0.2159, 4);
    // One channel each, by its weight.
    expect(m.luminance([255, 0, 0])).toBeCloseTo(0.2126, 4);
    expect(m.luminance([0, 255, 0])).toBeCloseTo(0.7152, 4);
    expect(m.luminance([0, 0, 255])).toBeCloseTo(0.0722, 4);
  });

  test('ratio: 21:1 for black on white, 1:1 for a colour on itself, either way round', () => {
    expect(m.contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 10);
    expect(m.contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 10);
    expect(m.contrastRatio([133, 124, 111], [133, 124, 111])).toBe(1);
  });

  test('the two greys every contrast checker is held to: #777 fails AA on white, #767676 passes', () => {
    const white = [255, 255, 255];
    expect(m.contrastRatio([0x77, 0x77, 0x77], white)).toBeCloseTo(4.48, 2);
    expect(m.contrastRatio([0x77, 0x77, 0x77], white)).toBeLessThan(m.AA);
    expect(m.contrastRatio([0x76, 0x76, 0x76], white)).toBeCloseTo(4.54, 2);
    expect(m.contrastRatio([0x76, 0x76, 0x76], white)).toBeGreaterThanOrEqual(m.AA);
  });

  test('large text is 24 px, or 18.67 px bold; anything else needs 4.5', () => {
    expect(m.requiredRatio(24, 400)).toBe(3);
    expect(m.requiredRatio(23.99, 400)).toBe(4.5);
    expect(m.requiredRatio(18.67, 700)).toBe(3);
    expect(m.requiredRatio(18.66, 700)).toBe(4.5);
    expect(m.requiredRatio(18.67, 600)).toBe(4.5);
    expect(m.requiredRatio(13, 700)).toBe(4.5);
  });

  test('a paint over a colour: none of it, all of it, and a share of each channel', () => {
    expect(m.over([0, 87, 214], 0, [250, 246, 238])).toEqual([250, 246, 238]);
    expect(m.over([0, 87, 214], 1, [250, 246, 238])).toEqual([0, 87, 214]);
    const mixed = m.over([0, 87, 214], 0.45, [250, 246, 238]);
    expect(mixed[0]).toBeCloseTo(137.5, 6);
    expect(mixed[1]).toBeCloseTo(174.45, 6);
    expect(mixed[2]).toBeCloseTo(227.2, 6);
  });
});

describe('a colour as the browser reports it', () => {
  test('rgb, rgba, the space form and color(srgb) are read', () => {
    expect(m.parseColor('rgb(94, 88, 79)')).toEqual({ rgb: [94, 88, 79], alpha: 1 });
    expect(m.parseColor('rgba(0, 87, 214, 0.3)')).toEqual({ rgb: [0, 87, 214], alpha: 0.3 });
    expect(m.parseColor('rgb(0 87 214 / 30%)')).toEqual({ rgb: [0, 87, 214], alpha: 0.3 });
    expect(m.parseColor('rgb(0 87 214 / 0.3)')).toEqual({ rgb: [0, 87, 214], alpha: 0.3 });
    const c = m.parseColor('color(srgb 1 0.5 0 / 0.5)');
    expect(c.rgb).toEqual([255, 127.5, 0]);
    expect(c.alpha).toBe(0.5);
  });

  test('anything that is not a plain colour throws by name, and never reads as a colour', () => {
    for (const bad of [
      'none',
      'url("#stripes")',
      'currentcolor',
      'red',
      '#857C6F',
      'rgb(300, 0, 0)',
      'rgba(0, 0, 0, 2)',
      '',
    ]) {
      expect(() => m.parseColor(bad), bad).toThrow(/map text contrast: ".*" is not/);
    }
  });
});

describe('what can lie under a text', () => {
  test('an opaque shape over the whole frame hides the page; later paints add to it', () => {
    const got = m.backdrops(LIGHT.bg, streets(LIGHT)).map((c) => c.what);
    expect(got).toEqual([
      'land',
      'water over land',
      'the edge of a minor road',
      'the edge of a highway',
    ]);
  });

  test('without that shape the page stays one of the colours', () => {
    const got = m.backdrops(LIGHT.bg, streets(LIGHT).slice(1)).map((c) => c.what);
    expect(got[0]).toBe('the page');
    expect(got).toContain('water over the page');
  });

  test('the paints of one layer are alternatives: two hexagons never lie on one point', () => {
    const hexagons = [
      { what: 'a hexagon', color: LIGHT.accent, alpha: 0.2 },
      { what: 'a hexagon', color: LIGHT.accent, alpha: 0.5 },
    ];
    const got = m.backdrops(LIGHT.bg, [[streets(LIGHT)[0][0]], hexagons]);
    // Land, and each hexagon over land. Not one hexagon over the other.
    expect(got).toHaveLength(3);
    expect(got.map((c) => c.what)).toEqual(['land', 'a hexagon over land', 'a hexagon over land']);
  });

  test('a page that is not opaque throws: there is nothing to measure against', () => {
    expect(() => m.backdrops('rgba(0, 0, 0, 0)', [])).toThrow(/not opaque/);
  });
});

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('the map text as shipped, %s theme', (theme, c) => {
  test('a town name is judged against its halo, and passes', () => {
    const v = m.judgeText(townName(c));
    expect(v.basis).toBe('halo');
    expect(v.against).toBe('its halo');
    expect(v.pass).toBe(true);
    expect(v.ratio).toBeCloseTo(theme === 'light' ? 6.08 : 6.52, 1);
    // What the halo is there for: without it the name is lost on a road.
    expect(v.bare.ratio).toBeLessThan(2);
    expect(v.bare.against).toBe('the edge of a highway');
  });

  test('a halo under 1 px is not counted: the name is judged against the map, and fails', () => {
    const v = m.judgeText(townName(c, { halo: { color: c.bg, alpha: 1, px: 0.93 } }));
    expect(v.basis).toBe('map');
    expect(v.haloCounts).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.against).toBe('the edge of a highway');
    expect(m.verdictLine(v)).toContain('under the 1 px floor');
    // Exactly 1 px counts.
    expect(m.judgeText(townName(c, { halo: { color: c.bg, alpha: 1, px: 1 } })).basis).toBe('halo');
  });

  test('a halo that lets the map through is not counted', () => {
    const v = m.judgeText(townName(c, { halo: { color: c.bg, alpha: 0.6, px: 2 } }));
    expect(v.basis).toBe('map');
    expect(v.pass).toBe(false);
  });

  test('no halo and no plate: every colour of the map is under the text, and the worst decides', () => {
    const v = m.judgeText(townName(c, { halo: null }));
    expect(v.basis).toBe('map');
    expect(v.haloPx).toBe(null);
    expect(v.against).toBe('the edge of a highway');
    expect(v.pass).toBe(false);
    // Over land alone the same text would pass: the judge does not stop at the first colour.
    const onLand = m.judgeText(townName(c, { halo: null, under: [streets(c)[0]] }));
    expect(onLand.pass).toBe(true);
  });

  test('the number on a solid dot is judged against the dot, and passes', () => {
    const v = m.judgeText(dotNumber(c, 1));
    expect(v.basis).toBe('plate');
    expect(v.against).toBe('its dot');
    expect(v.pass).toBe(true);
    expect(v.ratio).toBeCloseTo(theme === 'light' ? 5.84 : 6.12, 1);
  });

  test('the number on a pale dot (45%) is under AA, and under the large-text ratio too', () => {
    const v = m.judgeText(dotNumber(c, 0.45));
    expect(v.basis).toBe('plate');
    expect(v.against).toBe('its dot at 45% over land');
    expect(v.ratio).toBeCloseTo(theme === 'light' ? 2.1 : 2.38, 1);
    expect(v.pass).toBe(false);
    expect(v.ratio).toBeLessThan(m.AA_LARGE);
    // At the largest it is drawn (21.5 px bold on a desktop) it needs 3:1, and still fails.
    expect(m.judgeText(dotNumber(c, 0.45, { px: 21.5 })).pass).toBe(false);
  });

  test('a town name under a hexagon: the tint is laid on the name and its halo alike', () => {
    const under = (alpha) =>
      m.judgeText(townName(c, { over: [{ what: 'a hexagon', color: c.accent, alpha }] }));
    // The quietest area drawn over streets (15%): still AA.
    expect(under(0.15).pass).toBe(true);
    // The busiest (50%): under 3:1.
    const busiest = under(0.5);
    expect(busiest.pass).toBe(false);
    expect(busiest.against).toBe('its halo, under a hexagon');
    expect(busiest.ratio).toBeCloseTo(theme === 'light' ? 2.76 : 2.48, 1);
    // The tint never helps: the ratio only falls as the hexagon gets stronger.
    const ratios = [0, 0.15, 0.25, 0.4, 0.5].map((a) => under(a).ratio);
    expect([...ratios].sort((a, b) => b - a)).toEqual(ratios);
    // With no tint at all it is the plain verdict.
    expect(under(0).ratio).toBeCloseTo(m.judgeText(townName(c)).ratio, 10);
  });

  test("the area's own tint (6%) costs a little and does not fail a town name", () => {
    const v = m.judgeText(
      townName(c, { over: [{ what: "the area's outline", color: c.road, alpha: 0.06 }] })
    );
    expect(v.pass).toBe(true);
    expect(v.ratio).toBeLessThan(m.judgeText(townName(c)).ratio);
    expect(v.against).toBe("its halo, under the area's outline");
  });

  test('a text in the colour of what it is judged against is 1:1', () => {
    expect(m.judgeText(townName(c, { fill: { color: c.bg, alpha: 1 } })).ratio).toBe(1);
    expect(m.judgeText(dotNumber(c, 1, { fill: { color: c.accent, alpha: 1 } })).ratio).toBe(1);
    const lost = m.judgeText(townName(c, { halo: null, fill: { color: c.road, alpha: 1 } }));
    expect(lost.ratio).toBe(1);
    expect(lost.against).toBe('the edge of a highway');
  });

  test('a faint text is laid over what is behind it before it is judged', () => {
    const solid = m.judgeText(townName(c));
    const faint = m.judgeText(townName(c, { fill: { color: c.muted, alpha: 0.3 } }));
    expect(faint.ratio).toBeLessThan(solid.ratio);
    expect(faint.pass).toBe(false);
    expect(() => m.judgeText(townName(c, { fill: { color: c.muted, alpha: 0 } }))).toThrow(
      /has no fill/
    );
  });
});

describe('the verdict, as a person reads it', () => {
  test('a ratio is cut, never rounded up: 4.499 is printed 4.49 and fails', () => {
    // #777 on white is 4.478; printed to two places it must not read 4.48 or 4.5.
    const v = m.judgeText({
      kind: 'town name',
      text: 'x',
      px: 16,
      weight: 400,
      fill: { color: 'rgb(119, 119, 119)', alpha: 1 },
      halo: null,
      plate: null,
      ground: 'rgb(255, 255, 255)',
      under: [],
      over: [],
    });
    expect(v.pass).toBe(false);
    expect(m.verdictLine(v)).toMatch(/^FAILS: town name "x" \(16\.0 px, weight 400\) 4\.47:1 /);
    expect(m.verdictLine(v)).toContain('against the page (#777777 on #FFFFFF), needs 4.5:1');
  });

  test('a line says what was judged, against what, and how the text reads with nothing behind it', () => {
    const line = m.verdictLine(m.judgeText(townName(LIGHT)));
    expect(line).toMatch(/^passes: town name "Blue Island" \(16\.0 px, weight 600\) 6\.0\d:1 /);
    expect(line).toContain('against its halo (#5E584F on #F4EEE2), needs 4.5:1; halo 1.2 px');
    expect(line).toMatch(/; with nothing of its own behind it 1\.7\d:1 over the edge of a highway$/);
  });

  test('judgeMapText: the failures by line, the failing kinds sorted, and each kind by its worst text', () => {
    const got = m.judgeMapText([
      townName(LIGHT),
      dotNumber(LIGHT, 0.45),
      dotNumber(LIGHT, 1),
      dotNumber(LIGHT, 0.45, { text: '3' }),
      townName(LIGHT, { text: 'Posen', halo: { color: LIGHT.bg, alpha: 1, px: 0.5 } }),
    ]);
    expect(got.verdicts).toHaveLength(5);
    expect(got.failedKinds).toEqual(['pale dot number', 'town name']);
    expect(got.failures).toHaveLength(3);
    for (const line of got.failures) expect(line).toMatch(/^FAILS: /);
    const town = got.kinds.find((k) => k.kind === 'town name');
    expect(town.count).toBe(2);
    expect(town.worst.text).toBe('Posen');
    expect(got.kinds.find((k) => k.kind === 'dot number').worst.pass).toBe(true);
  });

  test('no text is no failure, and says so with an empty list, not a pass', () => {
    expect(m.judgeMapText([])).toEqual({ verdicts: [], failures: [], failedKinds: [], kinds: [] });
  });
});
