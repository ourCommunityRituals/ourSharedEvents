#!/usr/bin/env node
// OCR policy gate: a Claude Code PreToolUse hook.
//
// "Confidence is a signal. Policy is authority." These are fixed rules, so no
// model judgement (auto mode included) can approve the actions listed below.
// The owner runs any of them in their own terminal when they are intended.
//
// Contract: Claude Code sends the tool call as JSON on stdin.
//   exit 2 + stderr -> the call is blocked and the reason is shown to Claude
//   exit 0          -> the call goes ahead (normal permission rules still apply)
// Bad input fails OPEN with a warning, so a harness change cannot lock every
// session; the test file covers that path too. A missing script also fails open,
// which is why the install check (verify-hardening W1/W6) exists.
//
// Limits: this matches text. It stops honest mistakes and the cheap, common
// forms of an injected command (quotes, .exe, variables, aliases, config
// edits); it does not stop an agent that builds a command from pieces at
// runtime, an encoded command, or any program that makes its own network or
// file calls. The control that holds against those is on the GitHub side (a
// tag ruleset and required reviews, applied to an agent identity that is not an
// admin). It sits alongside the permission deny rules and auto mode.
//
// Rules read the command word and subcommand (git push, gh release create), not
// any substring, so a commit message that mentions `git push --tags` is fine.
//
// Each Bash/PowerShell call is appended, with secrets redacted, to
// ~/.claude/audit/policy-YYYY-MM-DD.jsonl (OCR_POLICY_AUDIT_DIR overrides).
//
// Tests: node --test .claude/hooks/policy-gate.test.mjs

import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix } from 'node:path';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep']);

// Files that hold credentials. Templates (.env.example, .env.sample) are allowed.
const SENSITIVE_PATH =
  /(\.claude[\\/](config|\.credentials)\.json|\.dev\.vars\b|\.wrangler[\\/]config|actions-runner[^\\/\s"']*[\\/]\.(credentials|runner)\b|\.git-credentials|\.npmrc\b|id_(rsa|ed25519|ecdsa|dsa)\b|[\\/]\.config[\\/]gh[\\/]hosts\.yml|[\\/]GitHub[ `]*CLI[\\/]hosts\.yml|[\\/]User Data[\\/](?:[^\\/]+[\\/])?(Login Data|Cookies|Web Data|Local State)|[\\/]\.aws[\\/]credentials|[\\/]\.netrc\b|[\\/]\.docker[\\/]config\.json|(^|[\\/\s"'=])\.env(\.(?!example\b|sample\b)[\w-]+)?(?=$|[\s"';|&)]))/i;

// Commands that only check that a file exists, without printing it.
const EXISTENCE_CHECK = /^\s*(test-path|ls|dir|get-item|stat)\b/i;

// A call with its line continuations joined, split at ; & | and newlines.
function segments(command) {
  const base = command
    .replace(/\\\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ')
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const seg of base) {
    out.push(seg);
    // $(...) and `...` run commands too: check what is inside, right after its parent
    for (const m of seg.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) out.push((m[1] ?? m[2]).trim());
  }
  return out.filter(Boolean);
}

