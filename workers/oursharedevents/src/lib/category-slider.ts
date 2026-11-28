/**
 * The icon slider (OSE-2207; owner, 2026-11-22: "visual categories slider option
 * by icon ... different icons ... to differentiate between the categories", and
 * "a component that can be used throughout the application").
 *
 * One sideways row of choices, each a picture over its name, with two arrow
 * buttons. The track and the arrows sit in `.icon-slider-row`, so with the
 * design system's tuned row (hub PR 96, owner 2026-11-28) the arrows lie over
 * the row's two ends; with an older pin they stay under it. Its look is the design system's `.icon-slider` (`@ocr/ui`,
 * served as /ui.css), so this module sets no colour and carries no stylesheet: it
 * writes the markup, holds our own icon set, and ships the small script that
 * wires the arrows.
 *
 * ITEMS. An item is either the `<label>` of a radio kept elsewhere on the page
 * (`forId`, how the landing's CSS-only filters work: the radio still does the
 * filtering, and nothing is stored) or a `<button>` that carries a value
 * (`value`, for a form: the script keeps `aria-pressed` on the one chosen and
 * writes the value into the slider's hidden input).
 *
 * WITHOUT THE SCRIPT the row still scrolls with a swipe and every item still
 * works; the arrows stay hidden. WITH IT the arrows show only while the row is
 * wider than the screen, each one disabled at its end, and a radio that takes
 * keyboard focus scrolls its label into view.
 *
 * ICONS. Line drawings on a 24 px grid in `currentColor`, drawn for this product
 * (not copied from any icon set or site). Every bucket (migration 0127) and every
 * event category (migration 0076) has its own; a code added later shows the
 * general tag until it gets one, and tests/category-slider.spec.ts fails until it does.
 */

import { escapeHtml } from './html-escape.js';

/** The general icon, for a category with no drawing of its own yet. */
const TAG = '<path d="M3.5 12.5v-8a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.3"/>';

/**
 * One drawing per event-category code (event_type_category_registry, 0076), plus
 * ALL (every category) and OTHER (no known category). Inner SVG only.
 */
