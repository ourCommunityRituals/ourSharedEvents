/* eslint-disable security/detect-non-literal-fs-filename -- every path is stock-out/, a temp file this script names, or a fixed repo file */
// Loads the staging site (stg.) from its fixed seed, one subcommand per workflow
// job (.github/workflows/stock-data-full.yml), run when the owner dispatches it.
// Each reads and writes files under stock-out/, which the workflow passes
// between jobs as artifacts. There is no search (owner, 2026-11-05): the seed
// (stock/seed/seed.json) was made once, by make-seed.mjs.
//
//   seed        the seed re-based to the load day -> accepted rows + businesses
//               (seed.mjs); no geocoding, no network
//   build       accepted rows -> a day of stock data + its manifest (build-full.mjs),
//               listed in R2 before the first API call and kept current there
//   check-swap  accept the placements, check every node, swap or purge per node
//
// Every Cloudflare command goes through one wrangler(args) runner that refuses
// any command not aimed at the staging env. Every I/O seam (fs, fetch,
// wrangler, env, clock) is injected, so the swap is tested without wrangler.
import * as nodeFs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import { chicagoDate } from './validate-finds.mjs';
import { SEED_FILE, rebaseSeed, expectedByNode } from './seed.mjs';
import { listPosts, tokenWarning } from './instagram.mjs';
import { localPosts } from './local-art.mjs';
import { STOCK_BASE_URL, createClient } from './client.mjs';
import { buildDay } from './build-full.mjs';
import {
  checkNodes as realCheckNodes,
  checkSearches as realCheckSearches,
  isUnverified,
} from './check-full.mjs';
import {
  SAFE_ID,
  buildPurgeSql,
  purgeR2Keys,
  manifestName,
  parseManifestName,
  listStaleManifests,
  listNewerManifests,
} from './purge-full.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORKER_DIR = join(ROOT, 'workers', 'oursharedevents');
export const OUT_DIR = join(ROOT, 'stock-out');

export const WRANGLER_ENV = 'staging';
export const D1_DATABASE = 'ocr-db-staging';
export const R2_BUCKET = 'ose-uploads-staging';
export const MANIFEST_PREFIX = 'stock/';
export const INDEX_KEY = `${MANIFEST_PREFIX}manifest-index.json`;

// The staging secrets the Bruno contract run already uses (repo level).
const SECRET_ENV = [
  'ADMIN_KEY',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'INSTAGRAM_ACCESS_TOKEN',
  'OCR_CI_EDGE_TOKEN',
];
// wrangler's answer for an R2 key that is not there. Anything else is a failure.
const MISSING_OBJECT = /specified key does not exist|NoSuchKey/i;
// D1 answers a write while an import is still running with a busy error
// (CCR 2026-11-07 L2-04). It is retried; one that stays busy is "unverified".
const D1_BUSY = /long-running import|SQLITE_BUSY|database is (?:locked|busy)/i;
export const D1_BUSY_TRIES = 3;
const D1_BUSY_WAIT_MS = 15_000;
// The line each command prints when it finished (wrangler 4.145.0). wrangler's bin
// wrapper exits 0 when its child is killed by a signal, so exit 0 without this
// line is a failure (CCR 2026-11-07 R-11).
const COMPLETION = {
  d1: /Executed \d+ (?:queries|commands)/,
  get: /Download complete/,
  put: /Upload complete/,
  delete: /Delete complete/,
};
// No single wrangler command may run longer than this.
const WRANGLER_TIMEOUT_MS = 10 * 60_000;

const unique = (xs) => [...new Set(xs)];
const readJsonFile = (fs, path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const repoJson = (rel) => JSON.parse(nodeFs.readFileSync(join(ROOT, rel), 'utf8'));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Events per node from the committed seed, 0 for a node it leaves empty. */
export function seedExpected(nodes) {
  const list = Array.isArray(nodes) ? nodes : nodes.nodes;
  return expectedByNode(
    repoJson(SEED_FILE),
    list.map((n) => n.id)
  );
}

// ── Target guard ───────────────────────────────────────────────────────────

// Any argument that names production, apart from a temp file's path.
const PRODUCTION_NAME = /production/i;

/**
 * Throws unless a wrangler command names `--env staging` once, runs remote, and
 * targets the staging database or bucket by name. The flag alone is not enough:
 * wrangler resolves a database name account-wide, so `--env staging` with
 * `ocr-db-production` would reach production (CCR 2026-11-07 R-06). Only the
 * two command shapes the swap sends are allowed: `d1 execute <db>` and
 * `r2 object get|put|delete <bucket>/<key>`.
 */
export function assertStaging(args) {
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    throw new Error('wrangler: arguments must be strings');
  }
  const envFlags = args.filter((a) => a === '--env' || a === '-e' || a.startsWith('--env='));
  const at = args.indexOf('--env');
  if (envFlags.length !== 1 || at < 0 || args[at + 1] !== WRANGLER_ENV) {
    throw new Error(`wrangler: every command must name --env ${WRANGLER_ENV}, once`);
  }
  if (!args.includes('--remote')) throw new Error('wrangler: every command must be --remote');
  const fileAt = args.indexOf('--file');
  if (args.some((a, i) => (fileAt < 0 || i !== fileAt + 1) && PRODUCTION_NAME.test(a))) {
    throw new Error('wrangler: a production name is never a target');
  }
  const [tool, sub, verb, target] = args;
  if (tool === 'd1' && sub === 'execute') {
    if (verb !== D1_DATABASE) throw new Error(`wrangler: d1 may target ${D1_DATABASE} only`);
    return;
  }
  if (tool === 'r2' && sub === 'object' && ['get', 'put', 'delete'].includes(verb)) {
    const key =
      typeof target === 'string' && target.startsWith(`${R2_BUCKET}/`)
        ? target.slice(R2_BUCKET.length + 1)
        : '';
    if (key === '') throw new Error(`wrangler: r2 may target ${R2_BUCKET}/<key> only`);
    return;
  }
  throw new Error('wrangler: only d1 execute and r2 object get/put/delete are allowed');
}

