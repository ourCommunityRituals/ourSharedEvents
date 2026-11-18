#!/usr/bin/env node
// The example fair on staging (OSE-2009): one made-up fair with twelve stalls,
// so the stall list (/events/:id/booths), the stall pages and the event page's
// "See the stalls" link can be shown to a person on stg.
//
//   node scripts/ci/example-fair.mjs                      # load, as a draft
//   node scripts/ci/example-fair.mjs --state=open-by-link # load, live by link, off the map
//   node scripts/ci/example-fair.mjs --remove             # delete what load made
//
// In CI the workflow (.github/workflows/stg-example-fair.yml) sets the action and
// the state through EXAMPLE_FAIR_ACTION and EXAMPLE_FAIR_STATE.
//
// What it writes: one event and its stalls, from the committed fixture
// (scripts/ci/example-fair.json), through the real admin API, never by a D1
// write. The event is root brand, data_class 'synthetic' (only automation may
// set it; the dashboards leave it out by default) and never on the map
// (is_published false, chosen, so a later sponsor cannot turn the map on). It
// is found again by its fixed slug, which the create route keeps unique, so a
// second load updates or skips and never makes a second fair.
//
// The two states:
//   draft         the ticket's words. A draft is not public, so the event page,
//                 the stall list and the stall pages all answer 404 by design.
//   open-by-link  live (active) but off the map: the pages open for whoever has
//                 the address, the stall pages send noindex, and no list, map or
//                 search shows it.
//
// What it never touches: any event but the one with this slug that this job's
// marks say it made (root brand, synthetic, an automation creator). If another
// event holds the slug, it stops and changes nothing. The daily stock load
// deletes only rows its manifest names, so it never sees this fair.
//
// Secrets go in request headers and nowhere else: never in a log line, never in
// a thrown message. It prints the event id, the addresses to open and counts.
//
// Staging only. Production is refused first, by the shared rule (ADR-021); any
// other host is refused too. A local worker (http://127.0.0.1 or localhost) is
// allowed only with EXAMPLE_FAIR_ALLOW_LOCAL=1 and never in CI.
//
// Environment:
//   ADMIN_KEY                                   Bearer key for the admin API (required)
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET staging is behind Access (required on stg)
//   OCR_CI_EDGE_TOKEN                           lets the public reads past the stg edge challenge
//   EXAMPLE_FAIR_ACTION                         load | remove (default load)
//   EXAMPLE_FAIR_STATE                          draft | open-by-link (default draft)
//   EXAMPLE_FAIR_BASE_URL, EXAMPLE_FAIR_ALLOW_LOCAL=1   a local worker only, never in CI
/* eslint-disable security/detect-non-literal-fs-filename -- reads the committed fixture and appends to the runner's own summary file */
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import productionHosts from '../../config/production-hosts.js';
import { edgeHeaders } from './edge-read.mjs';

export const STAGING_BASE_URL = 'https://stg.oursharedevents.com';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_PATH = join(ROOT, 'scripts', 'ci', 'example-fair.json');

export const ACTIONS = ['load', 'remove'];
export const STATES = ['draft', 'open-by-link'];
/** The event status each state stores. */
export const STATUS_OF_STATE = { draft: 'draft', 'open-by-link': 'active' };

/**
 * The stall categories, as workers/oursharedevents/src/lib/event-booths.ts
 * BOOTH_CATEGORIES lists them. The unit test reads that file and fails when
 * the two lists part.
 */
export const BOOTH_CATEGORIES = [
  'food',
  'craft',
  'art',
  'books',
  'clothing',
  'services',
  'community',
  'other',
];
export const STALL_COUNT = 12;
export const CATEGORY_COUNT = 4;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const SECRET_NAMES = [
  'ADMIN_KEY',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'OCR_CI_EDGE_TOKEN',
];

