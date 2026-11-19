/**
 * The landing area's filter tabs (OSE-2156; lib/area-tabs-script.ts). Used by
 * landing-area.ts.
 *
 * The tabs are the shared filter chip (`.disc-chip`, lib/event-list) on a
 * `<button>`, so the shape is the one the chips already have. Only what a button
 * lacks is set here, and no colour of its own, only tokens: the buttons take the
 * page's font and a 3 px focus ring in the accent. A selected tab is outlined in
 * the accent on the surface, with no check mark, so it never reads as a chosen
 * chip (the filled, ticked look below says "this value is chosen"; a tab is a
 * place, not a value). The distance list takes its own width, never more than the
 * screen's (at 200% text 12rem is wider than a 320 px phone).
 *
 * A module of its own for the same reason as area-filters-style.ts: the ADR-008
 * design check gives each source file one 400-char inline style budget.
 */
export const AREA_TABS_STYLE =
  '<style>button.disc-chip{font-family:inherit}button.disc-chip:focus-visible{outline:3px solid var(--accent);outline-offset:2px}.area-tabs .disc-chip.active{background:var(--surface);border:2px solid var(--accent);color:var(--text)}.area-tabs .disc-chip.active::before{content:none}.area-tab{flex:1 1 100%;margin:.25rem 0}.near-sel{width:auto;min-width:min(12rem,100%)}.near-d{white-space:nowrap}</style>';
