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
const AREA_MARK = 'data-testid="landing-area"';
const DOORS_MARK = 'data-testid="landing-doors"';

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    try {
      return await fetchPublic(url.href, { method: 'GET', redirect: 'manual' });
    } catch {
      return null; // a failed read is a reason for its node, never a crash
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
      const res = await publicGet(siteUrl(`/?zip=${encodeURIComponent(zip)}`));
      const page = res && res.status === 200 ? await bodyOf(res) : '';
      const areaAt = page.indexOf(AREA_MARK);
      const doorsAt = page.indexOf(DOORS_MARK);
      if (areaAt < 0 || (doorsAt >= 0 && doorsAt < areaAt))
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
        else if (!redirectsToEvent(await publicGet(qUrl), id)) reasons.push(`qr-broken:${id}`);
      }
      if (qr && !qr.sPath) {
        reasons.push(`no-shortcode:${id}`);
      } else if (qr) {
        const sUrl = siteUrl(qr.sPath);
        if (!sUrl) reasons.push(`bad-path:${id}`);
        else if (!redirectsToEvent(await publicGet(sUrl), id)) {
          reasons.push(`shortlink-broken:${id}`);
        }
      }

      // the event page shows its sponsor strip
      const res = await publicGet(siteUrl(`/events/${encodeURIComponent(id)}`));
      const page = res && res.status === 200 ? await bodyOf(res) : '';
      if (!STRIP_RE.test(page)) reasons.push(`no-sponsor-strip:${id}`);

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
          if (!got || got.status !== 200) reasons.push(`art-broken:${id}`);
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
