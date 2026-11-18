#!/usr/bin/env node
// scripts/ci/pr-actor-kind.mjs
//
// Who is a bot, and whose approval counts, for the Security Human Gate
// (.github/workflows/security-human-gate.yml). Reads GitHub REST objects, where
// every account carries `type` ("Bot" or "User") and a bot login ends in "[bot]".
// It never decides by letters inside a login: a person called "abbott" is a person,
// and an App is a bot whatever it is named.
//
// Usage (stdin is JSON; for reviews, one object per line or one array):
//   gh api repos/O/R/pulls/N | node scripts/ci/pr-actor-kind.mjs author-is-bot      -> true|false
//   gh api --paginate repos/O/R/pulls/N/reviews --jq '.[]' \
//     | node scripts/ci/pr-actor-kind.mjs human-approvals                            -> a count
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
 * People (not bots) with a write-level association whose latest decision is APPROVED.
 * @param {Array<{user?: object, state?: string, author_association?: string, submitted_at?: string}>} reviews
 * @returns {number}
 */
export function humanApprovals(reviews) {
  const latest = new Map();
  const ordered = [...reviews].sort((a, b) =>
    String(a.submitted_at ?? '').localeCompare(String(b.submitted_at ?? ''))
  );
  for (const r of ordered) {
    if (!DECISIONS.has(r.state)) continue;
    if (isBotUser(r.user)) continue;
    if (!WRITE_ASSOCIATIONS.has(r.author_association)) continue;
    latest.set(r.user.login.toLowerCase(), r.state);
  }
  let n = 0;
  for (const state of latest.values()) if (state === 'APPROVED') n++;
  return n;
}

/** One JSON array, or one JSON value per line. Throws on anything else. */
export function parseInput(text) {
  const t = text.trim();
  if (t === '') return [];
  if (t.startsWith('[')) return JSON.parse(t);
  return t.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}

function main() {
  const mode = process.argv[2];
  let items;
  try {
    items = parseInput(readFileSync(0, 'utf8'));
  } catch (e) {
    process.stderr.write(`pr-actor-kind: cannot read the input as JSON (${e.message}); failing closed.\n`);
    process.exit(2);
  }
  if (mode === 'author-is-bot') {
    if (items.length !== 1 || typeof items[0] !== 'object' || items[0] === null) {
      process.stderr.write('pr-actor-kind: author-is-bot needs exactly one pull request object; failing closed.\n');
      process.exit(2);
    }
    process.stdout.write(`${isBotUser(items[0].user)}\n`);
    return;
  }
  if (mode === 'human-approvals') {
    process.stdout.write(`${humanApprovals(items)}\n`);
    return;
  }
  process.stderr.write('usage: node scripts/ci/pr-actor-kind.mjs author-is-bot | human-approvals  (JSON on stdin)\n');
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
