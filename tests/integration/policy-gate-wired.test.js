/**
 * The policy gate's own tests run in CI.
 *
 * .claude/hooks/policy-gate.test.mjs is a node:test file. No workflow or npm script ran it,
 * so a rule could be weakened and every required check stayed green (found in the CCR of
 * the 2026-10-12 hardening). The root vitest job (`root-vitest`) does run this folder, so
 * this file runs the hook suite from inside it and fails if the suite goes red, shrinks, or
 * stops naming a rule.
 */

const { spawnSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

const HOOKS = join(__dirname, '..', '..', '.claude', 'hooks');
const SUITE = join(HOOKS, 'policy-gate.test.mjs');

// Every rule id the gate can return. Each needs at least one must-block case.
const RULES = [
  'wrangler-deploy',
  'wrangler-production',
  'wrangler-secret',
  'wrangler-destroy',
  'd1-remote-migrate',
  'd1-remote-write',
  'git-force-push',
  'git-delete-main',
  'gh-admin-merge',
  'gh-secret-variable',
  'gh-repo-destructive',
  'gh-api-protected',
  'git-tag-push',
  'gh-release-create',
  'prod-dispatch',
  'gh-auth-token',
  'credential-store',
  'git-remote-redirect',
  'net-upload',
  'bypass-permissions',
  'self-config',
  'credential-file',
  'credential-search',
];

describe('policy gate suite is wired into CI', () => {
  let out;
  beforeAll(() => {
    out = spawnSync(process.execPath, ['--test', SUITE], { encoding: 'utf8' });
  }, 120000);

  it('the hook suite passes', () => {
    expect(out.status, out.stdout.slice(-1500)).toBe(0);
    expect(out.stdout).toMatch(/ℹ fail 0/);
  });

  it('the suite has not shrunk', () => {
    const n = Number((out.stdout.match(/ℹ tests (\d+)/) || [])[1]);
    expect(n).toBeGreaterThanOrEqual(120);
  });

  it.each(RULES)('rule %s has a must-block case', (rule) => {
    const src = readFileSync(SUITE, 'utf8');
    expect(src).toContain(`['${rule}',`);
  });

  it('every rule the hook can return is listed here', () => {
    const hook = readFileSync(join(HOOKS, 'policy-gate.mjs'), 'utf8');
    const ids = new Set(
      [...hook.matchAll(/^\s{4}'([a-z0-9-]+)',\s*$/gm)]
        .map((m) => m[1])
        .concat(
          [...hook.matchAll(/\['(credential-file|credential-search|self-config)',/g)].map(
            (m) => m[1]
          )
        )
    );
    const missing = [...ids].filter((id) => !RULES.includes(id));
    expect(missing).toEqual([]);
  });
});
