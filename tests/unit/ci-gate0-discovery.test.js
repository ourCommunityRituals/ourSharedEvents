// ─────────────────────────────────────────────────────────────────────────────
// Gate 0 born-red proof + the invariants that made it necessary — OSE-852 (Gate
// 0a, MINE-0) and OSE-1170 (Gate 0b, all-skipped floor).
//
// The 0a bug: `T4e: Attendee Arc Journey` passed `tests/ui/smoke/...` to a config
// whose testDir is `./tests/e2e`. Playwright filters positional args against
// testDir, so the step discovered ZERO tests. The spec file existed, which is
// why it read as fine. It was insulated from going red three separate ways —
// path outside testDir, zero-discovery exiting green, and continue-on-error —
// any one of which was sufficient on its own.
//
// The 0b bug (OSE-1170): a step that DISCOVERS tests but EXECUTES none of them —
// every test hit a runtime `test.skip()` because a precondition (seed, fixture,
// flag) was unmet — also exits green. Gate 0b parses the post-run result JSON and
// fails when `executed == 0 while discovered > 0`. It depends on the run actually
// emitting result JSON via PLAYWRIGHT_JSON_OUTPUT_NAME, which requires the config
// to carry a `json` reporter — so a fourth invariant is locked below.
//
// What is locked here:
//   1. BORN-RED (0a) — the guard goes red on zero discovery / unparseable list.
//   2. BORN-RED (0b) — the guard goes red on all-skipped and on a green run that
//      emits no parseable result JSON; it stays GREEN when tests execute.
//      Proven hermetically against a stub `npx` on PATH — no real browser, so it
//      cannot pass vacuously.
//   3. THE CLASS (0a) — every Playwright invocation keeps its positional paths
//      inside its config's testDir, so that specific bug cannot return anywhere.
//   4. THE CLASS (0b) — every config the guard runs declares a `json` reporter,
//      so Gate 0b can never be silently defeated by a config that emits none.
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

/**
 * Run the guard with a stub `npx` that emits `listJson` for `--list` and, on the
 * actual run, writes `resultJson` to $PLAYWRIGHT_JSON_OUTPUT_NAME (mimicking a
 * `json` reporter) then exits with `runExit`.
 *
 * `resultJson === null` models a config with NO json reporter — the run emits no
 * result file — which is exactly the false-red trap Gate 0b must handle: green
 * exit, but no proof any test ran.
 */
function runGuardWithStub(listJson, { resultJson, runExit = 0 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate0-'));
  const stub = path.join(dir, 'npx');
  // Default: a healthy result JSON that mirrors the discovered specs as all
  // executed, so pre-0b tests (which only assert discovery behavior) stay green.
  const emit =
    resultJson === undefined ? healthyResultFor(listJson) : resultJson;
  const writeResult =
    emit === null
      ? ''
      : `if [ -n "$PLAYWRIGHT_JSON_OUTPUT_NAME" ]; then cat > "$PLAYWRIGHT_JSON_OUTPUT_NAME" <<'RESULT'\n${emit}\nRESULT\nfi\n`;
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\n` +
      `for a in "$@"; do [ "$a" = "--list" ] && { cat <<'EOF'\n${listJson}\nEOF\nexit 0; }; done\n` +
      writeResult +
      `exit ${runExit}\n`
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

/** A run-result JSON with `executed` passed tests and `skipped` skipped tests. */
const resultSuite = (executed, skipped) =>
  JSON.stringify({
    suites: [
      {
        specs: [
          ...new Array(executed).fill({ tests: [{ results: [{ status: 'passed' }] }] }),
          ...new Array(skipped).fill({ tests: [{ results: [{ status: 'skipped' }] }] }),
        ],
        suites: [],
      },
    ],
  });

/** Result JSON that marks every discovered spec as executed (default healthy run). */
function healthyResultFor(listJson) {
  let n = 0;
  try {
    (function walk(suites) {
      for (const su of suites || []) {
        n += (su.specs || []).length;
        walk(su.suites);
      }
    })(JSON.parse(listJson).suites);
  } catch {
    return resultSuite(1, 0);
  }
  return resultSuite(n, 0);
}

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

describe('OSE-1170 Gate 0b — all-skipped is not green', () => {
  it('goes RED when tests are discovered but every one is skipped', () => {
    const r = runGuardWithStub(suite(2), { resultJson: resultSuite(0, 2) });
    expect(r.status, 'discovered>0 but executed==0 MUST fail — a precondition was unmet').not.toBe(
      0
    );
    expect(r.stdout + r.stderr).toMatch(/executed 0|all-skipped/);
  });

  it('stays GREEN when at least one discovered test executes (partial skip is visible, not fatal)', () => {
    const r = runGuardWithStub(suite(3), { resultJson: resultSuite(1, 2) });
    expect(r.status, 'one executed test is enough to prove the step ran').toBe(0);
    expect(r.stdout).toMatch(/executed 1/);
    expect(r.stdout).toMatch(/skipped 2/);
  });

  it('goes RED when a green run emits no parseable result JSON (unknown is never green)', () => {
    // resultJson:null == config with no `json` reporter → nothing written.
    const r = runGuardWithStub(suite(2), { resultJson: null, runExit: 0 });
    expect(
      r.status,
      'a green exit with no result JSON cannot confirm any test ran — must fail'
    ).not.toBe(0);
  });

  it('surfaces the original run failure when the run itself failed and emitted no JSON', () => {
    const r = runGuardWithStub(suite(2), { resultJson: null, runExit: 4 });
    expect(r.status, 'a failing run must propagate its own exit code, not be masked').toBe(4);
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

describe('OSE-1170 Gate 0b — the class cannot return', () => {
  const wf = YAML.parse(readFileSync(WORKFLOW, 'utf8'));
  // Only the steps that actually run through pw-guarded.sh depend on Gate 0b's
  // result-JSON read; a plain `npx playwright test` step does not.
  const guardConfigs = [
    ...new Set(
      Object.values(wf.jobs ?? {})
        .flatMap((def) => def.steps ?? [])
        .filter((s) => typeof s.run === 'string' && /pw-guarded\.sh/.test(s.run))
        .map((s) => (s.run.match(/--config=(\S+)/) ?? [])[1])
        .filter(Boolean)
    ),
  ];
  const declaresJsonReporter = (cfg) =>
    /\[\s*['"]json['"]/.test(readFileSync(path.join(REPO, cfg), 'utf8'));

  it('there is at least one guarded step (else this invariant is vacuous)', () => {
    expect(guardConfigs.length).toBeGreaterThan(0);
  });

  it('every config pw-guarded.sh runs declares a json reporter (else Gate 0b false-reds a green run)', () => {
    const missing = guardConfigs.filter((cfg) => !declaresJsonReporter(cfg));
    expect(
      missing,
      `these guarded configs emit no result JSON, so Gate 0b cannot confirm execution: ${missing.join(', ')}`
    ).toEqual([]);
  });
});
