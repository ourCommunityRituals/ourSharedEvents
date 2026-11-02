/**
 * CCR gate (scripts/ci/ccr-gate.mjs), run against throwaway git repositories.
 *
 * A pull request that changes a governed file must carry a CCR worksheet tied to it: `pr`
 * this PR, `subject_sha` a commit on the PR, 5 loops or more, and no governed change after
 * that commit. Each rule is broken on its own and must produce its own problem; the CLI
 * warns by default and fails only in block mode.
 */

/* eslint-disable security/detect-non-literal-fs-filename -- writes a temp repo the test just created */

const { spawnSync } = require('child_process');
const { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join, dirname } = require('path');

const ROOT = join(__dirname, '..', '..');
const GATE = join(ROOT, 'scripts', 'ci', 'ccr-gate.mjs');
const CHECK = join(ROOT, 'scripts', 'ci', 'ccr-worksheet-check.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  }
  return r.stdout.trim();
}

function put(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function commit(root, files, message) {
  for (const [rel, body] of Object.entries(files)) {
    put(root, rel, body);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

const TEAM = [
  'dr-of-security',
  'role-backend-architect',
  'role-frontend-integration',
  'role-design-fe',
  'role-qa-automation',
  'role-sdet-sre',
  'role-devops',
  'role-data-scientist',
  'role-product-owner',
];
const FIVE = ['Critical', 'Conservative', 'Adversarial', 'Compliance', 'Recursive'];
const THREE = ['Critical', 'Conservative', 'Recursive'];

// A valid worksheet that stopped at 40%, with one open High finding.
function worksheet(fm = {}) {
  const order = fm.class === 'bug-fix' ? THREE : FIVE;
  const head = {
    ccr: 1,
    class: 'governance',
    requested_loops: order.length,
    loops_run: order.length,
    team: 'extended',
    gate: 'stop',
    cumulative_score: 40,
    system_score: 40,
    unresolved: '{ regulatory: 0, security_critical: 0, critical: 0, high: 1, medium: 0, low: 0 }',
    ...fm,
  };
  const loops = order.map(
    (layer, i) =>
      `## Loop ${i + 1}\n\nTeam: ${TEAM.join(', ')}\n\n${layer} layer: a lens.\n\nScore: ${50 + i}%\n`
  );
  return [
    '---',
    ...Object.entries(head)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${v}`),
    '---',
    '',
    '# CCR worksheet: test',
    '',
    ...loops,
    '## Verdict\n\nStop.\n',
    '## What was reviewed\n\nAGENTS.md.\n',
    '## Findings register\n\n| # | Severity | Status |\n|---|---|---|\n| H1 | High | open |\n',
    '## What must be true before shipping\n\nH1 closed.\n',
    '## Verification after shipping\n\nNone.\n',
    '## Risks accepted\n\nNone.\n',
    '## Solutioning\n\nClose H1.\n',
    '## Human gate\n\nDo you accept H1?\n',
  ].join('\n');
}

const made = [];

// main has AGENTS.md, the agents and an outputs folder; the PR branch starts there.
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'ccr-gate-'));
  made.push(root);
  git(root, 'init', '-q', '-b', 'main');
  const files = {
    'AGENTS.md': '# rules v1\n',
    'src.txt': 'code v1\n',
    '.claude/outputs/README.md': 'outputs\n',
  };
  for (const id of TEAM) {
    files[`.claude/agents/${id}.md`] = '---\nname: x\n---\n';
  }
  const base = commit(root, files, 'base');
  git(root, 'checkout', '-q', '-b', 'pr');
  return { root, base };
}

const tie = (pr, sha, fm = {}) => worksheet({ pr, subject_sha: `"${sha}"`, ...fm });
const WS = '.claude/outputs/CCR-RULES-2026-11-02.md';

let gate;
let isGoverned;
beforeAll(async () => {
  ({ gate, isGoverned } = await import('../../scripts/ci/ccr-gate.mjs'));
});
vi.setConfig({ testTimeout: 30_000 });
afterAll(() => {
  for (const r of made) {
    rmSync(r, { recursive: true, force: true });
  }
});

describe('ccr gate: which files are governed', () => {
  test.each([
    'AGENTS.md',
    'CLAUDE.md',
    'STORIES.md',
    '.claude/skills/ccr/SKILL.md',
    '.claude/skills/ccr-protocol.md',
    '.claude/skills/ccr-template.md',
    'scripts/ci/ccr-gate.mjs',
    'scripts/ci/ccr-worksheet-check.mjs',
    'tests/integration/ccr-gate.test.js',
    '.github/workflows/ccr-gate.yml',
  ])('%s is governed', (p) => expect(isGoverned(p)).toBe(true));

  test.each([
    'README.md',
    'docs/AGENTS.md',
    'workers/oursharedevents/CLAUDE.md',
    '.claude/skills/daily-scrum/SKILL.md',
    '.claude/outputs/CCR-X.md',
    'scripts/ci/check.mjs',
  ])('%s is not governed', (p) => expect(isGoverned(p)).toBe(false));
});

describe('ccr gate: a pull request', () => {
  test('that changes no governed file passes, and says so', () => {
    const { root, base } = repo();
    const head = commit(root, { 'src.txt': 'code v2\n' }, 'code');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems).toEqual([]);
    expect(r.notes.join('\n')).toMatch(/no governed file changed \(1 files in the PR\)/);
  });

  test('that changes AGENTS.md with no worksheet is a problem', () => {
    const { root, base } = repo();
    const head = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toMatch(
      /changes governed files \(AGENTS\.md\) and has no CCR worksheet tied to it/
    );
  });

  test('with a tied 5-loop worksheet passes, and says the owner decides below 95%', () => {
    const { root, base } = repo();
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const head = commit(root, { [WS]: tie(12, subject) }, 'ccr');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems).toEqual([]);
    expect(r.notes.join('\n')).toContain(`reviewed by ${WS} (5 loops)`);
    expect(r.notes.join('\n')).toMatch(
      /stopped at 40%: under 95%, merging is the owner's decision/
    );
  });

  test('with a worksheet for another PR is a problem, and says why', () => {
    const { root, base } = repo();
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const head = commit(root, { [WS]: tie(7, subject) }, 'ccr');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toMatch(/has no CCR worksheet tied to it/);
    expect(r.problems.join('\n')).toContain(`${WS}: pr is 7, not 12`);
  });

  test('with a worksheet that names no subject_sha is a problem', () => {
    const { root, base } = repo();
    commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const head = commit(root, { [WS]: worksheet({ pr: 12 }) }, 'ccr');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toContain(`${WS}: no subject_sha`);
  });

  test('with a subject_sha that is not on the PR is a problem', () => {
    const { root, base } = repo();
    commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const head = commit(root, { [WS]: tie(12, 'ab'.repeat(20)) }, 'ccr');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toContain('is not a commit on this PR');
  });

  test('that changes a governed file after the reviewed commit is a problem', () => {
    const { root, base } = repo();
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    commit(root, { [WS]: tie(12, subject) }, 'ccr');
    const head = commit(root, { 'AGENTS.md': '# rules v3, after the review\n' }, 'more rules');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toMatch(
      /governed files changed after the reviewed commit [0-9a-f]{12}: AGENTS\.md/
    );
  });

  test('that renames AGENTS.md away with no worksheet is a problem (a rename is a delete)', () => {
    const { root, base } = repo();
    git(root, 'mv', 'AGENTS.md', 'docs-old-rules.md');
    git(root, 'commit', '-q', '-m', 'move the rules');
    const head = git(root, 'rev-parse', 'HEAD');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toMatch(
      /changes governed files \(AGENTS\.md\) and has no CCR worksheet tied to it/
    );
  });

  test('that renames a governed file after the reviewed commit is a problem', () => {
    const { root, base } = repo();
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    commit(root, { [WS]: tie(12, subject) }, 'ccr');
    git(root, 'mv', 'AGENTS.md', 'docs-old-rules.md');
    git(root, 'commit', '-q', '-m', 'move the rules after the review');
    const head = git(root, 'rev-parse', 'HEAD');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toMatch(
      /governed files changed after the reviewed commit [0-9a-f]{12}: AGENTS\.md/
    );
  });

  test('with a subject_sha from the base history is a problem, even when the files match', () => {
    // main moved AGENTS.md from v1 to v2; the PR puts v1 back and names main's old v1 commit.
    const { root, base: oldV1 } = repo();
    git(root, 'checkout', '-q', 'main');
    const mainV2 = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'main moves on');
    git(root, 'checkout', '-q', '-b', 'restore');
    commit(root, { 'AGENTS.md': '# rules v1\n' }, 'restore v1');
    const head = commit(root, { [WS]: tie(12, oldV1) }, 'ccr naming an old commit');
    const r = gate({ root, base: mainV2, head, pr: 12 });
    expect(r.problems.join('\n')).toContain(
      `subject_sha ${oldV1.slice(0, 12)} is not a commit on this PR`
    );
  });

  test('that changes only non-governed files after the reviewed commit passes', () => {
    const { root, base } = repo();
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    commit(root, { [WS]: tie(12, subject) }, 'ccr');
    const head = commit(root, { 'src.txt': 'code v2\n' }, 'code');
    expect(gate({ root, base, head, pr: 12 }).problems).toEqual([]);
  });

  test('with a tied 3-loop worksheet is a problem: a governed change needs 5', () => {
    const { root, base } = repo();
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const head = commit(root, { [WS]: tie(12, subject, { class: 'bug-fix' }) }, 'ccr');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toContain(`${WS}: ran 3 loops; a governed change needs 5`);
  });

  test('with a worksheet that breaks the contract is a problem, governed or not', () => {
    const { root, base } = repo();
    const head = commit(
      root,
      { [WS]: worksheet({ loops_run: 4 }), 'src.txt': 'code v2\n' },
      'bad ccr'
    );
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toMatch(/loops_run is 4 but the worksheet has loop sections/);
  });

  test('a worksheet already on main that the PR changes can be the tied one', () => {
    const { root } = repo();
    commit(root, { [WS]: tie(7, git(root, 'rev-parse', 'HEAD')) }, 'old ccr on main');
    const base = git(root, 'rev-parse', 'HEAD');
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const head = commit(root, { [WS]: tie(12, subject) }, 'ccr rewritten for this PR');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems).toEqual([]);
    expect(r.notes.join('\n')).toContain(`reviewed by ${WS}`);
  });

  test('a worksheet added before the PR does not count for it', () => {
    const { root } = repo();
    const subject = git(root, 'rev-parse', 'HEAD');
    commit(root, { [WS]: tie(12, subject) }, 'old ccr on main');
    const base = git(root, 'rev-parse', 'HEAD');
    const head = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toMatch(/has no CCR worksheet tied to it/);
  });

  // git C-quotes names with non-ASCII characters unless asked for NUL-delimited output.
  test('a governed file with a non-ASCII name is still governed', () => {
    const { root, base } = repo();
    const head = commit(root, { '.claude/skills/ccr/é.md': 'new rule\n' }, 'rules');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toContain(
      'changes governed files (.claude/skills/ccr/é.md) and has no CCR worksheet tied to it'
    );
  });

  test('a worksheet with a non-ASCII name can be the tied one', () => {
    const { root, base } = repo();
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const ws = '.claude/outputs/CCR-règles-2026-11-02.md';
    const head = commit(root, { [ws]: tie(12, subject) }, 'ccr');
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems).toEqual([]);
    expect(r.notes.join('\n')).toContain(`reviewed by ${ws}`);
  });

  test('a failed comparison after the review is not proof that nothing changed', () => {
    // The reviewed commit's .claude tree is unique to it; removing that object makes only the
    // subject-to-head diff fail, while the PR's own diff still works.
    const { root, base } = repo();
    const subject = commit(
      root,
      { 'AGENTS.md': '# rules v2\n', '.claude/agents/extra.md': 'x\n' },
      'rules'
    );
    const head = commit(root, { [WS]: tie(12, subject), '.claude/agents/extra.md': 'y\n' }, 'ccr');
    const tree = git(root, 'rev-parse', `${subject}:.claude`);
    const obj = join(root, '.git', 'objects', tree.slice(0, 2), tree.slice(2));
    chmodSync(obj, 0o644);
    rmSync(obj);
    const r = gate({ root, base, head, pr: 12 });
    expect(r.problems.join('\n')).toContain(
      `${WS}: could not compare ${subject.slice(0, 12)} with the PR head`
    );
  });

  test('a diff that git cannot run is a problem, not a pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'ccr-gate-nogit-'));
    made.push(root);
    put(root, '.claude/outputs/README.md', 'outputs\n');
    const sha = 'ab'.repeat(20);
    expect(gate({ root, base: sha, head: sha, pr: 12 }).problems.join('\n')).toMatch(
      /git diff failed/
    );
  });

  test('bad arguments are a problem, not a pass', () => {
    const { root, base } = repo();
    expect(gate({ root, base: 'main', head: base, pr: 12 }).problems).toEqual([
      '--base and --head must be commit SHAs',
    ]);
    expect(gate({ root, base, head: base, pr: NaN }).problems).toEqual([
      '--pr must be the pull request number',
    ]);
  });
});

describe('ccr gate: the command line', () => {
  const cli = (root, base, head, mode, env = {}) =>
    spawnSync(
      process.execPath,
      [GATE, '--root', root, '--base', base, '--head', head, '--pr', '12', '--mode', mode],
      { encoding: 'utf-8', env: { ...process.env, GITHUB_ACTIONS: '', ...env } }
    );

  test('warn mode reports a problem and exits 0', () => {
    const { root, base } = repo();
    const head = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const r = cli(root, base, head, 'warn');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ccr-gate: 1 problem(s), mode warn');
  });

  test('an empty mode is warn (the repository variable is unset)', () => {
    const { root, base } = repo();
    const head = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    expect(cli(root, base, head, '').status).toBe(0);
  });

  test('block mode exits 1 on a problem', () => {
    const { root, base } = repo();
    const head = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const r = cli(root, base, head, 'block');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('ccr-gate: 1 problem(s), mode block');
  });

  test('block mode exits 0 when the change is tied', () => {
    const { root, base } = repo();
    const subject = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const head = commit(root, { [WS]: tie(12, subject) }, 'ccr');
    expect(cli(root, base, head, 'block').status).toBe(0);
  });

  test('on GitHub a problem is a warning in warn mode and an error in block mode', () => {
    const { root, base } = repo();
    const head = commit(root, { 'AGENTS.md': '# rules v2\n' }, 'rules');
    const env = { GITHUB_ACTIONS: 'true' };
    expect(cli(root, base, head, 'warn', env).stdout).toMatch(/^::warning::ccr-gate: this PR/m);
    expect(cli(root, base, head, 'block', env).stdout).toMatch(/^::error::ccr-gate: this PR/m);
  });
});

describe('ccr worksheet check --tracked', () => {
  test('reads only the worksheets git tracks; without it, untracked drafts are read too', () => {
    const { root } = repo();
    commit(root, { [WS]: worksheet() }, 'ccr');
    put(root, '.claude/outputs/CCR-DRAFT.md', '# draft, no frontmatter\n');
    const run = (...a) =>
      spawnSync(process.execPath, [CHECK, '--root', root, ...a], { encoding: 'utf-8' });
    const tracked = run('--tracked');
    expect(tracked.stderr).toBe('');
    expect(tracked.stdout).toContain('ccr worksheets ok (1 checked)');
    const all = run();
    expect(all.status).toBe(1);
    expect(all.stderr).toContain('.claude/outputs/CCR-DRAFT.md: no frontmatter');
  });
});
