/* eslint-disable security/detect-non-literal-fs-filename --
   Hermetic test: it builds throwaway git repos under os.tmpdir() with paths it
   controls itself. There is no user-supplied input here, so the non-literal fs
   warnings are false positives. */
// ─────────────────────────────────────────────────────────────────────────────
// Born-red proof for the S2 post-execution injection detector (OSE-1056).
//
// Dr.-of-Security P0: the injection detector had NEVER been proven to go red.
// Worse, an empirical probe found that `security-post`'s own `actions/checkout@v7`
// runs `git checkout --force`, which ERASES tracked-file + lockfile injection
// before the `git diff` runs — so 2 of its 3 checks were vacuously green.
//
// This suite pins the contract by driving the SAME script the workflow runs
// (scripts/check-post-execution-integrity.sh) against hermetic temp git repos:
//   • clean tree                → GREEN (exit 0)      — the detector isn't always-red
//   • tracked-file mutation     → RED   (exit 1)      — backdoor in existing source
//   • injected untracked file   → RED   (exit 1)      — new file under src/
//   • lockfile tamper           → RED   (exit 1)      — supply-chain
//   • each check is INDEPENDENTLY load-bearing (mutation-proof: one injection at a time)
//   • THE TRAP: after `git checkout --force`, tracked + lockfile injection go GREEN
//     again — locking WHY the workflow must not re-checkout before the check.
// ─────────────────────────────────────────────────────────────────────────────
const { execFileSync, execSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync, appendFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../../../scripts/check-post-execution-integrity.sh');
const SRC = 'workers/oursharedevents/src';

/** Build a committed, clean repo that mirrors the paths the script guards. */
function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ose-integrity-'));
  const git = (args) => execSync(`git ${args}`, { cwd: dir, stdio: 'pipe' });
  mkdirSync(path.join(dir, SRC), { recursive: true });
  mkdirSync(path.join(dir, 'workers/oursharedevents/migrations'), { recursive: true });
  writeFileSync(path.join(dir, SRC, 'app.ts'), 'export const ok = true;\n');
  writeFileSync(path.join(dir, 'package-lock.json'), '{"name":"x","lockfileVersion":3}\n');
  writeFileSync(path.join(dir, 'workers/oursharedevents/package-lock.json'), '{"name":"w"}\n');
  git('init -q -b main');
  git('config user.email t@t.co');
  git('config user.name t');
  git('config core.autocrlf false');
  git('add -A');
  git('commit -qm base');
  return { dir, git };
}

/** Run the detector against `dir`. Returns { code } — 0 = green, non-zero = red. */
function runDetector(dir) {
  try {
    // GITHUB_STEP_SUMMARY → a throwaway file so the script's summary append is inert.
    execFileSync('bash', [SCRIPT], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, GITHUB_STEP_SUMMARY: path.join(dir, '.summary') },
    });
    return { code: 0 };
  } catch (e) {
    return { code: e.status ?? 1 };
  }
}

describe('S2 post-execution injection detector (born-red)', () => {
  let repos = [];
  const fresh = () => {
    const r = makeRepo();
    repos.push(r.dir);
    return r;
  };
  afterAll(() => {
    for (const d of repos) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  });

  test('GREEN: a clean post-execution tree passes (detector is not always-red)', () => {
    const { dir } = fresh();
    expect(runDetector(dir).code).toBe(0);
  });

  test('RED: a backdoor mutated into a tracked source file is caught', () => {
    const { dir } = fresh();
    appendFileSync(path.join(dir, SRC, 'app.ts'), '\n// exfil(process.env.SECRET)\n');
    expect(runDetector(dir).code).not.toBe(0);
  });

  test('RED: an untracked file injected under src/ is caught', () => {
    const { dir } = fresh();
    writeFileSync(path.join(dir, SRC, 'backdoor.ts'), 'export const rce = 1;\n');
    expect(runDetector(dir).code).not.toBe(0);
  });

  test('RED: a tampered lockfile (supply-chain) is caught', () => {
    const { dir } = fresh();
    writeFileSync(
      path.join(dir, 'package-lock.json'),
      '{"name":"x","lockfileVersion":3,"evil":true}\n'
    );
    expect(runDetector(dir).code).not.toBe(0);
  });

  test('fail-closed: no git workspace → non-zero (never silently green)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ose-nogit-'));
    repos.push(dir);
    expect(runDetector(dir).code).not.toBe(0);
  });

  // The trap that made 2/3 checks vacuous in the deployed workflow. This asserts
  // the failure mode EXISTS, so nobody can reintroduce a pre-check `actions/checkout`
  // without this test explaining why the detector then stops detecting.
  test('TRAP (regression lock): git checkout --force erases tracked + lockfile injection', () => {
    const { dir, git } = fresh();
    appendFileSync(path.join(dir, SRC, 'app.ts'), '\n// backdoor\n');
    writeFileSync(path.join(dir, 'package-lock.json'), '{"evil":true}\n');
    expect(runDetector(dir).code).not.toBe(0); // seen BEFORE a re-checkout

    git('checkout --progress --force HEAD'); // what actions/checkout@v7 does
    // Tracked + lockfile mutations are gone; only untracked-file detection would survive.
    expect(runDetector(dir).code).toBe(0); // ← vacuous green: proves the trap
  });
});
