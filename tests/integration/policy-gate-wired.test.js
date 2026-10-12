/**
 * The policy gate's own tests run in CI, and can only get weaker in the open.
 *
 * .claude/hooks/policy-gate.test.mjs is a node:test file. No workflow or npm script ran it,
 * so a rule could be weakened and every required check stayed green (found in the CCR of
 * the 2026-10-12 hardening). The root vitest job (`root-vitest`) does run this folder, so
 * this file runs the hook suite from inside it and fails if the suite goes red, shrinks, or
 * a rule has fewer must-block cases than .claude/hooks/policy-gate.cases.lock.json records.
 * Lowering a number there is a line in the diff, which is the point.
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
const LOCK = JSON.parse(readFileSync(join(HOOKS, 'policy-gate.cases.lock.json'), 'utf8'));

function mustBlockCounts(src) {
  const start = src.indexOf('const MUST_BLOCK = [');
  const end = src.indexOf('const MUST_ALLOW = [');
  // comments do not count: a case wrapped in /* */ or // is not a case
  const section = src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const counts = {};
  for (const m of section.matchAll(/^\s*\[\s*['"]([a-z0-9-]+)['"],/gm)) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  return counts;
}

describe('policy gate suite is wired into CI', () => {
  let out;
  beforeAll(() => {
    out = spawnSync(process.execPath, ['--test', '--test-reporter=spec', SUITE], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }, 180000);

  it('the hook suite passes', () => {
    expect(out.status, (out.stdout || '').slice(-1500)).toBe(0);
    expect(Number((out.stdout.match(/ℹ fail (\d+)/) || [])[1])).toBe(0);
  });

  it('the suite has not shrunk below the locked count', () => {
    const n = Number((out.stdout.match(/ℹ tests (\d+)/) || [])[1]);
    expect(n).toBeGreaterThanOrEqual(LOCK.tests);
  });

  it.each(Object.entries(LOCK.mustBlock))(
    'rule %s keeps at least %i must-block case(s)',
    (rule, locked) => {
      const now = mustBlockCounts(readFileSync(SUITE, 'utf8'));
      expect(now[rule] ?? 0).toBeGreaterThanOrEqual(locked);
    }
  );

  it('every rule the hook can return has locked must-block cases', () => {
    const hook = readFileSync(HOOK, 'utf8');
    const ids = new Set([
      // rule tuples: the id on a line of its own at four spaces
      ...[...hook.matchAll(/^ {4}'([a-z0-9-]+)',\s*$/gm)].map((m) => m[1]),
      // verdicts returned inline: return ['id', ...] or ? ['id', ...]
      ...[...hook.matchAll(/(?:return|\?)\s*\[\s*'([a-z0-9-]+)'\s*,/g)].map((m) => m[1]),
    ]);
    // the verdict ids are kebab-case words; drop anything else the patterns can pick up
    const candidates = [...ids].filter((id) => /^[a-z]+(-[a-z0-9]+)*$/.test(id));
    const missing = candidates.filter((id) => !(id in LOCK.mustBlock));
    expect(missing).toEqual([]);
  });
});
