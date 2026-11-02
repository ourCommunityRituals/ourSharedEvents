# `.claude/hooks/`: OCR policy gate

A Claude Code **PreToolUse** hook that blocks a fixed list of actions, whatever
any model thinks about them: workstation deploys, production changes, secret
writes, remote D1 writes, Cloudflare deletes, force pushes, admin merges,
protected `gh api` calls, and reading or searching credential files. Each
Bash/PowerShell call is logged to `~/.claude/audit/policy-YYYY-MM-DD.jsonl`
with secrets redacted.

Background: `docs/ccr-archive/CCR-CLAUDE-USAGE-OPTIMIZATION-2026-10-11.md`
(finding S2, and S1, where an agent printed `~/.claude/config.json`).

| File                          | What it is                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `policy-gate.mjs`             | The hook (Node, no dependencies)                                                                                 |
| `policy-gate.test.mjs`        | 487 cases: must-block, must-allow near-misses, fail-open, audit redaction (rules added 2026-10-12, listed below) |
| `settings.user.proposed.json` | Keys to **merge** into `~/.claude/settings.json` (effort, fast mode, deny rules, hook, plugin pruning)           |

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

## Rules added 2026-10-12 (agent workstation review)

A shell call is tokenised like a shell would read it (quotes, escapes, `;` `&` `|` `&&` `||`, newlines,
redirects, `$(…)` and backticks, heredocs). Each simple command becomes a unit; a unit that hands text to an
interpreter or wrapper (`bash -c`, `powershell -Command`, `cmd /c`, `eval`, `iex`, `env`, `sudo`, `timeout`,
`xargs`, `find -exec`) is unwrapped and read again. Quoted text is data (a commit message, an `echo`) unless it
is given to an interpreter, and a heredoc body is kept whenever anything on its line can execute it. Rules look
at the program and its arguments, so `git commit -m "git push --tags"` is fine and `bash -c "git push --tags"`
is not. `cd` is followed, so `cd ~/.claude && cat config.json` is the same file as `cat ~/.claude/config.json`.

The analysis **fails closed**: past 1.5 M characters, 6 levels of nesting, 2,500 commands or 3 seconds, or on any
exception, the call is refused with `[analysis-failed]`. (Unparseable hook input still fails open, because a
harness change must not lock every session.) A UNC or network path is never opened while analysing it.

