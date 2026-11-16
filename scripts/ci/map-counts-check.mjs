#!/usr/bin/env node
/**
 * After the map was used, are the counts where the fixture put them?
 *
 *   node ../../scripts/ci/map-counts-check.mjs                       staging D1 (CI)
 *   node ../../scripts/ci/map-counts-check.mjs --local [--persist-to <dir>]
 *
 * Run from the Worker folder, like scripts/ci/d1-seed-staging.mjs.
 *
 * Why (epic OSE-1880, decision 4; OSE-1896): a map tap is never counted and never
 * touches tracking. bruno/fixtures/map-zoom-area-seed.sql sets known numbers on
 * the seeded events' poster codes and share opens. The Bruno folder
 * "16. Landing Map Zoom" then reads the zoomed pages, and
 * tests/e2e/3-flows/map-place-panel.spec.ts follows every link and presses every
 * Share. This script runs right after each and reads the numbers straight from
 * D1: taps (shortlinks.clicks and shortlink_click_daily), share opens
 * (share_opens_daily) and poster scans (scan_placement_events). Any that moved
 * fails the step.
 *
 * Why D1 and not the API: share opens have no HTTP read at all, and the
 * organizer's tap read is floored. D1 shows every number exactly. Read only.
 *
 * What it prints (OSE-2071): the repository is public, so its CI logs are too.
 * The numbers are compared here and never printed: a line says which number
 * moved, or that it could not be read, and never what it read. The seeded
 * values are in the seed file. When wrangler fails, its output is echoed only
 * if it holds no result row. Never who, only how many; and under 5 not even that.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EVENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((x) => `map-zoom-${x}`);
const CODES = ['mzPub1', 'mzReg1', 'mzChk1', 'mzTix1', 'mzDon1', 'mzHtp1', 'mzOff1', 'mzTix2'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

/** What bruno/fixtures/map-zoom-area-seed.sql sets. tests/unit/ci/map-counts-check.test.js keeps the two in step. */
export const EXPECTED = Object.freeze({
  taps_a: 42,
  taps_b: 8,
  tap_days: 0,
  share_opens: 10,
  share_open_rows: 2,
  scans: 0,
});

/** One row, one column per number. A single statement, so `--command` can run it remotely. */
export const SQL = [
  'SELECT',
  `(SELECT COALESCE(SUM(clicks), 0) FROM shortlinks WHERE event_id = 'map-zoom-a') AS taps_a,`,
  `(SELECT COALESCE(SUM(clicks), 0) FROM shortlinks WHERE event_id = 'map-zoom-b') AS taps_b,`,
  `(SELECT COALESCE(SUM(clicks), 0) FROM shortlink_click_daily WHERE code IN (${list(CODES)})) AS tap_days,`,
  `(SELECT COALESCE(SUM(opens), 0) FROM share_opens_daily WHERE event_id IN (${list(EVENTS)})) AS share_opens,`,
  `(SELECT COUNT(*) FROM share_opens_daily WHERE event_id IN (${list(EVENTS)})) AS share_open_rows,`,
  `(SELECT COUNT(*) FROM scan_placement_events WHERE event_id IN (${list(EVENTS)})) AS scans`,
].join(' ');

/**
 * The first result row in `wrangler d1 execute --json` output, or null. Wrangler
 * may print notices before the JSON, so the JSON is found, not assumed.
 * @param {string} stdout
 * @returns {Record<string, unknown> | null}
 */
export function firstRow(stdout) {
  const text = String(stdout ?? '');
  for (let at = text.indexOf('['); at !== -1; at = text.indexOf('[', at + 1)) {
    try {
      const parsed = JSON.parse(text.slice(at));
      const row = Array.isArray(parsed) ? parsed[0]?.results?.[0] : null;
      if (row && typeof row === 'object') return row;
    } catch {
      // Not the start of the JSON; try the next bracket.
    }
  }
  return null;
}

/**
 * Every number that is not where the seed put it. Empty means unchanged. A
 * number that is missing or not a number is a difference: unknown is never green.
 * Each line names the number and says "moved" or "unreadable". It never carries
 * the value read: these lines go to a public log, and a moved count is often
 * under 5 (OSE-2071).
 * @param {Record<string, unknown> | null} row
 * @param {Record<string, number>} [expected]
 * @returns {string[]}
 */
export function differences(row, expected = EXPECTED) {
  if (!row) return ['no result row was read'];
  return Object.entries(expected)
    .filter(([key, want]) => row[key] !== want)
    .map(([key]) =>
      typeof row[key] === 'number' && Number.isFinite(row[key])
        ? `${key}: moved from the seeded value`
        : `${key}: unreadable (not a number)`
    );
}

/** Where the read goes, in words for the log. */
export function whereRead(argv) {
  return argv.includes('--local') ? 'the local D1' : 'staging D1 (--env staging --remote)';
}

/** @param {string[]} argv */
export function wranglerArgs(argv) {
  const local = argv.includes('--local');
  const at = argv.indexOf('--persist-to');
  const persist = at !== -1 ? argv[at + 1] : undefined;
  if (at !== -1 && (!local || !persist)) return null;
  const where = local
    ? ['--local', ...(persist ? ['--persist-to', persist] : [])]
    : ['--env', 'staging', '--remote'];
  return ['wrangler', 'd1', 'execute', 'DB', ...where, '--json', '--command', SQL];
}

function main(argv) {
  const args = wranglerArgs(argv);
  if (!args) {
    console.error('usage: map-counts-check.mjs [--local [--persist-to <dir>]]');
    return 2;
  }
  // On Windows npx is a .cmd and needs a shell, where the SQL must be one quoted word.
  const win = process.platform === 'win32';
  const r = spawnSync('npx', win ? args.map((a) => (a === SQL ? `"${a}"` : a)) : args, {
    encoding: 'utf8',
    shell: win,
  });
  if (r.status !== 0) {
    // Wrangler's own error, to say why. Output that holds a result row is held
    // back: it would print the counts.
    if (firstRow(r.stdout) === null) process.stdout.write(r.stdout ?? '');
    else console.log('map counts: wrangler output held back (it holds a result row)');
    process.stderr.write(r.stderr ?? '');
    console.log('::error::map counts: the D1 read failed, so nothing was checked');
    return 1;
  }
  const row = firstRow(r.stdout);
  const diffs = differences(row);
  console.log(
    `map counts: read ${row ? Object.keys(EXPECTED).length : 0} numbers from ${whereRead(argv)}`
  );
  if (diffs.length > 0) {
    for (const d of diffs) console.log(`::error::map counts moved: ${d}`);
    console.log(
      '::error::Using the map must move no count (OSE-1896). A map link reached /s/, /e/, /q/ or check-in, or the fixture was not applied.'
    );
    return 1;
  }
  console.log('map counts unchanged: taps, share opens and scans are where the fixture put them');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