export const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  // Four tiles: everything.
  ALL: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  // Sports & Recreation: a ball.
  REC: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5v17M6.2 5.8c2.6 2.4 2.6 10 0 12.4M17.8 5.8c-2.6 2.4-2.6 10 0 12.4"/>',
  // Social & Community Dining: fork, plate, knife.
  SOC: '<circle cx="12.5" cy="12" r="4.5"/><path d="M3.5 4v5a1.5 1.5 0 0 0 3 0V4M5 10.5V20M20.5 4c-1.7 1-2.5 3.5-2.5 6.5h2.5V20"/>',
  // Entertainment & Trivia: a question in a speech bubble.
  ENT: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z"/><path d="M10 7.8a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.4"/><circle cx="12" cy="13" r=".6" fill="currentColor"/>',
  // Performing Arts & Open Mic: a microphone.
  PER: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  // Arts, Culture & Live Music: a painter's palette.
  ART: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.3-1.6-1.3-2.8 0-1 .8-1.7 1.8-1.7h2.2a4 4 0 0 0 4-4c0-3.7-3.8-6.8-8.5-6.8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>',
  // Tabletop & Board Games: a die.
  TAB: '<rect x="4" y="4" width="16" height="16" rx="3"/><g fill="currentColor"><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="8.5" cy="15.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/></g>',
  // Neighborhood Markets: a stall under an awning.
  MKT: '<path d="M3.5 9.5 5 4h14l1.5 5.5"/><path d="M3.5 9.5a2.1 2.1 0 0 0 4.25 0 2.1 2.1 0 0 0 4.25 0 2.1 2.1 0 0 0 4.25 0 2.1 2.1 0 0 0 4.25 0"/><path d="M5 11.5V20h14v-8.5M10 20v-4.5h4V20"/>',
  // Business & Networking: a briefcase.
  BIZ: '<rect x="3.5" y="7" width="17" height="12.5" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17M11 12.5V14h2v-1.5"/>',
  // Fundraisers: a jar with a dollar sign.
  FND: '<path d="M7 7h10M8 7V4.5h8V7M7 7c-1.5 1.5-2 3-2 5v5.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V12c0-2-.5-3.5-2-5"/><path d="M12 10v7.5M14 11.2h-2.8a1.3 1.3 0 0 0 0 2.6h1.6a1.3 1.3 0 0 1 0 2.6H10"/>',
  // Volunteer & Mutual Aid: a hand holding a heart.
  VOL: '<path d="M12 11.5s-3.5-2-3.5-4.3A2 2 0 0 1 12 6a2 2 0 0 1 3.5 1.2c0 2.3-3.5 4.3-3.5 4.3z"/><path d="M3.5 14.5h3l3.5 2h3.5a1.5 1.5 0 0 0 0-3H10M13.5 16.5l4.4-1.9a1.6 1.6 0 0 1 1.3 2.9L13 20.5H3.5"/>',
  // Civic & Neighborhood: a hall with columns.
  CIV: '<path d="M3.5 9.5 12 4l8.5 5.5M4.5 18.5h15M3.5 21h17M6.5 10.5v6M10 10.5v6M14 10.5v6M17.5 10.5v6"/>',
  // Gardening & Outdoor: a sprout.
  GAR: '<path d="M12 20.5V11M7.5 20.5h9"/><path d="M12 13.5c0-3.5-2.5-6-7-6 0 4 2.6 6 7 6z"/><path d="M12 11c0-3.6 2.5-6.5 7-6.5 0 4.3-2.8 6.5-7 6.5z"/>',
  // Fitness & Running: a dumbbell.
  FIT: '<rect x="5" y="6.5" width="3.5" height="11" rx="1"/><rect x="15.5" y="6.5" width="3.5" height="11" rx="1"/><path d="M8.5 12h7M2.5 9.5v5M21.5 9.5v5"/>',
  // Literary & Book Clubs: an open book.
  LIT: '<path d="M12 6.5C10.3 5 7.8 4.5 4 4.5v13c3.8 0 6.3.5 8 2 1.7-1.5 4.2-2 8-2v-13c-3.8 0-6.3.5-8 2zM12 6.5v13"/>',
  // Faith Community: a lit candle (no one faith's symbol).
  FAI: '<path d="M12 3c1.6 1.9 2 3.1 2 4a2 2 0 0 1-4 0c0-.9.4-2.1 2-4z"/><rect x="9" y="11" width="6" height="9.5" rx="1"/><path d="M6 20.5h12"/>',
  // ── The 9 buckets (migration 0127), what the landing row shows. ──
  // Sports & Recreation: a soccer ball.
  SPT: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8l3 2.2-1.1 3.6h-3.8L9 10.2zM12 8V3.5M15 10.2l4.6-1.4M13.9 13.8l2.8 3.9M10.1 13.8l-2.8 3.9M9 10.2l-4.6-1.4"/>',
  // Games & Trivia: two playing cards.
  GAM: '<rect x="4" y="5" width="10" height="14" rx="1.5"/><path d="M14 7.5l5 1.3a1.5 1.5 0 0 1 1 1.8l-2.6 9.6a1.5 1.5 0 0 1-1.8 1L11 20"/><path d="M9 9.5l1.8 2.5L9 14.5 7.2 12z"/>',
  // Music & Shows: two notes.
  SHW: '<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  // Parties & Festivals: a balloon.
  PTY: '<ellipse cx="12" cy="9" rx="5.5" ry="6.5"/><path d="M12 15.5l-1 1.5h2zM12 17c0 2-2 2.5-2 4.5"/>',
  // Bargains: a price tag.
  BGN: '<path d="M20.5 3.5H13l-9.5 9.5 7.5 7.5 9.5-9.5z"/><circle cx="16.5" cy="7.5" r="1.3"/><path d="M8.5 15.5l5-5"/>',
  // Kids & Family: a kite.
  KID: '<path d="M12 3l6 7-6 8-6-8z"/><path d="M6 10h12M12 3v15M12 18c-1 1.5 1 2 0 3.5"/>',
  // Learn & Connect: a graduation cap.
  LRN: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3V11M21.5 9v5"/>',
  // Give Back: a heart with a plus.
  GIV: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M12 10.5v5M9.5 13h5"/>',
  // Neighborhood & Faith: two houses side by side.
  CMT: '<path d="M3 11.5 8 7l5 4.5M4.5 10.2V20h7v-8.5M11 11.5 16 7l5 4.5M19.5 10.2V20h-6M7 20v-4h2v4"/>',
  // Other: three dots.
  OTHER:
    '<circle cx="12" cy="12" r="8.5"/><g fill="currentColor"><circle cx="8" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="16" cy="12" r="1"/></g>',
};

const SVG_OPEN =
  '<svg class="icon-slider-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

/** An icon's `<svg>`, decorative (the item's text names it). Unknown code → the tag. */
export function iconSvg(
  code: string,
  icons: Readonly<Record<string, string>> = CATEGORY_ICONS
): string {
  return `${SVG_OPEN}${icons[code] ?? TAG}</svg>`;
}

const ARROW_PREV = '<path d="M15 5l-7 7 7 7"/>';
const ARROW_NEXT = '<path d="M9 5l7 7-7 7"/>';
const arrowSvg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

export interface IconSliderItem {
  /** The icon key (a category code, ALL or OTHER). */
  icon: string;
  /** The item's visible name (plain text; escaped here). */
  text: string;
  /** The id of the radio this item is the label of. */
  forId?: string;
  /** For a button item: the value it writes into the slider's input. */
  value?: string;
  /** data-testid on the item. */
  testid?: string;
}

export interface IconSliderOptions {
  /** The group's accessible name (plain text). */
  label: string;
  /** Show the label above the row (true) or give it to assistive tech only. */
  showLabel?: boolean;
  items: readonly IconSliderItem[];
  /** The arrows' accessible names. */
  prevLabel: string;
  nextLabel: string;
  testid: string;
  /** Button items only: the form field name, and which value starts chosen. */
  name?: string;
  selected?: string;
  /** Another icon set (a sponsor's kinds of business), same shape as CATEGORY_ICONS. */
  icons?: Readonly<Record<string, string>>;
}

