/**
 * scripts/ci/map-counts-check.mjs as CI runs it: a process, judged by its exit
 * code and what it prints (OSE-2071).
 *
 * map-counts-check.test.js pins the script's pure rules. These tests run the
 * script itself, with a stand-in `npx` first on PATH that answers like
 * `wrangler d1 execute --json` would. So no staging and no D1 are needed, and the
 * part that turns a step red (main(): the wrangler exit code, the read, the exit
 * code) is held, not only the functions it calls.
 *
 * The four cases OSE-2071 names, each a red step: a moved tap, a moved share
 * open, a scan row, and an answer that cannot be read. Two more: a wrangler that
 * fails but still printed the seeded row is red, and nothing the script prints
 * carries a number it read (the repository is public, so its CI logs are too,
 * and a moved count is often under 5).
 *
 * BORN RED (2026-11-16): one fault at a time in the script, both map-counts test
 * files run, the fault taken out. Every test here failed under at least one:
 *   F1 `return 1` after the differences -> `return 0`
 *      -> a moved tap, a moved share open, a scan row, an answer that cannot be
 *         read, a number given as text (5 red)
 *   F2 the `r.status !== 0` branch removed
 *      -> both "wrangler failed…" tests (2 red). Before this file, no test saw it.
 *   F3 with no flag the read is local
 *      -> "the seeded numbers pass…", "a stray --persist-to…", and the pure
 *         wranglerArgs test (3 red)
 *   F4 the read row printed again -> "nothing printed carries a number…" (1 red)
 *   F5 wrangler's output echoed whole on a failure
 *      -> "wrangler failed, even with the seeded row printed…" (1 red)
 *   F6 the success path returns 1 -> "the seeded numbers pass…" (1 red)
 *   F7 a difference line names the value read
 *      -> "nothing printed carries a number…" and three pure-rule tests (4 red)
 *   F8 no row reads as no difference
 *      -> "an answer that cannot be read…" and the pure "unknown is never
 *         green" test (2 red)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'scripts/ci/map-counts-check.mjs');

let m;
let bin;
beforeAll(async () => {
  m = await import('../../../scripts/ci/map-counts-check.mjs');
  // A stand-in for `npx`: it records its arguments and answers with what the
  // test put in its environment. Both a shell and a Windows wrapper, so the
  // script's own lookup of `npx` finds it on either.
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'map-counts-npx-'));
  fs.writeFileSync(
    path.join(bin, 'fake-wrangler.cjs'),
    [
      "const fs = require('fs');",
      'fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));',
      "process.stdout.write(process.env.FAKE_STDOUT || '');",
      "process.stderr.write(process.env.FAKE_STDERR || '');",
      "process.exit(Number(process.env.FAKE_STATUS || '0'));",
      '',
    ].join('\n')
  );
  const sh = path.join(bin, 'npx');
  fs.writeFileSync(sh, '#!/bin/sh\nexec node "$(dirname "$0")/fake-wrangler.cjs" "$@"\n');
  fs.chmodSync(sh, 0o755);
  fs.writeFileSync(path.join(bin, 'npx.cmd'), '@node "%~dp0fake-wrangler.cjs" %*\r\n');
});

afterAll(() => {
  if (bin) fs.rmSync(bin, { recursive: true, force: true });
});

/** wrangler d1 execute --json output holding one result row. */
const answer = (row) =>
  JSON.stringify([{ results: [row], success: true, meta: { rows_read: 1 } }], null, 2);

