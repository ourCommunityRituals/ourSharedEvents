/**
 * Pure render for the voter page, GET /events/:id/vote (OSE-2129, S4b of
 * OSE-1193; OSE ADR-040 decisions 5, 6 and 9).
 *
 * The room screen shows the event's vote code; `/q` sends the phone here with
 * the vote pass in the fragment (`#t=…`). The page is phone first, for people
 * aged 55 to 75: one column, big buttons, plain words.
 *
 * Top to bottom:
 *   1. the event's title and date;
 *   2. the sponsor strip, when sponsors are on show (AGENTS.md invariant 6);
 *   3. one <h1>, "Vote";
 *   4. the night's result, once the set is final (vote-public-result.ts);
 *   5. the songs open now, each with an Up and a Not for me button (the
 *      script fills these from GET /api/v2/vote/:id/objects);
 *   6. what the vote is: anonymous, one vote on each, and the house rule with
 *      the ten risks of decision 9.
 *
 * THE PASS STAYS IN MEMORY. The script reads the fragment, takes it out of the
 * address bar with `history.replaceState` before anything else runs, and keeps
 * the pass in a closure. It writes no cookie and uses no storage API, sends the
 * pass only in a POST body, and sends no cookie with its requests.
 *
 * NO COUNT, EVER. A vote that counted and a vote already counted get the same
 * answer from the route, and the page shows the same words for both. The page
 * names no number of votes or voters, before or after final.
 *
 * Every stored value goes through the one escaper; the script writes labels
 * with textContent only. Colours come from /ui.css; the page's own CSS is
 * layout only and stays inside the inline budget.
 */

import { escapeHtml as esc } from './html-escape';
import { injectLegalFooter } from './legal-footer';
import { eventPagePath } from './canonical';
import { renderSponsorStrip, type BoothPageSponsor } from './booth-page-render';
import { TOO_CLOSE_WORDS } from './vote-results';
import type { PublicVoteResult } from './vote-public-result';

export interface VotePageInput {
  event: { id: string; title: string; slug: string | null };
  /** The event's date line, already formatted in its own zone. */
  when: string;
  sponsors: BoothPageSponsor[];
  /** VOTING_ENABLED is on (lib/voting-switch.ts). Off, the page says voting is not open. */
  votingOn: boolean;
  /** The night's result, once its set is final; null before then. */
  result: PublicVoteResult | null;
}

/** The words for a page opened with no pass, or one that has run out. */
export const SCAN_AGAIN_WORDS = 'Scan the code on the screen again.';

/** The words for a vote that went in (counted or already counted alike). */
export const VOTE_IN_WORDS = 'Thanks. Your vote is in.';

/**
 * The house rule's ten risks (ADR-040 decision 9), in plain words. A draft for
 * the owner, whose words govern (ADR-040, open wording).
 */
export const HOUSE_RULE_RISKS: readonly string[] = [
  'People working together. A group that knows how each of them voted can sometimes work out how the last person voted, from the result.',
  'More than one browser. Scanning the code with several browsers lets someone vote more than once.',
  'A script. One person with a computer program can cast many votes.',
  'One vote can decide the night. Someone who controls every other vote can sometimes learn how one person voted from the result: up to about two nights in five, and more often over several nights. The winning margin changes each night to make this rare. It cannot make it impossible.',
  'Voting from somewhere else. A photo of the code lets someone vote while voting is open without being in the room.',
  'A shared vote link. Anyone who gets your vote link while it works can vote in your place, once on each song. Please do not send it to anyone.',
  'Saved history. For 30 days, the system keeps a history that could link a scan to a vote by the order things were saved. Only the account owner can see it.',
  'Arrival times. The web host records when each vote arrives. When one song is open, that time names the song. Only the account owner can see it.',
  'Answer speed. A repeat vote may answer a little faster than a new one.',
  'Whether someone voted. The number of voters a winner needs changes each night, so this is rare, but someone who controls every other vote can sometimes tell whether one person voted at all.',
];

/** The page's own CSS: layout only, no colour. Under the 400-character inline budget. */
export const VOTE_PAGE_CSS =
  'main{max-width:560px;margin:0 auto;padding:1rem 16px 3rem;overflow-wrap:anywhere}' +
  '.vp-gap{margin-top:1rem}.vp-title{font-size:1.75rem;line-height:1.2;margin:1.25rem 0 .25rem}' +
  '.vp-list{list-style:none;padding:0}.vp-row{margin-top:1rem}' +
  '.vp-btns{display:flex;flex-wrap:wrap;gap:12px;margin-top:.75rem}' +
  '.vp-btn{min-height:48px;flex:1 1 9rem;font-size:1.125rem}';

/**
 * The page's one script. It runs in <head>, first: the fragment is read and
 * taken out of the address bar before the page draws. The pass lives only in
 * this closure.
 */
