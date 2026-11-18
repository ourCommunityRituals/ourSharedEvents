// The merge-blocking decision of the Dependency Vulnerability Audit
// (.github/workflows/security-scan.yml, job dependency-audit). OSE-1489.
//
//   node scripts/ci/npm-audit-gate.mjs <npm-audit.json> [.security-exceptions.json]
//
// It reads the report `npm audit --json` wrote and the repo's exception file,
// and exits 1 when any of these holds:
//
//   - the report cannot be read as an npm audit v2 report (an endpoint error,
//     an empty file): a gate that cannot see does not pass
//   - a high or critical advisory has no active exception for it
//   - an exception entry is malformed (a missing field, a date that is not a
//     real YYYY-MM-DD, a ticket that is not a tracker id), is for a critical
//     advisory (never excepted, docs/security/SECURITY.md), runs longer than
//     its severity's window (high 30 days, moderate 90, low 180), or has
//     reached its reviewDate (expired the day it is due, as
//     security-sla-enforcement.yml reads it)
//
// An exception names one advisory (its GHSA id) in one package. It never
// names a package as a whole or a severity, so a new advisory in the same
// package blocks. It applies only while the report lists that advisory: once
// the locked version is outside the advisory's range, npm audit drops it and
// the entry is printed as unused (it does not fail; remove it).
// Each excepted advisory is printed with its end date, reason and ticket
// (OSE-2121).
//
// tests/unit/ci/npm-audit-gate.test.js holds the cases and the born-red record.

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BLOCKING = new Set(['critical', 'high']);

/** Longest an exception may run, by severity, in days. Critical: none. */
export const WINDOW_DAYS = { critical: 0, high: 30, moderate: 90, low: 180, info: 180 };

const GHSA = /^GHSA-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A tracker id such as OSE-2121: the place the exception's decision is recorded. */
const TICKET = /^[A-Z][A-Z0-9]*-\d+$/;
const REQUIRED = [
  'id',
  'package',
  'severity',
  'reason',
  'mitigation',
  'addedBy',
  'approvedBy',
  'addedDate',
  'reviewDate',
  'ticket',
];

const dayNumber = (iso) => {
  if (!ISO_DATE.test(iso)) return NaN;
  const t = Date.parse(`${iso}T00:00:00Z`);
  // Date.parse accepts 2026-02-31 and rolls it over; refuse a date that does not round-trip.
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? NaN : t / 86400000;
};

/** Today in UTC as YYYY-MM-DD. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * The advisories of an `npm audit --json` (auditReportVersion 2) report:
 * `{ id, package, severity, title, url }`, one per advisory and package.
 * Throws when the report is not one npm audit wrote.
 */
export function advisories(report) {
  if (!report || typeof report !== 'object')
    throw new Error('the audit report is not a JSON object');
  if (report.error) {
    const e = report.error;
    throw new Error(
      `npm audit reported an error: ${e.code ?? ''} ${e.summary ?? JSON.stringify(e)}`.trim()
    );
  }
  if (
    report.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object'
  ) {
    throw new Error(
      'the audit report is not an npm audit v2 report (no auditReportVersion 2 or no vulnerabilities)'
    );
  }
  const out = new Map();
  for (const vuln of Object.values(report.vulnerabilities)) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || via === null) continue; // a package name: its advisory is listed under that package
      const m = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(via.url ?? '');
      const id = m ? 'GHSA' + m[0].slice(4).toLowerCase() : `npm-${via.source}`;
      const key = `${id}|${via.name}`;
      if (!out.has(key)) {
        out.set(key, {
          id,
          package: via.name,
          severity: via.severity,
          title: via.title ?? '',
          url: via.url ?? '',
        });
      }
    }
  }
  return [...out.values()];
}

/** The problems with one exception entry, as sentences; empty when it is sound. */
export function entryProblems(entry, today) {
  const label =
    entry && typeof entry === 'object' && typeof entry.id === 'string' ? entry.id : '(no id)';
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    return [`${label}: an entry must be an object`];
  const problems = [];
  for (const field of REQUIRED) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '')
      problems.push(`${label}: "${field}" is missing or empty`);
  }
  if (problems.length) return problems;
  if (!GHSA.test(entry.id))
    problems.push(`${label}: "id" must be a GHSA advisory id (GHSA-xxxx-xxxx-xxxx)`);
  if (!TICKET.test(entry.ticket))
    problems.push(`${label}: "ticket" must be a tracker id such as OSE-123`);
  if (!(entry.severity in WINDOW_DAYS))
    problems.push(`${label}: "severity" must be one of ${Object.keys(WINDOW_DAYS).join(', ')}`);
  if (entry.severity === 'critical')
    problems.push(`${label}: a critical advisory cannot be excepted (docs/security/SECURITY.md)`);
  const added = dayNumber(entry.addedDate);
  const review = dayNumber(entry.reviewDate);
  if (Number.isNaN(added))
    problems.push(`${label}: "addedDate" must be a real date written YYYY-MM-DD`);
  if (Number.isNaN(review))
    problems.push(`${label}: "reviewDate" must be a real date written YYYY-MM-DD`);
  if (problems.length) return problems;
  const window = WINDOW_DAYS[entry.severity];
  if (review <= added) problems.push(`${label}: "reviewDate" must come after "addedDate"`);
  else if (review - added > window) {
    problems.push(
      `${label}: runs ${review - added} days; a ${entry.severity} exception runs at most ${window}`
    );
  }
  if (review <= dayNumber(today))
    problems.push(`${label}: expired, review was due ${entry.reviewDate}`);
  return problems;
}

