/**
 * Stamp passport (owner, 2026-11-28): a walk, market or fair whose stops each
 * stamp a card kept on the visitor's own phone.
 *
 * HOW IT WORKS. An event opts in with the `passport` setting
 * (lib/event-settings.ts). A stop is a booth (OSE-1998). Scanning a stop's code
 * (`/q/:token`) counts the scan as every scan is counted, then lands on the
 * stop's page with `#stamp` in the fragment (handlers/qr-scan.ts). The page
 * script below saves the stop's number in the phone's localStorage and takes
 * the fragment off the address, so a reload or a shared link stamps nothing.
 * The stall list reads the same storage and shows "You have 3 of 8 stamps",
 * a mark on each stamped stop and, when every stop is stamped, the
 * prize-table line.
 *
 * WHAT IS NEVER DONE. The script makes no request of any kind (no fetch, no
 * XMLHttpRequest, no sendBeacon, no image or form), sets no cookie and reads
 * nothing but its own storage key. The Worker never learns which stops one
 * phone has stamped, so nothing can link one visitor's path across stops:
 * organizers keep seeing scans per stop through the floored cells, as before.
 * tests/passport.spec.ts pins every one of these by reading the script.
 *
 * Trade-off, said plainly to organizers in the guide: a stamp kept on a phone
 * can be faked by someone who edits their own browser storage. That is fine
 * for a free reward; a paid prize needs staff to check at the table.
 *
 * Pure: no env, no DB. The words come from the catalog; numbers are filled on
 * the phone.
 */

import { escapeHtml as esc } from './html-escape';
import { passportOnSql } from './event-settings';
import { msg } from './i18n/catalog';
import type { Lang } from './i18n/languages';

/** The storage key for one event's card. Exported for the tests. */
export const PASSPORT_STORAGE_PREFIX = 'ose-passport:';
/** The fragment a stop's code lands with. */
export const STAMP_FRAGMENT = 'stamp';
/** The longest stop number a card keeps (a booth number is at most 20). */
const STOP_MAX = 20;

/** Where a stop's code sends the visitor when the event's passport is on. */
export function stampTarget(origin: string, eventId: string, stopNumber: string): string {
  return (
    `${origin}/events/${encodeURIComponent(eventId)}/booths/` +
    `${encodeURIComponent(stopNumber)}#${STAMP_FRAGMENT}`
  );
}

/**
 * SQL (one column) for the scan's landing: the stop's number when the event's
 * passport is on and the code is a stop's code (not a vote code), else NULL.
 *
 * This is the only place the scan path reads a booth (OSE ADR-034 kept /q
 * apart from booths; the owner's passport, 2026-11-28, changes where a stop's
 * code lands and nothing else). It is a read for the Location header: the
 * scan row, the hourly dedupe and every count are untouched, and no scan row
 * ever carries a booth (tests/event-booths.spec.ts).
 *
 * `pd` and `e` are the aliases of poster_deployments and events in the
 * caller's statement.
 */
export function passportStopSql(pd: string, e: string): string {
  return `CASE WHEN ${passportOnSql(e)} AND COALESCE(${pd}.is_vote_code, 0) = 0 THEN
                (SELECT b.number FROM event_booths b
                  WHERE b.id = ${pd}.booth_id AND b.event_id = ${pd}.event_id AND b.is_active = 1)
              END`;
}

/** The words the script fills in, as data attributes (escaped here). */
function wordsAttrs(lang: Lang): string {
  return (
    ` data-w-count="${esc(msg(lang, 'passport.count'))}"` +
    ` data-w-done="${esc(msg(lang, 'passport.done'))}"` +
    ` data-w-saved="${esc(msg(lang, 'passport.saved'))}"` +
    ` data-w-stamped="${esc(msg(lang, 'passport.stamped'))}"`
  );
}

export interface PassportCardInput {
  eventId: string;
  /** Every stop number in use, in page order. */
  stops: string[];
  /** On a stop's page: that stop's number. On the list: null. */
  stop: string | null;
  lang?: Lang;
}

/**
 * The passport card: a heading, a live status line, the count, the privacy
 * line and a button that clears this phone's card. Without JavaScript it says
 * how to keep stamps and shows no count.
 */
