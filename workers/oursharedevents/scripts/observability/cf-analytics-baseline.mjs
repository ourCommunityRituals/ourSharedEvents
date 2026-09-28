#!/usr/bin/env node
/**
 * Cloudflare GraphQL Analytics baseline for the OSE Worker — L7 observability
 * lever (OSE-1378 / OSE-1380). Pulls request / error / latency baselines for a
 * Worker script from the GraphQL Analytics API and prints a NEVER-WHO summary:
 * aggregate counts, error rate, HTTP status-code distribution, and CPU-time
 * percentiles — no user, IP, id, slug, or token identity, ever.
 *
 * BOUNDARY: this script only READS aggregate analytics and PRINTS to stdout. It
 * writes no secret and mutates nothing. YOU (the owner) run it with a Cloudflare
 * API token in your OWN shell (separate terminal) — the agent never handles the
 * token. Dataset: `workersInvocationsAdaptive` (per CF GraphQL Analytics docs).
 *
 * Usage (inputs via env — never hardcode the token):
 *   CF_API_TOKEN="$(...)" \                              # required — Account Analytics:Read
 *   CF_ACCOUNT_TAG=c4dee735e39737db94d7befeecf96e82 \    # optional (defaults to the OSE account)
 *   CF_WORKER_SCRIPT=oursharedevents-stg \               # optional (default staging worker)
 *   WINDOW_HOURS=24 \                                     # optional (default 24h)
 *   node scripts/observability/cf-analytics-baseline.mjs
 *
 * Token: create at dash → My Profile → API Tokens → permission
 * `Account.Account Analytics:Read`, scoped to the OSE account. Never paste it in chat.
 */
import { pathToFileURL } from 'node:url';

export const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
// Non-secret: the OSE account tag is the account_id already committed in wrangler.toml.
export const DEFAULT_ACCOUNT_TAG = 'c4dee735e39737db94d7befeecf96e82';
export const DEFAULT_SCRIPT = 'oursharedevents-stg';

// Dataset: workersInvocationsAdaptive. Grouped by `status` so we get one row per
// HTTP status over the window; we aggregate those rows into one never-who summary.
// Scalar type is CF's lowercase `string` (matches the documented tutorial query).
export const WORKERS_ANALYTICS_QUERY = `query OseWorkerBaseline($accountTag: string, $scriptName: string, $start: string, $end: string) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        limit: 10000
        filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }
      ) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
        dimensions { status }
      }
    }
  }
}`;

export function buildVariables({ accountTag, scriptName, startISO, endISO }) {
  return { accountTag, scriptName, start: startISO, end: endISO };
}

// The ONLY fields the summary may carry — proves never-who by construction (no
// user / ip / id / token / slug). Asserted by assertNeverWho() + the spec.
export const SUMMARY_KEYS = [
  'scriptName',
  'window',
  'rowCount',
  'totalRequests',
  'totalErrors',
  'totalSubrequests',
  'errorRatePct',
  'cpuTimeP50MaxMicros',
  'cpuTimeP99MaxMicros',
  'statusBreakdown',
];

export function summarizeBaseline(graphqlJson, { scriptName, startISO, endISO } = {}) {
  if (graphqlJson && Array.isArray(graphqlJson.errors) && graphqlJson.errors.length) {
    throw new Error('GraphQL errors: ' + graphqlJson.errors.map((e) => e.message).join('; '));
  }
  const rows = graphqlJson?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  let totalRequests = 0;
  let totalErrors = 0;
  let totalSubrequests = 0;
  let cpuTimeP50MaxMicros = 0;
  let cpuTimeP99MaxMicros = 0;
  const statusBreakdown = {};
  for (const row of rows) {
    const req = Number(row?.sum?.requests ?? 0);
    totalRequests += req;
    totalErrors += Number(row?.sum?.errors ?? 0);
    totalSubrequests += Number(row?.sum?.subrequests ?? 0);
    cpuTimeP50MaxMicros = Math.max(cpuTimeP50MaxMicros, Number(row?.quantiles?.cpuTimeP50 ?? 0));
    cpuTimeP99MaxMicros = Math.max(cpuTimeP99MaxMicros, Number(row?.quantiles?.cpuTimeP99 ?? 0));
    const status = String(row?.dimensions?.status ?? 'unknown');
    statusBreakdown[status] = (statusBreakdown[status] ?? 0) + req;
  }
  const errorRatePct = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  return {
    scriptName: scriptName ?? null,
    window: { start: startISO ?? null, end: endISO ?? null },
    rowCount: rows.length,
    totalRequests,
    totalErrors,
    totalSubrequests,
    errorRatePct: Math.round(errorRatePct * 100) / 100,
    cpuTimeP50MaxMicros,
    cpuTimeP99MaxMicros,
    statusBreakdown,
  };
}

