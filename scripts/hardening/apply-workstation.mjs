#!/usr/bin/env node
// OWNER-RUN. Applies the workstation half of the hardening to ~/.claude/settings.json.
//
//   node scripts/hardening/apply-workstation.mjs            # dry run: prints the plan, writes nothing
//   node scripts/hardening/apply-workstation.mjs --apply    # needs a real terminal + typing APPLY
//
// What it does (idempotent; every step is reported by name, never by value):
//   1. installs the policy gate as merged on origin/main (not your working copy) into
//      ~/.claude/hooks/ and wires it as a PreToolUse hook for shell, file and MCP tools
//   2. adds the deny rules from .claude/hooks/settings.user.proposed.json, plus token / tag /
//      wrangler-config reads
//   3. removes open-ended exec, network and identity rules from the allow list and puts narrow
//      git verbs in their place (branch pushes stay; tag pushes are blocked by the hook)
//   4. turns off remoteControlAtStartup and autoApproveExecutions
// It keeps a timestamped backup next to the file.
//
// The guard is "needs your terminal": an agent's shell has none. It is not a lock against a
// pseudo-terminal; the hook blocks agents from running this script at all (owner-script rule).
//
// Not done here, because they are your calls: removing the GitKraken hook, un-trusting
// worktrees in ~/.claude.json, and the connector toggles in claude.ai.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRiskyAllowRule } from './verify-hardening.mjs';
import {
  HOOK_SOURCE,
  PROPOSED,
  claudeHome,
  hookFromMain,
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
  const wanted = proposed.hooks.PreToolUse[0];

  // hook wiring, and its matcher (it must cover MCP tools, not only shell and files)
  next.hooks ??= {};
  next.hooks.PreToolUse ??= [];
  const existing = next.hooks.PreToolUse.find((e) => JSON.stringify(e).includes('policy-gate.mjs'));
  if (!existing) {
    const entry = structuredClone(wanted);
    entry.hooks[0].command = hookCommand;
    next.hooks.PreToolUse.push(entry);
    changes.push('hooks.PreToolUse: add policy-gate');
  } else if (existing.matcher !== wanted.matcher) {
    existing.matcher = wanted.matcher;
    changes.push('hooks.PreToolUse: widen the policy-gate matcher');
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

/**
 * Writes the hook and the merged settings under `home`. The CLI calls this after the terminal
 * check; tests call it directly with a scratch folder.
 */
export function applyTo(home, hookText, proposed) {
  const file = settingsPath(home);
  const hookFile = hookInstallPath(home);
  const hookCommand = `node "${hookFile.replace(/\\/g, '/')}"`;
  const { next, changes } = plan(readSettings(home), proposed, hookCommand);
  mkdirSync(dirname(hookFile), { recursive: true });
  writeFileSync(hookFile, hookText);
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(file, join(dirname(file), `settings.json.bak-${stamp}`));
  } else {
    mkdirSync(dirname(file), { recursive: true });
  }
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return changes;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const apply = process.argv.includes('--apply');
  const fromWorktree = process.argv.includes('--from-worktree');
  const home = claudeHome();
  const fromMain = hookFromMain();
  if (!fromMain && !fromWorktree) {
    console.error(
      "Cannot read the hook from origin/main (git fetch origin main first), and the working copy is not trusted by default. Re-run with --from-worktree to install the checkout's copy."
    );
    process.exit(2);
  }
  const hookText = fromMain ?? readFileSync(HOOK_SOURCE, 'utf8');
  const sha = createHash('sha256').update(hookText).digest('hex').slice(0, 16);
  const hookCommand = `node "${hookInstallPath(home).replace(/\\/g, '/')}"`;
  const { changes } = plan(readSettings(home), readJson(PROPOSED), hookCommand);
  const installed = existsSync(hookInstallPath(home))
    ? createHash('sha256')
        .update(readFileSync(hookInstallPath(home)))
        .digest('hex')
        .slice(0, 16)
    : null;

  console.log(`target:    ${settingsPath(home)}`);
  console.log(
    `hook:      ${fromMain ? 'origin/main' : 'WORKING COPY (--from-worktree)'}  sha256:${sha}` +
      `  installed:${installed ?? 'none'}${installed === sha ? ' (same)' : ''}`
  );
  for (const c of changes) console.log(`  - ${c}`);
  if (changes.length === 0) console.log('  (settings already match)');
  if (!apply) {
    console.log('\nDry run. Re-run with --apply in your own terminal to write these changes.');
    return;
  }
  await requireOwnerTerminal(`write ${settingsPath(home)}`);
  const done = applyTo(home, hookText, readJson(PROPOSED));
  console.log(`\nApplied ${done.length} change(s). Start a NEW session, then run:`);
  console.log('  node scripts/hardening/verify-hardening.mjs');
  console.log(
    'and prove the hook is live: ask Claude to run `npx wrangler secret:bulk does-not-exist.json`;'
  );
  console.log(
    'it must be refused with [wrangler-secret]. W6 stays FAIL until the hook has blocked a call.'
  );
}

if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
