/**
 * Hub pin must be a MERGED hub commit (OSE-1394, CCR OSE-1393 H1).
 *
 * `git fetch <sha>` serves commits that exist only on unmerged hub branches
 * or refs/pull/*, so a well-formed 40-hex pin proves nothing about review.
 * It happened: a39acc6 pinned 14f3ed71, a hub PR-branch commit never on main.
 *
 * Behavioral, hermetic: builds a throwaway local "hub" repo (main + an
 * unmerged side branch), points scripts/ci-stage-ocr-workspace.sh at it via
 * OCR_WORKSPACE_REPO=file://..., and asserts a main commit stages while a
 * side-branch commit fails with the ::error:: annotation. No network.
 */

const { execFileSync, spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'ci-stage-ocr-workspace.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
}

function commitFile(repo, rel, body, msg) {
  mkdirSync(join(repo, rel, '..'), { recursive: true });
  writeFileSync(join(repo, rel), body);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', msg);
  return git(repo, 'rev-parse', 'HEAD');
}

describe('ci-stage-ocr-workspace.sh — pin must be on hub main (OSE-1394)', () => {
  let root;
  let hub;
  let mainSha;
  let sideSha;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'hub-pin-'));
    hub = join(root, 'hub');
    mkdirSync(hub);
    git(hub, 'init', '-q', '-b', 'main');
    git(hub, 'config', 'uploadpack.allowFilter', 'true');
    git(hub, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    mainSha = commitFile(hub, 'packages/ui/package.json', '{"name":"@ocr/ui"}\n', 'main');
    git(hub, 'checkout', '-q', '-b', 'unmerged');
    sideSha = commitFile(hub, 'packages/ui/extra.txt', 'side\n', 'unmerged side commit');
    git(hub, 'checkout', '-q', 'main');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function stage(pin, name) {
    const ws = join(root, name, 'ws');
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, '.ocr-hub-ref'), `${pin}\n`);
    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_WORKSPACE: ws,
        OCR_WORKSPACE_REPO: `file://${hub}`,
        OCR_HUB_READ: '',
      },
    });
    return { ...r, ws };
  }

  test('a commit on hub main stages @ocr/ui', () => {
    const r = stage(mainSha, 'good');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('pin is on hub main');
    expect(existsSync(join(r.ws, '..', 'packages', 'ui', 'package.json'))).toBe(true);
  });

  test('negative control: an unmerged side-branch commit is refused', () => {
    const r = stage(sideSha, 'bad');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('::error title=@ocr/ui staging failed (ADR-008 pin)::');
    expect(r.stdout).toContain('is not reachable from hub main');
    expect(existsSync(join(r.ws, '..', 'packages', 'ui'))).toBe(false);
  });

  // The one deliberate CI/local difference in the script: when the pinned commit is
  // fetched but hub main cannot be (here: a branch that does not exist), CI fails and a
  // local run only warns, so a developer offline from the hub can still work.
  test('DELIBERATE CI/local difference: unverifiable ancestry fails in CI, warns locally', () => {
    const go = (ci, name) => {
      const ws = join(root, name, 'ws');
      mkdirSync(ws, { recursive: true });
      writeFileSync(join(ws, '.ocr-hub-ref'), `${mainSha}\n`);
      const env = { ...process.env, GITHUB_WORKSPACE: ws, OCR_WORKSPACE_REPO: `file://${hub}` };
      delete env.GITHUB_ACTIONS;
      delete env.OCR_HUB_READ;
      env.OCR_HUB_MAIN_BRANCH = 'no-such-branch';
      if (ci) env.GITHUB_ACTIONS = 'true';
      return spawnSync('bash', [SCRIPT], { encoding: 'utf-8', env });
    };
    const ci = go(true, 'anc-ci');
    expect(ci.status, ci.stdout + ci.stderr).toBe(1);
    expect(ci.stdout).toContain('could not fetch hub no-such-branch');
    const local = go(false, 'anc-local');
    expect(local.status, local.stdout + local.stderr).toBe(0);
    expect(local.stdout).toContain('::warning title=pin ancestry unverified::');
  }, 30_000); // two real bash + git runs: generous so a loaded runner never times out
});

