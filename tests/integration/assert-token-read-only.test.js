/**
 * scripts/ci/assert-token-read-only.sh (OSE-1466 item 0.6).
 *
 * The runtime half of "a PR job's token cannot push, comment or open issues".
 * Hermetic: a stub `curl` on PATH answers each probe with a chosen status, so
 * no request leaves the machine. The real statuses were read once against
 * GitHub (see the script header) and are proven again by the CI step itself.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync, rmSync, chmodSync, readFileSync } = require('fs');
const { tmpdir } = require('os');
const { join, delimiter } = require('path');

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'assert-token-read-only.sh');
const posix = (p) => p.replace(/\\/g, '/');

// Fake value only. Never a real secret.
const FAKE_TOKEN = 'fake-job-token-0123456789'; // pragma: allowlist secret (fake test value)

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'token-ro-'));
  // Picks the status by URL, records its argv and stdin so the tests can check
  // where the token went.
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
      '  *) code=599 ;;',
      'esac',
      '[ "$code" = "fail" ] && exit 7',
      'printf "%s" "$code"',
      '',
    ].join('\n')
  );
  chmodSync(join(dir, 'curl'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run({ issue = '403', comment = '403', push = '403', env = {} } = {}) {
  const res = spawnSync('bash', [posix(SCRIPT)], {
    encoding: 'utf-8',
    env: {
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      HOME: process.env.HOME,
      GH_TOKEN: FAKE_TOKEN,
      GITHUB_REPOSITORY: 'example/repo',
      PROBE_ISSUE: '12',
      STUB_LOG: posix(join(dir, 'log')),
      STUB_ISSUE: issue,
      STUB_COMMENT: comment,
      STUB_PUSH: push,
      ...env,
    },
  });
  const read = (f) => {
    try {
      return readFileSync(join(dir, f), 'utf-8');
    } catch {
      return '';
    }
  };
  return {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    argv: read('log.argv'),
    stdin: read('log.stdin'),
  };
}

// Each case spawns bash and a stub several times; slow on a loaded Windows machine.
describe('assert-token-read-only.sh', { timeout: 30_000 }, () => {
  test('passes when all three writes are refused', () => {
    const r = run();
    expect(r.out.match(/refused \(403\)/g)).toHaveLength(3);
    expect(r.code).toBe(0);
  });

  test.each([
    ['open an issue', { issue: '422' }],
    ['comment', { comment: '422' }],
    ['push', { push: '200' }],
  ])('fails when the token could %s', (_label, statuses) => {
    const r = run(statuses);
    expect(r.code).toBe(1);
    expect(r.out).toContain('job token can write');
  });

  test.each(['201', '404', '401', '500', 'fail'])(
    'only 403 passes: a %s answer fails (an outage is not "safe")',
    (status) => {
      expect(run({ issue: status }).code).toBe(1);
    }
  );

  test('all three probes run even when the first fails', () => {
    const r = run({ issue: '422' });
    expect(r.argv.trim().split('\n')).toHaveLength(3);
  });

  test('probes the given issue number and the receive-pack refs', () => {
    const r = run();
    expect(r.argv).toContain('/repos/example/repo/issues/12/comments');
    expect(r.argv).toContain('example/repo.git/info/refs?service=git-receive-pack');
  });

  test('the token goes to curl on stdin, never on the command line or in output', () => {
    const r = run({ issue: '422' });
    expect(r.stdin).toContain(FAKE_TOKEN);
    expect(r.argv).not.toContain(FAKE_TOKEN);
    expect(r.out).not.toContain(FAKE_TOKEN);
  });

  test('a non-numeric issue number is refused before any request', () => {
    const r = run({ env: { PROBE_ISSUE: '1/../../pulls' } });
    expect(r.code).toBe(2);
    expect(r.argv).toBe('');
  });

  test('a missing token is an error, not a pass', () => {
    expect(run({ env: { GH_TOKEN: '' } }).code).not.toBe(0);
  });
});
