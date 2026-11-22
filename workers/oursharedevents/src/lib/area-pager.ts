/**
 * The landing's event cards, five at a time, nearest first once a distance is
 * known (owner, 2026-11-21: "Limit to a list of 5. If more than 5 returned in
 * the list, then a Click for More button is underneath ... Continue until list
 * is complete ... The list should be ordered in closest to the present location.
 * If there is no location given, then it is the order of the response.").
 *
 * FIVE AT A TIME. The cards the filters leave showing are counted in page order;
 * the first five show and the rest wait behind `data-more`. "Click for more"
 * shows five more each time, and goes away once every card is showing. Keyboard
 * focus moves to the first card it brought in, and a status line says how many
 * of how many are showing, so a screen reader hears what changed. A change of
 * filter starts again at five. Without this script every card shows, as before:
 * the button is hidden in the markup and only the script shows it.
 *
 * NEAREST FIRST. This script never reads a position. The page learns distance in
 * two places only, both on the person's tap: "Show where I am" on the map
 * (lib/map-pan-script.ts) and the "Near me" tab (lib/area-tabs-script.ts). Each
 * writes the distance to every area on that area's row of the map's list
 * (`li[data-area][data-d]`, lib/attendee-map.ts). This script reads those rows,
 * finds each card's area from the row that links the card's event, and puts the
 * cards nearest first; a card whose area has no distance (an online event, or one
 * with no place on the map) goes last. Until a distance is written the cards keep
 * the order the server sent. It makes no request, sets no cookie and stores
 * nothing (tests/area-pager.spec.ts reads this source).
 */
import { escapeHtml } from './html-escape.js';
import { msg } from './i18n/catalog.js';
import type { Lang } from './i18n/languages.js';

/** How many cards show at first, and how many more each tap brings. */
export const PAGE_SIZE = 5;

/** The script's own text, exported so a test can read it without parsing HTML. */
export const AREA_PAGER_SCRIPT = String.raw`(function () {
  var list = document.getElementById('area-list');
  var more = document.querySelector('[data-testid="area-more"]');
  if (!list || !more) return;
  var box = more.parentNode, status = box.parentNode.querySelector('[data-testid="area-more-status"]');
  var STEP = ${PAGE_SIZE}, limit = STEP;
  var cards = [].slice.call(list.querySelectorAll('article.event-card'));
  if (!cards.length) return;

  // Nearest first, from the distances the map's list carries.
  var rowOf = {};
  [].forEach.call(document.querySelectorAll('li[data-area]'), function (li) {
    [].forEach.call(li.querySelectorAll('a[href]:not(.amap-zoom)'), function (a) {
      var m = /\/events\/([^/?#]+)/.exec(a.getAttribute('href') || '');
      if (m) rowOf[decodeURIComponent(m[1])] = li;
    });
  });
  function far(c) {
    var li = rowOf[c.getAttribute('data-event-id')];
    return li && li.hasAttribute('data-d') ? +li.getAttribute('data-d') : Infinity;
  }
  function nearest() {
    var order = cards.slice().sort(function (a, b) {
      var x = far(a), y = far(b);
      return x === y ? 0 : x < y ? -1 : 1; // equal: the server's order (sort is stable)
    });
    var now = [].slice.call(list.querySelectorAll('article.event-card'));
    if (order.every(function (c, i) { return now[i] === c; })) return;
    order.forEach(function (c) { list.appendChild(c); });
  }

  // Five at a time, counting only the cards the filters leave showing.
  function page() {
    cards.forEach(function (c) { c.removeAttribute('data-more'); });
    var total = 0;
    [].forEach.call(list.querySelectorAll('article.event-card'), function (c) {
      if (getComputedStyle(c).display === 'none') return;
      total += 1;
      if (total > limit) c.setAttribute('data-more', '');
    });
    box.hidden = total <= limit;
    status.textContent = total > STEP
      ? (status.getAttribute('data-says') || '').replace('%n', String(Math.min(limit, total))).replace('%t', String(total))
      : '';
  }
  function showing() {
    return [].filter.call(list.querySelectorAll('article.event-card'), function (c) {
      return getComputedStyle(c).display !== 'none';
    });
  }
  more.addEventListener('click', function () {
    var before = showing().length;
    limit += STEP;
    page();
    var next = showing()[before], link = next && next.querySelector('a[href]');
    if (link) link.focus();
  });
  // A filter changed: start again at five.
  document.addEventListener('change', function (e) {
    if (e.target && e.target.type === 'radio') { limit = STEP; page(); }
  });
  // The other scripts move cards and hide them by distance; count again after.
  if (window.MutationObserver) {
    new MutationObserver(page).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    var legend = document.querySelector('ol.amap-legend');
    if (legend) new MutationObserver(nearest).observe(legend, { subtree: true, attributes: true, attributeFilter: ['data-d'] });
  }
  page();
})();`;

/**
 * Only the waiting cards are hidden; the button is full width on a phone, for a
 * thumb. Tokens only, no colour of its own. A module of its own for the same
 * reason as area-tabs-style.ts: the ADR-008 design check gives each source file
 * one 400-char inline style budget.
 */
const STYLE =
  '<style>.view-list .event-card[data-more]{display:none}.area-more{margin:1rem 0 0}.area-more .btn{width:100%}@media(min-width:480px){.area-more .btn{width:auto;min-width:14rem}}</style>';

/**
 * The button and its status line, placed after the last card, and the script.
 * The button is hidden until the script finds more than five cards to show.
 */
export function areaPager(lang: Lang): string {
  const says = escapeHtml(
    msg(lang, 'area.moreShown').replace('{n}', '%n').replace('{total}', '%t')
  );
  return `${STYLE}<p class="area-more" hidden><button class="btn btn-secondary" type="button" data-testid="area-more">${msg(lang, 'area.more')}</button></p><p class="near-note" role="status" aria-live="polite" data-testid="area-more-status" data-says="${says}"></p><script>${AREA_PAGER_SCRIPT}</script>`;
}
