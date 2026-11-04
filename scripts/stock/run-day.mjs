/* eslint-disable security/detect-non-literal-fs-filename -- every path is stock-out/, a temp file this script names, or a fixed repo file */
// The morning run for the full staging site, one subcommand per workflow job
// (.github/workflows/stock-data-full.yml). Each reads and writes files under
// stock-out/, which the workflow passes between jobs as artifacts.
//
//   prepare-search  event type catalog + the rendered search prompt
//   search-output   the search's two files against their schemas
//   validate        finds -> accepted rows (validate-finds.mjs)
//   build           accepted rows -> a day of stock data + its manifest (build-full.mjs)
//   check-swap      accept the placements, check every node, swap or purge per node
//
// Every Cloudflare command goes through one wrangler(args) runner that refuses
// any command not aimed at the staging-full env. Every I/O seam (fs, fetch,
// wrangler, env, clock) is injected, so the swap is tested without wrangler.
import * as nodeFs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import { validateFinds, chicagoDate } from './validate-finds.mjs';
import { listPosts, tokenWarning } from './instagram.mjs';
import { STOCK_BASE_URL, createClient } from './client.mjs';
import { buildDay } from './build-full.mjs';
import { checkNodes as realCheckNodes } from './check-full.mjs';
import {
  SAFE_ID,
  buildPurgeSql,
  purgeR2Keys,
  manifestName,
  listStaleManifests,
} from './purge-full.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORKER_DIR = join(ROOT, 'workers', 'oursharedevents');
export const OUT_DIR = join(ROOT, 'stock-out');

export const WRANGLER_ENV = 'staging-full';
export const D1_DATABASE = 'ocr-db-staging-full';
export const R2_BUCKET = 'ose-uploads-staging-full';
export const MANIFEST_PREFIX = 'stock/';
export const INDEX_KEY = `${MANIFEST_PREFIX}manifest-index.json`;

const WINDOW_DAYS = 90;
const SECRET_ENV = [
  'STG_FULL_ADMIN_KEY',
  'STG_FULL_ACCESS_CLIENT_ID',
  'STG_FULL_ACCESS_CLIENT_SECRET',
  'INSTAGRAM_ACCESS_TOKEN',
];
// wrangler's answer for an R2 key that is not there. Anything else is a failure.
const MISSING_OBJECT = /specified key does not exist|NoSuchKey/i;

const unique = (xs) => [...new Set(xs)];
const readJsonFile = (fs, path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const repoJson = (rel) => JSON.parse(nodeFs.readFileSync(join(ROOT, rel), 'utf8'));

// ── Target guard ───────────────────────────────────────────────────────────

/** Throws unless a wrangler command names `--env staging-full` once and runs remote. */
export function assertStagingFull(args) {
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    throw new Error('wrangler: arguments must be strings');
  }
  const envFlags = args.filter((a) => a === '--env' || a === '-e' || a.startsWith('--env='));
  const at = args.indexOf('--env');
  if (envFlags.length !== 1 || at < 0 || args[at + 1] !== WRANGLER_ENV) {
    throw new Error(`wrangler: every command must name --env ${WRANGLER_ENV}, once`);
  }
  if (!args.includes('--remote')) throw new Error('wrangler: every command must be --remote');
}

