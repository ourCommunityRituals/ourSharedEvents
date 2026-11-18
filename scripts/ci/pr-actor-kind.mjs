#!/usr/bin/env node
// scripts/ci/pr-actor-kind.mjs
//
// Who is a bot, and whose approval counts, for the Security Human Gate
// (.github/workflows/security-human-gate.yml). Reads GitHub REST objects, where
// every account carries `type` ("Bot" or "User") and a bot login ends in "[bot]".
// It never decides by letters inside a login: a person called "abbott" is a person,
// and an App is a bot whatever it is named.
//
// Usage (stdin is JSON; for lists, one object per line or one array):
//   gh api repos/O/R/pulls/N | node scripts/ci/pr-actor-kind.mjs author-is-bot          -> true|false
//   gh api repos/O/R/pulls/N | node scripts/ci/pr-actor-kind.mjs has-label NAME         -> true|false
//   gh api --paginate repos/O/R/issues/N/events --jq '.[]' \
//     | node scripts/ci/pr-actor-kind.mjs label-applied-by-human NAME                    -> true|false
//   gh api --paginate repos/O/R/pulls/N/reviews --jq '.[]' \
//     | node scripts/ci/pr-actor-kind.mjs human-approvals HEAD_SHA                       -> a count
//
// Fails closed: input it cannot read, or an unknown mode, exits 2 and prints
// nothing on stdout, so the gate step stops instead of reading "no bot, 0".

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Associations that come with write access to the repository. */
const WRITE_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** States that are a reviewer's decision; COMMENTED and PENDING leave the last one standing. */
const DECISIONS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/**
 * @param {{login?: string, type?: string} | null | undefined} u a REST user object
 * @returns {boolean} true for a bot, and for a missing or nameless user (fail closed)
 */
export function isBotUser(u) {
  if (!u || typeof u.login !== 'string' || u.login === '') return true;
  if (u.type === 'Bot') return true;
  return /\[bot\]$/i.test(u.login);
}

/**
 * People (not bots) with a write-level association whose latest decision is APPROVED,
 * given on the PR's current head commit. An approval of an older commit does not count:
 * the override must cover the code that is failing now.
 * Note: MEMBER and COLLABORATOR are associations, not a write-permission check; a
 * read-only member would still count (follow-up: ask collaborators/{login}/permission).
 * @param {string} headSha the PR's current head commit
 * @param {Array<{user?: object, state?: string, author_association?: string, submitted_at?: string, commit_id?: string}>} reviews
 * @returns {number}
 */
export function humanApprovals(headSha, reviews) {
  if (typeof headSha !== 'string' || headSha === '') return 0;
  const latest = new Map();
  const ordered = [...reviews].sort((a, b) =>
    String(a.submitted_at ?? '').localeCompare(String(b.submitted_at ?? ''))
  );
  for (const r of ordered) {
    if (!DECISIONS.has(r.state)) continue;
    if (isBotUser(r.user)) continue;
    if (!WRITE_ASSOCIATIONS.has(r.author_association)) continue;
    // A later decision on any commit replaces an earlier one; only one on the head can approve.
    latest.set(r.user.login.toLowerCase(), r.commit_id === headSha ? r.state : `${r.state}@old`);
  }
  let n = 0;
  for (const state of latest.values()) if (state === 'APPROVED') n++;
  return n;
}

/**
 * The PR (a REST pull request object) carries a label with exactly this name.
 * @returns {boolean}
 */
export function hasLabel(pr, name) {
  return Array.isArray(pr?.labels) && pr.labels.some((l) => l?.name === name);
}

/**
 * The label's most recent `labeled` / `unlabeled` event is a `labeled` by a person.
 * A bot, the agent's App included, cannot apply the override for itself.
 * @param {Array<{event?: string, label?: {name?: string}, actor?: object, created_at?: string}>} events
 *   REST issue events for the PR
 * @returns {boolean}
 */
export function labelAppliedByHuman(events, name) {
  const mine = events
    .filter((e) => (e?.event === 'labeled' || e?.event === 'unlabeled') && e?.label?.name === name)
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const last = mine[mine.length - 1];
  return Boolean(last) && last.event === 'labeled' && !isBotUser(last.actor);
}

/** One JSON array, or one JSON value per line. Throws on anything else. */
export function parseInput(text) {
  const t = text.trim();
  if (t === '') return [];
  if (t.startsWith('[')) return JSON.parse(t);
  return t
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

function main() {
  const mode = process.argv[2];
  const arg = process.argv[3];
  const needsArg = new Set(['has-label', 'label-applied-by-human', 'human-approvals']);
  if (needsArg.has(mode) && !arg) {
    process.stderr.write(`pr-actor-kind: ${mode} needs an argument; failing closed.\n`);
    process.exit(2);
  }
  let items;
  try {
    items = parseInput(readFileSync(0, 'utf8'));
  } catch (e) {
    process.stderr.write(
      `pr-actor-kind: cannot read the input as JSON (${e.message}); failing closed.\n`
    );
    process.exit(2);
  }
  if (mode === 'author-is-bot' || mode === 'has-label') {
    if (items.length !== 1 || typeof items[0] !== 'object' || items[0] === null) {
      process.stderr.write(
        `pr-actor-kind: ${mode} needs exactly one pull request object; failing closed.\n`
      );
      process.exit(2);
    }
    const out = mode === 'author-is-bot' ? isBotUser(items[0].user) : hasLabel(items[0], arg);
    process.stdout.write(`${out}\n`);
    return;
  }
  if (mode === 'label-applied-by-human') {
    process.stdout.write(`${labelAppliedByHuman(items, arg)}\n`);
    return;
  }
  if (mode === 'human-approvals') {
    process.stdout.write(`${humanApprovals(arg, items)}\n`);
    return;
  }
  process.stderr.write(
    'usage: node scripts/ci/pr-actor-kind.mjs author-is-bot | has-label NAME | label-applied-by-human NAME | human-approvals HEAD_SHA  (JSON on stdin)\n'
  );
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
