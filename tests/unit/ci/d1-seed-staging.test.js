/**
 * Staging seed steps wait out another leg's D1 import (run 38162352541).
 * Seen red: with the old single 5 s retry (BUSY_WAITS_S = [5]) the
 * "busy for three tries" case fails.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

let applyWithRetry;
let BUSY_WAITS_S;

beforeAll(async () => {
  ({ applyWithRetry, BUSY_WAITS_S } = await import('../../../scripts/ci/d1-seed-staging.mjs'));
});

const BUSY_OUT =
  '✘ [ERROR] Currently processing a long-running import. Cannot start another import until that completes or times out.';

function harness(results) {
  const calls = [];
  const slept = [];
  const lines = [];
  return {
    calls,
    slept,
    lines,
    opts: {
      db: 'DB',
      file: 'fixture.sql',
      run: (db, file) => {
        calls.push([db, file]);
        const r = results[calls.length - 1];
        return r === 'ok' ? { ok: true, output: '' } : { ok: false, output: r };
      },
      sleep: async (s) => {
        slept.push(s);
      },
      log: (l) => lines.push(l),
    },
  };
}

describe('d1-seed-staging', () => {
  test('applies on the first try without waiting', async () => {
    const h = harness(['ok']);
    expect(await applyWithRetry(h.opts)).toBe(true);
    expect(h.calls).toEqual([['DB', 'fixture.sql']]);
    expect(h.slept).toEqual([]);
  });

  test('busy for three tries, then applied: waits 10, 20, 30 s', async () => {
    const h = harness([BUSY_OUT, BUSY_OUT, BUSY_OUT, 'ok']);
    expect(await applyWithRetry(h.opts)).toBe(true);
    expect(h.slept).toEqual([10, 20, 30]);
    expect(h.lines.every((l) => l.startsWith('::warning::'))).toBe(true);
  });

  test('busy past every wait: fails by name, after 150 s in all', async () => {
    const h = harness(Array(BUSY_WAITS_S.length + 1).fill(BUSY_OUT));
    expect(await applyWithRetry(h.opts)).toBe(false);
    expect(h.slept.reduce((a, b) => a + b, 0)).toBe(150);
    expect(h.lines.at(-1)).toMatch(/^::error::DB fixture\.sql: not applied/);
  });

  test('any other error is retried once, after 5 s', async () => {
    const h = harness(['boom', 'boom']);
    expect(await applyWithRetry(h.opts)).toBe(false);
    expect(h.slept).toEqual([5]);
    expect(h.calls).toHaveLength(2);
  });

  test('every staging seed in the CI workflow goes through the script', () => {
    const wf = readFileSync(
      join(__dirname, '../../../.github/workflows/oursharedevents-ci.yml'),
      'utf8'
    );
    const direct = wf
      .split('\n')
      .filter((l) => /wrangler d1 execute\b.*--remote/.test(l) && !/^\s*#/.test(l))
      .filter((l) => !/--command|--json/.test(l));
    expect(direct, 'use scripts/ci/d1-seed-staging.mjs for --file seeds').toEqual([]);
    expect(wf).toMatch(/d1-seed-staging\.mjs DB/);
  });
});
