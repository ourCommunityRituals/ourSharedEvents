/**
 * Workstation / GitHub hardening scripts (scripts/hardening/*).
 *
 * The verifier is the instrument the 2026-10-12 security review is graded with, so it has to
 * be able to go red: each control below starts failing on a scratch settings file or a fixture
 * of GitHub answers, and passes only in the state the apply scripts produce.
 *
 * Nothing here touches the real home folder or GitHub: settings live in a scratch folder
 * (library functions take the folder as an argument; there is no environment switch that
 * lets the CLI write elsewhere), and gh answers come from OCR_GH_FIXTURE.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { pathToFileURL } = require('url');

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'scripts', 'hardening');
const REPO = 'ourCommunityRituals/ourSharedEvents';

const run = (script, args, env = {}) =>
  spawnSync(process.execPath, [join(DIR, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: '',
  });
const scratch = (prefix) => mkdtempSync(join(tmpdir(), prefix));

function scratchHome(settings) {
  const home = scratch('ose-hardening-');
  mkdirSync(join(home, '.claude'));
  if (settings) writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings));
  return home;
}

// ---- gh fixture: the answers of a repository in the hardened state ----
const j = (v) => ({ stdout: JSON.stringify(v) });
const GOOD_GH = () => ({
  [`api repos/${REPO}/codeowners/errors`]: j({ errors: [] }),
  [`api repos/${REPO}/branches/main/protection`]: j({
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      require_code_owner_reviews: true,
    },
  }),
  [`api repos/${REPO}/rulesets`]: j([
    { id: 7, name: 'release-tags-locked', target: 'tag', enforcement: 'active' },
  ]),
  [`api repos/${REPO}/rulesets/7`]: j({
    conditions: { ref_name: { include: ['refs/tags/v*'] } },
    rules: [{ type: 'creation' }, { type: 'update' }, { type: 'deletion' }],
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole' }],
  }),
  [`api repos/${REPO}/environments/production`]: j({
    protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  }),
  [`api repos/${REPO}/environments/production/deployment-branch-policies`]: j({
    branch_policies: [
      { name: 'main', type: 'branch' },
      { name: 'v*', type: 'tag' },
    ],
  }),
  'secret list': { stdout: 'CLAUDE_CODE_OAUTH_TOKEN\t2026-10-12\n' },
  'api user': j({ login: 'agent', id: 2 }),
  [`api repos/${REPO}/collaborators`]: j([
    { login: 'agent', permissions: { admin: false, push: true } },
  ]),
  'auth status': { stdout: "Token scopes: 'repo', 'workflow'\n" },
});

function verify(home, ghMap, only) {
  const fixture = join(scratch('ose-ghfix-'), 'gh.json');
  writeFileSync(fixture, JSON.stringify(ghMap));
  const args = ['--json', ...(only ? [`--only=${only}`] : [])];
  const r = run('verify-hardening.mjs', args, { CLAUDE_HOME: home, OCR_GH_FIXTURE: fixture });
  const out = JSON.parse(r.stdout);
  return Object.fromEntries(out.checks.map((c) => [c.id, c.status]));
}

const BAD = {
  permissions: {
    allow: [
      'Bash(git:*)',
      'Bash(npx:*)',
      'Bash(curl:*)',
      'Bash(claude:*)',
      'Bash(gh api:*)',
      'Bash(npm test *)',
    ],
    deny: [],
  },
  remoteControlAtStartup: true,
  autoApproveExecutions: true,
  theme: 'dark',
};

// What the CLI installs: the hook as merged on origin/main, else the working copy.
async function hardenedHome() {
  const ws = await import(pathToFileURL(join(DIR, 'apply-workstation.mjs')).href);
  const lib = await import(pathToFileURL(join(DIR, 'lib.mjs')).href);
  const hookText = lib.hookFromMain() ?? readFileSync(lib.HOOK_SOURCE, 'utf8');
  const home = scratchHome(BAD);
  ws.applyTo(home, hookText, lib.readJson(lib.PROPOSED));
  return { home, ws, lib, hookText };
}

describe('verify-hardening: workstation plane', () => {
  it('self-test passes', () => {
    const r = run('verify-hardening.mjs', ['--self-test']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/self-test ok/);
  });

  it('fails every settings control on a permissive scratch home', () => {
    const c = verify(scratchHome(BAD), GOOD_GH(), 'workstation');
    expect([c.W1, c.W2, c.W3, c.W4, c.W5]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
  });

  it('treats a missing settings file as unprotected, not as clean', () => {
    const c = verify(scratchHome(null), GOOD_GH(), 'workstation');
    expect([c.W1, c.W5, c.W6]).toEqual(['FAIL', 'FAIL', 'FAIL']);
  });

  it('W6 needs a recorded BLOCK, not just any log file', async () => {
    const { home } = await hardenedHome();
    mkdirSync(join(home, '.claude', 'audit'));
    const day = new Date().toISOString().slice(0, 10);
    const file = join(home, '.claude', 'audit', `policy-${day}.jsonl`);
    writeFileSync(file, '{"decision":"allow"}\n{}\n');
    expect(verify(home, GOOD_GH(), 'workstation').W6).toBe('FAIL');
    writeFileSync(file, '{"decision":"allow"}\n{"decision":"block","rule":"wrangler-secret"}\n');
    expect(verify(home, GOOD_GH(), 'workstation').W6).toBe('PASS');
  });

  it('W1 fails when the installed hook differs from the reference copy', async () => {
    const { home } = await hardenedHome();
    expect(verify(home, GOOD_GH(), 'workstation').W1).toBe('PASS');
    writeFileSync(join(home, '.claude', 'hooks', 'policy-gate.mjs'), 'process.exit(0);\n');
    expect(verify(home, GOOD_GH(), 'workstation').W1).toBe('FAIL');
  });

  it('W1 fails when the hook matcher does not cover MCP tools', async () => {
    const { home } = await hardenedHome();
    const f = join(home, '.claude', 'settings.json');
    const s = JSON.parse(readFileSync(f, 'utf8'));
    s.hooks.PreToolUse[0].matcher = 'Bash|PowerShell';
    writeFileSync(f, JSON.stringify(s));
    expect(verify(home, GOOD_GH(), 'workstation').W1).toBe('FAIL');
  });

  it('W8 fails on an admin-scoped token and passes without one', async () => {
    const { home } = await hardenedHome();
    const bad = GOOD_GH();
    bad['auth status'] = { stdout: "Token scopes: 'repo', 'admin:org', 'workflow'\n" };
    expect(verify(home, bad, 'workstation').W8).toBe('FAIL');
    expect(verify(home, GOOD_GH(), 'workstation').W8).toBe('PASS');
  });
});

describe('verify-hardening: GitHub plane (fixture)', () => {
  const g = (mutate) => {
    const m = GOOD_GH();
    mutate?.(m);
    return verify(scratchHome(BAD), m, 'github');
  };

  it('passes every control in the hardened state', () => {
    const c = g();
    expect(c).toMatchObject({
      G1: 'PASS',
      G2: 'PASS',
      G3: 'PASS',
      G4: 'PASS',
      G5: 'PASS',
      G6: 'PASS',
      G7: 'PASS',
    });
  });

  it('G1 fails on a CODEOWNERS error', () => {
    expect(
      g((m) => (m[`api repos/${REPO}/codeowners/errors`] = j({ errors: [{ line: 2 }] }))).G1
    ).toBe('FAIL');
  });

  it('G2 fails without a required review, or without code-owner review', () => {
    const p = `api repos/${REPO}/branches/main/protection`;
    expect(g((m) => (m[p] = j({ required_pull_request_reviews: null }))).G2).toBe('FAIL');
    expect(
      g(
        (m) =>
          (m[p] = j({
            required_pull_request_reviews: {
              required_approving_review_count: 1,
              require_code_owner_reviews: false,
            },
          }))
      ).G2
    ).toBe('FAIL');
  });

  it('G3 fails when the ruleset is missing, disabled, or lets a user bypass it', () => {
    expect(g((m) => (m[`api repos/${REPO}/rulesets`] = j([]))).G3).toBe('FAIL');
    expect(
      g(
        (m) =>
          (m[`api repos/${REPO}/rulesets`] = j([
            { id: 7, name: 'x', target: 'tag', enforcement: 'disabled' },
          ]))
      ).G3
    ).toBe('FAIL');
    expect(
      g((m) => {
        const r = JSON.parse(m[`api repos/${REPO}/rulesets/7`].stdout);
        r.bypass_actors = [{ actor_id: 99, actor_type: 'User' }];
        m[`api repos/${REPO}/rulesets/7`] = j(r);
      }).G3
    ).toBe('FAIL');
    expect(
      g((m) => {
        const r = JSON.parse(m[`api repos/${REPO}/rulesets/7`].stdout);
        r.rules = [{ type: 'creation' }];
        m[`api repos/${REPO}/rulesets/7`] = j(r);
      }).G3
    ).toBe('FAIL');
  });

  it('G4 fails without a reviewer, or with a catch-all deploy ref', () => {
    const e = `api repos/${REPO}/environments/production`;
    expect(g((m) => (m[e] = j({ protection_rules: [], deployment_branch_policy: null }))).G4).toBe(
      'FAIL'
    );
    expect(
      g(
        (m) =>
          (m[`${e}/deployment-branch-policies`] = j({
            branch_policies: [{ name: '*', type: 'branch' }],
          }))
      ).G4
    ).toBe('FAIL');
  });

  it('G5 fails when deploy credentials are repository secrets', () => {
    expect(
      g((m) => (m['secret list'] = { stdout: 'CLOUDFLARE_API_TOKEN_OSE\t2026\nADMIN_KEY\t2026\n' }))
        .G5
    ).toBe('FAIL');
  });

  it('G6 fails when the agent identity is an admin', () => {
    expect(
      g(
        (m) =>
          (m[`api repos/${REPO}/collaborators`] = j([
            { login: 'agent', permissions: { admin: true } },
          ]))
      ).G6
    ).toBe('FAIL');
  });

  it('an answer it cannot get is a FAIL, never a pass', () => {
    const m = GOOD_GH();
    delete m[`api repos/${REPO}/branches/main/protection`];
    expect(verify(scratchHome(BAD), m, 'github').G2).toBe('FAIL');
  });
});

describe('apply-workstation', () => {
  it('plan is pure and idempotent', async () => {
    const ws = await import(pathToFileURL(join(DIR, 'apply-workstation.mjs')).href);
    const lib = await import(pathToFileURL(join(DIR, 'lib.mjs')).href);
    const proposed = lib.readJson(lib.PROPOSED);
    const first = ws.plan(BAD, proposed, 'node "C:/x/policy-gate.mjs"');
    expect(first.changes.length).toBeGreaterThan(3);
    expect(ws.plan(first.next, proposed, 'node "C:/x/policy-gate.mjs"').changes).toEqual([]);
    expect(BAD.remoteControlAtStartup).toBe(true); // the input was not mutated
  });

  it('applies to a scratch home, keeps unrelated keys, and the verifier agrees', async () => {
    const { home } = await hardenedHome();
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(s.theme).toBe('dark');
    expect(s.permissions.allow).toContain('Bash(npm test *)');
    expect(s.permissions.allow).not.toContain('Bash(curl:*)');
    expect(s.permissions.allow).not.toContain('Bash(git:*)');
    expect(s.hooks.PreToolUse[0].matcher).toContain('mcp__');
    const c = verify(home, GOOD_GH(), 'workstation');
    expect([c.W1, c.W2, c.W3, c.W4, c.W5]).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
  });

  it('widens an old hook matcher on re-apply', async () => {
    const { home, ws, lib, hookText } = await hardenedHome();
    const f = join(home, '.claude', 'settings.json');
    const s = JSON.parse(readFileSync(f, 'utf8'));
    s.hooks.PreToolUse[0].matcher = 'Bash|PowerShell';
    writeFileSync(f, JSON.stringify(s));
    const changes = ws.applyTo(home, hookText, lib.readJson(lib.PROPOSED));
    expect(changes.join(' ')).toMatch(/widen the policy-gate matcher/);
  });

  it('CLI dry run writes nothing', () => {
    const home = scratchHome(BAD);
    const before = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const r = run('apply-workstation.mjs', ['--from-worktree'], { CLAUDE_HOME: home });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Dry run/);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe(before);
    expect(existsSync(join(home, '.claude', 'hooks'))).toBe(false);
  });

  it('CLI --apply refuses without a terminal, and TEMP/CLAUDE_HOME tricks do not change that', () => {
    const home = scratchHome(BAD);
    const before = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    for (const env of [
      { CLAUDE_HOME: home },
      { CLAUDE_HOME: home, TEMP: join(home, '..'), TMPDIR: join(home, '..') },
    ]) {
      const r = run('apply-workstation.mjs', ['--apply', '--from-worktree'], env);
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(/owner in their own terminal/);
    }
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe(before);
  });
});

describe('apply-github', () => {
  it('--apply refuses before any gh call when there is no terminal', () => {
    // an empty fixture answers nothing: a gh call would exit 2, the guard must exit 3 first
    const fixture = join(scratch('ose-ghfix-'), 'gh.json');
    writeFileSync(fixture, '{}');
    const r = run('apply-github.mjs', ['--apply'], { OCR_GH_FIXTURE: fixture });
    expect(r.status).toBe(3);
  });

  it('dry run prints the plan from fixture answers and sends nothing', () => {
    const m = GOOD_GH();
    m[`api repos/${REPO}/rulesets`] = j([]);
    m[`api repos/${REPO}/environments/production`] = j({
      protection_rules: [],
      deployment_branch_policy: null,
    });
    m[`api repos/${REPO}/environments/production/deployment-branch-policies`] = j({
      branch_policies: [],
    });
    const fixture = join(scratch('ose-ghfix-'), 'gh.json');
    writeFileSync(fixture, JSON.stringify(m));
    const r = run('apply-github.mjs', [], { OCR_GH_FIXTURE: fixture });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/create tag ruleset/);
    expect(r.stdout).toMatch(/"actor_type":"RepositoryRole"/);
    expect(r.stdout).toMatch(/production may deploy from tag v\*/);
    expect(r.stdout).toMatch(/Dry run/);
  });

  it('dry run on the hardened state has nothing to do', () => {
    const fixture = join(scratch('ose-ghfix-'), 'gh.json');
    writeFileSync(fixture, JSON.stringify(GOOD_GH()));
    const r = run('apply-github.mjs', [], { OCR_GH_FIXTURE: fixture });
    expect(r.stdout).toMatch(/Nothing to do/);
  });
});
