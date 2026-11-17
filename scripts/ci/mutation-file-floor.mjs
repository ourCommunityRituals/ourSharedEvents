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
  // Polish (OSE-1957) and Arabic (epic OSE-1959, story OSE-1970), 2026-11-10:
  // the language layer's files. A local run of these targets scored 100 (311
  // mutants: 275 killed, 36 timed out, 0 survived), with equivalent mutants
  // on three lines of resolve-language.ts disabled in the source with reasons.
  // The floor is the 95% break, so a slower CI runner that turns a timeout
  // into a survivor is not a false red; raise it once CI confirms. Never lower.
  'src/lib/i18n/languages.ts': 95,
  'src/lib/i18n/bidi.ts': 95,
  'src/lib/i18n/path-prefix.ts': 95,
  'src/lib/i18n/template.ts': 95,
  'src/lib/i18n/resolve-language.ts': 95,
  'src/lib/i18n/language-switch.ts': 95,
  'src/lib/i18n/catalog.ts': 95,
  'src/lib/pii.ts': 95,
  // OSE-826 (2026-11-13): when a registration expires. A local run scored 100
  // (26 of 26 killed, 0 timed out). Never lower.
  'src/lib/retention-windows.ts': 100,
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
  // pages.ts is one score over all its marker ranges. OSE-1952 (2026-11-10)
  // added the sponsor-art range (renderSponsorItem / renderSponsorList) at 23 of
  // 23, with one equivalent mutant disabled in the source with its reason (the
  // '' fallback of the website, read only by startsWith('https://')). OSE-1955
  // (2026-11-11) added the sponsor query of fetchEventPageSocialData at 1 of 1.
  // G11 (2026-11-16) added the landing's street call at 10 of 10.
  'src/handlers/pages.ts': 100,
  // OSE-1955 (2026-11-11): the rest of the sponsor thumbnails, at the scores of
  // the run that added them. sponsor-logo.ts (the host rule, validateLogoUrl and
  // validateProxiedLogoUrl, credentials refusal included) 110 of 110, with one line
  // disabled in the source with its reason ('' and 'localhost' are also refused by
  // the single-label rule). sponsors.ts (the logo proxy's slot pick and its
  // consent-gated query) 22 of 22. Never lower.
  'src/lib/sponsor-logo.ts': 100,
  'src/handlers/sponsors.ts': 100,
  'src/handlers/events.ts': 100,
  // OSE-1850 and OSE-1943 (2026-11-11): the form pages on the language layer,
  // mutated only in their marker ranges. Two local runs scored 100 on both
  // (form-pages.ts 207 mutants, 0 survived; event-staleness.ts 3 of 3). Five
  // equivalent mutants carry a written `// Stryker disable` reason in
  // form-pages.ts: the four `nonce = ''` defaults (formPage always passes one)
  // and `'register'` to privacyNotice (its default branch is the same notice).
  // The main CI run 43231267288 (2026-11-13) then scored form-pages.ts 98.55%:
  // three mutants the local runs had marked killed only by tests that timed
  // out under load, never by an assertion. Two were real gaps (a null title,
  // the 200-character cap), now pinned in form-pages-language.spec.ts E3. The
  // third was a `case 'email-signup':` label no caller reached; it is gone and
  // the NoticeForm type makes tsc refuse it. Floor 100. Never lower.
  'src/handlers/form-pages.ts': 100,
  'src/lib/event-staleness.ts': 100,
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
  // end and sets nothing). pmtiles.ts, 366 of 367 since the reader holds every
  // read and unpack to a limit (2026-11-14, a local run; was 338 of 339 when it
  // began to plan its reads, 275 of 276 with the leaf entry budget, 260 of 261
  // before it): `3 * rx` to `3 / rx` in the Hilbert step (rx is 0 or 1, and `^`
  // turns Infinity into 0). Seven of the 366 never end and are stopped by the
  // run (the varint loop, the directory search, the Hilbert walk, the gzip
  // read loop). On a loaded machine a slow test can pass its own time limit
  // and count that survivor as killed: read 100% here as a run to repeat, not
  // as a new floor. Never lower.
  'src/lib/attendee-map.ts': 98.9,
  'src/lib/mvt.ts': 99.02,
  'src/lib/pmtiles.ts': 99.7,
  // The street layer, street-map.ts, the whole file since 2026-11-15 (street-map
  // CCR, R17). Until then two marker ranges were mutated (the archive name rule
  // and the loader, 48 mutants) and this line read 100 for that part alone; the
  // frame, the drawing and its point budget were not mutated at all. A local
  // run of the whole file, 2026-11-15: 540 mutants, 535 killed, 3 that never
  // end (`--z` to `++z` where the zoom steps out, `x++` and `y++` to `--` in
  // the tile loop), 2 survived, so 99.63. One survivor has a test since (three
  // points on a straight run). The other was read as equivalent (a point of
  // water sent on as a river is one point to a part, and a part under two
  // points is left out either way) and was not: the decoder takes a feature's
  // type as the tile gives it, so a run of points can arrive typed as a point.
  // It has a test since PR 1295 ("a river is a line in the water layer"), and
  // its `// Stryker disable` line, which never took, is gone from the source.
  // Three more are disabled in the source with their reasons. Never lower.
  'src/lib/street-map.ts': 99.6,
  // The street layer's two callers (base-map plan, gap G11, 2026-11-16). The
  // public area map's handler, map-areas.ts, the whole file: a local run of the
  // render group scored 107 of 107 (0 timed out). The first run left 13 alive,
  // 11 of them killed since by tests in map-areas.spec.ts (each refusal's whole
  // body, the 256-character limit at its edge, the surface in the STREET_LAYER
  // line). The other two are disabled in the source with their reason: the
  // Regex mutants that drop `^` or `$` from the strip of STREET_STYLE's tags,
  // which open and close that constant and appear nowhere else in it. The
  // landing's street call joined pages.ts above at 10 of 10, with one
  // equivalent `?.` disabled in the source with its reason. Never lower.
  'src/handlers/map-areas.ts': 100,
  // W1 (OSE-2095, owner 2026-11-16): the ZIP at the Where step, group `zip`.
  // event-zip.ts whole; the other four only in the ranges W1 wrote or changed
  // (rangeOf in stryker.conf.mjs). A local run, 2026-11-16, after the merge of
  // main 5bef37cd: 151 mutants, 150 killed. event-zip.ts 94 of 94 (three lines
  // disabled in the source with their reasons), zip-areas.ts 31 of 31,
  // place-names.ts 10 of 10, place-search.ts 10 of 10. export-geography.ts 5 of
  // 6: the survivor is SUB_CORRIDOR_KEY without its `^`, which would refuse
  // any name that only ends in a listed one. No column any exporter writes
  // ends in one, so no test tells them apart, and a test that pinned the `^`
  // would pin the guard to exact names, which the W1 security read lists as a
  // gap to close (`zipcode`, `postcode`). Raise to 100 when the guard is
  // widened. Never lower.
  'src/lib/event-zip.ts': 100,
  'src/lib/zip-areas.ts': 100,
  'src/lib/place-names.ts': 100,
  'src/lib/place-search.ts': 100,
  'src/lib/export-geography.ts': 83.33,
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

/**
 * One report from several Stryker passes (stryker.conf.mjs and
 * stryker.language.conf.mjs each write their own). A file belongs to one pass:
 * a path in two reports is a failure, not a merge, so two passes can never
 * average one file's score.
 */
export function mergeReports(reports) {
  const files = {};
  const failures = [];
  for (const report of reports) {
    for (const [path, file] of Object.entries(report?.files ?? {})) {
      const key = path.replace(/\\/g, '/');
      if (key in files) failures.push(`${key}: in more than one mutation report`);
      else files[key] = file;
    }
  }
  return { report: { files }, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const reportPaths = process.argv.slice(2);
  if (!reportPaths.length) {
    console.error('usage: mutation-file-floor.mjs <mutation.json> [<mutation.json> ...]');
    process.exit(2);
  }
  const merged = mergeReports(reportPaths.map((p) => JSON.parse(readFileSync(p, 'utf8'))));
  const failures = [...merged.failures, ...checkFloors(merged.report)];
  if (failures.length) {
    console.error('Per-file mutation floor failed:\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log(
    `Per-file mutation floor: ${Object.keys(FLOORS).length} files at or above their floor.`
  );
}
