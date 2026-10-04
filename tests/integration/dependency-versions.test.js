/**
 * Dependency version checks.
 *
 * Static rules over every package manifest in the repo, so a drifted lockfile,
 * a floating version, a mismatched Node version or a stale override fails in
 * CI instead of at install time. Property-asserting
 * (tests/e2e/0-architecture/README.md): the subjects are derived from the
 * repo, and each detector is proven on synthetic controls first so the gate
 * cannot pass vacuously.
 *
 *   1  Lockfile sync   Each manifest's dependencies equal its lockfile's root
 *                      entry, and every installed version satisfies the range.
 *   2  Sources         Registry ranges only. `file:` is allowed for @ocr/*
 *                      packages. No `latest`, `*`, empty, git or URL specs.
 *   3  Lockfiles       A manifest with dependencies has a lockfile, or is
 *                      named in LOCKLESS with a reason.
 *   4  Shared majors   A dependency declared in several manifests has one
 *                      major version, except the named EXCEPTIONS. An
 *                      exception that is no longer needed fails, so the list
 *                      cannot rot.
 *   5  Node            CI uses the Node major in .nvmrc, except the named
 *                      CI_NODE_EXCEPTIONS; the engines floor does not exceed
 *                      it, and every CI Node satisfies the engines range.
 *   6  Overrides       Every installed copy of an overridden package satisfies
 *                      the override. An override for a package that is not
 *                      installed is allowed: it is a defensive pin that takes
 *                      effect if a dependency brings the package back.
 *   7  Worker date     wrangler `compatibility_date` is not in the future.
 */

const { existsSync, readFileSync, readdirSync } = require('fs');
const { join, dirname } = require('path');
const semver = require('semver');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');

const ROOT = join(__dirname, '..', '..');

// ── Policy: every entry says why, so it can be challenged ─────────────────
const LOCKLESS = {
  'packages/data-provider/package.json':
    'a file: package consumed by the worker; its dev dependencies are resolved by the root install',
};
const SHARED_MAJOR_EXCEPTIONS = {
  '@cloudflare/workers-types':
    'root declares ^4 and the worker ^5. Only workers/oursharedevents/tsconfig.json uses it. Align or remove the root entry, then delete this exception',
};
const CI_NODE_EXCEPTIONS = {
  'flags-package-ci.yml':
    '20: the flags package supports Node 20 (engines >=20) and its CI proves it',
};

// ── helpers ────────────────────────────────────────────────────────────────
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const declared = (pkg) => ({
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.optionalDependencies,
});