/**
 * The gate's decision. `exceptionsFile` is the parsed .security-exceptions.json,
 * or null when the repo has none.
 */
export function evaluate(report, exceptionsFile, today = todayUtc()) {
  const found = advisories(report);
  const problems = [];
  let entries = [];
  if (exceptionsFile !== null && exceptionsFile !== undefined) {
    if (typeof exceptionsFile !== 'object' || !Array.isArray(exceptionsFile.exceptions)) {
      problems.push('.security-exceptions.json must be an object with an "exceptions" array');
    } else {
      entries = exceptionsFile.exceptions;
    }
  }
  const active = [];
  const seen = new Set();
  for (const entry of entries) {
    const p = entryProblems(entry, today);
    const key = p.length ? null : `${entry.id}|${entry.package}`;
    if (key && seen.has(key)) p.push(`${entry.id}: listed twice for ${entry.package}`);
    problems.push(...p);
    if (!p.length) {
      seen.add(key);
      active.push(entry);
    }
  }

  const blocking = [];
  const excepted = [];
  const used = new Set();
  for (const adv of found) {
    if (!BLOCKING.has(adv.severity)) continue;
    const entry = active.find((e) => e.id === adv.id && e.package === adv.package);
    if (!entry) {
      blocking.push(adv);
      continue;
    }
    if (entry.severity !== adv.severity) {
      problems.push(
        `${entry.id}: the entry says ${entry.severity}; the report says ${adv.severity}`
      );
      blocking.push(adv);
      continue;
    }
    used.add(entry);
    excepted.push({
      ...adv,
      reviewDate: entry.reviewDate,
      reason: entry.reason,
      ticket: entry.ticket,
    });
  }
  // A moderate or low advisory never blocks; its entry still counts as used.
  for (const adv of found) {
    const entry = active.find((e) => e.id === adv.id && e.package === adv.package);
    if (entry) used.add(entry);
  }
  const unused = active.filter((e) => !used.has(e));

  return {
    pass: blocking.length === 0 && problems.length === 0,
    blocking,
    excepted,
    problems,
    unused,
    advisories: found,
  };
}

/** The decision as the job log prints it. */
export function describe(result) {
  const lines = [];
  for (const a of result.blocking)
    lines.push(`❌ BLOCKING ${a.severity}: ${a.id} in ${a.package}: ${a.title} ${a.url}`.trimEnd());
  for (const p of result.problems) lines.push(`❌ EXCEPTION FILE: ${p}`);
  for (const a of result.excepted) {
    lines.push(
      `⚠️  EXCEPTED ${a.severity}: ${a.id} in ${a.package} until ${a.reviewDate} (fails again from that day, UTC). Ticket ${a.ticket}. (.security-exceptions.json)`,
      `    Reason: ${a.reason}`
    );
  }
  for (const e of result.unused)
    lines.push(
      `ℹ️  UNUSED exception: ${e.id} in ${e.package}; the report no longer lists it, remove the entry`
    );
  lines.push(
    result.pass
      ? `✅ No unexcepted high or critical advisories (${result.excepted.length} excepted).`
      : `❌ Gate failed: ${result.blocking.length} unexcepted high/critical advisor${result.blocking.length === 1 ? 'y' : 'ies'}, ${result.problems.length} exception-file problem${result.problems.length === 1 ? '' : 's'}.`
  );
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [reportPath, exceptionsPath = '.security-exceptions.json'] = process.argv.slice(2);
  try {
    if (!reportPath)
      throw new Error('usage: npm-audit-gate.mjs <npm-audit.json> [.security-exceptions.json]');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the job's own report path
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    /* eslint-disable security/detect-non-literal-fs-filename -- the repo's exception file */
    const exceptions = existsSync(exceptionsPath)
      ? JSON.parse(readFileSync(exceptionsPath, 'utf8'))
      : null;
    /* eslint-enable security/detect-non-literal-fs-filename */
    // No date override: the clock the gate reads is the runner's, so an expiry cannot be moved from the workflow.
    const result = evaluate(report, exceptions, todayUtc());
    process.stdout.write(describe(result));
    process.exitCode = result.pass ? 0 : 1;
  } catch (err) {
    process.stdout.write(`❌ Gate failed closed: ${err.message}\n`);
    process.exitCode = 1;
  }
}
