// Checks a day's stock data per node, read back over the full staging site's
// public surfaces. Each node passes or fails on its own; the workflow swaps the
// passing ones and purges today's rows for the failing ones.
//
// Every number comes from the expected count per node (the committed seed,
// seed.mjs expectedByNode) and the day's manifest; none is written here. Events
// the owner made by hand are not in the manifest and never fail a node.
//
// A node expected to hold 0 (Mount Greenwood, owner 2026-11-05) passes when no
// stock event is assigned to it and none is listed in a cell of its own. Its
// landing-map check is skipped.
//
// Owner, 2026-11-06: the totals are the owner's permanent testing totals
// (stock/totals.json), and a place may hold fewer than the map gate (Auburn
// Gresham holds 9). Such a place is checked like any populated one, except that
// its landing-map check is skipped, since its zip view does not lead with the map.
import { STOCK_BASE_URL } from './client.mjs';

// The landing page leads with the map at this many events (landing-area.ts LIST_MAX).
export const MAP_GATE = 10;
const WINDOW_DAYS = 90;
// Same spacing as the admin client: at most 5 public reads per second.
const MIN_GAP_MS = 200;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STRIP_RE = /data-testid="(?:pre|live)-sponsor-strip"/;
// A sponsor's thumbnail art on the event page (pages.ts renderSponsorItem).
const THUMB_SRC_RE = /data-testid="sponsor-thumb" src="([^"]+)"/g;
const AREA_MARK = 'data-testid="landing-area"';
const DOORS_MARK = 'data-testid="landing-doors"';

// The Cloudflare edge answers a challenged read itself (cf-mitigated: challenge,
// a 403 "Just a moment..." page) and the Worker never runs. stg challenges a
// non-browser read of /q/, /s/ and /events/<id> unless the WAF skip rule for
// X-OCR-CI lets it through (OSE-939). Such a read is named as the edge, never as
// a broken QR, link or page (run 42359815222, 2026-11-07).
export function edgeChallenged(res) {
  const h = res && res.headers;
  if (!h || typeof h.get !== 'function') return false;
  return (
    String(h.get('cf-mitigated') || '')
      .trim()
      .toLowerCase() === 'challenge'
  );
}

// A Cloudflare Ray ID (hex, then the data centre): the key to the request in the
// dashboard's Security Events, which names the rule that challenged it. It comes
// from a response header, so only a ray-shaped value is written into the summary.
const RAY_RE = /^[0-9a-f]{16}-[A-Z]{3}$/i;

