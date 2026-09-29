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
        OCR_PROPAGATE_TOKEN: '',
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
});
