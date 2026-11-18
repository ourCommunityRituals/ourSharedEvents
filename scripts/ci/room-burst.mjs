#!/usr/bin/env node
// Room burst: can a full room behind one address get a cookie through /q?
//
// At a bar everyone shares one Wi-Fi address. A vote will count only from a
// browser that scanned the event's code at /q (ADR-040 decision 6), and /q mints
// no `ose_anon` cookie once the caller is past its limit (handlers/qr-scan.ts,
// lib/public-read-limit.ts publicCountLimited). This script sends N fresh
// browsers (no cookie) at one staging poster from ONE address, evenly over S
// seconds, and reports what came back. A GitHub runner is one address, which is
// exactly the case.
//
//   node scripts/ci/room-burst.mjs           # from the repo root, in CI
//
// Env:
//   BURST_REQUESTS            browsers in the burst (default 150, 1..300)
//   BURST_SECONDS             spread over this many seconds (default 20, 1..120)
//   BURST_RETRY_AFTER_SECONDS a browser that got no cookie scans once more this
//                             long after the burst ends (default 11; 0 = no retry)
//   OCR_CI_EDGE_TOKEN         the stg skip rule's header value (CI secret)
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET   staging is behind Access
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID    read the scan counts in D1
//
// The poster and its event come from tests/ui/smoke/fixtures/room-burst-seed.sql;
// the workflow seeds them first and deletes them after (room-burst-reset.sql).
//
// What it prints: counts only. Cookies minted, browsers sent on with no cookie,
// 429s, edge answers, scan rows in D1. It reads a Set-Cookie header only to see
// whether it names `ose_anon`; the value is dropped there and never printed,
// stored or sent again. No header value is printed.
//
// Staging only: production is refused before anything is sent (ADR-021), and so
// is every host but stg.oursharedevents.com.
//
// Exit code: 0 when every request reached the Worker, whatever the Worker did
// (the limiter refusing to count is a result, not a failure). 1 when any answer
// came from somewhere else (the edge, Access, the home redirect, an error): then
// the run measured the wrong thing, and it says which.

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import productionHosts from '../../config/production-hosts.js';
import { edgeHeaders } from './edge-read.mjs';

export const STAGING_BASE_URL = 'https://stg.oursharedevents.com';
export const QR_TOKEN = 'qrt_room_burst';
export const DEPLOYMENT_ID = 'pd_room_burst';
export const EVENT_ID = 'room-burst-event';
export const ANON_COOKIE = 'ose_anon';

/** The edge binding's window (src/lib/edge-rate-limit.ts EDGE_WINDOW_SECONDS). */
export const WINDOW_MS = 10_000;

export const LIMITS = {
  requests: { min: 1, max: 300, fallback: 150 },
  seconds: { min: 1, max: 120, fallback: 20 },
  retryAfter: { min: 0, max: 120, fallback: 11 },
};

/** The one host this script may send to. Production first, by the shared rule. */
export function assertStagingTarget(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error('room-burst: the base URL is not a URL');
  }
  if (productionHosts.isProductionUrl(url.href)) {
    throw new Error('room-burst: ADR-021: refusing production');
  }
  const trimmed = String(raw).replace(/\/+$/, '');
  if (url.origin !== STAGING_BASE_URL || trimmed !== STAGING_BASE_URL) {
    throw new Error(`room-burst: staging only (${STAGING_BASE_URL})`);
  }
  return STAGING_BASE_URL;
}

