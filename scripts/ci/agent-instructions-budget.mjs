#!/usr/bin/env node
// Agent instruction budget: keeps the files every agent reads on every turn small
// and well formed. Root CLAUDE.md grew from 19 KB to 89 KB in about six weeks
// before the AGENTS.md split (docs/ccr-archive/CCR-CLAUDE-USAGE-OPTIMIZATION-2026-10-11.md).
//
//   node scripts/ci/agent-instructions-budget.mjs [--root .]
//
// Exit 0 with "agent instructions ok", or 1 with one line per problem.
// Sizes are measured with LF line endings, so a CRLF checkout measures the same.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export const BUDGET = {
  'AGENTS.md': 12 * 1024,
  'CLAUDE.md': 6 * 1024,
  'workers/oursharedevents/CLAUDE.md': 8 * 1024,
  skill: 8 * 1024,
};
const MODELS = new Set(['haiku', 'sonnet', 'opus', 'inherit']);

function args(argv) {
  const i = argv.indexOf('--root');
  return { root: i >= 0 ? argv[i + 1] : process.cwd() };
}

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// Parsed as real YAML. Claude Code drops a skill or agent whose frontmatter does
// not parse, and says nothing: an unquoted ": " inside a description is enough.
// Nine role agents shipped that way in the AGENTS.md split, because an earlier
// version of this check read the lines with a regex and never parsed them.
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  try {
    const data = yaml.load(m[1]);
    return data && typeof data === 'object' ? { data } : {};
  } catch (e) {
    return { invalid: e.reason || 'parse error' };
  }
}

const notYaml = (rel, why) =>
  `${rel} frontmatter is not valid YAML (${why}), so Claude Code will not load it`;

function check(root) {
  const problems = [];
  const file = (rel) => join(root, rel);

  for (const rel of ['AGENTS.md', 'CLAUDE.md']) {
    if (!existsSync(file(rel))) problems.push(`${rel} is missing`);
  }
  for (const rel of ['AGENTS.md', 'CLAUDE.md', 'workers/oursharedevents/CLAUDE.md']) {
    if (!existsSync(file(rel))) continue;
    const size = bytes(read(file(rel)));
    if (size > BUDGET[rel]) problems.push(`${rel} is ${size} bytes; the budget is ${BUDGET[rel]}`);
  }
  if (existsSync(file('CLAUDE.md')) && !/^@AGENTS\.md\s*$/m.test(read(file('CLAUDE.md')))) {
    problems.push('CLAUDE.md does not import AGENTS.md (a line reading "@AGENTS.md")');
  }

  const copilot = file('.github/copilot-instructions.md');
  if (!existsSync(copilot)) problems.push('.github/copilot-instructions.md is missing');
  else if (!read(copilot).includes('AGENTS.md'))
    problems.push('.github/copilot-instructions.md does not point to AGENTS.md');

  const skills = file('.claude/skills');
  if (existsSync(skills)) {
    for (const d of readdirSync(skills)) {
      if (!statSync(join(skills, d)).isDirectory()) continue;
      const rel = `.claude/skills/${d}/SKILL.md`;
      if (!existsSync(file(rel))) {
        problems.push(`${rel} is missing`);
        continue;
      }
      const text = read(file(rel));
      const fm = frontmatter(text);
      if (fm.invalid) problems.push(notYaml(rel, fm.invalid));
      else if (!fm.data || fm.data.name !== d || !fm.data.description)
        problems.push(`${rel} needs frontmatter with name: ${d} and a description`);
      if (bytes(text) > BUDGET.skill)
        problems.push(`${rel} is ${bytes(text)} bytes; the budget is ${BUDGET.skill}`);
    }
  }

  const agents = file('.claude/agents');
  if (existsSync(agents)) {
    for (const f of readdirSync(agents).filter((x) => x.endsWith('.md'))) {
      const fm = frontmatter(read(join(agents, f)));
      const name = f.replace(/\.md$/, '');
      if (fm.invalid) problems.push(notYaml(`.claude/agents/${f}`, fm.invalid));
      else if (!fm.data || fm.data.name !== name || !fm.data.description)
        problems.push(`.claude/agents/${f} needs frontmatter with name: ${name} and a description`);
      else if (!MODELS.has(String(fm.data.model)))
        problems.push(`.claude/agents/${f} model must be one of ${[...MODELS].join(', ')}`);
    }
  }
  return problems;
}

const problems = check(args(process.argv.slice(2)).root);
if (problems.length) {
  process.stderr.write(problems.map((p) => `agent-instructions: ${p}`).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('agent instructions ok\n');
