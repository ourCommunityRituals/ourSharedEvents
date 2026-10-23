#!/usr/bin/env node
/**
 * Full-sync report, version 1 (owner, 2026-10-22).
 *
 * The chain the owner wants kept in step:
 *
 *   ADR > documentation > shared brain > invariants > code > CI/CD >
 *   test pyramid > test results > report > loop > shared brain
 *
 * Version 1 reads the first four links across the spine (OurCommunityRituals),
 * OCR-docs, ourSharedEvents and ourWKRP, plus the spine pin of the two repos
 * that consume @ocr/ui:
 *
 *   1 adr         docs/adr/README.md index vs the ADR files (missing, orphan, status)
 *   2 docs        docs/features vs the route table in router.ts, and the INDEX links
 *   3 brain       each repo's governance files, its place against origin/main, and
 *                 the brain files this repo reads
 *   4 invariants  OCR-docs architectural-invariants.yaml vs conformance.json
 *                 (ids, status), the test file each invariant names, and AGENTS.md's
 *                 [#n] tags (by running scripts/ci/check-agents-sync.mjs, not rewriting it)
 *   5 spine pin   .ocr-hub-ref of this repo and ourWKRP vs the spine's origin/main
 *                 (the file name keeps the legacy word "hub")
 *
 * The remaining links of the chain (code, CI/CD, pyramid, results, report, loop)
 * are not read yet; the output says so.
 *
 *   node scripts/ci/sync-report.mjs [--ose <path>] [--ocr-docs <path>]
 *        [--wkrp <path>] [--spine <path>] [--agents-items <n>]
 *        [--json] [--write] [--strict]
 *
 * Paths default to the siblings of the main checkout (a worktree under
 * .claude/worktrees resolves to its main checkout first). Environment:
 * SYNC_OCR_DOCS, SYNC_WKRP, SYNC_SPINE (--hub / SYNC_HUB still work as aliases).
 *
 * READ-ONLY by construction: it reads files and runs only these git commands
 * on local refs: rev-parse, rev-list, cat-file, diff --name-only, status
 * --porcelain, merge-base; and scripts/ci/check-agents-sync.mjs, itself
 * read-only. No network, no writes to any repo, no secrets read; the output
 * holds names, counts and dates only. `--write` puts the report under this
 * repo's .claude/outputs/ and nowhere else. Exit code is 0 unless `--strict`
 * is given and a link is red.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is a repo checkout the caller names on the command line; reading them is the job */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'archive',
  'worktrees',
  '.wrangler',
  'dist',
  'coverage',
]);
const GOVERNANCE_FILES = ['CLAUDE.md', 'README.md', 'SKILL.md', join('docs', 'OCR_VISION.md')];
const STALE_CONFORMANCE_DAYS = 7;

// ─── small readers ────────────────────────────────────────────────────────────

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null);

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, keep, out);
    } else if (keep(name)) out.push(p);
  }
  return out;
}

/** Read-only git on local refs. Returns trimmed stdout, or null on any failure. */
export function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }).trim();
  } catch {
    return null;
  }
}

const finding = (level, key, detail) => ({ level, key, detail });

function link(id, name, findings, nextStep, extra = {}) {
  const status = findings.some((f) => f.level === 'bad')
    ? 'bad'
    : findings.some((f) => f.level === 'warn')
      ? 'warn'
      : 'ok';
  return {
    id,
    link: name,
    status,
    findings,
    next_step: status === 'ok' ? 'None.' : nextStep,
    ...extra,
  };
}

// ─── 1. ADR index vs ADR files ────────────────────────────────────────────────

const STATUS_WORDS = ['accepted', 'proposed', 'superseded', 'withdrawn', 'deprecated', 'rejected'];

