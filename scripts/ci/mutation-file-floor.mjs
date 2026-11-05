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
