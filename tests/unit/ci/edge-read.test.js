// vitest globals: true (vitest.config.ts). OSE-2022: a challenged staging read is
// counted and shown, and fails only when the owner has turned the strict switch on.
let E;
beforeAll(async () => {
  E = await import('../../../scripts/ci/edge-read.mjs');
});

const TOKEN = 'ci-edge-token-0123456789abcdef';

function capture() {
  const out = [];
  const summary = [];
  return {
    out,
    summary,
    deps: { write: (s) => out.push(s), appendFile: (_f, s) => summary.push(s) },
  };
}

describe('edgeHeaders', () => {
  test('sends X-OCR-CI only when the token is set', () => {
    expect(E.edgeHeaders({ OCR_CI_EDGE_TOKEN: TOKEN })).toEqual({ 'X-OCR-CI': TOKEN });
    expect(E.edgeHeaders({})).toEqual({});
    expect(E.edgeHeaders({ OCR_CI_EDGE_TOKEN: '' })).toEqual({});
  });
});

describe('edgeChallenged', () => {
  test('is the edge answer only: 403 with cf-mitigated', () => {
    expect(E.edgeChallenged(403, { 'cf-mitigated': 'challenge' })).toBe(true);
    // A 403 the Worker wrote has no cf-mitigated header: that is a real failure.
    expect(E.edgeChallenged(403, {})).toBe(false);
    expect(E.edgeChallenged(403, { 'cf-mitigated': '  ' })).toBe(false);
    expect(E.edgeChallenged(200, { 'cf-mitigated': 'challenge' })).toBe(false);
    expect(E.edgeChallenged(404, {})).toBe(false);
    expect(E.edgeChallenged(403, undefined)).toBe(false);
  });
});

describe('noteEdgeChallenge', () => {
  test('not strict: writes a GitHub warning and a summary line, and does not throw', () => {
    const c = capture();
    const env = { OCR_CI_EDGE_TOKEN: TOKEN, GITHUB_STEP_SUMMARY: '/tmp/summary' };
    const message = E.noteEdgeChallenge('/brands/root/calendar.ics', env, c.deps);
    expect(message).toContain('/brands/root/calendar.ics');
    expect(c.out.join('')).toMatch(/^::warning title=Edge challenge \(OSE-2022\)::/);
    expect(c.out.join('')).toContain('with X-OCR-CI');
    expect(c.summary.join('')).toContain('`/brands/root/calendar.ics` did not reach the Worker');
  });

  test('strict: the same record, then it throws so the test fails', () => {
    const c = capture();
    const env = { CALENDAR_EDGE_STRICT: '1', GITHUB_STEP_SUMMARY: '/tmp/summary' };
    expect(() => E.noteEdgeChallenge('/brands/root/calendar.ics', env, c.deps)).toThrow(
      /CALENDAR_EDGE_STRICT=1/
    );
    expect(c.out).toHaveLength(1);
    expect(c.summary).toHaveLength(1);
    expect(c.out.join('')).toContain('without X-OCR-CI');
  });

  test('only the exact value 1 is strict', () => {
    for (const v of ['', '0', 'true', 'yes', ' 1']) {
      const c = capture();
      expect(() => E.noteEdgeChallenge('/x', { CALENDAR_EDGE_STRICT: v }, c.deps)).not.toThrow();
    }
  });

  test('the token never appears in what is written', () => {
    const c = capture();
    const env = { OCR_CI_EDGE_TOKEN: TOKEN, GITHUB_STEP_SUMMARY: '/tmp/summary' };
    const message = E.noteEdgeChallenge('/brands/root/calendar.ics', env, c.deps);
    expect(message + c.out.join('') + c.summary.join('')).not.toContain(TOKEN);
  });

  test('a path cannot inject a workflow command or a table cell', () => {
    const c = capture();
    E.noteEdgeChallenge('/x\n::error::boom|`y`', {}, c.deps);
    const written = c.out.join('');
    expect(written.split('\n').filter(Boolean)).toHaveLength(1);
    expect(written).not.toContain('::error::');
    expect(written).not.toContain('`y`');
  });

  test('no summary file: nothing is appended', () => {
    const c = capture();
    E.noteEdgeChallenge('/x', {}, c.deps);
    expect(c.summary).toHaveLength(0);
  });
});
