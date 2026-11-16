// The contrast of text drawn on the map, by measurement.
//
// axe cannot decide the contrast of text drawn over the street layer: it calls
// town names and dot numbers "incomplete" (street-map CCR 2026-11-15, R27).
// "Not decided" was a failure once the street map was binding, so the flag
// could never be set on a green chain. This module decides it another way: from
// the colours the browser resolved for the text and for everything drawn under
// and over it, by the WCAG 2 contrast formula.
//
// It is the arithmetic only, with no browser in it. A page is read by
// tests/e2e/helpers/map-text-contrast.ts (readMapText), which hands each text
// here as a plain object. tests/unit/ci/map-text-contrast.test.js holds the
// arithmetic to WCAG's own published figures.
//
// WHAT A TEXT IS JUDGED AGAINST, in this order:
//   its halo    The text is stroked under its fill (`paint-order: stroke`) in an
//               opaque colour, and the stroke shows HALO_MIN_PX or more outside
//               the letter on screen. The halo is then what touches every edge
//               of every letter, whatever is drawn under the text, and the text
//               is judged against the halo's colour. WCAG has no figure for a
//               halo's width; technique G18 says a border wide enough to act as
//               a halo is the background. 1 px is this module's floor, and the
//               width is printed with every verdict.
//   its plate   The text sits on a shape of its own (a dot under its number).
//               An opaque plate is the background. A plate that lets what is
//               under it through is judged over every colour drawn under it.
//   the map     No halo and no plate: every colour drawn under the text.
// A translucent shape drawn OVER the text (a hexagon over a town name, the
// area's own tint) colours the text and its background alike, so both are
// tinted before the ratio is taken, and the worst case is kept.
//
// WHAT IT DOES NOT SEE. Where a road happens to run: every colour of the
// drawing is taken to be under every text, so a verdict does not depend on the
// place. Text hidden by an opaque shape drawn over it (that is a layout fault,
// not a contrast one). Images and gradients: a paint that is not a plain
// colour throws, by name, and never passes.

/** WCAG 2.2 SC 1.4.3 (AA): body text, and large text. */
export const AA = 4.5;
export const AA_LARGE = 3;
/** Large text: 18 pt, or 14 pt bold, in CSS px (1 pt = 4/3 px). */
export const LARGE_PX = 24;
export const LARGE_BOLD_PX = (14 * 4) / 3;
export const BOLD = 700;
/** A halo narrower than this on screen is not taken for a background. */
export const HALO_MIN_PX = 1;
/** Opaque, to rounding. */
const OPAQUE = 0.999;

/**
 * A colour as the browser reports a computed value: `rgb(1, 2, 3)`,
 * `rgba(1, 2, 3, 0.5)`, the space form with `/ alpha`, or `color(srgb r g b)`.
 * Anything else (`none`, `url(#x)`, a keyword) throws.
 */
