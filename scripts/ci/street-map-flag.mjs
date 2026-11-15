// Is the street-map archive loaded on staging? One place says so.
//
// The answer is `streetMapArchiveLoaded` in the Bruno staging environment file.
// The Bruno cases read it with bru.getEnvVar. A Playwright spec cannot, so it
// reads the same line of the same file through this module
// (tests/e2e/helpers/map-zoom-area.ts). The workflow passes the flag to neither:
// a second copy could say something else (tests/unit/ci/street-map-staging-cases.test.js).
//
// "false": a zoomed area with no street layer is right, and the street
//          assertions print NOT RUN.
// "true":  a zoomed area with no street layer fails by name.
// The owner sets it to "true" in a one-line PR once streets have been seen on
// staging (docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const STAGING_ENV_FILE = 'bruno/ose-pages/environments/ose-staging.yml';
export const FLAG = 'streetMapArchiveLoaded';

/** The flag in this environment file's text. Anything but "true" or "false" throws. */
export function parseStreetMapFlag(envYaml) {
  const m = /name: streetMapArchiveLoaded\r?\n\s+value: "(true|false)"/.exec(String(envYaml));
  if (!m) throw new Error(`${STAGING_ENV_FILE} must set ${FLAG} to "true" or "false"`);
  return m[1] === 'true';
}

/** The flag as the repository at `root` has it. */
export function streetMapArchiveLoaded(root) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own environment file
  return parseStreetMapFlag(readFileSync(join(root, STAGING_ENV_FILE), 'utf8'));
}
