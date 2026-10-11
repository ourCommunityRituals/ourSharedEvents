// Tests for policy-gate.mjs. Run: node --test .claude/hooks/policy-gate.test.mjs
// POLICY_GATE_HOOK points the suite at another copy (used for the mutation check).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK =
  process.env.POLICY_GATE_HOOK || join(dirname(fileURLToPath(import.meta.url)), 'policy-gate.mjs');
const AUDIT_DIR = mkdtempSync(join(tmpdir(), 'policy-gate-audit-'));

function run(call, raw) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: raw ?? JSON.stringify({ session_id: 'test', cwd: process.cwd(), ...call }),
    encoding: 'utf8',
    env: { ...process.env, OCR_POLICY_AUDIT_DIR: AUDIT_DIR },
  });
  return { code: r.status, stderr: r.stderr };
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const ps = (command) => ({ tool_name: 'PowerShell', tool_input: { command } });

const MUST_BLOCK = [
  ['wrangler-deploy', bash('npx wrangler deploy')],
  ['wrangler-deploy', bash('cd workers/oursharedevents && npx wrangler deploy --env staging')],
  ['wrangler-deploy', bash('npx wrangler versions upload')],
  ['wrangler-deploy', bash('npx wrangler rollback')],
  [
    'wrangler-production',
    bash('npx wrangler d1 execute DB --env production --remote --command "SELECT 1"'),
  ],
  ['wrangler-production', bash('npx wrangler tail --env=production')],
  ['wrangler-secret', bash('npx wrangler secret put FORMS_HASH_PEPPER --env staging')],
  ['wrangler-secret', bash('npx wrangler secret:bulk ./s.json')],
  ['wrangler-destroy', bash('npx wrangler d1 time-travel restore DB --env staging')],
  ['wrangler-destroy', bash('npx wrangler r2 bucket delete ose-assets')],
  ['wrangler-destroy', bash('npx wrangler kv key delete --binding RATE_LIMIT abc')],
  ['wrangler-destroy', bash('npx wrangler delete --name oursharedevents-prod')],
  ['d1-remote-migrate', bash('npx wrangler d1 migrations apply DB --env staging --remote')],
  [
    'd1-remote-write',
    bash(
      'npx wrangler d1 execute DB --env staging --remote --command "UPDATE events SET status=\'active\'"'
    ),
  ],
  [
    'd1-remote-write',
    bash(
      'npx wrangler d1 execute DB --env staging --remote --command "SELECT 1; DELETE FROM events"'
    ),
  ],
  ['d1-remote-write', bash('npx wrangler d1 execute DB --env staging --remote --file ./x.sql')],
  ['git-force-push', bash('git push --force origin feature')],
  ['git-force-push', bash('git push --force-with-lease')],
  ['git-force-push', bash('git push -f origin main')],
  ['git-force-push', bash('git push origin +main')],
  ['git-delete-main', bash('git push origin --delete main')],
  ['git-delete-main', bash('git push origin :main')],
  ['gh-admin-merge', bash('gh pr merge 885 --squash --admin')],
  ['gh-secret-variable', bash('gh secret set ANTHROPIC_API_KEY')],
  ['gh-secret-variable', bash('gh variable set PRODUCTION_LIVE --body true')],
  ['gh-repo-destructive', bash('gh repo edit --visibility public')],
  ['gh-repo-destructive', bash('gh workflow disable ci.yml')],
  ['gh-api-protected', bash('gh api -X PUT repos/o/r/branches/main/protection --input p.json')],
  ['gh-api-protected', bash('gh api repos/o/r/rulesets -f name=x')],
  ['gh-api-protected', bash('gh api --method DELETE orgs/o/actions/runners/7')],
  ['gh-api-protected', bash('gh api -X DELETE repos/o/r/git/refs/heads/x')],
  ['credential-file', bash('cat ~/.claude/config.json')],
  ['credential-file', ps('Get-Content "$env:USERPROFILE\\.claude\\config.json" -Raw')],
  ['credential-file', ps('gc C:\\Users\\me\\.claude\\.credentials.json')],
  ['credential-file', bash('cat workers/oursharedevents/.dev.vars')],
  ['credential-file', bash('type .env')],
  ['credential-file', bash('cp .env.local /tmp/x')],
  ['credential-file', bash('cat ~/actions-runner-2/.credentials')],
  ['credential-file', bash('ls ~/.claude && cat ~/.claude/config.json')],
  [
    'credential-file',
    { tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\me\\.claude\\config.json' } },
  ],
  ['credential-file', { tool_name: 'Edit', tool_input: { file_path: '/repo/.dev.vars' } }],
  ['credential-file', { tool_name: 'Write', tool_input: { file_path: '/repo/.env' } }],
  [
    'credential-search',
    { tool_name: 'Grep', tool_input: { pattern: 'sk-ant', path: join(homedir(), '.claude') } },
  ],
  ['credential-search', { tool_name: 'Grep', tool_input: { pattern: 'token', path: '~' } }],
];

const MUST_ALLOW = [
  bash('npx wrangler deploy --dry-run --env production'),
  bash('npx wrangler deployments list --env production'),
  bash('npx wrangler secret list --env production'),
  bash('npx wrangler whoami'),
  bash('npx wrangler dev'),
  bash('npx wrangler d1 execute DB --env staging --remote --command "SELECT COUNT(*) FROM events"'),
  bash('npx wrangler d1 execute DB --local --command "DELETE FROM events"'),
  bash('npx wrangler d1 migrations apply DB --local'),
  bash('git push origin ci/exact-wrangler-pin'),
  bash('git push -u origin feature --follow-tags'),
  bash('gh pr merge 885 --squash'),
  bash('gh pr create --title x --body y'),
  bash('gh api repos/o/r/branches/main/protection'),
  bash('gh api orgs/o/actions/runners --jq ".runners[]"'),
  bash('gh api repos/o/r/issues/1/comments -f body=hello'),
  bash('gh secret list'),
  bash('cat .env.example'),
  bash('node -e "console.log(process.env.HOME)"'),
  bash('npm test'),
  ps('Test-Path "$env:USERPROFILE\\.claude\\config.json"'),
  ps('Get-ChildItem C:\\repo -Filter *.md'),
  { tool_name: 'Read', tool_input: { file_path: 'C:\\repo\\CLAUDE.md' } },
  { tool_name: 'Read', tool_input: { file_path: 'C:\\repo\\.env.example' } },
  { tool_name: 'Grep', tool_input: { pattern: 'x', path: join(homedir(), '.claude', 'projects') } },
  { tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } },
  { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } },
];

