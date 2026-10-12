/**
 * The policy gate's own tests run in CI.
 *
 * .claude/hooks/policy-gate.test.mjs is a node:test file. No workflow or npm script ran it,
 * so a rule could be weakened and every required check stayed green (found in the CCR of
 * the 2026-10-12 hardening). The root vitest job (`root-vitest`) does run this folder, so
 * this file runs the hook suite from inside it and fails if the suite goes red, shrinks, or
 * a rule loses its must-block cases.
 *
 * The suite is run with an explicit reporter: CI's Node 22 prints TAP when there is no
 * terminal and a developer's Node prints the spec reporter, and matching either by accident
 * is what made the first version of this file red in CI.
 */

const { spawnSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

const HOOKS = join(__dirname, '..', '..', '.claude', 'hooks');
const SUITE = join(HOOKS, 'policy-gate.test.mjs');
const HOOK = join(HOOKS, 'policy-gate.mjs');

// Every rule id the gate can return, with the least number of must-block cases it must keep.
const RULES = {
  'wrangler-deploy': 1,
  'wrangler-production': 1,
  'wrangler-secret': 1,
  'wrangler-destroy': 1,
  'd1-remote-migrate': 1,
  'd1-remote-write': 1,
  'git-force-push': 1,
  'git-delete-main': 1,
  'gh-admin-merge': 1,
  'gh-secret-variable': 1,
  'gh-repo-destructive': 1,
  'gh-api-protected': 2,
  'git-tag-push': 3,
  'git-push-dynamic': 2,
  'git-config-escape': 2,
  'git-remote-redirect': 2,
  'gh-release-create': 2,
  'gh-graphql-mutation': 1,
  'prod-dispatch': 1,
  'npm-deploy': 1,
  'gh-auth-token': 2,
  'credential-store': 2,
  'credential-file': 3,
  'credential-glob': 1,
  'credential-search': 1,
  'env-dump': 2,
  'net-upload': 4,
  'net-tool': 2,
  'bypass-permissions': 2,
  'self-config': 3,
  'owner-script': 1,
  persistence: 1,
  'mcp-cloudflare-write': 1,
  'mcp-session-control': 1,
};
const MIN_TESTS = 270;

function mustBlockCount(src, rule) {
  // an entry is `['rule', ...` or `[\n    'rule',` at the start of a line inside MUST_BLOCK
  const re = new RegExp(`^\\s*\\[\\s*'${rule}',`, 'gm');
  return (src.match(re) || []).length;
}

describe('policy gate suite is wired into CI', () => {
  let out;
  beforeAll(() => {
    out = spawnSync(process.execPath, ['--test', '--test-reporter=spec', SUITE], {
      encoding: 'utf8',
    });
  }, 180000);

  it('the hook suite passes', () => {
    expect(out.status, (out.stdout || '').slice(-1500)).toBe(0);
    expect(Number((out.stdout.match(/ℹ fail (\d+)/) || [])[1])).toBe(0);
  });

  it('the suite has not shrunk', () => {
    const n = Number((out.stdout.match(/ℹ tests (\d+)/) || [])[1]);
    expect(n).toBeGreaterThanOrEqual(MIN_TESTS);
  });

  it.each(Object.entries(RULES))('rule %s keeps at least %i must-block case(s)', (rule, min) => {
    const src = readFileSync(SUITE, 'utf8');
    expect(mustBlockCount(src, rule)).toBeGreaterThanOrEqual(min);
  });

  it('every rule the hook can return is listed here', () => {
    const hook = readFileSync(HOOK, 'utf8');
    const ids = new Set([
      ...[...hook.matchAll(/^ {4}'([a-z0-9-]+)',\s*$/gm)].map((m) => m[1]),
      ...[...hook.matchAll(/\[\s*'([a-z0-9-]+)',\s*['`]/g)].map((m) => m[1]),
      ...[...hook.matchAll(/return\s*\[\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
    ]);
    // drop strings that are not rule ids (the reasons are sentences, tool names have underscores)
    const candidates = [...ids].filter((id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id));
    const missing = candidates.filter((id) => !(id in RULES));
    expect(missing).toEqual([]);
  });
});
