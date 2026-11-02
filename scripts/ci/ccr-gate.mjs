#!/usr/bin/env node
// CCR gate: a pull request that changes a governed file carries a CCR worksheet tied to it.
//
//   node scripts/ci/ccr-gate.mjs --root <PR checkout> --base <sha> --head <sha> --pr <number> [--mode warn|block]
//
// AGENTS.md says a change to AGENTS.md, CLAUDE.md, STORIES.md or the CCR protocol needs a CCR of
// 5 loops or more. Nothing checked that. This does, on the pull request:
//
//   1. Every worksheet in the PR's tree meets the worksheet contract (ccr-worksheet-check.mjs).
//   2. If the PR changes a governed file (a rename counts as a delete and an add), the PR adds or
//      changes a worksheet under .claude/outputs whose frontmatter has `pr:` this PR and
//      `subject_sha:` a commit on the PR (reachable from head, not from base), ran 5 loops or
//      more, and the governed files are the same at the PR head as at subject_sha (the review
//      saw what will merge).
//
// The workflow (.github/workflows/ccr-gate.yml) runs this file and its checker from the BASE
// branch, so a PR cannot edit these scripts to pass itself. The workflow file itself is read
// from the PR (a `pull_request` run), so a PR that edits it can still skip the judge. Only an
// owner setting closes that: a ruleset that requires this workflow from main.
//
// It is a tripwire, not proof. The agent writes the worksheet, so a worksheet can still be
// invented; this makes a skipped or untied CCR visible. In warn mode (the default) it prints
// warnings and exits 0. The owner switches it to block with the CCR_GATE_MODE repository variable.
// A worksheet whose gate is `stop` is not a failure: below 95% the owner decides.

/* eslint-disable security/detect-non-literal-fs-filename -- reads files under --root that git just listed */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { check, frontmatter, WORKSHEET_NAME } from './ccr-worksheet-check.mjs';

export const GOVERNED_MIN_LOOPS = 5;

// Paths whose change needs a CCR. A prefix ends in "/" or names a file family (".claude/skills/ccr").
export function isGoverned(path) {
  return (
    ['AGENTS.md', 'CLAUDE.md', 'STORIES.md'].includes(path) ||
    path.startsWith('.claude/skills/ccr') ||
    path.startsWith('scripts/ci/ccr-') ||
    path.startsWith('tests/integration/ccr-') ||
    path === '.github/workflows/ccr-gate.yml'
  );
}

const SHA = /^[0-9a-f]{7,40}$/;

function args(argv) {
  const get = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    root: get('--root') ?? process.cwd(),
    base: get('--base'),
    head: get('--head'),
    pr: Number(get('--pr')),
    mode: get('--mode') ?? 'warn',
  };
}

