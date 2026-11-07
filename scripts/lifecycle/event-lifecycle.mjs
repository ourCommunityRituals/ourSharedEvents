/* eslint-disable security/detect-non-literal-regexp -- builds patterns only from this file's own constant attribute and test-id names */
// The nightly event lifecycle on staging: one synthetic event, created, edited,
// moved out of the window, unpublished and deleted through the real admin API,
// with every public surface read back after each change.
//
// Owner, 2026-11-07: prove that the public content follows the day's creates,
// edits and deletes. The daily stock load replaces staging's seeded events
// wholesale, so on its own it never shows that an edit or a delete reaches the
// landing page, /events or the attendee map.
//
// Staging only (stg.oursharedevents.com). Production is closed and agents never
// treat a deploy as a launch (AGENTS.md), so assertTarget refuses every other
// host. The one exception is a local worker (http://127.0.0.1 or localhost),
// and only when the caller says so and the process is not running in CI.
//
// Never who, only how many: the event is a test event in a place, nobody's.
// It touches DB only (events and their own derived rows); nothing here reaches
// FORMS_DB, and the public reads carry no cookie and set none.
//
// Secrets go in request headers and nowhere else: never in a log line, never in
// a thrown message (errors name the method and the path without its query).

import { latLngToCell } from 'h3-js';
import productionHosts from '../../config/production-hosts.js';

export const STAGING_BASE_URL = 'https://stg.oursharedevents.com';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

// The events this job makes all start with this. The sweep deletes only an event
// that carries all four marks: this title prefix, the root brand, data_class
// 'synthetic' (which only automation may set) and a key creator. A person's
// event never matches, whatever its title.
export const TITLE_PREFIX = 'Nightly lifecycle check';

// The owner's test area (2026-11-07): Oak Lawn 60453, Evergreen Park 60805,
// Blue Island 60406 and Chicago 60620 (Auburn Gresham). Node ids are
// stock/nodes.json; the venue, address and coordinates come from the committed
// seed, so the event sits where the stock events of that town sit.
export const TEST_TOWNS = ['oak-lawn', 'evergreen-park', 'blue-island', 'auburn-gresham'];

// The date window every public surface lists (event-discovery.ts NEXT_90_DAYS,
// landing-area.ts LANDING_WINDOWS, corridor-readiness.ts CORRIDOR_WINDOW_DAYS).
// Owner, 2026-11-07: the landing page and the map are to cover 30 days back as
// well. When that ships, set WINDOW_PAST_DAYS=30 in the workflow and the past
// edges below are checked too; nothing else here changes.
export const DEFAULT_WINDOW = { pastDays: 0, futureDays: 90 };

// Edges are checked a few days in from the boundary, so a Chicago/UTC date
// difference never decides a check.
const EDGE_MARGIN_IN = 2;
const EDGE_MARGIN_OUT = 3;

// The first date and the date after the edit, days from today (Chicago).
export const CREATE_OFFSET_DAYS = 7;
export const EDIT_OFFSET_DAYS = 21;
// Noon Chicago: the UTC date of the start is the local date too.
export const START_TIME = '12:00';
const TZ = 'America/Chicago';

// Public reads at most 4 a second: under the public read limit (60 per 10 s,
// 360 a minute) and the pace of one person (OSE-1509).
const MIN_GAP_MS = 250;
const RETRY_AFTER_CAP_MS = 15_000;

const AREA_CARD = 'area-card';
const LIST_CARD = 'public-event-card';
const PUBLIC_ERROR_MARK = 'data-testid="public-error"';
const WHERE_INPUT_MARK = 'data-testid="where-input"';

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bare = (path) => String(path).split('?')[0];

// ── Target ──────────────────────────────────────────────────────────────────

/**
 * The base URL to use, or a throw. Staging only; a local worker only with
 * allowLocal and never in CI. Production (oursharedevents.com, www., any other
 * host) is always refused.
 */
