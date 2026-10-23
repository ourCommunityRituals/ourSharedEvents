/**
 * AGENTS.md <-> org brain agreement gate (owner, 2026-10-22: the documents agree).
 *
 * Hermetic: builds a throwaway brain yaml, a throwaway OCR-docs tree and a
 * throwaway AGENTS.md, runs scripts/ci/check-agents-sync.mjs against them, and
 * asserts each rule goes RED on its own injected fault (born red) and GREEN on
 * the clean fixture. No network, no real brain.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'ci', 'check-agents-sync.mjs');

const YAML = `schema: 1.2.0
invariants:
  - id: 1
    name: anonymous_id
    status: live
  - id: 7
    name: aggregate_only_reporting
    status: partial
  - id: 11
    name: runner_bash
    status: retired
`;

const AGENTS_OK = `# AGENTS.md

The org vision is \`OCR-docs/docs/OCR_VISION.md\`.

## Invariants (owner decisions; do not reopen)

The org list is the brain yaml.

1. **Never who.** [#1 #7] Publish counts.
2. **The floor** [#7 OSE]: a count below 5 is withheld.
3. **Display** [OSE]. No counts.

## Commands

Run the tests.
`;

function build({ agents = AGENTS_OK, yaml = YAML, docs = ['docs/OCR_VISION.md'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agents-sync-'));
  const ocr = join(root, 'OCR-docs');
  mkdirSync(join(ocr, 'docs'), { recursive: true });
  for (const f of docs) writeFileSync(join(ocr, f), '# doc\n');
  writeFileSync(join(root, 'AGENTS.md'), agents);
  writeFileSync(join(root, 'brain.yaml'), yaml);
  return { root, ocr };
}

function run(fx, extra = []) {
  const r = spawnSync(
    process.execPath,
    [
      SCRIPT,
      join(fx.root, 'AGENTS.md'),
      join(fx.root, 'brain.yaml'),
      '--ocr-docs',
      fx.ocr,
      '--items',
      '3',
      ...extra,
    ],
    { encoding: 'utf-8' }
  );
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const made = [];
function fx(opts) {
  const f = build(opts);
  made.push(f.root);
  return f;
}
afterAll(() => {
  for (const r of made) rmSync(r, { recursive: true, force: true });
});

describe('check-agents-sync (AGENTS.md agrees with the brain)', () => {
  test('clean fixture is green', () => {
    const r = run(fx());
    expect(r.out).toContain('agents-sync: clean');
    expect(r.code).toBe(0);
  });

  test('a retired brain id fails', () => {
    const r = run(fx({ agents: AGENTS_OK.replace('[#1 #7]', '[#1 #11]') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('[#11] has brain status "retired"');
  });

  test('an id missing from the brain fails', () => {
    const r = run(fx({ agents: AGENTS_OK.replace('[#7 OSE]', '[#99 OSE]') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('[#99] is not in the brain yaml');
  });

  test('an untagged invariant fails', () => {
    const r = run(fx({ agents: AGENTS_OK.replace(' [OSE]. No counts.', '. No counts.') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('invariant 3 has no tag');
  });

  test('a malformed tag fails', () => {
    const r = run(fx({ agents: AGENTS_OK.replace('[#1 #7]', '[#1,7]') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('malformed tag [#1,7]');
  });

  test('a cited OCR-docs path that does not exist fails', () => {
    const r = run(fx({ agents: AGENTS_OK.replace('OCR_VISION.md', 'VISION.md') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('cited path OCR-docs/docs/VISION.md does not exist');
  });

  test('no ids at all fails (cannot pass on nothing)', () => {
    const r = run(fx({ agents: AGENTS_OK.replace(/\[#\d+( #\d+)?( OSE)?\]/g, '[OSE]') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('zero [#n] ids found');
  });

  test('the wrong number of invariants fails', () => {
    const r = run(fx({ agents: AGENTS_OK.replace('3. **Display** [OSE]. No counts.\n', '') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('expected 3 numbered invariants, found 2');
  });

  test('a brain yaml that parses to nothing fails', () => {
    const r = run(fx({ yaml: 'schema: 1.2.0\n' }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('no invariant entries parsed');
  });

  test('a missing file is a usage error (exit 2), not a pass', () => {
    const f = fx();
    const r = spawnSync(
      process.execPath,
      [SCRIPT, join(f.root, 'nope.md'), join(f.root, 'brain.yaml'), '--ocr-docs', f.ocr],
      { encoding: 'utf-8' }
    );
    expect(r.status).toBe(2);
  });
});
