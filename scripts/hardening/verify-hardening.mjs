#!/usr/bin/env node
// Read-only verifier for the two planes graded in the 2026-10-11 security review:
//   workstation  Claude Code settings, hook, connectors, MCP, token scopes
//   github       CODEOWNERS, branch protection, tag ruleset, environments, secrets
//
//   node scripts/hardening/verify-hardening.mjs            # table + grade, exit 1 on any FAIL
//   node scripts/hardening/verify-hardening.mjs --json
//   node scripts/hardening/verify-hardening.mjs --only=workstation|github
//   node scripts/hardening/verify-hardening.mjs --self-test
//
// It never writes, never prints a settings value or a token, and treats a check it
// cannot run as FAIL: an unverifiable control is an unenforced control.
//
// Grade rubric (ours, not an industry standard): per plane, 0 FAIL = A, +0 WARN = A+;
// 1-2 FAIL = B; 3-4 = C; 5-6 = D; more = F.
//
// What a PASS means, and does not: the checks read configuration. W6 reads the hook's own audit
// log, which a process with file access could write; it is evidence the hook ran, not proof.
// OCR_GH_FIXTURE answers gh calls from a file (tests); the output says so when it is set.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOOK_SOURCE,
  PROPOSED,
  REPO,
  claudeHome,
  fixtureMode,
  gh,
  ghJson,
  hookFromMain,
  hookInstallPath,
  readJson,
  readSettings,
  redact,
} from './lib.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Allow rules that hand an agent code execution, a network path or the owner identity.
export const RISKY_VERBS = [
  'curl',
  'wget',
  'npx',
  'npx wrangler',
  'python -c',
  'python3 -c',
  'node -e',
  'node -p',
  'perl -e',
  'ruby -e',
  'claude',
  'node',
  'python',
  'python3',
  'py',
  'perl',
  'ruby',
  'deno',
  'bun',
  'git',
  'gh',
  'gh api',
  'winget',
  'npm install',
  'npm i',
  'npm run',
  'npm exec',
  'pnpm',
  'yarn',
  'docker',
  'powershell',
  'pwsh',
  'pwsh -c',
  'powershell -c',
  'cmd',
  'cmd /c',
  'bash',
  'bash -c',
  'sh',
  'sh -c',
  'env',
  'xargs',
  'ssh',
  'scp',
  'nc',
  'iwr',
  'irm',
  'iex',
  'Invoke-WebRequest',
  'Invoke-RestMethod',
  'Invoke-Expression',
];
/** Returns a short label when an allow rule is open-ended exec, network or identity access. */
export function isRiskyAllowRule(rule) {
  const r = String(rule).trim();
  if (/^(Bash|PowerShell)(\(\*?\))?$/.test(r)) return r;
  const m = r.match(/^(Bash|PowerShell)\((.*)\)$/s);
  if (!m) return null;
  const body = m[2].trim();
  // a pasted-in login command is an identity rule whatever its shape
  if (/\bgh\s+auth\s+(login|token|refresh)\b/i.test(body)) return `${m[1]}(gh auth …)`;
  for (const verb of RISKY_VERBS) {
    // a verb followed by a wildcard (":*" or " *") is open-ended; a fully spelled command is not
    const open = new RegExp(`^${verb.replace(/ /g, '\\s+')}(:\\*|\\s+\\*|\\*)$`, 'i');
    if (open.test(body)) return `${m[1]}(${verb}…*)`;
  }
  return null;
}
export function riskyAllowRules(allow) {
  return (allow ?? []).map(isRiskyAllowRule).filter(Boolean);
}

const REQUIRED_DENY = [
  'Read(~/.claude/.credentials.json)',
  'Bash(gh secret set*)',
  'Bash(git push --force*)',
  'Bash(npx wrangler deploy*)',
  'Bash(npx wrangler secret put*)',
];

export function unpinnedNpxServers(servers) {
  const bad = [];
  for (const [name, s] of Object.entries(servers ?? {})) {
    const cmd = String(s?.command ?? '');
    const args = (s?.args ?? []).map(String);
    if (/(^|[\\/])npx(\.cmd)?$/i.test(cmd)) {
      const pkg = args.find((a) => !a.startsWith('-'));
      // @scope/name or name with no @version
      if (pkg && !/@\d[\w.-]*$/.test(pkg.replace(/^@/, ''))) bad.push(name);
    }
  }
  return bad;
}

