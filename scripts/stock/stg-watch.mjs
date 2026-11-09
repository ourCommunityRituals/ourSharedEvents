// stg watch: do stg's searches read their permanent totals right now?
//
// From 2026-11-07 every "Stock data (stg)" run failed in check-swap, purged every
// node, and stg showed 0 events, while nothing turned red: that workflow is not
// part of T1–T4, so main stayed green for days. This watch reads stg as a visitor
// would, on its own schedule and independent of the load, so an empty or
// half-loaded stg is red the same day, whatever the cause (a failed load, a purge,
// an edge rule, a broken search).
//
// It reads the committed totals (stock/totals.json `searches`) and checks two pages
// per entry:
//
//   /events?q=<zip or town>  the page's own summary line ("N events in …") must
//                            equal the total exactly (checkSearches, the same check
//                            the load gates its swap on)
//   /?zip=<zip>              (zips only) a zip expected to hold 0 must say "Nothing
//                            near <zip> yet." and list no event; any other zip must
//                            not say it and must list at least one event. The
//                            landing area is a map area around the zip, so its link
//                            count is reported, never gated as an exact total.
//
// Reads only, with the stock check's own request builder (fetchPublicFrom), so a
// read here gets exactly what the load's check gets. Prints counts, never a header
// value.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STOCK_BASE_URL } from './client.mjs';
import { fetchPublicFrom, maskSecrets } from './run-day.mjs';
import { checkSearches, edgeChallenged, edgeReason, READ_TIMEOUT_MS } from './check-full.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ZIP_RE = /^\d{5}$/;
const MIN_GAP_MS = 200;
const PUBLIC_ERROR_MARK = 'data-testid="public-error"';
// One link per listed event: /events/<id> or /events/<id>/<slug>.
const EVENT_LINK_RE = /href="\/events\/([^"/?#]+)/g;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The committed searches: { "<zip or town>": total }. */
export function loadSearches(root = ROOT) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repo's own committed totals
  const totals = JSON.parse(readFileSync(join(root, 'stock', 'totals.json'), 'utf8'));
  const searches = totals && totals.searches;
  if (!searches || typeof searches !== 'object' || Object.keys(searches).length === 0) {
    throw new Error('stock/totals.json has no searches');
  }
  return searches;
}

/** The text the landing page prints for a zip with nothing in it (i18n where.nothingNear). */
export const nothingNear = (zip) => `Nothing near ${zip} yet.`;

/** Distinct event ids linked from a page. */
export function eventLinks(page) {
  return new Set([...String(page).matchAll(EVENT_LINK_RE)].map((m) => m[1]));
}

/**
 * Each zip's landing page: empty where the total is 0, populated elsewhere.
 * @returns {Promise<Record<string, { pass: boolean, links: number|null,
 *   expected: number, reasons: string[] }>>}
 */
