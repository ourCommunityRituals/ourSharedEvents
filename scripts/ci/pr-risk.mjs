#!/usr/bin/env node
// PR risk classifier: fixed path rules, no model. It decides which reviewer a PR
// gets ("pr_risk" in .claude/outputs/CCR-CLAUDE-USAGE-OPTIMIZATION-2026-10-11.md):
// a model may explain a PR's risk, but the classification is policy, not a guess.
//
//   node scripts/ci/pr-risk.mjs --base origin/main     (files changed since the merge base)
//   node scripts/ci/pr-risk.mjs --files changed.txt    (one path per line)
//
// Prints JSON: { risk, reviewer: { model, effort }, reasons: [{ file, level, why }] }.
// The highest-risk file decides; a PR is "low" only when every file is low.
// An empty change list is "normal": an unknown change is never waved through.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SRC = 'workers/oursharedevents/src';

// [level, why, pattern]. The first matching rule decides a file's level.
export const RULES = [
  ['high', 'database migration', /^workers\/oursharedevents\/(migrations|migrations-forms)\//],
  ['high', 'admin authentication', new RegExp(`^${SRC}/auth/`)],
  ['high', 'PII or anonymous id', new RegExp(`^${SRC}/lib/(pii|forms-db|event-anon-key|anonymous-id|ip-mask)\\.ts$`)],
  ['high', 'under-5 floor or data boundary', new RegExp(`^${SRC}/lib/(count-floor|pool-contract)\\.ts$`)],
  [
    'high',
    'security boundary',
    new RegExp(
      `^${SRC}/lib/(admin-write-guard|cors|rate-limit|public-read-limit|public-event-projection|audit-log|sponsor-card|sponsor-home-auth)\\.ts$`,
    ),
  ],
  ['high', 'route table (auth and rate-limit wrappers)', new RegExp(`^${SRC}/router\\.ts$`)],
  ['high', 'bindings and environments', /^workers\/oursharedevents\/wrangler\.toml$/],
  ['high', 'CI, gates or ownership', /^\.github\/(workflows\/|scripts\/|CODEOWNERS$)/],
  ['high', 'CI gate script', /^scripts\/ci\//],
  ['high', 'architecture invariant (a weakened gate is a High finding)', /^tests\/e2e\/0-architecture\//],
  ['high', 'agent governance (5+ loop CCR)', /^(AGENTS\.md|CLAUDE\.md|STORIES\.md)$|^\.claude\/(skills|agents|hooks)\/|^\.claude\/settings/],
  [
    'high',
    'dependencies or the pinned design system',
    /^(package(-lock)?\.json|workers\/oursharedevents\/package(-lock)?\.json|\.ocr-hub-ref)$/,
  ],
  ['normal', 'architecture decision record', /^docs\/adr\//],
  ['low', 'documentation', /^docs\//],
  ['low', 'agent working notes', /^\.claude\/(outputs|inputs|research|documents)\//],
  ['low', 'root documentation', /^[^/]+\.md$/],
];

export const REVIEWER = {
  low: { model: 'claude-haiku-5-5', effort: 'low' },
  normal: { model: 'claude-sonnet-5-5', effort: 'medium' },
  high: { model: 'claude-opus-5-5', effort: 'high' },
};

const RANK = { low: 0, normal: 1, high: 2 };

export function classify(files) {
  const reasons = files.map((file) => {
    const rule = RULES.find(([, , re]) => re.test(file));
    return rule ? { file, level: rule[0], why: rule[1] } : { file, level: 'normal', why: 'application code or tests' };
  });
  const risk = reasons.length
    ? reasons.reduce((top, r) => (RANK[r.level] > RANK[top] ? r.level : top), 'low')
    : 'normal';
  return { risk, reviewer: REVIEWER[risk], reasons };
}

function changedFiles(argv) {
  const at = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  const list = at('--files');
  if (list) return readFileSync(list, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const base = at('--base');
  if (base) {
    const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  }
  process.stderr.write('usage: pr-risk.mjs --base <ref> | --files <list>\n');
  process.exit(2);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/ci/pr-risk.mjs')) {
  process.stdout.write(JSON.stringify(classify(changedFiles(process.argv.slice(2))), null, 2) + '\n');
}