function workstation() {
  const checks = [];
  const add = (id, title, status, detail) =>
    checks.push({ plane: 'workstation', id, title, status, detail });
  const home = claudeHome();
  const s = readSettings();

  // W1 hook wired for shell + file + MCP tools, and the installed copy is the one on origin/main
  const entry = (s.hooks?.PreToolUse ?? []).find((e) =>
    JSON.stringify(e).includes('policy-gate.mjs')
  );
  const wired = Boolean(entry);
  const coversMcp = String(entry?.matcher ?? '').includes('mcp__');
  const installed = existsSync(hookInstallPath());
  const main = hookFromMain();
  const reference = main ?? (existsSync(HOOK_SOURCE) ? readFileSync(HOOK_SOURCE, 'utf8') : null);
  const same =
    installed && reference != null && sha(readFileSync(hookInstallPath())) === sha(reference);
  add(
    'W1',
    'Policy gate wired for shell, file and MCP tools, installed copy equals origin/main',
    wired && coversMcp && same ? 'PASS' : 'FAIL',
    `wired=${wired} coversMcp=${coversMcp} installed=${installed} identical=${same} ` +
      `(reference: ${main ? 'origin/main' : 'working copy; run git fetch origin main'})`
  );

  // W2 no open-ended exec / network / identity allow rules
  const risky = riskyAllowRules(s.permissions?.allow);
  add(
    'W2',
    'No open-ended exec, network or identity rules in the allow list',
    risky.length === 0 ? 'PASS' : 'FAIL',
    risky.length ? [...new Set(risky)].slice(0, 8).join(', ') : 'none'
  );

  // W3 / W4
  add(
    'W3',
    'Remote Control is not started automatically',
    s.remoteControlAtStartup === true ? 'FAIL' : 'PASS',
    `remoteControlAtStartup=${s.remoteControlAtStartup ?? 'unset'}`
  );
  add(
    'W4',
    'autoApproveExecutions is off',
    s.autoApproveExecutions === true ? 'FAIL' : 'PASS',
    `autoApproveExecutions=${s.autoApproveExecutions ?? 'unset'}`
  );

  // W5 deny list carries the required entries
  const deny = new Set(s.permissions?.deny ?? []);
  const missing = REQUIRED_DENY.filter((d) => !deny.has(d));
  add(
    'W5',
    'Deny list covers deploy, secret writes, force push and credential reads',
    missing.length === 0 ? 'PASS' : 'FAIL',
    missing.length ? `missing ${missing.length}: ${missing.join(' | ')}` : 'complete'
  );

  // W6 the hook has actually blocked something in the last 7 days (the owner's born-red test)
  const auditDir = join(home, '.claude', 'audit');
  let blocks = 0;
  if (existsSync(auditDir)) {
    const cutoff = Date.now() - 8 * 864e5;
    for (const f of readdirSync(auditDir)) {
      const m = f.match(/^policy-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!m || Date.parse(m[1]) < cutoff) continue;
      for (const line of readFileSync(join(auditDir, f), 'utf8').split('\n')) {
        if (/"decision":"block"/.test(line)) blocks += 1;
      }
    }
  }
  add(
    'W6',
    'Policy gate is live: it has blocked a call within the last 7 days',
    blocks > 0 ? 'PASS' : 'FAIL',
    `${blocks} block record(s) in the audit log`
  );

  // W7 MCP servers launched through npx are version-pinned
  let servers = {};
  const cj = join(home, '.claude.json');
  if (existsSync(cj)) {
    try {
      const c = readJson(cj);
      servers = { ...(c.mcpServers ?? {}) };
      for (const p of Object.values(c.projects ?? {})) Object.assign(servers, p?.mcpServers ?? {});
    } catch {
      /* unreadable: reported below */
    }
  }
  const unpinned = unpinnedNpxServers(servers);
  add(
    'W7',
    'MCP servers started through npx are pinned to a version',
    unpinned.length === 0 ? 'PASS' : 'FAIL',
    unpinned.length ? unpinned.join(', ') : `${Object.keys(servers).length} server(s) checked`
  );

  // W8 the gh keyring identity on this machine is not an admin-scoped token
  const st = gh(['auth', 'status']);
  const scopes = (st.stdout + st.stderr).match(/Token scopes:\s*(.*)/i)?.[1] ?? '';
  // a fine-grained token has no classic scopes line; it is what agents should use
  const fineGrained = /Token:\s*github_pat_/i.test(st.stdout + st.stderr);
  const adminScopes = scopes
    .split(',')
    .map((x) => x.replace(/['\s]/g, ''))
    .filter((x) => /^(admin:|delete_repo)/.test(x));
  add(
    'W8',
    'The GitHub token available to agents has no admin scopes',
    fineGrained ? 'PASS' : !scopes ? 'FAIL' : adminScopes.length === 0 ? 'PASS' : 'FAIL',
    fineGrained
      ? 'fine-grained token (no classic scopes)'
      : !scopes
        ? 'could not read token scopes'
        : adminScopes.length
          ? adminScopes.join(', ')
          : 'no admin scopes'
  );

  // W9 informational: pre-trusted worktrees
  let trusted = 0;
  if (existsSync(cj)) {
    try {
      trusted = Object.keys(readJson(cj).projects ?? {}).filter((p) =>
        /[\\/]\.claude[\\/]worktrees[\\/]/.test(p)
      ).length;
    } catch {
      /* ignore */
    }
  }
  add(
    'W9',
    'Worktrees are not pre-trusted (a branch can bring its own hooks and MCP file)',
    trusted === 0 ? 'PASS' : 'WARN',
    `${trusted} trusted worktree path(s)`
  );
  return checks;
}

// The admin repository role: the only bypass the tag ruleset may have (GitHub role id 5).
const ADMIN_ROLE = { actor_id: 5, actor_type: 'RepositoryRole' };

function github() {
  const checks = [];
  const add = (id, title, status, detail) =>
    checks.push({ plane: 'github', id, title, status, detail });
  const unverifiable = (id, title, why) => add(id, title, 'FAIL', `cannot verify: ${why}`);

  // G1 CODEOWNERS owners resolve
  const ce = ghJson(['api', `repos/${REPO}/codeowners/errors`]);
  if (!ce.ok) unverifiable('G1', 'CODEOWNERS owners all resolve', ce.error);
  else {
    const n = (ce.data?.errors ?? []).length;
    add(
      'G1',
      'CODEOWNERS owners all resolve',
      n === 0 ? 'PASS' : 'FAIL',
      `${n} error(s) on the default branch`
    );
  }

  // G2 required reviews + code owners on main
  const bp = ghJson(['api', `repos/${REPO}/branches/main/protection`]);
  if (!bp.ok)
    unverifiable('G2', 'main requires an approving review and code-owner review', bp.error);
  else {
    const r = bp.data?.required_pull_request_reviews;
    const ok =
      (r?.required_approving_review_count ?? 0) >= 1 && r?.require_code_owner_reviews === true;
    add(
      'G2',
      'main requires an approving review and code-owner review',
      ok ? 'PASS' : 'FAIL',
      r
        ? `approvals=${r.required_approving_review_count} codeOwners=${r.require_code_owner_reviews}`
        : 'no pull request review rule'
    );
  }

  // G3 tag ruleset: active, blocks create/update/delete, bypass limited to the admin role
  const rs = ghJson(['api', `repos/${REPO}/rulesets`]);
  const g3 = 'Release tags v*.*.* are locked by an active ruleset (bypass: admin role only)';
  if (!rs.ok) unverifiable('G3', g3, rs.error);
  else {
    let found = null;
    for (const brief of rs.data ?? []) {
      if (brief.target !== 'tag' || brief.enforcement !== 'active') continue;
      const full = ghJson(['api', `repos/${REPO}/rulesets/${brief.id}`]);
      if (!full.ok) continue;
      const inc = full.data?.conditions?.ref_name?.include ?? [];
      const types = new Set((full.data?.rules ?? []).map((x) => x.type));
      const covers = inc.some((i) => /^refs\/tags\/v/.test(i) || i === '~ALL');
      const bypass = full.data?.bypass_actors ?? [];
      const onlyAdminRole = bypass.every(
        (b) => b.actor_type === ADMIN_ROLE.actor_type && b.actor_id === ADMIN_ROLE.actor_id
      );
      if (
        covers &&
        types.has('creation') &&
        types.has('update') &&
        types.has('deletion') &&
        onlyAdminRole
      )
        found = brief.name;
    }
    add('G3', g3, found ? 'PASS' : 'FAIL', found ?? 'no matching active tag ruleset');
  }

  // G4 production environment: a reviewer, and deploys limited to main and release tags
  const g4 = 'production environment requires a reviewer and limits deploy refs';
  const env = ghJson(['api', `repos/${REPO}/environments/production`]);
  if (!env.ok) unverifiable('G4', g4, env.error);
  else {
    const rules = env.data?.protection_rules ?? [];
    const reviewers = rules.some(
      (x) => x.type === 'required_reviewers' && (x.reviewers ?? []).length > 0
    );
    const policy = env.data?.deployment_branch_policy;
    let refsLimited = policy?.protected_branches === true;
    let refs = refsLimited ? 'protected branches' : 'none';
    if (policy?.custom_branch_policies === true) {
      const pol = ghJson([
        'api',
        `repos/${REPO}/environments/production/deployment-branch-policies`,
      ]);
      const names = (pol.data?.branch_policies ?? []).map((p) => `${p.type ?? 'branch'}:${p.name}`);
      refsLimited = names.length > 0 && !names.some((n) => /:\*$/.test(n));
      refs = names.join(', ') || 'none';
    }
    add(
      'G4',
      g4,
      reviewers && refsLimited ? 'PASS' : 'FAIL',
      `reviewers=${reviewers} refs=[${refs}] (a reviewer who is also the agent can approve their own deploy until G6 passes)`
    );
  }

  // G5 deploy credentials are not repository-level secrets
  const g5 = 'Deploy credentials live in environment secrets, not repository secrets';
  const sec = gh(['secret', 'list']);
  if (!sec.ok) unverifiable('G5', g5, sec.stderr.split('\n')[0]);
  else {
    const names = sec.stdout
      .split('\n')
      .map((l) => l.split('\t')[0].trim())
      .filter(Boolean);
    const deploy = names.filter((n) =>
      /^(CLOUDFLARE_|ADMIN_KEY|X_OCR_INTERNAL|CF_ACCESS_|FORMS_)/.test(n)
    );
    add(
      'G5',
      g5,
      deploy.length === 0 ? 'PASS' : 'FAIL',
      deploy.length ? `${deploy.length} repo-level: ${deploy.join(', ')}` : 'none at repo level'
    );
    // G7 the PR security reviewer has a credential (warn: the job is advisory)
    const hasKey = names.includes('CLAUDE_CODE_OAUTH_TOKEN') || names.includes('ANTHROPIC_API_KEY');
    add(
      'G7',
      'Claude PR security review has a credential (otherwise it skips with a warning)',
      hasKey ? 'PASS' : 'WARN',
      hasKey
        ? 'present'
        : 'not a repository secret (organization or environment secret not checked)'
    );
  }

  // G6 the agent identity on this machine is not a repository admin
  const me = ghJson(['api', 'user']);
  const col = ghJson(['api', `repos/${REPO}/collaborators`]);
  if (!me.ok || !col.ok)
    unverifiable('G6', 'Agent identity is not a repository admin', me.error || col.error);
  else {
    const mine = (col.data ?? []).find((c) => c.login === me.data.login);
    const admin = mine?.permissions?.admin === true;
    add(
      'G6',
      'Agent identity is not a repository admin',
      admin ? 'FAIL' : 'PASS',
      `${me.data.login} admin=${admin}`
    );
  }
  return checks;
}

export function grade(checks) {
  const fail = checks.filter((c) => c.status === 'FAIL').length;
  const warn = checks.filter((c) => c.status === 'WARN').length;
  if (fail === 0) return warn === 0 ? 'A+' : 'A';
  return fail <= 2 ? 'B' : fail <= 4 ? 'C' : fail <= 6 ? 'D' : 'F';
}

function selfTest() {
  const assert = (c, m) => {
    if (!c) {
      console.error(`self-test FAILED: ${m}`);
      process.exit(1);
    }
  };
  assert(
    riskyAllowRules([
      'Bash(curl:*)',
      'Bash(npx:*)',
      'Bash(git:*)',
      'Bash(gh api:*)',
      'Bash(node *)',
    ]).length === 5,
    'open verbs flagged'
  );
  assert(
    riskyAllowRules([
      'Bash(gh:*)',
      'Bash(npx wrangler:*)',
      'Bash(pwsh -c:*)',
      'Bash(bash -c:*)',
      'Bash(python -c:*)',
      'Bash(env:*)',
      'Bash(xargs:*)',
      'Bash(npm run:*)',
      'PowerShell(iwr:*)',
      'PowerShell(Invoke-Expression:*)',
    ]).length === 10,
    'the verbs the QA lens found open are flagged'
  );
  assert(
    riskyAllowRules(['Bash(git status*)', 'Bash(npm test *)', 'Bash(gh pr:*)', 'Read(//c/x/**)'])
      .length === 0,
    'narrow rules pass'
  );
  assert(riskyAllowRules(['Bash', 'Bash(*)']).length === 2, 'bare Bash flagged');
  assert(
    unpinnedNpxServers({
      a: { command: 'npx', args: ['@cloudflare/mcp-server-cloudflare', 'run', 'x'] },
    }).length === 1,
    'unpinned npx flagged'
  );
  assert(
    unpinnedNpxServers({
      a: { command: 'npx', args: ['-y', '@cloudflare/mcp-server-cloudflare@1.2.3'] },
    }).length === 0,
    'pinned npx passes'
  );
  assert(grade([{ status: 'PASS' }]) === 'A+' && grade([{ status: 'WARN' }]) === 'A', 'grade A/A+');
  assert(grade(Array(2).fill({ status: 'FAIL' })) === 'B', 'grade B at 2 fails');
  assert(grade(Array(3).fill({ status: 'FAIL' })) === 'C', 'grade C at 3 fails');
  assert(grade(Array(5).fill({ status: 'FAIL' })) === 'D', 'grade D');
  assert(grade(Array(7).fill({ status: 'FAIL' })) === 'F', 'grade F');
  assert(existsSync(PROPOSED), 'proposed settings file exists');
  console.log('self-test ok');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    process.exit(0);
  }
  // --only=workstation skips every GitHub call except `gh auth status` for the token scopes
  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const all = [
    ...(only === 'github' ? [] : workstation()),
    ...(only === 'workstation' ? [] : github()),
  ];
  const planes = ['workstation', 'github'].filter((p) => !only || p === only);
  // A verifier pointed at another home folder or at fixture answers is a test, not a reading.
  const overrides = [
    fixtureMode() && 'OCR_GH_FIXTURE',
    process.env.CLAUDE_HOME && 'CLAUDE_HOME',
  ].filter(Boolean);
  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          fixtureMode: fixtureMode(),
          overrides,
          checks: all.map((c) => ({ ...c, detail: redact(c.detail) })),
          grades: Object.fromEntries(
            planes.map((p) => [p, grade(all.filter((c) => c.plane === p))])
          ),
        },
        null,
        2
      )
    );
  } else {
    if (overrides.length) {
      console.log(
        `*** NOT A REAL READING: ${overrides.join(' and ')} set; this output proves nothing about this machine ***`
      );
    }
    for (const p of planes) {
      const cs = all.filter((c) => c.plane === p);
      console.log(`\n${p.toUpperCase()}  grade ${grade(cs)}`);
      for (const c of cs)
        console.log(`  ${c.status.padEnd(4)} ${c.id}  ${c.title}\n        ${redact(c.detail)}`);
    }
  }
  // an overridden run never exits 0, so a script cannot take it for a pass
  process.exit(overrides.length ? 3 : all.some((c) => c.status === 'FAIL') ? 1 : 0);
}
