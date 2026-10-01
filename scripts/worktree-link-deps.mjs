// ─────────────────────────────────────────────────────────────────────────────
// worktree-link-deps.mjs — let a git worktree run the test suites by linking
// the MAIN checkout's installed dependencies into it.
//
// Why: a fresh worktree has no node_modules, and the Worker's @ocr/ui dep is a
// `file:` link staged from the hub (scripts/ci-stage-ocr-workspace.sh), so an
// `npm ci` per worktree is slow and often fails offline. The main checkout
// already holds a working install. Linking it gives the worktree the full
// workers + node vitest pools (2026-09-30: 238 files green this way).
//
// What it does, per dependency dir (DEP_DIRS):
//   - skip if the worktree already has it (real dir or existing link);
//   - skip if the main checkout does not have it (nothing to link);
//   - otherwise link worktree/<dir> → main/<dir>
//     (a junction on Windows: no admin rights needed; a dir symlink elsewhere).
//
// Safety:
//   - refuses to run in the main checkout itself;
//   - warns when a package-lock.json differs from main's: the linked deps then
//     belong to main's lockfile, not this branch's — run `npm ci` instead if the
//     branch changes dependencies;
//   - links are gitignored (`node_modules` matches both dirs and links).
//
// Usage: node scripts/worktree-link-deps.mjs [--dry-run]
//        npm run worktree:link-deps
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEP_DIRS = ['node_modules', 'workers/oursharedevents/node_modules'];
export const LOCKFILES = ['package-lock.json', 'workers/oursharedevents/package-lock.json'];

/**
 * Pure plan: what to do for each dependency dir. `fsView` is injected so the
 * decision logic is testable without touching the disk.
 * @param {{ mainRoot: string, worktreeRoot: string,
 *           fsView: { exists: (p: string) => boolean } }} args
 * @returns {Array<{ dir: string, action: 'link'|'present'|'missing-in-main',
 *                   link: string, target: string }>}
 */
export function planLinks({ mainRoot, worktreeRoot, fsView }) {
  if (path.resolve(mainRoot) === path.resolve(worktreeRoot)) {
    throw new Error('This is the main checkout; there is nothing to link.');
  }
  return DEP_DIRS.map((dir) => {
    const link = path.join(worktreeRoot, dir);
    const target = path.join(mainRoot, dir);
    if (fsView.exists(link)) return { dir, action: 'present', link, target };
    if (!fsView.exists(target)) return { dir, action: 'missing-in-main', link, target };
    return { dir, action: 'link', link, target };
  });
}

/** Lockfiles whose content differs between main and the worktree. */
export function lockfileDrift({ mainRoot, worktreeRoot, read }) {
  return LOCKFILES.filter((f) => {
    const a = read(path.join(mainRoot, f));
    const b = read(path.join(worktreeRoot, f));
    return a !== null && b !== null && a !== b;
  });
}

/** True if p exists as anything, including a dangling link. */
function existsAny(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function readOrNull(p) {
  return existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** The main worktree is always the first entry of `git worktree list`. */
export function resolveRoots(cwd = process.cwd()) {
  const worktreeRoot = git(['rev-parse', '--show-toplevel'], cwd);
  const first = git(['worktree', 'list', '--porcelain'], cwd)
    .split(/\r?\n/)
    .find((l) => l.startsWith('worktree '));
  if (!first) throw new Error('git worktree list returned no worktrees');
  return { mainRoot: first.slice('worktree '.length), worktreeRoot };
}

export function linkDeps({ mainRoot, worktreeRoot, dryRun = false, log = console.log }) {
  const plan = planLinks({ mainRoot, worktreeRoot, fsView: { exists: existsAny } });
  for (const step of plan) {
    if (step.action === 'present') log(`= ${step.dir}: already present, left alone`);
    else if (step.action === 'missing-in-main') {
      log(`! ${step.dir}: not installed in the main checkout (${step.target}); run npm ci there`);
    } else {
      if (!dryRun) {
        symlinkSync(step.target, step.link, process.platform === 'win32' ? 'junction' : 'dir');
      }
      log(`${dryRun ? '~' : '+'} ${step.dir} → ${step.target}`);
    }
  }
  for (const f of lockfileDrift({ mainRoot, worktreeRoot, read: readOrNull })) {
    log(
      `! ${f} differs from main: linked deps follow MAIN's lockfile. Use npm ci if this branch changes deps.`
    );
  }
  return plan;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    linkDeps({ ...resolveRoots(), dryRun: process.argv.includes('--dry-run') });
  } catch (err) {
    console.error(`worktree-link-deps: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