/** The slider's markup. Every text is escaped here. */
export function renderIconSlider(o: IconSliderOptions): string {
  const id = `${o.testid}-label`;
  const items = o.items
    .map((it) => {
      const tid = it.testid ? ` data-testid="${escapeHtml(it.testid)}"` : '';
      const inner = `${iconSvg(it.icon, o.icons)}<span class="icon-slider-text">${escapeHtml(it.text)}</span>`;
      if (it.forId !== undefined) {
        return `<label class="icon-slider-item" for="${escapeHtml(it.forId)}"${tid}>${inner}</label>`;
      }
      const on = it.value !== undefined && it.value === o.selected;
      return `<button type="button" class="icon-slider-item" data-value="${escapeHtml(it.value ?? '')}" aria-pressed="${on}"${tid}>${inner}</button>`;
    })
    .join('');
  const field =
    o.name !== undefined
      ? `<input type="hidden" name="${escapeHtml(o.name)}" value="${escapeHtml(o.selected ?? '')}" data-icon-slider-value />`
      : '';
  const heading = `<p class="${o.showLabel ? 'icon-slider-heading' : 'sr-only'}" id="${escapeHtml(id)}">${escapeHtml(o.label)}</p>`;
  // Label items take no focus of their own (their radios sit elsewhere), so the
  // track is the keyboard's stop for scrolling the row (WCAG 2.1.1; axe
  // scrollable-region-focusable). Button items are their own stops.
  const stop = o.items.some((it) => it.forId !== undefined) ? ' tabindex="0"' : '';
  return `<div class="icon-slider" data-icon-slider data-testid="${escapeHtml(o.testid)}">${heading}<div class="icon-slider-row"><div class="icon-slider-track" role="group" aria-labelledby="${escapeHtml(id)}"${stop}>${items}</div><div class="icon-slider-nav" hidden><button type="button" class="icon-slider-arrow" data-step="-1" aria-label="${escapeHtml(o.prevLabel)}" data-testid="${escapeHtml(o.testid)}-prev">${arrowSvg(ARROW_PREV)}</button><button type="button" class="icon-slider-arrow" data-step="1" aria-label="${escapeHtml(o.nextLabel)}" data-testid="${escapeHtml(o.testid)}-next">${arrowSvg(ARROW_NEXT)}</button></div></div>${field}</div>`;
}

/**
 * Wires every `[data-icon-slider]` on the page. No request, no cookie, no storage.
 * In a right-to-left page the row starts at the right, so "more" scrolls left.
 */
const SCRIPT = String.raw`(function () {
  var all = document.querySelectorAll('[data-icon-slider]');
  for (var i = 0; i < all.length; i++) wire(all[i]);
  function wire(box) {
    var track = box.querySelector('.icon-slider-track');
    var nav = box.querySelector('.icon-slider-nav');
    if (!track || !nav) return;
    var EDGE = 6;
    var prev = nav.querySelector('[data-step="-1"]');
    var next = nav.querySelector('[data-step="1"]');
    var rtl = getComputedStyle(track).direction === 'rtl';
    function pos() { return Math.abs(track.scrollLeft); }
    function update() {
      var room = track.scrollWidth - track.clientWidth;
      // A few px of slack: the snap and the track's own padding can leave the
      // row 2 px from either end, which is still the end.
      nav.hidden = room <= EDGE;
      prev.disabled = pos() <= EDGE;
      next.disabled = pos() >= room - EDGE;
    }
    function step(dir) {
      var by = Math.max(track.clientWidth * 0.8, 100) * dir * (rtl ? -1 : 1);
      track.scrollBy({ left: by, behavior: 'smooth' });
    }
    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // A radio kept elsewhere: when it takes focus, its label comes into view.
    var labels = track.querySelectorAll('label[for]');
    for (var j = 0; j < labels.length; j++) {
      (function (label) {
        var radio = document.getElementById(label.getAttribute('for'));
        if (radio) radio.addEventListener('focus', function () {
          label.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
      })(labels[j]);
    }
    // Button items: at most one chosen, its value in the slider's input. A tap on
    // the chosen one clears the choice (the field is optional where it is used).
    var input = box.querySelector('[data-icon-slider-value]');
    var buttons = track.querySelectorAll('button[data-value]');
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].addEventListener('click', function (ev) {
        var b = ev.currentTarget;
        var on = b.getAttribute('aria-pressed') !== 'true';
        for (var m = 0; m < buttons.length; m++) buttons[m].setAttribute('aria-pressed', String(on && buttons[m] === b));
        if (input) {
          input.value = on ? b.getAttribute('data-value') : '';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
    update();
  }
})();`;

/** The wiring script, once per page, after the sliders. */
export const ICON_SLIDER_SCRIPT = `<script>${SCRIPT}</script>`;
