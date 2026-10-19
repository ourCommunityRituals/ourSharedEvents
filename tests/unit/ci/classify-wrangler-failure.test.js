/**
 * The "required secrets present" gate must not read a Cloudflare failure as a
 * missing secret (OSE-1731, found during OSE-1730).
 *
 * Seen red: against the old workflow (`... 2>&1 || true`) the YAML cases fail, and
 * with no script the behaviour cases fail. A rejected token (code 10000) used to
 * print "<SECRET> is not set ... Provision it: bash scripts/set-secrets.sh".
 */
const { spawnSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'classify-wrangler-failure.sh');
const GATE = 'Gate: required secrets present (pre-migrate, fail-closed corner) (OSE-1343)';

// Built at run time so no secret-shaped literal sits in the file (the committed-secret gate).
const FAKE_ACCOUNT_ID = ['0123', '4567', '89ab', 'cdef'].join('').repeat(2);
const AUTH_OUT = [
  `✘ [ERROR] A request to the Cloudflare API (/accounts/${FAKE_ACCOUNT_ID}/workers/scripts/oursharedevents-stg/secrets) failed.`,
  '  Authentication error [code: 10000]',
  '✘ [ERROR] A request to the Cloudflare API (/accounts) failed.',
  '  Invalid access token [code: 9109]',
].join('\n');

function run(rc, out, env = 'staging') {
  const r = spawnSync('bash', [SCRIPT, String(rc), out, env], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('classify-wrangler-failure.sh', () => {
  test('exists', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  test('wrangler success prints nothing and exits 0', () => {
    const r = run(0, '[{"name":"FORMS_HASH_PEPPER","type":"secret_text"}]');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  test('a rejected token is an authentication failure, not a missing secret', () => {
    const r = run(1, AUTH_OUT);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/::error::Cloudflare authentication failure/);
    expect(r.stdout).toMatch(/NOT a missing-secret finding/);
    expect(r.stdout).not.toMatch(/is not set/);
    expect(r.stdout).not.toMatch(/Provision it/);
    // it warns against the key-overwriting script instead of recommending it
    expect(r.stdout).toMatch(/Do NOT run scripts\/set-secrets\.sh/);
  });

  test('the throttle code (10502) is also an authentication failure', () => {
    const r = run(1, 'Too many authentication failures. Please try again later. [code: 10502]');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/authentication failure/);
  });

  test('an unreachable Cloudflare is a network failure', () => {
    const r = run(
      1,
      'TypeError: fetch failed\n  cause: Error: getaddrinfo ENOTFOUND api.cloudflare.com'
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/::error::Cloudflare network failure/);
    expect(r.stdout).not.toMatch(/is not set/);
  });

  test('any other wrangler failure still fails closed and is labelled', () => {
    const r = run(7, 'something unexpected');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/::error::Cloudflare failure/);
    expect(r.stdout).toMatch(/wrangler exit 7/);
    expect(r.stdout).toMatch(/NOT a missing-secret finding/);
  });

  test('names the environment it checked', () => {
    expect(run(1, AUTH_OUT, 'production').stdout).toMatch(/on production \(wrangler exit 1\)/);
  });

  test('never repeats a header line or a token-like run', () => {
    const secret = ['abcdefghij', 'klmnopqrst', 'uvwxyz0123', '456789ABCD'].join('');
    const r = run(
      1,
      [
        `Authorization: Bearer ${secret}`,
        `token=${secret}`,
        'Authentication error [code: 10000]',
      ].join('\n')
    );
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout).not.toMatch(/Bearer/i);
    expect(r.stdout).toMatch(/Authentication error \[code: 10000\]/);
  });

  test('masks a 32-character account id inside a request path', () => {
    expect(run(1, AUTH_OUT).stdout).not.toContain(FAKE_ACCOUNT_ID);
  });

  test('refuses a missing or non-numeric exit code', () => {
    expect(run('x', AUTH_OUT).status).toBe(2);
  });
});

describe('the two secrets gates call it and do not swallow the exit code', () => {
  const yaml = require('js-yaml');
  const workflow = yaml.load(
    readFileSync(join(ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'), 'utf8')
  );
  const gate = (job) => workflow.jobs[job].steps.find((s) => s.name === GATE);

  for (const [job, env] of [
    ['deploy-staging', 'staging'],
    ['deploy-production', 'production'],
  ]) {
    test(`${job}: no "|| true" on the secret list`, () => {
      const run = gate(job)?.run ?? '';
      expect(run).toContain(`npx wrangler secret list --env ${env}`);
      expect(run).not.toMatch(/secret list[^\n]*\|\|\s*true/);
    });

    test(`${job}: classifies a wrangler failure before it checks any name`, () => {
      const run = gate(job)?.run ?? '';
      expect(run).toMatch(/&& RC=0 \|\| RC=\$\?/);
      const call = run.indexOf(`classify-wrangler-failure.sh "$RC" "$OUT" ${env}`);
      const firstLoop = run.indexOf('for SECRET in');
      expect(call).toBeGreaterThan(-1);
      expect(firstLoop).toBeGreaterThan(call);
    });
  }
});
