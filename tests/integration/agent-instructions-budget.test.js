/**
 * Agent instruction budget (scripts/ci/agent-instructions-budget.mjs).
 *
 * 1. The real tree passes: AGENTS.md <= 12 KB, CLAUDE.md <= 6 KB and imports it,
 *    the Copilot pointer exists, every skill and agent is well formed.
 * 2. Hermetic born-red cases: a minimal valid tree passes, then each injected
 *    fault turns the script red with its own message.
 * 3. split-claude-md.mjs (transitional, for rebasing the AGENTS.md branch):
 *    writes the generated files, notices hand-ported parts changing, and
 *    refuses a CLAUDE.md whose section set changed.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join, dirname } = require('path');

const ROOT = join(__dirname, '..', '..');
const BUDGET = join(ROOT, 'scripts', 'ci', 'agent-instructions-budget.mjs');
const SPLIT = join(ROOT, 'scripts', 'brain', 'split-claude-md.mjs');

const runBudget = (root) =>
  spawnSync(process.execPath, [BUDGET, '--root', root], { encoding: 'utf-8' });
const runSplit = (...a) => spawnSync(process.execPath, [SPLIT, ...a], { encoding: 'utf-8' });

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

describe('split-claude-md (transitional)', () => {
  const sections = (overrides = {}) =>
    ['# CLAUDE.md\n\npreamble\n\n---\n\n']
      .concat(
        ['1', '2', '3', '4', '5', '6', '7', '8'].map(
          (n) => overrides[n] ?? `## ${n}. Section ${n}\n\nbody ${n}\n\n---\n\n`
        )
      )
      .join('');

  function setup(text) {
    const root = mkdtempSync(join(tmpdir(), 'split-'));
    const from = join(root, 'monolith.md');
    writeFileSync(from, text);
    return { root, from };
  }

  test('writes the generated files and records a fingerprint', () => {
    const { root, from } = setup(sections());
    const r = runSplit('--from', from, '--root', root);
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, 'docs/brain/ROLE-STATE.md'), 'utf-8')).toContain(
      '## 3. Section 3'
    );
    expect(readFileSync(join(root, 'docs/brain/PRODUCT.md'), 'utf-8')).toMatch(
      /## 1\. Section 1[\s\S]*## 2\. Section 2/
    );
    expect(readFileSync(join(root, 'docs/brain/STORY-FORMAT.md'), 'utf-8')).toContain(
      '## 6. Section 6'
    );
    expect(readFileSync(join(root, 'docs/brain/CONSTRAINTS.md'), 'utf-8')).toContain(
      '## 4. Section 4'
    );
    expect(existsSync(join(root, 'docs/brain/.split-fingerprint.txt'))).toBe(true);
  });

  test('a change to a generated section (§3) is carried over silently', () => {
    const { root, from } = setup(sections());
    runSplit('--from', from, '--root', root);
    writeFileSync(from, sections({ 3: '## 3. Section 3\n\nnew role state\n\n---\n\n' }));
    const r = runSplit('--from', from, '--root', root);
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, 'docs/brain/ROLE-STATE.md'), 'utf-8')).toContain(
      'new role state'
    );
  });

  test('a change to a hand-ported section (§5) exits 3 until accepted', () => {
    const { root, from } = setup(sections());
    runSplit('--from', from, '--root', root);
    writeFileSync(from, sections({ 5: '## 5. Section 5\n\nnew rule\n\n---\n\n' }));
    const r = runSplit('--from', from, '--root', root);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain('§5');
    expect(runSplit('--from', from, '--root', root, '--accept').status).toBe(0);
    expect(runSplit('--from', from, '--root', root).status).toBe(0);
  });

  test('a changed section set is refused', () => {
    const { root, from } = setup(sections({ 8: '' }));
    const r = runSplit('--from', from, '--root', root);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('missing: 8');
  });
});
