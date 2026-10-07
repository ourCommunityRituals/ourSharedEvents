/**
 * Wrangler is pinned to one exact version (OSE-1369).
 *
 * Wrangler holds write access to the production Worker, its databases and its
 * bindings, so the version that deploys must be the version that was tested.
 * A range ("^4.145.0") lets a fresh install pick up a newer release than the
 * lockfile names, and "it worked locally" stops being evidence.
 *
 * CI installs with `npm ci`, which uses the lockfile, so the lockfile is the
 * version CI runs. These tests hold the manifest, the lockfile and the
 * workflows to that one version.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..', '..');
const WORKER = join(ROOT, 'workers', 'oursharedevents');
const manifest = JSON.parse(readFileSync(join(WORKER, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(WORKER, 'package-lock.json'), 'utf8'));

const EXACT = /^\d+\.\d+\.\d+$/;
const declared = manifest.devDependencies.wrangler;

describe('wrangler is pinned exactly', () => {
  test('the manifest names one version, with no range', () => {
    expect(declared).toMatch(EXACT);
  });

  test('the lockfile records the same requirement', () => {
    expect(lock.packages[''].devDependencies.wrangler).toBe(declared);
  });

  test('the lockfile installs that version', () => {
    expect(lock.packages['node_modules/wrangler'].version).toBe(declared);
  });

  test('the test pool is held to the same wrangler, not its own', () => {
    expect(manifest.overrides['@cloudflare/vitest-pool-workers'].wrangler).toBe('$wrangler');
  });

  test('no workflow fetches wrangler by another route', () => {
    const dir = join(ROOT, '.github', 'workflows');
    const offenders = [];
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      readFileSync(join(dir, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          // `npx wrangler@x`, `npm i -g wrangler`, or the wrangler GitHub action
          // would each run a version the lockfile does not name.
          if (
            /wrangler@|npm (i|install) (-g|--global)[^\n]*wrangler|cloudflare\/wrangler-action/.test(
              line
            )
          ) {
            offenders.push(`${file}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
