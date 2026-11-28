/**
 * Review check scorer (scripts/ci/review-canary-check.mjs) and its workflow.
 *
 * Born red: every way the reviewer can fail is a case that must fail, next to
 * the one answer that passes. The answers are checked against the real
 * fixtures, and the workflow's scoring step is run with bash on a failing
 * answer, so a step that swallows the exit code goes red here.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fixture and temp paths built by this test */
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('fs');
const { spawnSync } = require('child_process');
const { tmpdir } = require('os');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const WF = join(ROOT, '.github', 'workflows', 'review-canary.yml');

let m;
beforeAll(async () => {
  m = await import('../../../scripts/ci/review-canary-check.mjs');
});

const result = (text) => [
  { type: 'system' },
  { type: 'result', result: text, total_cost_usd: 0.12, num_turns: 4, duration_ms: 31000 },
];
const lineOf = (file) => m.loadCases().find((c) => c.file === file).line;
const allCaught = () =>
  m
    .loadCases()
    .filter((c) => c.marker)
    .map((c) => `CANARY: tests/fixtures/review-canary/${c.file}:${c.line}`)
    .join('\n');

describe('fixtures and answers agree', () => {
  it('every case file exists and every marker is on exactly one line', () => {
    for (const c of m.CASES) {
      const text = readFileSync(join(m.FIXTURE_DIR, c.file), 'utf8');
      if (!c.marker) continue;
      const hits = text.split('\n').filter((l) => l.includes(c.marker));
      expect(hits, `${c.file}: ${c.marker}`).toHaveLength(1);
    }
  });
  it('has three to five cases, with at least one bug and one correct file', () => {
    expect(m.CASES.length).toBeGreaterThanOrEqual(3);
    expect(m.CASES.length).toBeLessThanOrEqual(5);
    expect(m.CASES.some((c) => c.marker)).toBe(true);
    expect(m.CASES.some((c) => !c.marker)).toBe(true);
  });
  it('the fixtures give no answer away (no case says which is which)', () => {
    for (const c of m.CASES) {
      const text = readFileSync(join(m.FIXTURE_DIR, c.file), 'utf8').toLowerCase();
      for (const word of ['planted', 'bug', 'flaw', 'vulnerab', 'clean', 'safe', 'correct']) {
        expect(text.includes(word), `${c.file} contains "${word}"`).toBe(false);
      }
    }
  });
  it('the workflow prompt lists exactly the case files', () => {
    const prompt = yaml
      .load(readFileSync(WF, 'utf8'))
      .jobs.check.steps.find((s) => s.id === 'reviewer').with.prompt;
    const listed = [...prompt.matchAll(/review-canary\/(case-[a-z]\.ts\.txt)/g)]
      .map((x) => x[1])
      .sort();
    expect(listed).toEqual(m.CASES.map((c) => c.file).sort());
  });
});

describe('scoring', () => {
  it('passes when every bug is named and no correct file is', () => {
    const v = m.judge(result(`Findings.\n${allCaught()}`));
    expect(v.pass).toBe(true);
    expect(v.caught).toHaveLength(v.planted);
  });
  it('accepts a line within the slack and the answer from the last assistant message', () => {
    const text = m
      .loadCases()
      .filter((c) => c.marker)
      .map((c) => `CANARY: ${c.file}:${c.line + m.LINE_SLACK}`)
      .join('\n');
    const msgs = [{ type: 'assistant', message: { content: [{ type: 'text', text }] } }];
    expect(m.judge(msgs).pass).toBe(true);
  });
  it('fails when the reviewer did not run (no file, empty array, empty answer)', () => {
    expect(m.judge(null).pass).toBe(false);
    expect(m.judge([]).pass).toBe(false);
    expect(m.judge(result('')).pass).toBe(false);
  });
  it('fails on CANARY: NONE and on an answer with no CANARY line', () => {
    expect(m.judge(result('Looks fine.\nCANARY: NONE')).pass).toBe(false);
    expect(m.judge(result('case-a.ts.txt line 10 is wrong')).pass).toBe(false);
  });
  it('fails when one bug is missed, and names it', () => {
    const text = allCaught()
      .split('\n')
      .filter((l) => !l.includes('case-c'))
      .join('\n');
    const v = m.judge(result(text));
    expect(v.pass).toBe(false);
    expect(v.missed).toEqual(['case-c.ts.txt']);
  });
  it('fails when a bug is named on a line outside the slack', () => {
    const far = lineOf('case-a.ts.txt') + m.LINE_SLACK + 1;
    const text = allCaught().replace(/case-a\.ts\.txt:\d+/, `case-a.ts.txt:${far}`);
    expect(m.judge(result(text)).missed).toEqual(['case-a.ts.txt']);
  });
  it('fails when a correct file is flagged (a false alarm)', () => {
    const v = m.judge(result(`${allCaught()}\nCANARY: case-e.ts.txt:9`));
    expect(v.pass).toBe(false);
    expect(v.falseAlarms).toEqual(['case-e.ts.txt']);
  });
  it('reports cost, turns and time in the summary', () => {
    const msgs = result(allCaught());
    const md = m.summary(m.judge(msgs), m.runStats(msgs));
    expect(md).toContain('Review check: pass');
    expect(md).toContain('| 3/3 | 0 | 0 | 0.12 | 4 | 31 |');
    expect(m.summary(m.judge(null), m.runStats(null))).toContain('n/a');
  });
});

describe('the workflow', () => {
  const wf = yaml.load(readFileSync(WF, 'utf8'));
  const triggers = Object.keys(wf.on || wf[true]);

  it('only uses triggers the review action supports, and never pull_request', () => {
    // claude-code-action refuses `push` ("Unsupported event type"), which would score as a fail.
    expect(triggers.sort()).toEqual(['schedule', 'workflow_dispatch']);
  });

  it('the scoring step fails the job on a failing answer (the exit code is not swallowed)', () => {
    const step = wf.jobs.check.steps.find((s) => s.name === 'Score the answer');
    const dir = mkdtempSync(join(tmpdir(), 'review-canary-'));
    try {
      const exec = join(dir, 'exec.json');
      const sum = join(dir, 'summary.md');
      const run = (answer) => {
        writeFileSync(exec, JSON.stringify(result(answer)));
        writeFileSync(sum, '');
        // GitHub runs a bash step as `bash -e {0}` unless the job sets pipefail: test that form.
        return spawnSync('bash', ['-e', '-c', step.run], {
          cwd: ROOT,
          encoding: 'utf-8',
          env: { PATH: process.env.PATH, EXECUTION_FILE: exec, GITHUB_STEP_SUMMARY: sum },
        });
      };
      const bad = run('CANARY: NONE');
      expect(bad.status).not.toBe(0);
      expect(readFileSync(sum, 'utf8')).toContain('Review check: FAIL');
      const good = run(allCaught());
      expect(good.status, good.stdout + good.stderr).toBe(0);
      expect(readFileSync(sum, 'utf8')).toContain('Review check: pass');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