export const VOTE_PAGE_SCRIPT = `(function () {
  var pass = '';
  var hash = location.hash || '';
  if (hash.indexOf('#t=') === 0) {
    try { pass = decodeURIComponent(hash.slice(3)); } catch (e) { pass = ''; }
  }
  if (hash) history.replaceState(null, '', location.pathname + location.search);
  if (!/^[A-Za-z0-9._~-]{1,1024}$/.test(pass)) pass = '';

  document.addEventListener('DOMContentLoaded', function () {
    var app = document.getElementById('vote-app');
    if (!app || app.getAttribute('data-voting') !== 'on') return;
    var eventId = app.getAttribute('data-event') || '';
    var hasResult = app.getAttribute('data-result') === '1';
    var list = document.getElementById('vote-list');
    var status = document.getElementById('vote-status');
    var scan = document.getElementById('vote-scan-again');
    var voted = {};
    var busy = false;
    var timer = null;

    function say(text) { status.textContent = text; }
    function clearList() { while (list.firstChild) list.removeChild(list.firstChild); }
    function showScanAgain() {
      clearList();
      pass = '';
      if (timer) { clearInterval(timer); timer = null; }
      scan.hidden = false;
      say('');
    }

    function row(obj, i) {
      var li = document.createElement('li');
      li.className = 'card vp-row';
      li.setAttribute('data-testid', 'vote-object');
      li.setAttribute('data-object', obj.id);
      var name = document.createElement('h2');
      name.className = 'section-title';
      name.id = 'vote-object-' + i;
      name.textContent = obj.label;
      li.appendChild(name);
      if (voted[obj.id]) {
        var done = document.createElement('p');
        done.setAttribute('data-testid', 'vote-done');
        done.textContent = ${JSON.stringify(VOTE_IN_WORDS)};
        li.appendChild(done);
        return li;
      }
      var btns = document.createElement('div');
      btns.className = 'vp-btns';
      [['up', 'Up', 'btn btn-primary vp-btn', 'vote-up'], ['down', 'Not for me', 'btn btn-secondary vp-btn', 'vote-down']].forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = b[2];
        btn.textContent = b[1];
        btn.setAttribute('aria-describedby', name.id);
        btn.setAttribute('data-testid', b[3]);
        btn.addEventListener('click', function () { cast(obj.id, b[0], btns); });
        btns.appendChild(btn);
      });
      li.appendChild(btns);
      return li;
    }

    function draw(objects) {
      clearList();
      objects.forEach(function (obj, i) { list.appendChild(row(obj, i)); });
      if (!objects.length && !hasResult) say('Nothing is open for a vote right now. This page checks again by itself.');
      else if (!objects.length) say('');
    }

    function closed() {
      clearList();
      if (timer) { clearInterval(timer); timer = null; }
      say('Voting is not open right now.');
    }

    function load() {
      if (!pass || busy) return;
      fetch('/api/v2/vote/' + encodeURIComponent(eventId) + '/objects', {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
      }).then(function (res) {
        if (res.status === 404) { closed(); return null; }
        if (!res.ok) return null;
        return res.json();
      }).then(function (body) {
        if (body && Array.isArray(body.objects) && !busy) draw(body.objects);
      }).catch(function () {});
    }

    function cast(objectId, side, btns) {
      if (!pass || busy) return;
      busy = true;
      Array.prototype.forEach.call(btns.querySelectorAll('button'), function (b) { b.disabled = true; });
      say('Sending your vote.');
      fetch('/api/v2/vote/' + encodeURIComponent(eventId), {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_id: objectId, side: side, pass: pass })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          busy = false;
          if (res.status === 200) {
            voted[objectId] = true;
            say(${JSON.stringify(VOTE_IN_WORDS)});
            load();
            return;
          }
          var code = body && body.code;
          if (code === 'VOTE_PASS_INVALID') { showScanAgain(); return; }
          if (res.status === 404) { closed(); return; }
          if (code === 'VOTE_CLOSED') { say('Voting on that one has closed.'); load(); return; }
          say('That did not go through. Please try again.');
          Array.prototype.forEach.call(btns.querySelectorAll('button'), function (b) { b.disabled = false; });
        });
      }).catch(function () {
        busy = false;
        say('We could not reach the vote. Check your connection and try again.');
        Array.prototype.forEach.call(btns.querySelectorAll('button'), function (b) { b.disabled = false; });
      });
    }

    if (!pass) { if (!hasResult) showScanAgain(); return; }
    load();
    timer = setInterval(load, 20000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  });
})();`;

/**
 * The line under a result whose room check found more voters than the room
 * size the host gave (OSE-2234). Only the room check sets it; a burst of scans
 * warns the host only (owner, decision card 2026-11-26, "Room check only,
 * show room size"). It says nothing about how many voted.
 */
export const PADDED_WORDS =
  'More voters took part than the room holds, so this result may be padded.';

/** The room size the host gave at open, shown with the final result (same decision). */
export function roomSizeWords(size: number): string {
  return `Room size the host gave when voting opened: ${size}.`;
}