/**
 * never-who guard: the summary must carry ONLY allowlisted aggregate keys, and
 * every statusBreakdown key must be a 3-digit HTTP status (or 'unknown') — never
 * an identity. Throws on violation. The tool refuses to print a leaky summary.
 */
export function assertNeverWho(summary) {
  for (const k of Object.keys(summary)) {
    if (!SUMMARY_KEYS.includes(k)) {
      throw new Error(`never-who violation: unexpected summary field "${k}"`);
    }
  }
  for (const status of Object.keys(summary.statusBreakdown ?? {})) {
    if (status !== 'unknown' && !/^[1-5][0-9][0-9]$/.test(status)) {
      throw new Error(`never-who violation: statusBreakdown key "${status}" is not an HTTP status`);
    }
  }
  return true;
}

export function formatBaseline(summary) {
  const statuses = Object.entries(summary.statusBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `    ${code}: ${n}`)
    .join('\n');
  return [
    `Cloudflare Workers baseline — ${summary.scriptName}`,
    `  window:        ${summary.window.start} → ${summary.window.end}`,
    `  requests:      ${summary.totalRequests}`,
    `  errors:        ${summary.totalErrors}  (${summary.errorRatePct}%)`,
    `  subrequests:   ${summary.totalSubrequests}`,
    `  cpuTime p50:   ${summary.cpuTimeP50MaxMicros} µs (max across window)`,
    `  cpuTime p99:   ${summary.cpuTimeP99MaxMicros} µs (max across window)`,
    `  status codes:`,
    statuses || '    (none)',
  ].join('\n');
}

async function main() {
  const token = (process.env.CF_API_TOKEN || '').trim();
  if (!token) {
    console.error(
      'ERROR: CF_API_TOKEN is required (Account Analytics:Read, scoped to the OSE account).\n' +
        'Create one at dash → My Profile → API Tokens. Run this in your own shell; never paste it in chat.'
    );
    process.exit(1);
  }
  const accountTag = (process.env.CF_ACCOUNT_TAG || DEFAULT_ACCOUNT_TAG).trim();
  const scriptName = (process.env.CF_WORKER_SCRIPT || DEFAULT_SCRIPT).trim();
  const windowHours = Number(process.env.WINDOW_HOURS || 24);
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    console.error(`ERROR: WINDOW_HOURS must be a positive number (got ${process.env.WINDOW_HOURS}).`);
    process.exit(1);
  }
  const end = new Date();
  const startISO = new Date(end.getTime() - windowHours * 3600 * 1000).toISOString();
  const endISO = end.toISOString();

  let json;
  try {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: WORKERS_ANALYTICS_QUERY,
        variables: buildVariables({ accountTag, scriptName, startISO, endISO }),
      }),
    });
    if (!res.ok) {
      console.error(`ERROR: GraphQL HTTP ${res.status}. Check the token's Account Analytics:Read scope.`);
      process.exit(1);
    }
    json = await res.json();
  } catch (err) {
    console.error(`ERROR: request failed — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  try {
    const summary = summarizeBaseline(json, { scriptName, startISO, endISO });
    assertNeverWho(summary);
    console.log(formatBaseline(summary));
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// Run only when invoked directly (not when imported by the spec).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