function boundedInt(raw, { min, max, fallback }, name) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`room-burst: ${name} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

/** The run's shape, from the environment, inside fixed bounds. */
export function parsePlan(env = process.env) {
  return {
    requests: boundedInt(env.BURST_REQUESTS, LIMITS.requests, 'BURST_REQUESTS'),
    seconds: boundedInt(env.BURST_SECONDS, LIMITS.seconds, 'BURST_SECONDS'),
    retryAfter: boundedInt(
      env.BURST_RETRY_AFTER_SECONDS,
      LIMITS.retryAfter,
      'BURST_RETRY_AFTER_SECONDS'
    ),
  };
}

/** When each request leaves, in ms from the start: evenly over the window. */
export function sendTimes(requests, seconds) {
  const step = (seconds * 1000) / requests;
  return Array.from({ length: requests }, (_, i) => Math.round(i * step));
}

/**
 * What one answer means. `answer` is { status, location, setCookies, cfMitigated }
 * (setCookies: the Set-Cookie header lines; only their names are looked at).
 *
 *   edge          the Cloudflare edge answered (cf-mitigated set); the Worker never ran
 *   minted        the Worker sent the browser on to the event and set ose_anon
 *   not_counted   the Worker sent the browser on with no cookie: past the limit
 *   limited_429   a 429 with no cf-mitigated. /q never refuses (publicCountLimited),
 *                 so this is not the Worker's limiter; it is counted on its own
 *   access        a redirect somewhere else (Cloudflare Access login)
 *   home          a redirect home: the poster was not found, or D1 failed
 *   other         anything else, network errors included
 */
export function classify(answer, { base = STAGING_BASE_URL, eventId = EVENT_ID } = {}) {
  const { status, location, setCookies = [], cfMitigated } = answer ?? {};
  // A 403 challenge (edge-read.mjs edgeChallenged) or any other edge action.
  if (String(cfMitigated ?? '').trim() !== '') return 'edge';
  if (status === 429) return 'limited_429';
  if (status === 302) {
    const loc = String(location ?? '');
    const eventPath = `/events/${encodeURIComponent(eventId)}`;
    const toEvent = loc.startsWith(`${base}${eventPath}?`) || loc.startsWith(`${eventPath}?`);
    if (toEvent) {
      const named = setCookies.some((c) => String(c).trimStart().startsWith(`${ANON_COOKIE}=`));
      return named ? 'minted' : 'not_counted';
    }
    if (loc === '/' || loc === `${base}/`) return 'home';
    return 'access';
  }
  return 'other';
}

export const CLASSES = ['minted', 'not_counted', 'limited_429', 'edge', 'access', 'home', 'other'];

/** Counts per class, per edge window, and where counting first stopped. Numbers only. */
export function summarize(results) {
  const totals = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  const windows = new Map();
  let firstNotCounted = null;
  for (const r of results) {
    totals[r.kind] = (totals[r.kind] ?? 0) + 1;
    const w = Math.floor(r.atMs / WINDOW_MS);
    const row = windows.get(w) ?? { window: w, sent: 0, minted: 0, notCounted: 0 };
    row.sent += 1;
    if (r.kind === 'minted') row.minted += 1;
    if (r.kind === 'not_counted' || r.kind === 'limited_429') row.notCounted += 1;
    windows.set(w, row);
    if ((r.kind === 'not_counted' || r.kind === 'limited_429') && firstNotCounted === null) {
      firstNotCounted = { index: r.index, atMs: r.atMs };
    }
  }
  return {
    sent: results.length,
    totals,
    windows: [...windows.values()].sort((a, b) => a.window - b.window),
    firstNotCounted,
    reachedWorker: totals.minted + totals.not_counted,
  };
}

/** The answers that mean this run did not measure the Worker. */
export function wrongAnswers(summary) {
  const t = summary.totals;
  return { edge: t.edge, access: t.access, home: t.home, other: t.other };
}

/** The report, as Markdown lines. Every value in it is a number or a fixed word. */
export function formatReport({ plan, burst, retry, scans }) {
  const n = (v) => (Number.isFinite(v) ? String(v) : 'not read');
  const lines = [
    '## Room burst on staging: one address, fresh browsers, one poster',
    '',
    `Plan: ${plan.requests} browsers over ${plan.seconds} s from one address, no cookie each.`,
    '',
    '| What came back | Burst | Second scan |',
    '| --- | ---: | ---: |',
    `| Sent | ${burst.sent} | ${retry ? retry.sent : '-'} |`,
    `| Cookie minted (Worker, counted) | ${burst.totals.minted} | ${retry ? retry.totals.minted : '-'} |`,
    `| Sent on with no cookie (Worker, past the limit) | ${burst.totals.not_counted} | ${retry ? retry.totals.not_counted : '-'} |`,
    `| 429 (not the Worker: /q never refuses) | ${burst.totals.limited_429} | ${retry ? retry.totals.limited_429 : '-'} |`,
    `| Edge answered (cf-mitigated), not the Worker | ${burst.totals.edge} | ${retry ? retry.totals.edge : '-'} |`,
    `| Access answered, not the Worker | ${burst.totals.access} | ${retry ? retry.totals.access : '-'} |`,
    `| Sent home (poster not found or D1 error) | ${burst.totals.home} | ${retry ? retry.totals.home : '-'} |`,
    `| Other (5xx, network error) | ${burst.totals.other} | ${retry ? retry.totals.other : '-'} |`,
    '',
    'Burst by 10-second window (the edge binding counts 60 per 10 s per address):',
    '',
    '| Window | Sent | Minted | Not counted |',
    '| ---: | ---: | ---: | ---: |',
    ...burst.windows.map(
      (w) =>
        `| ${w.window * 10}-${w.window * 10 + 10} s | ${w.sent} | ${w.minted} | ${w.notCounted} |`
    ),
    '',
    burst.firstNotCounted
      ? `First browser not counted: number ${burst.firstNotCounted.index + 1}, ${(burst.firstNotCounted.atMs / 1000).toFixed(1)} s in.`
      : 'Every browser that reached the Worker in the burst was counted.',
    '',
    `Scan rows in D1 for the poster after the run: ${n(scans.placementRows)} (before: ${n(scans.before)}).`,
    `Node-return rows for the event: ${n(scans.returnRows)}; distinct keyed ids among them: ${n(scans.distinctIds)}.`,
  ];
  return lines;
}

/** COUNT(*) from `wrangler d1 execute --json` output. */
export function countsFromWranglerJson(text) {
  const parsed = JSON.parse(text);
  const row = parsed?.[0]?.results?.[0];
  if (!row) throw new Error('room-burst: D1 answered with no row');
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = Number(v);
  return out;
}

/** The headers of one fresh browser's scan. No Cookie header: it is new. */
export function scanHeaders(env = process.env) {
  return {
    'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID ?? '',
    'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET ?? '',
    ...edgeHeaders(env),
    Accept: 'text/html',
    'User-Agent': 'ose-room-burst-ci',
  };
}

export async function scanOnce(url, headers, fetchImpl) {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const answer = {
      status: res.status,
      location: res.headers.get('location'),
      // Names only: the value of each line is cut off at '=' plus the name.
      setCookies: (res.headers.getSetCookie?.() ?? []).map((c) => String(c).split('=')[0] + '='),
      cfMitigated: res.headers.get('cf-mitigated'),
    };
    await res.body?.cancel?.().catch(() => {});
    return answer;
  } catch {
    return { status: 0 };
  }
}

/** Send `count` fresh scans evenly over `seconds`; resolve with one result each. */
export async function burst({ base, count, seconds, headers, fetchImpl = fetch, sleep }) {
  const url = `${base}/q/${QR_TOKEN}`;
  const times = sendTimes(count, seconds);
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const start = Date.now();
  const pending = times.map(async (at, index) => {
    await wait(Math.max(0, at - (Date.now() - start)));
    const atMs = Date.now() - start;
    const answer = await scanOnce(url, headers, fetchImpl);
    return { index, atMs, kind: classify(answer, { base }) };
  });
  return Promise.all(pending);
}

function d1Count(workerDir, sql) {
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', '--env', 'staging', '--remote', '--json', '--command', sql],
    { cwd: workerDir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  if (r.status !== 0) return null;
  try {
    return countsFromWranglerJson(r.stdout);
  } catch {
    return null;
  }
}

const PLACEMENT_SQL = `SELECT COUNT(*) AS n FROM scan_placement_events WHERE poster_deployment_id = '${DEPLOYMENT_ID}'`;
const RETURNS_SQL = `SELECT COUNT(*) AS n, COUNT(DISTINCT anonymous_id) AS d FROM scan_node_returns WHERE event_id = '${EVENT_ID}'`;

async function main() {
  const base = assertStagingTarget(process.env.STG_BASE_URL || STAGING_BASE_URL);
  const plan = parsePlan();
  for (const name of ['OCR_CI_EDGE_TOKEN', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET']) {
    if (!process.env[name]) {
      console.log(
        `::error::${name} is not set; the run would measure the edge or Access, not the Worker`
      );
      process.exit(1);
    }
  }
  const workerDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'workers',
    'oursharedevents'
  );
  const before = d1Count(workerDir, PLACEMENT_SQL)?.n;
  const headers = scanHeaders();

  console.log(`Burst: ${plan.requests} fresh browsers over ${plan.seconds} s at /q, one address.`);
  const burstResults = await burst({ base, count: plan.requests, seconds: plan.seconds, headers });
  const burstSummary = summarize(burstResults);

  let retrySummary = null;
  const missed = burstResults.filter((r) => r.kind === 'not_counted' || r.kind === 'limited_429');
  if (plan.retryAfter > 0 && missed.length > 0) {
    console.log(
      `Second scan: ${missed.length} browsers with no cookie scan again after ${plan.retryAfter} s.`
    );
    await new Promise((r) => setTimeout(r, plan.retryAfter * 1000));
    const retryResults = await burst({
      base,
      count: missed.length,
      seconds: plan.seconds,
      headers,
    });
    retrySummary = summarize(retryResults);
  }

  // Staging writes scans through SCAN_QUEUE (batches of up to 100, 5 s timeout),
  // so rows land a little after the redirect. Wait until the count holds still.
  let placementRows = null;
  let still = 0;
  const deadline = Date.now() + 120_000;
  await new Promise((r) => setTimeout(r, 10_000));
  while (Date.now() < deadline && still < 3) {
    const n = d1Count(workerDir, PLACEMENT_SQL)?.n ?? null;
    still = n !== null && n === placementRows ? still + 1 : 0;
    placementRows = n;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  const returns = d1Count(workerDir, RETURNS_SQL);

  const lines = formatReport({
    plan,
    burst: burstSummary,
    retry: retrySummary,
    scans: {
      before,
      placementRows: placementRows ?? undefined,
      returnRows: returns?.n,
      distinctIds: returns?.d,
    },
  });
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }

  const wrong = [burstSummary, retrySummary].filter(Boolean).map(wrongAnswers);
  const bad = wrong.reduce((sum, w) => sum + w.edge + w.access + w.home + w.other, 0);
  if (bad > 0) {
    console.log(
      `::error::${bad} answers did not come from the Worker (edge, Access, home or error). ` +
        'This run did not measure the limiter; see the table.'
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.log(`::error::room-burst: ${err instanceof Error ? err.message : 'failed'}`);
    process.exit(1);
  });
}
