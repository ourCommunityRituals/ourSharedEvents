#!/usr/bin/env node
/**
 * AGENTS.md agrees with the org brain (owner, 2026-10-22: the documents agree).
 *
 *   node scripts/ci/check-agents-sync.mjs AGENTS.md BRAIN.yaml --ocr-docs ROOT [--ref origin/main] [--items 9]
 *
 * Fails (exit 1) when:
 *  - an `[#n]` tag in the Invariants section names an id that is not in the brain
 *    yaml, or whose status is not live or partial (a retired id is a dead promise);
 *  - a numbered invariant carries no tag (`[#n ...]` or `[OSE]`);
 *  - a bracket mentions `#<digit>` but is not a well-formed tag (a typo is not silence);
 *  - no id was found at all (the check cannot pass on nothing);
 *  - an `OCR-docs/...` path cited anywhere in AGENTS.md does not exist in the OCR-docs tree.
 *
 * It proves an id exists and is live, not that it means the right thing: the meaning is
 * reviewed (CCR) when a tag is added. Exit 2 is a usage or IO error. Node built-ins only.
 * `--ref` reads the OCR-docs tree from a git ref (local use); CI reads the fresh checkout.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const pos = [];
const opt = { items: 9 };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ocr-docs') opt.root = argv[++i];
  else if (argv[i] === '--ref') opt.ref = argv[++i];
  else if (argv[i] === '--items') opt.items = Number(argv[++i]);
  else pos.push(argv[i]);
}
if (pos.length !== 2 || !opt.root) {
  console.error(
    'usage: check-agents-sync.mjs AGENTS.md brain.yaml --ocr-docs ROOT [--ref origin/main] [--items 9]'
  );
  process.exit(2);
}
const read = (p) => {
  try {
    const s = readFileSync(p, 'utf8');
    return (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s).replace(/\r\n/g, '\n');
  } catch (e) {
    console.error(`cannot read ${p}: ${e.message}`);
    process.exit(2);
  }
};
const agents = read(pos[0]);
const yamlLines = read(pos[1]).split('\n');
const fails = [];

// Brain: id -> status, only inside the top-level `invariants:` block. An entry is
// `  - id: N`; its status is the 4-space `    status:` key (nested keys sit deeper).
const status = new Map();
let inBlock = false;
let cur = null;
for (const line of yamlLines) {
  if (/^[A-Za-z_]+:/.test(line)) {
    inBlock = /^invariants:\s*$/.test(line);
    cur = null;
    continue;
  }
  if (!inBlock) continue;
  let m = line.match(/^ {2}- id:\s*(\d+)\s*(#.*)?$/);
  if (m) {
    cur = Number(m[1]);
    status.set(cur, null);
    continue;
  }
  m = line.match(/^ {4}status:\s*([A-Za-z_]+)/);
  if (m && cur !== null && status.get(cur) === null) status.set(cur, m[1]);
}
if (status.size === 0) fails.push('brain yaml: no invariant entries parsed (shape changed?)');

// The Invariants section of AGENTS.md, inline code spans removed.
const secM = agents.match(/^## Invariants[^\n]*\n([\s\S]*?)(?=^## |(?![^]))/m);
if (!secM) fails.push('AGENTS.md: no "## Invariants" section');
const section = (secM ? secM[1] : '').replace(/`[^`\n]*`/g, '');

const BS = String.fromCharCode(92);
const TOKEN = `(?:#${BS}d+|OSE)`;
const TAG = new RegExp(`${BS}[(${TOKEN}(?:${BS}s+${TOKEN})*)${BS}]`, 'g');
const items = [...section.matchAll(/^(\d+)\. ([^\n]*(?:\n(?!\d+\. |\n)[^\n]*)*)/gm)];

const ids = new Set();
for (const m of section.matchAll(TAG))
  for (const t of m[1].matchAll(/#(\d+)/g)) ids.add(Number(t[1]));
for (const m of section.matchAll(/\[([^\]\n]*#\d[^\]\n]*)\]/g)) {
  if (!new RegExp(`^${TOKEN}(?:${BS}s+${TOKEN})*$`).test(m[1]))
    fails.push(`malformed tag [${m[1]}]`);
}
if (ids.size === 0) fails.push('zero [#n] ids found in the Invariants section');
for (const id of [...ids].sort((a, b) => a - b)) {
  if (!status.has(id)) fails.push(`[#${id}] is not in the brain yaml`);
  else if (!['live', 'partial'].includes(status.get(id)))
    fails.push(`[#${id}] has brain status "${status.get(id)}" (need live or partial)`);
}
if (items.length !== opt.items)
  fails.push(`expected ${opt.items} numbered invariants, found ${items.length}`);
for (const it of items) {
  if (![...it[0].matchAll(TAG)].length)
    fails.push(`invariant ${it[1]} has no tag ([#n ...] or [OSE])`);
}

// Cited OCR-docs paths must exist in the OCR-docs tree.
let files = null;
if (opt.ref) {
  const r = spawnSync('git', ['-C', opt.root, 'ls-tree', '-r', opt.ref, '--name-only'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0) {
    console.error(`git ls-tree failed: ${r.stderr}`);
    process.exit(2);
  }
  files = new Set(r.stdout.split('\n').filter(Boolean));
}
const exists = (rel) =>
  files
    ? files.has(rel) || [...files].some((f) => f.startsWith(rel.replace(/\/$/, '') + '/'))
    : existsSync(join(opt.root, rel));
const cited = new Set(
  [...agents.matchAll(/(?<![\w/.-])OCR-docs\/([^\s`'"()[\]<>]+)/g)].map((m) =>
    m[1].replace(/[.,;:]+$/, '')
  )
);
for (const rel of [...cited].sort())
  if (!exists(rel))
    fails.push(`cited path OCR-docs/${rel} does not exist${opt.ref ? ' at ' + opt.ref : ''}`);

console.log(
  `agents-sync: ${ids.size} ids [${[...ids].sort((a, b) => a - b).map((n) => '#' + n)}], ${items.length} items, ${cited.size} cited paths, brain ${status.size} entries`
);
if (fails.length) {
  for (const f of fails) console.log('FAIL ' + f);
  process.exit(1);
}
console.log('agents-sync: clean');
