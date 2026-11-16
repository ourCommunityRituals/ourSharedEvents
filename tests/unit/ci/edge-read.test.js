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
    sent: (headerSent) => ({
      write: (s) => out.push(s),
      appendFile: (_f, s) => summary.push(s),
      headerSent,
    }),
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

describe('edgeOwnRequest', () => {
  const STG = 'https://stg.oursharedevents.com';
  // The three calls T4k recorded on stg (main runs 43668128696 and 43669630533).
  const SEEN = [
    `${STG}/cdn-cgi/challenge-platform/h/b/scripts/jsd/f8df4d4a0cd6/main.js?ray=a5ab5a23eafc510d`,
    `${STG}/cdn-cgi/challenge-platform/h/b/jsd/oneshot/f8df4d4a0cd6/0.42:1794712223:abc/a5ab5a23eafc510d`,
    `${STG}/cdn-cgi/rum?`,
  ];

  test('the calls the stg edge was seen to add are its own', () => {
    for (const url of SEEN) expect(E.edgeOwnRequest(url, STG), url).toBe(true);
    expect(E.edgeOwnRequest(`${STG}/cdn-cgi/rum/`, STG)).toBe(true);
  });

  test('no route the Worker serves is ever the edge', () => {
    for (const path of [
      '/',
      '/?area=872664405ffffff',
      '/events/map-zoom-c',
      '/e/MZPANB',
      '/s/mzPub1',
      '/q/abc',
      '/api/v2/events/map',
      '/api/v2/track',
      // The words in a query or deeper in a path do not make it the edge's.
      '/api/v2/track?to=/cdn-cgi/rum',
      '/events/cdn-cgi/rum',
      '/x/cdn-cgi/challenge-platform/h/b/jsd/oneshot/1',
    ]) {
      expect(E.edgeOwnRequest(`${STG}${path}`, STG), path).toBe(false);
    }
  });

  test('only the listed paths under /cdn-cgi/, not the whole of it', () => {
    for (const path of [
      '/cdn-cgi/',
      '/cdn-cgi/trace',
      '/cdn-cgi/image/width=80/a.png',
      '/cdn-cgi/l/email-protection',
      '/cdn-cgi/rumour',
      '/cdn-cgi/rum/extra',
      '/cdn-cgi/challenge-platform',
    ]) {
      expect(E.edgeOwnRequest(`${STG}${path}`, STG), path).toBe(false);
    }
  });

  test('a path that climbs out of the edge folder is judged where it lands', () => {
    expect(E.edgeOwnRequest(`${STG}/cdn-cgi/challenge-platform/../../api/v2/track`, STG)).toBe(
      false
    );
    expect(E.edgeOwnRequest(`${STG}/cdn-cgi/challenge-platform/%2e%2e/%2e%2e/q/abc`, STG)).toBe(
      false
    );
  });

  test('the same path on another host is a request that left the site', () => {
    for (const url of SEEN) {
      const elsewhere = url.replace(STG, 'https://collect.example');
      expect(E.edgeOwnRequest(elsewhere, STG), elsewhere).toBe(false);
    }
    expect(E.edgeOwnRequest('https://other.stg.oursharedevents.com/cdn-cgi/rum', STG)).toBe(false);
    expect(E.edgeOwnRequest('http://stg.oursharedevents.com/cdn-cgi/rum', STG)).toBe(false);
  });

  test('not a URL: not the edge', () => {
    for (const bad of ['', 'cdn-cgi/rum', '/cdn-cgi/rum', undefined, null]) {
      expect(E.edgeOwnRequest(bad, STG)).toBe(false);
    }
  });
});

describe('noteEdgeChallenge', () => {
  test('not strict: writes a GitHub warning and a summary line, and does not throw', () => {
    const c = capture();
    const env = { OCR_CI_EDGE_TOKEN: TOKEN, GITHUB_STEP_SUMMARY: '/tmp/summary' };
    const message = E.noteEdgeChallenge('/brands/root/calendar.ics', env, c.sent(true));
    expect(message).toContain('/brands/root/calendar.ics');
    expect(c.out.join('')).toMatch(/^::warning title=Edge challenge \(OSE-2022\)::/);
    expect(c.out.join('')).toContain('(with X-OCR-CI)');
    expect(message).toContain('The skip rule must cover the path');
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

  // A set token is not a sent header. T4g's page navigation sent none, and its
  // warning still read "(with X-OCR-CI)" (main run 43643594754, job 132605565745).
  // Born red (2026-11-16): with sentWords() answering from the token alone, as
  // before, the first two tests here fail.
  test('token set, header not sent: says so, and never "with X-OCR-CI"', () => {
    const c = capture();
    const env = { OCR_CI_EDGE_TOKEN: TOKEN, GITHUB_STEP_SUMMARY: '/tmp/summary' };
    const message = E.noteEdgeChallenge('/events/evt_1/a-slug', env, c.sent(false));
    const written = message + c.out.join('') + c.summary.join('');
    expect(written).not.toContain('with X-OCR-CI');
    expect(message).toContain('(without X-OCR-CI (the token is set; this read did not send it))');
    expect(c.summary.join('')).toContain('without X-OCR-CI (the token is set');
    expect(message).toContain('The read must send the header');
    expect(message).not.toContain('The skip rule must cover the path');
  });

  test('token set, caller silent: claims neither', () => {
    const c = capture();
    const message = E.noteEdgeChallenge('/x', { OCR_CI_EDGE_TOKEN: TOKEN }, c.deps);
    expect(message).not.toMatch(/with X-OCR-CI|without X-OCR-CI/);
    expect(message).toContain('the caller did not say whether this read sent X-OCR-CI');
  });

  test('no token: without, whatever the caller left unsaid', () => {
    for (const headerSent of [undefined, false]) {
      const c = capture();
      const message = E.noteEdgeChallenge('/x', {}, c.sent(headerSent));
      expect(message).toContain('(without X-OCR-CI (no token set))');
    }
  });

  test('strict throws whatever was sent', () => {
    for (const headerSent of [true, false, undefined]) {
      const c = capture();
      const env = { CALENDAR_EDGE_STRICT: '1', OCR_CI_EDGE_TOKEN: TOKEN };
      expect(() => E.noteEdgeChallenge('/x', env, c.sent(headerSent))).toThrow(
        /CALENDAR_EDGE_STRICT=1/
      );
    }
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