/** `edge-challenged:<what>`, with ` ray=<id>` when the edge sent a usable Ray ID. */
export function edgeReason(res, what) {
  const h = res && res.headers;
  const ray = h && typeof h.get === 'function' ? String(h.get('cf-ray') || '').trim() : '';
  const base = what ? `edge-challenged:${what}` : 'edge-challenged';
  return RAY_RE.test(ray) ? `${base} ray=${ray}` : base;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every public read has a deadline (CCR 2026-11-07 R-11): a read that never
// answers fails its node as read-timeout, and the run never hangs on it.
export const READ_TIMEOUT_MS = 20_000;

// Owner decision 2A (2026-11-07): a read the harness could not make is
// "unverified", not a broken page. A node whose only reasons are these keeps its
// load and turns the run red; any other reason fails it as before.
const UNVERIFIED_RE = /^(?:edge-challenged|d1-busy)(?::|\s|$)/;

/** True for a failed result whose every reason is an edge challenge or a busy database. */
export function isUnverified(result) {
  const reasons = result && Array.isArray(result.reasons) ? result.reasons : [];
  return (
    Boolean(result) &&
    result.pass !== true &&
    reasons.length > 0 &&
    reasons.every((r) => UNVERIFIED_RE.test(String(r)))
  );
}

// A read that hit its deadline: no status, no headers.
const TIMED_OUT = Object.freeze({ timedOut: true, status: 0, headers: null });

/** read-timeout:<what> or the edge reason for a read the harness could not make, else null. */
function readFault(res, what) {
  if (res && res.timedOut) return what ? `read-timeout:${what}` : 'read-timeout';
  if (edgeChallenged(res)) return edgeReason(res, what);
  return null;
}

const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

function inWindow(startDate, today) {
  if (typeof startDate !== 'string' || !DAY_RE.test(startDate)) return false;
  const offset = dayNumber(startDate) - dayNumber(today);
  return offset >= 0 && offset <= WINDOW_DAYS;
}

/**
 * @returns {Promise<Record<string, { pass: boolean, count: number, expected: number,
 *   totalListed: number, reasons: string[] }>>}
 */
export async function checkNodes({
  client,
  manifest,
  nodes,
  today,
  // node id -> the number of stock events it must list (0 for an empty node)
  expected,
  // Public reads: called as fetchPublic(url, { method: 'GET', redirect: 'manual' }),
  // never with an admin header. The caller adds whatever the host's Access gate needs.
  fetchPublic,
  sleep = realSleep,
  now = Date.now,
  readTimeoutMs = READ_TIMEOUT_MS,
}) {
  if (!DAY_RE.test(String(today))) throw new Error('today must be YYYY-MM-DD');
  if (typeof fetchPublic !== 'function') throw new Error('fetchPublic is required');
  const nodeList = Array.isArray(nodes) ? nodes : nodes && nodes.nodes;
  if (!Array.isArray(nodeList)) throw new Error('nodes must be a list');
  if (!expected || typeof expected !== 'object') throw new Error('expected counts are required');
  for (const n of nodeList) {
    const want = expected[n.id];
    if (!Number.isInteger(want) || want < 0) throw new Error(`no expected count for ${n.id}`);
  }
  // The cells of every populated node. A border cell an empty node shares with
  // one of them holds that neighbor's events (membership is by polygon).
  const populatedCells = new Set(
    nodeList.filter((n) => expected[n.id] > 0).flatMap((n) => n.cells)
  );

  const origin = new URL(STOCK_BASE_URL).origin;
  // A path on this site, or null. The path must start with '/' and resolve to this
  // origin: `${origin}.evil.example/x` would otherwise send the read (and whatever
  // headers the caller's fetchPublic adds) to another host.
  function siteUrl(p) {
    if (typeof p !== 'string' || !p.startsWith('/')) return null;
    let url;
    try {
      url = new URL(p, origin);
    } catch {
      return null;
    }
    return url.origin === origin ? url : null;
  }

  let lastAt = null;
  // Takes only a URL that siteUrl (or the same-origin check) has already passed.
  async function publicGet(url) {
    if (!(url instanceof URL) || url.origin !== origin) return null;
    if (lastAt !== null) {
      const wait = MIN_GAP_MS - (now() - lastAt);
      if (wait > 0) await sleep(wait);
    }
    lastAt = now();
    const signal = AbortSignal.timeout(readTimeoutMs);
    try {
      return await fetchPublic(url.href, { method: 'GET', redirect: 'manual', signal });
    } catch {
      // a failed read is a reason for its node, never a crash
      return signal.aborted ? TIMED_OUT : null;
    }
  }
  const bodyOf = async (res) => {
    try {
      return await res.text();
    } catch {
      return '';
    }
  };
  // A 302 whose Location is this site's page for the event.
  function redirectsToEvent(res, eventId) {
    if (!res || res.status !== 302) return false;
    const loc = res.headers && res.headers.get && res.headers.get('location');
    if (!loc) return false;
    let target;
    try {
      target = new URL(loc, origin);
    } catch {
      return false;
    }
    return target.origin === origin && target.pathname === `/events/${encodeURIComponent(eventId)}`;
  }

  // The public list, judged in the 90-day window.
  let listed = null;
  try {
    const res = await client.get('/api/v2/events');
    if (res && Array.isArray(res.items)) {
      listed = res.items.filter((e) => e && inWindow(e.start_date, today));
    }
  } catch {
    listed = null;
  }
  const listedById = new Map((listed || []).map((e) => [String(e.id), e]));

  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const qrs = Array.isArray(manifest.qr) ? manifest.qr : [];
  const results = {};

  // Owner 2026-11-10: when the day's events carry art, the build gave every
  // stock sponsor one of those pictures as its logo (build-full.mjs
  // giveSponsorsArt). So each event page's sponsor strip shows art, and each
  // picture loads from this site. A picture is read once per run.
  const stockArt = items.some(
    (i) => i.kind === 'event' && listedById.get(String(i.id))?.cover_image_url
  );
  const artLoads = new Map();
  async function checkSponsorArt(eventId, page, reasons) {
    const srcs = [...page.matchAll(THUMB_SRC_RE)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (srcs.length === 0) {
      reasons.push(`no-sponsor-art:${eventId}`);
      return;
    }
    for (const src of new Set(srcs)) {
      const url = siteUrl(src);
      if (!url) {
        reasons.push(`sponsor-art-off-site:${eventId}`);
        continue;
      }
      if (!artLoads.has(url.href)) {
        const got = await publicGet(url);
        artLoads.set(
          url.href,
          readFault(got, src) || (got && got.status === 200 ? null : 'broken')
        );
      }
      const outcome = artLoads.get(url.href);
      if (outcome === 'broken') reasons.push(`sponsor-art-broken:${eventId}`);
      else if (outcome) reasons.push(outcome);
    }
  }

  const stockIds = items.filter((i) => i.kind === 'event').map((i) => String(i.id));

  for (const node of nodeList) {
    const reasons = [];
    const cells = new Set(node.cells);
    const eventIds = items.filter((i) => i.kind === 'event' && i.node === node.id).map((i) => i.id);
    const want = expected[node.id];

    if (want === 0) {
      const own = new Set(node.cells.filter((c) => !populatedCells.has(c)));
      let count = 0;
      let totalListed = 0;
      for (const id of eventIds) reasons.push(`unexpected-stock:${id}`);
      if (listed === null) {
        reasons.push('events-list-unreadable');
      } else {
        for (const id of stockIds) {
          const e = listedById.get(id);
          if (e && own.has(e.h3_res7)) {
            count += 1;
            reasons.push(`stock-in-empty-node:${id}`);
          }
        }
        totalListed = listed.filter((e) => cells.has(e.h3_res7)).length;
      }
      results[node.id] = {
        pass: reasons.length === 0,
        count,
        expected: 0,
        totalListed,
        reasons,
        skipped: ['landing-map'],
      };
      continue;
    }

    // count: the day's own events for this node, listed in the window, in the node's cells
    let count = 0;
    let totalListed = 0;
    if (listed === null) {
      reasons.push('events-list-unreadable');
    } else {
      for (const id of eventIds) {
        const e = listedById.get(String(id));
        if (!e) reasons.push(`not-listed:${id}`);
        else if (!cells.has(e.h3_res7)) reasons.push(`cell-mismatch:${id}`);
        else count += 1;
      }
      totalListed = listed.filter((e) => cells.has(e.h3_res7)).length;
    }
    if (count !== want) reasons.push(`count:${count}/${want}`);

    if (!items.some((i) => i.kind === 'sponsor' && i.node === node.id && i.tier === 'premium')) {
      reasons.push('no-anchor');
    }

    // the zip view leads with the area, the doors under it (a place under the
    // map gate does not lead with the map, so the check is skipped there)
    const underGate = want < MAP_GATE;
    const zip = Array.isArray(node.zips) ? node.zips[0] : undefined;
    if (!zip) {
      reasons.push('no-zip');
    } else if (!underGate) {
      const zipPath = `/?zip=${encodeURIComponent(zip)}`;
      const res = await publicGet(siteUrl(zipPath));
      const page = res && res.status === 200 ? await bodyOf(res) : '';
      const areaAt = page.indexOf(AREA_MARK);
      const doorsAt = page.indexOf(DOORS_MARK);
      const fault = readFault(res, zipPath);
      if (fault) reasons.push(fault);
      else if (areaAt < 0 || (doorsAt >= 0 && doorsAt < areaAt))
        reasons.push(`zip-not-map-first:${zip}`);
    }

    for (const id of eventIds) {
      // the poster QR and the shortcode both land on this event's page
      const qr = qrs.find((q) => q.eventId === id);
      if (!qr || !qr.qPath) {
        reasons.push(`no-qr:${id}`);
      } else {
        const qUrl = siteUrl(qr.qPath);
        if (!qUrl) reasons.push(`bad-path:${id}`);
        else {
          const got = await publicGet(qUrl);
          const fault = readFault(got, qr.qPath);
          if (fault) reasons.push(fault);
          else if (!redirectsToEvent(got, id)) reasons.push(`qr-broken:${id}`);
        }
      }
      if (qr && !qr.sPath) {
        reasons.push(`no-shortcode:${id}`);
      } else if (qr) {
        const sUrl = siteUrl(qr.sPath);
        if (!sUrl) reasons.push(`bad-path:${id}`);
        else {
          const got = await publicGet(sUrl);
          const fault = readFault(got, qr.sPath);
          if (fault) reasons.push(fault);
          else if (!redirectsToEvent(got, id)) reasons.push(`shortlink-broken:${id}`);
        }
      }

      // the event page shows its sponsor strip
      const eventPath = `/events/${encodeURIComponent(id)}`;
      const res = await publicGet(siteUrl(eventPath));
      const page = res && res.status === 200 ? await bodyOf(res) : '';
      const fault = readFault(res, eventPath);
      if (fault) reasons.push(fault);
      else if (!STRIP_RE.test(page)) reasons.push(`no-sponsor-strip:${id}`);
      else if (stockArt) await checkSponsorArt(id, page, reasons);

      // art, when the event has some, loads from this site
      const art = listedById.get(String(id))?.cover_image_url;
      if (art) {
        let url = null;
        try {
          url = new URL(art, origin);
        } catch {
          url = null;
        }
        if (!url || url.origin !== origin) {
          reasons.push(`art-off-site:${id}`);
        } else {
          const got = await publicGet(url);
          const fault = readFault(got, art);
          if (fault) reasons.push(fault);
          else if (!got || got.status !== 200) reasons.push(`art-broken:${id}`);
        }
      }
    }

    results[node.id] = {
      pass: reasons.length === 0,
      count,
      expected: want,
      totalListed,
      reasons,
      ...(underGate ? { skipped: ['landing-map'] } : {}),
    };
  }
  return results;
}

// ── Searches: what each /events search reads on the site ────────────────────
//
// Owner, 2026-11-07: every zip and town search on stg reads its permanent total
// (stock/totals.json `searches`): the stock events in it plus the declared
// non-stock events (`fixtures.counts`, e.g. CI's test-event-001 in 60643, which
// the Auburn Gresham and Beverly towns include). The count is the page's own
// summary line, so this is exactly what a person or a test sees.

const SUMMARY_RE = /data-testid="disc-summary">(\d+) events? in /;
// A failed read still answers 200, with a zero summary beside this marker
// (handlePublicPage with event-list.ts renderEventListError), so it is checked
// first: an empty place must never pass on an error page.
const PUBLIC_ERROR_MARK = 'data-testid="public-error"';

/**
 * @returns {Promise<Record<string, { pass: boolean, count: number|null,
 *   expected: number, reasons: string[] }>>}
 */
// One card per listed event, with its id (event-list.ts).
const CARD_ID_RE = /data-event-id="([^"]+)"/g;