export function checkAdr(oseRoot) {
  const dir = join(oseRoot, 'docs', 'adr');
  const readme = read(join(dir, 'README.md'));
  const out = [];
  if (readme === null) {
    return link(
      'adr',
      'ADR index vs ADR files',
      [finding('bad', 'no-index', 'docs/adr/README.md is missing')],
      'Restore docs/adr/README.md, the ADR index.'
    );
  }
  const files = readdirSync(dir).filter((f) => /^ADR-\d{3}-.+\.md$/.test(f));
  const rows = [];
  for (const m of readme.matchAll(
    /^\|\s*\[(ADR-\d{3})\]\(([^)]+)\)\s*\|[^|]*\|\s*([^|]+?)\s*\|/gm
  )) {
    rows.push({ id: m[1], file: m[2], status: m[3].toLowerCase().split(/[\s(]/)[0] });
  }
  for (const r of rows) {
    if (!existsSync(join(dir, r.file)))
      out.push(
        finding('bad', `missing-file ${r.id}`, `the index links ${r.file}, which does not exist`)
      );
  }
  const indexed = new Set(rows.map((r) => r.file));
  for (const f of files) {
    if (!indexed.has(f))
      out.push(finding('warn', `orphan ${f.slice(0, 7)}`, `${f} has no row in the index`));
  }
  for (const r of rows) {
    const body = read(join(dir, r.file));
    if (body === null) continue;
    const m = body.match(/\*\*Status:\*\*\s*([A-Za-z]+)/);
    const fileStatus = m ? m[1].toLowerCase() : null;
    if (!fileStatus || !STATUS_WORDS.includes(fileStatus)) {
      out.push(finding('warn', `no-status ${r.id}`, `${r.file} has no readable Status line`));
    } else if (fileStatus !== r.status) {
      out.push(
        finding('warn', `status ${r.id}`, `the index says ${r.status}, the file says ${fileStatus}`)
      );
    }
  }
  return link(
    'adr',
    'ADR index vs ADR files',
    out,
    'Make the index row match the file (the file is the record), add rows for orphan files, and fix dead links.',
    { counts: { adr_files: files.length, index_rows: rows.length } }
  );
}

// ─── 2. Documentation vs the route table and its own index ────────────────────

const segs = (p) => p.split('/').filter(Boolean);
const normPath = (p) =>
  '/' +
  segs(p.replace(/[?#].*$/, ''))
    .map((s) => (s.startsWith(':') ? ':' : s))
    .join('/');

/** The route table is the header comment of router.ts: ` *   GET /path   → ...`. */
export function headerRoutes(routerSource) {
  const head = routerSource.slice(0, routerSource.indexOf('*/') + 2);
  const routes = [];
  for (const m of head.matchAll(/^\s*\*\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)/gm)) {
    routes.push({ method: m[1], path: normPath(m[2]) });
  }
  return routes;
}

function routeMatches(headerPath, docPath) {
  const a = segs(headerPath);
  const b = segs(docPath);
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === ':' || b[i] === ':' || s === b[i]);
}

export function checkDocs(oseRoot) {
  const out = [];
  const router = read(join(oseRoot, 'workers', 'oursharedevents', 'src', 'router.ts'));
  const featuresDir = join(oseRoot, 'docs', 'features');
  if (router === null)
    out.push(finding('bad', 'no-router', 'router.ts is missing, so doc routes cannot be checked'));
  if (!existsSync(featuresDir)) {
    return link(
      'docs',
      'Documentation vs code and its index',
      [...out, finding('bad', 'no-features', 'docs/features is missing')],
      'Restore docs/features.'
    );
  }
  const docs = readdirSync(featuresDir).filter((f) => f.endsWith('.md'));

  // INDEX.md links both ways.
  const index = read(join(featuresDir, 'INDEX.md')) ?? '';
  const linked = new Set([...index.matchAll(/\]\(([A-Za-z0-9_.-]+\.md)\)/g)].map((m) => m[1]));
  for (const f of linked) {
    if (!existsSync(join(featuresDir, f)))
      out.push(finding('bad', `dead-link ${f}`, `INDEX.md links ${f}, which does not exist`));
  }
  for (const f of docs) {
    if (f !== 'INDEX.md' && !linked.has(f))
      out.push(finding('warn', `unindexed ${f}`, `${f} is not linked from INDEX.md`));
  }

  // Routes the docs name that the router's own table does not list.
  let docRoutes = 0;
  if (router !== null) {
    const table = headerRoutes(router);
    const unknown = new Map();
    for (const f of docs) {
      const body = read(join(featuresDir, f)) ?? '';
      for (const m of body.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_/:.{}-]*)/g)) {
        const p = normPath(m[2]);
        if (p === '/') continue;
        docRoutes++;
        const known = table.some((r) => r.method === m[1] && routeMatches(r.path, p));
        if (!known) unknown.set(`${m[1]} ${p}`, (unknown.get(`${m[1]} ${p}`) ?? new Set()).add(f));
      }
    }
    for (const [route, files] of unknown) {
      out.push(
        finding(
          'warn',
          `route ${route}`,
          `named in ${[...files].join(', ')}; not in the router.ts header table`
        )
      );
    }
  }
  return link(
    'docs',
    'Documentation vs code and its index',
    out,
    'For each route: add it to the router.ts header (if it is real) or correct the doc (if it is stale). Link or retire unindexed docs.',
    { counts: { feature_docs: docs.length, doc_route_mentions: docRoutes } }
  );
}