// At most 4 calls a second: under the public read limit and the pace of a person.
const MIN_GAP_MS = 250;
const RETRY_AFTER_CAP_MS = 15_000;
// The admin list is read whole to find the fair. 50 pages of 100 is far more
// than stg holds; a list longer than that stops the run rather than risk a
// second fair.
const LIST_PAGE_LIMIT = 50;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bare = (path) => String(path).split('?')[0];
const q = encodeURIComponent;

// ── Target ──────────────────────────────────────────────────────────────────

/**
 * The base URL to use, or a throw. Production first, by the shared rule; then
 * staging only, or a local worker when allowed and not in CI.
 */
export function assertTarget(raw, { allowLocal = false, inCi = false } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error('example-fair: the base URL is not a URL');
  }
  if (productionHosts.isProductionUrl(url.href)) {
    throw new Error('example-fair: ADR-021: refusing production');
  }
  const trimmed = String(raw).replace(/\/+$/, '');
  if (url.origin === STAGING_BASE_URL && trimmed === STAGING_BASE_URL) return STAGING_BASE_URL;
  if (allowLocal && !inCi && url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) {
    if (trimmed !== url.origin) throw new Error('example-fair: a local base URL is an origin only');
    return url.origin;
  }
  throw new Error(`example-fair: staging only (${STAGING_BASE_URL})`);
}

// ── The fixture ─────────────────────────────────────────────────────────────

// The shapes a person's contact takes. A stall's name is its trading name
// (event-booths.ts refuses the first two as well); the fixture holds none of them.
const EMAIL_SHAPED = /\S@\S/;
// Seven digits or more with only spaces, brackets, dots or hyphens between them
// (the same shape as event-booths.ts), read with the separators taken out.
const PHONE_SEPARATORS = /[\s().-]/g;
const phoneShaped = (v) => /\d{7,}/.test(v.replace(PHONE_SEPARATORS, ''));
const WEB_SHAPED =
  /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|edu|gov|io|co|us|info|biz|app|dev|shop|store|site)\b/i;

// Fields that hold digits by design. Each has its own strict format check
// below, so nothing else can hide in them.
const FORMATTED_FIELDS = new Set(['start_date', 'start_time']);

const TOP_KEYS = ['note', 'event', 'stalls'];
const EVENT_KEYS = [
  'title',
  'slug',
  'description',
  'location',
  'attendance_mode',
  'event_type_id',
  'start_date',
  'start_time',
  'timezone',
];
const STALL_KEYS = ['number', 'name', 'category'];