// The segment as a person would read it: quotes and backticks gone, a call operator and
// ".exe" dropped, so `gh.exe`, "git" and & "C:\\...\\gh.exe" read like plain gh and git.
function norm(seg) {
  return seg
    .replace(/^(\s*[A-Za-z_]\w*=(?:"[^"]*"|'[^']*')\s+)+/, '')
    .replace(/[`"']/g, '')
    .replace(/^\s*&\s*/, '')
    .replace(/\.exe\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The words of a segment after leading VAR=value assignments and wrappers.
function commandWords(n) {
  const w = n.split(' ').filter(Boolean);
  while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) w.shift();
  while (w.length && /^(sudo|command|exec|time|nohup)$/i.test(w[0])) w.shift();
  return w;
}

// git <global options> <subcommand> <args>
// A quoted path with spaces ("C:\Program Files\GitHub CLI\gh") splits into several words;
// find the program by the last part of its path among the first few words.
function fromTool(n, name) {
  const w = commandWords(n);
  const re = new RegExp(`(^|[\\\\/])${name}$`, 'i');
  const at = w.slice(0, 5).findIndex((x) => re.test(x));
  // words before it must be pieces of a path, or `echo gh release create` would count as gh
  const pathPieces = at >= 0 && w.slice(0, at).every((x) => /[\\/:]/.test(x));
  return at < 0 || !pathPieces ? [] : w.slice(at);
}

function gitCall(n) {
  const w = fromTool(n, 'git');
  if (!w.length) return null;
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) i += /^-[Cc]$/.test(w[i]) ? 2 : 1;
  return { sub: (w[i] ?? '').toLowerCase(), args: w.slice(i + 1), globals: w.slice(1, i) };
}

// gh <global options> <noun> <verb> <rest>
function ghCall(n) {
  const w = fromTool(n, 'gh');
  if (!w.length) return null;
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) i += /^(-R|--repo|--hostname)$/.test(w[i]) ? 2 : 1;
  return {
    noun: (w[i] ?? '').toLowerCase(),
    verb: (w[i + 1] ?? '').toLowerCase(),
    rest: w.slice(i + 2),
  };
}

function isWrangler(seg) {
  return /\bwrangler(\.cmd)?\b/i.test(seg);
}

function targetsProduction(seg) {
  return /(--env[ =](production|prod)\b|-e\s+(production|prod)\b)/i.test(seg);
}

// Read-only wrangler subcommands that are fine against production.
const PROD_READ_ONLY =
  /\bwrangler(\.cmd)?\s+(deployments\s+list|versions\s+(list|view)|secret\s+list|whoami)\b|\bwrangler(\.cmd)?\s+--version\b/i;

function d1StagingReadOnly(seg) {
  if (/--file\b/i.test(seg)) return false;
  const m = seg.match(/--command[ =](["'])([\s\S]*?)\1/i);
  if (!m) return false;
  const sql = m[2].trim();
  if (!/^(select|pragma|explain)\b/i.test(sql)) return false;
  return !/;\s*\S/.test(sql);
}

function ghApiIsMutating(seg) {
  const method = seg.match(/(?:-X|--method)[ =]?([A-Za-z]+)/);
  if (method) return /^(post|put|patch|delete)$/i.test(method[1]);
  return /\s(-f|-F|--field|--raw-field|--input)\b/.test(seg) || /<\s*\S/.test(seg);
}

const GH_SENSITIVE_PATH =
  /(branches\/[^\s/]+\/protection|\/rulesets\b|actions\/(secrets|variables|runners|permissions)\b|\/hooks\b|\/collaborators\b|\/environments\b|\/keys\b|\/git\/(refs|tags)\b|\/releases\b|\/pending_deployments\b|\/contents\/|\/dispatches\b)/i;

// ---- tags: the workflow trigger is v*.*.*, so match that glob, not a version number ----
const TAG_GLOB = /^\+?(refs\/tags\/)?v.*\..*\..*$/i;
const DYNAMIC = /(\$[A-Za-z_{(]|%[A-Za-z_]+%|`)/;

function pushesTag(git) {
  if (git.sub !== 'push') return false;
  if (git.args.some((a) => /^--(tags|follow-tags|mirror|tag)$/.test(a))) return true;
  return git.args
    .filter((a) => !a.startsWith('-'))
    .some((t) => /refs\/tags\//i.test(t) || t.split(':').some((p) => TAG_GLOB.test(p)));
}

// ---- network ----
// Hosts a web request may go to from a workstation. Anything else is the owner's call:
// it is how a prompt-injected agent sends data out (a body, a file, or a query string).
const ALLOWED_HOSTS =
  /^(localhost|127\.0\.0\.1|\[?::1\]?|([\w-]+\.)*oursharedevents\.com|api\.github\.com|github\.com)$/i;
// Variables the repo's own docs use for the platform's base URL.
const BASE_URL_VAR =
  /\$\{?(STG_BASE_URL|PROD_BASE_URL|BASE_URL|API_BASE|BASE|WORKER_URL|STG_URL)\}?|\$env:(STG_BASE_URL|PROD_BASE_URL|BASE_URL|API_BASE)/i;

function literalHosts(text) {
  const out = [];
  for (const m of text.matchAll(/\b(?:https?|ftp|wss?):\/\/[^\s'"<>|)]+/gi)) {
    try {
      out.push(new URL(m[0]).hostname); // userinfo (https://a:b@evil/) resolves to evil
    } catch {
      out.push('?invalid');
    }
  }
  return out;
}

function webEgress(n, whole) {
  const w = commandWords(n);
  const head = (w[0] ?? '').replace(/^.*[\\/]/, '').toLowerCase();
  const isCurl = head === 'curl' || head === 'wget';
  const isPs = /^(invoke-webrequest|invoke-restmethod|iwr|irm)$/.test(head);
  if (!isCurl && !isPs) return false;
  const hosts = literalHosts(n).concat(literalHosts(whole));
  if (hosts.some((h) => !ALLOWED_HOSTS.test(h))) return true;
  if (hosts.length > 0) return false;
  // No literal URL. localhost without a scheme is fine; so is a read of a named base URL.
  if (/(^|[\s/])(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/\s]|$)/.test(n)) return false;
  const sends =
    head === 'wget'
      ? /\s--(post-data|post-file|body-data|body-file|method)\b/.test(n)
      : isPs
        ? /\s-(Body|InFile|Form|Method)\b/i.test(n)
        : /(\s-[a-zA-Z]*[dFTK][a-zA-Z]*(\s|$)|\s--(data|data-\w+|form|form-string|upload-file|json|config|request|post\w*)\b)/.test(
            n
          );
  if (sends) return !BASE_URL_VAR.test(n);
  return /\$\(|`/.test(n); // a GET whose address is built from a command
}

const NET_TOOL =
  /(^|[\s;&(])(nc|ncat|netcat|scp|sftp|ssh|rsync|telnet|ftp|certutil|bitsadmin)(?![\w-])/i;
const INLINE_INTERPRETER = /\b(node|python3?|py|ruby|perl|deno|bun)\s+(-e|-c|--eval|-E)\b/i;
const NET_API =
  /(fetch\s*\(|https?\b|urllib|requests\b|socket|XMLHttpRequest|http\.request|WebSocket|net\.connect)/i;
const PS_NET =
  /(Net\.WebClient|System\.Net\.|HttpClient|Send-MailMessage|Start-BitsTransfer|\.Upload(File|String|Data)\b)/i;

// ---- the guard's own files ----
// Redirects to /dev/null or a stream are not writes.
const BENIGN_REDIRECT = /\d?>\s*(&\d|\/dev\/null|NUL\b)|&>\s*\/dev\/null/gi;
const HOME_CLAUDE =
  /(~|%USERPROFILE%|\$env:(USERPROFILE|HOME)|\$\{?(HOME|USERPROFILE)\}?|[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+|\/c\/Users\/[^/\s"']+|\/(home|Users)\/[^/\s"']+|\/root)[\\/]+\.claude(?![\w-])/i;
const WRITE_VERB =
  /(>|\b(set-content|add-content|out-file|tee|cp|copy|copy-item|cpi|mv|move|move-item|mi|ren|rename|rename-item|rni|rm|del|erase|rd|rmdir|remove-item|ri|sc|ac|ni|new-item|sed|install|ln|dd|robocopy|xcopy|unlink|truncate|touch|chmod|chown|attrib|icacls|writealltext|writealllines|writeallbytes|writefilesync|appendfilesync)\b|\bcurl\b.*(\s-o\b|\s-O\b|--output))/i;

function selfConfig(command, n) {
  if (/\bclaude(-code)?\b.*\bmcp\s+(add|add-json|add-from-claude-desktop|remove)\b/i.test(n)) {
    return true;
  }
  const cmd = command.replace(BENIGN_REDIRECT, ' ');
  const homeClaude = HOME_CLAUDE.test(cmd) || /\bcd\s+\S*\.claude\b/i.test(cmd);
  const projectConfig =
    /\.claude[\\/]+settings(\.local)?\.json|(^|[\\/\s=])\.mcp\.json|[\\/]\.claude\.json/i.test(cmd);
  const sensitive = /(settings(\.local)?\.json|policy-gate|[\\/]hooks([\\/]|\b)|audit|\.claude\.json)/i;
  const writes = WRITE_VERB.test(cmd);
  const inlineCode = INLINE_INTERPRETER.test(cmd);
  // The repo's hook copy and the files the owner installs from are not written through a shell
  // (Edit and Write leave a visible diff and go through review; a redirect does not).
  const guardSource =
    /\.claude[\\/]+hooks[\\/]|policy-gate\.mjs|settings\.user\.proposed\.json|scripts[\\/]+hardening[\\/]/i.test(
      cmd
    );
  return (
    (guardSource && writes) ||
    (projectConfig && (writes || inlineCode)) ||
    (homeClaude && writes && sensitive.test(cmd)) ||
    (homeClaude && inlineCode)
  );
}

// Each rule: [id, reason, test(segment, normalisedSegment, wholeCommand) -> true when blocked]
// Older rules read the segment; the 2026-10-12 rules read the normalised one.
const SHELL_RULES = [
  [
    'wrangler-deploy',
    'Deploys go through CI (T1 / deploy-production), never from a workstation.',
    (s) =>
      isWrangler(s) &&
      /\b(deploy|publish|rollback|versions\s+(deploy|upload))\b/i.test(s) &&
      !/--dry-run\b/i.test(s),
  ],
  [
    'wrangler-production',
    'Production is changed through CI and runbooks only; read-only wrangler commands are allowed.',
    (s) =>
      isWrangler(s) && targetsProduction(s) && !PROD_READ_ONLY.test(s) && !/--dry-run\b/i.test(s),
  ],
  [
    'wrangler-secret',
    'Secrets are set by the owner in a separate terminal (feedback: secrets handling).',
    (s) => isWrangler(s) && /\bsecret(:bulk\b|\s+(put|delete|bulk)\b)/i.test(s),
  ],
  [
    'wrangler-destroy',
    'Deleting or restoring Cloudflare resources is a break-glass step for the owner.',
    (s) =>
      isWrangler(s) &&
      (/\b(d1\s+(delete|time-travel\s+restore)|r2\s+(bucket|object)\s+delete|kv\s+(namespace|key|bulk)\s+delete|queues\s+delete)\b/i.test(
        s
      ) ||
        /\bwrangler(\.cmd)?\s+delete\b/i.test(s) ||
        (/\b(r2\s+object\s+put|kv\s+(key|bulk)\s+put)\b/i.test(s) && /--remote\b/i.test(s))),
  ],
  [
    'd1-remote-migrate',
    'Remote D1 migrations are applied by CI.',
    (s) => isWrangler(s) && /\bd1\s+migrations\s+apply\b/i.test(s) && /--remote\b/i.test(s),
  ],
  [
    'd1-remote-write',
    'Remote D1 from a workstation is read-only: one SELECT/PRAGMA/EXPLAIN via --command.',
    (s) =>
      isWrangler(s) &&
      /\bd1\s+execute\b/i.test(s) &&
      /--remote\b/i.test(s) &&
      !d1StagingReadOnly(s),
  ],
  [
    'git-force-push',
    'Force pushes rewrite shared history.',
    (s) => {
      const g = gitCall(norm(s));
      return (
        g?.sub === 'push' &&
        g.args.some((a) => /^(--force(-with-lease)?(=.*)?|-[a-z]*f[a-z]*|\+\S+)$/i.test(a))
      );
    },
  ],
  [
    'git-delete-main',
    'The default branch is never deleted.',
    (s) => {
      const g = gitCall(norm(s));
      return (
        g?.sub === 'push' &&
        /(--delete\s+(\S+\s+)?(main|master)\b|\s:(main|master)\b)/i.test(g.args.join(' ') + ' ')
      );
    },
  ],
  [
    'gh-admin-merge',
    'Admin merges bypass branch protection.',
    (s) => {
      const c = ghCall(norm(s));
      return c?.noun === 'pr' && c.verb === 'merge' && c.rest.includes('--admin');
    },
  ],
  [
    'gh-secret-variable',
    'Repository secrets and variables are set by the owner.',
    (s) => {
      const c = ghCall(norm(s));
      return (
        (c?.noun === 'secret' || c?.noun === 'variable') && /^(set|delete|remove)$/.test(c.verb)
      );
    },
  ],
  [
    'gh-repo-destructive',
    'Repository-level destructive or visibility changes are owner-only.',
    (s) => {
      const c = ghCall(norm(s));
      if (!c) return false;
      return (
        (c.noun === 'repo' && /^(delete|archive|rename|edit)$/.test(c.verb)) ||
        (c.noun === 'release' && c.verb === 'delete') ||
        (c.noun === 'ruleset' && c.verb === 'delete') ||
        (c.noun === 'workflow' && c.verb === 'disable')
      );
    },
  ],
  [
    'gh-api-protected',
    'Branch protection, rulesets, runners, secrets, hooks, environments, refs, releases, contents and deployments are owner-only; any DELETE is owner-only.',
    (s) => {
      const n = norm(s);
      const c = ghCall(n);
      return (
        c?.noun === 'api' &&
        ghApiIsMutating(n) &&
        (/(?:-X|--method)[ =]?delete\b/i.test(n) || GH_SENSITIVE_PATH.test(n))
      );
    },
  ],
  // ---- 2026-10-12 hardening (agent workstation review). Each reason names the path it closes.
  [
    'git-tag-push',
    'A pushed v*.*.* tag starts the production deploy chain; the owner pushes release tags.',
    (s, n) => {
      const g = gitCall(n);
      return g ? pushesTag(g) : false;
    },
  ],
  [
    'git-push-dynamic',
    'A push whose target is built at run time (variable, subshell, xargs) cannot be checked, so it is the owner’s.',
    (s, n) => {
      const g = gitCall(n);
      return (
        (g?.sub === 'push' && DYNAMIC.test(s)) || /\bxargs\b[^|;&]*\bgit\b[^|;&]*\bpush\b/i.test(n)
      );
    },
  ],
  [
    'credential-store',
    'The OS credential store and git credential helpers are never queried by an agent.',
    (s, n) => {
      const g = gitCall(n);
      return (
        (g?.sub ?? '').startsWith('credential') ||
        (g?.sub === 'config' &&
          g.args.some((a) => /^(--list|-l|--get-regexp|--show-origin|--get-urlmatch)$/.test(a))) ||
        /(^|[\s/\\])git-credential(-manager)?(-\w+)?(\s|$)/i.test(n) ||
        /(^|[\s;&(])(cmdkey|vaultcmd)(?![\w-])/i.test(n) ||
        /Get-StoredCredential|\[Windows\.Security\.Credentials/i.test(n)
      );
    },
  ],
  [
    'git-config-escape',
    'Git aliases, remote URLs, insteadOf, hooksPath and credential helpers redirect later commands past these rules.',
    (s, n) => {
      const g = gitCall(n);
      if (!g) return false;
      const key =
        /^(alias\.|remote\.[^.]+\.(push)?url|url\..*\.(push)?insteadof|core\.(sshcommand|hookspath|fsmonitor|editor|pager)|credential\.|http\.(proxy|extraheader)|include(if)?\.)/i;
      const viaGlobal = g.globals.some((x) => key.test(x.replace(/=.*$/, '')));
      const setting =
        g.sub === 'config' &&
        g.args.filter((a) => !a.startsWith('-')).length >= 1 &&
        !g.args.some((a) => /^--(get|get-all|get-regexp|list|show-origin|unset)$/.test(a)) &&
        key.test(g.args.find((a) => !a.startsWith('-')) ?? '');
      return viaGlobal || setting;
    },
  ],
  [
    'git-remote-redirect',
    'Adding a remote or pushing to a raw URL or path sends the repository somewhere the owner has not chosen.',
    (s, n) => {
      const g = gitCall(n);
      if (!g) return false;
      const own = /github\.com[:/]ourCommunityRituals\//i;
      if (g.sub === 'remote' && /^(add|set-url|set-head|rename)$/.test(g.args[0] ?? '')) {
        return !g.args.slice(1).some((a) => own.test(a)) || g.args[0] === 'set-head';
      }
      if (g.sub === 'push') {
        const target = g.args.find((a) => !a.startsWith('-'));
        return Boolean(target) && /[\\/@:]|^\.\.?$/.test(target) && !own.test(target);
      }
      return false;
    },
  ],
  [
    'gh-release-create',
    'Creating or editing a release creates a tag, which starts the production deploy chain.',
    (s, n) => {
      const c = ghCall(n);
      return c?.noun === 'release' && /^(create|upload|edit)$/.test(c.verb);
    },
  ],
  [
    'gh-graphql-mutation',
    'GraphQL can create or delete refs, merge and change protection; the REST rules cannot see it.',
    (s, n) => {
      const c = ghCall(n);
      if (c?.noun !== 'api' || c.verb !== 'graphql') return false;
      return (
        /--input\b/.test(n) ||
        /\b(createRef|updateRef|deleteRef|mergePullRequest|enablePullRequestAutoMerge|(create|update|delete)BranchProtectionRule|(create|update|delete)Ruleset|(create|delete)Release|addPullRequestReview|approve\w*)\b/i.test(
          n
        )
      );
    },
  ],
  [
    'prod-dispatch',
    'Production deploys are dispatched by the owner, with the typed confirmation.',
    (s, n) => {
      const c = ghCall(n);
      if (c?.noun === 'workflow' && c.verb === 'run') {
        return /PRODUCTION\b|_production|(oursharedevents-)?ci\.yml/i.test(c.rest.join(' '));
      }
      return (
        /deploy_production/i.test(n) &&
        /(\bgh\b|\bcurl\b|\binvoke-(rest|web)method\b|\biwr\b|\birm\b)/i.test(n)
      );
    },
  ],
  [
    'npm-deploy',
    'A package script that deploys is a workstation deploy by another name.',
    (s, n) => {
      const w = commandWords(n);
      return (
        /^(npm|pnpm|yarn)$/i.test(w[0] ?? '') && w.slice(1, 4).some((t) => /deploy|publish/i.test(t))
      );
    },
  ],
  [
    'gh-auth-token',
    'Printing or changing the GitHub token hands an agent the owner identity.',
    (s, n) => {
      const c = ghCall(n);
      if (c?.noun !== 'auth') return false;
      return (
        /^(token|refresh|login|logout|setup-git|switch)$/.test(c.verb) ||
        (c.verb === 'status' && c.rest.some((a) => /^(--show-token|-[a-z]*t[a-z]*)$/i.test(a)))
      );
    },
  ],
  [
    'env-dump',
    'Environment variables hold tokens; printing them or the whole environment is the owner’s.',
    (s, n) =>
      /^(env|printenv|set)$/i.test(n) ||
      /^(printenv|env)\s+\S*(TOKEN|SECRET|KEY|PASSWORD|PASS|CRED)\S*$/i.test(n) ||
      /\b(get-childitem|gci|ls|dir)\s+(-\w+\s+)*env:/i.test(n) ||
      /\$env:\w*(TOKEN|SECRET|KEY|PASSWORD|CRED)\w*/i.test(n) ||
      /^(echo|printf|write-output|write-host)\b.*\$\{?\w*(TOKEN|SECRET|PASSWORD|API_KEY)\w*\}?/i.test(
        n
      ),
  ],
  [
    'net-upload',
    'Web requests only go to localhost, *.oursharedevents.com, api.github.com and github.com.',
    (s, n, whole) => webEgress(n, whole),
  ],
  [
    'net-tool',
    'Raw network tools, gists, new repositories and inline network code are the owner’s.',
    (s, n) => {
      const c = ghCall(n);
      return (
        NET_TOOL.test(commandWords(n)[0] ?? '') ||
        (c?.noun === 'gist' && c.verb === 'create') ||
        (c?.noun === 'repo' && c.verb === 'create') ||
        (INLINE_INTERPRETER.test(n) && NET_API.test(n)) ||
        PS_NET.test(n) ||
        /\/dev\/(tcp|udp)\//i.test(n)
      );
    },
  ],
  [
    'bypass-permissions',
    'A nested agent with permissions bypassed or a different config folder is outside every rule here.',
    (s, n) =>
      /--(allow-)?dangerously-skip-permissions\b|--permission-mode\b|--settings\b|--allowed-?tools\b|--mcp-config\b|\bCLAUDE_CONFIG_DIR\b|\bIS_SANDBOX\s*=/i.test(
        n
      ) && /\bclaude(-code)?\b|CLAUDE_CONFIG_DIR|IS_SANDBOX/i.test(n),
  ],
  [
    'owner-script',
    'The hardening apply scripts change security settings; the owner runs them in a terminal.',
    (s, n) => /scripts[\\/]hardening[\\/]apply-\w+\.mjs/i.test(n) && /--apply\b/.test(n),
  ],
];
// Rules that read quotes in the original text (SQL in --command, backticks and $ for dynamic).
const RAW_ONLY = new Set(['d1-remote-write', 'git-push-dynamic']);

// A heredoc body is text (a commit message, a PR body), not commands, unless it is fed to a
// shell or an interpreter, in which case it is kept and checked line by line.
function withoutHeredocBodies(command) {
  return command.replace(
    /^([^\n]*?)<<-?\s*(['"]?)(\w+)\2([^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/gm,
    (whole, head, _q, _tag, tail) =>
      /\b(bash|sh|zsh|dash|pwsh|powershell|python3?|node|ruby|perl|cmd)\b/i.test(head)
        ? whole
        : `${head}${tail}`
  );
}

// Ways to make something run later or to install from somewhere else.
const PERSISTENCE =
  /(\.git[\\/]hooks[\\/]|\bschtasks(\.exe)?\s+\/create\b|\bcrontab\b|\$PROFILE\b|Microsoft\.PowerShell_profile|\b(Register|New)-ScheduledTask\b|\breg(\.exe)?\s+add\b[^\n]*\\Run\b|\bnpm\s+config\s+set\s+(@[\w-]+:)?registry\b|\\Start Menu\\Programs\\Startup)/i;

function checkShell(rawCommand) {
  const command = withoutHeredocBodies(rawCommand);
  const segs = segments(command);
  const wholeNorm = norm(command.replace(/\r?\n/g, ' '));
  if (PERSISTENCE.test(command) && /(>|\b(add|create|set|register|new|set-content|add-content|out-file|tee|cp|copy|mv|move)\b)/i.test(command)) {
    return [
      'persistence',
      'Git hooks, scheduled tasks, shell profiles and package registries run or install things later; they are the owner’s.',
    ];
  }
  if (SENSITIVE_PATH.test(command) && !segs.every((s) => EXISTENCE_CHECK.test(s))) {
    return ['credential-file', 'Credential files are never read or copied by an agent.'];
  }
  if (/\.claude[\\/][^\s"']*[*?[]/.test(command)) {
    return ['credential-glob', 'A wildcard over ~/.claude can reach credential files.'];
  }
  if (selfConfig(command, wholeNorm)) {
    return [
      'self-config',
      'An agent does not change its own MCP servers, permissions, hooks or audit log; the owner does that.',
    ];
  }
  for (const seg of segs) {
    const n = norm(seg);
    for (const [id, why, blocks] of SHELL_RULES) {
      if (blocks(seg, n, wholeNorm) || (!RAW_ONLY.has(id) && blocks(n, n, wholeNorm))) {
        return [id, why];
      }
    }
  }
  return null;
}

// ---- MCP tools: the same capabilities reached without a shell ----
const MCP_RULES = [
  [
    'mcp-cloudflare-write',
    'Cloudflare changes go through CI and the owner’s terminal, not an agent tool call.',
    /^mcp__cloudflare__(worker_(deploy|put|delete)|secret_(put|delete)|env_var_(set|bulk_set|delete)|d1_(create|delete)_database|r2_(create|delete)_bucket|r2_(put|delete)_object|kv_(put|delete)|route_(create|update|delete)|version_rollback|wfp_|service_binding_(create|update|delete)|do_(create|delete)_|do_alarm_|queue_(create|delete|send|update)|workflow_(create|delete|update|execute)|cron_(create|update|delete)|wrangler_config_update|template_create_worker)/,
  ],
  [
    'mcp-session-control',
    'Permission mode, remote control, connector toggles and session messaging are the owner’s.',
    /^mcp__ccd_(settings__set_setting|session_mgmt__(set_session_permission_mode|set_remote_control|delete_session|send_message|stop_session|set_session_model|set_session_output_style)|connectors__set_session_connector_enabled|host__(discard_kept_worktree|clean_up_worktrees)|directory__change_directory)/,
  ],
];

function checkMcp(tool, input) {
  for (const [id, why, re] of MCP_RULES) if (re.test(tool)) return [id, why];
  if (tool === 'mcp__terminal__run_in_terminal') return checkShell(String(input.command ?? ''));
  return null;
}

// Path forms that name the same file: \\?\ and \\localhost\C$\ prefixes, ".." segments,
// trailing dots or spaces, NTFS alternate data streams, and ~.
function resolveExisting(p) {
  // Follows junctions, symlinks and 8.3 short names when the file (or its folder) exists.
  // A path that is not absolute on this platform (a Windows path on Linux) is left alone:
  // resolving it would prepend the working directory and hide it from the home-folder match.
  if (!isAbsolute(p)) return p;
  try {
    return realpathSync.native(p);
  } catch {
    try {
      return join(realpathSync.native(dirname(p)), basename(p));
    } catch {
      return p;
    }
  }
}

function canonicalPath(p) {
  let s = String(p)
    .trim()
    .replace(/^\\\\\?\\/, '')
    .replace(/^\\\\(?:localhost|127\.0\.0\.1)\\([a-z])\$\\/i, '$1:\\')
    .replace(/::\$data$/i, '')
    .replace(/^~(?=$|[\\/])/, homedir());
  s = resolveExisting(s);
  s = s.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  s = posix.normalize(s).replace(/[. ]+$/, '').replace(/\/+$/, '');
  return s.toLowerCase();
}

function checkFile(tool, input) {
  const path = input.file_path ?? input.notebook_path ?? input.path ?? '';
  if (path && (SENSITIVE_PATH.test(path) || SENSITIVE_PATH.test(canonicalPath(path)))) {
    return ['credential-file', 'Credential files are never read or edited by an agent.'];
  }
  // Writes only: reading settings is how an inventory gets done. An agent that can edit
  // its own permissions, hooks, MCP servers or audit log can switch every other rule off.
  if (path && tool !== 'Read' && tool !== 'Grep') {
    const norm = canonicalPath(path);
    const home = canonicalPath(homedir());
    const projectSettings = /(^|\/)\.claude\/settings(\.local)?\.json$/;
    // any user's home (a UNC or drive path to another profile is the same attack)
    const anyHome =
      /^([a-z]:\/users\/[^/]+|\/(home|users)\/[^/]+|\/root)\/\.claude(\.json$|\/(hooks|audit|skills|commands|agents|plugins|output-styles)(\/|$))/;
    const homeConfig =
      anyHome.test(norm) ||
      norm === `${home}/.claude.json` ||
      norm.startsWith(`${home}/.claude/hooks`) ||
      norm.startsWith(`${home}/.claude/audit`) ||
      /\/\.claude\/[^/]*~\d/.test(norm); // an 8.3 short name that did not resolve
    // Things that run later, or load as instructions, outside the repo's review.
    const persistence =
      /\/\.git\/hooks\//.test(norm) ||
      /\/claude_desktop_config\.json$/.test(norm) ||
      /\/microsoft\.powershell_profile\.ps1$/.test(norm) ||
      /\/\.(bashrc|zshrc|profile|bash_profile)$/.test(norm);
    if (
      projectSettings.test(norm) ||
      homeConfig ||
      persistence ||
      /(^|\/)\.mcp\.json$/.test(norm)
    ) {
      return [
        'self-config',
        'An agent does not change its own MCP servers, permissions, hooks or audit log; the owner does that.',
      ];
    }
  }
  // A content search over the home folder or ~/.claude would print matches from
  // config.json and .credentials.json. Narrower folders (projects/, memory/) are fine.
  if (tool === 'Grep' && path) {
    const home = canonicalPath(homedir());
    const target = canonicalPath(path);
    const broad =
      /^([a-z]:|\/users|\/home|[a-z]:\/users)$/.test(target) ||
      target === `${home}/appdata` ||
      target === `${home}/appdata/local` ||
      target === `${home}/appdata/roaming` ||
      target === `${home}/.config`;
    if (target === home || target === `${home}/.claude` || broad) {
      return [
        'credential-search',
        'Searching the whole home folder or ~/.claude would reach credential files; search a narrower folder.',
      ];
    }
  }
  return null;
}

function redact(text) {
  return text
    .replace(/sk-ant-[\w-]+/g, 'sk-ant-[REDACTED]')
    .replace(/gh[pousr]_\w{20,}/g, 'gh_[REDACTED]')
    .replace(/github_pat_\w+/g, 'gh_[REDACTED]')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]')
    .replace(/(Authorization:\s*)\S+(\s+\S+)?/gi, '$1[REDACTED]')
    .replace(/(X-OCR-Internal:\s*)\S+/gi, '$1[REDACTED]')
    .replace(/(CF-Access-Client-(?:Id|Secret):\s*)\S+/gi, '$1[REDACTED]')
    .replace(/(\/\/[^\s:@/]+:)[^\s@/]+@/g, '$1[REDACTED]@')
    .replace(/(\s-u\s+[^\s:]+:)\S+/g, '$1[REDACTED]')
    .replace(/(Bearer\s+)[\w.~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(--(?:token|password|secret|api-key)[ =])\S+/gi, '$1[REDACTED]')
    .replace(/(\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|INTERNAL)\s*=\s*)\S+/g, '$1[REDACTED]');
}

function audit(entry) {
  try {
    const dir = process.env.OCR_POLICY_AUDIT_DIR || join(homedir(), '.claude', 'audit');
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(dir, `policy-${day}.jsonl`), JSON.stringify(entry) + '\n');
  } catch {
    // Auditing never blocks work.
  }
}

let call;
try {
  call = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.stderr.write('policy-gate: could not read the hook input; allowing this call.\n');
  process.exit(0);
}

const tool = call.tool_name ?? '';
const input = call.tool_input ?? {};
let verdict = null;

if (SHELL_TOOLS.has(tool)) {
  const command = String(input.command ?? '');
  verdict = checkShell(command);
  audit({
    ts: new Date().toISOString(),
    session: call.session_id ?? null,
    cwd: call.cwd ?? null,
    tool,
    decision: verdict ? 'block' : 'allow',
    rule: verdict ? verdict[0] : null,
    command: redact(command),
  });
} else if (FILE_TOOLS.has(tool)) {
  verdict = checkFile(tool, input);
  if (verdict) {
    audit({
      ts: new Date().toISOString(),
      session: call.session_id ?? null,
      tool,
      decision: 'block',
      rule: verdict[0],
    });
  }
} else if (tool.startsWith('mcp__')) {
  verdict = checkMcp(tool, input);
  if (verdict) {
    audit({
      ts: new Date().toISOString(),
      session: call.session_id ?? null,
      tool,
      decision: 'block',
      rule: verdict[0],
    });
  }
}

if (verdict) {
  process.stderr.write(
    `Blocked by the OCR policy gate [${verdict[0]}]: ${verdict[1]} ` +
      'If this is intended, ask the owner to run it in their own terminal.\n'
  );
  process.exit(2);
}
process.exit(0);