export function assertTarget(raw, { allowLocal = false, inCi = false } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error('lifecycle: the base URL is not a URL');
  }
  // ADR-021: the one shared rule for production, before anything else.
  if (productionHosts.isProductionUrl(url.href)) {
    throw new Error('lifecycle: ADR-021: refusing production');
  }
  const trimmed = String(raw).replace(/\/+$/, '');
  if (url.origin === STAGING_BASE_URL && trimmed === STAGING_BASE_URL) return STAGING_BASE_URL;
  if (allowLocal && !inCi && url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) {
    if (trimmed !== url.origin) throw new Error('lifecycle: a local base URL is an origin only');
    return url.origin;
  }
  throw new Error(`lifecycle: refusing ${url.host}: this job runs on ${STAGING_BASE_URL} only`);
}

// ── Dates ───────────────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD in Chicago. */
export function chicagoDate(at) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
  return parts;
}

export function addDays(ymd, n) {
  if (!DAY_RE.test(ymd)) throw new Error('addDays: date must be YYYY-MM-DD');
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** A start instant or date, as its Chicago calendar date. */
function localDay(v) {
  const s = typeof v === 'string' ? v : '';
  if (DAY_RE.test(s)) return s;
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : chicagoDate(t);
}

/**
 * The window edges to check, days from today: each just inside (shown) and just
 * outside (not shown). The past edges appear once the window reaches back.
 */
export function windowEdgeCases({ pastDays, futureDays }) {
  if (!Number.isInteger(futureDays) || futureDays <= EDGE_MARGIN_OUT) {
    throw new Error('windowEdgeCases: futureDays must be a whole number above 3');
  }
  if (!Number.isInteger(pastDays) || pastDays < 0) {
    throw new Error('windowEdgeCases: pastDays must be a whole number from 0');
  }
  const cases = [
    {
      name: `${futureDays - EDGE_MARGIN_IN} days ahead`,
      offset: futureDays - EDGE_MARGIN_IN,
      shown: true,
    },
    {
      name: `${futureDays + EDGE_MARGIN_OUT} days ahead`,
      offset: futureDays + EDGE_MARGIN_OUT,
      shown: false,
    },
  ];
  if (pastDays > EDGE_MARGIN_IN) {
    cases.push(
      {
        name: `${pastDays - EDGE_MARGIN_IN} days back`,
        offset: -(pastDays - EDGE_MARGIN_IN),
        shown: true,
      },
      {
        name: `${pastDays + EDGE_MARGIN_OUT} days back`,
        offset: -(pastDays + EDGE_MARGIN_OUT),
        shown: false,
      }
    );
  }
  return cases;
}

// ── Places ──────────────────────────────────────────────────────────────────

/**
 * The test towns as places to put an event: the node's name and zip
 * (stock/nodes.json) and one venue of the committed seed whose address ends with
 * that zip. Throws when a town has none, so a seed change cannot leave the job
 * placing an event nowhere.
 */
export function placesFrom(nodes, seed) {
  const list = Array.isArray(nodes) ? nodes : nodes && nodes.nodes;
  const events = (seed && seed.events) || [];
  return TEST_TOWNS.map((id) => {
    const node = (list || []).find((n) => n.id === id);
    if (!node || !Array.isArray(node.zips) || !node.zips[0]) {
      throw new Error(`placesFrom: no node or zip for ${id}`);
    }
    const zip = node.zips[0];
    const row = events
      .filter(
        (e) =>
          e.node === id &&
          typeof e.address === 'string' &&
          e.address.trim().endsWith(zip) &&
          Number.isFinite(e.lat) &&
          Number.isFinite(e.lng) &&
          typeof e.event_type_id === 'string'
      )
      .sort((a, b) => String(a.venue).localeCompare(String(b.venue)))[0];
    if (!row) throw new Error(`placesFrom: the seed has no venue in ${zip} for ${id}`);
    return {
      node: id,
      town: node.name,
      zip,
      venue: row.venue,
      address: row.address,
      lat: row.lat,
      lon: row.lng,
      eventTypeId: row.event_type_id,
      cell: latLngToCell(row.lat, row.lng, 7),
    };
  });
}

/** Tonight's two towns: the one the event starts in and the one it moves to. */
export function pickTowns(places, ymd) {
  const d = dayNumber(ymd);
  const n = places.length;
  return { from: places[d % n], to: places[(d + 1) % n] };
}

// ── The site ────────────────────────────────────────────────────────────────

/**
 * Admin calls (the key actor) and public reads (no admin header) on one origin.
 * Neither ever follows a redirect: it would carry the Access secret elsewhere.
 */
export function createSite({
  baseUrl,
  adminKey,
  accessClientId = '',
  accessClientSecret = '',
  edgeToken = '',
  fetch: fetchFn = globalThis.fetch,
  sleep = realSleep,
  now = Date.now,
}) {
  if (typeof adminKey !== 'string' || adminKey === '') throw new Error('ADMIN_KEY is not set');
  const origin = new URL(baseUrl).origin;
  const access = {};
  if (accessClientId && accessClientSecret) {
    access['CF-Access-Client-Id'] = accessClientId;
    access['CF-Access-Client-Secret'] = accessClientSecret;
  }

  let lastAt = null;
  async function pace() {
    if (lastAt !== null) {
      const wait = MIN_GAP_MS - (now() - lastAt);
      if (wait > 0) await sleep(wait);
    }
    lastAt = now();
  }

  function siteUrl(path) {
    if (typeof path !== 'string' || !path.startsWith('/'))
      throw new Error('site: a path on the site');
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error('site: a path on the site');
    return url;
  }

  async function send(method, path, init) {
    const url = siteUrl(path);
    for (let tries = 0; ; tries++) {
      await pace();
      let res;
      try {
        res = await fetchFn(url.href, { method, redirect: 'manual', ...init });
      } catch {
        throw new Error(`${method} ${bare(path)} failed: network error`);
      }
      // The public read limit answers 429 with Retry-After: wait, then ask again.
      if (res.status === 429 && tries < 3) {
        const after = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        await sleep(
          Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 10_000, RETRY_AFTER_CAP_MS)
        );
        continue;
      }
      return res;
    }
  }

  async function admin(method, path, body) {
    const headers = { ...access, Authorization: `Bearer ${adminKey}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await send(method, path, {
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  async function read(path) {
    const headers = { ...access };
    if (edgeToken) headers['X-OCR-CI'] = edgeToken;
    const res = await send('GET', path, { headers });
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    const mitigated = String(
      (res.headers && res.headers.get && res.headers.get('cf-mitigated')) || ''
    );
    return { status: res.status, text, challenged: mitigated.trim().toLowerCase() === 'challenge' };
  }

  return { origin, admin, read };
}

// ── Reading the pages ───────────────────────────────────────────────────────

function attr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

/**
 * The event cards a page renders, by event id: { name, classes }. `testid` is
 * area-card on the landing page and public-event-card on /events.
 */
export function cardsOf(html, testid) {
  const cards = new Map();
  const nameId = testid === AREA_CARD ? 'area-card-name' : 'public-event-name';
  const re = /<article\b[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (attr(tag, 'data-testid') !== testid) continue;
    const id = attr(tag, 'data-event-id');
    if (!id) continue;
    const rest = html.slice(m.index, m.index + 4000);
    const n = new RegExp(`data-testid="${nameId}">([^<]*)`).exec(rest);
    cards.set(id, {
      name: n ? n[1].trim() : '',
      classes: new Set(
        String(attr(tag, 'class') || '')
          .split(/\s+/)
          .filter(Boolean)
      ),
    });
  }
  return cards;
}

/** The landing's window on load: the checked window radio (win-<value>). */
export function landingDefaultWindow(html) {
  const re = /<input\b[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (attr(tag, 'name') !== 'win' || !/\schecked\b/.test(tag)) continue;
    const id = attr(tag, 'id') || '';
    if (id.startsWith('win-')) return id.slice(4);
  }
  return null;
}

// ── Checks ──────────────────────────────────────────────────────────────────

/**
 * One public surface, read once: did it answer as a working page, and how does
 * it show the event? { healthy, found, name, shown, detail }. `healthy` needs a
 * 200, no error state and at least one OTHER event, so a page that failed to
 * read its events can never pass a "gone" check.
 */
async function readSurface(site, kind, path, eventId) {
  const got = await site.read(path);
  if (got.challenged) return { healthy: false, detail: `the edge challenged ${bare(path)}` };
  if (got.status !== 200) return { healthy: false, detail: `${bare(path)} answered ${got.status}` };
  if (kind === 'map' || kind === 'api') {
    let json;
    try {
      json = JSON.parse(got.text);
    } catch {
      return { healthy: false, detail: `${bare(path)} is not JSON` };
    }
    const items = Array.isArray(json && json.items) ? json.items : null;
    if (!items) return { healthy: false, detail: `${bare(path)} has no items` };
    const mine = items.find((i) => i && String(i.id) === eventId);
    const others = items.filter((i) => i && String(i.id) !== eventId).length;
    if (others === 0)
      return { healthy: false, detail: `${bare(path)} lists no other event`, found: Boolean(mine) };
    if (!mine) return { healthy: true, found: false, shown: false };
    return {
      healthy: true,
      found: true,
      shown: true,
      name: kind === 'map' ? mine.name : (mine.title ?? mine.name),
      day: localDay(kind === 'map' ? mine.startDateISO : (mine.start_date ?? mine.startDateISO)),
      cell: mine.h3_res7,
    };
  }
  if (got.text.includes(PUBLIC_ERROR_MARK)) {
    return { healthy: false, detail: `${bare(path)} shows its error state` };
  }
  const landing = kind === 'landing';
  const cards = cardsOf(got.text, landing ? AREA_CARD : LIST_CARD);
  const others = [...cards.keys()].filter((id) => id !== eventId).length;
  const mine = cards.get(eventId);
  if (others === 0) {
    return { healthy: false, found: Boolean(mine), detail: `${bare(path)} lists no other event` };
  }
  if (!mine) return { healthy: true, found: false, shown: false };
  let shown = true;
  if (landing) {
    const win = landingDefaultWindow(got.text);
    if (!win)
      return { healthy: false, found: true, detail: 'the landing page has no window on load' };
    // A card outside the window is in the page but hidden (landing-area.ts).
    shown = mine.classes.has(`when-${win}`);
  }
  return { healthy: true, found: true, shown, name: mine.name };
}

/**
 * The checks, with their expectation. `want` is one of:
 *   { shown: true, name?, day?, cell? }  listed and visible, with these values
 *   { shown: false }                      a working page that does not show it
 *                                         (the landing may still carry it hidden)
 *   { absent: true }                      a working page with no trace of it
 */
function judge(r, want) {
  if (!r.healthy)
    return { pass: false, detail: r.detail || 'the page did not answer as a working page' };
  if (want.absent) {
    return r.found ? { pass: false, detail: 'still listed' } : { pass: true, detail: 'not listed' };
  }
  if (want.shown === false) {
    return r.shown
      ? { pass: false, detail: 'still shown' }
      : { pass: true, detail: r.found ? 'listed, hidden by its date' : 'not listed' };
  }
  if (!r.found) return { pass: false, detail: 'not listed' };
  if (!r.shown) return { pass: false, detail: 'listed but hidden by its date' };
  if (want.name !== undefined && r.name !== want.name) {
    return { pass: false, detail: `shows "${r.name}", wanted "${want.name}"` };
  }
  if (want.day !== undefined && r.day !== want.day) {
    return { pass: false, detail: `dated ${r.day || 'nothing'}, wanted ${want.day}` };
  }
  if (want.cell !== undefined && r.cell !== want.cell) {
    return { pass: false, detail: `in cell ${r.cell || 'none'}, wanted ${want.cell}` };
  }
  return { pass: true, detail: 'listed as expected' };
}

/** A recorder for named checks; prints each as it lands. */
export function createReport({ log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const results = [];
  return {
    results,
    group(title) {
      log(`::group::${title}`);
    },
    endGroup() {
      log('::endgroup::');
    },
    record(name, pass, detail) {
      results.push({ name, pass, detail });
      // GitHub annotations: a failure shows on the run page by its name.
      log(pass ? `PASS  ${name}: ${detail}` : `FAIL  ${name}: ${detail}`);
      if (!pass) log(`::error title=${name.replace(/[:,\n]/g, ' ')}::${detail}`);
    },
    failed() {
      return results.filter((r) => !r.pass);
    },
  };
}

/**
 * Poll a surface until it meets `want`, then record the check. Reads repeat for
 * a short while because a change may take a moment to reach every read.
 */
async function expectSurface(ctx, name, kind, path, want) {
  const { site, report, state, attempts, delayMs, sleep } = ctx;
  let verdict = { pass: false, detail: 'not read' };
  for (let i = 1; i <= attempts; i++) {
    let r;
    try {
      r = await readSurface(site, kind, path, state.eventId);
    } catch (err) {
      r = { healthy: false, detail: err.message };
    }
    verdict = judge(r, want);
    if (verdict.pass) break;
    if (i < attempts) await sleep(delayMs);
  }
  report.record(name, verdict.pass, `${path} → ${verdict.detail}`);
  return verdict.pass;
}

async function expectAdmin(ctx, name, promise, wantStatus, extra, onAnswer) {
  let res;
  try {
    res = await promise;
  } catch (err) {
    ctx.report.record(name, false, err.message);
    return null;
  }
  // Called before judging: a create that answered wrongly may still have made
  // a row, and cleanup must know its id.
  if (onAnswer) onAnswer(res);
  const extraFail = res.status === wantStatus && extra ? extra(res.json) : null;
  const pass = res.status === wantStatus && !extraFail;
  const code = res.json && res.json.code ? ` ${res.json.code}` : '';
  ctx.report.record(
    name,
    pass,
    pass
      ? `answered ${res.status}`
      : extraFail || `answered ${res.status}${code}, wanted ${wantStatus}`
  );
  return pass ? res : null;
}

const q = (v) => encodeURIComponent(v);

/** Where a town's event is looked for: the landing by zip (and by name), /events by name and zip, the map cell. */
function townSurfaces(place, whereSearch) {
  const list = [
    { label: `landing ?zip=${place.zip}`, kind: 'landing', path: `/?zip=${q(place.zip)}` },
    { label: `/events ?q=${place.town}`, kind: 'list', path: `/events?q=${q(place.town)}` },
    { label: `/events ?q=${place.zip}`, kind: 'list', path: `/events?q=${q(place.zip)}` },
    {
      label: `map cell ${place.cell}`,
      kind: 'map',
      path: `/api/v2/events/map?cell=${q(place.cell)}`,
    },
  ];
  // The town-name search on the landing page ships in PR #1118.
  if (whereSearch) {
    list.splice(1, 0, {
      label: `landing ?where=${place.town}`,
      kind: 'landing',
      path: `/?where=${q(place.town)}`,
    });
  }
  return list;
}

const SITEWIDE = [
  { label: 'landing /', kind: 'landing', path: '/' },
  { label: '/events', kind: 'list', path: '/events' },
  { label: 'public API /api/v2/events', kind: 'api', path: '/api/v2/events' },
];

async function expectEverywhere(ctx, step, place, want, { mapWant, apiWant } = {}) {
  const surfaces = [...SITEWIDE, ...townSurfaces(place, ctx.whereSearch)];
  for (const s of surfaces) {
    let w = want;
    if (s.kind === 'map' && mapWant) w = mapWant;
    if (s.kind === 'api' && apiWant) w = apiWant;
    if (w === null) continue;
    await expectSurface(ctx, `${step}: ${s.label}`, s.kind, s.path, w);
  }
}

/** The event page by its id: 200 with the title, or 404 once it is deleted. */
async function expectEventPage(ctx, name, wantStatus, title) {
  const { site, report, state, attempts, delayMs, sleep } = ctx;
  const path = `/events/${q(state.eventId)}`;
  let detail = '';
  let pass = false;
  for (let i = 1; i <= attempts && !pass; i++) {
    let got;
    try {
      got = await site.read(path);
    } catch (err) {
      got = { status: 0, text: '', challenged: false, error: err.message };
    }
    if (got.challenged) detail = 'the edge challenged the read (X-OCR-CI, OSE-939)';
    else if (got.status !== wantStatus)
      detail = `answered ${got.status || got.error}, wanted ${wantStatus}`;
    else if (title && !got.text.includes(title))
      detail = `answered ${got.status} without "${title}"`;
    else {
      pass = true;
      detail = `answered ${got.status}`;
    }
    if (!pass && i < attempts) await sleep(delayMs);
  }
  report.record(name, pass, `${path} → ${detail}`);
}

// ── The steps ───────────────────────────────────────────────────────────────

function eventBody(place) {
  return {
    location: place.venue,
    where_address: place.address,
    lat: place.lat,
    lon: place.lon,
  };
}

/**
 * True only for an event this job made. The admin list's ?mine=1 is a no-op for
 * a key actor (events.ts handleAdminListEvents), so ownership is decided here,
 * from the row itself, never from the filter.
 */
export function isLifecycleEvent(e) {
  return Boolean(
    e &&
    e.brand_id === 'root' &&
    typeof e.title === 'string' &&
    e.title.startsWith(TITLE_PREFIX) &&
    e.data_class === 'synthetic' &&
    typeof e.created_by === 'string' &&
    e.created_by.startsWith('key:')
  );
}

/** Delete every leftover event this job made (isLifecycleEvent). */
export async function sweep(ctx, { keep = null } = {}) {
  const { site, report } = ctx;
  const own = await listOwnEvents(site);
  if (!own.items) {
    report.record("sweep: list the job's own events", false, own.detail);
    return false;
  }
  const found = own.items
    .filter((e) => isLifecycleEvent(e) && String(e.id) !== keep)
    .map((e) => String(e.id));
  let ok = true;
  for (const id of found) {
    if (!(await removeEvent(ctx, id))) ok = false;
  }
  report.record(
    'sweep: no lifecycle event is left on the site',
    ok,
    found.length === 0
      ? 'none found'
      : `${found.length} left from an earlier run, ${ok ? 'deleted' : 'NOT all deleted'}`
  );
  return ok;
}

/**
 * The admin list, every page, or { detail } when it cannot be read. For a key
 * actor ?mine=1 filters nothing, so this is every event the key may see; callers
 * pick rows by id or with isLifecycleEvent.
 */
async function listOwnEvents(site) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const qs = `?mine=1&limit=100${cursor ? `&cursor=${q(cursor)}` : ''}`;
    const res = await site.admin('GET', `/api/v2/admin/events${qs}`);
    if (res.status !== 200 || !res.json || !Array.isArray(res.json.items)) {
      return { items: null, detail: `the admin list answered ${res.status}` };
    }
    items.push(...res.json.items);
    const p = res.json.pagination || {};
    if (!p.hasMore || !p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return { items };
}

/**
 * Take an event off the map, then delete it. True once it is gone, which a
 * second DELETE confirms with a 404: a 200 alone is not proof.
 */
async function removeEvent(ctx, id) {
  const { site } = ctx;
  const path = `/api/v2/admin/events/${q(id)}`;
  await site.admin('PUT', path, { is_published: false });
  const del = await site.admin('DELETE', path);
  if (del.status !== 200 && del.status !== 404) return false;
  const again = await site.admin('DELETE', path);
  return again.status === 404;
}

export async function stepCreate(ctx) {
  const { site, report, state } = ctx;
  const place = state.from;
  report.group(`Step 1: create and publish "${state.title}" in ${place.town} (${place.zip})`);
  try {
    // The town-name search must be checked as soon as it is live on stg.
    if (!ctx.whereSearch) {
      const home = await site.read('/');
      const live = home.status === 200 && home.text.includes(WHERE_INPUT_MARK);
      report.record(
        'create: the landing town search is off here, and off on the site',
        !live,
        live
          ? 'stg now has the town search (PR #1118): set LANDING_WHERE_SEARCH to on in the workflow'
          : 'checked by zip only until PR #1118 is on main'
      );
    }
    const res = await expectAdmin(
      ctx,
      'create: the admin API creates the event live and synthetic',
      site.admin('POST', '/api/v2/admin/events', {
        brand_id: 'root',
        status: 'active',
        is_published: true,
        data_class: 'synthetic',
        title: state.title,
        description:
          'A test event the nightly staging job makes and deletes. Testing purposes only.',
        event_type_id: place.eventTypeId,
        start_date: state.createDate,
        start_time: START_TIME,
        timezone: TZ,
        ...eventBody(place),
      }),
      201,
      (json) =>
        !json || typeof json.id !== 'string'
          ? 'no event id in the answer'
          : json.data_class !== 'synthetic'
            ? `labelled ${json.data_class ?? 'nothing'}, wanted synthetic`
            : null,
      (answer) => {
        if (answer.json && typeof answer.json.id === 'string') {
          state.eventId = answer.json.id;
          ctx.save();
        }
      }
    );
    if (!res) return;
    // The label as stored, not only as answered: the dashboards read the row.
    const own = await listOwnEvents(site);
    const row = own.items && own.items.find((e) => e && String(e.id) === state.eventId);
    report.record(
      'create: the admin list stores it as synthetic',
      Boolean(row) && row.data_class === 'synthetic',
      !own.items
        ? own.detail
        : !row
          ? 'not in the admin list'
          : `stored as ${row.data_class ?? 'nothing'}`
    );
    const want = { shown: true, name: state.title };
    await expectEverywhere(ctx, 'create', place, want, {
      mapWant: { shown: true, name: state.title, day: state.createDate },
      apiWant: { shown: true, name: state.title, day: state.createDate, cell: place.cell },
    });
    await expectEventPage(ctx, 'create: the event page shows it', 200, state.title);
  } finally {
    report.endGroup();
  }
}

export async function stepEdit(ctx) {
  const { site, report, state } = ctx;
  const from = state.from;
  const to = state.to;
  report.group(`Step 2: edit: retitle, move to ${state.editDate}, move to ${to.town} (${to.zip})`);
  try {
    if (!state.eventId) {
      report.record('edit: there is an event to edit', false, 'step 1 made none');
      return;
    }
    const ok = await expectAdmin(
      ctx,
      'edit: the admin API saves the new title, date and place',
      site.admin('PUT', `/api/v2/admin/events/${q(state.eventId)}`, {
        title: state.newTitle,
        start_date: state.editDate,
        ...eventBody(to),
      }),
      200
    );
    if (!ok) return;
    state.title = state.newTitle;
    ctx.save();
    const want = { shown: true, name: state.newTitle };
    await expectEverywhere(ctx, 'edit', to, want, {
      mapWant: { shown: true, name: state.newTitle, day: state.editDate },
      apiWant: { shown: true, name: state.newTitle, day: state.editDate, cell: to.cell },
    });
    // The old town no longer lists it.
    for (const s of townSurfaces(from, ctx.whereSearch)) {
      await expectSurface(ctx, `edit: old town ${s.label}`, s.kind, s.path, { absent: true });
    }
    await expectEventPage(ctx, 'edit: the event page shows the new title', 200, state.newTitle);
  } finally {
    report.endGroup();
  }
}

export async function stepWindow(ctx) {
  const { site, report, state } = ctx;
  const place = state.to;
  report.group('Step 3: move the date across the window edges');
  try {
    if (!state.eventId) {
      report.record('window: there is an event to move', false, 'step 1 made none');
      return;
    }
    for (const edge of windowEdgeCases(ctx.window)) {
      const day = addDays(state.today, edge.offset);
      const ok = await expectAdmin(
        ctx,
        `window ${edge.name}: the admin API moves it to ${day}`,
        site.admin('PUT', `/api/v2/admin/events/${q(state.eventId)}`, { start_date: day }),
        200
      );
      if (!ok) continue;
      const tag = `window ${edge.name}`;
      const shown = edge.shown ? { shown: true, name: state.title } : { shown: false };
      await expectSurface(ctx, `${tag}: landing /`, 'landing', '/', shown);
      await expectSurface(
        ctx,
        `${tag}: landing ?zip=${place.zip}`,
        'landing',
        `/?zip=${q(place.zip)}`,
        shown
      );
      if (ctx.whereSearch) {
        await expectSurface(
          ctx,
          `${tag}: landing ?where=${place.town}`,
          'landing',
          `/?where=${q(place.town)}`,
          shown
        );
      }
      await expectSurface(
        ctx,
        `${tag}: map cell ${place.cell}`,
        'map',
        `/api/v2/events/map?cell=${q(place.cell)}`,
        edge.shown ? { shown: true, name: state.title, day } : { absent: true }
      );
      if (edge.offset > 0) {
        await expectSurface(
          ctx,
          `${tag}: /events ?when=next-90`,
          'list',
          '/events?when=next-90',
          edge.shown ? { shown: true, name: state.title } : { absent: true }
        );
      }
      // /events lists every date: the event is still there, only out of the window.
      await expectSurface(ctx, `${tag}: /events still lists it`, 'list', '/events', {
        shown: true,
        name: state.title,
      });
    }
  } finally {
    report.endGroup();
  }
}

export async function stepRemove(ctx) {
  const { site, report, state } = ctx;
  const place = state.to;
  report.group('Step 4: unpublish, then delete');
  try {
    if (!state.eventId) {
      report.record('remove: there is an event to remove', false, 'step 1 made none');
      return;
    }
    // Back inside the window first, so what takes it off each surface is the
    // unpublish and not its date.
    const back = await expectAdmin(
      ctx,
      `remove: the admin API moves it back to ${state.editDate}`,
      site.admin('PUT', `/api/v2/admin/events/${q(state.eventId)}`, { start_date: state.editDate }),
      200
    );
    if (!back) return;
    await expectSurface(ctx, 'remove: back in the window on landing /', 'landing', '/', {
      shown: true,
      name: state.title,
    });
    await expectSurface(
      ctx,
      `remove: back in the window on map cell ${place.cell}`,
      'map',
      `/api/v2/events/map?cell=${q(place.cell)}`,
      { shown: true, name: state.title }
    );

    const off = await expectAdmin(
      ctx,
      'unpublish: the admin API takes it off the map',
      site.admin('PUT', `/api/v2/admin/events/${q(state.eventId)}`, { is_published: false }),
      200
    );
    if (off) await expectEverywhere(ctx, 'unpublish', place, { absent: true });

    const del = await expectAdmin(
      ctx,
      'delete: the admin API deletes it',
      site.admin('DELETE', `/api/v2/admin/events/${q(state.eventId)}`),
      200
    );
    if (!del) return;
    const gone = await expectAdmin(
      ctx,
      'delete: the admin API no longer knows it',
      site.admin('DELETE', `/api/v2/admin/events/${q(state.eventId)}`),
      404
    );
    // Only a confirmed 404 counts as deleted; otherwise cleanup tries again.
    if (gone) {
      state.deleted = true;
      ctx.save();
    }
    await expectEverywhere(ctx, 'delete', place, { absent: true });
    await expectEventPage(ctx, 'delete: the event page is gone', 404);
  } finally {
    report.endGroup();
  }
}

/** Always runs: delete the run's event if it is still there, then sweep. */
export async function stepCleanup(ctx) {
  const { report, state } = ctx;
  report.group('Step 5: clean up');
  try {
    if (state.eventId && !state.deleted) {
      const gone = await removeEvent(ctx, state.eventId);
      report.record(
        "cleanup: the run's event is deleted",
        gone,
        gone ? state.eventId : `${state.eventId} is still there`
      );
      if (gone) {
        state.deleted = true;
        ctx.save();
      }
    } else {
      report.record(
        "cleanup: the run's event is deleted",
        true,
        state.eventId ? 'deleted in step 4' : 'none was made'
      );
    }
    await sweep(ctx);
  } finally {
    report.endGroup();
  }
}

export const STEPS = {
  sweep: async (ctx) => {
    ctx.report.group('Step 0: sweep leftovers from earlier runs');
    try {
      await sweep(ctx);
    } finally {
      ctx.report.endGroup();
    }
  },
  create: stepCreate,
  edit: stepEdit,
  window: stepWindow,
  remove: stepRemove,
  cleanup: stepCleanup,
};

/** The run's plan: the towns, titles and dates, fixed at the start. */
export function planRun({ places, today, runTag }) {
  if (!/^[A-Za-z0-9-]{1,40}$/.test(String(runTag)))
    throw new Error('planRun: runTag must be letters, digits and hyphens');
  const { from, to } = pickTowns(places, today);
  return {
    runTag: String(runTag),
    today,
    from,
    to,
    title: `${TITLE_PREFIX} ${runTag}`,
    newTitle: `${TITLE_PREFIX} ${runTag} edited`,
    createDate: addDays(today, CREATE_OFFSET_DAYS),
    editDate: addDays(today, EDIT_OFFSET_DAYS),
    eventId: null,
    deleted: false,
  };
}
