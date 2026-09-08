/**
 * OSE-834 slice 2d — unit tests for the deploy-freshness gate's pure logic.
 *
 * Puts the born-red cases (also the script's `--self-test`) into the CI test
 * pyramid so a regression in the freshness logic is caught by the T0 `tests`
 * shard, not only by the gate's own CI step. The module exports pure functions
 * and is import-safe (its CLI entrypoint is isMain-guarded), so importing here
 * never performs a fetch.
 *
 * Root vitest config runs with `globals: true` and `sourceType: 'script'` for
 * test files, so the ESM module under test is loaded via dynamic import().
 */

let isFresh;
let parseSha;

beforeAll(async () => {
  ({ isFresh, parseSha } = await import('../../../scripts/assert-deploy-freshness.mjs'));
});

describe('OSE-834 2d — deploy-freshness parseSha', () => {
  test('extracts the short sha from a stamped staging version', () => {
    expect(parseSha('stg-abc1234-20260908')).toBe('abc1234');
  });

  test('returns the sha, not the trailing date segment', () => {
    // 20260908 is hex-shaped but comes after the sha → must not win.
    expect(parseSha('stg-abc1234-20260908')).toBe('abc1234');
  });

  test('placeholder / non-sha versions parse to null', () => {
    expect(parseSha('stg-2026.03.22')).toBeNull();
    expect(parseSha('dev-local')).toBeNull();
    expect(parseSha('unknown')).toBeNull();
    expect(parseSha(null)).toBeNull();
    expect(parseSha('')).toBeNull();
  });
});

describe('OSE-834 2d — deploy-freshness isFresh', () => {
  test('fresh when the deployed sha equals the merge sha', () => {
    expect(isFresh('stg-abc1234-20260908', 'abc1234')).toBe(true);
  });

  test('stale when the deployed sha differs from the merge sha (the OSE-834 defect)', () => {
    expect(isFresh('stg-abc1234-20260908', 'def5678')).toBe(false);
  });

  test('a full 40-char merge sha matches the short deployed sha (prefix, either direction)', () => {
    expect(isFresh('stg-abc1234-20260908', 'abc1234ff00aa11bb22cc33dd44ee55ff6607788')).toBe(true);
  });

  test('the date segment is never mistaken for the sha', () => {
    expect(isFresh('stg-abc1234-20260908', '20260908')).toBe(false);
  });

  test('case-insensitive sha comparison', () => {
    expect(isFresh('stg-ABC1234-20260908', 'abc1234')).toBe(true);
  });

  test('fails closed on placeholder / unknown / empty / null', () => {
    expect(isFresh('stg-2026.03.22', 'abc1234')).toBe(false);
    expect(isFresh('unknown', 'abc1234')).toBe(false);
    expect(isFresh('dev-local', 'abc1234')).toBe(false);
    expect(isFresh('stg-abc1234-20260908', '')).toBe(false);
    expect(isFresh(null, 'abc1234')).toBe(false);
    expect(isFresh('stg-abc1234-20260908', undefined)).toBe(false);
  });
});
