// GET /api/v2/admin/events/:id/live — the organizer's live view of one event.
//
// Admin-only by construction, exactly like the draft previews: the path sits
// under /api/v2/admin/* (Cloudflare Access at the edge), the router runs
// requireAdmin, and guardAdminObjectScope 404s an id outside the caller's
// brands before this runs.
//
// This handler reads ONE row (the event's title and status) and nothing else.
// Every number on the page comes from the governed event dashboard
// (GET /api/v2/admin/events/:id/dashboard, lib/dashboard-contract.ts), which the
// page fetches and re-fetches every REFRESH_SECONDS. So the privacy classes are
// the contract's, not this page's: poster scans, link taps and check-ins are
// all floored at K=5 (OSE-1656: scans too, as sums of poster-hours) and read
// "held" below it; posters, places and sponsors are counts of things, exact. The note under the tiles names the tiles that came floored,
// read from the data on each refresh, so it never claims a floor a number does
// not have (OSE-1657). A failed refresh keeps the last numbers and says so — never
// zeros. No scan, click, shortlink or audit row is written by looking.
//
// Sponsors do not use this page: their view is the signed sponsor link, which
// reads the same floored numbers (lib/pre-event-activity.ts floorPreEventActivity).

import { html, renderErrorPage } from './pages';
import { escapeHtml } from '../lib/html-escape.js';
import { eventScreenPaths } from '../lib/event-nav';

export interface LiveMonitorEnv {
  DB?: D1Database;
}

/** How often the page re-reads the dashboard. */
export const LIVE_REFRESH_SECONDS = 30;

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

