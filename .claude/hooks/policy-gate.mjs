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
// session; the test file covers that path too.
//
// Limits: this matches text, so it stops honest mistakes (an agent printing
// ~/.claude/config.json, an unplanned deploy), not an agent determined to hide
// what it runs (a path built from variables, an encoded command). It sits
// alongside the permission deny rules and auto mode; it does not replace them.
//
// Each Bash/PowerShell call is appended, with secrets redacted, to
// ~/.claude/audit/policy-YYYY-MM-DD.jsonl (OCR_POLICY_AUDIT_DIR overrides).
//
// Tests: node --test .claude/hooks/policy-gate.test.mjs

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep']);

// Files that hold credentials. Templates (.env.example, .env.sample) are allowed.
const SENSITIVE_PATH =
  /(\.claude[\\/](config|\.credentials)\.json|\.dev\.vars\b|\.wrangler[\\/]config|actions-runner[^\\/\s"']*[\\/]\.(credentials|runner)\b|\.git-credentials|\.npmrc\b|id_(rsa|ed25519)\b|(^|[\\/\s"'=])\.env(\.(?!example\b|sample\b)[\w-]+)?(?=$|[\s"';|&)]))/i;

// Commands that only check that a file exists, without printing it.
const EXISTENCE_CHECK = /^\s*(test-path|ls|dir|get-item|stat)\b/i;

function segments(command) {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
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
  return /\s(-f|-F|--field|--raw-field|--input)\b/.test(seg);
}

const GH_SENSITIVE_PATH =
  /(branches\/[^\s/]+\/protection|\/rulesets\b|actions\/(secrets|variables|runners|permissions)\b|\/hooks\b|\/collaborators\b|\/environments\b|\/keys\b)/i;

// Each rule: [id, reason, test(segment) -> true when the segment must be blocked]
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
        /\bwrangler(\.cmd)?\s+delete\b/i.test(s)),
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
    (s) =>
      /\bgit\b/i.test(s) &&
      /\bpush\b/i.test(s) &&
      /(\s--force(-with-lease)?\b|\s-[a-z]*f[a-z]*\b|\s\+\S)/i.test(s),
  ],
  [
    'git-delete-main',
    'The default branch is never deleted.',
    (s) =>
      /\bgit\b/i.test(s) &&
      /\bpush\b/i.test(s) &&
      /(--delete\s+(\S+\s+)?(main|master)\b|\s:(main|master)\b)/i.test(s),
  ],
  [
    'gh-admin-merge',
    'Admin merges bypass branch protection.',
    (s) => /\bgh\s+pr\s+merge\b/i.test(s) && /--admin\b/i.test(s),
  ],
  [
    'gh-secret-variable',
    'Repository secrets and variables are set by the owner.',
    (s) => /\bgh\s+(secret|variable)\s+(set|delete|remove)\b/i.test(s),
  ],
  [
    'gh-repo-destructive',
    'Repository-level destructive or visibility changes are owner-only.',
    (s) =>
      /\bgh\s+(repo\s+(delete|archive|rename|edit)|release\s+delete|ruleset\s+delete|workflow\s+disable)\b/i.test(
        s
      ),
  ],
  [
    'gh-api-protected',
    'Branch protection, rulesets, runners, secrets, hooks and environments are owner-only; any DELETE is owner-only.',
    (s) =>
      /\bgh\s+api\b/i.test(s) &&
      ghApiIsMutating(s) &&
      (/(?:-X|--method)[ =]?delete\b/i.test(s) || GH_SENSITIVE_PATH.test(s)),
  ],
];

function checkShell(command) {
  const segs = segments(command);
  if (SENSITIVE_PATH.test(command) && !segs.every((s) => EXISTENCE_CHECK.test(s))) {
    return ['credential-file', 'Credential files are never read or copied by an agent.'];
  }
  for (const seg of segs) {
    for (const [id, why, blocks] of SHELL_RULES) {
      if (blocks(seg)) return [id, why];
    }
  }
  return null;
}

function normalisePath(p) {
  return String(p)
    .replace(/^~(?=$|[\\/])/, homedir())
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function checkFile(tool, input) {
  const path = input.file_path ?? input.notebook_path ?? input.path ?? '';
  if (path && SENSITIVE_PATH.test(path)) {
    return ['credential-file', 'Credential files are never read or edited by an agent.'];
  }
  // A content search over the home folder or ~/.claude would print matches from
  // config.json and .credentials.json. Narrower folders (projects/, memory/) are fine.
  if (tool === 'Grep' && path) {
    const home = normalisePath(homedir());
    const target = normalisePath(path);
    if (target === home || target === `${home}/.claude`) {
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
    .replace(/(Bearer\s+)[\w.~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(--(?:token|password|secret|api-key)[ =])\S+/gi, '$1[REDACTED]')
    .replace(/(\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)\s*=\s*)\S+/g, '$1[REDACTED]');
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
}

if (verdict) {
  process.stderr.write(
    `Blocked by the OCR policy gate [${verdict[0]}]: ${verdict[1]} ` +
      'If this is intended, ask the owner to run it in their own terminal.\n'
  );
  process.exit(2);
}
process.exit(0);
