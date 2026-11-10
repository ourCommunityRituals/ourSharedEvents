// @ts-check
//
// OSE-1186 G1 — mutation testing (StrykerJS). The "teeth-check" on the test
// pyramid: a surviving mutant in invariant-enforcing code = the pyramid defending
// that invariant is HOLLOW (green with no teeth) — the gap the integrity guards
// can't see (they catch *skipped*, not *hollow*).
//
// CONSTITUTION-FIRST TARGETS. Mutation targets are chosen by the architectural
// invariant register (OCR-docs `architectural-invariants.yaml`), not by
// convenience. Slice 1 covers the two most covenant-critical numeric/omission
// guards, both pure-logic so mutation runs on the FAST node vitest project
// (off the workerd pool, which is too slow per-mutant + Windows-incompatible):
//
//   • src/lib/count-floor.ts   → Invariant #8 (K-anon floor, K>=5). A survived
//     mutant here means a sub-K count could publish — the covenant's numeric guard.
//   • src/lib/report-depth.ts  → Invariant #5 (tier equity / depth omission).
//     A survived mutant means a paid section could leak to a lower depth.
//
// Both modules are covered by node-project unit specs (count-floor.spec.ts,
// report-depth.spec.ts — in vitest.node-specs.mjs), so the node runner exercises
// their assertions directly.
//
// Run: `npm run test:mutation` (needs the one-time devDep install:
//   npm install -D @stryker-mutator/core @stryker-mutator/vitest-runner).
// CI wiring (nightly + workflow_dispatch) follows once the baseline score is known.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `file:start-end` for the lines from the first one containing `from` to the
 * next one containing `to` (inclusive), so a range in a big handler file
 * follows its code when lines above it move. A marker that is missing throws:
 * a range that points nowhere would be a gate that cannot fail.
 */
export function rangeOf(file, from, to) {
  const lines = readFileSync(join(HERE, file), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes(from));
  if (start < 0) throw new Error(`stryker.conf: "${from}" not found in ${file}`);
  const end = lines.findIndex((l, i) => i > start && l.includes(to));
  if (end < 0) throw new Error(`stryker.conf: "${to}" not found after "${from}" in ${file}`);
  return `${file}:${start + 1}-${end + 1}`;
}

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: {
    // Only the fast Node project — the covenant guards are pure logic; keep the
    // workerd pool out of the per-mutant loop.
    configFile: 'vitest.node.config.mts',
  },
  mutate: [
    'src/lib/count-floor.ts',
    'src/lib/report-depth.ts',
    // OSE-1273 (G1 follow-on) — the PII-scrub crypto (email hashing/encryption),
    // covered by the node-project pii-crypto.spec.ts.
    'src/lib/pii.ts',
    // OSE-1278 slice 2 (G1 authZ mutation) — the admin auth guard. Slice 1 landed
    // the JWKS/RSA harness (auth-jwks-verify.spec.ts) that makes verifyCfAccessJWT
    // testable off the workerd pool; at that point admin.ts scored 56.65% (87
    // survivors + 27 no-cov). Slice 2 added auth-guard-mutation.spec.ts — the
    // behavioural kill loop over every reachable branch (constantTimeEqual via
    // Methods 2/3, extractAdminActor, extractBearer/getAdminKey trim + legacy
    // alias, extractCfAccessPayload/verifyCfAccessJWT exp/iat/segment/some-vs-every
    // branches, JWKS TTL + cache-age, the 401 response shape, and the two audit
    // log lines via console spies). Residual survivors are documented EQUIVALENT
    // mutants (`// Stryker disable` with written reasons in src/auth/admin.ts).
    'src/auth/admin.ts',
    // OSE-1824 — the landing's Type row by event-type category (owner 2026-11-09).
    // The catalog grouping and its read are whole files; the renderer is the
    // whole landing area (its CSS-only filter is the behaviour); in the two big
    // handler files only the code this feature owns is mutated. Killed by
    // landing-area.spec.ts, landing-category-scenarios.spec.ts and the goldens.
    'src/lib/event-type-catalog.ts',
    'src/lib/event-type-catalog-read.ts',
    'src/lib/landing-area.ts',
    rangeOf('src/handlers/pages.ts', 'let typeCategories:', 'const areaOpts = {'),
    rangeOf(
      'src/handlers/events.ts',
      'export async function handleAdminListEventTypes(',
      'Failed to list event types'
    ),
    // Epic OSE-1880 (owner, 2026-11-09) — the map's deterministic rules. Where a
    // dot sits is AGENTS.md invariant 3 (place, not person): every event at its
    // res-9 block centre, no coordinate on the page, no dot map without a street
    // map (attendee-map.ts). The street map under it is drawn by the Worker from
    // bytes it decodes itself, so a hollow decoder test is a hollow map
    // (pmtiles.ts reads the archive, mvt.ts the tile). `landingZoom`, the one
    // thing a visitor can type into the map, is in landing-area.ts above, with
    // its fat-finger properties in fat-finger.property.spec.ts. Killed by
    // attendee-map.spec.ts, map-zoom.spec.ts, mvt.spec.ts, pmtiles.spec.ts and
    // the two street-map specs.
    'src/lib/attendee-map.ts',
    'src/lib/mvt.ts',
    'src/lib/pmtiles.ts',
  ],
  coverageAnalysis: 'perTest',
  // Stryker writes `// @ts-nocheck` into its sandbox copy of each file this
  // pattern matches. Its default also matches `.html`, so it went into the
  // inline <script> blocks of src/templates/*.html. The pages it rendered were
  // then not the real pages, and the byte-exact golden renders
  // (list-landing-language-golden.spec.ts) failed the dry run. Script and type
  // files only; templates are copied as they are.
  disableTypeChecks: '{src,tests}/**/*.{js,mjs,cjs,ts,mts,cts}',
  // `json` feeds the per-file floor (scripts/ci/mutation-file-floor.mjs, OSE-1801):
  // the break threshold below is global, so one file can hide under another.
  reporters: ['html', 'clear-text', 'progress', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // Covenant guards are held to the SAME bar as the CCR artifact standard (>=95%)
  // so OCR's quality thresholds read as one coherent system. Residual survivors
  // below a raw 100% are documented EQUIVALENT mutants (`// Stryker disable`
  // annotations with written reasons in count-floor.ts / report-depth.ts) —
  // excluded honestly, never faked. Break below 95% so a real hollow spot in an
  // invariant-enforcing module fails loudly, not quietly.
  thresholds: { high: 95, low: 95, break: 95 },
};