/** A wrangler runner on this machine: `npx wrangler …` in the Worker folder, no shell. */
export function spawnWrangler(args) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    env: process.env,
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { code: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/**
 * The D1 and R2 operations the swap needs, each one wrangler command. A failed
 * command throws; its output goes to `log`, never into the thrown message.
 */
export function makeCloud({ wrangler, fs, tmpDir, log = () => {} }) {
  let n = 0;
  const tmp = (name) => join(tmpDir, `stock-${process.pid}-${++n}-${name}`);
  async function run(op, args) {
    assertStagingFull(args);
    const r = await wrangler(args);
    const code = r && Number.isInteger(r.code) ? r.code : 1;
    const out = `${(r && r.stdout) || ''}${(r && r.stderr) || ''}`;
    return { ok: code === 0, code, out, op };
  }
  const fail = (r) => {
    log(`wrangler ${r.op} failed (exit ${r.code}): ${r.out.slice(-500)}`);
    return new Error(`wrangler ${r.op} failed (exit ${r.code})`);
  };
  const object = (key) => `${R2_BUCKET}/${key}`;
  const remote = ['--env', WRANGLER_ENV, '--remote'];

  return {
    async d1File(sql) {
      const path = tmp('d1.sql');
      fs.writeFileSync(path, sql);
      const r = await run('d1 execute', [
        'd1',
        'execute',
        D1_DATABASE,
        ...remote,
        '--yes',
        '--file',
        path,
      ]);
      if (!r.ok) throw fail(r);
    },
    /** The object's text, or null when the key does not exist. */
    async r2Get(key) {
      const path = tmp('get.json');
      const r = await run(`r2 get ${key}`, [
        'r2',
        'object',
        'get',
        object(key),
        ...remote,
        '--file',
        path,
      ]);
      if (!r.ok) {
        if (MISSING_OBJECT.test(r.out)) return null;
        throw fail(r);
      }
      return fs.readFileSync(path, 'utf8');
    },
    async r2Put(key, text) {
      const path = tmp('put.json');
      fs.writeFileSync(path, text);
      const r = await run(`r2 put ${key}`, [
        'r2',
        'object',
        'put',
        object(key),
        ...remote,
        '--file',
        path,
        '--content-type',
        'application/json',
      ]);
      if (!r.ok) throw fail(r);
    },
    async r2Delete(key) {
      const r = await run(`r2 delete ${key}`, ['r2', 'object', 'delete', object(key), ...remote]);
      if (!r.ok) throw fail(r);
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
const nodesOf = (manifest) => unique((manifest.items || []).map((i) => i.node));

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
  targets,
  today,
  runId,
  runAttempt,
  cloud,
  checkNodes = realCheckNodes,
  client,
  fetchPublic,
}) {
  const nodeList = Array.isArray(nodes) ? nodes : nodes.nodes;
  const problems = [];
  const purges = [];
  const todayName = manifestName(manifest.date, runId, runAttempt);
  // A node the manifest records but nodes.json no longer lists is never purged, so
  // its manifest would stay listed for good: say so, and turn the run red.
  const knownNodes = new Set(nodeList.map((n) => n.id));
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
        { pass: false, count: 0, expected: targets.perNode, totalListed: 0, reasons: [reason] },
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
    exitCode:
      buildFailed ||
      problems.length > 0 ||
      purges.some((p) => !p.ok) ||
      Object.values(results).some((r) => !r.pass)
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
  //    Another attempt's record is never overwritten.
  let names;
  try {
    names = parseIndex(await cloud.r2Get(INDEX_KEY));
  } catch (err) {
    problems.push(`manifest index unreadable: ${err.message}; index left as it was`);
    await purgeUnsaved();
    return report(allFailing('index-unreadable'), { written: false });
  }
  const before = names;
  let objectSaved = false;
  try {
    const exists =
      names.includes(todayName) || (await cloud.r2Get(`${MANIFEST_PREFIX}${todayName}`)) !== null;
    if (exists) {
      problems.push(`${todayName} already exists; another attempt's record is never overwritten`);
      await purgeUnsaved();
      return report(allFailing('manifest-exists'), { before, written: false });
    }
    await cloud.r2Put(`${MANIFEST_PREFIX}${todayName}`, `${JSON.stringify(manifest, null, 2)}\n`);
    objectSaved = true;
    await cloud.r2Put(INDEX_KEY, indexText([...before, todayName]));
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
  let live = [...before, todayName];

  async function writeIndex(results) {
    if (live.length === before.length + 1 && live.includes(todayName)) {
      return report(results, { before, after: live, written: true });
    }
    try {
      await cloud.r2Put(INDEX_KEY, indexText(live));
      return report(results, { before, after: live, written: true });
    } catch (err) {
      problems.push(`manifest index not updated: ${err.message}`);
      return report(results, { before, after: [...before, todayName], written: false });
    }
  }

  // 2. A failed build: purge every node of the partial manifest.
  if (buildFailed) {
    await purgeAll(todayName, manifest);
    if (fullyPurged(todayName, manifest)) live = live.filter((n) => n !== todayName);
    return writeIndex(allFailing('build-failed'));
  }

  // 3. Accept the day's placements, then check every node.
  let results;
  let acceptSql;
  try {
    acceptSql = acceptSqlFor(manifest);
    if (acceptSql !== '') await cloud.d1File(acceptSql);
  } catch (err) {
    problems.push(`placements not accepted: ${err.message}`);
    results = allFailing('accept-failed');
  }
  if (!results) {
    try {
      results = await checkNodes({
        client,
        manifest,
        nodes: nodeList,
        today,
        targets,
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

  // 5. Swap per node.
  for (const node of nodeList) {
    const r = results[node.id];
    if (r && r.pass) {
      for (const s of stale) await purge(s.name, s.manifest, node.id);
    } else {
      await purge(todayName, manifest, node.id);
    }
  }

  // 6. A manifest leaves the index once every node it records is purged.
  for (const s of stale) {
    if (fullyPurged(s.name, s.manifest)) live = live.filter((n) => n !== s.name);
  }
  if (fullyPurged(todayName, manifest)) live = live.filter((n) => n !== todayName);
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
export function renderSummary({ report, nodes, targets, manifest, notes }) {
  const nodeList = Array.isArray(nodes) ? nodes : nodes.nodes;
  const lines = [
    '## Stock data: stg-full',
    '',
    '| Node | Expected (perNode) | Stock listed | Total listed | Result | Reasons |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const node of nodeList) {
    const r = report.results[node.id] || { pass: false, count: 0, totalListed: 0, reasons: [] };
    lines.push(
      `| ${cell(node.id)} | ${targets.perNode} | ${r.count} | ${r.totalListed} | ${
        r.pass ? 'pass' : 'FAIL'
      } | ${reasonsText(r.reasons)} |`
    );
  }
  const purgeFailures = report.purges.filter((p) => !p.ok);
  const notesList = [
    ...((manifest && manifest.warnings) || []).map((w) => `Build: ${w}`),
    notes && notes.instagramWarning ? `Instagram: ${notes.instagramWarning}` : null,
    notes && notes.tokenWarning ? `Instagram token: ${notes.tokenWarning}` : null,
    notes && notes.error ? `Build failed: ${notes.error}` : null,
    ...report.problems,
    ...purgeFailures.map((p) => `Purge failed: ${p.name} ${p.node} (${p.error})`),
  ].filter(Boolean);
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
    adminKey: need(env, 'STG_FULL_ADMIN_KEY'),
    accessClientId: need(env, 'STG_FULL_ACCESS_CLIENT_ID'),
    accessClientSecret: need(env, 'STG_FULL_ACCESS_CLIENT_SECRET'),
    fetch: fetchFn,
  });
}

/** Public reads: the Access service-token headers only, never the admin Bearer, never a redirect. */
export function fetchPublicFrom(env, fetchFn) {
  const id = need(env, 'STG_FULL_ACCESS_CLIENT_ID');
  const secret = need(env, 'STG_FULL_ACCESS_CLIENT_SECRET');
  const origin = new URL(STOCK_BASE_URL).origin;
  return (url, init = {}) => {
    if (new URL(url).origin !== origin) throw new Error('public read off the site');
    return fetchFn(url, {
      method: init.method || 'GET',
      redirect: 'manual',
      headers: { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret },
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

const addDays = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** The search prompt with its run-time values filled in. */
export function renderPrompt(template, { today, perNode, catalog, nodes }) {
  if (!Number.isInteger(perNode) || perNode < 1) throw new Error('perNode must be a whole number');
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error('nodes must be a list');
  const values = {
    NODES: nodes
      .map((n, i) => `${i + 1}. ${n.name} (node \`${n.id}\`, zip ${(n.zips || []).join(', ')})`)
      .join('\n'),
    TODAY: today,
    LAST_DAY: addDays(today, WINDOW_DAYS),
    STOP_AT: String(perNode + 3),
    CATALOG: catalog.map((t) => JSON.stringify(t)).join('\n'),
  };
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) =>
    Object.hasOwn(values, key) ? values[key] : m
  );
  if (/\{\{[A-Z_]+\}\}/.test(out)) throw new Error('search prompt has an unfilled value');
  return out;
}

function summarize(env, fs, text) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text);
}

// In CI this writes outside the checkout (STOCK_PREP_DIR), so the search step can be
// held to changing nothing in the checkout but its two output files.
export async function runPrepareSearch({ env, fs, fetch: fetchFn, now, outDir }) {
  const dir = env.STOCK_PREP_DIR || outDir;
  const today = chicagoDate(now());
  const catalog = await fetchCatalog(clientFrom(env, fetchFn));
  const template = nodeFs.readFileSync(join(ROOT, 'stock', 'search-prompt.md'), 'utf8');
  const prompt = renderPrompt(template, {
    today,
    perNode: repoJson('stock/targets.json').perNode,
    catalog,
    nodes: repoJson('stock/nodes.json').nodes,
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'event-types.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(join(dir, 'search-prompt.txt'), prompt);
  return 0;
}

export async function runSearchOutput({ fs, outDir, log }) {
  const { default: AjvModule } = await import('ajv');
  const { default: formatsModule } = await import('ajv-formats');
  const Ajv = AjvModule.default || AjvModule;
  const addFormats = formatsModule.default || formatsModule;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  let bad = 0;
  for (const [file, schema] of [
    ['finds.json', 'stock/finds.schema.json'],
    ['businesses.json', 'stock/businesses.schema.json'],
  ]) {
    let data;
    try {
      data = readJsonFile(fs, join(outDir, file));
    } catch {
      log(`${file}: missing or not JSON`);
      bad++;
      continue;
    }
    const validate = ajv.compile(repoJson(schema));
    if (!validate(data)) {
      bad++;
      for (const e of validate.errors.slice(0, 20)) log(`${file}${e.instancePath}: ${e.message}`);
    } else {
      log(`${file}: ${data.length} rows match ${schema}`);
    }
  }
  return bad === 0 ? 0 : 1;
}

export async function runValidate({ env, fs, fetch: fetchFn, now, outDir }) {
  const client = clientFrom(env, fetchFn);
  const today = chicagoDate(now());
  const catalog = await fetchCatalog(client);
  const nodes = repoJson('stock/nodes.json').nodes;
  const geocode = async (address) => {
    try {
      const r = await client.post('/api/v2/admin/geocode', { address });
      return Number.isFinite(r && r.lat) && Number.isFinite(r && r.lng)
        ? { lat: r.lat, lng: r.lng }
        : null;
    } catch {
      return null;
    }
  };
  const { accepted, refused, acceptedPerNode } = await validateFinds({
    finds: readJsonFile(fs, join(outDir, 'finds.json')),
    eventTypeIds: new Set(catalog.map((t) => t.id)),
    nodes,
    today,
    geocode,
  });
  fs.writeFileSync(join(outDir, 'accepted.json'), `${JSON.stringify(accepted, null, 2)}\n`);
  const byReason = {};
  for (const r of refused) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  const perNode = repoJson('stock/targets.json').perNode;
  const lines = [
    '## Stock finds validated',
    '',
    '| Node | Accepted | perNode |',
    '| --- | --- | --- |',
    ...nodes.map((n) => `| ${n.id} | ${acceptedPerNode[n.id] || 0} | ${perNode} |`),
    '',
    `Refused: ${
      Object.entries(byReason)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || 'none'
    }`,
  ];
  summarize(env, fs, `${lines.join('\n')}\n`);
  return 0;
}

export async function runBuild({ env, fs, fetch: fetchFn, now, outDir }) {
  const today = chicagoDate(now());
  const notes = { ok: false, date: today, instagramWarning: null, tokenWarning: null, error: null };
  const writeNotes = () =>
    fs.writeFileSync(join(outDir, 'build-notes.json'), `${JSON.stringify(notes, null, 2)}\n`);
  let manifest = null;
  const saveManifest = (m) =>
    fs.writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
  // Before the first API call: a build killed before it records anything still
  // hands check-swap a manifest (an empty one), so check-swap reports it red.
  saveManifest({ date: today, items: [], qr: [], acceptSql: [], short: {}, warnings: [] });
  try {
    const client = clientFrom(env, fetchFn);
    const catalog = await fetchCatalog(client);
    let posts = [];
    if (env.INSTAGRAM_ACCESS_TOKEN) {
      posts = await listPosts({ token: env.INSTAGRAM_ACCESS_TOKEN, fetch: fetchFn });
      notes.instagramWarning = listPosts.warning || null;
    } else {
      notes.instagramWarning = 'INSTAGRAM_ACCESS_TOKEN is not set; no art this run.';
    }
    notes.tokenWarning = tokenWarning(env.INSTAGRAM_TOKEN_ISSUED || '', today);
    const nodes = repoJson('stock/nodes.json').nodes;
    manifest = await buildDay({
      client,
      accepted: readJsonFile(fs, join(outDir, 'accepted.json')),
      businesses: readJsonFile(fs, join(outDir, 'businesses.json')),
      regionals: repoJson('stock/regionals.json'),
      posts,
      artTags: repoJson('stock/art-tags.json'),
      typeCategory: new Map(catalog.map((t) => [t.id, t.category])),
      targets: repoJson('stock/targets.json'),
      date: today,
      nodeIds: nodes.map((n) => n.id),
      fetch: fetchFn,
      // synchronous, after every id: a build killed mid-run leaves what it made on record
      onRecord: saveManifest,
    });
    notes.ok = true;
  } catch (err) {
    notes.error = err.message;
    if (err.manifest) manifest = err.manifest;
  }
  if (manifest) saveManifest(manifest);
  writeNotes();
  return notes.ok ? 0 : 1;
}

export async function runCheckSwap({
  env,
  fs,
  fetch: fetchFn,
  wrangler,
  now,
  outDir,
  tmpDir,
  checkNodes,
  log,
}) {
  const manifestPath = join(outDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const msg =
      'No manifest was saved; rows created by an interrupted build may need a manual purge.';
    log(msg);
    summarize(env, fs, `## Stock data: stg-full\n\n${msg}\n`);
    return 1;
  }
  const manifest = readJsonFile(fs, manifestPath);
  const notesPath = join(outDir, 'build-notes.json');
  const notes = fs.existsSync(notesPath) ? readJsonFile(fs, notesPath) : { ok: false };
  const buildFailed = notes.ok !== true || env.BUILD_RESULT !== 'success';
  const nodes = repoJson('stock/nodes.json');
  const targets = repoJson('stock/targets.json');
  const cloud = makeCloud({ wrangler, fs, tmpDir, log });
  const report = await checkSwap({
    manifest,
    buildFailed,
    nodes,
    targets,
    today: chicagoDate(now()),
    runId: need(env, 'GITHUB_RUN_ID'),
    runAttempt: need(env, 'GITHUB_RUN_ATTEMPT'),
    cloud,
    checkNodes,
    client: buildFailed ? null : clientFrom(env, fetchFn),
    fetchPublic: buildFailed ? null : fetchPublicFrom(env, fetchFn),
  });
  summarize(env, fs, renderSummary({ report, nodes, targets, manifest, notes }));
  for (const [id, r] of Object.entries(report.results)) {
    if (!r.pass) log(`node ${id} failed: ${reasonsText(r.reasons)}`);
  }
  return report.exitCode;
}

const COMMANDS = {
  'prepare-search': runPrepareSearch,
  'search-output': runSearchOutput,
  validate: runValidate,
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
