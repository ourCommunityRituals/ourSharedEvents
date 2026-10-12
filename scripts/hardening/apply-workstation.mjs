#!/usr/bin/env node
// OWNER-RUN. Applies the workstation half of the 2026-10-11 hardening to ~/.claude/settings.json.
//
//   node scripts/hardening/apply-workstation.mjs            # dry run: prints the plan, writes nothing
//   node scripts/hardening/apply-workstation.mjs --apply    # needs a real terminal + typing APPLY
//
// What it does (idempotent; every step is reported by name, never by value):
//   1. copies .claude/hooks/policy-gate.mjs to ~/.claude/hooks/ and wires it as a PreToolUse hook
//   2. adds the deny rules from .claude/hooks/settings.user.proposed.json, plus token / tag /
//      wrangler-config reads
//   3. removes open-ended exec, network and identity rules from the allow list and puts narrow
//      git verbs in their place (branch pushes stay; tag pushes are blocked by the hook)
//   4. turns off remoteControlAtStartup and autoApproveExecutions
// It keeps a timestamped backup next to the file. Agents cannot run --apply: no TTY.
//
// Not done here, because they are your calls: removing the GitKraken hook, un-trusting
// worktrees in ~/.claude.json, and the connector toggles in claude.ai.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRiskyAllowRule } from './verify-hardening.mjs';
import {
  HOOK_SOURCE,
  PROPOSED,
  hookInstallPath,
  readJson,
  readSettings,
  requireOwnerTerminal,
  settingsPath,
} from './lib.mjs';

export const EXTRA_DENY = [
  'Bash(gh auth token*)',
  'Bash(gh release create*)',
  'Bash(git push*--tags*)',
  'Bash(git push*--follow-tags*)',
  'Read(~/.wrangler/**)',
];

export const SAFE_GIT_ALLOW = [
  'Bash(git status*)',
  'Bash(git diff*)',
  'Bash(git log*)',
  'Bash(git show*)',
  'Bash(git add*)',
  'Bash(git commit*)',
  'Bash(git checkout*)',
  'Bash(git switch*)',
  'Bash(git branch*)',
  'Bash(git fetch*)',
  'Bash(git pull*)',
  'Bash(git worktree*)',
  'Bash(git push*)',
];

/** Pure: returns { next, changes } for a settings object. */
export function plan(current, proposed, hookCommand) {
  const next = structuredClone(current);
  const changes = [];
  next.permissions ??= {};

  // hook wiring
  next.hooks ??= {};
  next.hooks.PreToolUse ??= [];
  if (!JSON.stringify(next.hooks.PreToolUse).includes('policy-gate.mjs')) {
    const entry = structuredClone(proposed.hooks.PreToolUse[0]);
    entry.hooks[0].command = hookCommand;
    next.hooks.PreToolUse.push(entry);
    changes.push('hooks.PreToolUse: add policy-gate');
  }

  // deny union
  const deny = new Set(next.permissions.deny ?? []);
  const add = [...(proposed.permissions?.deny ?? []), ...EXTRA_DENY].filter((d) => !deny.has(d));
  if (add.length) {
    next.permissions.deny = [...deny, ...add].filter(Boolean);
    changes.push(`permissions.deny: add ${add.length} rule(s)`);
  }

  // allow: drop open-ended rules, add narrow git
  const allow = next.permissions.allow ?? [];
  const kept = allow.filter((r) => !isRiskyAllowRule(r));
  const dropped = allow.length - kept.length;
  const gitAdd = SAFE_GIT_ALLOW.filter((r) => !kept.includes(r));
  const hadGit = allow.some((r) => /^Bash\(git(:|\s)\*\)$/.test(String(r)));
  if (dropped > 0 || (hadGit && gitAdd.length)) {
    next.permissions.allow = hadGit ? [...kept, ...gitAdd] : kept;
    changes.push(
      `permissions.allow: remove ${dropped} open-ended rule(s)${hadGit ? `, add ${gitAdd.length} narrow git rule(s)` : ''}`
    );
  }

  // flags
  if (next.remoteControlAtStartup !== false) {
    next.remoteControlAtStartup = false;
    changes.push('remoteControlAtStartup: false');
  }
  if (next.autoApproveExecutions !== false) {
    next.autoApproveExecutions = false;
    changes.push('autoApproveExecutions: false');
  }
  return { next, changes };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
async function main() {
  const apply = process.argv.includes('--apply');
  const hookCommand = `node "${hookInstallPath().replace(/\\/g, '/')}"`;
  const { next, changes } = plan(readSettings(), readJson(PROPOSED), hookCommand);
  const hookStale = !existsSync(hookInstallPath());

  console.log(`target: ${settingsPath()}`);
  console.log(
    `hook file: ${hookStale ? 'copy ' + HOOK_SOURCE + ' -> ' + hookInstallPath() : 'already present (will be refreshed)'}`
  );
  for (const c of changes) console.log(`  - ${c}`);
  if (changes.length === 0) console.log('  (settings already match)');
  if (!apply) {
    console.log('\nDry run. Re-run with --apply in your own terminal to write these changes.');
    process.exit(0);
  }
  await requireOwnerTerminal(`write ${settingsPath()}`);
  mkdirSync(dirname(hookInstallPath()), { recursive: true });
  copyFileSync(HOOK_SOURCE, hookInstallPath());
  if (existsSync(settingsPath())) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(settingsPath(), join(dirname(settingsPath()), `settings.json.bak-${stamp}`));
  } else {
    mkdirSync(dirname(settingsPath()), { recursive: true });
  }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + '\n');
  console.log(`\nApplied ${changes.length} change(s). Start a NEW session, then run:`);
  console.log('  node scripts/hardening/verify-hardening.mjs');
  console.log(
    'and prove the hook is live: ask Claude to run `npx wrangler secret:bulk does-not-exist.json`;'
  );
  console.log(
    'it must be refused with [wrangler-secret]. W6 stays FAIL until the hook has logged a call.'
  );
}

if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
