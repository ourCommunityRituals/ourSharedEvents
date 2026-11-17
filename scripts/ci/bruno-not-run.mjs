// What a Bruno run says, by test name, it did not check.
//
// A Bruno case that leaves assertions out says so in the name of a test that
// starts "NOT RUN (" (AGENTS.md: a Bruno run counts only if its test() names
// print). The step's log prints that name among hundreds of others. This reads
// the run's JUnit report and writes the NOT RUN names, each with its request, as
// Markdown for the job summary, so a person reading the run sees what was left
// out without opening the log.
//
//   node scripts/ci/bruno-not-run.mjs <junit.xml> >> "$GITHUB_STEP_SUMMARY"
//
// It never fails the step: it runs under `if: always()`, after a run that may
// have written no report. A missing report is said in the summary.
// tests/unit/ci/bruno-not-run.test.js runs it against a report written by
// Bruno's own reporter.

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** A test whose name starts with this is a statement of what was not checked. */
export const NOT_RUN_PREFIX = 'NOT RUN (';

const ENTITIES = { '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const unescapeXml = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&(quot|apos|lt|gt|amp);/g, (m) => ENTITIES[m]);

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : '';
};

/**
 * The NOT RUN tests of a JUnit report as Bruno writes it (one `<testsuite>` a
 * request, one `<testcase>` a test): `{ request, name, status }`, in report order.
 */
export function notRunTests(junitXml) {
  const out = [];
  let request = '';
  // A tag runs to the first `>` outside a quoted value: the reporter leaves `>`
  // as it is inside an attribute, and a test name may hold one.
  for (const m of String(junitXml).matchAll(/<(testsuite|testcase)\b(?:[^>"]|"[^"]*")*>/g)) {
    if (m[1] === 'testsuite') {
      request = attr(m[0], 'name');
      continue;
    }
    const name = attr(m[0], 'name');
    if (name.startsWith(NOT_RUN_PREFIX)) {
      out.push({ request, name, status: attr(m[0], 'status') });
    }
  }
  return out;
}

/** Markdown for the job summary. */
export function notRunSummary(junitXml) {
  const found = notRunTests(junitXml);
  if (found.length === 0) return 'No test of this run is named NOT RUN.\n';
  const code = (s) => '`' + s.replace(/`/g, "'") + '`';
  const lines = [
    `**NOT RUN: ${found.length} test${found.length === 1 ? '' : 's'} of this run say what they did not check.**`,
    '',
    ...found.map(
      (t) =>
        `- ${t.status === 'pass' ? '' : `**${(t.status || 'no status').toUpperCase()}** `}` +
        `${t.name} (request ${code(t.request)})`
    ),
  ];
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the run's own JUnit report, named by the workflow
  if (!file || !existsSync(file)) {
    process.stdout.write(
      `NOT RUN names could not be read: no JUnit report at \`${file ?? '(no path given)'}\`.\n`
    );
  } else {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- as above
    process.stdout.write(notRunSummary(readFileSync(file, 'utf8')));
  }
}
