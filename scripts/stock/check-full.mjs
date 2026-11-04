// Checks a day's stock data per node, read back over the full staging site's
// public surfaces. Each node passes or fails on its own; the workflow swaps the
// passing ones and purges today's rows for the failing ones.
//
// Every number comes from `targets.perNode` and the day's manifest; none is
// written here. Events the owner made by hand are not in the manifest and never
// fail a node.
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
  targets,
  // Public reads: called as fetchPublic(url, { method: 'GET', redirect: 'manual' }),
  // never with an admin header. The caller adds whatever the host's Access gate needs.
  fetchPublic,
  sleep = realSleep,
  now = Date.now,
}) {
  const perNode = targets && targets.perNode;
  if (!Number.isInteger(perNode) || perNode < MAP_GATE) {
    throw new Error(`perNode below the map gate of ${MAP_GATE}`);
  }
  if (!DAY_RE.test(String(today))) throw new Error('today must be YYYY-MM-DD');
  if (typeof fetchPublic !== 'function') throw new Error('fetchPublic is required');
  const nodeList = Array.isArray(nodes) ? nodes : nodes && nodes.nodes;
  if (!Array.isArray(nodeList)) throw new Error('nodes must be a list');

  const origin = new URL(STOCK_BASE_URL).origin;
  let lastAt = null;
  async function publicGet(pathAndQuery) {
    if (lastAt !== null) {
      const wait = MIN_GAP_MS - (now() - lastAt);
      if (wait > 0) await sleep(wait);
    }
    lastAt = now();
    try {
      return await fetchPublic(`${origin}${pathAndQuery}`, { method: 'GET', redirect: 'manual' });
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

  for (const node of nodeList) {
    const reasons = [];
    const cells = new Set(node.cells);
    const eventIds = items.filter((i) => i.kind === 'event' && i.node === node.id).map((i) => i.id);

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
    if (count !== perNode) reasons.push(`count:${count}/${perNode}`);

    if (!items.some((i) => i.kind === 'sponsor' && i.node === node.id && i.tier === 'premium')) {
      reasons.push('no-anchor');
    }

    // the zip view leads with the area, the doors under it
    const zip = Array.isArray(node.zips) ? node.zips[0] : undefined;
    if (!zip) {
      reasons.push('no-zip');
    } else {
      const res = await publicGet(`/?zip=${encodeURIComponent(zip)}`);
      const page = res && res.status === 200 ? await bodyOf(res) : '';
      const areaAt = page.indexOf(AREA_MARK);
      const doorsAt = page.indexOf(DOORS_MARK);
      if (areaAt < 0 || (doorsAt >= 0 && doorsAt < areaAt))
        reasons.push(`zip-not-map-first:${zip}`);
    }

    for (const id of eventIds) {
      // the poster QR and the shortcode both land on this event's page
      const qr = qrs.find((q) => q.eventId === id);
      if (!qr) {
        reasons.push(`no-qr:${id}`);
      } else {
        if (!redirectsToEvent(await publicGet(qr.qPath), id)) reasons.push(`qr-broken:${id}`);
        if (!qr.sPath) reasons.push(`no-shortcode:${id}`);
        else if (!redirectsToEvent(await publicGet(qr.sPath), id)) {
          reasons.push(`shortlink-broken:${id}`);
        }
      }

      // the event page shows its sponsor strip
      const res = await publicGet(`/events/${encodeURIComponent(id)}`);
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
          const got = await publicGet(`${url.pathname}${url.search}`);
          if (!got || got.status !== 200) reasons.push(`art-broken:${id}`);
        }
      }
    }

    results[node.id] = {
      pass: reasons.length === 0,
      count,
      expected: perNode,
      totalListed,
      reasons,
    };
  }
  return results;
}
