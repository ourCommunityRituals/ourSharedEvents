/**
 * scripts/ci/scan-artifacts-for-secrets.sh (OSE-1470 / OSE-1499).
 *
 * CI runs this right before every upload of Playwright / Bruno results, so an
 * artifact that holds a credential is never uploaded. Behavioral and hermetic:
 * each case builds a temp dir with FAKE values, runs the real script, and
 * checks the exit code and that the output never contains the value.
 */

const { spawnSync, execFileSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'ci', 'scan-artifacts-for-secrets.sh');

// Fake values only. Never a real secret.
const FAKE_ADMIN_KEY = 'fake-admin-key-0123456789abcdef';
const FAKE_CF_SECRET = 'fakecfaccesssecret9876543210'; // pragma: allowlist secret (fake test value)

const HAS_ZIP = spawnSync('zip', ['-v'], { encoding: 'utf-8' }).status === 0;

function run(paths, env = {}) {
  const res = spawnSync('bash', [SCRIPT, ...paths], {
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'artifact-scan-'));
  mkdirSync(join(dir, 'test-results'), { recursive: true });
  mkdirSync(join(dir, 'playwright-report'), { recursive: true });
  writeFileSync(join(dir, 'test-results', 'results.json'), '{"status":"passed"}\n');
  writeFileSync(join(dir, 'playwright-report', 'index.html'), '<html>ok</html>\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const paths = () => [join(dir, 'test-results'), join(dir, 'playwright-report')];
const secrets = { ADMIN_KEY: FAKE_ADMIN_KEY, CF_ACCESS_CLIENT_SECRET: FAKE_CF_SECRET };

describe('scan-artifacts-for-secrets.sh', () => {
  test('clean files → exit 0', () => {
    const r = run(paths(), secrets);
    expect(r.code).toBe(0);
    expect(r.out).toContain('clean');
  });

  test('missing paths → exit 0 (nothing to upload either)', () => {
    const r = run([join(dir, 'nope')], secrets);
    expect(r.code).toBe(0);
  });

  test('no paths → usage error', () => {
    expect(run([], secrets).code).toBe(2);
  });

  test('planted secret value → exit 1, names file + var, never prints the value', () => {
    const f = join(dir, 'test-results', 'trace.network');
    writeFileSync(
      f,
      `{"headers":[{"name":"cf-access-client-secret","value":"${FAKE_CF_SECRET}"}]}`
    );
    const r = run(paths(), secrets);
    expect(r.code).toBe(1);
    expect(r.out).toContain(f);
    expect(r.out).toContain('secret:CF_ACCESS_CLIENT_SECRET');
    expect(r.out).not.toContain(FAKE_CF_SECRET);
    expect(r.out).not.toContain(FAKE_ADMIN_KEY);
  });

  test('a secret value starting with "-" is matched, not parsed as a grep option', () => {
    const dash = '-e-looks-like-an-option-12345';
    writeFileSync(join(dir, 'test-results', 'x.txt'), `token ${dash}\n`);
    const r = run(paths(), { X_OCR_INTERNAL: dash });
    expect(r.code).toBe(1);
    expect(r.out).toContain('secret:X_OCR_INTERNAL');
    expect(r.out).not.toContain(dash);
  });

  test('CF_Authorization cookie → exit 1 without the cookie value', () => {
    writeFileSync(
      join(dir, 'test-results', 'c.txt'),
      'cookie: CF_Authorization=eyJfakejwtvalue.part.sig\n'
    );
    const r = run(paths(), {});
    expect(r.code).toBe(1);
    expect(r.out).toContain('CF_Authorization cookie');
    expect(r.out).not.toContain('eyJfakejwtvalue');
  });

  test('Bearer + 20 token chars → exit 1; a short "Bearer x" is not a hit', () => {
    writeFileSync(join(dir, 'test-results', 'short.txt'), 'Authorization: Bearer x\n');
    expect(run(paths(), {}).code).toBe(0);
    writeFileSync(
      join(dir, 'test-results', 'long.txt'),
      'Authorization: Bearer abcDEF0123456789abcDEF\n'
    );
    const r = run(paths(), {});
    expect(r.code).toBe(1);
    expect(r.out).toContain('Bearer token');
    expect(r.out).not.toContain('abcDEF0123456789abcDEF');
  });

  test('unset or empty secret env vars are ignored', () => {
    const r = run(paths(), { ADMIN_KEY: '', CF_ACCESS_CLIENT_SECRET: '' });
    expect(r.code).toBe(0);
  });

  test.skipIf(!HAS_ZIP)('secret inside a zip (a Playwright trace) → exit 1, origin named', () => {
    const stage = join(dir, 'stage');
    mkdirSync(stage);
    writeFileSync(join(stage, 'trace.network'), `authorization: ${FAKE_ADMIN_KEY}\n`);
    const zip = join(dir, 'test-results', 'trace.zip');
    execFileSync('zip', ['-q', '-j', zip, join(stage, 'trace.network')]);
    rmSync(stage, { recursive: true });
    const r = run(paths(), secrets);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${zip} (inside archive)`);
    expect(r.out).not.toContain(FAKE_ADMIN_KEY);
  });

  test.skipIf(!HAS_ZIP)(
    'secret inside the base64 zip a Playwright HTML report embeds → exit 1',
    () => {
      const stage = join(dir, 'stage');
      mkdirSync(stage);
      writeFileSync(
        join(stage, 'report.json'),
        `{"headers":{"x-ocr-internal":"${FAKE_ADMIN_KEY}"}}`
      );
      const zip = join(dir, 'embedded.zip');
      execFileSync('zip', ['-q', '-j', zip, join(stage, 'report.json')]);
      const b64 = require('fs').readFileSync(zip).toString('base64');
      rmSync(zip);
      rmSync(stage, { recursive: true });
      const html = join(dir, 'playwright-report', 'index.html');
      writeFileSync(
        html,
        `<html><template id="playwrightReportBase64">data:application/zip;base64,${b64}</template></html>\n`
      );
      const r = run(paths(), secrets);
      expect(r.code).toBe(1);
      expect(r.out).toContain(`${html} (inside archive)`);
      expect(r.out).not.toContain(FAKE_ADMIN_KEY);
    }
  );

  // Copilot review on #747: past the depth cap an archive would only be
  // searched as compressed bytes. The scan must refuse rather than pass.
  function nestedZip(levels, payload) {
    const stage = join(dir, 'stage');
    mkdirSync(stage);
    let inner = join(stage, 'note.txt');
    writeFileSync(inner, payload);
    for (let i = 1; i <= levels; i++) {
      const z = join(stage, `level${i}.zip`);
      execFileSync('zip', ['-q', '-j', z, inner]);
      inner = z;
    }
    const out = join(dir, 'test-results', 'nested.zip');
    execFileSync('cp', [inner, out]);
    rmSync(stage, { recursive: true });
    return out;
  }

  test.skipIf(!HAS_ZIP)('an archive nested deeper than the cap fails closed', () => {
    nestedZip(4, 'nothing secret here\n');
    const r = run(paths(), secrets);
    expect(r.code).toBe(1);
    expect(r.out).toContain('nested deeper than 3 levels');
  });

  test.skipIf(!HAS_ZIP)('archives within the cap are opened and pass when clean', () => {
    nestedZip(3, 'nothing secret here\n');
    const r = run(paths(), secrets);
    expect(r.code).toBe(0);
  });

  test('an archive that cannot be opened fails closed', () => {
    writeFileSync(join(dir, 'test-results', 'broken.zip'), 'not a zip at all');
    const r = run(paths(), secrets);
    expect(r.code).toBe(1);
    expect(r.out).toContain('cannot inspect archive');
  });
});
