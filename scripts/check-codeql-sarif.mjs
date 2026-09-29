/**
 * OSE-1410 — CodeQL findings gate.
 *
 * WHY: codeql.yml runs with `upload: 'never'` (private repo, no GitHub Code
 * Security — OSE-1368), so its SARIF went to a 30-day artifact and nowhere else.
 * The job was green WITH findings, which never trips security-triage (it only
 * fires on a red run). Measured 2026-09-29: 44 security results sat unread, two
 * of them in live Worker source. A scanner nobody reads is not a gate.
 *
 * THE RULE this gate enforces:
 *   Any security-tagged result located in PRODUCTION code fails the job.
 *   Production = the deployed Worker's src, the root src, and first-party
 *   package src. Everything else CodeQL analyses (tests, scripts, workflows,
 *   archived Postman collections) is REPORTED in the step summary but does not
 *   gate — those paths do not ship, and gating on them would bury the real
 *   signal in test-regex noise.
 *
 * No baseline file: production code is at zero findings, so any new one is red.
 * If a finding is a true false positive, exclude that query for that path in
 * .github/codeql/codeql-config.yml (`query-filters`) with the reason in the
 * reviewed diff — never by narrowing PRODUCTION_PATHS.
 *
 * USAGE:
 *   node scripts/check-codeql-sarif.mjs <dir-or-file.sarif> [...]
 *     → exit 0 if no gated finding, exit 1 listing each one if there is.
 *   node scripts/check-codeql-sarif.mjs --self-test
 *     → runs built-in born-red cases; exit 0 if the gate logic is correct.
 */

import { readFileSync, readdirSync, statSync, appendFileSync } from 'fs';
import { join } from 'path';

// Paths that ship. Anchored at the repo root; forward slashes (SARIF URIs).
const PRODUCTION_PATHS = [
  /^workers\/[^/]+\/src\//,
  /^src\//,
  /^packages\/[^/]+\/src\//,
];

// Test files can live under src/ in some packages; they never ship.
const NON_SHIPPING = /(^|\/)(__tests__|tests?)\/|\.(spec|test)\.[cm]?[jt]sx?$/;

export function isProductionPath(uri) {
  const path = String(uri || '').replace(/^\.?\//, '').replace(/^file:\/\/[^/]*\//, '');
  return PRODUCTION_PATHS.some((re) => re.test(path)) && !NON_SHIPPING.test(path);
}

/** Collect every rule (driver + extensions) so a result can be classified. */
function rulesById(run) {
  const rules = new Map();
  const add = (list) => (list || []).forEach((r) => rules.set(r.id, r));
  add(run.tool?.driver?.rules);
  (run.tool?.extensions || []).forEach((e) => add(e.rules));
  return rules;
}

/**
 * Classify every result in a parsed SARIF document.
 * @returns {{ gated: object[], reported: object[] }}
 */
export function evaluate(sarif) {
  const gated = [];
  const reported = [];
  for (const run of sarif.runs || []) {
    const rules = rulesById(run);
    for (const result of run.results || []) {
      const rule = rules.get(result.ruleId) || {};
      const props = rule.properties || {};
      const loc = result.locations?.[0]?.physicalLocation;
      const finding = {
        ruleId: result.ruleId,
        security: (props.tags || []).includes('security'),
        severity: props['security-severity'] || '-',
        uri: loc?.artifactLocation?.uri || '?',
        line: loc?.region?.startLine || 0,
        message: (result.message?.text || '').split('\n')[0].slice(0, 200),
      };
      (finding.security && isProductionPath(finding.uri) ? gated : reported).push(finding);
    }
  }
  return { gated, reported };
}

function sarifFiles(target) {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target, { recursive: true })
    .map((f) => join(target, String(f)))
    .filter((f) => f.endsWith('.sarif'));
}

