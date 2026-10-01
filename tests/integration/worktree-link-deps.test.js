// scripts/worktree-link-deps.mjs — plan logic + a real link round trip in a
// temp dir (no git needed: roots are passed in). Runs under root vitest with
// globals on; the script is ESM (.mjs), loaded via dynamic import so this file
// stays CommonJS-parseable (the tests/integration convention).
const { mkdtempSync, mkdirSync, writeFileSync, lstatSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const path = require('path');

let planLinks, lockfileDrift, linkDeps, DEP_DIRS;
beforeAll(async () => {
  ({ planLinks, lockfileDrift, linkDeps, DEP_DIRS } =
    await import('../../scripts/worktree-link-deps.mjs'));
});

const MAIN = path.resolve('/repo');
const WT = path.resolve('/repo/.claude/worktrees/x');

describe('planLinks', () => {
  test('links every dep dir the worktree lacks and main has', () => {
    const plan = planLinks({
      mainRoot: MAIN,
      worktreeRoot: WT,
      // Main has everything; the worktree (nested under main here) has nothing.
      fsView: { exists: (p) => p.startsWith(MAIN) && !p.startsWith(WT) },
    });
    expect(plan.map((s) => s.action)).toEqual(['link', 'link']);
    expect(plan.map((s) => s.dir)).toEqual(DEP_DIRS);
    expect(plan[0].target).toBe(path.join(MAIN, 'node_modules'));
    expect(plan[0].link).toBe(path.join(WT, 'node_modules'));
  });

  test('never overwrites something already in the worktree', () => {
    const plan = planLinks({ mainRoot: MAIN, worktreeRoot: WT, fsView: { exists: () => true } });
    expect(plan.every((s) => s.action === 'present')).toBe(true);
  });

  test('reports deps main does not have instead of linking to nothing', () => {
    const plan = planLinks({ mainRoot: MAIN, worktreeRoot: WT, fsView: { exists: () => false } });
    expect(plan.every((s) => s.action === 'missing-in-main')).toBe(true);
  });

  test('refuses to run in the main checkout', () => {
    expect(() =>
      planLinks({ mainRoot: MAIN, worktreeRoot: MAIN, fsView: { exists: () => false } })
    ).toThrow(/main checkout/);
  });
});

describe('lockfileDrift', () => {
  test('flags a lockfile that differs, ignores one missing on either side', () => {
    const files = {
      [path.join(MAIN, 'package-lock.json')]: 'a',
      [path.join(WT, 'package-lock.json')]: 'b',
      [path.join(MAIN, 'workers/oursharedevents/package-lock.json')]: 'same',
    };
    const read = (p) => files[p] ?? null;
    expect(lockfileDrift({ mainRoot: MAIN, worktreeRoot: WT, read })).toEqual([
      'package-lock.json',
    ]);
  });
});

describe('linkDeps (real filesystem)', () => {
  test('creates links that resolve to main, and is idempotent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wt-link-'));
    try {
      const main = path.join(root, 'main');
      const wt = path.join(root, 'wt');
      for (const d of DEP_DIRS) {
        mkdirSync(path.join(main, d), { recursive: true });
        writeFileSync(path.join(main, d, 'marker.txt'), d);
      }
      mkdirSync(path.join(wt, 'workers/oursharedevents'), { recursive: true });

      const logs = [];
      const plan = linkDeps({ mainRoot: main, worktreeRoot: wt, log: (l) => logs.push(l) });
      expect(plan.map((s) => s.action)).toEqual(['link', 'link']);
      for (const d of DEP_DIRS) {
        expect(lstatSync(path.join(wt, d)).isSymbolicLink()).toBe(true);
        expect(readFileSync(path.join(wt, d, 'marker.txt'), 'utf8')).toBe(d);
      }

      const again = linkDeps({ mainRoot: main, worktreeRoot: wt, log: () => {} });
      expect(again.map((s) => s.action)).toEqual(['present', 'present']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--dry-run plans without touching the disk', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wt-dry-'));
    try {
      const main = path.join(root, 'main');
      const wt = path.join(root, 'wt');
      for (const d of DEP_DIRS) mkdirSync(path.join(main, d), { recursive: true });
      mkdirSync(path.join(wt, 'workers/oursharedevents'), { recursive: true });
      linkDeps({ mainRoot: main, worktreeRoot: wt, dryRun: true, log: () => {} });
      expect(() => lstatSync(path.join(wt, 'node_modules'))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
