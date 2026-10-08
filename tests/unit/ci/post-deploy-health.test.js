/**
 * The post-deploy health signal: pure rules, tested on made-up readings.
 *
 * `scripts/ci/post-deploy-health.mjs` reads /health after a production deploy
 * and turns the readings into one of three answers: healthy, keep watching,
 * roll back. It never rolls anything back; the answer is an instruction to the
 * operator and a failing check. The thresholds are asserted here by number, so
 * changing one is a visible change to this file.
 */

let h;

beforeAll(async () => {
  h = await import('../../../scripts/ci/post-deploy-health.mjs');
});

const good = (over = {}) => ({
  status: 200,
  body: { ok: true, env: 'production', db: 'ok', version: 'prod-abc1234-20261024', ...over },
});
const bad = (status = 503) => ({ status, body: { ok: false, db: 'error' } });
const blocked = () => ({ status: 403, body: null });
const opts = { expectedEnv: 'production' };
/** g = good, b = bad, x = blocked (something in front of the Worker answered). */
const seq = (pattern) =>
  [...pattern].map((c) => (c === 'g' ? good() : c === 'x' ? blocked() : bad()));

describe('the thresholds, written down', () => {
  test('are the numbers the runbook states', () => {
    expect(h.THRESHOLDS).toEqual({
      ROLL_BACK_AFTER_BAD_IN_A_ROW: 3,
      HEALTHY_AFTER_GOOD_IN_A_ROW: 5,
      MAX_READINGS: 12,
      SECONDS_BETWEEN_READINGS: 10,
      REQUEST_TIMEOUT_SECONDS: 10,
    });
  });
});

describe('one reading', () => {
  test('good: 200, ok, database ok, the expected environment', () => {
    expect(h.judgeReading(good(), opts)).toEqual({ good: true, blocked: false, why: 'good' });
  });

  test.each([
    ['a redirect to a sign-in page', { status: 302, body: null }, 'HTTP 302'],
    ['a 403 from bot protection', { status: 403, body: null }, 'HTTP 403'],
    ['a 401', { status: 401, body: { error: 'unauthorized' } }, 'HTTP 401'],
    ['a 429', { status: 429, body: null }, 'HTTP 429'],
    ['200 with a page that is not JSON', { status: 200, body: null }, 'not JSON'],
  ])('blocked, not bad: %s (the Worker never sends that from /health)', (_name, reading, why) => {
    const r = h.judgeReading(reading, opts);
    expect(r.good).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.why).toContain(why);
  });

  test.each([
    ['no answer at all', { error: 'TimeoutError' }, 'no answer'],
    ['a 503', bad(503), 'HTTP 503'],
    ['a 500', bad(500), 'HTTP 500'],
    ['a 500 with an error page (the Worker threw)', { status: 500, body: null }, 'HTTP 500'],
    ['ok is false', good({ ok: false }), 'ok is not true'],
    ['ok is the string "true"', good({ ok: 'true' }), 'ok is not true'],
    ['the database errors', good({ db: 'error' }), 'db is "error"'],
    [
      'no database is bound (the Worker still says ok)',
      good({ db: 'not_configured' }),
      'db is "not_configured"',
    ],
    ['the wrong environment answered', good({ env: 'staging' }), 'env is "staging"'],
  ])('bad: %s', (_name, reading, why) => {
    const r = h.judgeReading(reading, opts);
    expect(r.good).toBe(false);
    expect(r.blocked).toBe(false);
    expect(r.why).toContain(why);
  });

  test('the environment is only checked when one is expected', () => {
    expect(h.judgeReading(good({ env: 'staging' }), {}).good).toBe(true);
  });
});

