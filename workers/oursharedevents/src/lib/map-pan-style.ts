/**
 * The map's zoom buttons, its scale bar and the you-are-here mark (owner,
 * 2026-11-18; lib/map-pan-script.ts). A module of its own for the ADR-008
 * design check's 400-char inline budget. Tokens only, no hex. Buttons are the
 * design system's `.btn` at the 44 px touch floor. The mark is a ringed dot in
 * the text colour with a halo of the page colour: it differs from an event's
 * dot (the accent colour, numbered) by shape and by colour, and it reads on
 * land, water, a road or a hexagon.
 */
export const PAN_STYLE =
  '<style>.amap-ctl,.amap-scale{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}.amap-ctl{margin:.5rem 0}.amap-ctl .btn{min-width:48px;min-height:48px}.amap-bar{display:inline-block;height:8px;border:2px solid var(--text);border-top:0}.amap-you .y1{fill:var(--text);fill-opacity:.15}.amap-you .y2{fill:var(--text);stroke:var(--bg);stroke-width:4}.amap-you .y3{fill:var(--bg)}</style>';