function renderResult(result: PublicVoteResult | null): string {
  if (!result) return '';
  let body: string;
  if (result.outcome === 'too_close') {
    body = `<p class="detail-card-main" data-testid="vote-result-words">${esc(TOO_CLOSE_WORDS)}</p>`;
  } else if (result.kind === 'object') {
    body = `<p class="detail-card-label">Tonight's winner</p>
        <p class="detail-card-main" data-testid="vote-result-words">${esc(result.label)}</p>`;
  } else {
    body = `<p class="detail-card-label">Tonight's winning team played</p>
        <ul class="vp-list" data-testid="vote-result-team">${result.labels
          .map((l) => `<li class="detail-card-main">${esc(l)}</li>`)
          .join('')}</ul>`;
  }
  // OSE-2234: the room check found more voters than the room holds.
  const padded = result.padded
    ? `
        <p class="sub-line" data-testid="vote-result-padded">${esc(PADDED_WORDS)}</p>`
    : '';
  // The host's room size, so the room can see the number the check used.
  const room =
    result.room_size != null
      ? `
        <p class="sub-line" data-testid="vote-result-room">${esc(roomSizeWords(result.room_size))}</p>`
      : '';
  return `<section class="card vp-gap" aria-labelledby="vote-result-title" data-testid="vote-result" data-outcome="${result.outcome}">
        <h2 class="section-title" id="vote-result-title">The result</h2>
        ${body}${room}${padded}
      </section>`;
}

function renderAbout(): string {
  return `<section class="vp-gap" aria-labelledby="vote-about-title" data-testid="vote-about">
        <h2 class="section-title" id="vote-about-title">About this vote</h2>
        <ul class="vp-list">
          <li class="vp-row" data-testid="vote-anonymous">Your vote is anonymous. Nobody sees who you are or how you voted.</li>
          <li class="vp-row" data-testid="vote-one-each">You get one vote on each song, stall or event. You cannot change it once it is in.</li>
          <li class="vp-row">It is for fun. Vote for what you enjoy.</li>
        </ul>
        <details class="card vp-gap" data-testid="vote-house-rule">
          <summary class="btn btn-secondary btn-block">The house rule: don't be a jag-off</summary>
          <p class="vp-row">This vote runs on trust. It is anonymous, but no vote is perfect. Here is what someone could still do. Please don't.</p>
          <ol data-testid="vote-house-rule-risks">
            ${HOUSE_RULE_RISKS.map((r) => `<li class="vp-row">${esc(r)}</li>`).join('\n            ')}
          </ol>
        </details>
      </section>`;
}

export function renderVotePage(input: VotePageInput): string {
  const { event } = input;
  const eventTitle = esc(event.title);
  const eventPath = eventPagePath(encodeURIComponent(event.id), event.slug);
  const voting = input.votingOn ? 'on' : 'off';

  const closedNote = input.votingOn
    ? ''
    : `<p class="vp-gap" data-testid="vote-off">Voting is not open right now.</p>`;

  const page = `<!DOCTYPE html>
<html lang="en" data-surface="ose-vote">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <meta name="referrer" content="no-referrer" />
    <script>${VOTE_PAGE_SCRIPT}</script>
    <title>Vote · ${eventTitle}</title>
    <link rel="stylesheet" href="/ui.css" />
    <style>${VOTE_PAGE_CSS}</style>
  </head>
  <body>
    <header class="header">
      <a class="btn btn-link" href="/" data-testid="vote-page-home">OurSharedEvents</a>
      <a class="btn btn-link" href="/events" data-testid="vote-page-events">What's on</a>
    </header>
    <main id="main-content" data-testid="vote-page">
      <section data-testid="vote-event" aria-label="The event">
        <p class="detail-card-main" data-testid="vote-event-title">${eventTitle}</p>
        ${input.when ? `<p class="detail-card-sub" data-testid="vote-event-when">${esc(input.when)}</p>` : ''}
      </section>
      ${renderSponsorStrip(input.sponsors)}
      <h1 class="vp-title" id="vote-title" data-testid="vote-title">Vote</h1>
      <div id="vote-app" data-event="${esc(event.id)}" data-voting="${voting}" data-result="${input.result ? '1' : '0'}">
        ${renderResult(input.result)}
        ${closedNote}
        <p class="vp-gap" id="vote-scan-again" data-testid="vote-scan-again" hidden>${esc(SCAN_AGAIN_WORDS)}</p>
        <p class="vp-gap" id="vote-status" role="status" aria-live="polite" data-testid="vote-status"></p>
        <ul class="vp-list" id="vote-list" data-testid="vote-list" aria-labelledby="vote-title"></ul>
      </div>
      ${renderAbout()}
      <a class="btn btn-secondary btn-block vp-gap" href="${esc(eventPath)}" data-testid="vote-event-link">See the event: ${eventTitle}</a>
    </main>
    <!--OCR_LEGAL_FOOTER-->
  </body>
</html>`;
  return injectLegalFooter(page, 'public');
}
