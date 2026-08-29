// ─────────────────────────────────────────────────────────────────────────────
// Gate 0 born-red proof + the invariant that made it necessary — OSE-852 (MINE-0).
//
// The bug: `T4e: Attendee Arc Journey` passed `tests/ui/smoke/...` to a config
// whose testDir is `./tests/e2e`. Playwright filters positional args against
// testDir, so the step discovered ZERO tests. The spec file existed, which is
// why it read as fine. It was insulated from going red three separate ways —
// path outside testDir, zero-discovery exiting green, and continue-on-error —
// any one of which was sufficient on its own.
//
// Two things are locked here:
//   1. BORN-RED — pw-guarded.sh actually goes red on zero discovery. Proven
//      hermetically against a stub `npx` on PATH, so it does not need a real
//      browser install and cannot pass vacuously.
//   2. THE CLASS — every Playwright invocation in CI keeps its positional paths
//      inside its config's testDir, so this specific bug cannot return anywhere.
// ─────────────────────────────────────────────────────────────────────────────
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, chmodSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
// vitest globals: true (vitest.config.ts) — matches the sibling CI meta-tests.

const REPO = path.resolve(__dirname, '../..');
const GUARD = path.join(REPO, 'scripts', 'pw-guarded.sh');
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'oursharedevents-ci.yml');

/** Run the guard with a stub `npx` that emits `listJson` for `--list`. */
function runGuardWithStub(listJson) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate0-'));
  const stub = path.join(dir, 'npx');
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\nfor a in "$@"; do [ "$a" = "--list" ] && { cat <<'EOF'\n${listJson}\nEOF\nexit 0; }; done\nexit 0\n`
  );
  chmodSync(stub, 0o755);
  return spawnSync('bash', [GUARD, '--config=whatever.config.ts', 'some/path'], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PW_LABEL: 'stub',
      GITHUB_STEP_SUMMARY: '',
    },
    encoding: 'utf8',
  });
}

const suite = (specs) =>
  JSON.stringify({ suites: [{ specs: new Array(specs).fill({}), suites: [] }] });

describe('OSE-852 Gate 0 — pw-guarded.sh is born red', () => {
  it('goes RED when discovery returns zero tests', () => {
    const r = runGuardWithStub(JSON.stringify({ suites: [] }));
    expect(r.status, 'zero discovered tests MUST fail the step').not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/discovered 0 tests/);
  });

  it('goes RED when discovery output cannot be parsed (unknown is never green)', () => {
    const r = runGuardWithStub('not json at all');
    expect(
      r.status,
      'unparseable discovery MUST fail, not be treated as zero or as success'
    ).not.toBe(0);
  });

  it('is NOT always-red — proceeds when tests are discovered', () => {
    const r = runGuardWithStub(suite(7));
    expect(r.status, 'a healthy discovery must not fail — otherwise the guard proves nothing').toBe(
      0
    );
    expect(r.stdout).toMatch(/discovered tests: 7/);
  });
});

describe('OSE-852 Gate 0 — the bug class cannot return', () => {
  const wf = YAML.parse(readFileSync(WORKFLOW, 'utf8'));
  const configTestDir = (cfg) => {
    const m = readFileSync(path.join(REPO, cfg), 'utf8').match(/testDir:\s*['"]([^'"]+)['"]/);
    return m ? m[1].replace(/^\.\//, '') : null;
  };
  const runs = Object.entries(wf.jobs ?? {}).flatMap(([job, def]) =>
    (def.steps ?? [])
      .filter((s) => typeof s.run === 'string' && /playwright test|pw-guarded\.sh/.test(s.run))
      .map((s) => ({
        job,
        name: s.name ?? '(unnamed)',
        run: s.run,
        coe: s['continue-on-error'] === true,
      }))
  );

  it('parses at least one Playwright step (the guard would vacuously pass otherwise)', () => {
    expect(runs.length).toBeGreaterThan(0);
  });

  it('every Playwright invocation keeps its positional paths inside its config testDir', () => {
    const violations = [];
    for (const r of runs) {
      const cfg = (r.run.match(/--config=(\S+)/) ?? [])[1];
      if (!cfg) continue;
      const td = configTestDir(cfg);
      if (!td) continue;
      for (const p of r.run.match(/tests\/[^\s\\"']+/g) ?? []) {
        if (!p.startsWith(td))
          violations.push(`${r.name}: "${p}" is outside ${cfg} testDir "${td}" -> ZERO DISCOVERY`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T4e no longer swallows its own failures with continue-on-error', () => {
    const t4e = runs.find((r) => r.name.includes('T4e'));
    expect(t4e, 'T4e step must exist').toBeDefined();
    expect(
      t4e.coe,
      'T4e must not carry continue-on-error — it is the step MINE-0 un-insulated'
    ).toBe(false);
  });

  it('the guard script exists and is executable', () => {
    expect(() => execFileSync('test', ['-x', GUARD])).not.toThrow();
  });
});