export function parseColor(css) {
  const s = String(css).trim();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  let rgb;
  if (m) {
    rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/.exec(s);
    if (!m) throw new Error(`map text contrast: "${s}" is not a plain colour`);
    rgb = [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
  }
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
  if (![...rgb, a].every(Number.isFinite) || rgb.some((v) => v < 0 || v > 255) || a < 0 || a > 1) {
    throw new Error(`map text contrast: "${s}" is not a colour in range`);
  }
  return { rgb, alpha: a };
}

/** `top` at `alpha` over the opaque colour `bottom` (source-over, in sRGB as browsers do). */
export function over(top, alpha, bottom) {
  return [0, 1, 2].map((i) => top[i] * alpha + bottom[i] * (1 - alpha));
}

/** WCAG relative luminance of an sRGB colour, 0 to 1. */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The AA ratio a text of this size and weight must reach, on screen. */
export function requiredRatio(px, weight) {
  return px >= LARGE_PX || (px >= LARGE_BOLD_PX && weight >= BOLD) ? AA_LARGE : AA;
}

const hex = (rgb) =>
  '#' +
  rgb
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

/** A paint as read from the page (`{ what, color, alpha }`) with its colour parsed. */
function paint(p) {
  const c = parseColor(p.color);
  return { what: p.what, rgb: c.rgb, alpha: c.alpha * (p.alpha ?? 1) };
}

/**
 * Every colour that can lie under a point of the drawing: the ground, and each
 * layer's paints over what was there before, in paint order. A layer is a list
 * of alternatives (two hexagons of different strength never cover one point);
 * a translucent paint is laid over every colour so far.
 */
export function backdrops(ground, layers) {
  const g = parseColor(ground);
  if (g.alpha < OPAQUE) throw new Error(`map text contrast: the page behind the map is not opaque`);
  let seen = [{ what: 'the page', rgb: g.rgb }];
  const key = (c) => c.rgb.map((v) => Math.round(v * 2)).join(',');
  for (const layer of layers) {
    const before = seen;
    let next = [...before];
    for (const raw of layer) {
      const p = paint(raw);
      if (p.alpha <= 0) continue;
      if (raw.whole && p.alpha >= OPAQUE) {
        // An opaque shape over the whole frame: nothing drawn before it shows.
        next = [{ what: p.what, rgb: p.rgb }];
        continue;
      }
      const made =
        p.alpha >= OPAQUE
          ? [{ what: p.what, rgb: p.rgb }]
          : before.map((c) => ({ what: `${p.what} over ${c.what}`, rgb: over(p.rgb, p.alpha, c.rgb) }));
      next.push(...made);
    }
    const byKey = new Map();
    for (const c of next) if (!byKey.has(key(c))) byKey.set(key(c), c);
    seen = [...byKey.values()];
    if (seen.length > 2000) throw new Error('map text contrast: too many colours under the text');
  }
  return seen;
}

/** The lowest ratio of `fill` against each of `backs`, each under each of `tints`. */
function worst(fill, backs, tints) {
  let low = null;
  for (const back of backs) {
    const text = fill.alpha >= OPAQUE ? fill.rgb : over(fill.rgb, fill.alpha, back.rgb);
    for (const tint of [null, ...tints]) {
      const fg = tint ? over(tint.rgb, tint.alpha, text) : text;
      const bg = tint ? over(tint.rgb, tint.alpha, back.rgb) : back.rgb;
      const ratio = contrastRatio(fg, bg);
      if (!low || ratio < low.ratio) {
        low = {
          ratio,
          text: hex(fg),
          back: hex(bg),
          against: tint ? `${back.what}, under ${tint.what}` : back.what,
        };
      }
    }
  }
  return low;
}

/**
 * Judge one text read from the page.
 *
 *   t.kind, t.text         what it is and what it says
 *   t.px, t.weight         its size on screen and its weight
 *   t.fill                 { color, alpha }
 *   t.halo                 { color, alpha, px } or null: a stroke under the fill
 *   t.plate                { what, color, alpha } or null: its own shape under it
 *   t.ground               the page colour behind the map
 *   t.under                layers drawn before it, each a list of { what, color, alpha, whole? }
 *   t.over                 translucent fills drawn after it, over it
 */
export function judgeText(t) {
  const fill = paint({ what: 'text', ...t.fill });
  if (fill.alpha <= 0) throw new Error(`map text contrast: ${t.kind} "${t.text}" has no fill`);
  const under = backdrops(t.ground, t.under ?? []);
  const tints = (t.over ?? []).map(paint).filter((p) => p.alpha > 0 && p.alpha < OPAQUE);
  const halo = t.halo ? { ...paint({ what: 'its halo', ...t.halo }), px: t.halo.px } : null;
  const haloCounts = Boolean(halo && halo.alpha >= OPAQUE && halo.px >= HALO_MIN_PX);
  const plate = t.plate ? paint(t.plate) : null;

  let backs;
  let basis;
  if (haloCounts) {
    backs = [{ what: 'its halo', rgb: halo.rgb }];
    basis = 'halo';
  } else if (plate && plate.alpha > 0) {
    backs =
      plate.alpha >= OPAQUE
        ? [{ what: plate.what, rgb: plate.rgb }]
        : under.map((c) => ({
            what: `${plate.what} at ${Math.round(plate.alpha * 100)}% over ${c.what}`,
            rgb: over(plate.rgb, plate.alpha, c.rgb),
          }));
    basis = 'plate';
  } else {
    backs = under;
    basis = 'map';
  }
  const need = requiredRatio(t.px, t.weight);
  const low = worst(fill, backs, tints);
  // What the same text would read as with nothing of its own behind it.
  const bare = basis === 'map' ? low : worst(fill, under, tints);
  return {
    kind: t.kind,
    text: t.text,
    px: t.px,
    weight: t.weight,
    need,
    basis,
    ratio: low.ratio,
    colours: `${low.text} on ${low.back}`,
    against: low.against,
    pass: low.ratio >= need,
    haloPx: halo ? halo.px : null,
    haloCounts,
    bare: { ratio: bare.ratio, against: bare.against },
  };
}

const fix = (n, d = 2) => (Math.floor(n * 10 ** d) / 10 ** d).toFixed(d);

/** One line a verdict: what was measured, so a pass says how much room it had. */
export function verdictLine(v) {
  const halo =
    v.haloPx === null
      ? ''
      : v.haloCounts
        ? `; halo ${fix(v.haloPx, 1)} px`
        : `; its halo is ${fix(v.haloPx, 1)} px or not opaque, under the ${HALO_MIN_PX} px floor, so it is not counted`;
  const bare =
    v.basis === 'map'
      ? ''
      : `; with nothing of its own behind it ${fix(v.bare.ratio)}:1 over ${v.bare.against}`;
  return (
    `${v.pass ? 'passes' : 'FAILS'}: ${v.kind} "${v.text}" (${fix(v.px, 1)} px, weight ${v.weight}) ` +
    `${fix(v.ratio)}:1 against ${v.against} (${v.colours}), needs ${v.need}:1${halo}${bare}`
  );
}

/**
 * Judge every text. `failures` are the lines of the texts under their ratio;
 * `kinds` is each kind's worst verdict, for a short report.
 */
export function judgeMapText(texts) {
  const verdicts = texts.map(judgeText);
  const kinds = new Map();
  for (const v of verdicts) {
    const k = kinds.get(v.kind);
    if (!k || v.ratio - v.need < k.worst.ratio - k.worst.need) {
      kinds.set(v.kind, { count: (k?.count ?? 0) + 1, worst: v });
    } else {
      k.count += 1;
    }
  }
  return {
    verdicts,
    failures: verdicts.filter((v) => !v.pass).map(verdictLine),
    failedKinds: [...new Set(verdicts.filter((v) => !v.pass).map((v) => v.kind))].sort(),
    kinds: [...kinds.entries()].map(([kind, k]) => ({ kind, count: k.count, worst: k.worst })),
  };
}
