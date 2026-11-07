const { readFileSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');

/**
 * One staging site (owner 2026-11-06). stg.oursharedevents.com carries the fixed
 * seed of real events; its populated zips and the deliberately empty 60655 show
 * both experiences, so there is no separate stg-full site, no second set of
 * databases and no STAGING_VARIANT. Every staging page says it is for testing
 * and that its listings are not an endorsement (lib/test-site-notice.ts).
 */

const ROOT = join(__dirname, '..', '..');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

let toml;
let sections;
let compareEnvironments;
beforeAll(async () => {
  const { parseToml } = await load('scripts/prod-preflight.mjs');
  const parity = await load('scripts/ci/env-parity.mjs');
  compareEnvironments = parity.compareEnvironments;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repo's own wrangler.toml, by the path env-parity reads
  toml = readFileSync(join(ROOT, parity.WRANGLER_PATH), 'utf8');
  sections = parseToml(toml);
});

const section = (header) => sections.find((s) => s.header === header);

describe('one staging site', () => {
  test('the only wrangler envs are staging and production', () => {
    const envs = new Set(
      sections.map((s) => (s.header.match(/^env\.([^.]+)/) || [])[1]).filter(Boolean)
    );
    expect([...envs].sort()).toEqual(['production', 'staging']);
  });

  test('staging answers on stg.oursharedevents.com alone', () => {
    const routes = String(section('env.staging').values.routes);
    expect([...routes.matchAll(/pattern = "([^"]+)"/g)].map((m) => m[1])).toEqual([
      'stg.oursharedevents.com/*',
    ]);
  });

  test('no env sets STAGING_VARIANT, and no config names a second site', () => {
    for (const s of sections) expect(s.values.STAGING_VARIANT, s.header).toBeUndefined();
    expect(toml).not.toMatch(/stg-full|stg-empty|staging-full/);
  });

  test('the staging/production parity check holds, as on main', () => {
    expect(compareEnvironments(toml).ok).toBe(true);
  });
});
