/**
 * The landing's event cards (and /map's), five at a time, nearest first once a
 * distance is known (owner, 2026-11-21: "Limit to a list of 5. If more than 5
 * returned in the list, then a Click for More button is underneath ... Continue
 * until list is complete ... The list should be ordered in closest to the present
 * location. If there is no location given, then it is the order of the response.").
 *
 * FIVE AT A TIME is the app's one card pager (lib/card-pager.ts, owner 2026-11-22:
 * every list of cards pages the same way). This module adds what only the landing
 * has: a map that can learn how far each area is.
 *
 * NEAREST FIRST. This script never reads a position. The page learns distance in
 * two places only, both on the person's tap: "Show where I am" on the map
 * (lib/map-pan-script.ts) and the "Near me" tab (lib/area-tabs-script.ts). Each
 * writes the distance to every area on that area's row of the map's list
 * (`li[data-area][data-d]`, lib/attendee-map.ts). This script reads those rows,
 * finds each card's area from the row that links the card's event, and puts the
 * cards nearest first; a card whose area has no distance (an online event, or one
 * with no place on the map) goes last. Until a distance is written the cards keep
 * the order the server sent. Moving the cards makes the pager count again. It
 * makes no request, sets no cookie and stores nothing (tests/area-pager.spec.ts
 * reads this source).
 */
import { cardPagerControls, cardPagerScript } from './card-pager.js';
import type { Lang } from './i18n/languages.js';

export { PAGE_SIZE } from './card-pager.js';

/** The script's own text, exported so a test can read it without parsing HTML. */
export const AREA_PAGER_SCRIPT = String.raw`(function () {
  var list = document.getElementById('area-list');
  var legend = document.querySelector('ol.amap-legend');
  if (!list || !legend || !window.MutationObserver) return;
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
  new MutationObserver(nearest).observe(legend, { subtree: true, attributes: true, attributeFilter: ['data-d'] });
})();`;

/**
 * The button and its status line, placed after the last card, the app's card
 * pager, and the landing's nearest-first script. The button is hidden until the
 * pager finds more than five cards to show.
 */
export function areaPager(lang: Lang): string {
  return `${cardPagerControls({ list: 'area-list', cards: 'article.event-card', testid: 'area-more', statusTestid: 'area-more-status', lang })}${cardPagerScript()}<script>${AREA_PAGER_SCRIPT}</script>`;
}
