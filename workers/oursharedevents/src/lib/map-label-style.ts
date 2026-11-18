/**
 * Street names and landmarks on the street map (lib/street-labels.ts; owner,
 * 2026-11-18). A module of its own for the ADR-008 design check's 400-char
 * inline budget, as map-zoom-style.ts is. Tokens only, no hex. Names are in the
 * text colour with a halo of the page colour, so they read over streets and
 * over the see-through hexagons alike. `as-t2` names wait until the map is at
 * twice its size (`data-k`, set by lib/map-pan-script.ts). A narrow screen sets
 * them larger, as it does town names (map-narrow-style.ts).
 */
export const LABEL_STYLE =
  '<style>.as-n,.as-p{fill:var(--text);font:600 19px system-ui;paint-order:stroke;stroke:var(--bg);stroke-width:5}.as-p{font:italic 600 19px system-ui}.as-pm{fill:var(--info);stroke:var(--bg);stroke-width:2}.as-t2{display:none}.amap[data-k] .as-t2{display:inline}@media(max-width:479px){.as-n,.as-p{font-size:28px}}</style>';
