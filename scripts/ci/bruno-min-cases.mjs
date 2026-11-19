// A Bruno run that checked nothing is not green (OSE-2160, F-46).
//
// `bru run` exits 0 when every case passes, and a run with no case at all passes
// every case it has. An empty collection, a wrong working directory, a filter
// that matched nothing and a collection whose requests were all skipped each
// give a green step. AGENTS.md says a Bruno run counts only if its test() names
// print; this is the check on that rule. It reads the run's JUnit report and
// exits 1 when:
//
//   - the report is missing or has no `<testsuite>` at all
//   - the cases that proved something are fewer than --min
//   - the requests skipped are more than --max-skipped
//
//   node scripts/ci/bruno-min-cases.mjs <junit.xml> --min 500 --max-skipped 10 [--label pages]
//
// A case that proves something is a `<testcase>` whose name is not:
//   - "NOT RUN (...)": the request says what it left out (bruno-not-run.mjs)
//   - an edge challenge: a name with "edge challenge" in it passes on a
//     Cloudflare answer, which says nothing about the Worker
// A skipped request is a `<skipped>` element ("Request Skipped").
//
// The minimum is set a little under what main runs today (measured on the
// green main runs of 2026-11-19: pages 563, api 2365), so a few removed cases do
// not trip it and a removed folder does. It is a floor to ratchet up, in the
// workflow's matrix, as the collections grow. It is never the place to hide a
// shrink: lowering it is a reviewed change.
//
// tests/unit/ci/bruno-min-cases.test.js runs it on a report Bruno wrote and on
// the faults above.

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ENTITIES = { '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const unescapeXml = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&(quot|apos|lt|gt|amp);/g, (m) => ENTITIES[m]);

const attr = (tag, name) => {
  // eslint-disable-next-line security/detect-non-literal-regexp -- `name` is a literal at every call site
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : '';
};

/** A test whose name starts with this is a statement of what was not checked. */
export const NOT_RUN_PREFIX = 'NOT RUN (';
/** A name that says the case passes on the edge's answer. */
export const EDGE_NAME = /edge challenge/i;

/**
 * Count a JUnit report as Bruno writes it (one `<testsuite>` a request, one
 * `<testcase>` a test, a `<skipped>` child for a skipped request).
 * `{ suites, cases, counted, notRun, edge, skipped }`; `counted` is the cases
 * that proved something.
 */
export function countCases(junitXml) {
  const xml = String(junitXml);
  const out = { suites: 0, cases: 0, counted: 0, notRun: 0, edge: 0, skipped: 0 };
  // A tag runs to the first `>` outside a quoted value: the reporter leaves `>`
  // as it is inside an attribute, and a test name may hold one.
  // eslint-disable-next-line security/detect-unsafe-regex -- same tag scan as bruno-not-run.mjs, over a report this job wrote
  for (const m of xml.matchAll(/<(testsuite|testcase|skipped)\b(?:[^>"]|"[^"]*")*>/g)) {
    if (m[1] === 'testsuite') out.suites += 1;
    else if (m[1] === 'skipped') out.skipped += 1;
    else {
      out.cases += 1;
      const name = attr(m[0], 'name');
      if (name.startsWith(NOT_RUN_PREFIX)) out.notRun += 1;
      else if (EDGE_NAME.test(name)) out.edge += 1;
      else out.counted += 1;
    }
  }
  return out;
}

/**
 * What is wrong with a report, as sentences; an empty list means it holds enough.
 * `limits`: `{ min, maxSkipped }`. A limit that is not a number is itself a
 * problem: a gate with no floor is the gate this file replaces.
 */
export function problems(junitXml, limits, label = 'Bruno run') {
  const out = [];
  const { min, maxSkipped } = limits;
  if (!Number.isInteger(min) || min < 1) {
    return [`${label}: no usable --min (got ${String(min)}); a floor of 0 cannot fail`];
  }
  if (!Number.isInteger(maxSkipped) || maxSkipped < 0) {
    return [`${label}: no usable --max-skipped (got ${String(maxSkipped)})`];
  }
  const c = countCases(junitXml);
  if (c.suites === 0) {
    return [`${label}: the report has no request in it: this run checked nothing (0 test cases)`];
  }
  if (c.counted === 0) {
    out.push(
      `${label}: 0 test cases proved anything (${c.cases} in the report, ${c.notRun} NOT RUN, ${c.edge} edge challenge): this run checked nothing`
    );
  } else if (c.counted < min) {
    out.push(
      `${label}: ${c.counted} test cases counted, fewer than the minimum ${min} (${c.cases} in the report, ${c.notRun} NOT RUN, ${c.edge} edge challenge): part of the collection did not run`
    );
  }
  if (c.skipped > maxSkipped) {
    out.push(`${label}: ${c.skipped} requests skipped, more than the ceiling ${maxSkipped}`);
  }
  return out;
}

function parseArgs(argv) {
  const args = { file: undefined, min: NaN, maxSkipped: NaN, label: 'Bruno run' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min') args.min = Number(argv[++i]);
    else if (a === '--max-skipped') args.maxSkipped = Number(argv[++i]);
    else if (a === '--label') args.label = String(argv[++i]);
    else if (args.file === undefined) args.file = a;
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the run's own JUnit report, named by the workflow
  if (!args.file || !existsSync(args.file)) {
    process.stderr.write(
      `::error title=Bruno run proved nothing::${args.label}: no JUnit report at '${args.file ?? '(no path given)'}'; a run that wrote no report checked nothing\n`
    );
    process.exit(1);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- as above
  const xml = readFileSync(args.file, 'utf8');
  const found = problems(xml, { min: args.min, maxSkipped: args.maxSkipped }, args.label);
  const c = countCases(xml);
  const line = `${args.label}: ${c.counted} test cases counted (minimum ${args.min}), ${c.skipped} requests skipped (ceiling ${args.maxSkipped}), ${c.notRun} NOT RUN, ${c.edge} edge challenge`;
  if (found.length === 0) {
    process.stdout.write(`${line}\n`);
  } else {
    for (const p of found) {
      process.stderr.write(`::error title=Bruno run proved too little (OSE-2160)::${p}\n`);
    }
    process.stderr.write(`${line}\n`);
    process.exit(1);
  }
}
