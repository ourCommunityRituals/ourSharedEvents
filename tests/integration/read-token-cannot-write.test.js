/**
 * The hub read token cannot write (OSE-1695).
 *
 * scripts/ci/assert-token-read-only.sh asks GitHub what a token is allowed to do. It is the only
 * thing that can tell a read-only token from one that quietly gained write access, so this file
 * attacks it from three sides:
 *
 *   1. THE MATRIX. Every way the four answers (can it read, may it open an issue, may it comment,
 *      may it push) can combine, checked against one plain oracle: the token is safe only if it
 *      can read AND every write is refused with 403. Anything else, including an outage, must fail.
 *   2. REAL TOKENS. Named profiles of the tokens that actually occur (classic PAT, fine-grained
 *      with one write permission, revoked, SSO-blocked, rate-limited...), with the verdict each
 *      must get.
 *   3. MUTANTS. The script itself is mutated one defect at a time (accept 401, drop a probe, let
 *      the read check pass anything...). The suite must catch every mutant. A mutant that
 *      survives means the probe could go soft without anyone noticing.
 *
 * Hermetic: a stub `curl` on PATH answers by URL, so no request leaves the machine and no real
 * token is ever needed. The statuses were read once against GitHub (see the script header).
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync, rmSync, chmodSync, readFileSync } = require('fs');
const { tmpdir } = require('os');
const { join, delimiter } = require('path');

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'assert-token-read-only.sh');
const SOURCE = readFileSync(SCRIPT, 'utf-8').replace(/\r\n/g, '\n');
const posix = (p) => p.replace(/\\/g, '/');

// Fake value only. Never a real secret.
const FAKE_TOKEN = 'fake-hub-read-token-9f8e7d6c5b4a'; // pragma: allowlist secret (fake test value)
const HUB = 'ourCommunityRituals/ourCommunityRituals';

let dir;
let seq = 0;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'read-token-'));
  // Answers by URL. A status of "fail" is curl itself failing (network down, timeout).
  writeFileSync(
    join(dir, 'curl'),
    [
      '#!/usr/bin/env bash',
      'printf "%s\\n" "$*" >> "$STUB_LOG.argv"',
      'cat >> "$STUB_LOG.stdin"',
      'url="${@: -1}"',
      'case "$url" in',
      '  *git-receive-pack*) code="$STUB_PUSH" ;;',
      '  */comments) code="$STUB_COMMENT" ;;',
      '  */issues) code="$STUB_ISSUE" ;;',
      '  *) code="$STUB_READ" ;;',
      'esac',
      '[ "$code" = "fail" ] && exit 7',
      'printf "%s" "$code"',
      '',
    ].join('\n')
  );
  chmodSync(join(dir, 'curl'), 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Run a script file against one combination of answers. */
function runProbe(
  scriptPath,
  { read = '200', issue = '403', comment = '403', push = '403', env = {} } = {}
) {
  const log = posix(join(dir, `log-${++seq}`));
  const res = spawnSync('bash', [posix(scriptPath)], {
    encoding: 'utf-8',
    env: {
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      HOME: process.env.HOME,
      GH_TOKEN: FAKE_TOKEN,
      GITHUB_REPOSITORY: 'ourCommunityRituals/ourSharedEvents', // the repo the job runs in, NOT the hub
      PROBE_REPOSITORY: HUB,
      PROBE_REQUIRE_READ: '1',
      PROBE_ISSUE: '60',
      STUB_LOG: log,
      STUB_READ: read,
      STUB_ISSUE: issue,
      STUB_COMMENT: comment,
      STUB_PUSH: push,
      ...env,
    },
  });
  const slurp = (f) => {
    try {
      return readFileSync(f, 'utf-8');
    } catch {
      return '';
    }
  };
  return {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    argv: slurp(`${log}.argv`),
    stdin: slurp(`${log}.stdin`),
  };
}

/** The whole safety rule, stated once and independently of the script. */
const oracle = ({ read = '200', issue = '403', comment = '403', push = '403' }) =>
  read === '200' && issue === '403' && comment === '403' && push === '403' ? 0 : 1;

/** Everything a run must never do, whatever the answers: leak the token, probe the wrong repo. */
function misbehaviour(r) {
  const problems = [];
  if (r.out.includes(FAKE_TOKEN)) problems.push('token printed in output');
  if (r.argv.includes(FAKE_TOKEN)) problems.push('token on a command line');
  if (!r.stdin.includes(FAKE_TOKEN)) problems.push('token never sent to curl on stdin');
  if (r.argv.includes('ourSharedEvents'))
    problems.push('probed the job repository instead of PROBE_REPOSITORY');
  if (!r.argv.includes(HUB)) problems.push('never probed PROBE_REPOSITORY');
  return problems;
}

const WRITE_PROBES = ['issue', 'comment', 'push'];
const NOT_REFUSED = [
  '200',
  '201',
  '204',
  '401',
  '404',
  '409',
  '422',
  '429',
  '500',
  '502',
  '503',
  '000',
  'fail',
];

describe('the matrix: safe only if it can read and every write is refused', () => {
  test('the one safe combination passes', () => {
    const r = runProbe(SCRIPT);
    expect(r.code).toBe(0);
    expect(r.out).toContain('read ' + HUB + ': allowed (200)');
    expect(misbehaviour(r)).toEqual([]);
  });

  // One probe at a time gives a wrong answer, the other three are right.
  describe.each(['read', ...WRITE_PROBES])('only %s misbehaves', (which) => {
    const statuses =
      which === 'read' ? NOT_REFUSED.filter((s) => s !== '200').concat('403') : NOT_REFUSED;
    test.each(statuses)('answered %s', { timeout: 30_000 }, (status) => {
      const answers = { [which]: status };
      const r = runProbe(SCRIPT, answers);
      expect({ answers, exit: r.code }).toEqual({ answers, exit: oracle(answers) });
      expect(misbehaviour(r)).toEqual([]);
    });
  });

  // Every pair of probes failing together, in a representative spread of ways.
  describe('two probes misbehave together', () => {
    const probes = ['read', ...WRITE_PROBES];
    const spread = ['200', '401', '404', '422', '500', 'fail'];
    const cases = [];
    for (let i = 0; i < probes.length; i++) {
      for (let j = i + 1; j < probes.length; j++) {
        for (const a of spread) for (const b of spread) cases.push([probes[i], a, probes[j], b]);
      }
    }
    test.each(cases)('%s=%s and %s=%s', { timeout: 30_000 }, (p1, s1, p2, s2) => {
      const answers = { [p1]: s1, [p2]: s2 };
      const r = runProbe(SCRIPT, answers);
      const eff = { read: '200', issue: '403', comment: '403', push: '403', ...answers };
      expect({ answers, exit: r.code }).toEqual({ answers, exit: oracle(eff) });
    });
  });

  test('all four wrong at once fails', () => {
    expect(runProbe(SCRIPT, { read: '500', issue: '200', comment: '200', push: '200' }).code).toBe(
      1
    );
  });

  test('a failing run reports every problem, not just the first', () => {
    const r = runProbe(SCRIPT, { read: '401', issue: '422', comment: '422', push: '200' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('token cannot read');
    expect(r.out).toContain('open an issue: expected 403, got 422');
    expect(r.out).toContain('comment on an issue or pull request: expected 403, got 422');
    expect(r.out).toContain('push: expected 403, got 200');
  });
});

describe('real tokens: the profile each kind of token produces', () => {
  //            name                                       read   issue  comment push   verdict
  const PROFILES = [
    ['fine-grained, read-only (what we want)', '200', '403', '403', '403', 0],
    ['fine-grained, issues:write added', '200', '422', '403', '403', 1],
    ['fine-grained, pull-requests:write added', '200', '403', '422', '403', 1],
    ['fine-grained, contents:write added', '200', '403', '403', '200', 1],
    ['fine-grained, contents + issues write', '200', '422', '422', '200', 1],
    ['classic PAT with the repo scope', '200', '422', '422', '200', 1],
    ['classic PAT, public_repo only, private repo', '404', '404', '404', '404', 1],
    ['revoked or deleted token', '401', '401', '401', '401', 1],
    ['expired token', '401', '401', '401', '401', 1],
    ['token never granted this repository', '404', '404', '404', '404', 1],
    ['organisation SSO not authorised', '403', '403', '403', '403', 1],
    ['rate limited', '429', '429', '429', '429', 1],
    ['secondary rate limit on writes only', '200', '429', '429', '403', 1],
    ['GitHub outage', '503', '503', '503', '503', 1],
    ['bad gateway', '502', '502', '502', '502', 1],
    ['network down (curl fails)', 'fail', 'fail', 'fail', 'fail', 1],
    ['timeout (curl status 000)', '000', '000', '000', '000', 1],
    ['an API change returns 400', '200', '400', '400', '403', 1],
    ['read works, token has no access to the write routes at all', '200', '404', '404', '404', 1],
  ];
  test.each(PROFILES)('%s', { timeout: 30_000 }, (_name, read, issue, comment, push, verdict) => {
    const r = runProbe(SCRIPT, { read, issue, comment, push });
    expect(r.code).toBe(verdict);
    expect(misbehaviour(r)).toEqual([]);
  });

  test('every profile agrees with the oracle (the table cannot drift from the rule)', () => {
    for (const [name, read, issue, comment, push, verdict] of PROFILES) {
      expect({ name, verdict }).toEqual({ name, verdict: oracle({ read, issue, comment, push }) });
    }
  });
});

describe('usage', () => {
  test('without PROBE_REQUIRE_READ the read check is skipped and the old behaviour holds', () => {
    const r = runProbe(SCRIPT, { read: '500', env: { PROBE_REQUIRE_READ: '' } });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('read ' + HUB);
  });

  test('PROBE_REQUIRE_READ must be exactly 1: yes, true and 0 do not switch it on', () => {
    for (const v of ['yes', 'true', '0']) {
      const r = runProbe(SCRIPT, { read: '500', env: { PROBE_REQUIRE_READ: v } });
      expect({ v, exit: r.code }).toEqual({ v, exit: 0 });
    }
  });

  test('with no repository at all it stops with a usage error, never a pass', () => {
    const r = runProbe(SCRIPT, { env: { GITHUB_REPOSITORY: '', PROBE_REPOSITORY: '' } });
    expect(r.code).not.toBe(0);
  });

  test('the job repository is used when PROBE_REPOSITORY is not set', () => {
    const r = runProbe(SCRIPT, { env: { PROBE_REPOSITORY: '' } });
    expect(r.code).toBe(0);
    expect(r.argv).toContain('ourSharedEvents');
    expect(r.argv).not.toContain(HUB);
  });

  test('an empty PROBE_ISSUE falls back to issue 1 and still probes', () => {
    const r = runProbe(SCRIPT, { env: { PROBE_ISSUE: '' } });
    expect(r.code).toBe(0);
    expect(r.argv).toContain('/issues/1/comments');
  });

  test('a PROBE_ISSUE that is not a number stops with exit 2', () => {
    for (const bad of ['abc', '1; rm -rf /', '$(id)', '12a']) {
      const r = runProbe(SCRIPT, { env: { PROBE_ISSUE: bad } });
      expect({ bad, exit: r.code }).toEqual({ bad, exit: 2 });
    }
  });
});

describe('mutants: the suite must notice when the probe itself goes soft', () => {
  /**
   * Each mutant is the real script with exactly one defect. `find` must occur in the script,
   * so a mutant cannot silently become a no-op when the script is reworded.
   */
  const MUTANTS = [
    ['accepts any 4xx as a refusal', '[ "$code" = "403" ]', '[ "${code:0:1}" = "4" ]'],
    [
      'accepts 401 (a dead token) as a refusal',
      '[ "$code" = "403" ]',
      '[ "$code" = "403" ] || [ "$code" = "401" ]',
    ],
    [
      'accepts 404 (no access) as a refusal',
      '[ "$code" = "403" ]',
      '[ "$code" = "403" ] || [ "$code" = "404" ]',
    ],
    [
      'accepts 422 (would have been allowed) as a refusal',
      '[ "$code" = "403" ]',
      '[ "$code" = "403" ] || [ "$code" = "422" ]',
    ],
    [
      'accepts a 5xx outage as a refusal',
      '[ "$code" = "403" ]',
      '[ "$code" = "403" ] || [ "${code:0:1}" = "5" ]',
    ],
    ['treats curl failing as a refusal', '|| code="000"', '|| code="403"'],
    ['never probes issue creation', "probe 'open an issue'", ": # probe 'open an issue'"],
    ['never probes commenting', "probe 'comment on an issue or pull request'", ': # probe comment'],
    ['never probes push', "probe 'push'", ': # probe push'],
    ['the read check never fails the run', '    status=1\n  fi\nfi', '    status=0\n  fi\nfi'],
    ['the read check accepts any answer', '[ "$read_code" = "200" ]', '[ -n "$read_code" ]'],
    [
      'the read check accepts any 2xx or 3xx',
      '[ "$read_code" = "200" ]',
      '[ "${read_code:0:1}" = "2" ] || [ "${read_code:0:1}" = "3" ]',
    ],
    [
      'the read check is never switched on',
      '[ "${PROBE_REQUIRE_READ:-}" = "1" ]',
      '[ "${PROBE_REQUIRE_READ:-}" = "never" ]',
    ],
    [
      'the read check is always on, even when not asked',
      '[ "${PROBE_REQUIRE_READ:-}" = "1" ]',
      '[ -z "never" ]',
    ],
    [
      'a curl failure on the read check counts as success',
      '|| read_code="000"',
      '|| read_code="200"',
    ],
    ['the run always exits 0', 'exit "$status"', 'exit 0'],
    [
      'PROBE_REPOSITORY is ignored',
      'REPO="${PROBE_REPOSITORY:-${GITHUB_REPOSITORY:-}}"',
      'REPO="${GITHUB_REPOSITORY:-}"',
    ],
    [
      'the push probe goes to the job repository',
      '$SERVER/$REPO.git',
      '$SERVER/${GITHUB_REPOSITORY}.git',
    ],
    [
      'the issue probe goes to the job repository',
      '"$API/repos/$REPO/issues"',
      '"$API/repos/${GITHUB_REPOSITORY}/issues"',
    ],
    ['the token is printed', 'status=0\n\n# probe', 'status=0\necho "token=$GH_TOKEN"\n\n# probe'],
    [
      'the token goes on the command line',
      'curl -sS -o /dev/null',
      'curl -sS -H "X-Debug: $GH_TOKEN" -o /dev/null',
    ],
    [
      'a later passing probe wipes an earlier failure',
      'refused (403)"',
      'refused (403)"; status=0',
    ],
  ];

  /**
   * A mutant is caught when any run disagrees with the oracle, or misbehaves (leaks the token,
   * probes the wrong repository). These runs cover every kind of defect above.
   */
  const CATCHING_RUNS = [
    {},
    { read: '401' },
    { read: '404' },
    { read: '500' },
    { read: 'fail' },
    { read: '201' },
    { read: '302' },
    { issue: '200' },
    { issue: '401' },
    { issue: '404' },
    { issue: '422' },
    { issue: '500' },
    { issue: 'fail' },
    { comment: '200' },
    { comment: '401' },
    { comment: '404' },
    { comment: '422' },
    { comment: '500' },
    { comment: 'fail' },
    { push: '200' },
    { push: '401' },
    { push: '404' },
    { push: '422' },
    { push: '500' },
    { push: 'fail' },
    { read: '401', issue: '422', comment: '422', push: '200' },
  ];
  const WITHOUT_READ_CHECK = [{ env: { PROBE_REQUIRE_READ: '' }, read: '500' }];

  function caught(scriptPath) {
    const reasons = [];
    for (const answers of CATCHING_RUNS) {
      const r = runProbe(scriptPath, answers);
      const want = oracle(answers);
      if (r.code !== want)
        reasons.push(`${JSON.stringify(answers)} exited ${r.code}, wanted ${want}`);
      for (const p of misbehaviour(r)) reasons.push(`${JSON.stringify(answers)}: ${p}`);
      if (reasons.length) return reasons;
    }
    for (const answers of WITHOUT_READ_CHECK) {
      const r = runProbe(scriptPath, answers);
      if (r.code !== 0) reasons.push(`read check ran although not asked for: exited ${r.code}`);
      if (reasons.length) return reasons;
    }
    return reasons;
  }

  test(
    'the real script survives every one of those runs (the mutants are measured against a clean baseline)',
    { timeout: 120_000 },
    () => {
      expect(caught(SCRIPT)).toEqual([]);
    }
  );

  test.each(MUTANTS)('caught: %s', { timeout: 120_000 }, (_name, find, replace) => {
    expect(SOURCE, `mutation anchor not found in the script: ${find}`).toContain(find);
    const mutated = SOURCE.replace(find, replace);
    expect(mutated).not.toBe(SOURCE);
    const file = join(dir, `mutant-${++seq}.sh`);
    writeFileSync(file, mutated);
    const reasons = caught(file);
    expect(
      reasons.length,
      `MUTANT SURVIVED: "${_name}" passed every check, so the probe could go this soft unnoticed`
    ).toBeGreaterThan(0);
  });
});
