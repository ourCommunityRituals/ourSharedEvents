/**
 * Agent instruction budget (scripts/ci/agent-instructions-budget.mjs).
 *
 * 1. The real tree passes: AGENTS.md <= 12 KB, CLAUDE.md <= 6 KB and imports it,
 *    the Copilot pointer exists, every skill and agent is well formed.
 * 2. Hermetic born-red cases: a minimal valid tree passes, then each injected
 *    fault turns the script red with its own message.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join, dirname } = require('path');

const ROOT = join(__dirname, '..', '..');
const BUDGET = join(ROOT, 'scripts', 'ci', 'agent-instructions-budget.mjs');

const runBudget = (root) =>
  spawnSync(process.execPath, [BUDGET, '--root', root], { encoding: 'utf-8' });

function put(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function validTree() {
  const root = mkdtempSync(join(tmpdir(), 'agent-budget-'));
  put(root, 'AGENTS.md', '# AGENTS\n');
  put(root, 'CLAUDE.md', '# CLAUDE\n\n@AGENTS.md\n');
  put(root, '.github/copilot-instructions.md', 'Follow AGENTS.md.\n');
  put(root, '.claude/skills/ccr/SKILL.md', '---\nname: ccr\ndescription: d\n---\n\nbody\n');
  put(root, '.claude/skills/notes.md', 'a flat reference file is allowed\n');
  put(
    root,
    '.claude/agents/repo-scout.md',
    '---\nname: repo-scout\ndescription: d\nmodel: haiku\n---\n\nbody\n'
  );
  return root;
}

// Every case spawns a process; give them room on a busy runner.
vi.setConfig({ testTimeout: 30_000 });

describe('agent instruction budget: the real tree', () => {
  test('passes', () => {
    const r = runBudget(ROOT);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('agent instructions ok');
  });
});

describe('agent instruction budget: born red', () => {
  test('a minimal valid tree passes', () => {
    expect(runBudget(validTree()).status).toBe(0);
  });

  const FAULTS = [
    [
      'AGENTS.md over budget',
      (r) => put(r, 'AGENTS.md', 'x'.repeat(12 * 1024 + 1)),
      /AGENTS\.md is \d+ bytes/,
    ],
    [
      'CLAUDE.md over budget',
      (r) => put(r, 'CLAUDE.md', '@AGENTS.md\n' + 'x'.repeat(6 * 1024)),
      /CLAUDE\.md is \d+ bytes/,
    ],
    [
      'CLAUDE.md without the import',
      (r) => put(r, 'CLAUDE.md', '# CLAUDE\nsee AGENTS.md\n'),
      /does not import AGENTS\.md/,
    ],
    [
      'AGENTS.md missing',
      (r) => require('fs').rmSync(join(r, 'AGENTS.md')),
      /AGENTS\.md is missing/,
    ],
    [
      'Copilot pointer missing',
      (r) => require('fs').rmSync(join(r, '.github/copilot-instructions.md')),
      /copilot-instructions\.md is missing/,
    ],
    [
      'Copilot pointer not naming AGENTS.md',
      (r) => put(r, '.github/copilot-instructions.md', 'be nice\n'),
      /does not point to AGENTS\.md/,
    ],
    [
      'skill folder without SKILL.md',
      (r) => mkdirSync(join(r, '.claude/skills/empty')),
      /empty\/SKILL\.md is missing/,
    ],
    [
      'skill name not matching its folder',
      (r) => put(r, '.claude/skills/ccr/SKILL.md', '---\nname: other\ndescription: d\n---\n'),
      /needs frontmatter with name: ccr/,
    ],
    [
      'agent with an unknown model',
      (r) =>
        put(
          r,
          '.claude/agents/repo-scout.md',
          '---\nname: repo-scout\ndescription: d\nmodel: gpt\n---\n'
        ),
      /model must be one of/,
    ],
    [
      'agent without frontmatter',
      (r) => put(r, '.claude/agents/bare.md', 'no frontmatter\n'),
      /bare\.md needs frontmatter/,
    ],
  ];

  test.each(FAULTS)('%s turns it red', (_name, inject, message) => {
    const root = validTree();
    inject(root);
    const r = runBudget(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(message);
  });

  test('CRLF line endings are measured as LF', () => {
    const root = validTree();
    put(root, 'CLAUDE.md', '@AGENTS.md\r\n' + 'x\r\n'.repeat(3000));
    expect(runBudget(root).status).toBe(0);
  });
});