/** spawnSync's answer as { code, stdout, stderr }: a signal, a spawn error or a timeout is exit 1. */
export function wranglerResult(r) {
  const failed = !r || r.error || r.signal || r.status === null || r.status === undefined;
  return {
    code: failed ? 1 : r.status,
    stdout: (r && r.stdout) || '',
    stderr: (r && r.stderr) || '',
  };
}

/** A wrangler runner on this machine: `npx wrangler …` in the Worker folder, no shell. */
export function spawnWrangler(args) {
  return wranglerResult(
    spawnSync('npx', ['wrangler', ...args], {
      cwd: WORKER_DIR,
      encoding: 'utf8',
      env: process.env,
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
      timeout: WRANGLER_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
  );
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The D1 and R2 operations the swap needs, each one wrangler command. A failed
 * command throws; its output goes to `log`, never into the thrown message.
 */
export function makeCloud({ wrangler, fs, tmpDir, log = () => {}, sleep = realSleep }) {
  let n = 0;
  const tmp = (name) => join(tmpDir, `stock-${process.pid}-${++n}-${name}`);
  // kind: the completion line this command must print (COMPLETION)
  async function run(op, args, kind) {
    assertStaging(args);
    const r = await wrangler(args);
    const code = r && Number.isInteger(r.code) ? r.code : 1;
    const out = `${(r && r.stdout) || ''}${(r && r.stderr) || ''}`;
    const incomplete = code === 0 && !COMPLETION[kind].test(out);
    return { ok: code === 0 && !incomplete, code, out, op, incomplete };
  }
  const fail = (r) => {
    log(`wrangler ${r.op} failed (exit ${r.code}): ${r.out.slice(-500)}`);
    if (r.incomplete) return new Error(`wrangler ${r.op} failed (exit 0 with no completion line)`);
    const err = new Error(`wrangler ${r.op} failed (exit ${r.code})`);
    if (D1_BUSY.test(r.out)) err.busy = true;
    return err;
  };
  const object = (key) => `${R2_BUCKET}/${key}`;
  const remote = ['--env', WRANGLER_ENV, '--remote'];

  return {
    async d1File(sql) {
      const path = tmp('d1.sql');
      fs.writeFileSync(path, sql);
      const args = ['d1', 'execute', D1_DATABASE, ...remote, '--yes', '--file', path];
      let r = await run('d1 execute', args, 'd1');
      for (let tries = 1; !r.ok && D1_BUSY.test(r.out) && tries < D1_BUSY_TRIES; tries++) {
        log(`D1 busy; retry ${tries} of ${D1_BUSY_TRIES - 1}`);
        await sleep(D1_BUSY_WAIT_MS * tries);
        r = await run('d1 execute', args, 'd1');
      }
      if (!r.ok) throw fail(r);
    },
    /** The object's text, or null when the key does not exist. */
    async r2Get(key) {
      const path = tmp('get.json');
      const r = await run(
        `r2 get ${key}`,
        ['r2', 'object', 'get', object(key), ...remote, '--file', path],
        'get'
      );
      if (!r.ok) {
        if (!r.incomplete && MISSING_OBJECT.test(r.out)) return null;
        throw fail(r);
      }
      return fs.readFileSync(path, 'utf8');
    },
    async r2Put(key, text) {
      const path = tmp('put.json');
      fs.writeFileSync(path, text);
      const r = await run(
        `r2 put ${key}`,
        [
          'r2',
          'object',
          'put',
          object(key),
          ...remote,
          '--file',
          path,
          '--content-type',
          'application/json',
        ],
        'put'
      );
      if (!r.ok) throw fail(r);
    },
    /** Idempotent: a key that is already gone counts as deleted. */
    async r2Delete(key) {
      const r = await run(
        `r2 delete ${key}`,
        ['r2', 'object', 'delete', object(key), ...remote],
        'delete'
      );
      if (!r.ok && (r.incomplete || !MISSING_OBJECT.test(r.out))) throw fail(r);
    },
  };
}

// ── Manifest index (ruling 15) ─────────────────────────────────────────────

/** A manifest name without the bucket's `stock/` prefix. */
export function bareManifestName(key) {
  const s = String(key);
  return s.startsWith(MANIFEST_PREFIX) ? s.slice(MANIFEST_PREFIX.length) : s;
}

/** The index's bare names. null (no index yet) is []. Anything unreadable throws. */
export function parseIndex(text) {
  if (text === null) return [];
  const v = JSON.parse(text);
  const list = Array.isArray(v) ? v : v && Array.isArray(v.manifests) ? v.manifests : null;
  if (!list || !list.every((s) => typeof s === 'string')) {
    throw new Error('manifest index is not a list of names');
  }
  return unique(list.map(bareManifestName));
}

const indexText = (names) => `${JSON.stringify({ manifests: names }, null, 2)}\n`;
const manifestText = (m) => `${JSON.stringify(m, null, 2)}\n`;
const nodesOf = (manifest) => unique((manifest.items || []).map((i) => i.node));

/** The ids a stored manifest records. Anything unreadable throws. */
function storedIds(text) {
  const m = JSON.parse(text);
  if (!m || !Array.isArray(m.items)) throw new Error('no items list');
  return m.items.map((i) => i && i.id);
}

// ── The build's copy in R2 ─────────────────────────────────────────────────

/**
 * Lists today's manifest before the build creates anything: the empty manifest
 * goes to stock/<name>, then the name joins the index. A run cancelled after
 * this is still purged by the next run, which reads only the index. An object
 * already under the name is never overwritten. Throws on any failure.
 */
export async function registerManifest({ cloud, name, manifest }) {
  const names = parseIndex(await cloud.r2Get(INDEX_KEY));
  if ((await cloud.r2Get(`${MANIFEST_PREFIX}${name}`)) !== null) {
    throw new Error(`${name} already exists; another build's record is never overwritten`);
  }
  await cloud.r2Put(`${MANIFEST_PREFIX}${name}`, manifestText(manifest));
  if (!names.includes(name)) await cloud.r2Put(INDEX_KEY, indexText([...names, name]));
}

export const PERSIST_INTERVAL_MS = 20_000;

/**
 * Keeps the R2 copy of a growing manifest: at most one write per interval, the
 * latest change written within an interval of being recorded, and a final write
 * that throws on failure. A throttled write that fails is only a warning.
 * `record` never waits; the clock and timers are injected for tests.
 */
export function makeManifestPersister({
  save,
  now,
  intervalMs = PERSIST_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  warn = () => {},
}) {
  let lastAt = now(); // the registration was the first write
  let latest = null; // text recorded but not yet written
  let writing = null;
  let timer = null;

  function write() {
    const text = latest;
    latest = null;
    lastAt = now();
    writing = Promise.resolve()
      .then(() => save(text))
      .catch((err) => warn(`manifest copy in R2 not updated: ${err.message}`))
      .finally(() => {
        writing = null;
        if (latest !== null) schedule();
      });
  }
  function schedule() {
    if (writing || timer) return; // a write in flight reschedules when it ends
    const wait = lastAt + intervalMs - now();
    if (wait <= 0) {
      write();
      return;
    }
    timer = setTimer(() => {
      timer = null;
      if (latest !== null) schedule();
    }, wait);
  }

  return {
    record(manifest) {
      latest = manifestText(manifest);
      schedule();
    },
    async final(manifest) {
      if (timer) clearTimer(timer);
      timer = null;
      latest = null;
      if (writing) await writing;
      await save(manifestText(manifest));
    },
  };
}

// ── Acceptance (the only UPDATE the stock run sends) ───────────────────────

/** The SQL that sets both acceptance flags on the day's placements, or ''. */
export function acceptSqlFor(manifest) {
  const ids = Array.isArray(manifest.acceptSql) ? manifest.acceptSql : [];
  for (const id of ids) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error('unsafe placement id');
  }
  if (ids.length === 0) return '';
  const list = unique(ids)
    .map((id) => `'${id}'`)
    .join(', ');
  return `UPDATE sponsor_placement SET sponsor_accepted = 1, organizer_accepted = 1 WHERE id IN (${list});\n`;
}

// ── Check, then swap ───────────────────────────────────────────────────────

/**
 * Persist today's manifest, accept its placements, check every node, then swap
 * per node: a passing node purges its ids from every stale manifest, a failing
 * node purges today's ids for that node. A manifest leaves the index only once
 * its purge has succeeded for every node it records. With `buildFailed`, the
 * partial manifest is persisted and all of its nodes are purged as failing.
 */
export async function checkSwap({
  manifest,
  buildFailed = false,
  nodes,
  // node id -> stock events it must list (seedExpected)
  expected,
  today,
  runId,
  runAttempt,
  cloud,
  checkNodes = realCheckNodes,
  client,
  fetchPublic,
  // query -> the total it must read on the site (stock/totals.json searches); null skips
  searches = null,
  checkSearches = realCheckSearches,
}) {
  const nodeList = Array.isArray(nodes) ? nodes : nodes.nodes;
  const problems = [];
  const purges = [];
  let searchResults = null;
  const todayName = manifestName(manifest.date, runId, runAttempt);
  // A node retired from nodes.json (`retired`, e.g. Beverly on 2026-11-05) is still
  // purged from every manifest, with no checks, so an older manifest that records it
  // can leave the index. A node that is neither active nor retired is never purged,
  // so its manifest would stay listed for good: say so, and turn the run red.
  const retired = Array.isArray(nodes) ? [] : nodes.retired || [];
  const knownNodes = new Set([...nodeList.map((n) => n.id), ...retired]);
  const todayIds = new Set((manifest.items || []).map((i) => i.id));
  const unknownNodes = (name, m) => {
    const unknown = nodesOf(m).filter((node) => !knownNodes.has(node));
    if (unknown.length) {
      problems.push(
        `${name} records node(s) not in stock/nodes.json: ${unknown.join(', ')}; it stays in the index`
      );
    }
  };
  const allFailing = (reason) =>
    Object.fromEntries(
      nodeList.map((n) => [
        n.id,
        {
          pass: false,
          count: 0,
          expected: expected[n.id] ?? 0,
          totalListed: 0,
          reasons: [reason],
        },
      ])
    );

  // okNodes: name -> nodes whose purge succeeded in this run
  const okNodes = new Map();
  async function purge(name, m, node) {
    const entry = { name, node, ok: false };
    purges.push(entry);
    try {
      const sql = buildPurgeSql(m, [node]);
      const keys = purgeR2Keys(m, [node]);
      for (const key of keys) {
        if (key.startsWith(MANIFEST_PREFIX) || key.includes('..')) {
          throw new Error('upload key points at the manifest folder');
        }
      }
      if (sql !== '') await cloud.d1File(sql);
      for (const key of keys) await cloud.r2Delete(key);
      entry.ok = true;
      if (!okNodes.has(name)) okNodes.set(name, new Set());
      okNodes.get(name).add(node);
    } catch (err) {
      entry.error = err.message;
    }
  }
  const purgeAll = async (name, m) => {
    for (const node of nodesOf(m)) await purge(name, m, node);
  };
  const fullyPurged = (name, m) => {
    const done = okNodes.get(name) || new Set();
    return nodesOf(m).every((node) => done.has(node));
  };
  const report = (results, index) => ({
    todayName,
    results,
    purges,
    problems,
    index,
    searches: searchResults,
    exitCode:
      buildFailed ||
      problems.length > 0 ||
      purges.some((p) => !p.ok) ||
      Object.values(results).some((r) => !r.pass) ||
      (searchResults !== null && Object.values(searchResults).some((r) => !r.pass))
        ? 1
        : 0,
  });

  // Today's rows when their manifest could not be listed: purge them all. A purge
  // that fails leaves live rows, and the summary says where they are recorded.
  async function purgeUnsaved({ objectSaved = false } = {}) {
    await purgeAll(todayName, manifest);
    const left = purges.filter((p) => p.name === todayName && !p.ok).map((p) => p.node);
    if (!left.length) return;
    const where = objectSaved
      ? `the manifest object ${MANIFEST_PREFIX}${todayName} exists in R2 but is not listed in the index; add it by hand or rely on this run's artifact`
      : `they are recorded only in this run's stock-manifest artifact; purge them by hand`;
    problems.push(`rows of ${todayName} for ${left.join(', ')} are still live; ${where}`);
  }

  // 1. The index, then today's manifest object and its name in the index. If
  //    either cannot be written, today's rows are purged so nothing orphans.
  //    The build registered today's name and kept a copy as it went, so an
  //    object holding only ids of this manifest is this run's own record and is
  //    overwritten with the complete one. An object holding any other id is
  //    another build's record, and is never overwritten.
  let names;
  try {
    names = parseIndex(await cloud.r2Get(INDEX_KEY));
  } catch (err) {
    problems.push(`manifest index unreadable: ${err.message}; index left as it was`);
    await purgeUnsaved();
    return report(allFailing('index-unreadable'), { written: false });
  }
  const before = names;
  const stored = before.includes(todayName) ? before : [...before, todayName];
  let objectSaved = false;
  try {
    const existing = await cloud.r2Get(`${MANIFEST_PREFIX}${todayName}`);
    if (existing !== null) {
      let foreign;
      try {
        foreign = unique(storedIds(existing).filter((id) => !todayIds.has(id)));
      } catch (err) {
        foreign = null;
        problems.push(
          `${todayName} exists but is unreadable (${err.message}); another build's record is never overwritten`
        );
      }
      if (foreign && foreign.length) {
        const shown = foreign.slice(0, 5).join(', ');
        problems.push(
          `${todayName} already exists with ids this run's manifest does not hold (${shown}${
            foreign.length > 5 ? `, and ${foreign.length - 5} more` : ''
          }); another build's record is never overwritten`
        );
      }
      if (foreign === null || foreign.length) {
        await purgeUnsaved();
        return report(allFailing('manifest-exists'), { before, written: false });
      }
    }
    await cloud.r2Put(`${MANIFEST_PREFIX}${todayName}`, manifestText(manifest));
    objectSaved = true;
    if (stored !== before) await cloud.r2Put(INDEX_KEY, indexText(stored));
  } catch (err) {
    problems.push(
      objectSaved
        ? `today's manifest is saved but not listed in the index: ${err.message}`
        : `today's manifest not saved: ${err.message}`
    );
    await purgeUnsaved({ objectSaved });
    return report(allFailing('manifest-not-saved'), { before, written: false });
  }
  unknownNodes(todayName, manifest);
  let live = [...stored];

  async function writeIndex(results) {
    if (live.length === stored.length && live.every((n, i) => n === stored[i])) {
      return report(results, { before, after: live, written: true });
    }
    try {
      await cloud.r2Put(INDEX_KEY, indexText(live));
      return report(results, { before, after: live, written: true });
    } catch (err) {
      problems.push(`manifest index not updated: ${err.message}`);
      return report(results, { before, after: stored, written: false });
    }
  }

  // 2. A failed build: purge every node of the partial manifest.
  if (buildFailed) {
    await purgeAll(todayName, manifest);
    if (fullyPurged(todayName, manifest)) live = live.filter((n) => n !== todayName);
    return writeIndex(allFailing('build-failed'));
  }

  // 2b. A later run's load is listed: this run is a re-run of an older one, and its
  //     load would sit beside the later one. It is superseded: purge it, keep the
  //     later load (CCR 2026-11-07 L3-08; ordered by run start, never by date).
  const newer = listNewerManifests(before, todayName);
  if (newer.length) {
    problems.push(`${todayName} is superseded by ${newer.join(', ')}; its rows are purged`);
    await purgeAll(todayName, manifest);
    if (fullyPurged(todayName, manifest)) live = live.filter((n) => n !== todayName);
    return writeIndex(allFailing('superseded'));
  }

  // 3. Accept the day's placements, then check every node. A database still busy
  //    after its retries is a harness fault: every node is unverified (decision 2A).
  let results;
  let acceptSql;
  try {
    acceptSql = acceptSqlFor(manifest);
    if (acceptSql !== '') await cloud.d1File(acceptSql);
  } catch (err) {
    problems.push(`placements not accepted: ${err.message}`);
    results = allFailing(err.busy ? 'd1-busy' : 'accept-failed');
  }
  if (!results) {
    try {
      results = await checkNodes({
        client,
        manifest,
        nodes: nodeList,
        today,
        expected,
        fetchPublic,
      });
    } catch (err) {
      problems.push(`check did not run: ${err.message}`);
      results = allFailing('check-error');
    }
  }

  // 4. The stale manifests, oldest first. One that cannot be read stays listed.
  const stale = [];
  for (const name of listStaleManifests(before, todayName)) {
    try {
      const text = await cloud.r2Get(`${MANIFEST_PREFIX}${name}`);
      if (text === null) {
        problems.push(`${name} is listed but missing; it stays in the index`);
        continue;
      }
      const m = JSON.parse(text);
      if (!m || !Array.isArray(m.items)) throw new Error('no items list');
      // Never purge, from a stale manifest, an id today's manifest also records: a
      // re-run of this job alone (next attempt, same artifact) lists the earlier
      // attempt as stale with the very ids that just passed. What remains is all
      // the stale manifest still holds; with nothing left it leaves the index.
      const own = { ...m, items: m.items.filter((i) => !todayIds.has(i.id)) };
      unknownNodes(name, own);
      stale.push({ name, manifest: own });
    } catch (err) {
      problems.push(`${name} unreadable: ${err.message}; it stays in the index`);
    }
  }

  // Owner decision 2A (2026-11-07): a node whose only failures are reads the harness
  // could not make (edge challenge, busy database) is unverified. It keeps its load,
  // so it swaps like a passing node, and the run is red.
  for (const r of Object.values(results)) if (r && isUnverified(r)) r.unverified = true;
  const swaps = (id) => Boolean(results[id] && (results[id].pass || results[id].unverified));

  // 4b. The searches, before anything is purged, so they gate the swap (R-09). Each
  //     is judged on what the swap would leave: yesterday's ids for a swapping node
  //     and today's for a failing one are not counted. A search off its total stops
  //     every node's swap; an unverified one keeps the load and turns the run red.
  if (searches !== null) {
    const exclude = new Set();
    for (const node of nodeList) {
      const from = swaps(node.id) ? stale.map((x) => x.manifest) : [manifest];
      for (const m of from) {
        for (const i of m.items || []) {
          if (i.kind === 'event' && i.node === node.id) exclude.add(String(i.id));
        }
      }
    }
    try {
      searchResults = await checkSearches({ searches, fetchPublic, exclude });
    } catch (err) {
      problems.push(`searches did not run: ${err.message}`);
      searchResults = {};
    }
    const off = Object.entries(searchResults).filter(([, r]) => !r.pass && !isUnverified(r));
    if (off.length || Object.keys(searchResults).length === 0) {
      for (const r of Object.values(results)) {
        r.pass = false;
        r.unverified = false;
        r.reasons = [...(r.reasons || []), 'searches-off-total'];
      }
    }
  }

  // 5. Swap per node.
  for (const node of nodeList) {
    if (swaps(node.id)) {
      for (const s of stale) await purge(s.name, s.manifest, node.id);
    } else {
      await purge(todayName, manifest, node.id);
    }
  }
  // Retired nodes: purge their rows from every manifest that records them.
  for (const node of retired) {
    for (const s of stale)
      if (nodesOf(s.manifest).includes(node)) await purge(s.name, s.manifest, node);
    if (nodesOf(manifest).includes(node)) await purge(todayName, manifest, node);
  }

  // 6. A manifest leaves the index once every node it records is purged.
  for (const s of stale) {
    if (fullyPurged(s.name, s.manifest)) live = live.filter((n) => n !== s.name);
  }
  if (fullyPurged(todayName, manifest)) live = live.filter((n) => n !== todayName);
  // Mark today's copy as swapped, so a later attempt's no-artifact recovery
  // (registeredCopy) never mistakes this completed load for an interrupted build.
  // Only a load where at least one node passed is live; one where none passed
  // stays recoverable so a later attempt can still purge it.
  if (live.includes(todayName) && nodeList.some((n) => swaps(n.id))) {
    try {
      await cloud.r2Put(
        `${MANIFEST_PREFIX}${todayName}`,
        manifestText({ ...manifest, swapped: true })
      );
    } catch (err) {
      problems.push(`${todayName} could not be marked swapped: ${err.message}`);
    }
  }
  return writeIndex(results);
}

// ── Run summary ────────────────────────────────────────────────────────────

const cell = (s) =>
  String(s)
    .replace(/[|\r\n]/g, ' ')
    .trim();

function reasonsText(reasons) {
  if (!reasons || reasons.length === 0) return '';
  const shown = reasons.slice(0, 8).map(cell).join(', ');
  return reasons.length > 8 ? `${shown}, and ${reasons.length - 8} more` : shown;
}

/** The markdown the check-swap job writes to $GITHUB_STEP_SUMMARY. */
export function renderSummary({ report, nodes, expected, manifest, notes, searches = null }) {
  const nodeList = Array.isArray(nodes) ? nodes : nodes.nodes;
  const lines = [
    '## Stock data: stg',
    '',
    '| Node | Expected (seed) | Stock listed | Total listed | Result | Reasons |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const skipped = [];
  for (const node of nodeList) {
    const r = report.results[node.id] || { pass: false, count: 0, totalListed: 0, reasons: [] };
    lines.push(
      `| ${cell(node.id)} | ${expected[node.id] ?? 0} | ${r.count} | ${r.totalListed} | ${
        r.pass ? 'pass' : r.unverified ? 'UNVERIFIED (kept)' : 'FAIL'
      } | ${reasonsText(r.reasons)} |`
    );
    if (Array.isArray(r.skipped) && r.skipped.includes('landing-map')) {
      skipped.push(
        (expected[node.id] ?? 0) === 0
          ? `${node.id} is expected empty: its landing-map check is skipped`
          : `${node.id} holds ${expected[node.id]}, under the map gate: its landing-map check is skipped`
      );
    }
  }
  const purgeFailures = report.purges.filter((p) => !p.ok);
  const edgeReasons = [
    ...Object.values(report.results || {}),
    ...Object.values(searches || {}),
  ].flatMap((r) => (r.reasons || []).filter((x) => String(x).startsWith('edge-challenged')));
  const challenged = edgeReasons.length > 0;
  // The first challenged read that carries a Ray ID: look it up in Security → Events.
  const firstRay = edgeReasons.find((x) => / ray=/.test(String(x)));
  const notesList = [
    challenged
      ? "The Cloudflare edge challenged the check's public reads (cf-mitigated: challenge), so the Worker never answered them. The staging WAF skip rule for the X-OCR-CI header must cover /q/*, /s/* and /events/* on stg, and OCR_CI_EDGE_TOKEN must match it (OSE-939)."
      : null,
    firstRay
      ? `First challenged read: ${String(firstRay)
          .replace(/^edge-challenged:?/, '')
          .trim()}. Look up the ray in Cloudflare → Security → Events to see the rule that challenged it.`
      : null,
    ...((manifest && manifest.warnings) || []).map((w) => `Build: ${w}`),
    notes && notes.instagramWarning ? `Instagram: ${notes.instagramWarning}` : null,
    notes && notes.tokenWarning ? `Instagram token: ${notes.tokenWarning}` : null,
    notes && notes.error ? `Build failed: ${notes.error}` : null,
    ...skipped,
    ...report.problems,
    ...purgeFailures.map((p) => `Purge failed: ${p.name} ${p.node} (${p.error})`),
  ].filter(Boolean);
  if (searches) {
    lines.push(
      '',
      '### Searches on the site',
      '',
      '| Search | Expected | Reads | Result |',
      '| --- | --- | --- | --- |'
    );
    for (const [q, r] of Object.entries(searches)) {
      lines.push(
        `| ${cell(q)} | ${r.expected} | ${r.count === null ? 'unreadable' : r.count} | ${r.pass ? 'pass' : 'FAIL'} |`
      );
    }
  }
  lines.push('', `Manifest: \`${cell(report.todayName)}\``);
  if (report.index && report.index.after) {
    lines.push(`Live manifests: ${report.index.after.map((n) => `\`${cell(n)}\``).join(', ')}`);
  }
  if (notesList.length) {
    lines.push('', '### Warnings', '');
    for (const w of notesList) lines.push(`- ${cell(w)}`);
  }
  return `${lines.join('\n')}\n`;
}

// ── The CLI glue: env, files and the site ──────────────────────────────────

/** Ask the runner to mask each secret the step holds. Never prints a value otherwise. */
export function maskSecrets(env, write) {
  for (const name of SECRET_ENV) {
    const value = env[name];
    if (typeof value !== 'string' || value === '') continue;
    for (const line of value.split(/\r?\n/)) if (line) write(`::add-mask::${line}\n`);
  }
}

function need(env, name) {
  const v = env[name];
  if (typeof v !== 'string' || v === '') throw new Error(`${name} is not set`);
  return v;
}

export function clientFrom(env, fetchFn) {
  return createClient({
    baseUrl: STOCK_BASE_URL,
    adminKey: need(env, 'ADMIN_KEY'),
    accessClientId: need(env, 'CF_ACCESS_CLIENT_ID'),
    accessClientSecret: need(env, 'CF_ACCESS_CLIENT_SECRET'),
    fetch: fetchFn,
  });
}

/**
 * Public reads: the Access service-token headers only, never the admin Bearer, never a
 * redirect. With OCR_CI_EDGE_TOKEN set they also carry X-OCR-CI, which the staging WAF
 * skip rule matches so the edge's managed challenge lets the check's reads through
 * (OSE-939). Without it, a challenged read is reported as edge-challenged.
 */
export function fetchPublicFrom(env, fetchFn) {
  const id = need(env, 'CF_ACCESS_CLIENT_ID');
  const secret = need(env, 'CF_ACCESS_CLIENT_SECRET');
  const edge = typeof env.OCR_CI_EDGE_TOKEN === 'string' ? env.OCR_CI_EDGE_TOKEN : '';
  const headers = { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
  if (edge !== '') headers['X-OCR-CI'] = edge;
  const origin = new URL(STOCK_BASE_URL).origin;
  return (url, init = {}) => {
    if (new URL(url).origin !== origin) throw new Error('public read off the site');
    return fetchFn(url, {
      method: init.method || 'GET',
      redirect: 'manual',
      headers: { ...headers },
      ...(init.signal ? { signal: init.signal } : {}),
    });
  };
}

/** The catalog as [{ id, name, category }], from GET /api/v2/admin/event-types. */
export async function fetchCatalog(client) {
  const res = await client.get('/api/v2/admin/event-types');
  const types = [];
  for (const c of (res && res.categories) || []) {
    for (const t of c.types || []) types.push({ id: t.id, name: t.name, category: c.code });
  }
  if (types.length === 0) throw new Error('event type catalog is empty');
  return types;
}

function summarize(env, fs, text) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text);
}

/**
 * The seed re-based to today's Chicago date: accepted.json and businesses.json
 * in the shape the build consumes, and load.json naming the day, so the build
 * records the day the rows were placed on even if it starts after midnight.
 * Reads only committed files; no geocoding and no network.
 */
export async function runSeed({ env, fs, now, outDir }) {
  const loadDay = chicagoDate(now());
  const seed = repoJson(SEED_FILE);
  const nodes = repoJson('stock/nodes.json').nodes;
  const known = new Set(nodes.map((n) => n.id));
  const { accepted, businesses } = rebaseSeed(seed, loadDay);
  const stray = [...new Set([...accepted, ...businesses].map((r) => r.node))].filter(
    (id) => !known.has(id)
  );
  if (stray.length)
    throw new Error(`seed names node(s) not in stock/nodes.json: ${stray.join(', ')}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(join(outDir, 'accepted.json'), `${JSON.stringify(accepted, null, 2)}\n`);
  fs.writeFileSync(join(outDir, 'businesses.json'), `${JSON.stringify(businesses, null, 2)}\n`);
  fs.writeFileSync(
    join(outDir, 'load.json'),
    `${JSON.stringify({ loadDay, seededOn: seed.seededOn }, null, 2)}\n`
  );
  const expected = expectedByNode(
    seed,
    nodes.map((n) => n.id)
  );
  const lines = [
    '## Stock seed re-based',
    '',
    `Seeded on ${seed.seededOn}; loaded for ${loadDay}.`,
    '',
    '| Node | Events | Businesses |',
    '| --- | --- | --- |',
    ...nodes.map(
      (n) => `| ${n.id} | ${expected[n.id]} | ${businesses.filter((b) => b.node === n.id).length} |`
    ),
  ];
  summarize(env, fs, `${lines.join('\n')}\n`);
  return 0;
}

export async function runBuild({
  env,
  fs,
  fetch: fetchFn,
  wrangler,
  now,
  outDir,
  tmpDir,
  log = () => {},
  setTimer,
  clearTimer,
}) {
  // The day the seed job placed the rows on, when it says so; else today.
  const loadPath = join(outDir, 'load.json');
  const loadDay = fs.existsSync(loadPath) ? readJsonFile(fs, loadPath).loadDay : null;
  if (loadDay !== null && !DAY_RE.test(String(loadDay))) throw new Error('load.json: bad loadDay');
  const today = loadDay ?? chicagoDate(now());
  const notes = { ok: false, date: today, instagramWarning: null, tokenWarning: null, error: null };
  const writeNotes = () =>
    fs.writeFileSync(join(outDir, 'build-notes.json'), `${JSON.stringify(notes, null, 2)}\n`);
  let manifest = null;
  const saveManifest = (m) => fs.writeFileSync(join(outDir, 'manifest.json'), manifestText(m));
  // Before the first API call: a build killed before it records anything still
  // hands check-swap a manifest (an empty one), so check-swap reports it red.
  const empty = { date: today, items: [], qr: [], acceptSql: [], short: {}, warnings: [] };
  saveManifest(empty);
  // Also before the first API call, today's manifest is listed in R2, so the
  // next run purges this build's rows even if check-swap never runs. If it
  // cannot be listed, nothing is created.
  let persister;
  try {
    const name = manifestName(today, need(env, 'GITHUB_RUN_ID'), need(env, 'GITHUB_RUN_ATTEMPT'));
    const cloud = makeCloud({ wrangler, fs, tmpDir, log });
    await registerManifest({ cloud, name, manifest: empty });
    persister = makeManifestPersister({
      save: (text) => cloud.r2Put(`${MANIFEST_PREFIX}${name}`, text),
      now: () => now().getTime(),
      ...(setTimer ? { setTimer } : {}),
      ...(clearTimer ? { clearTimer } : {}),
      warn: (msg) => log(`warning: ${msg}`),
    });
  } catch (err) {
    notes.error = `manifest not registered in R2: ${err.message}`;
    writeNotes();
    return 1;
  }
  let latest = empty;
  const onRecord = (m) => {
    latest = m;
    saveManifest(m);
    persister.record(m);
  };
  try {
    const client = clientFrom(env, fetchFn);
    const catalog = await fetchCatalog(client);
    // The owner's photographs in stock/art come first and need no token
    // (owner 2026-11-05); Instagram posts are added when a token is set.
    let posts = localPosts(nodeFs, join(ROOT, 'stock', 'art'));
    if (env.INSTAGRAM_ACCESS_TOKEN) {
      posts = posts.concat(await listPosts({ token: env.INSTAGRAM_ACCESS_TOKEN, fetch: fetchFn }));
      notes.instagramWarning = listPosts.warning || null;
      notes.tokenWarning = tokenWarning(env.INSTAGRAM_TOKEN_ISSUED || '', today);
    }
    const nodes = repoJson('stock/nodes.json').nodes;
    manifest = await buildDay({
      client,
      accepted: readJsonFile(fs, join(outDir, 'accepted.json')),
      businesses: readJsonFile(fs, join(outDir, 'businesses.json')),
      regionals: repoJson('stock/regionals.json'),
      posts,
      artTags: repoJson('stock/art-tags.json'),
      typeCategory: new Map(catalog.map((t) => [t.id, t.category])),
      expected: seedExpected(nodes),
      date: today,
      nodeIds: nodes.map((n) => n.id),
      fetch: fetchFn,
      // synchronous, after every id: a build killed mid-run leaves what it made on
      // record, in the local file at once and in R2 within PERSIST_INTERVAL_MS
      onRecord,
    });
    notes.ok = true;
  } catch (err) {
    notes.error = err.message;
    if (err.manifest) manifest = err.manifest;
  }
  if (manifest) saveManifest(manifest);
  try {
    await persister.final(manifest || latest);
  } catch (err) {
    notes.ok = false;
    const msg = `manifest not saved to R2: ${err.message}`;
    notes.error = notes.error ? `${notes.error}; ${msg}` : msg;
  }
  writeNotes();
  return notes.ok ? 0 : 1;
}

/**
 * The manifest this run's build registered in R2, found in the index by this
 * run's id (the build's day is not known without the artifact), as
 * { name, attempt, manifest }; null when there is none that can be read.
 * Re-running check-swap alone raises GITHUB_RUN_ATTEMPT while the build's
 * registration keeps the attempt it ran in, so the current attempt is preferred,
 * then the highest attempt of the same run whose object can be read.
 */
export async function registeredCopy({ cloud, env, log }) {
  const runId = env.GITHUB_RUN_ID;
  const attempt = env.GITHUB_RUN_ATTEMPT;
  if (!runId || !attempt) return null;
  let names;
  try {
    names = parseIndex(await cloud.r2Get(INDEX_KEY));
  } catch (err) {
    log(`the manifest index could not be read: ${err.message}`);
    return null;
  }
  const rank = (p) => (p.attempt === String(attempt) ? 0 : 1);
  const ours = names
    .map((name) => ({ name, p: parseManifestName(name) }))
    .filter(({ p }) => p !== null && p.runId === String(runId))
    .sort((a, b) => {
      if (rank(a.p) !== rank(b.p)) return rank(a.p) - rank(b.p);
      const x = BigInt(a.p.attempt);
      const y = BigInt(b.p.attempt);
      return x === y ? 0 : x > y ? -1 : 1;
    });
  for (const { name, p } of ours) {
    try {
      const text = await cloud.r2Get(`${MANIFEST_PREFIX}${name}`);
      if (text === null) throw new Error('listed but missing');
      const manifest = JSON.parse(text);
      if (!manifest || !Array.isArray(manifest.items) || typeof manifest.date !== 'string') {
        throw new Error('no items list');
      }
      // A completed swap is a live load, not an interrupted build: never recover it.
      // A completed load ends the search: an older attempt of the same run may hold
      // the very rows that load now serves, so it is never recovered either.
      if (manifest.swapped === true) {
        log(`the R2 copy ${name} is a completed load; recovery stops here`);
        return null;
      }
      return { name, attempt: p.attempt, manifest };
    } catch (err) {
      log(`the R2 copy ${name} could not be read: ${err.message}`);
    }
  }
  return null;
}

export async function runCheckSwap({
  env,
  fs,
  fetch: fetchFn,
  wrangler,
  outDir,
  tmpDir,
  checkNodes,
  checkSearches = realCheckSearches,
  log,
}) {
  const manifestPath = join(outDir, 'manifest.json');
  const cloud = makeCloud({ wrangler, fs, tmpDir, log });
  let manifest;
  let notes;
  // The attempt whose name today's manifest goes by: this one, or, when the R2
  // copy stands in, the attempt that registered it, so the swap works on that copy.
  let runAttempt = null;
  if (fs.existsSync(manifestPath)) {
    manifest = readJsonFile(fs, manifestPath);
    const notesPath = join(outDir, 'build-notes.json');
    notes = fs.existsSync(notesPath) ? readJsonFile(fs, notesPath) : { ok: false };
  } else {
    // No artifact: the build's own copy in R2, if it registered one, stands in.
    const copy = await registeredCopy({ cloud, env, log });
    if (!copy) {
      const msg =
        'No manifest was saved; rows created by an interrupted build may need a manual purge.';
      log(msg);
      summarize(env, fs, `## Stock data: stg\n\n${msg}\n`);
      return 1;
    }
    manifest = copy.manifest;
    runAttempt = copy.attempt;
    notes = {
      ok: false,
      error: `the stock-manifest artifact is missing; every node of the R2 copy of ${copy.name} is purged`,
    };
  }
  const buildFailed = notes.ok !== true || env.BUILD_RESULT !== 'success';
  const nodes = repoJson('stock/nodes.json');
  const expected = seedExpected(nodes);
  const report = await checkSwap({
    manifest,
    buildFailed,
    nodes,
    expected,
    // The build's day, not the clock's: a check that runs past Chicago midnight
    // still judges the 90-day window from the day the rows were built for.
    today: manifest.date,
    runId: need(env, 'GITHUB_RUN_ID'),
    runAttempt: runAttempt ?? need(env, 'GITHUB_RUN_ATTEMPT'),
    cloud,
    checkNodes,
    client: buildFailed ? null : clientFrom(env, fetchFn),
    fetchPublic: buildFailed ? null : fetchPublicFrom(env, fetchFn),
    // Owner 2026-11-07: every zip and town search reads its permanent total on the
    // site (stock/totals.json `searches`). Checked before the purge, so it gates it.
    searches: repoJson('stock/totals.json').searches,
    checkSearches,
  });
  const searches = report.searches;
  summarize(env, fs, renderSummary({ report, nodes, expected, manifest, notes, searches }));
  for (const [id, r] of Object.entries(report.results)) {
    if (!r.pass) log(`node ${id} failed: ${reasonsText(r.reasons)}`);
  }
  const searchFailed = searches !== null && Object.values(searches).some((r) => !r.pass);
  for (const [q, r] of Object.entries(searches || {})) {
    if (!r.pass) log(`search ${q} failed: ${reasonsText(r.reasons)}`);
  }
  return report.exitCode || (searchFailed ? 1 : 0);
}

const COMMANDS = {
  seed: runSeed,
  build: runBuild,
  'check-swap': runCheckSwap,
};

export async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const command = COMMANDS[argv[0]];
  const log = deps.log || ((line) => console.log(line));
  if (!command) {
    log(`usage: run-day.mjs <${Object.keys(COMMANDS).join('|')}>`);
    return 2;
  }
  if (env.GITHUB_ACTIONS === 'true') maskSecrets(env, (s) => process.stdout.write(s));
  return command({
    env,
    fs: deps.fs || nodeFs,
    fetch: deps.fetch || globalThis.fetch,
    wrangler: deps.wrangler || spawnWrangler,
    now: deps.now || (() => new Date()),
    outDir: deps.outDir || OUT_DIR,
    tmpDir: deps.tmpDir || tmpdir(),
    checkNodes: deps.checkNodes,
    log,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`run-day: ${err.message}`);
      process.exit(1);
    }
  );
}
