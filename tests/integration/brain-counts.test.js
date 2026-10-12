/**
 * scripts/brain/counts.mjs prints today's counts for the things docs keep
 * quoting, each with how it is counted (OSE-1672). Nothing is stored, so there
 * is no committed number to go stale and no file for two pull requests to
 * conflict on.
 *
 * 1. A throwaway tree with a known number of each thing gives exactly those
 *    numbers, and ignores node_modules, archive and worktrees.
 * 2. The real tree runs and reports every count.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join, dirname } = require('path');

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'brain', 'counts.mjs');

// Every case spawns a process; give them room on a busy runner.
vi.setConfig({ testTimeout: 30_000 });

const run = (root, ...flags) =>
  spawnSync(process.execPath, [SCRIPT, '--root', root, ...flags], { encoding: 'utf-8' });

function put(root, rel, body = 'x\n') {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'brain-counts-'));
  const w = 'workers/oursharedevents';
  // 2 architecture gates (a non-spec file beside them is not one)
  put(root, 'tests/e2e/0-architecture/a.invariant.spec.ts');
  put(root, 'tests/e2e/0-architecture/b.invariant.spec.ts');
  put(root, 'tests/e2e/0-architecture/README.md');
  // root tests: the 2 gates above + 3 here = 5; archive and node_modules are ignored
  put(root, 'tests/unit/one.test.js');
  put(root, 'tests/integration/two.test.js');
  put(root, 'tests/playwright/three.spec.ts');
  put(root, 'tests/archive/old.test.js');
  put(root, 'tests/unit/node_modules/dep/x.test.js');
  put(root, 'tests/unit/helper.js');
  // 3 worker specs, one nested; a worktree copy is ignored
  put(root, `${w}/tests/a.spec.ts`);
  put(root, `${w}/tests/b.spec.ts`);
  put(root, `${w}/tests/nested/c.spec.ts`);
  put(root, `${w}/tests/worktrees/copy/d.spec.ts`);
  put(root, `${w}/tests/fixtures/data.ts`);
  // 2 templates
  put(root, `${w}/src/templates/admin.html`);
  put(root, `${w}/src/templates/public.html`);
  put(root, `${w}/src/templates/notes.txt`);
  // 4 test ids
  put(root, 'web/shared/testids.js', "module.exports = { ALL_TESTIDS: ['a', 'b', 'c', 'd'] };\n");
  // 3 main migrations (guard says 3), 2 forms migrations (guard says 1: a mismatch)
  for (const n of ['0001', '0002', '0003']) put(root, `${w}/migrations/${n}_x.sql`);
  for (const n of ['0001', '0002']) put(root, `${w}/migrations-forms/${n}_x.sql`);
  put(
    root,
    `${w}/src/lib/schema-guard.ts`,
    'export const REQUIRED_DB_MIGRATION = 3;\nexport const REQUIRED_FORMS_MIGRATION = 1;\n'
  );
  // router: 2 routes in the header, 3 method checks in the code
  put(
    root,
    `${w}/src/router.ts`,
    [
      '/**',
      ' * GET /health',
      ' * POST /api/v2/events',
      ' */',
      "if (method === 'GET' && pathname === '/health') {}",
      "if (method === 'POST' && pathname === '/api/v2/events') {}",
      "if (method === 'PUT' && m) {}",
      '// GET /not-in-header-comment',
      '',
    ].join('\n')
  );
  // 2 workflows; the main pipeline has 3 jobs
  put(root, '.github/workflows/oursharedevents-ci.yml', 'jobs:\n  a: {}\n  b: {}\n  c: {}\n');
  put(root, '.github/workflows/other.yml', 'jobs:\n  z: {}\n');
  put(root, '.github/workflows/README.md');
  // 1 skill that loads (a flat file is not one), 2 agents
  put(root, '.claude/skills/ccr/SKILL.md');
  put(root, '.claude/skills/notes.md');
  put(root, '.claude/agents/one.md');
  put(root, '.claude/agents/two.md');
  put(root, 'AGENTS.md', 'abcde\r\n'); // 6 bytes with LF endings
  return root;
}

describe('brain counts: a tree with known contents', () => {
  const r = run(tree(), '--json');
  const c = r.status === 0 ? JSON.parse(r.stdout) : {};

  test('runs', () => {
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test.each([
    ['archGates', 2],
    ['rootTests', 5],
    ['workerSpecs', 3],
    ['templates', 2],
    ['testids', 4],
    ['migrationsMain', 3],
    ['migrationsForms', 2],
    ['routesInHeader', 2],
    ['routeChecksInCode', 3],
    ['workflows', 2],
    ['pipelineJobs', 3],
    ['skills', 1],
    ['agents', 2],
    ['AGENTS.md', 6],
    ['CLAUDE.md', null],
  ])('%s is %s', (key, value) => {
    expect(c[key]).toBe(value);
  });

  test('the table says how each thing is counted and flags a guard that does not match', () => {
    const out = run(tree()).stdout;
    expect(out).toMatch(/\| What \| Count \| How it is counted \|/);
    expect(out).toMatch(/Main DB migrations \| 3 \|.*REQUIRED_DB_MIGRATION` is 3 \(matches\)/);
    expect(out).toMatch(
      /Forms DB migrations \| 2 \|.*REQUIRED_FORMS_MIGRATION` is 1 \(DOES NOT MATCH\)/
    );
    expect(out).toMatch(/CLAUDE\.md size in bytes \| not found \|/);
    expect(out).toMatch(/^Counts on \d{4}-\d{2}-\d{2} /);
  });
});

describe('brain counts: the real tree', () => {
  test('reports every count as a number', () => {
    const r = run(ROOT, '--json');
    expect(r.status).toBe(0);
    const c = JSON.parse(r.stdout);
    for (const [key, value] of Object.entries(c)) {
      expect(typeof value, key).toBe('number');
      expect(value, key).toBeGreaterThan(0);
    }
  });
});
