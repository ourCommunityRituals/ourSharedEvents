#!/usr/bin/env node
// CCR worksheet gate: makes a CCR run binding instead of advisory.
//
//   node scripts/ci/ccr-worksheet-check.mjs [--root .]
//
// .claude/skills/ccr/SKILL.md sets the loop count, the team and the 95% gate, but
// nothing read the result: a worksheet could claim "5 loops, extended team" and
// carry one loop and no Dr of Security. This reads every CCR worksheet under
// .claude/outputs (any depth, any case: ccr-*.md, CCR_*.md) that is in the tree and
// fails the build when the worksheet breaks the protocol.
//
// A worksheet opens with YAML frontmatter on line 1, which is the machine-readable claim:
//
//   ---
//   ccr: 1
//   class: bug-fix           # lite | bug-fix | security-fix | upgrade | architecture | governance | compliance
//   requested_loops: 3       # what the owner asked for
//   loops_run: 3             # `## Loop 1` .. `## Loop 3` must exist
//   team: extended           # extended | base
//   gate: stop               # stop | pass
//   cumulative_score: 40     # all loops' results taken together, before any solutioning
//   system_score: 40         # after solutioning; this is the number the 95% gate reads
//   owner_ratified: 2026-11-02   # governance and compliance only: needed before gate can be pass
//   unresolved: { regulatory: 0, security_critical: 1, critical: 0, high: 2, medium: 0, low: 0 }
//   invocation: run ccr 3 loops for bug fix   # optional: the owner's sentence, verbatim
//   pr: 1234                                  # optional: the pull request it reviews
//   subject_sha: "<40-hex commit>"            # optional: the commit it reviewed (quoted)
//   ---
//
// `unresolved` must equal the open rows of the table in "## Findings register" that has a
// Severity (or Sev) column; a Status of closed, resolved, fixed or withdrawn takes a row out.
// A change to a governed file (AGENTS.md, CLAUDE.md, STORIES.md, the CCR skills, this gate)
// also needs `pr` and `subject_sha`; scripts/ci/ccr-gate.mjs checks that on the pull request.
//
// How a run goes (owner rulings, 2026-11-01/02): each loop is one lens on the same subject.
// Five loops: 1 Critical (what is true versus assumed), 2 Conservative (assume the worst),
// 3 Adversarial, 4 Compliance, 5 Recursive (was the assessment itself honest). Three loops:
// Critical, Conservative, Recursive. Other lengths are not ruled; they follow the five-loop order.
// All the specified loops run, nothing is changed between them, and the results are taken
// together as one cumulative score. Under 95%, the team works out the solutions afterwards.
// CCR Lite is one loop with Critical, Conservative and Recursive.
//
// Each loop has a `## Loop N` section holding these lines (outside code fences):
//
//   Team: dr-of-security, role-backend-architect, ...   (agent ids only; extended: all nine)
//   Critical layer: ...                                 (the layer named for that loop, as above)
//   Score: 62%                                          (exactly one: this loop's own result)
//
// plus the sections SKILL.md section 6 lists, and "## Solutioning" whenever a score is under 95%.
//
// What this proves is structure and internal consistency: the loops that were claimed exist,
// the team that was claimed is named, the score cannot beat the loosest legal reading of the
// weights, and the cumulative is not better than any one loop. It does not prove a finding is
// true, that a role lens really ran, or that the owner really ratified: class, team,
// requested_loops, the unresolved counts and owner_ratified are all the author's own statements.
//
// Worksheets written before this gate carry no frontmatter. They live in docs/ccr-archive/,
// which this does not read. Every worksheet under .claude/outputs must carry the frontmatter.

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp, security/detect-unsafe-regex --
   Reads repo files under --root, with fixed internal patterns and labels; no request input reaches a path or a pattern. */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import yaml from 'js-yaml';