function summarize({ gated, reported }) {
  const byRule = new Map();
  for (const f of reported) {
    const key = `${f.security ? 'security' : 'quality'} | ${f.ruleId}`;
    byRule.set(key, (byRule.get(key) || 0) + 1);
  }
  const lines = ['## CodeQL findings gate (OSE-1410)', ''];
  lines.push(`**Gated (production code): ${gated.length}** · reported only (tests/scripts/CI/archive): ${reported.length}`, '');
  if (gated.length) {
    lines.push('| Rule | Severity | Location | Message |', '| --- | --- | --- | --- |');
    for (const f of gated) lines.push(`| \`${f.ruleId}\` | ${f.severity} | \`${f.uri}:${f.line}\` | ${f.message.replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  if (byRule.size) {
    lines.push('<details><summary>Reported only, by rule</summary>', '', '| Count | Kind · Rule |', '| --- | --- |');
    for (const [k, n] of [...byRule].sort((a, b) => b[1] - a[1])) lines.push(`| ${n} | ${k} |`);
    lines.push('', '</details>');
  }
  return lines.join('\n');
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runSelfTest() {
  const rule = (id, tags) => ({ id, properties: { tags, 'security-severity': '7.5' } });
  const res = (ruleId, uri) => ({ ruleId, message: { text: 'm' }, locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }] });
  const doc = (results) => ({
    runs: [{ tool: { driver: { rules: [] }, extensions: [{ rules: [rule('sec', ['security']), rule('qual', ['maintainability'])] }] }, results }],
  });
  const cases = [
    ['security finding in worker src is gated', doc([res('sec', 'workers/oursharedevents/src/lib/x.ts')]), 1],
    ['security finding in root src is gated', doc([res('sec', 'src/frontend/a.ts')]), 1],
    ['security finding in package src is gated', doc([res('sec', 'packages/flags/src/index.ts')]), 1],
    ['security finding in worker tests is reported only', doc([res('sec', 'workers/oursharedevents/tests/a.spec.ts')]), 0],
    ['security finding in a spec file under src is reported only', doc([res('sec', 'packages/flags/src/a.test.ts')]), 0],
    ['security finding in scripts is reported only', doc([res('sec', 'scripts/diag.js')]), 0],
    ['security finding in archive is reported only', doc([res('sec', 'archive/x/server.js')]), 0],
    ['quality finding in worker src is reported only', doc([res('qual', 'workers/oursharedevents/src/a.ts')]), 0],
    ['unknown rule (no tags) in src is reported only', doc([res('nope', 'src/a.ts')]), 0],
    ['empty SARIF gates nothing', { runs: [] }, 0],
  ];
  let failed = 0;
  for (const [name, sarif, want] of cases) {
    const got = evaluate(sarif).gated.length;
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (gated=${got}, want ${want})`);
  }
  if (failed > 0) fail(`\nself-test: ${failed} case(s) failed — gate logic is wrong.`);
  console.log(`\nself-test: all ${cases.length} cases passed.`);
}

const isMain = process.argv[1]?.endsWith('check-codeql-sarif.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    process.exit(0);
  }
  const targets = process.argv.slice(2);
  if (targets.length === 0) fail('usage: check-codeql-sarif.mjs <dir-or-file.sarif> [...] | --self-test');

  const files = targets.flatMap(sarifFiles);
  // A missing SARIF means the analysis did not run — that is not a pass.
  if (files.length === 0) fail(`::error::No .sarif file found under ${targets.join(', ')} — CodeQL produced no output; refusing to report green.`);

  const all = { gated: [], reported: [] };
  for (const f of files) {
    const { gated, reported } = evaluate(JSON.parse(readFileSync(f, 'utf8')));
    all.gated.push(...gated);
    all.reported.push(...reported);
  }

  const summary = summarize(all);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);

  if (all.gated.length) {
    for (const f of all.gated) {
      console.log(`::error file=${f.uri},line=${f.line},title=CodeQL ${f.ruleId}::${f.message}`);
    }
    fail(`\n${all.gated.length} security finding(s) in production code. Fix them, or exclude a proven false positive in codeql-config.yml with the reason in review.`);
  }
  console.log('\nNo security findings in production code.');
}