| Rule                                          | Blocks                                                                                                                                                 | Why                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `git-tag-push`                                | `git push` of `--tags`, `--follow-tags`, `--mirror`, `refs/tags/…`, or any ref matching the workflow glob `v*.*.*`                                     | A pushed tag starts the production deploy chain                                        |
| `git-push-dynamic`                            | a push whose target is a variable, `$(…)` or `xargs`                                                                                                   | cannot be checked                                                                      |
| `git-config-escape`                           | setting aliases, remote URLs, `insteadOf`, `hooksPath`, credential helpers                                                                             | redirects later commands past these rules                                              |
| `git-remote-redirect`                         | `git remote add/set-url`, pushing to a path or URL                                                                                                     | sends the repository somewhere unchosen (the organisation's own GitHub URL is allowed) |
| `gh-release-create`                           | `gh release create/upload/edit`                                                                                                                        | creates a tag                                                                          |
| `gh-graphql-mutation`                         | GraphQL `createRef`, `deleteRef`, merge, branch-protection and ruleset mutations, or `--input`                                                         | REST rules cannot see it                                                               |
| `prod-dispatch`                               | `gh workflow run` with `PRODUCTION` or the main CI workflow                                                                                            | the owner dispatches production                                                        |
| `npm-deploy`                                  | npm, pnpm or yarn scripts named deploy or publish                                                                                                      | a workstation deploy by another name                                                   |
| `gh-auth-token`                               | `gh auth token/login/refresh/…`, `gh auth status -t`                                                                                                   | hands over the owner identity                                                          |
| `credential-store`                            | `git credential*`, `git config --list`, `cmdkey`, `vaultcmd`                                                                                           | OS and git credential stores                                                           |
| `env-dump`                                    | `env`, `printenv`, `Get-ChildItem Env:`, token-named variables                                                                                         | the environment holds tokens                                                           |
| `net-upload`                                  | `curl`, `wget`, `iwr`, `irm` to any host except localhost, `*.oursharedevents.com`, `api.github.com`, `github.com`                                     | the way data leaves the machine (GET included)                                         |
| `net-tool`                                    | `nc`, `scp`, `ssh`, `rsync`, `certutil`, `gh gist/repo create`, inline network code, `/dev/tcp`                                                        | other egress                                                                           |
| `bypass-permissions`                          | nested `claude` with permission, settings or allowed-tools flags, `CLAUDE_CONFIG_DIR`, `IS_SANDBOX`                                                    | outside every rule here                                                                |
| `self-config`                                 | writes to `~/.claude` settings, hooks, audit, skills, commands, `.mcp.json`, project `settings*.json`, the repo hook through a shell; `claude mcp add` | an agent does not change its own guard                                                 |
| `persistence`                                 | git hooks, scheduled tasks, shell profile, registry run keys, `npm config set registry`                                                                | runs or installs later                                                                 |
| `owner-script`                                | `scripts/hardening/apply-*.mjs --apply`                                                                                                                | owner terminal only                                                                    |
| `credential-glob`                             | a wildcard under `.claude`                                                                                                                             | reaches `.credentials.json`                                                            |
| `git-config-list`                             | `git config --list`, `--get-regexp`, `--show-origin` (not `--local`)                                                                                   | prints remote URLs and helpers that can carry tokens                                   |
| `gh-review-approve`                           | `gh pr review --approve`                                                                                                                               | an agent does not approve pull requests                                                |
| `gh-config`                                   | `gh alias set`, `gh extension install`, `gh config set`                                                                                                | changes what later gh commands do                                                      |
| `encoded-command`                             | `powershell -EncodedCommand`                                                                                                                           | cannot be read, so cannot be checked                                                   |
| `git-env`                                     | `GIT_CONFIG_*`, `GIT_SSH*`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_EXEC_PATH`… set inline or exported                                               | changes how git runs later commands                                                    |
| `pipe-to-shell`                               | anything but `echo`/`printf` piped into `bash`, `sh`, `iex`, `pwsh`, `cmd` (a download included)                                                       | code that cannot be read first; `echo "…"                                              | bash` is read as the command it carries |
| `gh-foreign-repo`                             | `gh -R other/repo`, `--hostname`, `GH_HOST`, `GH_REPO`                                                                                                 | gh pointed outside the organisation                                                    |
| `mcp-code-execution`                          | the Cloudflare connector's `d1_database_query`, `browser_run_code_unsafe`, Chrome `javascript_tool`, `firebase_deploy`                                 | arbitrary SQL, script or deploy on a connected service                                 |
| `analysis-failed`                             | a call that is too large, nested too deeply, has too many commands, or cannot be analysed within 3 s                                                   | a gate that gives up quietly can be made to give up                                    |
| `mcp-cloudflare-write`, `mcp-session-control` | Cloudflare write tools; permission mode, remote control, connector toggles, session messaging                                                          | the same actions without a shell                                                       |

`mcp__terminal__run_in_terminal` is checked as a shell. The matcher in `settings.user.proposed.json`
includes `mcp__.*`; without it these MCP rules do not run.

### What this does not stop

Text matching is a speed bump, not a lock. Not covered: a program that makes its own network or file
calls (`node deploy.js`), a command assembled from pieces at run time, `git bundle`, Gmail, Drive and
Notion tools (scope those per session), writes through the Cloudflare connector's
`d1_database_query`, and edits to the repo's own hook through Edit or Write (those go through review:
`pr-risk` marks the hook high risk). The control that holds is on the GitHub side: a tag ruleset and
required reviews against an agent identity that is not an admin. Measure the result with
`node scripts/hardening/verify-hardening.mjs`; owner steps are in
`docs/security/AGENT-WORKSTATION-HARDENING.md`.