// Owner, 2026-11-02 ("agreed"; "rollback should also be added for a 3 loop").
export const CLASS_MIN_LOOPS = {
  lite: 1,
  'bug-fix': 3,
  'security-fix': 3,
  rollback: 3,
  upgrade: 4,
  architecture: 5,
  governance: 5,
  compliance: 5,
};
// The words an owner may use as the subject of `run ccr ... for <subject>`, and the class each sets.
const CLASS_WORDS = {
  lite: 'lite',
  'bug fix': 'bug-fix',
  'bug-fix': 'bug-fix',
  security: 'security-fix',
  'security fix': 'security-fix',
  'security-fix': 'security-fix',
  rollback: 'rollback',
  upgrade: 'upgrade',
  architecture: 'architecture',
  governance: 'governance',
  compliance: 'compliance',
};
const SEVERITIES = {
  regulatory: 'regulatory',
  'security critical': 'security_critical',
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};
// A register row is open unless its Status column says otherwise.
const CLOSED_STATUS = /^(closed|resolved|fixed|withdrawn)\b/i;
const OWNER_RATIFIES = new Set(['governance', 'compliance']);
const WEIGHTS = {
  regulatory: 25,
  security_critical: 15,
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
};
// Protocol 2.5/2.6: a partly verified finding costs half, and a staging-only one costs
// 0.75 of that. The loosest legal reading is therefore 0.5 x 0.75 of the base weight.
const LOOSEST_FACTOR = 0.375;
const REGULATORY_CAP = 60; // protocol sections 10: an open Regulatory item caps the score at 60%
const EXTENDED_TEAM = [
  'dr-of-security',
  'role-backend-architect',
  'role-frontend-integration',
  'role-design-fe',
  'role-qa-automation',
  'role-sdet-sre',
  'role-devops',
  'role-data-scientist',
  'role-product-owner',
];
const LAYERS = ['Critical', 'Conservative', 'Recursive']; // CCR Lite: all three in one loop
const RUN_ORDER = {
  3: ['Critical', 'Conservative', 'Recursive'],
  5: ['Critical', 'Conservative', 'Adversarial', 'Compliance', 'Recursive'],
};
const layerFor = (n, total) => {
  const order = RUN_ORDER[total] ?? RUN_ORDER[5];
  return order[(n - 1) % order.length];
};
const REQUIRED_SECTIONS = [
  ['verdict', /verdict/i],
  ['what was reviewed', /what was reviewed|^reviewed\b|scope/i],
  ['findings register', /findings register/i],
  ['what must be true before shipping', /before shipping|before activation|pre-?conditions/i],
  ['verification', /verification/i],
  ['risks accepted', /risks accepted/i],
  ['human gate', /human[- ]gate/i],
];
const PASS_SCORE = 95;
const MAX_LOOPS = 20; // a bound, so a typo such as 1e9 cannot stall the check
export const WORKSHEET_NAME = /^ccr[-_].+\.(md|markdown)$/i;

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const stripFences = (t) => t.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, '');

function args(argv) {
  const i = argv.indexOf('--root');
  return { root: i >= 0 ? argv[i + 1] : process.cwd(), tracked: argv.includes('--tracked') };
}

// --tracked: only the worksheets git tracks, as a clean CI checkout sees them. Without it,
// untracked drafts are checked too, so an author sees a problem before committing.
function trackedFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', '.claude/outputs'], {
    encoding: 'utf-8',
  });
  if (r.status !== 0) throw new Error(`--tracked needs a git work tree: ${r.stderr.trim()}`);
  return r.stdout
    .split('\0')
    .filter((p) => p && WORKSHEET_NAME.test(basename(p)))
    .map((p) => p.slice('.claude/outputs/'.length));
}

export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) {
    // \s covers a BOM and a blank line alike
    return { none: true, misplaced: /^\s+---\n/.test(text) };
  }
  try {
    const data = yaml.load(m[1]);
    return data && typeof data === 'object' && !Array.isArray(data)
      ? { data, body: text.slice(m[0].length) }
      : { none: true };
  } catch (e) {
    return { invalid: e.reason || 'parse error' };
  }
}