// ─── 3. Shared brain: governance files and place against origin/main ──────────

export function repoState(label, dir) {
  if (!dir || !existsSync(dir)) return { label, present: false };
  const governance = GOVERNANCE_FILES.filter((f) => existsSync(join(dir, f)));
  const originMain = git(dir, ['rev-parse', '--verify', '-q', 'origin/main']);
  const head = git(dir, ['rev-parse', 'HEAD']);
  let ahead = null;
  let behind = null;
  if (originMain && head) {
    const lr = git(dir, ['rev-list', '--left-right', '--count', `origin/main...HEAD`]);
    if (lr) [behind, ahead] = lr.split(/\s+/).map(Number);
  }
  const porcelain = git(dir, ['status', '--porcelain']);
  const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  return {
    label,
    present: true,
    git: head !== null,
    branch: git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    governance_present: governance.length,
    governance_missing: GOVERNANCE_FILES.filter((f) => !governance.includes(f)).map((f) =>
      f.replace(/\\/g, '/')
    ),
    behind,
    ahead,
    tracked_changes: lines.filter((l) => !l.startsWith('??')).length,
    untracked: lines.filter((l) => l.startsWith('??')).length,
  };
}

export function checkBrain(paths) {
  const out = [];
  const states = [];
  for (const [label, dir] of [
    ['spine', paths.spine],
    ['OCR-docs', paths.ocrDocs],
    ['ourSharedEvents', paths.ose],
    ['ourWKRP', paths.wkrp],
  ]) {
    const s = repoState(label, dir);
    states.push(s);
    if (!s.present) {
      if (label === 'spine') continue; // a missing spine is reported by the pin link
      out.push(finding('bad', `${label} missing`, `no checkout found for ${label}`));
      continue;
    }
    if (s.governance_missing.length) {
      out.push(
        finding(
          'warn',
          `${label} governance`,
          `${s.governance_present} of ${GOVERNANCE_FILES.length} governance files; missing ${s.governance_missing.join(', ')}`
        )
      );
    }
    if (s.behind)
      out.push(
        finding(
          'warn',
          `${label} behind`,
          `local copy is ${s.behind} commit(s) behind origin/main (local refs, no fetch)`
        )
      );
    if (s.tracked_changes)
      out.push(
        finding(
          'warn',
          `${label} dirty`,
          `${s.tracked_changes} tracked file(s) changed and uncommitted`
        )
      );
  }
  if (
    paths.ocrDocs &&
    !existsSync(join(paths.ocrDocs, 'ocr-docs-brain', 'architectural-invariants.yaml'))
  ) {
    out.push(
      finding('bad', 'brain-yaml', 'OCR-docs has no ocr-docs-brain/architectural-invariants.yaml')
    );
  }
  if (paths.ose && !existsSync(join(paths.ose, 'docs', 'brain', 'ROLE-STATE.md'))) {
    out.push(finding('warn', 'role-state', 'ourSharedEvents has no docs/brain/ROLE-STATE.md'));
  }
  return link(
    'brain',
    'Shared brain: governance files and place against origin/main',
    out,
    'Pull or merge the lagging checkout, commit or discard tracked changes, and restore any missing governance file by PR.',
    { repos: states }
  );
}

// ─── 4. Invariants: brain yaml vs conformance.json vs the named test ──────────

