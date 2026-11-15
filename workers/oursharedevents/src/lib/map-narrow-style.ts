/**
 * The landing map on a narrow screen (street-map CCR 2026-11-15, findings R24
 * and R38). Used by attendee-map.ts, after its other style blocks.
 *
 * The map is one drawing 600 units wide, scaled to the page, so on a phone
 * everything on it shrinks with the screen. Two floors are counted in screen
 * pixels, not map units: a dot's touch target is 44 px (AGENTS.md invariant 8)
 * and no text is under 13 px (design system README). Measured in a browser on
 * 2026-11-15, on a 320 px screen (a 280 px map): the dot's target was 36.4 px,
 * its number 7 px, a town name 10.3 px and an area number 12.1 px.
 *
 * Under 480 px:
 *   - the zoomed area is drawn 4 by 3, not 5 by 3. Its svg carries
 *     `preserveAspectRatio="xMidYMid slice"`, so the taller box shows the middle
 *     480 units of the drawing at a larger scale (0.58 px a unit at 320 px,
 *     where the whole frame gives 0.47). The area's outline and every dot's
 *     target lie inside those 480 units: the frame fits the hexagon to 84% of
 *     its height (`frameForCells`), which leaves it under 350 units wide, and a
 *     dot sits within one res-9 cell of it. What is cut is street on either
 *     side. At 320 px the 78-unit target is 45.5 px.
 *   - the landing's own map is drawn square where every area lies in the middle
 *     360 units of the drawing and a hexagon link would otherwise be under
 *     44 px (`data-tall`, set by `svgFor` in attendee-map.ts, OSE-2084). The
 *     same `slice`, so the hexagons are larger and only street is cut: 0.78 px
 *     a unit at 320 px, where the whole frame gives 0.47. Staging's ten areas
 *     (62 by 60 units, 2026-11-15) go from 29 by 28 px to 48 by 47 px. Where an
 *     area lies outside the middle the map keeps its whole frame.
 *   - text is set in more units: a dot's number 23 (13.4 px at 320 px), town
 *     names and area numbers 28 (13.1 px on the landing's own map in its whole
 *     frame).
 * From 480 px the whole frame is wide enough for the sizes the other blocks set
 * (`.amap-dn` 18, `.as-t` 22, `.amap-num` 26): 13.2 px, 16.1 px and 19.1 px on
 * a 440 px map.
 *
 * A module of its own for the same reason as map-zoom-style.ts: the ADR-008
 * design check gives each source file one 400-char inline style budget. No
 * colour is set here.
 */
export const NARROW_MAP_STYLE =
  '<style>@media(max-width:479px){.amap[data-zoom] svg{aspect-ratio:4/3}.amap[data-tall] svg{aspect-ratio:1/1}.amap-dn{font-size:23px}.as-t,.amap-num{font-size:28px}}</style>';
