/**
 * The landing area's filters folded behind one "Filters" chip on a phone (the
 * attendee-map grade of 2026-11-17: on a phone the map started about two
 * screens down, under the view, window, type and online chips). Used by
 * landing-area.ts.
 *
 * Under FILTERS_FOLD_PX the window, type and Where groups are hidden until the
 * Filters chip is pressed. The chip is the label of a checkbox that sits with
 * the area's radios, so the fold is CSS only, like the filters themselves, and
 * nothing about it is stored. From FILTERS_FOLD_PX up the groups always show
 * and the chip does not.
 *
 * A module of its own for the same reason as map-zoom-style.ts: the ADR-008
 * design check gives each source file one 400-char inline style budget. No
 * colour is set here; the chip's look is the shared filter chip's.
 */

/** Screen width, in px, from which the filters always show. */
export const FILTERS_FOLD_PX = 600;

/** The checkbox the Filters chip labels. */
export const FILTERS_TOGGLE_ID = 'filters-open';

export const AREA_FILTERS_STYLE =
  '<style>@media(max-width:599.98px){#filters-open:not(:checked)~.area-filters{display:none}}@media(min-width:600px){.area-filters-btn{display:none}}</style>';
