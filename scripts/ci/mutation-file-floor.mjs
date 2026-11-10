#!/usr/bin/env node
/**
 * Per-file mutation floor (OSE-1801, CCR 2026-11-04 S-2).
 *
 * Stryker's own `break` threshold is global: one file at 100% can carry another
 * well below the bar, and a 99% total once hid four survivors in the admin
 * guard. This reads Stryker's JSON report and fails when any listed file scores
 * below its own floor, or when a listed file is missing from the report (a
 * floor on a file that was not mutated is a gate that cannot fail).
 *
 * Score = detected / valid, the way Stryker computes it:
 *   detected = Killed + Timeout
 *   valid    = detected + Survived + NoCoverage
 * Ignored, CompileError and RuntimeError mutants are not valid and do not count.
 *
 * Usage: node scripts/ci/mutation-file-floor.mjs <mutation.json>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Files and their floors (percent). Keys are paths as Stryker reports them. */
export const FLOORS = {
  'src/auth/admin.ts': 100,
  // A ratchet at the score this floor found on 2026-11-05 (123 of 137): 14
  // mutants in floorNestedCounts, floorPublishedChain and floorCumulativeSeries
  // (#1065, #1070) survive, hidden until now by the global 95%. Raise to 95
  // when they are killed; never lower.
  'src/lib/count-floor.ts': 89.78,
  'src/lib/report-depth.ts': 95,
  'src/lib/pii.ts': 95,
  // OSE-1824 (2026-11-09): the landing's Type row by event-type category, at
  // the scores of the run that added them. One equivalent mutant in the catalog
  // read carries a written `// Stryker disable` reason. landing-area.ts is 306 of
  // 308: the two survivors are the `<=` forms of `b < a || c < b` in
  // orderLandingSections, equivalent because two markers never share an index
  // (a disable comment would also hide the killable `>=` forms). The two handler
  // files are mutated only in a marker range (rangeOf in stryker.conf.mjs).
  // Never lower.
  'src/lib/event-type-catalog.ts': 100,
  'src/lib/event-type-catalog-read.ts': 100,
  'src/lib/landing-area.ts': 99.35,
  'src/handlers/pages.ts': 100,
  'src/handlers/events.ts': 100,
  // Epic OSE-1880 (owner, 2026-11-09): the map's deterministic rules, at the
  // scores of the run that added them (rounded down, so the same run passes).
  // Every survivor is equivalent, and sits on a line where another mutant of
  // the same mutator is killed, so a `// Stryker disable` would hide a killable
  // one. attendee-map.ts, 542 of 548: `typeof v === 'string'` in str() (String()
  // returns a string unchanged, two mutants); `!cell || !isValidCell(cell)` to
  // false and `typeof v === 'number'` to true (h3 getResolution and
  // Number.isFinite refuse the same values on the next step); `<` to `<=`
  // against DOT_MERGE (needs two block centres exactly 78.0 map units apart);
  // the `[]` of a branch that returns before it is read. (The first CI run had
  // a seventh, `\s+` to `\s` in TOWN_STATE, which a loaded workstation had
  // counted as a timeout. It was not equivalent: a line break and a space
  // before the state tells the two apart, and a test now does.) mvt.ts, 305 of 308:
  // `cur.length > 0` at ClosePath (a ring is never empty once it exists, two
  // mutants) and `k + 1 < tags.length` to `<=` (the extra pass reads past the
  // end and sets nothing). pmtiles.ts, 275 of 276 since the leaf cache took an
  // entry budget (was 260 of 261): `3 * rx` to `3 / rx` in the Hilbert step (rx
  // is 0 or 1, and `^` turns Infinity into 0). Never lower.
  'src/lib/attendee-map.ts': 98.9,
  'src/lib/mvt.ts': 99.02,
  'src/lib/pmtiles.ts': 99.63,
  // The street layer's loader (owner, 2026-11-10): two marker ranges of
  // street-map.ts, the archive name rule and buildStreetLayer to the catch in
  // loadStreetLayer. 50 of 50: 48 killed, and 2 that never end (`x++` and `y++`
  // to `--` in the tile loop, so the run stops them). One mutant is disabled
  // in the source with its reason: the text of an error nobody reads.
  'src/lib/street-map.ts': 100,
};

/** One file's score from its mutants, or null when it has no valid mutant. */
export function fileScore(mutants) {
  let detected = 0;
  let valid = 0;
  for (const m of mutants) {
    if (m.status === 'Killed' || m.status === 'Timeout') {
      detected += 1;
      valid += 1;
    } else if (m.status === 'Survived' || m.status === 'NoCoverage') {
      valid += 1;
    }
  }
  return valid === 0 ? null : (detected / valid) * 100;
}

/** Failures for a report against floors: missing files, empty files, and files under the floor. */
export function checkFloors(report, floors = FLOORS) {
  const files = report?.files ?? {};
  const byPath = new Map(Object.entries(files).map(([p, f]) => [p.replace(/\\/g, '/'), f]));
  const failures = [];
  for (const [path, floor] of Object.entries(floors)) {
    const file = byPath.get(path);
    if (!file) {
      failures.push(`${path}: not in the mutation report (was it mutated?)`);
      continue;
    }
    const score = fileScore(file.mutants ?? []);
    if (score === null) {
      failures.push(`${path}: no valid mutants`);
      continue;
    }
    if (score < floor) {
      const survivors = (file.mutants ?? [])
        .filter((m) => m.status === 'Survived' || m.status === 'NoCoverage')
        .map((m) => `  line ${m.location?.start?.line ?? '?'}: ${m.mutatorName} (${m.status})`);
      failures.push(
        `${path}: ${score.toFixed(2)}% is below its floor of ${floor}%\n${survivors.join('\n')}`
      );
    }
  }
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('usage: mutation-file-floor.mjs <mutation.json>');
    process.exit(2);
  }
  const failures = checkFloors(JSON.parse(readFileSync(reportPath, 'utf8')));
  if (failures.length) {
    console.error('Per-file mutation floor failed:\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log(
    `Per-file mutation floor: ${Object.keys(FLOORS).length} files at or above their floor.`
  );
}