function git(root, ...a) {
  const r = spawnSync('git', ['-C', root, ...a], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { ok: r.status === 0, raw: r.stdout ?? '', err: (r.stderr ?? '').trim() };
}

// What a diff touches, as { status, path }. NUL-delimited, so git never C-quotes a name, and
// with no rename detection, so a move is a delete plus an add and both paths are seen.
function changedPaths(root, ...range) {
  const r = git(root, 'diff', '--name-status', '-z', '--no-renames', ...range);
  const parts = r.raw.split('\0');
  const entries = [];
  for (let i = 0; i + 1 < parts.length; i += 2)
    entries.push({ status: parts[i], path: parts[i + 1] });
  return { ok: r.ok, err: r.err, entries, paths: entries.map((e) => e.path) };
}

export function gate({ root, base, head, pr }) {
  const problems = [];
  const notes = [];
  if (!SHA.test(base ?? '') || !SHA.test(head ?? ''))
    return { problems: ['--base and --head must be commit SHAs'], notes };
  if (!Number.isInteger(pr) || pr < 1)
    return { problems: ['--pr must be the pull request number'], notes };

  // 1. The worksheet contract, by this (base) copy of the checker.
  problems.push(...check(root).problems);

  // 2. A governed change carries a tied worksheet.
  const diff = changedPaths(root, `${base}...${head}`);
  if (!diff.ok) return { problems: [...problems, `git diff failed: ${diff.err}`], notes };
  const changed = diff.paths;
  const governed = changed.filter(isGoverned);
  if (!governed.length) {
    notes.push(`no governed file changed (${changed.length} files in the PR)`);
    return { problems, notes };
  }

  // Worksheets this PR adds or changes.
  const added = diff.entries
    .filter((e) => ['A', 'M'].includes(e.status))
    .map((e) => e.path)
    .filter((p) => p.startsWith('.claude/outputs/') && WORKSHEET_NAME.test(basename(p)));

  const why = [];
  let tied = null;
  for (const rel of added) {
    const full = join(root, rel);
    if (!existsSync(full)) continue;
    const fm = frontmatter(readFileSync(full, 'utf8').replace(/\r\n/g, '\n'));
    const d = fm.data;
    if (!d) {
      why.push(`${rel}: no frontmatter`);
      continue;
    }
    if (d.pr !== pr) {
      why.push(`${rel}: pr is ${JSON.stringify(d.pr)}, not ${pr}`);
      continue;
    }
    const subject = String(d.subject_sha ?? '');
    if (!/^[0-9a-f]{40}$/.test(subject)) {
      why.push(`${rel}: no subject_sha`);
      continue;
    }
    // On this PR: reachable from head and not from base, so a review of older history cannot stand in.
    if (
      !git(root, 'merge-base', '--is-ancestor', subject, head).ok ||
      git(root, 'merge-base', '--is-ancestor', subject, base).ok
    ) {
      why.push(`${rel}: subject_sha ${subject.slice(0, 12)} is not a commit on this PR`);
      continue;
    }
    const sinceDiff = changedPaths(root, subject, head);
    if (!sinceDiff.ok) {
      why.push(
        `${rel}: could not compare ${subject.slice(0, 12)} with the PR head (${sinceDiff.err})`
      );
      continue;
    }
    const since = sinceDiff.paths.filter(isGoverned);
    if (since.length) {
      why.push(
        `${rel}: governed files changed after the reviewed commit ${subject.slice(0, 12)}: ${since.join(', ')}`
      );
      continue;
    }
    if (!(d.loops_run >= GOVERNED_MIN_LOOPS)) {
      why.push(`${rel}: ran ${d.loops_run} loops; a governed change needs ${GOVERNED_MIN_LOOPS}`);
      continue;
    }
    tied = { rel, d };
    break;
  }

  if (!tied) {
    problems.push(
      `this PR changes governed files (${governed.join(', ')}) and has no CCR worksheet tied to it. ` +
        `Add one under .claude/outputs with "pr: ${pr}", "subject_sha" set to the commit the CCR reviewed, ` +
        `and ${GOVERNED_MIN_LOOPS} loops or more` +
        (why.length ? `. Worksheets in this PR that do not qualify: ${why.join('; ')}` : '')
    );
  } else {
    notes.push(`governed change reviewed by ${tied.rel} (${tied.d.loops_run} loops)`);
    if (tied.d.gate !== 'pass')
      notes.push(
        `that CCR stopped at ${tied.d.system_score}%: under 95%, merging is the owner's decision`
      );
  }
  return { problems, notes };
}

if (process.argv[1] && basename(process.argv[1]) === 'ccr-gate.mjs') {
  const a = args(process.argv.slice(2));
  const block = a.mode === 'block';
  const { problems, notes } = gate(a);
  const gh = process.env.GITHUB_ACTIONS === 'true';
  for (const n of notes) process.stdout.write(`${gh ? '::notice::' : ''}ccr-gate: ${n}\n`);
  for (const p of problems)
    process.stdout.write(`${gh ? (block ? '::error::' : '::warning::') : ''}ccr-gate: ${p}\n`);
  process.stdout.write(
    `ccr-gate: ${problems.length} problem(s), mode ${block ? 'block' : 'warn'}\n`
  );
  if (problems.length && block) process.exit(1);
}