export async function checkZipPages({
  searches,
  fetchPublic,
  sleep = realSleep,
  now = Date.now,
  readTimeoutMs = READ_TIMEOUT_MS,
}) {
  if (typeof fetchPublic !== 'function') throw new Error('fetchPublic is required');
  const origin = new URL(STOCK_BASE_URL).origin;
  const results = {};
  let lastAt = null;
  for (const [zip, expected] of Object.entries(searches)) {
    if (!ZIP_RE.test(zip)) continue;
    if (!Number.isInteger(expected) || expected < 0) {
      throw new Error(`no expected count for the zip ${zip}`);
    }
    if (lastAt !== null) {
      const wait = MIN_GAP_MS - (now() - lastAt);
      if (wait > 0) await sleep(wait);
    }
    lastAt = now();
    const path = `/?zip=${zip}`;
    const signal = AbortSignal.timeout(readTimeoutMs);
    let res = null;
    let page = '';
    try {
      res = await fetchPublic(new URL(path, origin).href, {
        method: 'GET',
        redirect: 'manual',
        signal,
      });
      page = res && res.status === 200 ? await res.text() : '';
    } catch {
      results[zip] = {
        pass: false,
        links: null,
        expected,
        reasons: [signal.aborted ? `read-timeout:${path}` : `read-error:${path}`],
      };
      continue;
    }
    if (edgeChallenged(res)) {
      results[zip] = { pass: false, links: null, expected, reasons: [edgeReason(res, path)] };
      continue;
    }
    if (!res || res.status !== 200) {
      const status = res && res.status ? res.status : 'none';
      results[zip] = { pass: false, links: null, expected, reasons: [`status:${status}`] };
      continue;
    }
    if (page.includes(PUBLIC_ERROR_MARK)) {
      results[zip] = { pass: false, links: null, expected, reasons: ['page-error'] };
      continue;
    }
    const links = eventLinks(page).size;
    const empty = page.includes(nothingNear(zip));
    const reasons = [];
    if (expected === 0) {
      if (!empty) reasons.push('not-empty:no "Nothing near" line');
      if (links > 0) reasons.push(`not-empty:${links} event links`);
    } else {
      if (empty) reasons.push(`empty:"${nothingNear(zip)}" but ${expected} expected`);
      if (links === 0) reasons.push(`empty:no event links, ${expected} expected`);
    }
    results[zip] = { pass: reasons.length === 0, links, expected, reasons };
  }
  return results;
}

// A table cell: backslashes first, then pipes, so a "\|" in the input cannot
// unescape the pipe and break the row.
const cell = (s) =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');

/** A Markdown table of both checks. */
export function report({ searches, zips }) {
  const lines = ['| Page | Expected | Read | Result |', '|---|---|---|---|'];
  for (const [q, r] of Object.entries(searches)) {
    const read = r.count === null ? 'unread' : `${r.count} event${r.count === 1 ? '' : 's'}`;
    const result = r.pass ? 'ok' : `RED: ${r.reasons.map(cell).join(', ')}`;
    lines.push(`| \`/events?q=${cell(q)}\` | ${r.expected} | ${read} | ${result} |`);
  }
  for (const [zip, r] of Object.entries(zips)) {
    const want = r.expected === 0 ? '"Nothing near"' : 'events listed';
    const read = r.links === null ? 'unread' : `${r.links} event links`;
    const result = r.pass ? 'ok' : `RED: ${r.reasons.map(cell).join(', ')}`;
    lines.push(`| \`/?zip=${zip}\` | ${want} | ${read} | ${result} |`);
  }
  return `${lines.join('\n')}\n`;
}

export async function main(env = process.env, deps = {}) {
  const out = deps.write || ((s) => process.stdout.write(s));
  const fetchFn = deps.fetch || globalThis.fetch;
  maskSecrets(env, out);
  const searches = deps.searches || loadSearches();
  const fetchPublic = fetchPublicFrom(env, fetchFn);
  const opts = {
    fetchPublic,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(deps.readTimeoutMs ? { readTimeoutMs: deps.readTimeoutMs } : {}),
  };
  const searchResults = await (deps.checkSearches || checkSearches)({ searches, ...opts });
  const zipResults = await checkZipPages({ searches, ...opts });
  const all = [...Object.values(searchResults), ...Object.values(zipResults)];
  const red = all.filter((r) => !r.pass).length;
  const table = report({ searches: searchResults, zips: zipResults });
  const summary =
    red === 0
      ? `Every stg search reads its permanent total (stock/totals.json), ${all.length} pages.\n`
      : `${red} of ${all.length} stg pages do not read their permanent total (stock/totals.json). If every populated place reads 0, stg has no stock load: read the newest "Stock data (stg)" run.\n`;
  out(`${table}\n${summary}`);
  if (env.GITHUB_STEP_SUMMARY) {
    (deps.appendFile || appendFileSync)(
      env.GITHUB_STEP_SUMMARY,
      `## stg searches\n\n${table}\n${summary}`
    );
  }
  return red === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`stg-watch: ${err.message}`);
      process.exit(1);
    }
  );
}
