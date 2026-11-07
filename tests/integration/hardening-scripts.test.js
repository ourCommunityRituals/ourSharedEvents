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
  [`api repos/${REPO}/environments/main-automation`]: j({
    protection_rules: [],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  }),
  [`api repos/${REPO}/environments/main-automation/deployment-branch-policies`]: j({
    branch_policies: [{ id: 11, name: 'main', type: 'branch' }],
  }),
  'secret list': { stdout: 'CLAUDE_CODE_OAUTH_TOKEN\t2026-10-12\n' },
  'api user': j({ login: 'agent', id: 2 }),
  [`api repos/${REPO}/collaborators`]: j([
    { login: 'agent', permissions: { admin: false, push: true } },
  ]),
  'auth status': { stdout: "Token scopes: 'repo', 'workflow'\n" },
});

// The verifier's checks, loaded once. verify() runs them in this process with the same two
// environment switches the CLI reads (CLAUDE_HOME, OCR_GH_FIXTURE), instead of starting a node
// process per reading: a node start costs ~0.3 s on Windows and some cases take nine readings.
// The CLI path itself is covered by 'the CLI --json reports what the checks report' below.
let verifier;
beforeAll(async () => {
  verifier = await import(pathToFileURL(join(DIR, 'verify-hardening.mjs')).href);
}, 30_000);

function verify(home, ghMap, only) {
  const fixture = join(scratch('ose-ghfix-'), 'gh.json');
  writeFileSync(fixture, JSON.stringify(ghMap));
  const saved = {
    CLAUDE_HOME: process.env.CLAUDE_HOME,
    OCR_GH_FIXTURE: process.env.OCR_GH_FIXTURE,
  };
  process.env.CLAUDE_HOME = home;
  process.env.OCR_GH_FIXTURE = fixture;
  try {
    return Object.fromEntries(verifier.runChecks(only).map((c) => [c.id, c.status]));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// The CLI reading, for the parity case: a child process with its own environment.
function verifyCli(home, ghMap, only) {
  const fixture = join(scratch('ose-ghfix-'), 'gh.json');
  writeFileSync(fixture, JSON.stringify(ghMap));
  const args = ['--json', ...(only ? [`--only=${only}`] : [])];
  const r = run('verify-hardening.mjs', args, { CLAUDE_HOME: home, OCR_GH_FIXTURE: fixture });
  const out = JSON.parse(r.stdout);
  return Object.fromEntries(out.checks.map((c) => [c.id, c.status]));
}

// Cases that start the CLI (node) more than once: a node start is ~0.3 s on Windows, more on a
// loaded machine, so these have an explicit timeout rather than the 5 s default.
const CLI_BOUND = 30_000;

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

  it(
    'the CLI --json reports what the checks report, on both planes',
    async () => {
      const { home } = await hardenedHome();
      for (const only of ['workstation', 'github']) {
        expect(verifyCli(home, GOOD_GH(), only)).toEqual(verify(home, GOOD_GH(), only));
      }
      // and on a failing state, so the comparison is not only between two passing readings
      const bad = scratchHome(BAD);
      const cli = verifyCli(bad, GOOD_GH(), 'workstation');
      expect(cli.W2).toBe('FAIL');
      expect(cli).toEqual(verify(bad, GOOD_GH(), 'workstation'));
    },
    CLI_BOUND
  );

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
      G8: 'PASS',
    });
  });

  it('G8 fails unless main-automation is usable from branch main only', () => {
    const e = `api repos/${REPO}/environments/main-automation`;
    const pol = `${e}/deployment-branch-policies`;
    const branchPolicies = (list) => (m) => (m[pol] = j({ branch_policies: list }));
    // missing environment: GitHub would auto-create it with no protection on first use
    expect(g((m) => delete m[e]).G8).toBe('FAIL');
    // all branches and tags
    expect(g((m) => (m[e] = j({ protection_rules: [], deployment_branch_policy: null }))).G8).toBe(
      'FAIL'
    );
    // any protected branch, not main alone
    expect(
      g(
        (m) =>
          (m[e] = j({
            deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
          }))
      ).G8
    ).toBe('FAIL');
    expect(
      g(
        branchPolicies([
          { name: 'main', type: 'branch' },
          { name: 'v*', type: 'tag' },
        ])
      ).G8
    ).toBe('FAIL');
    expect(g(branchPolicies([{ name: '*', type: 'branch' }])).G8).toBe('FAIL');
    expect(g(branchPolicies([])).G8).toBe('FAIL');
    expect(g((m) => delete m[pol]).G8).toBe('FAIL');
    // a reviewer is not graded (it would only stall the scheduled jobs)
    expect(
      g(
        (m) =>
          (m[e] = j({
            protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }],
            deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
          }))
      ).G8
    ).toBe('PASS');
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