/** Strip a trailing "(note)" from a yaml test_file value. */
export const testFileName = (v) =>
  String(v ?? '')
    .replace(/\s*\(.*$/, '')
    .trim();

function indexByBasename(roots) {
  const idx = new Map();
  for (const root of roots) {
    for (const p of walk(root, () => true)) idx.set(basename(p), p);
  }
  return idx;
}

/** AGENTS.md [#n] tags vs the brain, by the existing CI check. */
export function agentsSync(paths) {
  const agents = join(paths.ose, 'AGENTS.md');
  const yamlPath = join(paths.ocrDocs ?? '', 'ocr-docs-brain', 'architectural-invariants.yaml');
  if (!existsSync(agents) || !existsSync(yamlPath)) {
    return { ran: false, lines: [], summary: null };
  }
  const r = spawnSync(
    process.execPath,
    [
      join(HERE, 'check-agents-sync.mjs'),
      agents,
      yamlPath,
      '--ocr-docs',
      paths.ocrDocs,
      '--items',
      String(paths.agentsItems ?? 9),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const lines = (r.stdout ?? '').split('\n').filter(Boolean);
  return {
    ran: r.status === 0 || r.status === 1,
    lines,
    summary: lines.find((l) => l.startsWith('agents-sync:')) ?? null,
  };
}

export function checkInvariants(paths, now = new Date()) {
  const out = [];
  const yamlPath = join(paths.ocrDocs ?? '', 'ocr-docs-brain', 'architectural-invariants.yaml');
  const confPath = join(
    paths.ose,
    'workers',
    'oursharedevents',
    'docs',
    'security',
    'conformance.json'
  );
  const yamlText = read(yamlPath);
  const confText = read(confPath);
  if (yamlText === null || confText === null) {
    return link(
      'invariants',
      'Invariants: brain vs conformance vs tests',
      [
        finding(
          'bad',
          'unreadable',
          `${yamlText === null ? 'architectural-invariants.yaml' : 'conformance.json'} cannot be read`
        ),
      ],
      'Point the report at a checkout that has both files.'
    );
  }
  const brain = yaml.load(yamlText).invariants ?? [];
  const conf = JSON.parse(confText);
  const confById = new Map((conf.invariants ?? []).map((i) => [Number(i.id), i]));
  const brainById = new Map(brain.map((i) => [Number(i.id), i]));

  for (const id of brainById.keys())
    if (!confById.has(id))
      out.push(
        finding('bad', `#${id} not in report`, 'the brain has it; conformance.json has no row')
      );
  for (const id of confById.keys())
    if (!brainById.has(id))
      out.push(
        finding(
          'bad',
          `#${id} not in brain`,
          'conformance.json has a row; the brain does not list it'
        )
      );

  const tests = indexByBasename(
    [
      join(paths.ose, 'tests'),
      join(paths.ose, 'workers', 'oursharedevents', 'tests'),
      paths.ocrDocs,
      paths.wkrp,
    ].filter((p) => p && existsSync(p))
  );
  for (const inv of brain) {
    const id = Number(inv.id);
    const c = confById.get(id);
    if (c && c.invariant_status !== inv.status) {
      out.push(
        finding(
          'warn',
          `#${id} status`,
          `brain says ${inv.status}, conformance.json says ${c.invariant_status}`
        )
      );
    }
    if (inv.status === 'retired') continue;
    const name = testFileName(inv.test_file);
    const base = basename(name);
    const found = name.includes('/')
      ? [paths.ose, paths.ocrDocs, paths.wkrp].some((r) => r && existsSync(join(r, name))) ||
        [paths.ocrDocs && join(paths.ocrDocs, 'ocr-docs-brain', name)].some(
          (p) => p && existsSync(p)
        ) ||
        tests.has(base)
      : tests.has(base);
    if (!found) {
      out.push(
        finding(
          inv.status === 'live' ? 'bad' : 'warn',
          `#${id} test file`,
          `${inv.status} invariant names ${base}; no such file in the three repos`
        )
      );
    }
    if (c && c.enforcement_status === 'gap')
      out.push(finding('warn', `#${id} gap`, 'conformance.json lists no enforcement (gap)'));
  }

  const ageDays = Math.floor((now - new Date(conf.generated_at)) / 864e5);
  if (!Number.isFinite(ageDays) || ageDays > STALE_CONFORMANCE_DAYS) {
    out.push(
      finding(
        'warn',
        'conformance age',
        `conformance.json was generated ${conf.generated_at} (${ageDays} days ago)`
      )
    );
  }
  if (conf.summary && conf.summary.total !== (conf.invariants ?? []).length) {
    out.push(
      finding(
        'warn',
        'conformance summary',
        `summary.total ${conf.summary.total} vs ${(conf.invariants ?? []).length} rows`
      )
    );
  }

  const ag = agentsSync(paths);
  if (existsSync(join(paths.ose, 'AGENTS.md')) && !ag.ran) {
    out.push(finding('warn', 'AGENTS.md sync', 'check-agents-sync.mjs could not run'));
  }
  for (const f of ag.lines.filter((l) => l.startsWith('FAIL '))) {
    out.push(finding('bad', 'AGENTS.md sync', f.slice(5)));
  }
  return link(
    'invariants',
    'Invariants: brain vs conformance vs tests',
    out,
    'Align the status in conformance.json to the brain (regenerate it), add or retire rows for ids that differ, and restore or rename the missing test file.',
    {
      counts: {
        brain_invariants: brain.length,
        report_rows: confById.size,
        agents_sync: ag.summary,
      },
    }
  );
}

// ─── 5. Spine pin ─────────────────────────────────────────────────────────────

export function pinState(label, repoDir, spineDir) {
  const pinText = read(join(repoDir ?? '', '.ocr-hub-ref'));
  const pin = pinText ? pinText.trim() : null;
  if (!pin) return { label, pin: null };
  const tip =
    git(spineDir, ['rev-parse', '--verify', '-q', 'origin/main']) ??
    git(spineDir, ['rev-parse', 'HEAD']);
  const known = git(spineDir, ['cat-file', '-t', pin]) === 'commit';
  const behind =
    known && tip ? Number(git(spineDir, ['rev-list', '--count', `${pin}..${tip}`])) : null;
  // Files the lag touches under packages/: what the consumer would actually pull in.
  const diff =
    known && tip && behind
      ? git(spineDir, ['diff', '--name-only', pin, tip, '--', 'packages/'])
      : null;
  return {
    label,
    pin: pin.slice(0, 8),
    spine_tip: tip ? tip.slice(0, 8) : null,
    known,
    behind,
    packages_files_changed: diff === null ? null : diff.split('\n').filter(Boolean).length,
  };
}

export function checkPins(paths) {
  const out = [];
  const states = [];
  if (!paths.spine || !existsSync(paths.spine)) {
    return link(
      'spine-pin',
      'Spine pin vs spine origin/main',
      [finding('bad', 'no-spine', 'no spine checkout found')],
      'Point --spine at the OurCommunityRituals checkout.'
    );
  }
  for (const [label, dir] of [
    ['ourSharedEvents', paths.ose],
    ['ourWKRP', paths.wkrp],
  ]) {
    if (!dir || !existsSync(dir)) continue;
    const s = pinState(label, dir, paths.spine);
    states.push(s);
    if (!s.pin) out.push(finding('bad', `${label} no pin`, `${label} has no .ocr-hub-ref`));
    else if (!s.known)
      out.push(
        finding('bad', `${label} pin unknown`, `pin ${s.pin} is not a commit in the spine clone`)
      );
    else if (s.behind > 0)
      out.push(
        finding(
          'warn',
          `${label} pin behind`,
          `pin ${s.pin} is ${s.behind} commit(s) behind spine ${s.spine_tip}, ${s.packages_files_changed} file(s) under packages/ changed (local refs, no fetch)`
        )
      );
  }
  return link(
    'spine-pin',
    'Spine pin vs spine origin/main',
    out,
    'Bump the pin in a PR after the spine change it lags has been read; the pin must be a commit on spine main.',
    { pins: states }
  );
}

// ─── report ───────────────────────────────────────────────────────────────────

const NOT_READ = ['code', 'CI/CD', 'test pyramid', 'test results', 'report', 'loop'];

export function buildReport(paths, now = new Date()) {
  const links = [
    checkAdr(paths.ose),
    checkDocs(paths.ose),
    checkBrain(paths),
    checkInvariants(paths, now),
    checkPins(paths),
  ];
  const summary = { ok: 0, warn: 0, bad: 0 };
  for (const l of links) summary[l.status]++;
  return {
    generated_at: now.toISOString().slice(0, 10),
    read_only: true,
    chain:
      'ADR > documentation > shared brain > invariants > code > CI/CD > test pyramid > test results > report > loop > shared brain',
    not_read_yet: NOT_READ,
    summary,
    links,
  };
}

const ICON = { ok: 'in sync', warn: 'drifting', bad: 'out of sync' };

export function render(report) {
  const out = [
    `# Full-sync report, ${report.generated_at}`,
    '',
    '| Link | Status | Findings | Next step |',
    '| --- | --- | ---: | --- |',
  ];
  for (const l of report.links)
    out.push(`| ${l.link} | ${ICON[l.status]} | ${l.findings.length} | ${l.next_step} |`);
  const repos = report.links.find((l) => l.id === 'brain')?.repos ?? [];
  if (repos.length) {
    out.push(
      '',
      '| Repo | Branch | Behind / ahead origin | Tracked changes | Untracked | Governance files |',
      '| --- | --- | --- | ---: | ---: | --- |'
    );
    for (const r of repos) {
      out.push(
        r.present
          ? `| ${r.label} | ${r.branch ?? '-'} | ${r.behind ?? '-'} / ${r.ahead ?? '-'} | ${r.tracked_changes} | ${r.untracked} | ${r.governance_present} of ${GOVERNANCE_FILES.length} |`
          : `| ${r.label} | not found | | | | |`
      );
    }
  }
  for (const l of report.links) {
    if (!l.findings.length) continue;
    out.push('', `## ${l.link}`);
    for (const f of l.findings) out.push(`- [${f.level}] ${f.key}: ${f.detail}`);
  }
  out.push(
    '',
    `Not read yet in v1: ${report.not_read_yet.join(', ')}. Read-only: files and local git refs only, no network.`
  );
  return out.join('\n');
}

// ─── path defaults and CLI ────────────────────────────────────────────────────

/** The main checkout of a repo, even from a worktree under .claude/worktrees. */
export function mainCheckout(dir) {
  const common = git(dir, ['rev-parse', '--git-common-dir']);
  if (!common) return dir;
  return dirname(resolve(dir, common));
}

export function resolvePaths(args, env = process.env, cwd = process.cwd()) {
  const arg = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const top = git(cwd, ['rev-parse', '--show-toplevel']) ?? resolve(HERE, '..', '..');
  const ose = resolve(arg('--ose') ?? top);
  const parent = dirname(mainCheckout(ose));
  const pick = (flag, envName, sibling) => {
    const v = arg(flag) ?? env[envName];
    if (v) return resolve(v);
    const p = join(parent, sibling);
    return existsSync(p) ? p : null;
  };
  const spineDefault = existsSync(join(parent, 'packages', 'tokens')) ? parent : null;
  const spine = arg('--spine') ?? arg('--hub') ?? env.SYNC_SPINE ?? env.SYNC_HUB;
  const items = arg('--agents-items');
  return {
    ose,
    ocrDocs: pick('--ocr-docs', 'SYNC_OCR_DOCS', 'OCR-docs'),
    wkrp: pick('--wkrp', 'SYNC_WKRP', 'ourWKRP'),
    spine: spine ? resolve(spine) : spineDefault,
    agentsItems: items ? Number(items) : 9,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const paths = resolvePaths(args);
  const report = buildReport(paths);
  const json = JSON.stringify(report, null, 2);
  if (args.includes('--write')) {
    const dir = join(paths.ose, '.claude', 'outputs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `SYNC-REPORT-${report.generated_at}.json`), json + '\n');
    writeFileSync(join(dir, `SYNC-REPORT-${report.generated_at}.md`), render(report) + '\n');
  }
  console.log(args.includes('--json') ? json : render(report));
  process.exitCode = args.includes('--strict') && report.summary.bad > 0 ? 1 : 0;
}
