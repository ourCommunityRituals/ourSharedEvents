/**
 * Every list of cards in the app, five at a time (owner, 2026-11-22: "For the
 * listed card options fix, apply through the application where there is a list
 * of cards"; the fix itself, 2026-11-21: "Limit to a list of 5. If more than 5
 * returned in the list, then a Click for More button is underneath ... Continue
 * until list is complete ... The list should be ordered in closest to the present
 * location. If there is no location given, then it is the order of the
 * response.").
 *
 * ONE PIECE, EVERY LIST. A page puts `cardPagerControls()` straight after a list
 * and `cardPagerScript()` once anywhere after it. The controls name their list by
 * id and say which of its children are the cards; the one script pages every list
 * that has controls. Pages that use it: the landing and /map (lib/area-pager.ts,
 * which adds nearest first from the map), /events (lib/event-list.ts), the
 * sponsor's home (lib/sponsor-home-render.ts) and a fair's stalls
 * (lib/booth-list-render.ts).
 *
 * FIVE AT A TIME. The cards still showing (a filter may hide some) are counted
 * in page order; the first five show and the rest wait behind `data-paged-out`.
 * "Click for more" shows five more each time and goes away once every card is
 * showing. Keyboard focus moves to the first card it brought in (its link or
 * button, or the card itself when it has neither), and a status
 * line says how many of how many are showing, so a screen reader hears what
 * changed. A change of filter starts again at five. Without the script every
 * card shows, as before: the button is hidden in the markup and only the script
 * shows it.
 *
 * ORDER. This piece never reorders and never reads a position: a list arrives
 * nearest first when the page knows a place (the landing from the map, the
 * sponsor's discovery from the sponsor's own area), and in the server's order
 * when it does not. It makes no request, sets no cookie and stores nothing
 * (tests/card-pager.spec.ts reads this source).
 *
 * The 5 is a page size. It is not the under-5 count floor and has nothing to do
 * with it.
 */
import { escapeHtml } from './html-escape.js';
import { msg } from './i18n/catalog.js';
import { DEFAULT_LANG, type Lang } from './i18n/languages.js';

/** How many cards show at first, and how many more each tap brings. */
export const PAGE_SIZE = 5;

/** The script's own text, exported so a test can read it without parsing HTML. */
export const CARD_PAGER_SCRIPT = String.raw`(function () {
  var STEP = ${PAGE_SIZE};
  var pagers = [];
  function visible(c) { return getComputedStyle(c).display !== 'none'; }
  [].forEach.call(document.querySelectorAll('[data-card-more]'), function (box) {
    if (box.hasAttribute('data-paging')) return;
    var list = document.getElementById(box.getAttribute('data-card-more'));
    var more = box.querySelector('button');
    var status = box.nextElementSibling;
    var pick = box.getAttribute('data-cards');
    if (!list || !more || !pick) return;
    box.setAttribute('data-paging', '');
    var limit = STEP;
    function cards() { return [].slice.call(list.querySelectorAll(pick)); }
    function showing() { return cards().filter(visible); }
    function page() {
      var all = cards(), total = 0;
      all.forEach(function (c) { c.removeAttribute('data-paged-out'); });
      all.forEach(function (c) {
        if (!visible(c)) return;
        total += 1;
        if (total > limit) c.setAttribute('data-paged-out', '');
      });
      // Change only what differs: the controls may sit inside the list they
      // watch, and an unchanged write would wake the watcher again.
      if (box.hidden !== (total <= limit)) box.hidden = total <= limit;
      var says = total > STEP
        ? (status && status.getAttribute('data-says') || '').replace('%n', String(Math.min(limit, total))).replace('%t', String(total))
        : '';
      if (status && status.textContent !== says) status.textContent = says;
    }
    more.addEventListener('click', function () {
      var before = showing().length;
      limit += STEP;
      page();
      var next = showing()[before];
      if (!next) return;
      // The card's own link or button; a card with neither takes focus itself.
      var link = next.matches('a[href],button') ? next : next.querySelector('a[href],button');
      if (!link) { next.setAttribute('tabindex', '-1'); link = next; }
      link.focus();
    });
    // Other scripts move cards or hide them (a filter, a distance); count again after.
    if (window.MutationObserver) {
      new MutationObserver(page).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden'] });
    }
    pagers.push(function () { limit = STEP; page(); });
    page();
  });
  // A filter changed: every list starts again at five.
  document.addEventListener('change', function (e) {
    if (e.target && e.target.type === 'radio') pagers.forEach(function (start) { start(); });
  });
})();`;

/**
 * Only the waiting cards are hidden; the button is full width on a phone, for a
 * thumb, and a 44 px target at least (the hub's `.btn`). Tokens only, no colour
 * of its own.
 */
export const CARD_PAGER_STYLE =
  '<style>[data-paged-out]{display:none!important}.card-more{margin:1rem 0 0}.card-more-status{margin:.5rem 0 0;color:var(--text-muted)}.card-more .btn{width:100%}@media(min-width:480px){.card-more .btn{width:auto;min-width:14rem}}</style>';

export interface CardPagerOptions {
  /** The id of the element that holds the cards. */
  list: string;
  /** Which of its descendants are the cards (a CSS selector). */
  cards: string;
  /** The button's test id. */
  testid: string;
  /** The status line's test id. Defaults to the button's plus `-status`. */
  statusTestid?: string;
  /** The page's language. */
  lang?: Lang;
  /** The status line, with `{n}` and `{total}`. Defaults to "Showing 5 of 12 events." */
  says?: string;
}

/**
 * The button and its status line, placed straight after the list. The button is
 * hidden until the script finds more than five cards to show.
 */
export function cardPagerControls(o: CardPagerOptions): string {
  const lang = o.lang ?? DEFAULT_LANG;
  const says = escapeHtml(
    (o.says ?? msg(lang, 'area.moreShown')).replace('{n}', '%n').replace('{total}', '%t')
  );
  return `<p class="card-more" data-card-more="${escapeHtml(o.list)}" data-cards="${escapeHtml(o.cards)}" hidden><button class="btn btn-secondary" type="button" data-testid="${escapeHtml(o.testid)}">${msg(lang, 'area.more')}</button></p><p class="card-more-status" role="status" aria-live="polite" data-testid="${escapeHtml(o.statusTestid ?? `${o.testid}-status`)}" data-says="${says}"></p>`;
}

/** The style and the script, once per page, after the last list. */
export function cardPagerScript(): string {
  return `${CARD_PAGER_STYLE}<script>${CARD_PAGER_SCRIPT}</script>`;
}