describe('apply-workstation', { timeout: CLI_BOUND }, () => {
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

describe('guards found in the confirmation pass', { timeout: CLI_BOUND }, () => {
  it('applyTo refuses the real home folder unless the CLI confirmed the owner', async () => {
    const ws = await import(pathToFileURL(join(DIR, 'apply-workstation.mjs')).href);
    const lib = await import(pathToFileURL(join(DIR, 'lib.mjs')).href);
    const home = require('os').homedir();
    expect(() => ws.applyTo(home, 'process.exit(0);', lib.readJson(lib.PROPOSED))).toThrow(
      /refuses the real home/
    );
  });

  it('a verifier run with CLAUDE_HOME or a fixture says so and never exits 0', () => {
    const fixture = join(scratch('ose-ghfix-'), 'gh.json');
    writeFileSync(fixture, JSON.stringify(GOOD_GH()));
    const r = run('verify-hardening.mjs', ['--only=workstation'], {
      CLAUDE_HOME: scratchHome(BAD),
      OCR_GH_FIXTURE: fixture,
    });
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/NOT A REAL READING/);
    const j = JSON.parse(
      run('verify-hardening.mjs', ['--json', '--only=workstation'], {
        CLAUDE_HOME: scratchHome(BAD),
        OCR_GH_FIXTURE: fixture,
      }).stdout
    );
    expect(j.overrides).toEqual(['OCR_GH_FIXTURE', 'CLAUDE_HOME']);
  });

  it('W8 passes for a fine-grained token, which has no classic scopes line', async () => {
    const { home } = await hardenedHome();
    const m = GOOD_GH();
    m['auth status'] = { stdout: 'github.com\n  - Token: github_pat_************\n' };
    expect(verify(home, m, 'workstation').W8).toBe('PASS');
  });
});

// Runs apply-github against fixture answers and returns its output plus every gh call it made.
function applyGithubDryRun(ghMap, args = []) {
  const dir = scratch('ose-ghfix-');
  const fixture = join(dir, 'gh.json');
  const log = join(dir, 'calls.jsonl');
  writeFileSync(fixture, JSON.stringify(ghMap));
  const r = run('apply-github.mjs', args, { OCR_GH_FIXTURE: fixture, OCR_GH_FIXTURE_LOG: log });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  return { ...r, calls };
}
const isWrite = (args) => {
  const i = args.indexOf('--method');
  return i !== -1 && String(args[i + 1]).toUpperCase() !== 'GET';
};

describe('apply-github', { timeout: CLI_BOUND }, () => {
  it('--apply refuses before any gh call when there is no terminal', () => {
    // an empty fixture answers nothing: a gh call would exit 2, the guard must exit 3 first
    const fixture = join(scratch('ose-ghfix-'), 'gh.json');
    writeFileSync(fixture, '{}');
    const r = run('apply-github.mjs', ['--apply'], { OCR_GH_FIXTURE: fixture });
    expect(r.status).toBe(3);
    // and with a call log: not one request, read or write, was made
    const logged = applyGithubDryRun({}, ['--apply']);
    expect(logged.status).toBe(3);
    expect(logged.stderr).toMatch(/owner in their own terminal/);
    expect(logged.calls).toEqual([]);
  });

  it('pins main-automation: custom branch policy, no reviewers, exactly branch main', async () => {
    const ag = await import(pathToFileURL(join(DIR, 'apply-github.mjs')).href);
    expect(ag.MAIN_AUTOMATION).toBe('main-automation');
    const body = ag.mainAutomationEnv();
    expect(body).toEqual({
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    });
    expect(body).not.toHaveProperty('reviewers');
    expect(body).not.toHaveProperty('wait_timer');
    expect(ag.MAIN_AUTOMATION_REFS).toEqual([{ name: 'main', type: 'branch' }]);
  });

  it('dry run prints the main-automation PUT and one policy POST, and sends nothing', () => {
    const m = GOOD_GH();
    delete m[`api repos/${REPO}/environments/main-automation`]; // 404: not created yet
    delete m[`api repos/${REPO}/environments/main-automation/deployment-branch-policies`];
    const r = applyGithubDryRun(m);
    expect(r.status).toBe(0);
    const env = `repos/${REPO}/environments/main-automation`;
    expect(r.stdout).toContain(`--method PUT ${env}\n`);
    expect(r.stdout).toContain(
      '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
    );
    expect(
      r.stdout.match(/--method POST [^\n]*main-automation\/deployment-branch-policies/g)
    ).toEqual([`--method POST ${env}/deployment-branch-policies`]);
    expect(r.stdout).toContain('{"name":"main","type":"branch"}');
    expect(r.stdout).not.toContain('"reviewers"');
    expect(r.stdout).toContain(
      'Summary (requests per step): release-tag-ruleset 0, production-gate 0, main-automation 2.'
    );
    expect(r.stdout).toMatch(/Dry run/);
    expect(r.stdout).not.toMatch(/^ok {2}|succeeded/m);
    // the only gh calls were reads; it read the environment and skipped its policies (absent)
    expect(r.calls.filter(isWrite)).toEqual([]);
    expect(r.calls.map((c) => c.join(' '))).toContain(`api ${env}`);
    expect(r.calls.map((c) => c.join(' '))).not.toContain(`api ${env}/deployment-branch-policies`);
  });

  it('dry run plans to delete an extra main-automation policy, and sends nothing', () => {
    const m = GOOD_GH();
    m[`api repos/${REPO}/environments/main-automation/deployment-branch-policies`] = j({
      branch_policies: [
        { id: 11, name: 'main', type: 'branch' },
        { id: 12, name: 'v*', type: 'tag' },
      ],
    });
    const r = applyGithubDryRun(m);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      '[main-automation] DELETE environments/main-automation/deployment-branch-policies/12 (remove the extra policy tag:v*)'
    );
    expect(r.stdout).toContain(
      `--method DELETE repos/${REPO}/environments/main-automation/deployment-branch-policies/12`
    );
    expect(r.stdout).not.toMatch(/\[main-automation\] PUT /);
    expect(r.stdout).not.toMatch(/\[main-automation\] POST /);
    expect(r.calls.filter(isWrite)).toEqual([]);
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
    expect(r.stdout).toMatch(/\[release-tag-ruleset\] POST rulesets \(create release-tags-locked/);
    expect(r.stdout).toMatch(/"actor_type":"RepositoryRole"/);
    expect(r.stdout).toMatch(/\[production-gate\] POST [^\n]*\(deploy from tag v\*\)/);
    expect(r.stdout).toMatch(/Dry run/);
  });

  it('dry run on the hardened state has nothing to do', () => {
    const fixture = join(scratch('ose-ghfix-'), 'gh.json');
    writeFileSync(fixture, JSON.stringify(GOOD_GH()));
    const r = run('apply-github.mjs', [], { OCR_GH_FIXTURE: fixture });
    expect(r.stdout).toMatch(/Nothing to do/);
    expect(r.stdout).toContain(
      '[main-automation] main-automation already allows exactly branch main (skipped)'
    );
    expect(r.stdout).toContain(
      '[release-tag-ruleset] tag ruleset release-tags-locked already present (skipped)'
    );
    expect(r.stdout).toContain(
      '[production-gate] production already has a reviewer and custom refs (skipped)'
    );
  });
});

// ---- apply-github --only: steps are selected by name ----
const NAMES = ['release-tag-ruleset', 'production-gate', 'main-automation'];
// A repository with none of the three in place: rulesets empty, both environments missing (404).
const EMPTY_GH = () => ({
  'api user': j({ login: 'agent', id: 2 }),
  [`api repos/${REPO}/rulesets`]: j([]),
});
const RULESET_POST =
  `--method POST repos/${REPO}/rulesets ` +
  '{"name":"release-tags-locked","target":"tag","enforcement":"active","bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],"conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"},{"type":"non_fast_forward"}]}';
const PRODUCTION_REQUESTS = [
  `--method PUT repos/${REPO}/environments/production {"prevent_self_review":false,"reviewers":[{"type":"User","id":2}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}`,
  `--method POST repos/${REPO}/environments/production/deployment-branch-policies {"name":"main","type":"branch"}`,
  `--method POST repos/${REPO}/environments/production/deployment-branch-policies {"name":"v*","type":"tag"}`,
];
const MAIN_AUTOMATION_REQUESTS = [
  `--method PUT repos/${REPO}/environments/main-automation {"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}`,
  `--method POST repos/${REPO}/environments/main-automation/deployment-branch-policies {"name":"main","type":"branch"}`,
];
// The request set the script planned on EMPTY_GH before steps had names (origin/main fb79ea5b).
const ALL_REQUESTS = [RULESET_POST, ...PRODUCTION_REQUESTS, ...MAIN_AUTOMATION_REQUESTS];

// Each planned request as printed: "<label>\n  --method M path\n  {body}" -> "--method M path {body}".
const planned = (stdout) => {
  const lines = stdout.split('\n');
  return lines.flatMap((l, i) => {
    if (!l.startsWith('  --method ')) return [];
    const next = lines[i + 1] ?? '';
    return [next.startsWith('  {') ? `${l.trim()} ${next.trim()}` : l.trim()];
  });
};
// The label line printed above each planned request.
const labels = (stdout) => {
  const lines = stdout.split('\n');
  return lines.filter((_, i) => (lines[i + 1] ?? '').startsWith('  --method '));
};
// The step names on the SELECTED or SKIPPED lines of the step list.
const listed = (stdout, mark) =>
  stdout
    .split('\n')
    .filter((l) => l.startsWith(`  ${mark} `))
    .map((l) => l.slice(l.indexOf('[') + 1, l.indexOf(']')));
const callText = (r) => r.calls.map((c) => c.join(' '));

describe('apply-github --only', { timeout: CLI_BOUND }, () => {
  it('names the steps in one table, in run order', async () => {
    const ag = await import(pathToFileURL(join(DIR, 'apply-github.mjs')).href);
    expect(ag.STEP_NAMES).toEqual(NAMES);
  });

  it('no flag: lists all three as SELECTED and plans exactly the request set it planned before', () => {
    const r = applyGithubDryRun(EMPTY_GH());
    expect(r.status).toBe(0);
    expect(listed(r.stdout, 'SELECTED')).toEqual(NAMES);
    expect(r.stdout).not.toMatch(/SKIPPED/);
    expect(planned(r.stdout).sort()).toEqual([...ALL_REQUESTS].sort());
    expect(r.stdout).toContain(
      'Summary (requests per step): release-tag-ruleset 1, production-gate 3, main-automation 2.'
    );
    expect(r.calls.filter(isWrite)).toEqual([]);
  });

  it('--only main-automation plans its PUT and one POST and makes no call for the other two', () => {
    const r = applyGithubDryRun(EMPTY_GH(), ['--only', 'main-automation']);
    expect(r.status).toBe(0);
    expect(planned(r.stdout)).toEqual(MAIN_AUTOMATION_REQUESTS);
    // the environment is missing, so the only read is the environment itself
    expect(callText(r)).toEqual([`api repos/${REPO}/environments/main-automation`]);
    expect(listed(r.stdout, 'SKIPPED (not in --only)')).toEqual([
      'release-tag-ruleset',
      'production-gate',
    ]);
    expect(listed(r.stdout, 'SELECTED')).toEqual(['main-automation']);
    expect(r.stdout).toContain(
      'Summary (requests per step): release-tag-ruleset skipped, production-gate skipped, main-automation 2.'
    );
    // the = form, on a state where the environment exists: it reads the policies, nothing else
    const m = GOOD_GH();
    m[`api repos/${REPO}/environments/main-automation/deployment-branch-policies`] = j({
      branch_policies: [
        { id: 11, name: 'main', type: 'branch' },
        { id: 12, name: 'v*', type: 'tag' },
      ],
    });
    const r2 = applyGithubDryRun(m, ['--only=main-automation']);
    expect(r2.status).toBe(0);
    expect(planned(r2.stdout)).toEqual([
      `--method DELETE repos/${REPO}/environments/main-automation/deployment-branch-policies/12`,
    ]);
    expect(callText(r2)).toEqual([
      `api repos/${REPO}/environments/main-automation`,
      `api repos/${REPO}/environments/main-automation/deployment-branch-policies`,
    ]);
  });

  it('--only release-tag-ruleset,production-gate plans those two steps only', () => {
    for (const list of [
      'release-tag-ruleset,production-gate',
      'production-gate, release-tag-ruleset',
    ]) {
      const r = applyGithubDryRun(EMPTY_GH(), ['--only', list]);
      expect(r.status).toBe(0);
      expect(planned(r.stdout)).toEqual([RULESET_POST, ...PRODUCTION_REQUESTS]);
      expect(callText(r).filter((c) => c.includes('main-automation'))).toEqual([]);
      expect(listed(r.stdout, 'SKIPPED (not in --only)')).toEqual(['main-automation']);
      expect(r.stdout).toContain(
        'Summary (requests per step): release-tag-ruleset 1, production-gate 3, main-automation skipped.'
      );
      // the main-automation secrets note is about a step that did not run
      expect(r.stdout).not.toMatch(/environment secrets yourself/);
    }
  });

  it('an unknown, empty or repeated --only exits non-zero before any request', () => {
    for (const args of [
      ['--only', 'nonsense'],
      ['--only', 'Release-Tag-Ruleset'],
      ['--only', 'release-tag-ruleset,nonsense'],
      ['--only'],
      ['--only='],
      ['--only', ''],
      ['--only', '--apply'],
      ['--only', 'release-tag-ruleset,'],
      ['--only', 'release-tag-ruleset', '--only', 'production-gate'],
      ['--only=nonsense', '--apply'],
    ]) {
      const r = applyGithubDryRun(EMPTY_GH(), args);
      expect({ args, status: r.status }).toEqual({ args, status: 2 });
      expect(r.calls).toEqual([]);
      expect(r.stderr).toContain(`Valid step names: ${NAMES.join(', ')}`);
      expect(r.stdout).not.toMatch(/Dry run|Summary/);
    }
  });

  it('every printed label starts with its bracketed step name, never a letter', () => {
    const r = applyGithubDryRun(EMPTY_GH());
    const ls = labels(r.stdout);
    expect(ls).toHaveLength(ALL_REQUESTS.length);
    const named = ls.map((l) => /^\[([a-z-]+)\] (POST|PUT|DELETE) /.exec(l)?.[1]);
    expect(named).toEqual([
      'release-tag-ruleset',
      'production-gate',
      'production-gate',
      'production-gate',
      'main-automation',
      'main-automation',
    ]);
    expect(r.stdout).toContain(
      '[production-gate] PUT environments/production (reviewer agent, custom deploy refs)'
    );
    // every bracketed name anywhere in the output is a name --only accepts
    const anyBracket = new Set([...r.stdout.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]));
    expect([...anyBracket].sort()).toEqual([...NAMES].sort());
    expect(r.stdout).not.toMatch(/^(A|B|C|B1|B2|C1|C2|C3)\. /m);
  });

  it('the --apply confirmation names the selected steps and the request count', async () => {
    const ag = await import(pathToFileURL(join(DIR, 'apply-github.mjs')).href);
    expect(ag.applyConfirmation(['main-automation'], 2)).toBe(
      `send 2 request(s) to ${REPO} for: main-automation`
    );
    // the dry run prints the exact question --apply will ask
    const one = applyGithubDryRun(EMPTY_GH(), ['--only', 'main-automation']);
    expect(one.stdout).toContain(
      `Type APPLY to send 2 request(s) to ${REPO} for: main-automation\n`
    );
    const all = applyGithubDryRun(EMPTY_GH());
    expect(all.stdout).toContain(
      `Type APPLY to send 6 request(s) to ${REPO} for: ${NAMES.join(', ')}\n`
    );
  });

  it('--apply with --only still refuses before any request when there is no terminal', () => {
    for (const args of [
      ['--only', 'main-automation', '--apply'],
      ['--apply', '--only=release-tag-ruleset,production-gate'],
    ]) {
      const r = applyGithubDryRun(EMPTY_GH(), args);
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(/owner in their own terminal/);
      expect(r.calls).toEqual([]);
      expect(r.stdout).not.toMatch(/--method/);
    }
  });

  it('parseOnly: absent selects all; a list selects in run order; bad input is an error', async () => {
    const ag = await import(pathToFileURL(join(DIR, 'apply-github.mjs')).href);
    expect(ag.parseOnly([])).toEqual({ ok: true, selected: NAMES });
    expect(ag.parseOnly(['--apply'])).toEqual({ ok: true, selected: NAMES });
    expect(
      ag.parseOnly(['--only', 'main-automation,release-tag-ruleset,release-tag-ruleset'])
    ).toEqual({ ok: true, selected: ['release-tag-ruleset', 'main-automation'] });
    expect(ag.parseOnly(['--only', 'x']).ok).toBe(false);
    expect(ag.parseOnly(['--only']).ok).toBe(false);
    expect(ag.parseOnly(['--only=a', '--only=b']).ok).toBe(false);
  });

  it('a mistyped flag exits 2 with a hint before any request, even with --apply', () => {
    for (const args of [
      ['--onyl', 'main-automation', '--apply'],
      ['--onyl=main-automation'],
      ['--apply', '--aply'],
    ]) {
      const r = applyGithubDryRun(EMPTY_GH(), args);
      expect({ args, status: r.status }).toEqual({ args, status: 2 });
      expect(r.calls).toEqual([]);
      expect(r.stderr).toMatch(/did you mean --(only|apply)\?/);
      expect(r.stderr).toContain(`Valid step names: ${NAMES.join(', ')}`);
      expect(r.stderr).toContain('Recognised flags: --apply, --only <name>');
      expect(r.stderr).not.toMatch(/owner in their own terminal/);
    }
    expect(applyGithubDryRun(EMPTY_GH(), ['--onyl', 'main-automation']).stderr).toContain(
      'unknown flag --onyl (did you mean --only?)'
    );
  });

  it('an unknown flag or a stray word exits 2 before any request', () => {
    for (const args of [
      ['--apply', '--bogus'],
      ['--bogus'],
      ['--only', 'main-automation', '--bogus'],
      ['--only=main-automation', '--bogus', '--apply'],
      ['main-automation'],
      ['main-automation', '--apply'],
      ['--only', 'main-automation', 'production-gate'],
      ['-x'],
    ]) {
      const r = applyGithubDryRun(EMPTY_GH(), args);
      expect({ args, status: r.status }).toEqual({ args, status: 2 });
      expect(r.calls).toEqual([]);
      expect(r.stderr).toContain(`Valid step names: ${NAMES.join(', ')}`);
      expect(r.stdout).not.toMatch(/Steps:|Dry run/);
    }
    const bogus = applyGithubDryRun(EMPTY_GH(), ['--apply', '--bogus']);
    expect(bogus.stderr).toContain('unknown flag --bogus.');
    expect(bogus.stderr).not.toMatch(/did you mean/);
    expect(applyGithubDryRun(EMPTY_GH(), ['main-automation']).stderr).toContain(
      'unexpected argument "main-automation" (step names go after --only)'
    );
  });

  it('every recognised form still works', async () => {
    const ag = await import(pathToFileURL(join(DIR, 'apply-github.mjs')).href);
    for (const args of [
      [],
      ['--apply'],
      ['--only', 'main-automation'],
      ['--only=main-automation'],
      ['--only', 'release-tag-ruleset,production-gate', '--apply'],
      ['--apply', '--only=production-gate'],
      ['--only', '--apply'], // an empty --only: parseOnly reports it, not checkArgs
    ]) {
      expect({ args, r: ag.checkArgs(args) }).toEqual({ args, r: { ok: true } });
    }
    for (const args of [[], ['--only', 'main-automation'], ['--only=release-tag-ruleset']]) {
      const r = applyGithubDryRun(EMPTY_GH(), args);
      expect({ args, status: r.status }).toEqual({ args, status: 0 });
      expect(r.stdout).toMatch(/Dry run/);
    }
  });
});
