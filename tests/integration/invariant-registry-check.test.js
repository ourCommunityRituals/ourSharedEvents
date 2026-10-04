/**
 * Invariant registry <-> repo reconciliation gate (OSE-1604).
 *
 * Hermetic: builds a throwaway "brain" (architectural-invariants.yaml) and a
 * throwaway repo tree, runs scripts/check-invariant-registry.py against them,
 * and asserts each rule goes RED on its own injected fault (born-red) and
 * GREEN on the clean fixture. No network, no real brain.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'check-invariant-registry.py');

function python() {
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['-c', 'import yaml'], { encoding: 'utf-8' });
    if (r.status === 0) return bin;
  }
  return null;
}
const PY = python();
const maybe = PY ? describe : describe.skip;

const YAML = `invariants:
  - id: 1
    name: anonymous_id
    status: live
    test_file: anonymous-id.invariant.spec.ts
  - id: 2
    name: tenant_isolation
    status: partial
    test_file: tests/audit-layer.spec.ts (OSE repo - in construction)
  - id: 3
    name: brain_guard
    status: live
    test_file: ocr-docs-brain/scripts/guard.py (OCR-docs brain)
  - id: 4
    name: retired_one
    status: retired
    test_file: gone.invariant.spec.ts
`;

function fixture({ baseline } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'inv-reg-'));
  const brain = join(root, 'OCR-docs', 'ocr-docs-brain');
  const repo = join(root, 'repo');
  mkdirSync(join(brain, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'tests', 'e2e', '0-architecture'), { recursive: true });
  writeFileSync(join(brain, 'architectural-invariants.yaml'), YAML);
  writeFileSync(join(brain, 'scripts', 'guard.py'), '# guard\n');
  writeFileSync(join(repo, 'tests', 'e2e', '0-architecture', 'anonymous-id.invariant.spec.ts'), '');
  writeFileSync(
    join(repo, 'tests', 'e2e', '0-architecture', 'README.md'),
    '# gates\n\nnarrative\n'
  );
  writeFileSync(
    join(repo, '.invariant-registry-baseline.json'),
    JSON.stringify({
      missing_test_file: baseline ?? { 2: 'audit layer lives elsewhere; brain re-point pending' },
    })
  );
  return { root, brain, repo };
}

function run({ brain, repo }, extra = []) {
  return spawnSync(PY, [SCRIPT, '--brain', brain, '--repo', repo, ...extra], {
    encoding: 'utf-8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
}

maybe('OSE-1604 | invariant registry check', () => {
  let fx;
  afterEach(() => fx && rmSync(fx.root, { recursive: true, force: true }));

  test('a README without the generated index fails; --write then passes', () => {
    fx = fixture();
    expect(run(fx).status).toBe(1);
    expect(run(fx, ['--write']).status).toBe(0);
    const r = run(fx);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('clean');
  });

  test('retired invariants are not required to resolve', () => {
    fx = fixture();
    run(fx, ['--write']);
    expect(run(fx).stdout).not.toContain('retired_one');
  });

  test('a missing test_file not in the baseline fails and names the invariant', () => {
    fx = fixture({ baseline: {} });
    run(fx, ['--write']);
    const r = run(fx);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('#2 tenant_isolation');
    expect(r.stdout).toContain('does not exist');
  });

  test('deleting a spec the registry names turns the check red', () => {
    fx = fixture();
    run(fx, ['--write']);
    rmSync(join(fx.repo, 'tests', 'e2e', '0-architecture', 'anonymous-id.invariant.spec.ts'));
    const r = run(fx);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('#1 anonymous_id');
  });

  test('a brain-side file that disappears turns the check red', () => {
    fx = fixture();
    run(fx, ['--write']);
    rmSync(join(fx.brain, 'scripts', 'guard.py'));
    expect(run(fx).stdout).toContain('#3 brain_guard');
  });

  test('ratchet: a baseline entry whose file now resolves must be removed', () => {
    fx = fixture();
    mkdirSync(join(fx.repo, 'tests'), { recursive: true });
    writeFileSync(join(fx.repo, 'tests', 'audit-layer.spec.ts'), '');
    run(fx, ['--write']);
    const r = run(fx);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('baseline #2 now resolves');
  });

  test('a baseline entry with no reason fails', () => {
    fx = fixture({ baseline: { 2: '  ' } });
    run(fx, ['--write']);
    expect(run(fx).stdout).toContain('baseline #2 has no reason');
  });

  test('a new gate spec not in the generated index fails; a hand edit fails', () => {
    fx = fixture();
    run(fx, ['--write']);
    const dir = join(fx.repo, 'tests', 'e2e', '0-architecture');
    writeFileSync(join(dir, 'new-gate.invariant.spec.ts'), '');
    expect(run(fx).stdout).toContain('stale or hand-edited');
    run(fx, ['--write']);
    expect(run(fx).status).toBe(0);
    const readme = join(dir, 'README.md');
    writeFileSync(readme, readFileSync(readme, 'utf-8').replace('| `anonymous-id', '| `HAND-EDIT'));
    expect(run(fx).stdout).toContain('stale or hand-edited');
  });
});
