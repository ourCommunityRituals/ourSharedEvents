/**
 * The numbered list under the landing's map, kept on the page and not shown
 * (owner, 2026-11-21: "if the list is required to populate the page keep, but
 * do not display on the page").
 *
 * The page needs it: the "Near me" distance (lib/area-tabs-script.ts) learns
 * which area each event card is in from its rows, and "Show where I am"
 * (lib/map-pan-script.ts) writes each area's distance on them. It is also the
 * map in words for a screen reader, so it stays in the page and is read out.
 *
 * Hidden the accessible way: no box on screen, still read by a screen reader.
 * Its links can take keyboard focus, so the list shows itself while one of them
 * has focus (WCAG 2.4.7: a focused control is never off screen), and hides
 * again when focus leaves it. No colour is set here.
 *
 * A module of its own for the same reason as map-zoom-style.ts: the ADR-008
 * design check gives each source file one 400-char inline style budget.
 */
export const MAP_LIST_HIDDEN_CLASS = 'amap-quiet';

export const MAP_LIST_STYLE = `<style>.${MAP_LIST_HIDDEN_CLASS}:not(:focus-within){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}</style>`;
