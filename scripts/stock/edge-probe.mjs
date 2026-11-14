// Edge probe for stg: what does the Cloudflare edge answer a GitHub runner?
//
// The daily stock check reads /s/<code> and /events/<id> on stg from a runner, and
// the edge has answered every such read with a managed challenge (cf-mitigated:
// challenge) while the same request from the owner's own machine gets through
// (runs 42394101331 to 42437943542, 2026-11-07/08). This probe repeats the check's
// read from a runner, with the check's own request builder, in three shapes, so
// one short run says which part of the request the edge reacts to:
//
//   check      X-OCR-CI + the Access service-token headers: the stock check's read
//   edge-only  X-OCR-CI alone
//   plain      no headers: what any script sees
//
// It reads only, writes nothing, and prints status, cf-mitigated and the Ray ID per
// read, never a header value or a Location. It fails when a `check` read is
// challenged, gets anything but the Worker's own answer for its path (PROBES), or
// gets no answer within its deadline, so a green run means the next "Stock data
// (stg)" run gets past the edge.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STOCK_BASE_URL } from './client.mjs';
import { fetchPublicFrom, maskSecrets } from './run-day.mjs';
import { edgeChallenged } from './check-full.mjs';

// The kinds of public read the stock check makes, plus the page the searches use,
// each with the Worker's own answer. test-event-001 is CI's permanent staging
// fixture, read on the slugless route the check reads. The /q/ and /s/ codes are
// made up: the Worker sends /q/ home (a 302 to this site's /) and answers /s/ with
// a 404 (read on stg 2026-11-08). Any other answer fails, including a redirect
// anywhere else, such as a Cloudflare Access login, which never reached the Worker.
export const PROBES = [
  { path: '/q/edge-probe', expect: ['302-home'] },
  { path: '/s/edge-probe', expect: [404] },
  { path: '/events/test-event-001', expect: [200] },
  { path: '/?zip=60453', expect: [200] },
  // The calendar addresses (OSE-2022). A calendar app is a machine, so these are
  // the reads a challenge breaks outright. The feed is 200, or 404 when the root
  // brand lists nothing; the per-event file is 200, or 409 before its short link
  // is minted. tests/integration/machine-read-edge-cover.test.js requires a probe
  // here for every .ics route in the router.
  { path: '/brands/root/calendar.ics', expect: [200, 404] },
  { path: '/events/test-event-001/calendar.ics', expect: [200, 409] },
];
export const PROBE_PATHS = PROBES.map((p) => p.path);

export const SHAPES = ['check', 'edge-only', 'plain'];