/** Tracked package.json files, excluding archive/. */
function manifestPaths() {
  const out = execFileSync('git', ['ls-files', '*package.json'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((p) => /(^|\/)package\.json$/.test(p) && !p.startsWith('archive/'));
}

// 1 ───────────────────────────────────────────────────────────────────────
/** Differences between a manifest and its lockfile: string[]. */
function lockDrift(pkg, lock) {
  const specs = declared(pkg);
  const root = (lock.packages && lock.packages['']) || {};
  const locked = { ...root.dependencies, ...root.devDependencies, ...root.optionalDependencies };
  const out = [];
  for (const [name, range] of Object.entries(specs)) {
    if (locked[name] !== range) {
      out.push(`${name}: package.json ${range}, lockfile ${locked[name] ?? 'missing'}`);
      continue;
    }
    const inst = lock.packages['node_modules/' + name];
    if (inst && semver.validRange(range) && !semver.satisfies(inst.version, range)) {
      out.push(`${name}: installed ${inst.version} does not satisfy ${range}`);
    }
  }
  for (const name of Object.keys(locked)) {
    if (!(name in specs)) out.push(`${name}: in the lockfile root, not in package.json`);
  }
  return out;
}

// 2 ───────────────────────────────────────────────────────────────────────
/** Specs that are not an exact or ranged registry version: string[]. */
function badSources(pkg) {
  const out = [];
  for (const [name, spec] of Object.entries(declared(pkg))) {
    const s = String(spec).trim();
    if (s.startsWith('file:')) {
      if (!name.startsWith('@ocr/')) out.push(`${name}@${s}`);
    } else if (!s || /^(latest|next|\*|x)$/i.test(s) || /^(git|http|https|github:|link:)/i.test(s)) {
      out.push(`${name}@${s || '(empty)'}`);
    } else if (!semver.validRange(s)) {
      out.push(`${name}@${s}`);
    }
  }
  return out;
}

// 4 ───────────────────────────────────────────────────────────────────────
/** Dependencies declared with more than one major: { name: { manifest: range } }. */
function majorDrift(manifests) {
  const byName = {};
  for (const [file, pkg] of Object.entries(manifests)) {
    for (const [name, range] of Object.entries(declared(pkg))) {
      if (String(range).startsWith('file:')) continue;
      (byName[name] = byName[name] || {})[file] = range;
    }
  }
  const out = {};
  for (const [name, ranges] of Object.entries(byName)) {
    const majors = new Set(
      Object.values(ranges).map((r) => {
        const min = semver.minVersion(r);
        return min ? min.major : r;
      })
    );
    if (majors.size > 1) out[name] = ranges;
  }
  return out;
}

// 5 ───────────────────────────────────────────────────────────────────────
/** setup-node versions per workflow: { file: string[] } (strings as written). */
function ciNodeVersions(workflows) {
  const out = {};
  for (const [file, wf] of Object.entries(workflows)) {
    for (const def of Object.values((wf && wf.jobs) || {})) {
      for (const step of (def && def.steps) || []) {
        if (step && typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node')) {
          const v = step.with && step.with['node-version'];
          if (v !== undefined) (out[file] = out[file] || []).push(String(v));
        }
      }
    }
  }
  return out;
}

// 6 ───────────────────────────────────────────────────────────────────────
/** Installed copies that break a top-level string override: string[]. */
function overrideViolations(pkg, lock) {
  const out = [];
  for (const [name, range] of Object.entries(pkg.overrides || {})) {
    if (typeof range !== 'string' || range.startsWith('$') || !semver.validRange(range)) continue;
    for (const [key, entry] of Object.entries(lock.packages || {})) {
      if (key.slice(key.lastIndexOf('node_modules/') + 13) !== name) continue;
      if (entry.version && !semver.satisfies(entry.version, range)) {
        out.push(`${key}: ${entry.version} does not satisfy the override ${name}@${range}`);
      }
    }
  }
  return out;
}

// ── detector controls ──────────────────────────────────────────────────────
describe('detector controls', () => {
  const lock = (root, installed = {}) => ({
    packages: {
      '': { devDependencies: root },
      ...Object.fromEntries(
        Object.entries(installed).map(([n, v]) => [`node_modules/${n}`, { version: v }])
      ),
    },
  });

  test('1 flags a range changed in package.json but not in the lockfile', () => {
    expect(
      lockDrift({ devDependencies: { a: '^2.0.0' } }, lock({ a: '^1.0.0' }, { a: '1.2.0' }))
    ).toEqual(['a: package.json ^2.0.0, lockfile ^1.0.0']);
  });

  test('1 flags an installed version outside the range, and a dependency only in the lock', () => {
    expect(
      lockDrift({ devDependencies: { a: '^2.0.0' } }, lock({ a: '^2.0.0', b: '^1.0.0' }, { a: '1.9.0' }))
    ).toEqual([
      'a: installed 1.9.0 does not satisfy ^2.0.0',
      'b: in the lockfile root, not in package.json',
    ]);
  });

  test('1 passes a manifest that matches its lockfile', () => {
    expect(
      lockDrift({ devDependencies: { a: '^1.0.0' } }, lock({ a: '^1.0.0' }, { a: '1.4.0' }))
    ).toEqual([]);
  });

  test('2 flags floating, URL and non-@ocr file: specs, passes registry ranges and @ocr file:', () => {
    expect(
      badSources({
        dependencies: {
          a: 'latest',
          b: '*',
          c: '',
          d: 'git+https://x/y.git',
          e: 'file:../e',
          '@ocr/ui': 'file:../ui',
          f: '^1.2.3',
          g: '1.2.3',
          h: '>=1 <3',
          i: 'not a version',
        },
      })
    ).toEqual(['a@latest', 'b@*', 'c@(empty)', 'd@git+https://x/y.git', 'e@file:../e', 'i@not a version']);
  });

  test('4 flags two majors, passes one major with different minors', () => {
    expect(
      majorDrift({
        'a/package.json': { devDependencies: { x: '^4.1.0', y: '^2.0.0' } },
        'b/package.json': { devDependencies: { x: '^5.0.0', y: '^2.9.0' } },
      })
    ).toEqual({ x: { 'a/package.json': '^4.1.0', 'b/package.json': '^5.0.0' } });
  });

  test('5 reads setup-node versions as written, across jobs', () => {
    expect(
      ciNodeVersions({
        'a.yml': {
          jobs: {
            x: { steps: [{ uses: 'actions/setup-node@v7', with: { 'node-version': 22 } }] },
            y: { steps: [{ uses: 'actions/setup-node@v7', with: { 'node-version': '20' } }, { run: 'x' }] },
          },
        },
        'b.yml': { jobs: { z: { steps: [{ uses: 'actions/checkout@v4' }] } } },
      })
    ).toEqual({ 'a.yml': ['22', '20'] });
  });

  test('6 flags an installed copy outside the override, passes a missing package and $ references', () => {
    expect(
      overrideViolations(
        { overrides: { bad: '^2.0.0', good: '^2.0.0', absent: '^1.0.0', ref: '$bad', scoped: { x: '^1' } } },
        {
          packages: {
            '': {},
            'node_modules/bad': { version: '1.5.0' },
            'node_modules/good': { version: '2.1.0' },
            'node_modules/a/node_modules/bad': { version: '1.0.0' },
          },
        }
      )
    ).toEqual([
      'node_modules/bad: 1.5.0 does not satisfy the override bad@^2.0.0',
      'node_modules/a/node_modules/bad: 1.0.0 does not satisfy the override bad@^2.0.0',
    ]);
  });
});

// ── the repository ─────────────────────────────────────────────────────────
describe('package manifests', () => {
  const paths = manifestPaths();
  const manifests = Object.fromEntries(paths.map((p) => [p, readJson(join(ROOT, p))]));
  const lockOf = (p) => join(ROOT, dirname(p), 'package-lock.json');

  test('there are manifests to check', () => {
    expect(paths).toContain('package.json');
    expect(paths).toContain('workers/oursharedevents/package.json');
  });

  test.each(paths)('1 lockfile matches %s', (p) => {
    if (!existsSync(lockOf(p))) return;
    expect(lockDrift(manifests[p], readJson(lockOf(p)))).toEqual([]);
  });

  test.each(paths)('2 %s uses registry ranges (and @ocr file: links) only', (p) => {
    expect(badSources(manifests[p])).toEqual([]);
  });

  test('3 every manifest with dependencies has a lockfile or a stated reason', () => {
    const missing = paths.filter(
      (p) => Object.keys(declared(manifests[p])).length > 0 && !existsSync(lockOf(p)) && !LOCKLESS[p]
    );
    expect(missing).toEqual([]);
  });

  test('3 no LOCKLESS entry has gained a lockfile or lost its manifest', () => {
    const stale = Object.keys(LOCKLESS).filter((p) => !paths.includes(p) || existsSync(lockOf(p)));
    expect(stale).toEqual([]);
  });

  test('4 a shared dependency has one major version, except the named exceptions', () => {
    const drift = majorDrift(manifests);
    const unexpected = Object.keys(drift).filter((n) => !(n in SHARED_MAJOR_EXCEPTIONS));
    expect(unexpected.map((n) => ({ [n]: drift[n] }))).toEqual([]);
  });

  test('4 every shared-major exception is still needed', () => {
    const drift = majorDrift(manifests);
    expect(Object.keys(SHARED_MAJOR_EXCEPTIONS).filter((n) => !(n in drift))).toEqual([]);
  });

  describe('Node', () => {
    const nvmrcMajor = Number(readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim().replace(/^v/, '').split('.')[0]);
    const workflows = {};
    const dir = join(ROOT, '.github', 'workflows');
    for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      workflows[f] = yaml.load(readFileSync(join(dir, f), 'utf8'));
    }
    const ci = ciNodeVersions(workflows);
    const engines = (manifests['package.json'].engines || {}).node;

    test('.nvmrc names a Node major', () => {
      expect(Number.isInteger(nvmrcMajor)).toBe(true);
    });

    test('5 CI uses the .nvmrc Node major, except the named exceptions', () => {
      const off = [];
      for (const [file, versions] of Object.entries(ci)) {
        if (file in CI_NODE_EXCEPTIONS) continue;
        for (const v of versions) {
          if (Number(String(v).split('.')[0]) !== nvmrcMajor) off.push(`${file}: ${v}`);
        }
      }
      expect(off).toEqual([]);
    });

    test('5 every CI Node satisfies the root engines range', () => {
      const bad = [];
      for (const [file, versions] of Object.entries(ci)) {
        for (const v of versions) {
          const coerced = semver.coerce(String(v));
          if (engines && coerced && !semver.satisfies(coerced, engines)) bad.push(`${file}: ${v}`);
        }
      }
      expect(bad).toEqual([]);
    });

    test('5 the engines floor does not exceed the .nvmrc major', () => {
      const min = engines ? semver.minVersion(engines) : null;
      expect(min ? min.major : 0).toBeLessThanOrEqual(nvmrcMajor);
    });

    test('5 every CI Node exception is still in use', () => {
      expect(Object.keys(CI_NODE_EXCEPTIONS).filter((f) => !(f in ci))).toEqual([]);
    });
  });

  test.each(paths.filter((p) => existsSync(lockOf(p))))('6 installed packages in %s respect its overrides', (p) => {
    expect(overrideViolations(manifests[p], readJson(lockOf(p)))).toEqual([]);
  });

  test('7 the Worker compatibility_date is not in the future', () => {
    const toml = readFileSync(join(ROOT, 'workers', 'oursharedevents', 'wrangler.toml'), 'utf8');
    const m = toml.match(/^compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"/m);
    expect(m).not.toBeNull();
    expect(new Date(m[1] + 'T00:00:00Z').getTime()).toBeLessThanOrEqual(Date.now());
  });
});
