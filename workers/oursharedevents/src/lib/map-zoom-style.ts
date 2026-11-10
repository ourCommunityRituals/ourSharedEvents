/**
 * The landing map zoomed in on one area: its outline, the numbered dots and
 * the way back (owner, 2026-11-09). Used by attendee-map.ts.
 *
 * A module of its own because the ADR-008 design check (@ocr/ui
 * check-spoke-styles) gives each source file one 400-char inline style budget,
 * and attendee-map.ts spends its budget on MAP_STYLE, as street-map.ts does on
 * STREET_STYLE. Tokens only, no hex. `.amap-hit` is the invisible touch target
 * round a dot (its `fill-opacity="0"` is on the circle, to keep this block in budget). The area's outline is neutral (`--border-strong`, 3:1): map
 * cells are never the button colour (design system README, 2026-10-08), so
 * `--accent` is left for the dots, which are the things to tap.
 */
export const ZOOM_STYLE =
  '<style>.amap-zone{fill:var(--border-strong);fill-opacity:.06;stroke:var(--border-strong);stroke-width:3}.amap-dot{fill:var(--accent);stroke:var(--bg);stroke-width:3}.amap-blk .amap-dot{fill-opacity:.45;stroke-dasharray:4 3}.amap-dn{fill:var(--on-accent);font:700 15px system-ui}.amap-back,.amap-zoom{display:inline-flex;align-items:center;min-height:44px;color:var(--accent)}</style>';
