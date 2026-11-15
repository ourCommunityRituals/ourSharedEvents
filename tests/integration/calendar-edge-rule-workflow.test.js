// vitest globals: true (vitest.config.ts). OSE-2023: the workflow that applies the
// calendar edge rule from GitHub. It is dispatch only, stg only, writes only on a
// typed confirm, takes its inputs through env (never into a script), and carries
// one secret: the WAF edit token.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');

const FILE = path.join(__dirname, '../../.github/workflows/calendar-edge-rule.yml');
const text = readFileSync(FILE, 'utf8');
const wf = yaml.load(text);
const steps = wf.jobs.rule.steps;
const step = (name) => steps.find((s) => s.name === name);

describe('calendar edge rule workflow', () => {
  test('dispatch only, read-only repository token, one run at a time', () => {
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(wf.concurrency).toEqual({ group: 'calendar-edge-rule', 'cancel-in-progress': false });
  });

  test('offers dry-run, apply and remove, and dry-run is the default', () => {
    const { action, confirm } = wf.on.workflow_dispatch.inputs;
    expect(action.options).toEqual(['dry-run', 'apply', 'remove']);
    expect(action.default).toBe('dry-run');
    expect(confirm.default).toBe('');
  });

  test('stg only: production is never named', () => {
    expect(step('Rule').run).not.toMatch(/production/);
    expect(step('Rule').run.match(/--host \S+/g)).toEqual([
      '--host stg',
      '--host stg',
      '--host stg',
    ]);
  });

  test('inputs reach the shell through env, never written into a script', () => {
    for (const s of steps) {
      if (typeof s.run === 'string') expect(s.run, s.name).not.toContain('${{');
    }
    expect(step('Check the request').env).toEqual({
      ACTION: '${{ inputs.action }}',
      CONFIRM: '${{ inputs.confirm }}',
    });
  });

  test('carries one secret, the WAF edit token, and only in the step that writes', () => {
    expect(text.match(/secrets\.[A-Z0-9_]+/g)).toEqual(['secrets.CLOUDFLARE_WAF_EDIT_TOKEN']);
    const withSecret = steps.filter((s) => JSON.stringify(s.env ?? {}).includes('secrets.'));
    expect(withSecret.map((s) => s.name)).toEqual(['Rule']);
    expect(text).not.toMatch(/ADMIN_KEY|wrangler|CLOUDFLARE_API_TOKEN_OSE|X_OCR_INTERNAL/);
  });

  test('the confirm check runs first, before the checkout and before any secret', () => {
    expect(steps[0].name).toBe('Check the request');
  });

  test('actions are pinned to a commit', () => {
    for (const s of steps.filter((x) => x.uses)) expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
  });

  test('after an apply the job waits for the calendar read; the before read cannot fail it', () => {
    // No step hides a failure (the CI integrity ratchet counts continue-on-error).
    for (const s of steps) expect(s['continue-on-error'], s.name).toBeUndefined();
    expect(step('Before - what a calendar app sees').run).toBe(
      'node scripts/stock/edge-probe.mjs --calendar-app --report-only'
    );
    const after = step('After - what a calendar app sees');
    expect(after.if).toBe("inputs.action == 'apply'");
    expect(after.run).toContain('node scripts/stock/edge-probe.mjs --calendar-app');
    expect(after.run).not.toContain('--report-only');
  });
});

// The confirm check is shell. Run it for real: it is the only thing between a
// mis-click and a write.
describe('the confirm check', () => {
  const script = step('Check the request').run;
  const run = (ACTION, CONFIRM) => {
    try {
      execFileSync('bash', ['-c', script], {
        env: { PATH: process.env.PATH, ACTION, CONFIRM },
        stdio: 'pipe',
      });
      return 0;
    } catch (e) {
      return e.status;
    }
  };

  test('a dry run needs no confirm', () => {
    expect(run('dry-run', '')).toBe(0);
  });

  test.each(['apply', 'remove'])('%s is refused without the exact word', (action) => {
    for (const confirm of ['', 'apply', 'APPLY ', 'yes', 'APPLY; echo x']) {
      expect(run(action, confirm), `${action} / "${confirm}"`).toBe(1);
    }
    expect(run(action, 'APPLY')).toBe(0);
  });

  test('an unknown action is refused', () => {
    expect(run('apply --host production', 'APPLY')).toBe(2);
    expect(run('', 'APPLY')).toBe(2);
  });
});

// The Rule step picks the script's arguments in shell too.
describe('the Rule step', () => {
  const script = step('Rule').run.replace(
    /node scripts\/ci\/cf-waf-calendar-skip\.mjs "\$@" 2>&1 \| tee -a "\$GITHUB_STEP_SUMMARY"/,
    'echo "ARGS:$*"'
  );
  const run = (ACTION, token = 'tok') => {
    try {
      const out = execFileSync('bash', ['-c', script], {
        env: {
          PATH: process.env.PATH,
          ACTION,
          CLOUDFLARE_API_TOKEN: token,
          GITHUB_STEP_SUMMARY: '/dev/null',
        },
        stdio: 'pipe',
      });
      return { code: 0, out: String(out) };
    } catch (e) {
      return { code: e.status, out: String(e.stdout) };
    }
  };

  test('the stand-in really replaced the script call', () => {
    expect(script).toContain('echo "ARGS:$*"');
    expect(script).not.toContain('cf-waf-calendar-skip.mjs "$@"');
  });

  test('each action runs the script with exactly its flags', () => {
    expect(run('dry-run').out).toContain('ARGS:--host stg\n');
    expect(run('apply').out).toContain('ARGS:--host stg --apply\n');
    expect(run('remove').out).toContain('ARGS:--host stg --remove --apply\n');
  });

  test('without the secret it stops before the script', () => {
    const r = run('apply', '');
    expect(r.code).toBe(1);
    expect(r.out).toContain('CLOUDFLARE_WAF_EDIT_TOKEN is not set');
    expect(r.out).not.toContain('ARGS:');
  });
});