describe('a run of readings', () => {
  test.each([
    ['', 'keep watching'],
    ['g', 'keep watching'],
    ['gggg', 'keep watching'],
    ['ggggg', 'healthy'],
    ['bggggg', 'healthy'],
    ['bbggggg', 'healthy'],
    ['gbgbg', 'keep watching'],
    ['ggggb', 'keep watching'],
    ['bb', 'keep watching'],
    ['bbb', 'roll back'],
    ['ggbbb', 'roll back'],
    ['gbbbggggg', 'roll back'],
    ['gbgbgbgbgbg', 'keep watching'],
    ['gbgbgbgbgbgb', 'roll back'],
    ['bggggbgggggg', 'healthy'],
    // blocked readings: no information about the build
    ['xxx', 'keep watching'],
    ['xxxxxxxxxxx', 'keep watching'],
    ['ggxgg', 'keep watching'],
    ['ggggxggggg', 'healthy'],
    ['bxbb', 'roll back'],
    ['bbxgb', 'keep watching'],
    ['bxxxxxxxxxxb', 'keep watching'],
    ['bgbgbgbxbgbg', 'roll back'],
  ])('%s is "%s"', (pattern, verdict) => {
    expect(h.healthSignal(seq(pattern), opts).verdict).toBe(verdict);
  });

  test('twelve blocked readings: still "keep watching", marked blind, never "roll back"', () => {
    const r = h.healthSignal(seq('xxxxxxxxxxxx'), opts);
    expect(r).toMatchObject({ verdict: 'keep watching', blind: true });
    expect(r.reason).toContain('12 of 12 readings never reached the Worker');
    expect(r.reason).toContain('HTTP 403');
  });

  test('blind only at the end, and only when blocked readings are at least as many as bad ones', () => {
    expect(h.healthSignal(seq('xxxxxxxxxxx'), opts).blind).toBeUndefined();
    expect(h.healthSignal(seq('bgbgbgxxxxxx'), opts)).toMatchObject({
      verdict: 'keep watching',
      blind: true,
    });
    expect(h.healthSignal(seq('bgbgbgbgxxxg'), opts).verdict).toBe('roll back');
  });

  test('roll back says why, in words', () => {
    const r = h.healthSignal(seq('gbbb'), opts);
    expect(r.reason).toContain('3 bad readings in a row');
    expect(r.reason).toContain('HTTP 503');
  });

  test('not settling says how many readings and how many were bad', () => {
    const r = h.healthSignal(seq('gbgbgbgbgbgb'), opts);
    expect(r.reason).toContain('12 readings');
    expect(r.reason).toContain('6 bad');
  });

  test('keep watching says how far along it is', () => {
    expect(h.healthSignal(seq('bgg'), opts).reason).toContain('2 good in a row');
  });

  test('three bad in a row is never forgiven by later good readings', () => {
    expect(h.healthSignal(seq('bbbgggggggg'), opts).verdict).toBe('roll back');
  });

  test('a wrong environment on every reading is a roll back, not healthy', () => {
    const readings = [good({ env: 'staging' }), good({ env: 'staging' }), good({ env: 'staging' })];
    expect(h.healthSignal(readings, opts).verdict).toBe('roll back');
  });
});

describe('is this the build that was deployed', () => {
  const want = { prefix: 'prod', sha: 'abc1234' };

  test.each([
    ['prod-abc1234-20261024', true],
    ['PROD-ABC1234-20261024', true],
    ['prod-abc1234def-20261024', true], // the stamp used a longer short id for the same commit
    ['prod-def5678-20261024', false], // another commit
    ['stg-abc1234-20261024', false], // staging's stamp
    ['main', false], // what production reported before the stamp was mended
    ['prod-2026.03.22', false], // the placeholder in wrangler.toml
    ['prod-abc1234', false], // no date
    ['prod-abc1234-2026', false], // not a date
    ['prod-20261024-20261024', false], // a date where the commit id should be
    ['unknown', false],
    ['', false],
    [undefined, false],
  ])('%s -> %s', (version, expected) => {
    expect(h.isThisBuild(version, want)).toBe(expected);
  });

  test('a full-length commit id matches its short stamp', () => {
    expect(
      h.isThisBuild('prod-abc1234-20261024', { prefix: 'prod', sha: `abc1234${'0'.repeat(33)}` })
    ).toBe(true);
  });

  test('no commit id to compare with is never a match', () => {
    expect(h.isThisBuild('prod-abc1234-20261024', { prefix: 'prod', sha: '' })).toBe(false);
  });
});

describe('the final answer and what the operator is told', () => {
  const build = { prefix: 'prod', sha: 'abc1234', expectedEnv: 'production' };

  test('healthy and the right build: HEALTHY, exit 0', () => {
    const r = h.decide(seq('ggggg'), build);
    expect(r.verdict).toBe('HEALTHY');
    expect(r.exitCode).toBe(0);
    expect(r.done).toBe(true);
  });

  test('healthy but another build: WRONG BUILD, exit 1, and it says not to roll back', () => {
    const readings = Array.from({ length: 5 }, () => good({ version: 'main' }));
    const r = h.decide(readings, build);
    expect(r.verdict).toBe('WRONG BUILD');
    expect(r.exitCode).toBe(1);
    expect(r.message).toContain('"main"');
    expect(r.message).toContain('abc1234');
    expect(r.message).toContain('Do not roll back');
  });

  test('roll back: ROLL BACK, exit 1, pointing at the rollback runbook', () => {
    const r = h.decide(seq('bbb'), build);
    expect(r.verdict).toBe('ROLL BACK');
    expect(r.exitCode).toBe(1);
    expect(r.done).toBe(true);
    expect(r.message).toContain('docs/runbooks/ROLLBACK.md');
    expect(r.message).toContain('Nothing was rolled back');
  });

  test('could not see the Worker: CANNOT SEE, exit 1, and it says not to roll back on that alone', () => {
    const r = h.decide(seq('xxxxxxxxxxxx'), build);
    expect(r.verdict).toBe('CANNOT SEE');
    expect(r.exitCode).toBe(1);
    expect(r.done).toBe(true);
    expect(r.message).toContain('This says nothing about the build');
    expect(r.message).toContain('do not roll back on this alone');
    expect(r.message).not.toContain('ROLL BACK');
  });

  test('still watching: not done, no exit code yet', () => {
    const r = h.decide(seq('gg'), build);
    expect(r.verdict).toBe('KEEP WATCHING');
    expect(r.done).toBe(false);
  });
});
