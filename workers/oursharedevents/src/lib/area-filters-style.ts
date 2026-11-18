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
 *
 * On a phone the hidden radios shrink to 1 px. They are never pressed (their
 * labels are, and the radios take no pointer), but at their default 13 px a
 * radio whose label is folded away read as a small touch target in the phone
 * audit (mobile-workability.spec.ts, PR checks of 2026-11-17).
 *
 * A control whose label is not on screen is not in the tab order either (WCAG
 * 2.4.7 Focus Visible, 4.1.2; the map's accessibility audit of 2026-11-18): the
 * checkbox comes before the folded groups' radios, so while the chip is not
 * pressed those radios take no focus, and from FILTERS_FOLD_PX up, where the chip
 * is hidden, the checkbox is too. A radio that takes no display still works the
 * rules that read its :checked state.
 */

/** Screen width, in px, from which the filters always show. */
export const FILTERS_FOLD_PX = 600;

/** The checkbox the Filters chip labels. */
export const FILTERS_TOGGLE_ID = 'filters-open';

export const AREA_FILTERS_STYLE =
  '<style>@media(max-width:599.98px){.toggle-radio{width:1px;height:1px;margin:0}#filters-open:not(:checked)~.toggle-radio,#filters-open:not(:checked)~.area-filters{display:none}}@media(min-width:600px){.area-filters-btn,#filters-open{display:none}}</style>';