/**
 * `exclude`: event ids the page may still list that the swap is about to remove
 * (yesterday's load for a passing node, today's for a failing one). The search is
 * judged on what will be left, so it can gate the swap before anything is purged
 * (CCR 2026-11-07 R-09). With ids to exclude, every card must be on the page.
 */
export async function checkSearches({
  searches,
  fetchPublic,
  exclude = new Set(),
  sleep = realSleep,
  now = Date.now,
  readTimeoutMs = READ_TIMEOUT_MS,
}) {
  if (typeof fetchPublic !== 'function') throw new Error('fetchPublic is required');
  if (!searches || typeof searches !== 'object') throw new Error('searches are required');
  const origin = new URL(STOCK_BASE_URL).origin;
  const results = {};
  let lastAt = null;
  for (const [q, expected] of Object.entries(searches)) {
    if (!Number.isInteger(expected) || expected < 0) {
      throw new Error(`no expected count for the search ${q}`);
    }
    if (lastAt !== null) {
      const wait = MIN_GAP_MS - (now() - lastAt);
      if (wait > 0) await sleep(wait);
    }
    lastAt = now();
    const url = new URL(`/events?q=${encodeURIComponent(q)}`, origin);
    let page = '';
    let fault = null;
    const signal = AbortSignal.timeout(readTimeoutMs);
    try {
      const res = await fetchPublic(url.href, { method: 'GET', redirect: 'manual', signal });
      fault = readFault(res, '');
      page = res && res.status === 200 ? await res.text() : '';
    } catch {
      if (signal.aborted) fault = 'read-timeout';
      page = '';
    }
    if (fault) {
      results[q] = { pass: false, count: null, expected, reasons: [fault] };
      continue;
    }
    if (page.includes(PUBLIC_ERROR_MARK)) {
      results[q] = { pass: false, count: null, expected, reasons: ['events-list-error'] };
      continue;
    }
    const m = SUMMARY_RE.exec(page);
    if (!m) {
      results[q] = { pass: false, count: null, expected, reasons: ['summary-unreadable'] };
      continue;
    }
    let count = Number(m[1]);
    if (exclude.size > 0) {
      const ids = [...page.matchAll(CARD_ID_RE)].map((x) => x[1]);
      if (ids.length !== count) {
        results[q] = { pass: false, count: null, expected, reasons: ['cards-unreadable'] };
        continue;
      }
      count -= ids.filter((id) => exclude.has(id)).length;
    }
    results[q] = {
      pass: count === expected,
      count,
      expected,
      reasons: count === expected ? [] : [`count:${count}/${expected}`],
    };
  }
  return results;
}