/** Run the script as CI does, with the stand-in answering. */
function run({ stdout = '', stderr = '', status = 0, argv = [] } = {}) {
  const argsFile = path.join(bin, `args-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [SCRIPT, ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      FAKE_ARGS_FILE: argsFile,
      FAKE_STDOUT: stdout,
      FAKE_STDERR: stderr,
      FAKE_STATUS: String(status),
    },
  });
  const args = fs.existsSync(argsFile) ? JSON.parse(fs.readFileSync(argsFile, 'utf8')) : null;
  return { code: r.status, out: `${r.stdout}${r.stderr}`, args };
}

describe('map-counts-check.mjs as a process', () => {
  test('the seeded numbers pass, and the read went to staging D1 remotely', () => {
    const r = run({ stdout: `notice: a newer wrangler is out\n${answer({ ...m.EXPECTED })}` });
    expect(r.code, r.out).toBe(0);
    expect(r.args.slice(0, 7)).toEqual([
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--env',
      'staging',
      '--remote',
    ]);
    expect(r.out).toContain('staging D1 (--env staging --remote)');
    expect(r.out).toContain('map counts unchanged');
  });

  test('a moved tap turns it red, by name', () => {
    const r = run({ stdout: answer({ ...m.EXPECTED, taps_a: m.EXPECTED.taps_a + 1 }) });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('::error::map counts moved: taps_a: moved from the seeded value');
  });

  test('a moved share open turns it red, by name', () => {
    const r = run({ stdout: answer({ ...m.EXPECTED, share_opens: m.EXPECTED.share_opens + 1 }) });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('::error::map counts moved: share_opens: moved from the seeded value');
  });

  test('a scan row turns it red, by name', () => {
    const r = run({ stdout: answer({ ...m.EXPECTED, scans: 1 }) });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('::error::map counts moved: scans: moved from the seeded value');
  });

  test('an answer that cannot be read turns it red: not JSON, no row, an error', () => {
    for (const stdout of [
      '',
      'not json [at all',
      '[{"results":[],"success":true}]',
      '{"error":1}',
    ]) {
      const r = run({ stdout });
      expect(r.code, `${stdout}\n${r.out}`).toBe(1);
      expect(r.out).toContain('no result row was read');
    }
  });

  test('a number given as text, or missing, is unreadable and red', () => {
    const missing = { ...m.EXPECTED };
    delete missing.scans;
    for (const row of [{ ...m.EXPECTED, taps_b: String(m.EXPECTED.taps_b) }, missing]) {
      const r = run({ stdout: answer(row) });
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain('unreadable (not a number)');
    }
  });

  test('wrangler failed, even with the seeded row printed: red, and the row is held back', () => {
    const r = run({ stdout: answer({ ...m.EXPECTED }), stderr: 'D1 error\n', status: 1 });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('the D1 read failed, so nothing was checked');
    expect(r.out).toContain('held back');
    expect(r.out).not.toContain('"taps_a"');
  });

  test('wrangler failed with no row: its own error is shown, and it is red', () => {
    const r = run({ stdout: '{"error":{"text":"no such table: shortlinks"}}', status: 1 });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('no such table: shortlinks');
  });

  test('nothing printed carries a number it read (pass and fail)', () => {
    const rows = [
      { ...m.EXPECTED },
      { ...m.EXPECTED, taps_a: 1043, tap_days: 3, share_opens: 4, share_open_rows: 7, scans: 2 },
    ];
    for (const row of rows) {
      const r = run({ stdout: answer(row) });
      for (const [key, value] of Object.entries(row)) {
        // Neither `"key":value` nor `key: value`, nor the key with its value
        // anywhere later on the same line.
        expect(r.out).not.toContain(`"${key}"`);
        for (const line of r.out.split('\n').filter((l) => l.includes(key))) {
          expect(line, line).not.toMatch(new RegExp(`\\b${value}\\b`));
        }
      }
      // The only number printed is how many numbers were read. Names that hold a
      // digit (a ticket id, "D1") are not numbers.
      const digits = r.out.replace(/OSE-\d+|\bD1\b/g, '').match(/\d+/g) ?? [];
      expect(digits, r.out).toEqual([String(Object.keys(m.EXPECTED).length)]);
    }
  });

  test('a stray --persist-to is refused before anything is read', () => {
    const r = run({ argv: ['--persist-to', '/tmp/x'] });
    expect(r.code).toBe(2);
    expect(r.args).toBeNull();
  });
});
