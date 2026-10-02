/**
 * .github/workflows/claude-review.yml — PR_REVIEWER switch + Claude auth.
 *
 * Behavioral where it can be: the two shell steps that decide the reviewer and
 * the auth are extracted from the workflow and run with bash for every input
 * combination, and the `anthropic_api_key` expression is evaluated for every
 * secret combination. Structural for the triggers (`if:`), which only GitHub
 * evaluates.
 */

const { readFileSync, mkdtempSync, rmSync } = require('fs');
const { spawnSync } = require('child_process');
const { tmpdir } = require('os');
const { join } = require('path');
const yaml = require('js-yaml');

const WF = join(__dirname, '..', '..', '.github', 'workflows', 'claude-review.yml');
const wf = yaml.load(readFileSync(WF, 'utf-8'));
const { review, respond } = wf.jobs;

const step = (job, id) => job.steps.find((s) => s.id === id);
const actionSteps = (job) =>
  job.steps.filter((s) => String(s.uses || '').startsWith('anthropics/claude-code-action@'));

/** Run a step's `run:` script with bash and return its GITHUB_OUTPUT as an object. */
function runStep(s, env) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-review-'));
  const out = join(dir, 'out');
  try {
    const res = spawnSync('bash', ['-e', '-c', s.run], {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, ...env },
    });
    expect(res.status, res.stderr).toBe(0);
    let text = '';
    try {
      text = readFileSync(out, 'utf-8');
    } catch {
      /* step wrote nothing */
    }
    return {
      out: Object.fromEntries(
        text
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => l.split('='))
      ),
      stdout: res.stdout,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Evaluate a `${{ … }}` secrets expression with GitHub's &&/|| operand semantics (same as JS). */
function evalExpr(expr, secrets) {
  const body = expr.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const js = body
    .replace(/secrets\.([A-Z_]+)/g, (_, k) => JSON.stringify(secrets[k] || ''))
    .replace(/'/g, '"')
    .replace(/==/g, '===');
  return Function(`"use strict"; return (${js});`)();
}

describe('claude-review.yml reviewer switch', () => {
  it('review runs on pull_request only; respond is the only comment consumer', () => {
    expect(review.if).toBe("github.event_name == 'pull_request'");
    expect(respond.if).toContain("github.event_name == 'issue_comment'");
    expect(respond.if).toContain('["OWNER", "MEMBER", "COLLABORATOR"]');
  });

  const pick = step(review, 'check-key');
  const cases = [
    [
      'claude + token',
      { PR_REVIEWER: 'claude', HAS_OAUTH: 'true', HAS_API_KEY: 'false' },
      { skip: 'false' },
    ],
    [
      'claude + api key only',
      { PR_REVIEWER: 'claude', HAS_OAUTH: 'false', HAS_API_KEY: 'true' },
      { skip: 'false' },
    ],
    [
      'claude + no credential',
      { PR_REVIEWER: 'claude', HAS_OAUTH: 'false', HAS_API_KEY: 'false' },
      { skip: 'true' },
    ],
    [
      'copilot (credentials ignored)',
      { PR_REVIEWER: 'copilot', HAS_OAUTH: 'true', HAS_API_KEY: 'true' },
      { skip: 'true', copilot: 'true' },
    ],
    [
      'unknown value falls back to claude',
      { PR_REVIEWER: 'Copilot ', HAS_OAUTH: 'true', HAS_API_KEY: 'false' },
      { skip: 'false' },
    ],
  ];
  it.each(cases)('pick step: %s', (_, env, expected) => {
    const { out } = runStep(pick, env);
    expect(out).toEqual(expected);
  });

  it('unknown PR_REVIEWER warns visibly', () => {
    const { stdout } = runStep(pick, {
      PR_REVIEWER: 'gpt',
      HAS_OAUTH: 'true',
      HAS_API_KEY: 'false',
    });
    expect(stdout).toContain('::warning title=Unknown PR_REVIEWER');
  });

  it('PR_REVIEWER defaults to claude when the variable is unset', () => {
    expect(pick.env.PR_REVIEWER).toBe("${{ vars.PR_REVIEWER || 'claude' }}");
  });

  it('Copilot is requested only in copilot mode, never on synchronize', () => {
    const req = review.steps.find((s) => s.name === 'Request Copilot review');
    expect(req.if).toContain("steps.check-key.outputs.copilot == 'true'");
    expect(req.if).toContain("github.event.action != 'synchronize'");
    expect(req.run).toContain('copilot-pull-request-reviewer[bot]');
  });

  it('respond auth step: either credential is enough', () => {
    const s = step(respond, 'check-key');
    expect(runStep(s, { HAS_OAUTH: 'true', HAS_API_KEY: 'false' }).out).toEqual({ skip: 'false' });
    expect(runStep(s, { HAS_OAUTH: 'false', HAS_API_KEY: 'true' }).out).toEqual({ skip: 'false' });
    expect(runStep(s, { HAS_OAUTH: 'false', HAS_API_KEY: 'false' }).out).toEqual({ skip: 'true' });
  });

  describe.each([
    ['review', review],
    ['respond', respond],
  ])('%s action: subscription token wins over the API key', (_, job) => {
    const steps = actionSteps(job);
    it('has exactly one claude-code-action step', () => expect(steps).toHaveLength(1));
    const w = steps[0].with;
    it.each([
      ['both set', { CLAUDE_CODE_OAUTH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'key' }, ''],
      ['token only', { CLAUDE_CODE_OAUTH_TOKEN: 'tok' }, ''],
      ['api key only', { ANTHROPIC_API_KEY: 'key' }, 'key'],
      ['neither', {}, ''],
    ])('%s', (__, secrets, apiKey) => {
      expect(evalExpr(w.claude_code_oauth_token, secrets)).toBe(
        secrets.CLAUDE_CODE_OAUTH_TOKEN || ''
      );
      expect(evalExpr(w.anthropic_api_key, secrets)).toBe(apiKey);
    });
  });
});