// `## Loop 2`, `## 3. Loop 2: pressure pass`. A section runs to the next `## `.
function loopSections(body) {
  const sections = [];
  let cur = null;
  for (const line of body.split('\n')) {
    if (/^## /.test(line)) {
      const m = line.match(/^## (?:\d+\.\s*)?Loop (\d+)\b/i);
      cur = m ? { n: Number(m[1]), text: '' } : null;
      if (cur) sections.push(cur);
    } else if (cur) cur.text += line + '\n';
  }
  return sections;
}

const h2 = (body) =>
  body
    .split('\n')
    .filter((l) => /^## /.test(l))
    .map((l) => l.replace(/^## (?:\d+\.\s*)?/, ''));

function sectionText(body, re) {
  const parts = body.split(/^(?=## )/m);
  return parts.filter((p) => re.test(p.split('\n')[0].replace(/^## (?:\d+\.\s*)?/, ''))).join('\n');
}

const labelRe = (label) =>
  new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?\\**${label}[ \\t]*:\\**[ \\t]*\\**(.*)$`, 'gim');

function lineValues(text, label) {
  const out = [];
  const re = labelRe(label);
  for (let m; (m = re.exec(text));) out.push(m[1].trim());
  return out;
}

// `run ccr [N loop[s]] [with TEAM team] for SUBJECT` (owner, 2026-11-02).
const INVOCATION =
  /^run ccr(?:\s+(\d{1,2}))?(?:\s+loops?)?(?:\s+with\s+([a-z]+)\s+team)?\s+for\s+(\S.*)$/i;

export function parseInvocation(s) {
  const m = typeof s === 'string' ? s.trim().match(INVOCATION) : null;
  if (!m) return null;
  const subject = m[3]
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
  return {
    loops: m[1] ? Number(m[1]) : undefined,
    team: m[2]?.toLowerCase(),
    cls: Object.hasOwn(CLASS_WORDS, subject) ? CLASS_WORDS[subject] : undefined,
  };
}

// Counts the open rows of the first table in the register that has a Severity column.
function registerCounts(text) {
  const cells = (l) =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.replace(/\*/g, '').trim());
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const head = cells(lines[i]).map((c) => c.toLowerCase());
    const sev = head.findIndex((c) => /^sev(erity)?$/.test(c));
    let j = i + 1;
    while (j < lines.length && /^\s*\|/.test(lines[j])) j++;
    if (sev < 0) {
      i = j;
      continue;
    }
    const status = head.indexOf('status');
    const counts = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, 0]));
    const unknown = [];
    for (const row of lines.slice(i + 1, j)) {
      if (/^\s*\|[\s:|-]+$/.test(row)) continue; // the |---| line
      const c = cells(row);
      if (status >= 0 && CLOSED_STATUS.test(c[status] ?? '')) continue;
      const key = SEVERITIES[(c[sev] ?? '').toLowerCase()];
      if (key) counts[key] += 1;
      else unknown.push(c[sev] ?? '');
    }
    return { counts, unknown };
  }
  return null;
}

// Layers read "Critical layer: ..." so a findings bullet such as "- Critical: F1" cannot pass for one.
function layersIn(text, names) {
  const found = [];
  let from = 0;
  for (const name of names) {
    const re = new RegExp(
      `^[ \\t]*(?:[-*][ \\t]+)?\\**${name} layer[ \\t]*:\\**[ \\t]*\\**\\S.*$`,
      'gim'
    );
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) continue;
    found.push(name);
    from = m.index + m[0].length;
  }
  return found;
}

function checkOne(rel, text, agentIds) {
  const p = [];
  const bad = (msg) => p.push(`${rel}: ${msg}`);
  const fm = frontmatter(text);
  if (fm.invalid) return [`${rel}: frontmatter is not valid YAML (${fm.invalid})`];
  const d = fm.data;
  const body = stripFences(fm.body);

  const cls = d.class;
  if (typeof cls !== 'string' || !Object.hasOwn(CLASS_MIN_LOOPS, cls))
    bad(
      `class must be one of ${Object.keys(CLASS_MIN_LOOPS).join(', ')} (got ${JSON.stringify(cls)})`
    );
  if (!['extended', 'base'].includes(d.team))
    bad(`team must be extended or base (got ${JSON.stringify(d.team)})`);
  if (!['stop', 'pass'].includes(d.gate))
    bad(`gate must be stop or pass (got ${JSON.stringify(d.gate)})`);
  for (const k of ['requested_loops', 'loops_run'])
    if (!Number.isInteger(d[k]) || d[k] < 1 || d[k] > MAX_LOOPS)
      bad(`${k} must be a whole number from 1 to ${MAX_LOOPS} (got ${JSON.stringify(d[k])})`);
  if (!Number.isFinite(d.system_score) || d.system_score < 0 || d.system_score > 100)
    bad(`system_score must be a number from 0 to 100 (got ${JSON.stringify(d.system_score)})`);
  if (!Number.isFinite(d.cumulative_score) || d.cumulative_score < 0 || d.cumulative_score > 100)
    bad(
      `cumulative_score must be a number from 0 to 100 (got ${JSON.stringify(d.cumulative_score)})`
    );
  const un = d.unresolved;
  if (!un || typeof un !== 'object') bad('unresolved must be a map of finding counts');
  else
    for (const k of Object.keys(WEIGHTS))
      if (!Number.isInteger(un[k]) || un[k] < 0)
        bad(`unresolved.${k} must be a whole number, 0 or more (got ${JSON.stringify(un[k])})`);
  // Optional: `pr` and `subject_sha` tie the worksheet to a pull request (scripts/ci/ccr-gate.mjs).
  if (d.pr !== undefined && (!Number.isInteger(d.pr) || d.pr < 1))
    bad(`pr must be a pull request number (got ${JSON.stringify(d.pr)})`);
  if (d.subject_sha !== undefined && !/^[0-9a-f]{40}$/.test(String(d.subject_sha)))
    bad(
      `subject_sha must be a full 40-character commit SHA in quotes (got ${JSON.stringify(d.subject_sha)})`
    );
  if (d.invocation !== undefined && !parseInvocation(d.invocation))
    bad(
      `invocation must be the owner's sentence, "run ccr [N loops] [with TEAM team] for SUBJECT" (got ${JSON.stringify(d.invocation)})`
    );
  if (p.length) {
    p.push(`${rel}: (more checks run once the frontmatter above is valid)`);
    return p;
  }

  const minLoops = CLASS_MIN_LOOPS[cls];
  const required = Math.max(d.requested_loops, minLoops);
  const sections = loopSections(body);

  // The owner's sentence, when recorded, must agree with what the worksheet says was asked.
  if (d.invocation !== undefined) {
    const inv = parseInvocation(d.invocation);
    const asked = inv.loops ?? CLASS_MIN_LOOPS[inv.cls ?? cls];
    if (d.requested_loops !== asked)
      bad(
        `requested_loops is ${d.requested_loops} but the invocation asks for ${asked} ` +
          `(${inv.loops ? 'the number it names' : `no number, so the ${inv.cls ?? cls} minimum`})`
      );
    if (inv.cls && inv.cls !== cls)
      bad(`class is ${cls} but the invocation's subject is the class word for ${inv.cls}`);
    if (inv.team && inv.team !== d.team)
      bad(`team is ${d.team} but the invocation asks for the ${inv.team} team`);
  }

  // The loops that were claimed must exist, numbered 1..N, in order, once each.
  const numbers = sections.map((s) => s.n);
  const want = Array.from({ length: d.loops_run }, (_, i) => i + 1);
  if (numbers.join(',') !== want.join(','))
    bad(
      `loops_run is ${d.loops_run} but the worksheet has loop sections [${numbers.join(', ') || 'none'}]; ` +
        `one cumulative worksheet must hold "## Loop 1" to "## Loop ${d.loops_run}" in order`
    );

  const scores = [];
  for (const s of sections) {
    const tag = `loop ${s.n}`;
    const expected = cls === 'lite' ? LAYERS : [layerFor(s.n, d.loops_run)];
    const layers = layersIn(s.text, expected);
    if (!expected.every((x) => layers.includes(x)) || (cls === 'lite' && layers.length !== 3))
      bad(
        `${tag} must carry ${expected.map((x) => `"${x} layer: ..."`).join(', ')} with text ` +
          `(a ${d.loops_run}-loop run is ${(RUN_ORDER[d.loops_run] ?? RUN_ORDER[5]).join(', ')}; found ${layers.join(', ') || 'none'})`
      );

    const sc = lineValues(s.text, 'Score');
    const m = sc.length === 1 ? sc[0].match(/^(\d{1,3}(?:\.\d+)?)\s*%/) : null;
    if (!m || Number(m[1]) > 100)
      bad(`${tag} needs exactly one line "Score: NN%" (found ${sc.length})`);
    scores.push(m && Number(m[1]) <= 100 ? Number(m[1]) : NaN);

    const teamLines = lineValues(s.text, 'Team');
    const team = teamLines[0];
    if (teamLines.length !== 1 || !/^[a-z][a-z0-9-]*(?:\s*,\s*[a-z][a-z0-9-]*)*$/.test(team || ''))
      bad(
        `${tag} needs exactly one line "Team: id, id, ..." naming only the agents that ran ` +
          `(agent ids, no prose; leave out any lens that did not run)`
      );
    else {
      const ids = team.split(/\s*,\s*/);
      const unknown = ids.filter((x) => !agentIds.has(x));
      if (unknown.length)
        bad(`${tag} names agents with no file in .claude/agents/: ${unknown.join(', ')}`);
      if (d.team === 'extended') {
        const missing = EXTENDED_TEAM.filter((x) => !ids.includes(x));
        if (missing.length) bad(`${tag} extended team is missing ${missing.join(', ')}`);
      }
    }
  }
  if (!scores.length || scores.some(Number.isNaN)) return p;

  const worst = Math.min(...scores);
  const hardBlock = un.security_critical > 0 || un.regulatory > 0;
  // Security Critical and Regulatory take no partial credit; they are handled below.
  const looseDeduction =
    LOOSEST_FACTOR *
    (un.critical * WEIGHTS.critical +
      un.high * WEIGHTS.high +
      un.medium * WEIGHTS.medium +
      un.low * WEIGHTS.low);
  let ceiling = Math.max(0, 100 - looseDeduction);
  if (un.regulatory > 0) ceiling = Math.min(ceiling, REGULATORY_CAP);
  if (un.security_critical > 0) ceiling = 0;

  // Counts are the author's own, so this is only an upper bound on one number.
  if (d.system_score > ceiling + 1e-9)
    bad(
      `system_score ${d.system_score} is above the most the unresolved counts allow (${ceiling}): ` +
        `${un.security_critical > 0 ? 'an unresolved Security Critical floors it at 0' : un.regulatory > 0 ? 'an unresolved Regulatory item caps it at 60' : 'lower the score or correct the counts'}`
    );

  // Every specified loop runs on the same subject before anything is judged.
  if (d.loops_run < required)
    bad(
      `loops_run is ${d.loops_run} but this run needs ${required} (requested ${d.requested_loops}, class ${cls} needs ${minLoops}); ` +
        'run every loop before scoring: a low score is solved after the run, not a reason to stop early'
    );
  // The cumulative takes every loop's findings, so it cannot be better than any one loop.
  if (d.cumulative_score > worst + 1e-9)
    bad(
      `cumulative_score ${d.cumulative_score} is better than the worst loop (${worst}%); it takes all the loops into account`
    );
  if (d.system_score < d.cumulative_score)
    bad(
      `system_score ${d.system_score} is below cumulative_score ${d.cumulative_score}; solutioning can only close findings`
    );
  if (d.gate === 'pass') {
    if (hardBlock)
      bad('gate cannot pass with an unresolved Security Critical or Regulatory finding');
    if (cls !== 'lite' && scores[0] >= PASS_SCORE)
      bad(
        `loop 1 scored ${scores[0]}%; 95% or more in the Critical run means the review stopped looking. Re-run it with a fresh lens and record what it missed`
      );
    if (d.system_score < PASS_SCORE)
      bad(`gate is pass but system_score is ${d.system_score}%, under 95%`);
    if (OWNER_RATIFIES.has(cls)) {
      const r =
        d.owner_ratified instanceof Date
          ? d.owner_ratified.toISOString().slice(0, 10)
          : String(d.owner_ratified ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r))
        bad(
          `class ${cls} needs "owner_ratified: YYYY-MM-DD" in the frontmatter before gate can be pass (the owner's acceptance of the result)`
        );
    }
  } else if (!hardBlock && d.system_score >= PASS_SCORE) {
    bad(
      `gate is stop but system_score is a clean ${d.system_score}%; set gate: pass, or say in the worksheet what only the owner can close`
    );
  }
  if (
    Math.min(d.cumulative_score, d.system_score) < PASS_SCORE &&
    !h2(body).some((h) => /solutioning/i.test(h))
  )
    bad(
      'a score is under 95%, so the worksheet needs a "## Solutioning" section: how the team reaches 95%'
    );

  const heads = h2(body);
  for (const [name, re] of REQUIRED_SECTIONS)
    if (!heads.some((h) => re.test(h))) bad(`missing section: ${name} (a "## ..." heading)`);

  // The unresolved counts, and so the score ceiling above, are recounted from the register.
  if (heads.some((h) => /findings register/i.test(h))) {
    const reg = registerCounts(sectionText(body, /findings register/i));
    if (!reg)
      bad(
        'the findings register needs a table with a Severity column, one row per finding ' +
          '(a Status column of closed, resolved, fixed or withdrawn takes a row out of the count)'
      );
    else {
      for (const v of reg.unknown)
        bad(
          `the findings register has a row of severity ${JSON.stringify(v)}; use Regulatory, Security Critical, Critical, High, Medium or Low`
        );
      const off = Object.keys(WEIGHTS).filter((k) => reg.counts[k] !== un[k]);
      if (off.length)
        bad(
          `unresolved does not match the open rows of the findings register: ` +
            off.map((k) => `${k} ${un[k]} vs ${reg.counts[k]}`).join(', ')
        );
    }
  }
  if (d.gate === 'stop' && !/\?[ \t]*$/m.test(sectionText(body, /human[- ]gate/i)))
    bad(
      'gate is stop, so the human gate section must put at least one question to the owner (a line ending in "?")'
    );
  return p;
}

function walk(dir, rel = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, r));
    else if (WORKSHEET_NAME.test(name)) out.push(r);
  }
  return out;
}

export function check(root, { tracked = false } = {}) {
  const problems = [];
  const stats = { checked: 0 };
  const dir = join(root, '.claude', 'outputs');
  if (!existsSync(dir)) {
    problems.push(
      '.claude/outputs is missing, so no worksheet could be checked (a tracked directory)'
    );
    return { problems, stats };
  }

  const agentsDir = join(root, '.claude', 'agents');
  const agentIds = new Set(
    existsSync(agentsDir)
      ? readdirSync(agentsDir)
          .filter((f) => f.endsWith('.md'))
          .map((f) => f.replace(/\.md$/, ''))
      : []
  );

  const files = (tracked ? trackedFiles(root) : walk(dir)).sort();
  for (const f of files) {
    const rel = `.claude/outputs/${f}`;
    const text = read(join(dir, f));
    const fm = frontmatter(text);
    stats.checked += 1;
    if (fm.none) {
      problems.push(
        fm.misplaced
          ? `${rel}: the frontmatter must start on line 1 with "---" (no blank line or BOM before it)`
          : `${rel}: no frontmatter; a CCR worksheet must carry the ccr frontmatter (see the header of scripts/ci/ccr-worksheet-check.mjs). Older worksheets belong in docs/ccr-archive/`
      );
      continue;
    }
    problems.push(...checkOne(rel, text, agentIds));
  }
  return { problems, stats };
}

if (process.argv[1] && basename(process.argv[1]) === 'ccr-worksheet-check.mjs') {
  const a = args(process.argv.slice(2));
  const { problems, stats } = check(a.root, { tracked: a.tracked });
  if (problems.length) {
    process.stderr.write(problems.map((x) => `ccr-worksheet: ${x}`).join('\n') + '\n');
    process.exit(1);
  }
  process.stdout.write(`ccr worksheets ok (${stats.checked} checked)\n`);
}
