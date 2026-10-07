/**
 * scripts/ci/install-playwright-browsers.sh and the jobs that call it.
 *
 * On 2026-10-07 the runner's Ubuntu mirror served WebKit's system packages
 * (181 packages, 126 MB) at 30-100 kB/s. T0 Gate (component) was cancelled at
 * its 15 minute ceiling and the phone audit timed out, before any test ran.
 *
 * Hermetic: a stub `playwright` and a stub `apt-get` stand in for the real
 * ones, and every path the script touches points into a temp dir. No package
 * is downloaded and nothing needs root. The real mirror, the real apt and the
 * real cache are proven by the CI jobs themselves.
 */

const { spawnSync } = require('child_process');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  readFileSync,
  readdirSync,
  existsSync,
} = require('fs');
const { tmpdir } = require('os');
const { join, delimiter } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const SCRIPT_REL = 'scripts/ci/install-playwright-browsers.sh';
const SCRIPT = join(ROOT, SCRIPT_REL);
const posix = (p) => p.replace(/\\/g, '/');

const MIRRORS = [
  'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1',
  'https://archive.ubuntu.com/ubuntu/\tpriority:2',
  'https://security.ubuntu.com/ubuntu/\tpriority:3',
  '',
].join('\n');

let dir, cache, archives, confDir, mirrors, log;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-install-'));
  cache = join(dir, 'cache');
  archives = join(dir, 'archives');
  confDir = join(dir, 'apt.conf.d');
  mirrors = join(dir, 'apt-mirrors.txt');
  log = join(dir, 'calls.log');
  for (const d of [cache, archives, confDir, join(dir, 'bin')]) mkdirSync(d);
  writeFileSync(mirrors, MIRRORS);

  // Stub playwright. Each call records its arguments, whether the download-only
  // setting was in place, and whether the slow mirror was still listed.
  // `install-deps` is the download: slow while STUB_SLOW_WHILE matches the
  // mirror list, otherwise it "downloads" one package file.
  writeFileSync(
    join(dir, 'playwright'),
    [
      '#!/usr/bin/env bash',
      'conf=absent; [ -f "$PW_APT_CONF_DIR/99-playwright-prefetch" ] && conf=present',
      'slow=dropped; grep -q azure "$PW_APT_MIRRORS_FILE" && slow=listed',
      'printf "%s | prefetch-conf=%s | azure=%s | archives=%s\\n" "$*" "$conf" "$slow" "$(ls "$PW_APT_ARCHIVES_DIR" | tr "\\n" ",")" >> "$STUB_LOG"',
      'if [ "$1" = "install-deps" ]; then',
      '  if [ -n "${STUB_SLOW_WHILE:-}" ] && grep -q "$STUB_SLOW_WHILE" "$PW_APT_MIRRORS_FILE"; then sleep 20; fi',
      '  [ "${STUB_DEPS_EXIT:-0}" = "0" ] || exit "$STUB_DEPS_EXIT"',
      '  : > "$PW_APT_ARCHIVES_DIR/libnew_2.0_amd64.deb"',
      'fi',
      'exit 0',
      '',
    ].join('\n')
  );
  // Stub apt-get: `autoclean` removes the one file named as superseded.
  writeFileSync(
    join(dir, 'bin', 'apt-get'),
    [
      '#!/usr/bin/env bash',
      'printf "apt-get %s\\n" "$*" >> "$STUB_LOG"',
      '[ "$1" = "autoclean" ] && rm -f "$PW_APT_ARCHIVES_DIR/libold_1.0_amd64.deb"',
      'exit 0',
      '',
    ].join('\n')
  );
  chmodSync(join(dir, 'playwright'), 0o755);
  chmodSync(join(dir, 'bin', 'apt-get'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args = ['chromium', 'webkit'], env = {}) {
  const res = spawnSync('bash', [posix(SCRIPT), ...args], {
    encoding: 'utf-8',
    env: {
      PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}`,
      HOME: posix(dir),
      PW_BIN: posix(join(dir, 'playwright')),
      PW_SUDO: '',
      PW_APT_CACHE_DIR: posix(cache),
      PW_APT_ARCHIVES_DIR: posix(archives),
      PW_APT_CONF_DIR: posix(confDir),
      PW_APT_MIRRORS_FILE: posix(mirrors),
      PW_APT_ATTEMPT_SECONDS: '1 10',
      STUB_LOG: posix(log),
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n') : [];
  return { code: res.status, out: `${res.stdout}${res.stderr}`, calls };
}

// Each case spawns bash and waits on a real `timeout`.
describe('install-playwright-browsers.sh', { timeout: 60_000 }, () => {
  test('restores saved package files into the apt cache before anything is downloaded', () => {
    writeFileSync(join(cache, 'libkept_1.0_amd64.deb'), '');
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls[0]).toContain('install-deps chromium webkit');
    expect(r.calls[0]).toContain('libkept_1.0_amd64.deb');
    expect(r.out).toContain('System packages restored from cache: 1');
  });

  test('the limited pass only downloads; the real install runs after, with the setting gone', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      expect.stringMatching(/^install-deps chromium webkit \| prefetch-conf=present /),
      'apt-get autoclean',
      expect.stringMatching(/^install --with-deps chromium webkit \| prefetch-conf=absent /),
    ]);
  });

  test('saves what apt holds after the download and drops files the index no longer lists', () => {
    writeFileSync(join(cache, 'libold_1.0_amd64.deb'), '');
    writeFileSync(join(cache, 'libkept_1.0_amd64.deb'), '');
    const r = run();
    expect(r.code).toBe(0);
    expect(readdirSync(cache).sort()).toEqual(['libkept_1.0_amd64.deb', 'libnew_2.0_amd64.deb']);
    expect(r.out).toContain('System packages saved to cache: 2');
  });

  test('a slow mirror is dropped and the next attempt uses the mirror listed after it', () => {
    const r = run(undefined, { STUB_SLOW_WHILE: 'azure' });
    expect(r.code).toBe(0);
    expect(r.calls[0]).toContain('azure=listed');
    expect(r.calls[1]).toMatch(/^install-deps chromium webkit .*azure=dropped/);
    expect(readFileSync(mirrors, 'utf-8')).toBe(MIRRORS.split('\n').slice(1).join('\n'));
    expect(r.out).toContain('did not finish in 1s (attempt 1 of 2)');
    expect(r.out).toContain('System packages downloaded in');
    expect(r.calls.at(-1)).toMatch(/^install --with-deps chromium webkit/);
  });

  test('the only mirror listed is never dropped', () => {
    writeFileSync(mirrors, 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n');
    const r = run(undefined, { STUB_SLOW_WHILE: 'azure', PW_APT_ATTEMPT_SECONDS: '1 1' });
    expect(r.code).toBe(1);
    expect(readFileSync(mirrors, 'utf-8')).toContain('azure.archive.ubuntu.com');
    expect(r.out).toContain('No other mirror is listed');
  });

  test('when no attempt finishes it fails, names the mirror as the cause, and installs nothing', () => {
    const r = run(undefined, { STUB_SLOW_WHILE: 'ubuntu', PW_APT_ATTEMPT_SECONDS: '1 1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('::error title=Ubuntu package mirror too slow::');
    expect(r.out).toContain('No test ran');
    expect(r.calls.filter((c) => c.startsWith('install --with-deps'))).toEqual([]);
    expect(existsSync(join(confDir, '99-playwright-prefetch'))).toBe(false);
  });

  test('a download that fails outright is retried, then reported the same way', () => {
    const r = run(undefined, { STUB_DEPS_EXIT: '100' });
    expect(r.code).toBe(1);
    expect(r.calls.filter((c) => c.startsWith('install-deps'))).toHaveLength(2);
    expect(r.out).toContain('failed with exit 100');
    expect(r.out).toContain('::error title=Ubuntu package mirror too slow::');
  });

  test('no browser named is a usage error', () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });
});

// ─── The jobs that failed on 2026-10-07 install through the script ───────────
describe('jobs that install WebKit go through the script and the package cache', () => {
  const load = (f) => yaml.load(readFileSync(join(ROOT, '.github', 'workflows', f), 'utf-8'));
  const CACHE_NAME = 'Restore Playwright system package cache';
  const index = (steps, name) => steps.findIndex((s) => s && s.name === name);

  function assertCache(steps, beforeStep) {
    const step = steps[index(steps, CACHE_NAME)];
    expect(step, `"${CACHE_NAME}" step must exist`).toBeDefined();
    expect(step.uses).toBe('actions/cache@v6');
    expect(step.with.path).toBe('~/.cache/pw-apt-archives');
    // One cache per browser set: a chromium-only job must never save its
    // smaller set under the key a WebKit job restores.
    expect(step.with.key).toMatch(/pw-apt-\$\{\{[^}]*'chromium-webkit'[^}]*'chromium'[^}]*\}\}-/);
    expect(step.with['restore-keys'].trim()).toBe(step.with.key.replace(/\$\{\{ hashFiles.*$/, ''));
    expect(index(steps, CACHE_NAME)).toBeLessThan(index(steps, beforeStep));
    return step;
  }

  test('T0 Gate: the invariants and component shards', () => {
    const steps = load('oursharedevents-ci.yml').jobs.gate.steps;
    const cache = assertCache(steps, 'Architecture: structural invariants');
    expect(cache.if).toBe("matrix.shard == 'invariants' || matrix.shard == 'component'");
    expect(index(steps, CACHE_NAME)).toBeLessThan(
      index(steps, 'Component: viewport specs vs local worker')
    );

    const component = steps[index(steps, 'Component: viewport specs vs local worker')].run;
    expect(component).toContain(`bash ${SCRIPT_REL} chromium webkit`);
    const invariants = steps[index(steps, 'Architecture: structural invariants')].run;
    expect(invariants).toContain(`bash ${SCRIPT_REL} chromium\n`);
    for (const run of [component, invariants]) {
      expect(run).not.toMatch(/playwright install/);
    }
  });

  test('phone audit: every leg, with WebKit only where the leg runs it', () => {
    const steps = load('mobile-workability-audit.yml').jobs['pr-code'].steps;
    assertCache(steps, 'Install Playwright browsers');
    const install = steps[index(steps, 'Install Playwright browsers')];
    expect(install.env.BROWSERS).toBe("${{ matrix.webkit && 'chromium webkit' || 'chromium' }}");
    expect(install.run.trim()).toBe(`bash ${SCRIPT_REL} $BROWSERS`);
    // The step limit must leave room for both download attempts and the install.
    expect(install['timeout-minutes']).toBeGreaterThanOrEqual(8);
    expect(
      steps.filter((s) => s && /playwright install/.test(s.run || '')),
      'pr-code must not call `playwright install` outside the script'
    ).toEqual([]);
  });

  test('the script is executable in git and has LF line endings', () => {
    const mode = spawnSync('git', ['ls-files', '-s', SCRIPT_REL], { cwd: ROOT, encoding: 'utf-8' });
    expect(mode.stdout).toMatch(/^100755 /);
    expect(readFileSync(SCRIPT, 'utf-8')).not.toContain('\r');
  });
});
