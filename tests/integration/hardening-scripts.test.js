/**
 * Workstation / GitHub hardening scripts (scripts/hardening/*).
 *
 * The verifier is the instrument the 2026-10-11 security review is graded with, so it has to
 * be able to go red: each control below starts failing on a scratch settings file and passes
 * only after apply-workstation has run. The real home is never touched: CLAUDE_HOME points at
 * a scratch folder under the OS temp dir, and --apply on the real home must refuse without a
 * terminal.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const DIR = join(__dirname, '..', '..', 'scripts', 'hardening');
const run = (script, args, env = {}) =>
  spawnSync(process.execPath, [join(DIR, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: '',
  });

function scratchHome(settings) {
  const home = mkdtempSync(join(tmpdir(), 'ose-hardening-'));
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings));
  return home;
}

const workstationChecks = (home) => {
  const r = run('verify-hardening.mjs', ['--json', '--only=workstation'], { CLAUDE_HOME: home });
  const { checks } = JSON.parse(r.stdout);
  return Object.fromEntries(
    checks.filter((c) => c.plane === 'workstation').map((c) => [c.id, c.status])
  );
};

const BAD = {
  permissions: {
    allow: [
      'Bash(git:*)',
      'Bash(npx:*)',
      'Bash(curl:*)',
      'Bash(claude:*)',
      'Bash(gh api:*)',
      'Bash(npm test *)',
    ],
    deny: [],
  },
  remoteControlAtStartup: true,
  autoApproveExecutions: true,
  theme: 'dark',
};

describe('verify-hardening', () => {
  it('self-test passes', () => {
    const r = run('verify-hardening.mjs', ['--self-test']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/self-test ok/);
  });

  it('fails every settings control on a permissive scratch home', () => {
    const c = workstationChecks(scratchHome(BAD));
    expect([c.W1, c.W2, c.W3, c.W4, c.W5]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
  });

  it('treats a missing settings file as unprotected, not as clean', () => {
    const home = mkdtempSync(join(tmpdir(), 'ose-hardening-empty-'));
    const c = workstationChecks(home);
    expect(c.W1).toBe('FAIL');
    expect(c.W5).toBe('FAIL');
    expect(c.W6).toBe('FAIL');
  });

  it('passes W6 only when the hook has actually logged a call', () => {
    const home = scratchHome(BAD);
    expect(workstationChecks(home).W6).toBe('FAIL');
    mkdirSync(join(home, '.claude', 'audit'));
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(join(home, '.claude', 'audit', `policy-${day}.jsonl`), '{}\n');
    expect(workstationChecks(home).W6).toBe('PASS');
  });
});

describe('apply-workstation', () => {
  it('dry run writes nothing', () => {
    const home = scratchHome(BAD);
    const before = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const r = run('apply-workstation.mjs', [], { CLAUDE_HOME: home });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Dry run/);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe(before);
    expect(existsSync(join(home, '.claude', 'hooks'))).toBe(false);
  });

  it('applies on a scratch home, flips W1-W5 to PASS, and keeps unrelated keys', () => {
    const home = scratchHome(BAD);
    const r = run('apply-workstation.mjs', ['--apply'], { CLAUDE_HOME: home });
    expect(r.status).toBe(0);
    const c = workstationChecks(home);
    expect([c.W1, c.W2, c.W3, c.W4, c.W5]).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(s.theme).toBe('dark');
    expect(s.permissions.allow).toContain('Bash(npm test *)');
    expect(s.permissions.allow).not.toContain('Bash(curl:*)');
    expect(s.permissions.allow).not.toContain('Bash(git:*)');
  });

  it('is idempotent', () => {
    const home = scratchHome(BAD);
    run('apply-workstation.mjs', ['--apply'], { CLAUDE_HOME: home });
    const once = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const r = run('apply-workstation.mjs', ['--apply'], { CLAUDE_HOME: home });
    expect(r.stdout).toMatch(/already match/);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe(once);
  });

  it('refuses --apply on the real home without a terminal', () => {
    const r = run('apply-workstation.mjs', ['--apply']);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/owner in their own terminal/);
  });

  it('refuses --apply against a CLAUDE_HOME outside the temp folder', () => {
    const r = run('apply-workstation.mjs', ['--apply'], {
      CLAUDE_HOME: join(__dirname, '..', '..'),
    });
    expect(r.status).toBe(3);
  });
});

describe('apply-github', () => {
  it('refuses --apply without a terminal', () => {
    const r = run('apply-github.mjs', ['--apply']);
    // 2 when gh is unavailable or unauthenticated, 3 when it reaches the terminal check
    expect([2, 3]).toContain(r.status);
  });
});
