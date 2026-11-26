/**
 * The map's own tooltip (lib/map-tip-script.ts; owner, 2026-11-25: "more user
 * friendly providing space from the mouse pointer"). A module of its own for
 * the ADR-008 design check's 400-char inline budget. Tokens only, no hex.
 *
 * Text at 16 px, the page's colours with an accent border, never wider than
 * the screen less its gutters. It takes no pointer, so it never sits between
 * the pointer and the hexagon under it. Once the script runs (`amap-tips`), a
 * press and hold on an area or a place shows this tooltip instead of the
 * phone's link menu, and selects no text.
 */
export const TIP_STYLE =
  '<style>.amap-tip{position:fixed;z-index:20;max-width:min(18rem,calc(100vw - 32px));padding:.5rem .75rem;border:2px solid var(--accent);border-radius:8px;background:var(--bg);color:var(--text);font:16px/1.35 system-ui;pointer-events:none}.amap-tips [data-tip]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}</style>';