/** Every text in the fixture that looks like an email, a phone number or a web address. */
export function contactShapedTexts(value, path = '') {
  const found = [];
  const visit = (v, p, key) => {
    if (typeof v === 'string') {
      if (FORMATTED_FIELDS.has(key)) return;
      if (EMAIL_SHAPED.test(v)) found.push(`${p}: email-shaped`);
      if (phoneShaped(v)) found.push(`${p}: phone-shaped`);
      if (WEB_SHAPED.test(v)) found.push(`${p}: web-address-shaped`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${p}[${i}]`, key));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) visit(x, p ? `${p}.${k}` : k, k);
    }
  };
  visit(value, path, '');
  return found;
}

function isRealDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const extraKeys = (obj, allowed) => Object.keys(obj).filter((k) => !allowed.includes(k));

/** What is wrong with a fixture; [] when it may be loaded. */
export function fixtureProblems(fx) {
  const out = [];
  if (!fx || typeof fx !== 'object' || Array.isArray(fx)) return ['the fixture is not an object'];
  for (const k of extraKeys(fx, TOP_KEYS)) out.push(`unknown top-level field: ${k}`);
  const ev = fx.event;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
    out.push('event is missing');
  } else {
    for (const k of extraKeys(ev, EVENT_KEYS)) out.push(`unknown event field: ${k}`);
    if (typeof ev.title !== 'string' || !ev.title.trim() || ev.title.length > 200)
      out.push('event.title must be text, 1 to 200 characters');
    if (
      typeof ev.slug !== 'string' ||
      !/^[a-z0-9-]+$/.test(ev.slug) ||
      /^-|-$|--/.test(ev.slug) ||
      ev.slug.length > 100
    )
      out.push('event.slug must be lowercase words joined by hyphens');
    for (const k of ['description', 'location', 'timezone', 'event_type_id']) {
      if (typeof ev[k] !== 'string' || !ev[k].trim()) out.push(`event.${k} must be text`);
    }
    if (ev.attendance_mode !== 'in_person') out.push('event.attendance_mode must be in_person');
    if (typeof ev.start_date !== 'string' || !isRealDate(ev.start_date))
      out.push('event.start_date must be a real YYYY-MM-DD date');
    if (typeof ev.start_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(ev.start_time))
      out.push('event.start_time must be HH:MM');
  }
  const stalls = fx.stalls;
  if (!Array.isArray(stalls)) {
    out.push('stalls must be a list');
  } else {
    if (stalls.length !== STALL_COUNT) out.push(`stalls must hold ${STALL_COUNT} stalls`);
    const numbers = new Set();
    const categories = new Set();
    stalls.forEach((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        out.push(`stalls[${i}] is not an object`);
        return;
      }
      for (const k of extraKeys(s, STALL_KEYS)) out.push(`stalls[${i}]: unknown field ${k}`);
      if (typeof s.number !== 'string' || !/^[A-Z]\d{1,2}$/.test(s.number))
        out.push(`stalls[${i}].number must look like A1`);
      else if (numbers.has(s.number.toLowerCase()))
        out.push(`stalls[${i}].number repeats ${s.number}`);
      else numbers.add(s.number.toLowerCase());
      if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 120)
        out.push(`stalls[${i}].name must be text, 1 to 120 characters`);
      if (!BOOTH_CATEGORIES.includes(s.category))
        out.push(`stalls[${i}].category must be one of the fixed list`);
      else categories.add(s.category);
    });
    if (categories.size !== CATEGORY_COUNT)
      out.push(`stalls must fall in ${CATEGORY_COUNT} categories, not ${categories.size}`);
  }
  for (const hit of contactShapedTexts(fx)) out.push(hit);
  return out;
}

/** The committed fixture, checked. Throws with every problem named. */
export function loadFixture(path = FIXTURE_PATH) {
  const fx = JSON.parse(readFileSync(path, 'utf8'));
  const problems = fixtureProblems(fx);
  if (problems.length > 0) {
    throw new Error(`example-fair: the fixture is refused: ${problems.join('; ')}`);
  }
  return fx;
}

// ── The site ────────────────────────────────────────────────────────────────

/**
 * Admin calls (Bearer key, plus the Access service token) and public reads (no
 * admin header) on one origin. Neither follows a redirect: it would carry the
 * Access secret elsewhere.
 */
export function createClient({
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
  const edge = edgeHeaders({ OCR_CI_EDGE_TOKEN: edgeToken });

  let lastAt = null;
  async function pace() {
    if (lastAt !== null) {
      const wait = MIN_GAP_MS - (now() - lastAt);
      if (wait > 0) await sleep(wait);
    }
    lastAt = now();
  }

  function siteUrl(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('a path on the site');
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error('a path on the site');
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
      if (res.status === 429 && tries < 3) {
        const after = Number(res.headers?.get?.('retry-after'));
        await sleep(Math.min(after > 0 ? after * 1000 : 10_000, RETRY_AFTER_CAP_MS));
        continue;
      }
      return res;
    }
  }

  const headerOf = (res, name) => String(res.headers?.get?.(name) ?? '');

  async function admin(method, path, body) {
    const headers = { ...access, Authorization: `Bearer ${adminKey}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await send(method, path, {
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Access's login page or the edge, not the Worker: say so, never parse it.
    const html = headerOf(res, 'content-type').includes('text/html');
    const edgeAnswered = headerOf(res, 'cf-mitigated').trim() !== '';
    let json = null;
    if (!html) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    // A redirect is Access sending the call to its login, never the admin API.
    const redirected = res.status >= 300 && res.status < 400;
    return { status: res.status, json, reachedWorker: !html && !edgeAnswered && !redirected };
  }

  async function read(path) {
    const res = await send('GET', path, { headers: { ...access, ...edge } });
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    return {
      status: res.status,
      text,
      robots: headerOf(res, 'x-robots-tag'),
      challenged: headerOf(res, 'cf-mitigated').trim() !== '',
    };
  }

  return { origin, admin, read };
}

/** A short reason for a failed admin call: the method, the bare path, the status, the API's code. */
function failure(method, path, res) {
  const code = res && res.json && typeof res.json.code === 'string' ? ` ${res.json.code}` : '';
  const where =
    res && res.reachedWorker === false ? ' (not the Worker: Access or the edge answered)' : '';
  return new Error(
    `${method} ${bare(path)} answered ${res ? res.status : 'nothing'}${code}${where}`
  );
}

async function expectAdmin(client, method, path, body, want) {
  const res = await client.admin(method, path, body);
  const wanted = Array.isArray(want) ? want : [want];
  if (!wanted.includes(res.status) || !res.reachedWorker) throw failure(method, path, res);
  return res;
}

// ── Finding the fair ────────────────────────────────────────────────────────

/**
 * True only for the fair this job made: the fixture's slug, the root brand,
 * labelled synthetic, made by an automation actor (a key or the CI service
 * actor). A person's event never matches, whatever its slug.
 */
export function isExampleFair(e, slug) {
  return Boolean(
    e &&
    e.slug === slug &&
    e.brand_id === 'root' &&
    e.data_class === 'synthetic' &&
    typeof e.created_by === 'string' &&
    (e.created_by.startsWith('key:') || e.created_by.startsWith('svc:'))
  );
}

/** Every admin-list row with this slug, split into this job's and anyone else's. */
export async function findBySlug(client, slug) {
  const mine = [];
  const others = [];
  let cursor = null;
  for (let page = 0; page < LIST_PAGE_LIMIT; page++) {
    const path = `/api/v2/admin/events?limit=100${cursor ? `&cursor=${q(cursor)}` : ''}`;
    const res = await expectAdmin(client, 'GET', path, undefined, 200);
    if (!res.json || !Array.isArray(res.json.items)) throw failure('GET', path, res);
    for (const e of res.json.items) {
      if (!e || e.slug !== slug) continue;
      (isExampleFair(e, slug) ? mine : others).push(e);
    }
    const p = res.json.pagination || {};
    if (!p.hasMore || !p.nextCursor) return { mine, others };
    cursor = p.nextCursor;
  }
  throw new Error(
    `the admin list is longer than ${LIST_PAGE_LIMIT} pages; stopped rather than risk a second fair`
  );
}

// ── Load ────────────────────────────────────────────────────────────────────

/**
 * The status moves from one state to another, through the state machine
 * (domain/event-state.ts VALID_TRANSITIONS): draft and active meet only at ready.
 */
export function statusPath(from, to) {
  if (from === to) return [];
  const paths = {
    'draft>active': ['ready', 'active'],
    'active>draft': ['ready', 'draft'],
    'ready>active': ['active'],
    'ready>draft': ['draft'],
    'archived>active': ['active'],
    'archived>draft': ['draft'],
  };
  const path = paths[`${from}>${to}`];
  if (!path) throw new Error(`no way from ${from} to ${to}`);
  return path;
}

/** The create body: the fixture's event, labelled, root brand, off the map by choice. */
export function createBody(fx, state) {
  const ev = fx.event;
  return {
    brand_id: 'root',
    data_class: 'synthetic',
    status: STATUS_OF_STATE[state],
    is_published: false,
    attendance_mode: ev.attendance_mode,
    title: ev.title,
    slug: ev.slug,
    description: ev.description,
    location: ev.location,
    event_type_id: ev.event_type_id,
    start_date: ev.start_date,
    start_time: ev.start_time,
    timezone: ev.timezone,
  };
}

/** The fields of a found fair that differ from the fixture, as one PUT body; {} when none. */
export function eventDrift(row, fx) {
  const ev = fx.event;
  const patch = {};
  for (const k of ['title', 'description', 'location', 'event_type_id']) {
    if (row[k] !== ev[k]) patch[k] = ev[k];
  }
  if (row.start_date !== ev.start_date || row.timezone !== ev.timezone || !row.starts_at) {
    patch.start_date = ev.start_date;
    patch.start_time = ev.start_time;
    patch.timezone = ev.timezone;
  }
  if (Number(row.is_published) !== 0) patch.is_published = false;
  return patch;
}

/**
 * What to do to the event's stalls so exactly the fixture's are in use: create
 * the missing, change the different (or put back in use), take the rest out of
 * use. Numbers are read in any case, as the column is. Pure.
 */
export function planStalls(existing, wanted) {
  const byNumber = new Map(existing.map((b) => [String(b.number).toLowerCase(), b]));
  const plan = { create: [], update: [], deactivate: [] };
  const wantedNumbers = new Set();
  wanted.forEach((w, sort) => {
    const key = w.number.toLowerCase();
    wantedNumbers.add(key);
    const b = byNumber.get(key);
    if (!b) {
      plan.create.push({ number: w.number, name: w.name, category: w.category, sort });
      return;
    }
    const patch = {};
    if (b.number !== w.number) patch.number = w.number;
    if (b.name !== w.name) patch.name = w.name;
    if (b.category !== w.category) patch.category = w.category;
    if (b.sort !== sort) patch.sort = sort;
    if (b.is_active !== true) patch.is_active = true;
    if (Object.keys(patch).length > 0) plan.update.push({ id: b.id, patch });
  });
  for (const b of existing) {
    if (b.is_active === true && !wantedNumbers.has(String(b.number).toLowerCase())) {
      plan.deactivate.push(b.id);
    }
  }
  return plan;
}

/** The stalls in use match the fixture exactly: number, name and category. */
export function stallsMatch(booths, wanted) {
  const inUse = booths.filter((b) => b.is_active === true);
  if (inUse.length !== wanted.length) return false;
  const key = (b) => `${String(b.number).toLowerCase()}|${b.name}|${b.category}`;
  const have = new Set(inUse.map(key));
  return wanted.every((w) => have.has(key(w)));
}

async function readBooths(client, id) {
  const path = `/api/v2/admin/events/${q(id)}/booths`;
  const res = await expectAdmin(client, 'GET', path, undefined, 200);
  if (!res.json || !Array.isArray(res.json.booths)) throw failure('GET', path, res);
  return res.json.booths;
}

/** Load the fair in `state`. Idempotent: a second run with the same state writes nothing. */
export async function load({ client, fixture, state }) {
  if (!STATES.includes(state)) throw new Error(`state must be one of: ${STATES.join(', ')}`);
  const slug = fixture.event.slug;
  const found = await findBySlug(client, slug);
  if (found.others.length > 0) {
    throw new Error(
      `the slug ${slug} is held by an event this job did not make; nothing was changed`
    );
  }
  if (found.mine.length > 1)
    throw new Error(`${found.mine.length} example fairs found; expected one`);

  const counts = {
    eventCreated: 0,
    eventUpdates: 0,
    stallsCreated: 0,
    stallsUpdated: 0,
    stallsTakenOut: 0,
  };
  let id;
  if (found.mine.length === 0) {
    const res = await expectAdmin(
      client,
      'POST',
      '/api/v2/admin/events',
      createBody(fixture, state),
      201
    );
    id = res.json && typeof res.json.id === 'string' ? res.json.id : null;
    if (!id) throw new Error('POST /api/v2/admin/events answered 201 with no id');
    counts.eventCreated = 1;
  } else {
    const row = found.mine[0];
    id = String(row.id);
    const path = `/api/v2/admin/events/${q(id)}`;
    const patch = eventDrift(row, fixture);
    if (Object.keys(patch).length > 0) {
      await expectAdmin(client, 'PUT', path, patch, 200);
      counts.eventUpdates += 1;
    }
    for (const status of statusPath(String(row.status), STATUS_OF_STATE[state])) {
      await expectAdmin(client, 'PUT', path, { status }, 200);
      counts.eventUpdates += 1;
    }
  }

  const plan = planStalls(await readBooths(client, id), fixture.stalls);
  const boothsPath = `/api/v2/admin/events/${q(id)}/booths`;
  if (plan.create.length > 0) {
    await expectAdmin(client, 'POST', `${boothsPath}/bulk`, { booths: plan.create }, 201);
    counts.stallsCreated = plan.create.length;
  }
  for (const u of plan.update) {
    await expectAdmin(client, 'PUT', `${boothsPath}/${q(u.id)}`, u.patch, 200);
    counts.stallsUpdated += 1;
  }
  for (const boothId of plan.deactivate) {
    await expectAdmin(client, 'DELETE', `${boothsPath}/${q(boothId)}`, undefined, 200);
    counts.stallsTakenOut += 1;
  }
  const after = await readBooths(client, id);
  if (!stallsMatch(after, fixture.stalls)) {
    throw new Error("the fair's stalls in use do not match the fixture after the load");
  }
  const inUse = after.filter((b) => b.is_active === true);
  return {
    id,
    counts: {
      ...counts,
      stallsInUse: inUse.length,
      categories: new Set(inUse.map((b) => b.category)).size,
    },
  };
}

// ── Remove ──────────────────────────────────────────────────────────────────

/**
 * Delete the fair this job made, and with it its own stalls and derived rows
 * (the delete route cascades them). A fair with recorded scans cannot be
 * deleted (409 EVENT_HAS_ACTIVITY, by design): it is archived instead, as the
 * staging specs do (OSE-2114), and the result says so.
 */
export async function remove({ client, fixture }) {
  const slug = fixture.event.slug;
  const found = await findBySlug(client, slug);
  if (found.mine.length === 0) {
    return { id: null, outcome: 'none', othersWithSlug: found.others.length };
  }
  if (found.mine.length > 1)
    throw new Error(`${found.mine.length} example fairs found; expected one`);
  const id = String(found.mine[0].id);
  const path = `/api/v2/admin/events/${q(id)}`;
  const del = await client.admin('DELETE', path);
  if (del.status === 409 && del.reachedWorker) {
    await expectAdmin(client, 'PUT', path, { status: 'archived' }, 200);
    return { id, outcome: 'archived', othersWithSlug: found.others.length };
  }
  if (del.status !== 200 || !del.reachedWorker) throw failure('DELETE', path, del);
  // A 200 alone is not proof: a second delete must find nothing.
  await expectAdmin(client, 'DELETE', path, undefined, 404);
  return { id, outcome: 'deleted', othersWithSlug: found.others.length };
}

// ── What a visitor sees ─────────────────────────────────────────────────────

/** The three addresses to open, on this origin. */
export function addresses(origin, id, fixture) {
  const event = `${origin}/events/${q(id)}`;
  return {
    event,
    stalls: `${event}/booths`,
    stall: `${event}/booths/${q(fixture.stalls[0].number)}`,
  };
}

const count = (text, mark) => text.split(mark).length - 1;
const between = (text, open, close) => {
  const at = text.indexOf(open);
  if (at < 0) return null;
  const from = at + open.length;
  const end = text.indexOf(close, from);
  return end < 0 ? null : text.slice(from, end).trim();
};

/**
 * Read the public pages back and judge named fields only: the status, the
 * stalls link, the row and group counts, the stall's name, the noindex header,
 * and that no list carries the fair. Each check is { name, pass, detail }.
 */
export async function verify({ client, fixture, id, state }) {
  const open = state === 'open-by-link';
  const want = open ? 200 : 404;
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  const edgeNote = (r) => (r.challenged ? ' (the edge answered, not the Worker)' : '');
  const p = `/events/${q(id)}`;

  const page = await client.read(p);
  add(
    'event page',
    page.status === want && !page.challenged,
    `answered ${page.status}${edgeNote(page)}, wanted ${want}`
  );
  if (open) {
    add(
      'event page links to the stalls',
      page.text.includes('data-testid="event-stalls-link"'),
      'the "See the stalls" link'
    );
  }

  const list = await client.read(`${p}/booths`);
  add(
    'stall list',
    list.status === want && !list.challenged,
    `answered ${list.status}${edgeNote(list)}, wanted ${want}`
  );
  if (open) {
    const rows = count(list.text, 'data-testid="booth-list-row"');
    const groups = count(list.text, 'data-testid="booth-list-group"');
    add('stall list rows', rows === STALL_COUNT, `${rows} rows, wanted ${STALL_COUNT}`);
    add(
      'stall list groups',
      groups === CATEGORY_COUNT,
      `${groups} groups, wanted ${CATEGORY_COUNT}`
    );
    add('stall list is not indexed', /noindex/i.test(list.robots), 'X-Robots-Tag noindex');
  }

  const first = fixture.stalls[0];
  const stall = await client.read(`${p}/booths/${q(first.number)}`);
  add(
    'stall page',
    stall.status === want && !stall.challenged,
    `answered ${stall.status}${edgeNote(stall)}, wanted ${want}`
  );
  if (open) {
    const name = between(stall.text, 'data-testid="booth-name">', '</h1>');
    add(
      'stall page names the stall',
      name === first.name,
      name === first.name ? 'its trading name' : 'another name'
    );
  }

  const api = await client.read('/api/v2/events');
  let ids = null;
  try {
    const body = JSON.parse(api.text);
    ids = Array.isArray(body.items) ? body.items.map((e) => String(e && e.id)) : null;
  } catch {
    ids = null;
  }
  add(
    'not in the public events list',
    api.status === 200 && ids !== null && !ids.includes(id),
    `answered ${api.status}`
  );
  const events = await client.read('/events');
  add(
    'not on /events',
    events.status === 200 && !events.text.includes(`/events/${id}`),
    `answered ${events.status}${edgeNote(events)}`
  );
  return checks;
}

// ── The report ──────────────────────────────────────────────────────────────

/** The run summary, as Markdown lines. Every value is an id, an address, a count or a fixed word. */
export function formatReport({ action, state, result, links, checks }) {
  const lines = [
    `## Example fair on staging: ${action}${action === 'load' ? ` (${state})` : ''}`,
    '',
  ];
  if (action === 'load') {
    const c = result.counts;
    lines.push(
      `Event id: \`${result.id}\``,
      '',
      `- Event page: ${links.event}`,
      `- Stall list: ${links.stalls}`,
      `- One stall: ${links.stall}`,
      '',
      state === 'draft'
        ? 'A draft is not public: all three addresses answer 404 until it is loaded as open-by-link.'
        : 'Live by link, off the map: the pages open for whoever has the address; no list, map or search shows it.',
      '',
      '| What | Count |',
      '| --- | ---: |',
      `| Event created | ${c.eventCreated} |`,
      `| Event changes (fields or state) | ${c.eventUpdates} |`,
      `| Stalls created | ${c.stallsCreated} |`,
      `| Stalls changed | ${c.stallsUpdated} |`,
      `| Stalls taken out of use | ${c.stallsTakenOut} |`,
      `| Stalls in use | ${c.stallsInUse} |`,
      `| Categories | ${c.categories} |`
    );
  } else {
    lines.push(
      result.outcome === 'none'
        ? 'No example fair was found; nothing was removed.'
        : result.outcome === 'archived'
          ? `Event \`${result.id}\` has recorded scans, so it was archived (off every public page), not deleted.`
          : `Event \`${result.id}\` and its stalls were deleted.`
    );
    if (result.othersWithSlug > 0) {
      lines.push(
        '',
        `${result.othersWithSlug} other event(s) hold the slug; they were not touched.`
      );
    }
  }
  if (checks && checks.length > 0) {
    lines.push('', '| | Check | Detail |', '| --- | --- | --- |');
    for (const ch of checks)
      lines.push(`| ${ch.pass ? 'pass' : '**FAIL**'} | ${ch.name} | ${ch.detail} |`);
  }
  return lines;
}

// ── Command line ────────────────────────────────────────────────────────────

/** The action and state from the arguments, then the environment; strict. */
export function parseRun(argv = [], env = {}) {
  let action = env.EXAMPLE_FAIR_ACTION || 'load';
  let state = env.EXAMPLE_FAIR_STATE || 'draft';
  for (const arg of argv) {
    if (arg === '--remove') action = 'remove';
    else if (arg.startsWith('--state=')) state = arg.slice('--state='.length);
    else throw new Error(`unknown argument: ${arg.slice(0, 40)}`);
  }
  if (!ACTIONS.includes(action)) throw new Error(`action must be one of: ${ACTIONS.join(', ')}`);
  if (!STATES.includes(state)) throw new Error(`state must be one of: ${STATES.join(', ')}`);
  return { action, state };
}

/**
 * One run. Returns the exit code. `deps` lets the tests hand it a fake site and
 * catch everything it writes.
 */
export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const appendSummary = deps.appendSummary ?? ((file, text) => appendFileSync(file, text));
  if (env.GITHUB_ACTIONS === 'true') {
    for (const name of SECRET_NAMES) {
      const v = env[name];
      if (typeof v === 'string' && v !== '') {
        for (const line of v.split(/\r?\n/)) if (line) write(`::add-mask::${line}\n`);
      }
    }
  }

  const { action, state } = parseRun(argv, env);
  const inCi = env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
  const baseUrl = assertTarget(env.EXAMPLE_FAIR_BASE_URL || STAGING_BASE_URL, {
    allowLocal: env.EXAMPLE_FAIR_ALLOW_LOCAL === '1',
    inCi,
  });
  if (baseUrl === STAGING_BASE_URL && (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET)) {
    throw new Error('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are not set');
  }
  const fixture = deps.fixture ?? loadFixture();
  const client = createClient({
    baseUrl,
    adminKey: env.ADMIN_KEY,
    accessClientId: env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
    edgeToken: env.OCR_CI_EDGE_TOKEN || '',
    fetch: deps.fetch,
    sleep: deps.sleep,
  });

  const today = new Date().toISOString().slice(0, 10);
  if (action === 'load' && fixture.event.start_date <= today) {
    write(
      `::warning::The fixture's date ${fixture.event.start_date} has passed: the event page shows the post-event view. Move the date forward in scripts/ci/example-fair.json.\n`
    );
  }

  let result;
  let links = null;
  let checks = [];
  if (action === 'load') {
    result = await load({ client, fixture, state });
    links = addresses(client.origin, result.id, fixture);
    const attempts = deps.verifyAttempts ?? 3;
    const sleep = deps.sleep ?? realSleep;
    for (let i = 0; i < attempts; i++) {
      checks = await verify({ client, fixture, id: result.id, state });
      if (checks.every((c) => c.pass)) break;
      if (i < attempts - 1) await sleep(5_000);
    }
  } else {
    result = await remove({ client, fixture });
  }

  const lines = formatReport({ action, state, result, links, checks });
  write(`${lines.join('\n')}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendSummary(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    write(`::error::${failed.length} check(s) of the public pages failed; see the table.\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stdout.write(
        `::error::example-fair: ${err instanceof Error ? err.message : 'failed'}\n`
      );
      process.exit(1);
    }
  );
}
