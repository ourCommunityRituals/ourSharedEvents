# `.claude/hooks/`: OCR policy gate

A Claude Code **PreToolUse** hook that blocks a fixed list of actions, whatever
any model thinks about them: workstation deploys, production changes, secret
writes, remote D1 writes, Cloudflare deletes, force pushes, admin merges,
protected `gh api` calls, and reading or searching credential files. Each
Bash/PowerShell call is logged to `~/.claude/audit/policy-YYYY-MM-DD.jsonl`
with secrets redacted.

Background: `.claude/outputs/CCR-CLAUDE-USAGE-OPTIMIZATION-2026-10-11.md`
(finding S2, and S1, where an agent printed `~/.claude/config.json`).

| File                          | What it is                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `policy-gate.mjs`             | The hook (Node, no dependencies)                                                                       |
| `policy-gate.test.mjs`        | 120 cases: must-block, must-allow near-misses, fail-open, audit redaction (rules added 2026-10-11, see below) |
| `settings.user.proposed.json` | Keys to **merge** into `~/.claude/settings.json` (effort, fast mode, deny rules, hook, plugin pruning) |

## Install (the owner does this; agents are not allowed to edit their own settings)

1. Copy the hook so it covers every repo, not just this one (_infra-wide by default_):
   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\hooks"; Copy-Item .claude\hooks\policy-gate.mjs "$env:USERPROFILE\.claude\hooks\"
   ```
2. Merge `settings.user.proposed.json` into `~/.claude/settings.json`. Add the keys; don't replace the file.
3. Start a new session.

## Verify it is live (born-red, in the new session)

Ask Claude to run `npx wrangler secret:bulk does-not-exist.json`. No deny rule
covers that spelling, so only the hook can stop it. It must be refused with
`[wrangler-secret]`. Even if nothing blocked it, it would fail harmlessly on the
missing file. Then check the audit file for that day.

If it is **not** refused, the hook isn't running (wrong path or the settings
weren't merged). A missing script fails open, so check this rather than assume.

## Tests

```bash
node --test .claude/hooks/policy-gate.test.mjs
```

Mutation check on 2026-10-11: six planted faults (admin merge allowed,
credential read allowed, key not redacted, block downgraded to allow, remote D1
without `--command` allowed, dry-run exemption removed) each turned the suite
red.

## Limits

It matches command text. It stops honest mistakes, not an agent working to hide
what it runs (paths built from variables, encoded commands). It works alongside
the deny rules and auto mode; it does not replace them. To run a blocked command
on purpose, run it yourself in your own terminal. There is no override flag an
agent could add to a command.