function fail(status: number, title: string, body: string): Response {
  const res = renderErrorPage(status, title, body, '/admin', 'Back to admin');
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

// Tokens only (no raw hex): the page takes both themes from /ui.css.
const STYLE = `
  body{margin:0;font-family:var(--font,system-ui,sans-serif);background:var(--bg);color:var(--text)}
  .lv{max-width:960px;margin:0 auto;padding:1rem}
  .lv-nav{display:flex;flex-wrap:wrap;gap:0 1.25rem}
  .lv-nav a{color:var(--accent);font-weight:600;text-decoration:none;display:inline-flex;align-items:center;min-height:44px}
  .lv h1{font-size:1.75rem;margin:.25rem 0}
  .lv-sub{color:var(--text-muted);margin:0 0 1rem}
  .lv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem}
  .lv-tile{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1rem}
  .lv-tile b{display:block;font-size:2rem;line-height:1.1}
  .lv-tile span{color:var(--text-muted);font-size:.875rem}
  .lv-tile.held{border-style:dashed}
  .lv-tile.held b{color:var(--text-muted);font-size:1.5rem}
  .lv-days{list-style:none;margin:1rem 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:.5rem}
  .lv-days li{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:.5rem .75rem;font-size:.875rem}
  .lv-days b{display:block;font-size:1.125rem}
  .lv-status{margin:1rem 0 0;color:var(--text-muted);font-size:.875rem}
  .lv-status[data-state="stale"]{color:var(--warning,var(--text))}
  .lv h2{font-size:1rem;margin:1.5rem 0 .5rem}
  .lv-note{color:var(--text-muted);font-size:.875rem;margin:1rem 0 0}
`;

function page(id: string, title: string, status: string): string {
  const paths = eventScreenPaths(id);
  const live = status === 'active';
  const publicLinks = live
    ? `<a href="${escapeHtml(paths.event)}" data-testid="live-nav-event">Event page</a>` +
      `<a href="${escapeHtml(paths.poster)}" data-testid="live-nav-poster">Poster</a>` +
      `<a href="${escapeHtml(paths.display)}" data-testid="live-nav-display">TV display</a>`
    : '';
  const sub = live
    ? 'Live now. These totals refresh on their own.'
    : `This event is ${escapeHtml(status)}, not live. Totals so far are shown.`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} — live view</title>
<link rel="stylesheet" href="/ui.css">
<style>${STYLE}</style>
</head>
<body>
<main class="lv" data-testid="live-main" data-event-id="${escapeHtml(id)}" data-refresh="${LIVE_REFRESH_SECONDS}">
  <nav class="lv-nav" aria-label="This event" data-testid="live-nav">
    <a href="/admin" data-testid="live-nav-admin">&larr; Admin</a>${publicLinks}
  </nav>
  <h1 data-testid="live-title">${escapeHtml(title)}</h1>
  <p class="lv-sub" data-testid="live-sub">${sub}</p>

  <div class="lv-grid" data-testid="live-tiles">
    <div class="lv-tile" data-metric="scans"><b data-testid="live-scans">&hellip;</b><span>Poster scans</span></div>
    <div class="lv-tile" data-metric="clicks"><b data-testid="live-taps">&hellip;</b><span>Link taps</span></div>
    <div class="lv-tile" data-metric="checkins"><b data-testid="live-checkins">&hellip;</b><span>Check-ins</span></div>
    <div class="lv-tile" data-metric="posters"><b data-testid="live-posters">&hellip;</b><span>Posters out</span></div>
    <div class="lv-tile" data-metric="places"><b data-testid="live-places">&hellip;</b><span>Neighbourhoods covered</span></div>
    <div class="lv-tile" data-metric="sponsors"><b data-testid="live-sponsors">&hellip;</b><span>Sponsors on show</span></div>
  </div>

  <h2 id="lv-days-h">Poster scans, day by day</h2>
  <ol class="lv-days" aria-labelledby="lv-days-h" data-testid="live-days"></ol>

  <p class="lv-status" role="status" aria-live="polite" data-testid="live-status" data-state="loading">Loading the latest totals&hellip;</p>
  <p class="lv-note" data-testid="live-note">Counts only.<span data-testid="live-note-held"></span> Nobody who scanned, tapped or checked in is named, and attendees never see this page.</p>
</main>
<script>
(function () {
  var main = document.querySelector('[data-testid="live-main"]');
  var id = main.getAttribute('data-event-id');
  var every = Number(main.getAttribute('data-refresh')) * 1000;
  var statusEl = document.querySelector('[data-testid="live-status"]');
  var lastGood = null;

  // A floored count is { count, suppressed, floor }; a plain count is a number.
  function show(metric, v) {
    var tile = document.querySelector('[data-metric="' + metric + '"]');
    if (!tile) return;
    var b = tile.querySelector('b');
    var held = v && typeof v === 'object' && v.suppressed === true;
    var n = v && typeof v === 'object' ? v.count : v;
    tile.classList.toggle('held', held);
    b.textContent = held ? 'Held' : (typeof n === 'number' && isFinite(n) ? String(n) : '\\u2014');
    if (held) b.setAttribute('title', 'Fewer than ' + v.floor + ' so far'); else b.removeAttribute('title');
  }

  // A floored count is an object; a day in the list may be one too.
  function isHeld(v) {
    return !!(v && typeof v === 'object' && (v.suppressed === true || v.count === null));
  }

  // The note names exactly the tiles whose number came floored this time.
  var NAMES = { scans: 'poster scans', clicks: 'link taps', checkins: 'check-ins',
    posters: 'posters out', places: 'neighbourhoods covered', sponsors: 'sponsors on show' };
  function noteHeld(values) {
    var held = Object.keys(NAMES).filter(function (k) { return isHeld(values[k]); })
      .map(function (k) { return NAMES[k]; });
    var el = document.querySelector('[data-testid="live-note-held"]');
    if (!held.length) { el.textContent = ''; return; }
    var list = held.length === 1 ? held[0]
      : held.slice(0, -1).join(', ') + ' and ' + held[held.length - 1];
    el.textContent = ' ' + list.charAt(0).toUpperCase() + list.slice(1) +
      ' under 5 read \u201cHeld\u201d.';
  }

  function render(d) {
    var reach = d.reach || {};
    var checkins = d.participation && d.participation.explicit ? d.participation.explicit.checkins : null;
    var sponsors = d.sponsors ? d.sponsors.on_show : null;
    noteHeld({ scans: reach.scans, clicks: reach.clicks, checkins: checkins,
      posters: reach.posters, places: reach.places, sponsors: sponsors });
    show('scans', reach.scans);
    show('clicks', reach.clicks);
    show('posters', reach.posters);
    show('places', reach.places);
    show('checkins', checkins);
    show('sponsors', sponsors);
    var list = document.querySelector('[data-testid="live-days"]');
    list.textContent = '';
    (Array.isArray(reach.scansByDay) ? reach.scansByDay : []).slice(-14).forEach(function (day) {
      var li = document.createElement('li');
      var b = document.createElement('b');
      // A floored day reads Held, never 0 (OSE-1657). The day's count is a
      // floored count itself (OSE-1656), so its own flag is the one to read.
      var c = day ? day.count : null;
      b.textContent = isHeld(day) || isHeld(c)
        ? 'Held'
        : String(Number(c && typeof c === 'object' ? c.count : c) || 0);
      li.appendChild(b);
      li.appendChild(document.createTextNode(String(day.day || '')));
      list.appendChild(li);
    });
  }

  function clock(d) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  async function refresh() {
    try {
      var res = await fetch('/api/v2/admin/events/' + encodeURIComponent(id) + '/dashboard', { cache: 'no-store' });
      var data = await res.json();
      if (!res.ok || !data || data.ok !== true) throw new Error('unavailable');
      render(data);
      lastGood = new Date();
      statusEl.setAttribute('data-state', 'fresh');
      statusEl.textContent = 'Updated ' + clock(lastGood) + '. Refreshes every ' + (every / 1000) + ' seconds.';
    } catch (e) {
      // Never show zeros for an outage: keep the last totals and say so.
      statusEl.setAttribute('data-state', 'stale');
      statusEl.textContent = lastGood
        ? 'Could not refresh just now. Showing the totals from ' + clock(lastGood) + '.'
        : 'Could not load the totals. Trying again shortly.';
    }
  }

  refresh();
  var timer = setInterval(function () { if (!document.hidden) refresh(); }, every);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', function () { clearInterval(timer); });
})();
</script>
</body>
</html>`;
}

export async function handleAdminEventLivePage(
  env: LiveMonitorEnv,
  eventId: string
): Promise<Response> {
  if (!env.DB) {
    return fail(
      503,
      "We're having trouble loading this event",
      'The live view is briefly unavailable. Try again in a minute.'
    );
  }
  if (!eventId || eventId.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(eventId)) {
    return fail(404, "We couldn't find that event", 'This live view link is invalid.');
  }
  let row: { id: string; title: string | null; status: string | null } | null;
  try {
    row = await env.DB.prepare('SELECT id, title, status FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ id: string; title: string | null; status: string | null }>();
  } catch {
    return fail(
      503,
      "We're having trouble loading this event",
      'The live view is briefly unavailable. Try again in a minute.'
    );
  }
  if (!row) {
    return fail(404, "We couldn't find that event", 'This live view no longer points to an event.');
  }
  const res = html(
    page(row.id, row.title || 'Untitled event', (row.status || 'draft').toLowerCase())
  );
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}