export function renderPassportCard(input: PassportCardInput): string {
  const lang = input.lang ?? 'en';
  const stops = input.stops.filter((s) => s.length > 0 && s.length <= STOP_MAX);
  const status = input.stop ? msg(lang, 'passport.scanHere') : '';
  return `<section class="card bp-gap" data-testid="passport" aria-labelledby="passport-title"
        data-passport-event="${esc(input.eventId)}"
        data-passport-stops="${esc(JSON.stringify(stops))}"${
          input.stop ? ` data-passport-stop="${esc(input.stop)}"` : ''
        }${wordsAttrs(lang)}>
        <h2 class="section-title" id="passport-title" data-testid="passport-title">${esc(msg(lang, 'passport.label'))}</h2>
        <p class="detail-card-main" data-testid="passport-status" aria-live="polite">${esc(status)}</p>
        <p class="detail-card-sub" data-testid="passport-count" hidden></p>
        <noscript><p class="detail-card-sub" data-testid="passport-noscript">${esc(msg(lang, 'passport.noScript'))}</p></noscript>
        <p class="detail-card-sub" data-testid="passport-private">${esc(msg(lang, 'passport.private'))}</p>
        <button type="button" class="btn btn-secondary btn-block bp-gap" data-testid="passport-clear" hidden>${esc(msg(lang, 'passport.clear'))}</button>
      </section>`;
}

/**
 * The page script. Inline (the page's per-request nonce is added by html()).
 * It touches only `localStorage[PASSPORT_STORAGE_PREFIX + eventId]` and the
 * page's own elements, and wraps storage in try/catch: a private window with
 * storage blocked simply shows no count.
 */
export function passportScript(): string {
  return `<script>
(function () {
  var card = document.querySelector('[data-testid="passport"]');
  if (!card) return;
  var eventId = card.getAttribute('data-passport-event') || '';
  var key = '${PASSPORT_STORAGE_PREFIX}' + eventId;
  var stops = [];
  try { stops = JSON.parse(card.getAttribute('data-passport-stops') || '[]'); } catch (e) { stops = []; }
  var stop = card.getAttribute('data-passport-stop');
  function read() {
    try {
      var v = JSON.parse(window.localStorage.getItem(key) || '[]');
      return Array.isArray(v) ? v.filter(function (s) { return stops.indexOf(s) !== -1; }) : [];
    } catch (e) { return []; }
  }
  function write(list) {
    try { window.localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
  }
  var have = read();
  if (stop && stops.indexOf(stop) !== -1 && window.location.hash === '#${STAMP_FRAGMENT}') {
    if (have.indexOf(stop) === -1) { have.push(stop); write(have); }
    card.querySelector('[data-testid="passport-status"]').textContent = card.getAttribute('data-w-saved');
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
  }
  function show() {
    var count = card.querySelector('[data-testid="passport-count"]');
    var done = stops.length > 0 && have.length >= stops.length;
    count.textContent = done ? card.getAttribute('data-w-done')
      : card.getAttribute('data-w-count').replace('{have}', String(have.length)).replace('{total}', String(stops.length));
    count.hidden = false;
    card.setAttribute('data-passport-done', done ? 'yes' : 'no');
    var clear = card.querySelector('[data-testid="passport-clear"]');
    clear.hidden = have.length === 0;
    var marks = document.querySelectorAll('[data-passport-mark]');
    for (var i = 0; i < marks.length; i++) {
      var on = have.indexOf(marks[i].getAttribute('data-passport-mark')) !== -1;
      marks[i].hidden = !on;
      marks[i].textContent = on ? card.getAttribute('data-w-stamped') : '';
    }
  }
  card.querySelector('[data-testid="passport-clear"]').addEventListener('click', function () {
    try { window.localStorage.removeItem(key); } catch (e) {}
    have = [];
    show();
  });
  show();
})();
</script>`;
}

/** The mark beside a stop on the stall list, hidden until the script shows it. */
export function renderPassportMark(stopNumber: string): string {
  return `<span class="detail-card-sub" data-testid="passport-mark" data-passport-mark="${esc(stopNumber)}" hidden></span>`;
}