for (const [rule, call] of MUST_BLOCK) {
  const label = call.tool_input.command ?? call.tool_input.file_path ?? call.tool_input.path;
  test(`blocks [${rule}] ${call.tool_name}: ${label}`, () => {
    const r = run(call);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}; stderr: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`\\[${rule}\\]`));
  });
}

for (const call of MUST_ALLOW) {
  const label =
    call.tool_input.command ??
    call.tool_input.file_path ??
    call.tool_input.path ??
    call.tool_input.pattern ??
    call.tool_input.url;
  test(`allows ${call.tool_name}: ${label}`, () => {
    const r = run(call);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  });
}

test('bad input fails open with a warning', () => {
  const r = run(null, 'not json');
  assert.equal(r.code, 0);
  assert.match(r.stderr, /could not read the hook input/);
});

test('shell calls are audited with secrets redacted', () => {
  // Fake values, built at runtime so secret scanners never see a key-shaped literal.
  const fakeKey = ['sk', 'ant', 'api03', 'SECRETVALUE'].join('-');
  const fakeEnv = ['ANTHROPIC', 'API', 'KEY'].join('_') + '=zzz';
  run(bash(`curl -H "Authorization: Bearer abc.def" -d k=${fakeKey} https://x ${fakeEnv}`));
  const files = readdirSync(AUDIT_DIR);
  assert.ok(files.length > 0, 'no audit file written');
  const log = files.map((f) => readFileSync(join(AUDIT_DIR, f), 'utf8')).join('');
  assert.ok(!log.includes('SECRETVALUE'), 'API key leaked into the audit log');
  assert.ok(!log.includes('abc.def'), 'Bearer token leaked into the audit log');
  assert.ok(!log.includes(fakeEnv), 'env secret leaked into the audit log');
  const last = JSON.parse(log.trim().split('\n').at(-1));
  assert.equal(last.decision, 'allow');
  assert.equal(last.tool, 'Bash');
});