/**
 * Script contract on MAIN, across execution contexts (CI on PR / push, production deploy
 * and smoke, Dependabot, a developer locally). The script reads the env var OCR_HUB_READ;
 * workflow steps fill it from `secrets.OCR_HUB_READ` alone (OSE-1695). There is
 * deliberately NO fallback to the old variable OCR_PROPAGATE_TOKEN (the write-capable PAT):
 * with only that set, the script behaves exactly as with no token. With no token the fetch
 * from the private hub fails and the ::error:: names OCR_HUB_READ; with a bad token it says
 * the token is present and never prints it. Identical with and without GITHUB_ACTIONS (the
 * only CI/local difference is the ancestry check above).
 * Hermetic: the source remote is a file:// path that does not exist; no network.
 */
describe('ci-stage-ocr-workspace.sh: token contract in every context (OSE-1695)', () => {
  const PIN = '0'.repeat(40); // well-formed 40-hex pin, fetchable from nowhere (obviously fake)
  const PLACEHOLDER = 'placeholder-not-a-real-credential';
  const OLD_PLACEHOLDER = 'placeholder-old-name-not-a-real-credential';
  let tmp;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'hub-token-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function go(name, { ci, token, oldToken }) {
    const ws = join(tmp, name, 'ws'); // fresh parent each time: no cache to fall back on
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, '.ocr-hub-ref'), `${PIN}\n`);
    const env = {
      ...process.env,
      GITHUB_WORKSPACE: ws,
      OCR_WORKSPACE_REPO: `file://${join(tmp, 'no-such-hub')}`,
      GIT_TERMINAL_PROMPT: '0',
    };
    delete env.GITHUB_ACTIONS;
    delete env.OCR_PROPAGATE_TOKEN;
    delete env.OCR_HUB_READ;
    if (ci) env.GITHUB_ACTIONS = 'true';
    if (token) env.OCR_HUB_READ = PLACEHOLDER;
    if (oldToken) env.OCR_PROPAGATE_TOKEN = OLD_PLACEHOLDER;
    const r = spawnSync('bash', [SCRIPT], { encoding: 'utf-8', env });
    return { ...r, out: r.stdout + r.stderr };
  }
  const b64 = (v) => Buffer.from(`x-access-token:${v}`).toString('base64');

  for (const ci of [true, false]) {
    const where = ci ? 'CI (GITHUB_ACTIONS=true)' : 'local (GITHUB_ACTIONS unset)';

    test(`${where}: no token -> exit 1, ::error:: names OCR_HUB_READ`, () => {
      const r = go(`none-${ci}`, { ci });
      expect(r.status, r.out).toBe(1);
      expect(r.stdout).toContain('::error title=@ocr/ui staging failed (ADR-008 pin)::');
      expect(r.stdout).toContain('OCR_HUB_READ is not available in this run context');
    }, 20_000);

    test(`${where}: ONLY the old OCR_PROPAGATE_TOKEN set -> still "not available" (no fallback)`, () => {
      const r = go(`old-only-${ci}`, { ci, oldToken: true });
      expect(r.status, r.out).toBe(1);
      expect(r.stdout).toContain('::error title=@ocr/ui staging failed (ADR-008 pin)::');
      expect(r.stdout).toContain('OCR_HUB_READ is not available in this run context');
      expect(r.stdout).not.toContain('is present but the fetch still failed');
      expect(r.out).not.toContain(OLD_PLACEHOLDER);
      expect(r.out).not.toContain(b64(OLD_PLACEHOLDER));
    }, 20_000);

    test(`${where}: a bad token -> "present but the fetch still failed", never printed`, () => {
      const r = go(`bad-${ci}`, { ci, token: true });
      expect(r.status, r.out).toBe(1);
      expect(r.stdout).toContain('::error title=@ocr/ui staging failed (ADR-008 pin)::');
      expect(r.stdout).toContain('OCR_HUB_READ is present but the fetch still failed');
      expect(r.out).not.toContain(PLACEHOLDER);
      expect(r.out).not.toContain(b64(PLACEHOLDER));
    }, 20_000);
  }
});
