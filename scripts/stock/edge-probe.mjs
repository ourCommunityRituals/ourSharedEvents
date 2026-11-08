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
// read, never a header value. It fails when a `check` read is challenged, so a green
// run means the next "Stock data (stg)" run gets past the edge.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STOCK_BASE_URL } from './client.mjs';
import { fetchPublicFrom, maskSecrets } from './run-day.mjs';
import { edgeChallenged } from './check-full.mjs';

// The kinds of public read the stock check makes, plus the page the searches use.
// test-event-001 is CI's permanent staging fixture; the /q/ and /s/ codes do not
// exist, so the Worker answers them with a redirect or a 404 and only the edge
// can challenge them.
export const PROBE_PATHS = [
  '/q/edge-probe',
  '/s/edge-probe',
  '/events/test-event-001/community-game-night',
  '/?zip=60453',
];

export const SHAPES = ['check', 'edge-only', 'plain'];

const RAY_RE = /^[0-9a-f]{16}-[A-Z]{3}$/i;

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
      ray: RAY_RE.test(ray) ? ray : '',
    };
  } catch (err) {
    const error = String((err && err.message) || err).slice(0, 120);
    return { shape, path, status: 0, challenged: false, ray: '', error };
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

/** Ok only when every `check` read reached the Worker unchallenged. */
export function verdict(rows) {
  const bad = rows.filter((r) => r.shape === 'check' && (r.challenged || r.status === 0));
  return { ok: bad.length === 0, bad };
}

/** A Markdown table of the rows. No header value ever appears in it. */
export function report(rows) {
  const cell = (r) => (r.ray ? r.ray : r.error ? `error: ${r.error}` : '');
  const lines = [
    '| Shape | Path | Status | Edge challenge | Ray ID |',
    '|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.shape} | \`${r.path}\` | ${r.status || 'none'} | ${r.challenged ? 'CHALLENGED' : 'no'} | ${cell(r)} |`
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
  const rows = await probeAll(env, fetchFn);
  const table = report(rows);
  const { ok, bad } = verdict(rows);
  const summary = ok
    ? 'Every read shaped like the stock check got past the stg edge from this runner. "Stock data (stg)" can run.\n'
    : `${bad.length} of ${PROBE_PATHS.length} reads shaped like the stock check were stopped at the stg edge from this runner. Look up a CHALLENGED Ray ID in Cloudflare Security → Events to see the rule or service that did it.\n`;
  out(`${table}\n${summary}`);
  if (env.GITHUB_STEP_SUMMARY) {
    (deps.appendFile || appendFileSync)(
      env.GITHUB_STEP_SUMMARY,
      `## stg edge probe\n\n${table}\n${summary}`
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
