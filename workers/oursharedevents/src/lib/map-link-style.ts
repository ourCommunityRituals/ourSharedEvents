/**
 * From which screen width a hexagon on the landing's own map is a link
 * (OSE-2084). Used by attendee-map.ts.
 *
 * The map is one drawing 600 units wide, scaled to the page, and a hexagon is a
 * link only where it is a touch target: 44 px or more (AGENTS.md invariant 8).
 * How large a hexagon is drawn depends on how far the areas spread, so some
 * maps have hexagons that are 44 px on a wide screen and not on a phone
 * (staging with eleven areas, 2026-11-15: 45 by 44 units, so 21 px on a 320 px
 * phone and 52 px on a desktop). A link cannot be switched off in a style
 * sheet, so such a hexagon is drawn twice: once as a link (`amap-w` and its
 * step), once plain (`amap-n` and its step), and the width decides which shows.
 * The one not shown has no box, takes no tap and no keyboard focus.
 *
 * Three steps, each the screen width from which the map is wide enough. The
 * page is at most 760 px wide and its gutters are 40 px in all, so the map is
 * the screen less 40 px, and 720 px at most:
 *   step 1, from 480 px: a 440 px map, a hexagon of 60 units or more;
 *   step 2, from 640 px: a 600 px map, 44 units or more;
 *   step 3, from 760 px: a 720 px map, 36.7 units or more.
 * A hexagon that is a touch target on the narrowest phone is a link at every
 * width and is drawn once, with neither class; one under 36.7 units is never a
 * link. Either way the list under the map keeps a 44 px link to every area.
 *
 * A module of its own for the same reason as map-zoom-style.ts: the ADR-008
 * design check gives each source file one 400-char inline style budget. No
 * colour is set here.
 */
export const LINK_STYLE =
  '<style>.amap-w1,.amap-w2,.amap-w3{display:none}@media(min-width:480px){.amap-w1{display:inline}.amap-n1{display:none}}@media(min-width:640px){.amap-w2{display:inline}.amap-n2{display:none}}@media(min-width:760px){.amap-w3{display:inline}.amap-n3{display:none}}</style>';

/** Each step's screen width, in px, in the order of the classes above. */
export const LINK_FROM_PX = [480, 640, 760] as const;
/** The page's gutters and its widest map, in px (templates/landing.html: `main`). */
export const MAP_GUTTER_PX = 40;
export const MAP_MAX_PX = 720;