const RAY_RE = /^[0-9a-f]{16}-[A-Z]{3}$/i;
const SITE_ORIGIN = new URL(STOCK_BASE_URL).origin;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 'home' (this site's /), 'this-site' (another path here), 'elsewhere' or '' (none).
 * The Location itself is never kept. */
function redirectTarget(res) {
  const h = res && res.headers;
  const loc = h && typeof h.get === 'function' ? h.get('location') : null;
  if (!loc) return '';
  try {
    const target = new URL(loc, SITE_ORIGIN);
    if (target.origin !== SITE_ORIGIN) return 'elsewhere';
    return target.pathname === '/' && !target.search ? 'home' : 'this-site';
  } catch {
    return 'elsewhere';
  }
}

// A fixed error text: a fetch error can quote a malformed header value, so only the
// error's class and a code-shaped cause (ENOTFOUND, ECONNRESET) are ever reported.
export function safeError(err) {
  const name = err && /^[A-Za-z]{1,40}$/.test(String(err.name)) ? err.name : 'Error';
  const code = err && err.cause && err.cause.code;
  return /^[A-Z][A-Z0-9_]{1,40}$/.test(String(code || '')) ? `${name} ${code}` : name;
}

/** The fetch for one request shape. `check` is the stock check's own builder. */
export function shapeFetch(shape, env, fetchFn) {
  if (shape === 'check') return fetchPublicFrom(env, fetchFn);
  const headers = {};
  if (shape === 'edge-only') headers['X-OCR-CI'] = env.OCR_CI_EDGE_TOKEN;
  else if (shape !== 'plain') throw new Error(`unknown shape: ${shape}`);
  return (url) => fetchFn(url, { method: 'GET', redirect: 'manual', headers: { ...headers } });
}

/** One read: status, whether the edge challenged it, and a ray-shaped Ray ID. */
export async function probeOne(fetchShape, shape, path) {
  const url = new URL(path, STOCK_BASE_URL).href;
  try {
    const res = await fetchShape(url);
    const h = res && res.headers;
    const ray = String((h && typeof h.get === 'function' && h.get('cf-ray')) || '').trim();
    return {
      shape,
      path,
      status: res.status,
      challenged: edgeChallenged(res),
      redirect: REDIRECT_STATUSES.has(res.status) ? redirectTarget(res) : '',
      ray: RAY_RE.test(ray) ? ray : '',
    };
  } catch (err) {
    return {
      shape,
      path,
      status: 0,
      challenged: false,
      redirect: '',
      ray: '',
      error: safeError(err),
    };
  }
}

/** Every shape × path, in order. */
export async function probeAll(env, fetchFn) {
  const rows = [];
  for (const shape of SHAPES) {
    const f = shapeFetch(shape, env, fetchFn);
    for (const path of PROBE_PATHS) rows.push(await probeOne(f, shape, path));
  }
  return rows;
}

/** Whether one read got the Worker's own answer for its path, unchallenged. */
export function readOk(r) {
  if (r.challenged || !r.status) return false;
  const probe = PROBES.find((p) => p.path === r.path);
  if (!probe) return false;
  if (REDIRECT_STATUSES.has(r.status)) {
    return probe.expect.includes('302-home') && r.status === 302 && r.redirect === 'home';
  }
  return probe.expect.includes(r.status);
}

/** Ok only when every `check` read reached the Worker and was answered as expected. */
export function verdict(rows) {
  const bad = rows.filter((r) => r.shape === 'check' && !readOk(r));
  return { ok: bad.length === 0, bad };
}

/**
 * What a calendar app sees (ADR-028). An app sends no CI header and no browser, so
 * its read is the `plain` shape. This line reports those reads for the calendar
 * addresses. It is information, not part of the verdict: the verdict is about CI's
 * own reads, and a calendar app gets through only once the owner has applied the
 * calendar rule (scripts/ci/cf-waf-calendar-skip.mjs).
 */
export function calendarAppLine(rows) {
  const plain = rows.filter((r) => r.shape === 'plain' && r.path.endsWith('.ics'));
  if (plain.length === 0) return '';
  const reached = plain.filter(readOk).length;
  const verdictText =
    reached === plain.length
      ? 'A calendar app can load them.'
      : 'A calendar app cannot load the rest until the calendar edge rule is applied (docs/runbooks/RUNBOOK-CALENDAR-EDGE-RULE.md).';
  return `Calendar addresses read with no header, as a calendar app reads them: ${reached} of ${plain.length} reached the Worker. ${verdictText}\n`;
}

// Each read gets its own deadline, so a stalled read becomes an error row and the
// table still prints well inside the step's timeout (18 reads × 8 s < 3 min).
export const READ_TIMEOUT_MS = 8_000;

/** fetchFn with a per-read abort deadline, beneath every shape's own builder. */
export function withDeadline(fetchFn, ms = READ_TIMEOUT_MS) {
  return (url, init = {}) => fetchFn(url, { ...init, signal: AbortSignal.timeout(ms) });
}

/** A Markdown table of the rows. No header value ever appears in it. */
export function report(rows) {
  const cell = (r) => (r.ray ? r.ray : r.error ? `error: ${r.error}` : '');
  const lines = [
    '| Shape | Path | Status | Edge challenge | Ray ID |',
    '|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.shape} | \`${r.path}\` | ${r.status || 'none'}${r.redirect ? ` → ${r.redirect}` : ''} | ${r.challenged ? 'CHALLENGED' : 'no'} | ${cell(r)} |`
    ),
  ];
  return `${lines.join('\n')}\n`;
}

export async function main(env = process.env, deps = {}) {
  const out = deps.write || ((s) => process.stdout.write(s));
  const fetchFn = deps.fetch || globalThis.fetch;
  if (!env.OCR_CI_EDGE_TOKEN) {
    out('edge-probe: OCR_CI_EDGE_TOKEN is not set, so no read can carry X-OCR-CI.\n');
    return 1;
  }
  maskSecrets(env, out);
  const rows = await probeAll(env, withDeadline(fetchFn, deps.readTimeoutMs));
  const table = report(rows);
  const { ok, bad } = verdict(rows);
  const challengedCount = bad.filter((r) => r.challenged).length;
  const summary = ok
    ? 'Every read shaped like the stock check got past the stg edge from this runner. "Stock data (stg)" can run.\n'
    : `${bad.length} of ${PROBE_PATHS.length} reads shaped like the stock check failed from this runner (${challengedCount} challenged at the edge, ${bad.length - challengedCount} an unexpected answer or none). Look up a CHALLENGED Ray ID in Cloudflare Security → Events to see the rule or service that did it.\n`;
  const calendar = calendarAppLine(rows);
  out(`${table}\n${summary}${calendar}`);
  if (env.GITHUB_STEP_SUMMARY) {
    (deps.appendFile || appendFileSync)(
      env.GITHUB_STEP_SUMMARY,
      `## stg edge probe\n\n${table}\n${summary}${calendar}`
    );
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`edge-probe: ${err.message}`);
      process.exit(1);
    }
  );
}
